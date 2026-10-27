// The Claimant: a Meta model (muse-spark-1.3) reads one finding and proposes one experiment,
// then places one bet per plain-code question about what that experiment's run will show.
//
// Plain words on who decides what:
// - The model proposes. src/gate.ts decides whether the experiment may run. The questions come
//   from src/gate.ts too (plain code), never from the model.
// - The answer is checked in three steps: JSON parse → zod schema (server/meta/schemas.ts) →
//   meaning checks (gate, one bet per question, answer kind and unit match the question).
// - On any failure the model gets ONE repair try with the error appended. A second failure gives
//   { ok: false, reason }. Nothing is invented to fill a gap.
// - A gate refusal of the model's experiment is kept (returned in `rejected`, emitted, and passed to
//   onRefusal) even when the repair then succeeds.
// - Sealing (src/seal.ts) happens after validation. The model never sees a nonce or a hash.

import { nanoid } from "nanoid";
import { gate, questionsFor, renderAllowList, renderQuestions, type GateContext, type Question } from "../../../src/gate";
import { sealBet } from "../../../src/seal";
import type { AgentEvent, Bet, BetAnswer, Experiment, ExperimentShape, Finding, Target } from "../../../src/types";
import { chat as realChat, type ChatArgs, type ChatMessage, type ChatResult, type Usage } from "../client";
import { claimantOutputSchema, zodReason, type ClaimantBetOut } from "../schemas";
import type { RefusalRecord } from "../../proofs/refusals";
import { FIXTURE_FINDING_LABEL } from "./fixture-finding";

export const CLAIMANT_MODEL = "muse-spark-1.3";

/** The system preamble every Meta role gets. */
export const SYSTEM_PREAMBLE =
  "You propose. You never decide. Plain code will run the code and judge. Say 'unknown' instead of guessing. Return only JSON matching the schema.";

/** Lines of context shown above and below the finding. */
export const CONTEXT_LINES = 20;

export interface ClaimantInput {
  target: Target;
  finding: Finding;
  /** The text of finding.file, exactly as Atlas read it. */
  fileText: string;
  /** What the gate allows on this target (shapes, touched markets). */
  gateContext: GateContext;
  /** Shown beside the finding in the prompt (for the hand-written fixture finding). */
  findingLabel?: string;
  model?: string;
}

export interface ClaimantDeps {
  chat?: (args: ChatArgs) => Promise<ChatResult>;
  /** Log-strip events. Defaults to doing nothing. */
  emit?: (event: AgentEvent) => void;
  /** Called for each gate refusal and each declined bet. Pass a writer ONLY for real live calls. */
  onRefusal?: (record: RefusalRecord) => void;
  now?: () => Date;
}

/** One model call: what came back, and why it was not usable (if it was not). */
export interface ClaimantAttempt {
  content: string | null;
  finishReason?: string;
  usage?: Usage;
  error?: string;
}

export type ClaimantResult =
  | {
      ok: true;
      experiment: Experiment;
      bets: Bet[];
      questions: Question[];
      /** Experiments the gate refused on the way (kept, never run). */
      rejected: Experiment[];
      attempts: ClaimantAttempt[];
      usage?: Usage;
    }
  | { ok: false; reason: string; rejected: Experiment[]; attempts: ClaimantAttempt[]; usage?: Usage };

// ---------- the prompt ----------

function numbered(fileText: string, from: number, to: number): string {
  const lines = fileText.split("\n");
  const end = Math.min(to, lines.length);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = Math.max(1, from); n <= end; n++) out.push(`${String(n).padStart(width)}| ${lines[n - 1]}`);
  return out.join("\n");
}

/** Questions per allowed shape, as text. Only shapes with questions are offered to the model. */
function questionsByShape(ctx: GateContext): { shape: string; questions: Question[] }[] {
  const shapes = ctx.shapes ?? [];
  const out: { shape: string; questions: Question[] }[] = [];
  for (const s of shapes) {
    // The questions for a retry-scenario do not depend on its numbers, so any allowed instance shows them.
    if (s === "retry-scenario") out.push({ shape: s, questions: questionsFor({ shape: s, failTimes: 0, failure: "error" }, ctx) });
    if (s === "apply-proposal-then-read") out.push({ shape: s, questions: questionsFor({ shape: s, markets: "touched" }, ctx) });
    if (s === "price-read" && (ctx.touchedMarkets ?? []).length > 0) {
      out.push({ shape: s, questions: questionsFor({ shape: s, markets: [...ctx.touchedMarkets!] }, ctx) });
    }
  }
  return out;
}

