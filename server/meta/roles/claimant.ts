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
// - D18 = A: the prompt shows the finding's place (file, line range, kind) and the numbered code
//   lines only, never the Investigator's claim sentence or any other model's rationale.

import { nanoid } from "nanoid";
import { gate, questionsFor, renderAllowList, renderQuestions, type GateContext, type Question } from "../../../src/gate";
import { sealBet } from "../../../src/seal";
import type { AgentEvent, Bet, BetAnswer, Experiment, ExperimentShape, Finding, Target } from "../../../src/types";
import { chat as realChat, type ChatArgs, type ChatMessage, type ChatResult, type Usage } from "../client";
import { claimantOutputSchema, zodReason, type ClaimantBetOut } from "../schemas";
import type { RefusalRecord } from "../../proofs/refusals";
import { oneLine } from "../../log/agentlog";
import { FIXTURE_FINDING_ID, FIXTURE_FINDING_LABEL, fixtureContextRange } from "./fixture-finding";
import { plural } from "../../../src/words";

export const CLAIMANT_MODEL = "muse-spark-1.3";

/** The system preamble every Meta role gets. */
export const SYSTEM_PREAMBLE =
  "You propose. You never decide. Plain code will run the code and judge. Say 'unknown' instead of guessing. Return only JSON matching the schema.";

/** Lines of context shown above and below the finding (when no wider context range is given). */
export const CONTEXT_LINES = 20;

/**
 * The plain instruction on which experiment to pick. The model is asked for the experiment it is
 * least sure about, not the easiest to predict, so the bets test something a reader could get
 * wrong. It says nothing about which experiment or what result that is.
 */
export const PICK_INSTRUCTION =
  "Pick ONE allowed experiment that tests the finding. Choose the experiment whose result you are LEAST sure about: the one most likely to surprise a reader of this code. Do not choose the experiment that is easiest to predict.";

