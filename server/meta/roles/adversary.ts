// The Adversary, "what else?" (D07-02): after a round has run, a Meta model (muse-spark-1.3) reads the
// finding's code lines and what the run measured, and proposes ONE more experiment on the same target.
//
// Plain words on who decides what:
// - The model proposes. src/gate.ts decides whether the experiment may run. Plain code (src/experiment-name.ts)
//   decides whether it is the same experiment as one already run on this target; a repeat is refused.
// - What the model sees (D18): the finding's place (file, line range, kind) and the numbered code lines,
//   never the Investigator's claim sentence and never any bettor's rationale or answer. It also sees what
//   the LAST RUN measured, its trace (at most 200 events) and the verdicts' outcomes: the run is over, so
//   its values are no longer secret. And the gate's allow-list as text, plus the experiments already run.
// - The answer is checked in steps: JSON parse → zod schema → gate → the shape has plain-code questions →
//   not already run. On any failure the model gets ONE repair try with the error appended. A second
//   failure gives { ok: false, reason }. Nothing is invented to fill the gap.
// - A gate refusal is a real refusal: it is kept (returned in `rejected`), written to the agent log as a
//   plain-code gate line, and passed to onRefusal (the live server writes proofs/refusals/).
// - The model's "why" sentence is model-panel text only. It never goes into a log line, a refusal record,
//   an experiment name or anything Atlas says in its own voice. On screen the experiment is named by
//   src/experiment-name.ts from its params (shape id + values), never by the model's words.
// - Log lines before the gate never quote the model's raw values: a gate reason is shown with every quoted
//   word that is not one of the gate's own words replaced (safeGateReason). The full reason stays in the
//   refusal record and the result, where it is labelled as the gate's answer to the model's proposal.

import { nanoid } from "nanoid";
import { ALL_SHAPES, SHAPES, gate, questionsFor, renderAllowList, type GateContext } from "../../../src/gate";
import { alreadyRan, experimentName, type FunctionDefaults } from "../../../src/experiment-name";
import type { ExperimentShape, Finding, Run, Target, Verdict } from "../../../src/types";
import { chat as realChat, type ChatArgs, type ChatMessage, type ChatResult, type Usage } from "../client";
import { adversaryOutputSchema, zodReason } from "../schemas";
import type { RefusalRecord } from "../../proofs/refusals";
import { oneLine, type SessionEmitter } from "../../log/agentlog";
import { COST_UNKNOWN, NO_USAGE, SYSTEM_PREAMBLE, addUsage, contextRangeFor, numbered, repairMessage, zodSafeReason, type ClaimantAttempt } from "./claimant";

export const ADVERSARY_MODEL = "muse-spark-1.3";

/** The most trace events the Adversary is shown (the plan's limit). */
export const MAX_TRACE_EVENTS = 200;
/** One trace event as JSON is cut at this many characters, so one large event cannot fill the prompt. */
export const MAX_TRACE_EVENT_CHARS = 400;

export const ADVERSARY_TASK =
  "Propose ONE more allowed experiment on this same code that has NOT been run on this target yet. Choose the one whose result would tell a reader of this code the most that the runs so far did not show. You do not bet; plain code will run it and others will bet on it.";

export interface AdversaryInput {
  target: Target;
  finding: Finding;
  /** The text of finding.file, exactly as Atlas read it. */
  fileText: string;
  contextRange?: { from: number; to: number };
  /** The round that just ran: its experiment and its run. */
  lastExperiment: ExperimentShape;
  lastRun: Pick<Run, "id" | "runner" | "controlPassed" | "trace" | "result" | "forkBlock">;
  /** The verdicts of that run (outcomes, observed values and plain-code reasons only are shown). */
  verdicts: readonly Pick<Verdict, "outcome" | "observed" | "reason" | "betId">[];
  /** Which field each verdict's bet measured, by bet id (plain code's field names). */
  measuresOf: Readonly<Record<string, string>>;
  /** Every experiment already run on this target (the dedupe list; also shown to the model). */
  alreadyRun: readonly ExperimentShape[];
  gateContext: GateContext;
  /** The function's defaults read from the target's code (src/experiment-name.ts functionDefaults), for the repeat check. */
  functionDefaults?: FunctionDefaults;
  model?: string;
}