export function buildClaimantMessages(input: ClaimantInput): ChatMessage[] {
  const f = input.finding;
  const from = Math.max(1, f.lineStart - CONTEXT_LINES);
  const to = f.lineEnd + CONTEXT_LINES;
  const qs = questionsByShape(input.gateContext)
    .map((x) => `For shape "${x.shape}" (one bet per question, in this order):\n${renderQuestions(x.questions)}`)
    .join("\n\n");
  const user = [
    `FINDING${input.findingLabel ? ` (${input.findingLabel})` : ""}`,
    `file: ${f.file}, lines ${f.lineStart}-${f.lineEnd}, kind: ${f.kind}`,
    `claim: ${f.claim}`,
    "",
    `CODE (${f.file}, lines ${from}-${Math.min(to, input.fileText.split("\n").length)}):`,
    numbered(input.fileText, from, to),
    "",
    "EXPERIMENTS",
    renderAllowList(input.gateContext),
    "Fields you leave out use the code's own defaults.",
    "",
    "QUESTIONS (written by plain code; a person answers the same ones)",
    qs,
    "",
    "TASK",
    "Pick ONE allowed experiment that tests the finding. Then bet on what its run will measure:",
    "exactly one bet per question of the shape you picked, using the answer JSON shown for it.",
    'If you do not know an answer, bet {"kind":"declined","reason":"unknown: <why>"} instead of guessing.',
    "",
    "Return only this JSON object:",
    '{"experiment": {"shape": "...", ...fields}, "bets": [{"measures": "<field>", "answer": {...}, "rationale": "<one or two sentences>"}]}',
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PREAMBLE },
    { role: "user", content: user },
  ];
}

export const repairMessage = (error: string): string => `Your previous answer failed: ${error}. Return only the JSON.`;

// ---------- validation ----------

export type Validation =
  | { ok: true; params: ExperimentShape; questions: Question[]; bets: { question: Question; out: ClaimantBetOut }[] }
  | { ok: false; error: string; gateRejection?: { params: unknown; reason: string } };

function checkAnswer(q: Question, a: BetAnswer): string | undefined {
  if (a.kind === "declined") return undefined;
  if (a.kind !== q.kind) return `bet on "${q.measures}" must be kind "${q.kind}" (or "declined"); got "${a.kind}"`;
  switch (a.kind) {
    case "integer":
      if (!Number.isSafeInteger(a.value) || a.value < 0) return `bet on "${q.measures}" must be a whole number of 0 or more; got ${a.value}`;
      return undefined;
    case "number":
      if (!Number.isFinite(a.value)) return `bet on "${q.measures}" must be a finite number`;
      if (a.unit !== q.unit) return `bet on "${q.measures}" must have unit "${q.unit}"; got "${a.unit}"`;
      if (a.tolerancePct !== q.tolerancePct) return `bet on "${q.measures}" must have tolerancePct ${q.tolerancePct}; got ${a.tolerancePct}`;
      return undefined;
    case "enum": {
      const opts = q.options ?? [];
      if (a.options.length !== opts.length || a.options.some((o, i) => o !== opts[i])) {
        return `bet on "${q.measures}" must have options ${JSON.stringify(opts)}`;
      }
      if (!opts.includes(a.value)) return `bet on "${q.measures}" must be one of ${opts.map((o) => `"${o}"`).join(", ")}; got "${a.value}"`;
      return undefined;
    }
  }
}

/** Parse → schema → gate → one bet per question with the right kind and unit. Pure. */
export function validateClaimantOutput(content: string, ctx: GateContext): Validation {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: "the answer is not valid JSON" };
  }
  const parsed = claimantOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `the answer does not match the schema (${zodReason(parsed.error)})` };
  const out = parsed.data;

  const decision = gate(out.experiment, ctx);
  if (!decision.allowed) {
    return { ok: false, error: `gate: rejected (${decision.reason})`, gateRejection: { params: out.experiment, reason: decision.reason } };
  }
  const questions = questionsFor(decision.params, ctx);
  if (questions.length === 0) return { ok: false, error: `no questions exist for shape "${decision.params.shape}"; pick a shape that has questions` };

  const byField = new Map<string, ClaimantBetOut>();
  for (const b of out.bets) {
    if (byField.has(b.measures)) return { ok: false, error: `two bets on "${b.measures}"; place exactly one per question` };
    byField.set(b.measures, b);
  }
  const wanted = new Set(questions.map((q) => q.measures));
  const extra = out.bets.filter((b) => !wanted.has(b.measures)).map((b) => b.measures);
  if (extra.length) return { ok: false, error: `bets on ${extra.map((m) => `"${m}"`).join(", ")} answer no question; the questions measure ${[...wanted].map((m) => `"${m}"`).join(", ")}` };
  const missing = questions.filter((q) => !byField.has(q.measures)).map((q) => q.measures);
  if (missing.length) return { ok: false, error: `no bet on ${missing.map((m) => `"${m}"`).join(", ")}; place exactly one bet per question` };

  const bets: { question: Question; out: ClaimantBetOut }[] = [];
  for (const q of questions) {
    const b = byField.get(q.measures)!;
    const why = checkAnswer(q, b.answer as BetAnswer);
    if (why) return { ok: false, error: why };
    bets.push({ question: q, out: b });
  }
  return { ok: true, params: decision.params, questions, bets };
}

