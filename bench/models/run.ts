// B1 (D35) bench M, "Do models know what code does?": asks Meta models to bet on each test in
// bench/models/corpus.json, runs the code with Atlas, and scores each bet with Atlas's judge. Rules:
// bench/models/PASS-RULE.md.
//
// Usage:
//   npx tsx bench/models/run.ts --dry-run                 # builds every prompt, estimates the cost; NO model call
//   npx tsx bench/models/run.ts --live                    # Muse Spark 1.3 + Muse Spark Open (costs money; Dami starts it)
//   npx tsx bench/models/run.ts --live --with-wonder      # also Muse Wonder 1.0
//
// The dry run writes bench/models/dry-run/<date>.json: every prompt's SHA-256 and size, and the estimate. The live
// run first rebuilds every prompt and stops before any model call if one differs from the newest committed dry run
// (the prompt freeze in PASS-RULE.md). Then, per test: each model bets (one repair try on an invalid answer, as the
// product's bet-only Claimant does; the answer check is bench/models/validate.ts, which adds the "json" kind the
// product's check lacks), the bets are sealed, Atlas runs the code once, and src/judge.ts judges every
// bet against that run. It stops before the next model call once the logged cost reaches the $8 cap.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { experimentFor, loadCorpus, paramsOf, sha256Hex, type CorpusTest, type LoadedFunction } from "../lib/corpus.ts";
import { pastedBetMessages, pastedQuestions, type ChatMessageLike } from "./bet-context.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { SPARK_MODEL, SPARK_OPEN_MODEL } from "../../src/claimants.ts";
import type { Bet, BetAnswer, Experiment, Run } from "../../src/types.ts";
import type { Question } from "../../src/gate.ts";

const HERE = new URL(".", import.meta.url).pathname;
const ROOT = new URL("../..", import.meta.url).pathname;
const CORPUS = join(HERE, "corpus.json");
export const WONDER_MODEL = "muse-wonder-1.0";
export const BUDGET_CAP_USD = 8;

/** Dollars per 1M tokens, the same numbers as server/meta/client.ts (Spark's is an unverified upper bound). */
export const PRICES: Record<string, { inPerM: number; outPerM: number; verified: boolean }> = {
  [SPARK_MODEL]: { inPerM: 4, outPerM: 20, verified: false },
  [SPARK_OPEN_MODEL]: { inPerM: 1.25, outPerM: 4.25, verified: true },
  [WONDER_MODEL]: { inPerM: 4, outPerM: 20, verified: true },
};

/**
 * The estimate's assumptions, stated so they can be checked against the live usage log.
 * - Prompt tokens: characters / 3.5 (code and JSON tokenise denser than prose's ~4 characters per token).
 * - Completion tokens per call (hidden reasoning included): 1,500 central, 3,000 high. Earlier live bet-only calls
 *   on this repo cost $0.0225 to $0.042 per call at Spark's assumed price (tests/evidence/D02-06, D02-02b), which is
 *   about 900 to 1,900 completion tokens at a similar prompt size.
 * - 10% more calls for repair tries.
 */
export const ESTIMATE = {
  charsPerToken: 3.5,
  completionCentral: 1500,
  completionHigh: 3000,
  repairShare: 0.1,
  /**
   * The bet call's token cap (G1, main 233e297: BET_MAX_TOKENS 4,000, retry BET_RETRY_MAX_TOKENS 8,000; the live run
   * passes both, as the product's bet-only Claimant does). When a reasoning model runs out of room, the client retries
   * once at the retry cap: one such event costs about (4,000 - 1,500) + 8,000 = 10,500 more completion tokens than an
   * ordinary answer. Assumed share of calls that overflow: 2% central, 5% high. (Before G1 the caps were 16,000 and
   * 32,000, and this extra was 46,500 tokens.)
   */
  betMaxTokens: 4000,
  betRetryMaxTokens: 8000,
  overflowShareCentral: 0.02,
  overflowShareHigh: 0.05,
  overflowExtraCompletion: 4000 - 1500 + 8000,
};