export interface AdversaryDeps {
  chat?: (args: ChatArgs) => Promise<ChatResult>;
  /** The session's agent log. Adversary lines go through log.model(); gate lines through log.emit(). */
  log?: Pick<SessionEmitter, "emit" | "model">;
  /** Called for each gate refusal. Pass a writer ONLY for real live calls. */
  onRefusal?: (record: RefusalRecord) => void;
  now?: () => Date;
}

/** A proposal the gate refused: its params as proposed (model data), the gate's full reason, and the screen-safe reason. */
export interface AdversaryRejection {
  id: string;
  params: unknown;
  reason: string;
  safeReason: string;
}

export type AdversaryResult =
  | {
      ok: true;
      model: string;
      /** The gate-checked params (a fresh copy from src/gate.ts). */
      params: ExperimentShape;
      /** The on-screen name: shape id + params, by plain code. */
      name: string;
      /** The model's own sentence. Model panel only. */
      why: string;
      rejected: AdversaryRejection[];
      attempts: ClaimantAttempt[];
      usage?: Usage;
    }
  | { ok: false; model: string; reason: string; detail: string; rejected: AdversaryRejection[]; attempts: ClaimantAttempt[]; usage?: Usage };

// ---------- the prompt ----------

/** The shapes on this target that have plain-code questions (only those can be bet on and judged). */
export function judgeableShapes(ctx: GateContext): string[] {
  const out: string[] = [];
  for (const s of ctx.shapes ?? ALL_SHAPES) {
    const sample: ExperimentShape | undefined =
      s === "retry-scenario"
        ? { shape: s, failTimes: 0, failure: "error" }
        : s === "concurrency-sweep"
          ? { shape: s, callers: 1, failTimes: 0, failure: "error" }
          : s === "price-read" || s === "apply-proposal-then-read"
            ? (ctx.touchedMarkets ?? []).length > 0
              ? { shape: s, markets: [ctx.touchedMarkets![0]!] }
              : undefined
            : undefined;
    if (sample && questionsFor(sample, ctx).length > 0) out.push(s);
  }
  return out;
}

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function buildAdversaryMessages(input: AdversaryInput): ChatMessage[] {
  const f = input.finding;
  const lineCount = input.fileText.split("\n").length;
  const range = contextRangeFor(input);
  const from = Math.max(1, range.from);
  const to = Math.min(range.to, lineCount);
  const run = input.lastRun;
  const trace = run.trace.slice(0, MAX_TRACE_EVENTS).map((e) => cut(JSON.stringify(e), MAX_TRACE_EVENT_CHARS));
  const verdicts = input.verdicts.map((v) => {
    const said = v.outcome === "matched" ? "matched" : v.outcome === "not_matched" ? "didn't match" : "can't check";
    const observed = v.observed === undefined ? "" : `, observed ${JSON.stringify(v.observed)}`;
    // v.reason is plain code's (src/judge.ts); a declined bet's own words are never here.
    return `- bet on "${input.measuresOf[v.betId] ?? "unknown field"}": ${said}${observed}${v.outcome === "cant_check" && v.reason ? ` (${v.reason})` : ""}`;
  });
  const judgeable = judgeableShapes(input.gateContext);
  const user = [
    "FINDING",
    `file: ${f.file}, lines ${f.lineStart}-${f.lineEnd}, kind: ${f.kind}`,
    "",
    `CODE (${f.file}, lines ${from}-${to}):`,
    numbered(input.fileText, from, to),
    "",
    "THE LAST RUN (already finished; its values are shown)",
    `experiment: ${JSON.stringify(input.lastExperiment)}`,
    `runner: ${run.runner}${run.forkBlock !== undefined ? `, fork block ${run.forkBlock}` : ""}; known-case control ${run.controlPassed ? "passed" : "did not pass"}`,
    `measured: ${JSON.stringify(run.result.measured)}`,
    `not measured: ${JSON.stringify(run.result.notMeasured)}`,
    ...(run.result.references ? [`references: ${JSON.stringify(run.result.references)}`] : []),
    `trace (${trace.length} of ${run.trace.length} events${run.trace.length > MAX_TRACE_EVENTS ? `; only the first ${MAX_TRACE_EVENTS} are shown` : ""}):`,
    ...trace,
    "",
    "VERDICTS OF THE LAST RUN (by plain code)",
    ...(verdicts.length ? verdicts : ["- no bets were judged"]),
    "",
    "EXPERIMENTS ALREADY RUN ON THIS TARGET (do not propose any of these again)",
    ...input.alreadyRun.map((p) => `- ${JSON.stringify(p)}`),
    "",
    "EXPERIMENTS",
    renderAllowList(input.gateContext),
    `Only these shapes can be bet on and judged here, so propose one of them: ${judgeable.join(", ") || "(none)"}.`,
    "Fields you leave out use the code's own defaults.",
    "",
    "TASK",
    ADVERSARY_TASK,
    'Then say in one or two sentences what its run could show ("why").',
    "",
    "Return only this JSON object:",
    '{"experiment": {"shape": "...", ...fields}, "why": "<one or two sentences>"}',
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PREAMBLE },
    { role: "user", content: user },
  ];
}