// ---------- the role ----------

function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const r = (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    ...(a.reasoningTokens !== undefined || b.reasoningTokens !== undefined ? { reasoningTokens: r } : {}),
    usd: a.usd + b.usd,
  };
}

export async function runClaimant(input: ClaimantInput, deps: ClaimantDeps = {}): Promise<ClaimantResult> {
  const chat = deps.chat ?? realChat;
  const emit = deps.emit ?? (() => {});
  const onRefusal = deps.onRefusal ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const model = input.model ?? CLAIMANT_MODEL;
  const say = (role: AgentEvent["role"], action: string, extra: Partial<AgentEvent> = {}) =>
    emit({ t: now().toISOString(), role, action, ...extra });

  const rejected: Experiment[] = [];
  const attempts: ClaimantAttempt[] = [];
  let usage: Usage | undefined;
  const fail = (reason: string): ClaimantResult => {
    say("claimant", `no usable answer (${reason})`, { model });
    return { ok: false, reason, rejected, attempts, ...(usage ? { usage } : {}) };
  };

  if (!input.finding.verified) return fail("the finding is not verified against the file, so no experiment is proposed for it");

  const messages = buildClaimantMessages({ ...input, findingLabel: input.findingLabel ?? FIXTURE_FINDING_LABEL });
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ role: "claimant", model, messages: [...messages], json: true });
    usage = addUsage(usage, res.usage);
    if (!res.ok) {
      attempts.push({ content: null, error: res.reason, ...(res.usage ? { usage: res.usage } : {}) });
      return fail(`the model call failed: ${res.reason}`);
    }
    const v = validateClaimantOutput(res.content, input.gateContext);
    attempts.push({ content: res.content, finishReason: res.finishReason, usage: res.usage, ...(v.ok ? {} : { error: v.error }) });

    if (v.ok) {
      say("claimant", `proposes ${v.params.shape}`, { model, usage: res.usage });
      const experiment: Experiment = {
        id: nanoid(10),
        target: input.target,
        runner: input.target.kind === "github-pr" ? "evm" : "ts",
        params: v.params,
        proposedBy: { role: "claimant", model },
        gate: { allowed: true },
      };
      say("gate", "allowed", { ref: { kind: "experiment", id: experiment.id } });
      const sealedAt = now();
      const bets = v.bets.map(({ question, out }) =>
        sealBet({ experimentId: experiment.id, who: `model:${model}`, question: question.text, measures: question.measures, answer: out.answer as BetAnswer, rationale: out.rationale }, sealedAt),
      );
      say("seal", `seals ${bets.length} bets from ${model}`, { model, ref: { kind: "experiment", id: experiment.id } });
      for (const b of bets) {
        if (b.answer.kind === "declined") {
          onRefusal({ kind: "declined_bet", id: b.id, time: b.sealedAt, role: "claimant", model, experiment: v.params, reason: b.answer.reason, measures: b.measures, question: b.question });
        }
      }
      return { ok: true, experiment, bets, questions: v.questions, rejected, attempts, ...(usage ? { usage } : {}) };
    }

    say("claimant", `answers (not usable: ${v.error})`, { model, usage: res.usage });
    if (v.gateRejection) {
      const exp: Experiment = {
        id: nanoid(10),
        target: input.target,
        runner: input.target.kind === "github-pr" ? "evm" : "ts",
        params: v.gateRejection.params as ExperimentShape,
        proposedBy: { role: "claimant", model },
        gate: { allowed: false, reason: v.gateRejection.reason },
      };
      rejected.push(exp);
      say("gate", `rejected (${v.gateRejection.reason})`, { ref: { kind: "experiment", id: exp.id } });
      onRefusal({ kind: "gate_rejection", id: exp.id, time: now().toISOString(), role: "claimant", model, experiment: v.gateRejection.params, reason: v.gateRejection.reason });
    }
    lastError = v.error;
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: repairMessage(v.error) });
  }
  return fail(lastError);
}