export interface PlannedPrompt {
  testId: string;
  functionId: string;
  language: string;
  category: string;
  experiment: Experiment;
  questions: Question[];
  messages: ChatMessageLike[];
  promptSha256: string;
  promptChars: number;
}

export function promptSha(messages: readonly ChatMessageLike[]): string {
  return sha256Hex(JSON.stringify(messages));
}

/** Every prompt, built from the corpus by plain code. No I/O beyond reading the corpus; no model call. */
/**
 * Who writes the prompt. "b1": bench/models/bet-context.ts (registered with this bench). "e3": E3's paste-screen text
 * (src/paste-context.ts pastedBetContext) inside the server's prompt (buildBetOnlyMessages with seenInstruction null),
 * which bench/models/AMENDMENT-1-e3-bet-context.md makes the ONLY builder allowed for a live run.
 */
export interface PromptBuilder {
  name: "b1" | "e3";
  messages: (f: LoadedFunction, exp: Experiment, questions: Question[]) => ChatMessageLike[];
  questions: (params: ReturnType<typeof paramsOf>) => Question[];
}

export const B1_BUILDER: PromptBuilder = {
  name: "b1",
  messages: (f, exp) => pastedBetMessages({ source: f.source, language: f.language, params: exp.params as ReturnType<typeof paramsOf> }),
  questions: (params) => pastedQuestions(params),
};