// ---------- validation ----------

/** Every word the gate itself uses: shape ids, field names, enum options, the target's markets, "always", "touched". */
function gateWords(ctx: GateContext): Set<string> {
  const words = new Set<string>(["always", "touched", "shape", ...ALL_SHAPES, ...(ctx.touchedMarkets ?? [])]);
  for (const spec of Object.values(SHAPES)) {
    for (const [name, fs] of [...Object.entries(spec.required), ...Object.entries(spec.optional)]) {
      words.add(name);
      if (fs.kind === "enum") for (const o of fs.options) words.add(o);
    }
  }
  return words;
}

/** What replaces a model's own text in a gate reason shown on screen or in the log. */
export const MODEL_VALUE_PLACEHOLDER = "(a value the model wrote)";

/**
 * The gate's reason with every quoted text that is not one of the gate's own words replaced by
 * MODEL_VALUE_PLACEHOLDER. Safe to put in a log line or on screen: no model text survives.
 * src/gate.ts quotes every text value it repeats (JSON.stringify, cut at 60 characters with "..."),
 * so an opening quote with no closing quote is a cut value: everything after it is replaced too.
 */
export function safeGateReason(reason: string, ctx: GateContext): string {
  const words = gateWords(ctx);
  let out = "";
  let i = 0;
  while (i < reason.length) {
    const c = reason[i]!;
    if (c !== '"') {
      out += c;
      i++;
      continue;
    }
    let j = i + 1;
    let inner = "";
    while (j < reason.length && reason[j] !== '"') {
      if (reason[j] === "\\") {
        inner += reason[j]! + (reason[j + 1] ?? "");
        j += 2;
      } else {
        inner += reason[j]!;
        j++;
      }
    }
    if (j >= reason.length) {
      out += MODEL_VALUE_PLACEHOLDER; // a cut value: nothing after its opening quote is kept
      break;
    }
    out += words.has(inner) ? `"${inner}"` : MODEL_VALUE_PLACEHOLDER;
    i = j + 1;
  }
  return out;
}

export type AdversaryValidation =
  | { ok: true; params: ExperimentShape; why: string }
  | { ok: false; error: string; safe: string; gateRejection?: { params: unknown; reason: string }; duplicate?: ExperimentShape };

/** Parse → schema → gate → has questions → not already run. Pure. */
export function validateAdversaryOutput(content: string, ctx: GateContext, alreadyRun: readonly ExperimentShape[], fn: FunctionDefaults = {}): AdversaryValidation {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: "the answer is not valid JSON", safe: "the answer is not valid JSON" };
  }
  const parsed = adversaryOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `the answer does not match the schema (${zodReason(parsed.error)})`, safe: `the answer does not match the schema (${zodSafeReason(parsed.error)})` };
  const decision = gate(parsed.data.experiment, ctx);
  if (!decision.allowed) {
    return { ok: false, error: `gate: rejected (${decision.reason})`, safe: "gate: rejected the experiment", gateRejection: { params: parsed.data.experiment, reason: decision.reason } };
  }
  if (questionsFor(decision.params, ctx).length === 0) {
    const why = `no plain-code questions exist for shape "${decision.params.shape}", so nobody could bet on it; pick one of: ${judgeableShapes(ctx).join(", ")}`;
    return { ok: false, error: why, safe: why };
  }
  if (alreadyRan(decision.params, alreadyRun, ctx, fn)) {
    const why = `this experiment already ran on this target (${experimentName(decision.params)}); propose one that has not`;
    return { ok: false, error: why, safe: why, duplicate: decision.params };
  }
  return { ok: true, params: decision.params, why: parsed.data.why };
}

// ---------- the role ----------