export interface ClaimantInput {
  target: Target;
  finding: Finding;
  /** The text of finding.file, exactly as Atlas read it. */
  fileText: string;
  /** What the gate allows on this target (shapes, touched markets). */
  gateContext: GateContext;
  /** Shown beside the finding in the prompt (for the hand-written fixture finding). */
  findingLabel?: string;
  /**
   * Lines of the file to show, when wider than the finding ±CONTEXT_LINES (always widened to cover
   * the finding's own lines). Defaults to the whole verbatim block for the fixture finding.
   */
  contextRange?: { from: number; to: number };
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

export function numbered(fileText: string, from: number, to: number): string {
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

/**
 * Which lines the Claimant sees: the given range, else the fixture's verbatim block for the fixture
 * finding, else the finding ±CONTEXT_LINES. Always widened to include the finding's own lines.
 */
export function contextRangeFor(input: Pick<ClaimantInput, "finding" | "fileText" | "contextRange">): { from: number; to: number } {
  const f = input.finding;
  const given = input.contextRange ?? (f.id === FIXTURE_FINDING_ID ? fixtureContextRange(input.fileText) : undefined);
  if (!given) return { from: Math.max(1, f.lineStart - CONTEXT_LINES), to: f.lineEnd + CONTEXT_LINES };
  return { from: Math.min(given.from, f.lineStart), to: Math.max(given.to, f.lineEnd) };
}

export function buildClaimantMessages(input: ClaimantInput): ChatMessage[] {
  const f = input.finding;
  const lineCount = input.fileText.split("\n").length;
  const range = contextRangeFor(input);
  const from = Math.max(1, range.from);
  const to = Math.min(range.to, lineCount);
  const qs = questionsByShape(input.gateContext)
    .map((x) => `For shape "${x.shape}" (one bet per question, in this order):\n${renderQuestions(x.questions)}`)
    .join("\n\n");
  const user = [
    `FINDING${input.findingLabel ? ` (${input.findingLabel})` : ""}`,
    `file: ${f.file}, lines ${f.lineStart}-${f.lineEnd}, kind: ${f.kind}`,
    "",
    `CODE (${f.file}, lines ${from}-${to}):`,
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
    PICK_INSTRUCTION,
    "Then bet on what its run will measure:",
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
  | { ok: false; error: string; safe: string; gateRejection?: { params: unknown; reason: string } };

/** A zod error with paths and issue kinds only (no values): safe to log before the run. */
export function zodSafeReason(err: { issues: readonly { path: readonly PropertyKey[]; code: string }[] }): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.map(String).join(".") : "answer"}: ${i.code.replace(/_/g, " ")}`)
    .join("; ");
}

/**
 * Why an answer does not fit its question, twice: `full` quotes the model's value (it goes back to
 * the model in the repair message and stays on the server); `safe` names only the KIND of problem,
 * never the value, so it may go into the agent log and API answers before the run (S2).
 */
export interface AnswerProblem {
  full: string;
  safe: string;
}

function checkAnswer(q: Question, a: BetAnswer): AnswerProblem | undefined {
  const on = `bet on "${q.measures}"`;
  if (a.kind === "declined") return undefined;
  if (a.kind !== q.kind) return { full: `${on} must be kind "${q.kind}" (or "declined"); got "${a.kind}"`, safe: `${on}: the answer is not of the question's kind` };
  switch (a.kind) {
    case "integer":
      if (!Number.isSafeInteger(a.value) || a.value < 0) return { full: `${on} must be a whole number of 0 or more; got ${a.value}`, safe: `${on}: ${q.measures} must be a whole number` };
      return undefined;
    case "number":
      if (!Number.isFinite(a.value)) return { full: `${on} must be a finite number`, safe: `${on}: ${q.measures} must be a finite number` };
      if (a.unit !== q.unit) return { full: `${on} must have unit "${q.unit}"; got "${a.unit}"`, safe: `${on}: the unit is not "${q.unit}"` };
      if (a.tolerancePct !== q.tolerancePct) return { full: `${on} must have tolerancePct ${q.tolerancePct}; got ${a.tolerancePct}`, safe: `${on}: the tolerance is not ${q.tolerancePct}%` };
      return undefined;
    case "enum": {
      const opts = q.options ?? [];
      if (a.options.length !== opts.length || a.options.some((o, i) => o !== opts[i])) {
        return { full: `${on} must have options ${JSON.stringify(opts)}`, safe: `${on}: the options listed are not the question's options` };
      }
      if (!opts.includes(a.value)) return { full: `${on} must be one of ${opts.map((o) => `"${o}"`).join(", ")}; got "${a.value}"`, safe: `${on}: ${q.measures} not one of the options` };
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
    return { ok: false, error: "the answer is not valid JSON", safe: "the answer is not valid JSON" };
  }
  const parsed = claimantOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `the answer does not match the schema (${zodReason(parsed.error)})`, safe: `the answer does not match the schema (${zodSafeReason(parsed.error)})` };
  const out = parsed.data;

  const decision = gate(out.experiment, ctx);
  if (!decision.allowed) {
    return { ok: false, error: `gate: rejected (${decision.reason})`, safe: "gate: rejected the experiment", gateRejection: { params: out.experiment, reason: decision.reason } };
  }
  const questions = questionsFor(decision.params, ctx);
  if (questions.length === 0) {
    const why = `no questions exist for shape "${decision.params.shape}"; pick a shape that has questions`;
    return { ok: false, error: why, safe: why };
  }

  const checked = validateBetsFor(questions, out.bets);
  if (!checked.ok) return checked;
  return { ok: true, params: decision.params, questions, bets: checked.bets };
}

/**
 * The bet checks both modes share: exactly one bet per plain-code question, nothing extra, and each
 * answer of the question's kind (with its exact unit, tolerance and options). Pure.
 */
export function validateBetsFor(
  questions: readonly Question[],
  modelBets: readonly ClaimantBetOut[],
): { ok: true; bets: { question: Question; out: ClaimantBetOut }[] } | { ok: false; error: string; safe: string } {
  const wanted = new Set(questions.map((q) => q.measures));
  const byField = new Map<string, ClaimantBetOut>();
  for (const b of modelBets) {
    if (byField.has(b.measures)) {
      // A field name the model invented is its own text: named only when it is one of the questions.
      const named = wanted.has(b.measures) ? `"${b.measures}"` : "the same field";
      return { ok: false, error: `two bets on "${b.measures}"; place exactly one per question`, safe: `two bets on ${named}; place exactly one per question` };
    }
    byField.set(b.measures, b);
  }
  const extra = modelBets.filter((b) => !wanted.has(b.measures)).map((b) => b.measures);
  if (extra.length) {
    return {
      ok: false,
      error: `bets on ${extra.map((m) => `"${m}"`).join(", ")} answer no question; the questions measure ${[...wanted].map((m) => `"${m}"`).join(", ")}`,
      safe: `a bet answers no question; the questions measure ${[...wanted].map((m) => `"${m}"`).join(", ")}`,
    };
  }
  const missing = questions.filter((q) => !byField.has(q.measures)).map((q) => q.measures);
  if (missing.length) {
    const why = `no bet on ${missing.map((m) => `"${m}"`).join(", ")}; place exactly one bet per question`;
    return { ok: false, error: why, safe: why };
  }

  const bets: { question: Question; out: ClaimantBetOut }[] = [];
  for (const q of questions) {
    const b = byField.get(q.measures)!;
    const why = checkAnswer(q, b.answer as BetAnswer);
    if (why) return { ok: false, error: why.full, safe: why.safe };
    bets.push({ question: q, out: b });
  }
  return { ok: true, bets };
}

// ---------- the role ----------

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
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

/** Usage written on a log line when the call reported none: zero tokens, and the line says the cost is unknown. */
export const NO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, usd: 0 };
export const COST_UNKNOWN = "cost unknown: the call reported no usage";

export async function runClaimant(input: ClaimantInput, deps: ClaimantDeps = {}): Promise<ClaimantResult> {
  const chat = deps.chat ?? realChat;
  const emitRaw = deps.emit ?? (() => {});
  const onRefusal = deps.onRefusal ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const model = input.model ?? CLAIMANT_MODEL;
  // Every line is one short line (oneLine), every claimant line carries the model AND its usage,
  // and plain-code lines (gate, seal) carry no model: the shape the real agent log demands (S8).
  // A log that still refuses a line never stops the role: the result is returned either way.
  const emit = (event: AgentEvent) => {
    try {
      emitRaw({ ...event, action: oneLine(event.action) });
    } catch {
      // The log refused the line; the role's answer still stands.
    }
  };
  const sayModel = (action: string, callUsage: Usage | undefined, ref?: AgentEvent["ref"]) =>
    emit({ t: now().toISOString(), role: "claimant", model, action: callUsage ? action : `${action} (${COST_UNKNOWN})`, usage: callUsage ?? NO_USAGE, ...(ref ? { ref } : {}) });
  const sayPlain = (role: "gate" | "seal", action: string, ref?: AgentEvent["ref"]) => emit({ t: now().toISOString(), role, action, ...(ref ? { ref } : {}) });

  const rejected: Experiment[] = [];
  const attempts: ClaimantAttempt[] = [];
  let usage: Usage | undefined;
  const fail = (reason: string, logReason: string, callUsage?: Usage): ClaimantResult => {
    sayModel(`no usable answer (${logReason})`, callUsage);
    return { ok: false, reason, rejected, attempts, ...(usage ? { usage } : {}) };
  };

  if (!input.finding.verified) {
    const why = "the finding is not verified against the file, so no experiment is proposed for it";
    return fail(why, why);
  }

  const messages = buildClaimantMessages({ ...input, findingLabel: input.findingLabel ?? FIXTURE_FINDING_LABEL });
  let lastError = "";
  let lastSafe = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ role: "claimant", model, messages: [...messages], json: true });
    usage = addUsage(usage, res.usage);
    if (!res.ok) {
      attempts.push({ content: null, error: res.reason, ...(res.usage ? { usage: res.usage } : {}) });
      return fail(`the model call failed: ${res.reason}`, `the model call failed: ${res.reason}`, res.usage);
    }
    const v = validateClaimantOutput(res.content, input.gateContext);
    attempts.push({ content: res.content, finishReason: res.finishReason, usage: res.usage, ...(v.ok ? {} : { error: v.error }) });

    if (v.ok) {
      sayModel(`proposes ${v.params.shape}`, res.usage);
      const experiment: Experiment = {
        id: nanoid(10),
        target: input.target,
        runner: input.target.kind === "github-pr" ? "evm" : "ts",
        params: v.params,
        proposedBy: { role: "claimant", model },
        gate: { allowed: true },
      };
      sayPlain("gate", "allowed", { kind: "experiment", id: experiment.id });
      const sealedAt = now();
      const bets = v.bets.map(({ question, out }) =>
        sealBet({ experimentId: experiment.id, who: `model:${model}`, question: question.text, measures: question.measures, answer: out.answer as BetAnswer, rationale: out.rationale }, sealedAt),
      );
      sayPlain("seal", `seals ${plural(bets.length, "bet")} from ${model}`, { kind: "experiment", id: experiment.id });
      for (const b of bets) {
        if (b.answer.kind === "declined") {
          onRefusal({ kind: "declined_bet", id: b.id, time: b.sealedAt, role: "claimant", model, experiment: v.params, reason: b.answer.reason, measures: b.measures, question: b.question });
        }
      }
      return { ok: true, experiment, bets, questions: v.questions, rejected, attempts, ...(usage ? { usage } : {}) };
    }

    // The log line names only the kind of problem, never the model's values (S2).
    sayModel(`answers (not usable: ${v.safe})`, res.usage);
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
      sayPlain("gate", `rejected (${v.gateRejection.reason})`, { kind: "experiment", id: exp.id });
      onRefusal({ kind: "gate_rejection", id: exp.id, time: now().toISOString(), role: "claimant", model, experiment: v.gateRejection.params, reason: v.gateRejection.reason });
    }
    lastError = v.error;
    lastSafe = v.safe;
    messages.push({ role: "assistant", content: res.content }, { role: "user", content: repairMessage(v.error) });
  }
  return fail(lastError, lastSafe);
}