/** E3's builder, when src/paste-context.ts is on this branch; null otherwise. Loaded by path so this file type-checks without E3. */
export async function e3Builder(): Promise<PromptBuilder | null> {
  const ctxPath = "../../src/paste-context.ts";
  let ctx: Record<string, unknown>;
  try {
    ctx = (await import(ctxPath)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const bets = (await import("../../server/meta/roles/claimant-bets.ts")) as unknown as Record<string, unknown>;
  const gate = await import("../../src/gate.ts");
  const pastedBetContext = ctx.pastedBetContext as (i: { experiment: Experiment; questions: readonly Question[]; exportLine?: number }) => string;
  const buildBetOnlyMessages = bets.buildBetOnlyMessages as (i: Record<string, unknown>) => ChatMessageLike[];
  if (typeof pastedBetContext !== "function" || typeof buildBetOnlyMessages !== "function") return null;
  const { exportedFunctionsFor } = await import("../../src/pasted-code.ts");
  return {
    name: "e3",
    questions: (params) => gate.questionsFor(params),
    messages: (f, exp, questions) => {
      const exportLine = exportedFunctionsFor(f.source, f.language).find((e) => e.name === (exp.params as { exportName: string }).exportName)?.line;
      const seenContext = pastedBetContext({ experiment: exp, questions, ...(exportLine ? { exportLine } : {}) });
      return buildBetOnlyMessages({ experiment: exp, questions, seenContext, seenInstruction: null, finding: { verified: true }, fileText: "", gateContext: {} });
    },
  };
}

export function buildPlan(corpusPath = CORPUS, builder: PromptBuilder = B1_BUILDER): { plan: PlannedPrompt[]; corpusSha256: string; refused: { testId: string; reason: string }[] } {
  const { functions, corpusSha256 } = loadCorpus(corpusPath);
  const plan: PlannedPrompt[] = [];
  const refused: { testId: string; reason: string }[] = [];
  for (const f of functions) {
    for (const t of f.tests) {
      const e = experimentFor(f, t);
      if (!e.ok) {
        refused.push({ testId: t.id, reason: e.reason });
        continue;
      }
      const questions = builder.questions(paramsOf(t));
      const messages = builder.messages(f, e.experiment, questions);
      plan.push({
        testId: t.id,
        functionId: f.id,
        language: f.language,
        category: f.category,
        experiment: e.experiment,
        questions,
        messages,
        promptSha256: promptSha(messages),
        promptChars: messages.reduce((n, m) => n + m.content.length, 0),
      });
    }
  }
  return { plan, corpusSha256, refused };
}

export function estimateCost(plan: readonly PlannedPrompt[], models: readonly string[]) {
  const promptTokens = plan.reduce((n, p) => n + Math.ceil(p.promptChars / ESTIMATE.charsPerToken), 0);
  const calls = plan.length * (1 + ESTIMATE.repairShare);
  const perModel = models.map((m) => {
    const price = PRICES[m]!;
    const input = (promptTokens * (1 + ESTIMATE.repairShare) * price.inPerM) / 1e6;
    const overflow = (share: number) => (calls * share * (ESTIMATE.overflowExtraCompletion * price.outPerM + Math.ceil(promptTokens / plan.length) * price.inPerM)) / 1e6;
    const central = input + (calls * ESTIMATE.completionCentral * price.outPerM) / 1e6 + overflow(ESTIMATE.overflowShareCentral);
    const high = input + (calls * ESTIMATE.completionHigh * price.outPerM) / 1e6 + overflow(ESTIMATE.overflowShareHigh);
    return { model: m, priceVerified: price.verified, calls: Math.round(calls), promptTokens: Math.round(promptTokens * (1 + ESTIMATE.repairShare)), centralUsd: round4(central), highUsd: round4(high) };
  });
  const sum = (k: "centralUsd" | "highUsd") => round4(perModel.reduce((n, x) => n + x[k], 0));
  return { assumptions: ESTIMATE, perModel, totalCentralUsd: sum("centralUsd"), totalHighUsd: sum("highUsd") };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── scoring ─────────────────────────────────────────────────────────────────────────────────────────

export type Score = "matched" | "didn't match" | "declined" | "invalid" | "not checkable";

/** One question's score for one model, by the rules of PASS-RULE.md. */
export function scoreBet(bet: Bet | undefined, measures: string, run: Run): { score: Score; reason?: string; observed?: unknown } {
  const nm = run.result.notMeasured;
  if (run.controlPassed !== true) return { score: "not checkable", reason: nm.control ?? "the control did not pass" };
  if (nm.wholeRun) return { score: "not checkable", reason: nm.wholeRun };
  if (!Object.prototype.hasOwnProperty.call(run.result.measured, measures)) return { score: "not checkable", reason: nm[measures] ?? `Atlas did not measure ${measures}` };
  if (!bet) return { score: "invalid" };
  if (bet.answer.kind === "declined") return { score: "declined", reason: bet.answer.reason };
  const v = judge(bet, run);
  if (v.outcome === "matched") return { score: "matched", observed: v.observed };
  if (v.outcome === "not_matched") return { score: "didn't match", observed: v.observed };
  return { score: "not checkable", reason: v.reason ?? "the judge could not compare" };
}

export function questionType(measures: string): string {
  return measures.startsWith("calls:") ? "calls" : measures;
}

export interface Tally { n: number; matched: number; "didn't match": number; declined: number; invalid: number; "not checkable": number }
const emptyTally = (): Tally => ({ n: 0, matched: 0, "didn't match": 0, declined: 0, invalid: 0, "not checkable": 0 });

export function tally(rows: readonly { model: string; type: string; score: Score }[]) {
  const out: Record<string, Record<string, Tally>> = {};
  for (const r of rows) {
    const byType = (out[r.model] ??= {});
    for (const key of [r.type, "all"]) {
      const t = (byType[key] ??= emptyTally());
      t[r.score]++;
      if (r.score !== "not checkable") t.n++;
    }
  }
  return out;
}

export function rates(t: Tally) {
  const answered = t.matched + t["didn't match"];
  return {
    matchAmongAnswers: answered ? t.matched / answered : null,
    matchCountingDeclinesAndInvalidsAsMisses: t.n ? t.matched / t.n : null,
    declineRate: t.n ? t.declined / t.n : null,
  };
}

// ── live (gated) ────────────────────────────────────────────────────────────────────────────────────

export interface LiveDeps {
  chat: (args: { role: "claimant"; model: string; messages: ChatMessageLike[]; json: true; maxTokens: number; retryMaxTokens: number }) => Promise<
    { ok: true; content: string; finishReason: string; usage: { usd: number; promptTokens: number; completionTokens: number } } | { ok: false; reason: string; usage?: { usd: number; promptTokens: number; completionTokens: number } }
  >;
  validate: (content: string, questions: readonly Question[]) => { ok: true; bets: { question: Question; out: { answer: unknown; rationale?: string } }[] } | { ok: false; error: string; safe: string };
  repairMessage: (error: string) => string;
  run: (exp: Experiment) => Promise<Run>;
  now?: () => Date;
  log?: (line: string) => void;
}

export interface ModelAnswer {
  model: string;
  bets: Bet[];
  invalid?: string;
  usd: number;
  promptTokens: number;
  completionTokens: number;
  attempts: number;
}

/** One model's sealed bets on one test (one repair try), exactly like runClaimantBets minus the agent log. */
export async function askModel(p: PlannedPrompt, model: string, deps: LiveDeps): Promise<ModelAnswer> {
  const messages: ChatMessageLike[] = p.messages.map((m) => ({ ...m }));
  const a: ModelAnswer = { model, bets: [], usd: 0, promptTokens: 0, completionTokens: 0, attempts: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    a.attempts++;
    const res = await deps.chat({ role: "claimant", model, messages: [...messages], json: true, maxTokens: ESTIMATE.betMaxTokens, retryMaxTokens: ESTIMATE.betRetryMaxTokens });
    if (res.usage) {
      a.usd += res.usage.usd;
      a.promptTokens += res.usage.promptTokens;
      a.completionTokens += res.usage.completionTokens;
    }
    if (!res.ok) return { ...a, invalid: `the model call failed: ${res.reason}` };
    const v = deps.validate(res.content, p.questions);
    if (v.ok) {
      const sealedAt = (deps.now ?? (() => new Date()))();
      a.bets = v.bets.map(({ question, out }) =>
        sealBet({ experimentId: p.experiment.id, who: `model:${model}`, question: question.text, measures: question.measures, answer: out.answer as BetAnswer, ...(out.rationale ? { rationale: out.rationale } : {}) }, sealedAt),
      );
      return a;
    }
    if (attempt === 1) return { ...a, invalid: v.error };
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: deps.repairMessage(v.error) });
  }
  return { ...a, invalid: "no usable answer" };
}

export async function runLive(plan: readonly PlannedPrompt[], models: readonly string[], deps: LiveDeps) {
  const tests: unknown[] = [];
  const rows: { model: string; type: string; language: string; score: Score }[] = [];
  let spent = 0;
  let stoppedBecause: string | undefined;
  for (const p of plan) {
    if (stoppedBecause) break;
    const answers: ModelAnswer[] = [];
    for (const model of models) {
      if (spent >= BUDGET_CAP_USD) {
        stoppedBecause = `the logged cost reached the $${BUDGET_CAP_USD} cap before ${p.testId} (${model})`;
        break;
      }
      const a = await askModel(p, model, deps);
      spent += a.usd;
      answers.push(a);
    }
    if (answers.length === 0) break;
    // A test cut short by the cap still runs and scores the bets already sealed; the models not asked are absent.
    // Every bet on this test is sealed before its run starts.
    // A run that cannot start (a sandbox error) must not lose the sealed bets already paid for: it is recorded as a
    // run with no trusted result, so every bet on it is "not checkable" with the reason.
    let run: Run;
    try {
      run = await deps.run(p.experiment);
    } catch (err) {
      const why = `the run did not start: ${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`;
      run = { id: `not-started-${p.testId}`, experimentId: p.experiment.id, runner: "ts", executor: "local", codeSha256: p.experiment.target.codeSha256, seed: "none", startedAt: "", finishedAt: "", trace: [], result: { measured: {}, notMeasured: { wholeRun: why, control: why } }, controlPassed: false };
    }
    const scored = answers.map((a) => ({
      model: a.model,
      invalid: a.invalid,
      usd: a.usd,
      promptTokens: a.promptTokens,
      completionTokens: a.completionTokens,
      attempts: a.attempts,
      bets: a.bets,
      scores: p.questions.map((q) => {
        const bet = a.bets.find((b) => b.measures === q.measures);
        const s = scoreBet(a.invalid ? undefined : bet, q.measures, run);
        rows.push({ model: a.model, type: questionType(q.measures), language: p.language, score: s.score });
        return { measures: q.measures, ...s };
      }),
    }));
    tests.push({ testId: p.testId, functionId: p.functionId, language: p.language, category: p.category, promptSha256: p.promptSha256, run: { id: run.id, controlPassed: run.controlPassed, measured: run.result.measured, notMeasured: run.result.notMeasured }, answers: scored });
    deps.log?.(`${p.testId} done ($${spent.toFixed(4)} so far)`);
  }
  return { tests, rows, spentUsd: round4(spent), ...(stoppedBecause ? { stoppedBecause } : {}) };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 1000) / 10}%`);

/** The result table: per model and question type, n and every score, the two match rates side by side. */
export function renderMarkdown(meta: Record<string, unknown>, summary: ReturnType<typeof tally>, rows: readonly { model: string; type: string; language: string; score: Score }[]): string {
  const lines = [`# Bench M result, ${meta.date}`, ""];
  lines.push(`Sample: ${meta.testsDone} of ${meta.testsPlanned} tests (30 functions x 3 in the corpus), one answer per model per test. No general accuracy claim follows (PASS-RULE.md).${meta.partial ? " **Partial run.**" : ""}`, "");
  lines.push(`- Models: ${(meta.models as string[]).join(", ")}`, `- Cost: $${meta.spentUsd} (Muse Spark at an assumed price: an upper bound)`, `- Prompts frozen by dry-run/${meta.dryRun}`, "");
  lines.push("| Model | Question | n (checkable) | matched | didn't match | declined | invalid | not checkable | match among answers | match, declines and invalids as misses | decline rate |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [model, byType] of Object.entries(summary)) {
    for (const type of ["outcome", "returnedJson", "virtualMs", "calls", "all"]) {
      const t = byType[type];
      if (!t) continue;
      const r = rates(t);
      lines.push(`| ${model} | ${type} | ${t.n} | ${t.matched} | ${t["didn't match"]} | ${t.declined} | ${t.invalid} | ${t["not checkable"]} | ${pct(r.matchAmongAnswers)} | ${pct(r.matchCountingDeclinesAndInvalidsAsMisses)} | ${pct(r.declineRate)} |`);
    }
  }
  lines.push("", "## By language", "", "| Model | Language | n | matched |", "|---|---|---|---|");
  const byLang = new Map<string, { n: number; matched: number }>();
  for (const r of rows) {
    const k = `${r.model} | ${r.language === "py" ? "Python" : "JS/TS"}`;
    const v = byLang.get(k) ?? { n: 0, matched: 0 };
    if (r.score !== "not checkable") v.n++;
    if (r.score === "matched") v.matched++;
    byLang.set(k, v);
  }
  for (const [k, v] of byLang) lines.push(`| ${k} | ${v.n} | ${v.matched} |`);
  lines.push("");
  return lines.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The most recently COMMITTED dry run (B1 review minor 8): the newest file added under bench/models/dry-run/ in git
 * history, read from HEAD, never the working tree. A dry-run file that was written but not committed does not count.
 */