export async function runAdversary(input: AdversaryInput, deps: AdversaryDeps = {}): Promise<AdversaryResult> {
  const chat = deps.chat ?? realChat;
  const now = deps.now ?? (() => new Date());
  const onRefusal = deps.onRefusal ?? (() => {});
  const model = input.model ?? ADVERSARY_MODEL;
  const rejected: AdversaryRejection[] = [];
  const attempts: ClaimantAttempt[] = [];
  let usage: Usage | undefined;

  // A log line the log refuses never stops the role.
  const tryLog = (fn: () => void) => {
    try {
      fn();
    } catch {
      // the answer still stands
    }
  };
  const sayModel = (action: string, callUsage: Usage | undefined, ref?: { kind: "experiment"; id: string }) =>
    tryLog(() => deps.log?.model({ role: "adversary", model, action: oneLine(callUsage ? action : `${action} (${COST_UNKNOWN})`), usage: callUsage ?? NO_USAGE, ...(ref ? { ref } : {}) }));
  const sayGate = (action: string, ref?: { kind: "experiment"; id: string }) => tryLog(() => deps.log?.emit({ role: "gate", action: oneLine(action), ...(ref ? { ref } : {}) }));
  /** `afterLoggedCall`: every call's cost is already on its own line, so this summary line costs nothing more. */
  const fail = (reason: string, detail: string, callUsage?: Usage, afterLoggedCall = false): AdversaryResult => {
    if (afterLoggedCall) tryLog(() => deps.log?.model({ role: "adversary", model, action: oneLine(`no usable answer (${reason})`), usage: NO_USAGE }));
    else sayModel(`no usable answer (${reason})`, callUsage);
    return { ok: false, model, reason, detail, rejected, attempts, ...(usage ? { usage } : {}) };
  };

  if (!input.finding.verified) return fail("the finding is not verified against the file", "the finding is not verified against the file");

  const messages = buildAdversaryMessages(input);
  let lastSafe = "";
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await chat({ role: "adversary", model, messages: [...messages], json: true });
    usage = addUsage(usage, res.usage);
    if (!res.ok) {
      attempts.push({ content: null, error: res.reason, ...(res.usage ? { usage: res.usage } : {}) });
      return fail(`the model call failed: ${res.reason}`, `the model call failed: ${res.reason}`, res.usage);
    }
    const v = validateAdversaryOutput(res.content, input.gateContext, input.alreadyRun, input.functionDefaults ?? {});
    attempts.push({ content: res.content, finishReason: res.finishReason, usage: res.usage, ...(v.ok ? {} : { error: v.error }) });
    if (v.ok) {
      sayModel(`proposes ${experimentName(v.params)}`, res.usage);
      sayGate("allowed (src/gate.ts)");
      return { ok: true, model, params: v.params, name: experimentName(v.params), why: v.why, rejected, attempts, ...(usage ? { usage } : {}) };
    }
    const repairNote = attempt === 0 ? "; one repair try" : "";
    if (v.gateRejection) {
      const id = nanoid(10);
      const safeReason = safeGateReason(v.gateRejection.reason, input.gateContext);
      rejected.push({ id, params: v.gateRejection.params, reason: v.gateRejection.reason, safeReason });
      sayModel(`proposes an experiment${repairNote}`, res.usage, { kind: "experiment", id });
      sayGate(`rejected (${safeReason})`, { kind: "experiment", id });
      onRefusal({
        kind: "gate_rejection",
        id,
        experimentId: id,
        time: now().toISOString(),
        role: "adversary",
        model,
        trigger: `POST /adversary: the gate refused the Adversary's proposed experiment (attempt ${attempt + 1} of 2), so it never ran`,
        experiment: v.gateRejection.params,
        reason: v.gateRejection.reason,
      });
    } else if (v.duplicate) {
      sayModel(`proposes ${experimentName(v.duplicate)}${repairNote}`, res.usage);
      sayGate(`allowed, then refused by the repeat check: ${experimentName(v.duplicate)} already ran on this target`);
    } else {
      sayModel(`answers (not usable: ${v.safe})${repairNote}`, res.usage);
    }
    lastSafe = v.safe;
    lastError = v.error;
    if (attempt === 0) messages.push({ role: "assistant", content: res.content }, { role: "user", content: repairMessage(v.error) });
  }
  return fail(lastSafe, lastError, undefined, true);
}