export function latestCommittedDryRun(root = ROOT): { file: string; builder?: string; prompts: Record<string, string> } | null {
  let added: string;
  try {
    added = execFileSync("git", ["log", "--diff-filter=A", "--format=", "--name-only", "--", "bench/models/dry-run"], { cwd: root, encoding: "utf8" });
  } catch {
    return null;
  }
  const file = added.split("\n").map((l) => l.trim()).find((l) => l.endsWith(".json"));
  if (!file) return null;
  const j = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as { meta?: { builder?: string }; prompts: { testId: string; promptSha256: string }[] };
  return { file, ...(j.meta?.builder ? { builder: j.meta.builder } : {}), prompts: Object.fromEntries(j.prompts.map((p) => [p.testId, p.promptSha256])) };
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const dry = process.argv.includes("--dry-run");
  const withWonder = process.argv.includes("--with-wonder");
  if (live === dry) throw new Error("pass exactly one of --dry-run or --live");
  // AMENDMENT-1: with E3 on this branch, prompts come from E3's paste-screen text; a live run requires it.
  const e3 = await e3Builder();
  if (live && !e3) throw new Error("bench/models/AMENDMENT-1-e3-bet-context.md: a live run must use E3's pastedBetContext (src/paste-context.ts), which is not on this branch yet; no model was called");
  const builder = e3 ?? B1_BUILDER;
  const { plan, corpusSha256, refused } = buildPlan(CORPUS, builder);
  if (refused.length) throw new Error(`the gate refused ${refused.length} test(s): ${refused.map((r) => `${r.testId}: ${r.reason}`).join("; ")}`);
  const models = [SPARK_MODEL, SPARK_OPEN_MODEL, ...(withWonder || dry ? [WONDER_MODEL] : [])];
  const date = localDate();

  if (dry) {
    const est = estimateCost(plan, [SPARK_MODEL, SPARK_OPEN_MODEL, WONDER_MODEL]);
    const estNoWonder = estimateCost(plan, [SPARK_MODEL, SPARK_OPEN_MODEL]);
    const out = {
      meta: { bench: "models", kind: "dry run (no model call)", date, builder: builder.name, corpusSha256, tests: plan.length, functions: new Set(plan.map((p) => p.functionId)).size, questions: plan.reduce((n, p) => n + p.questions.length, 0) },
      estimate: { sparkAndSparkOpen: estNoWonder, withWonder: est },
      prompts: plan.map((p) => ({ testId: p.testId, promptSha256: p.promptSha256, promptChars: p.promptChars, questions: p.questions.map((q) => q.measures) })),
      samplePrompt: { testId: plan[0]!.testId, messages: plan[0]!.messages },
    };
    const dir = join(HERE, "dry-run");
    mkdirSync(dir, { recursive: true });
    // Dry runs are append-only too: a second one the same day gets a new name (the freeze reads git's add order).
    let stem = date;
    for (let i = 2; existsSync(join(dir, `${stem}.json`)); i++) stem = `${date}-${i}`;
    writeFileSync(join(dir, `${stem}.json`), JSON.stringify(out, null, 2) + "\n");
    process.stdout.write(
      `dry run: ${plan.length} prompts, ${out.meta.questions} questions; estimate Spark + Spark Open $${estNoWonder.totalCentralUsd} (high $${estNoWonder.totalHighUsd}); ` +
        `with Wonder $${est.totalCentralUsd} (high $${est.totalHighUsd}). Wrote bench/models/dry-run/${stem}.json. No model was called.\n`,
    );
    return;
  }

  // Checked at the start: the run then writes its own usage log into results/, which is not a change to the tooling.
  const dirtyAtStart = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
  if (dirtyAtStart) throw new Error("the working tree has uncommitted changes; a live run must be produced by committed files; no model was called");
  // --live: the prompt freeze, then the real clients (loaded only here, so a dry run never touches them).
  const frozen = latestCommittedDryRun();
  if (!frozen) throw new Error("no committed dry run to compare prompts with; run --dry-run and commit it first");
  if (frozen.builder !== builder.name) throw new Error(`the newest committed dry run (${frozen.file}) was built with "${frozen.builder ?? "b1"}" prompts, this run would use "${builder.name}"; commit a new dry run first`);
  const changed = plan.filter((p) => frozen.prompts[p.testId] !== p.promptSha256).map((p) => p.testId);
  if (changed.length) throw new Error(`prompts differ from dry-run/${frozen.file} for ${changed.length} test(s) (${changed.slice(0, 5).join(", ")}...); no model was called. See PASS-RULE.md, "Prompt freeze".`);
  const resultsDir = join(HERE, "results");
  mkdirSync(resultsDir, { recursive: true });
  process.env.ATLAS_USAGE_PATH = join(resultsDir, `${date}-usage.jsonl`);
  const { chat } = await import("../../server/meta/client.ts");
  // E3's own check accepts json bets; the bench check (validate.ts) is used only when the product's refuses them.
  const { validatePastedBets } = await import("./validate.ts");
  const { validateBetOnlyOutput } = await import("../../server/meta/roles/claimant-bets.ts");
  const probe = plan.find((p) => p.questions.some((q) => q.kind === "json"))!;
  const probeAnswer = JSON.stringify({ bets: probe.questions.map((q) => ({ measures: q.measures, answer: { kind: "declined", reason: "unknown: probe" }, rationale: "probe" })).map((b, i) => (probe.questions[i]!.kind === "json" ? { ...b, answer: { kind: "json", value: 1 } } : b)) });
  const productTakesJson = (validateBetOnlyOutput(probeAnswer, probe.questions) as { ok: boolean }).ok;
  const validate = (productTakesJson ? validateBetOnlyOutput : validatePastedBets) as unknown as LiveDeps["validate"];
  const { repairMessage } = await import("../../server/meta/roles/claimant.ts");
  const { tsRunner } = await import("../../runners/ts/control.ts");
  const runner = tsRunner();
  const res = await runLive(plan, models, {
    chat: chat as unknown as LiveDeps["chat"],
    validate,
    repairMessage,
    run: (exp) => runner.run(exp, {}),
    log: (l) => process.stdout.write(`${l}\n`),
  });
  const summary = tally(res.rows);
  const { REGISTRATIONS, contentHash, toolingHashes, workingFiles } = await import("../lib/registration.ts");
  const reg = REGISTRATIONS.find((r) => r.name === "models")!;
  const out = { meta: { bench: "models", date, corpusSha256, corpusPath: reg.corpus, registrationSha256: contentHash(workingFiles(ROOT, reg.prereg)), tooling: { ...toolingHashes(ROOT), ...Object.fromEntries(workingFiles(ROOT, ["bench/models/run.ts", "bench/models/validate.ts"]).map((f) => [f.path, f.sha256])) }, dirty: dirtyAtStart, builder: builder.name, validator: productTakesJson ? "product (E3)" : "bench/models/validate.ts", models, dryRun: frozen.file, testsPlanned: plan.length, testsDone: res.tests.length, partial: res.tests.length < plan.length, spentUsd: res.spentUsd, ...(res.stoppedBecause ? { stoppedBecause: res.stoppedBecause } : {}) }, summary, rates: Object.fromEntries(Object.entries(summary).map(([m, byType]) => [m, Object.fromEntries(Object.entries(byType).map(([k, t]) => [k, rates(t)]))])), tests: res.tests };
  writeFileSync(join(resultsDir, `${date}.json`), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(resultsDir, `${date}.md`), renderMarkdown(out.meta, summary, res.rows));
  process.stdout.write(`wrote bench/models/results/${date}.json and .md; spent $${res.spentUsd}\n`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((err) => {
    process.stderr.write(`bench M did not run: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  });
}
