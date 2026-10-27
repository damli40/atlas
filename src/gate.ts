// The experiment gate: the allow-list of experiments Atlas will run. Pure plain code.
//
// Plain words: a model (or a person) proposes an experiment. Before anything runs, this file
// checks it against a fixed list of shapes, each with explicit bounds. Anything else is refused
// with a plain reason: an unknown shape, a field the shape does not have, a value outside its
// bounds, a market the target does not touch. A refused experiment is kept and shown, never run.
//
// This file is also the ONE place that holds:
// - the bounds (the same table drives the checks and the text shown to the Claimant), and
// - the questions asked about each shape (filled by plain code, never by a model; a person and
//   a model see the same question).
//
// No I/O, no clock, no randomness.

import type { ArgSpec, BetAnswer, ExperimentShape, JsonValue, StandInStep } from "./types";
import { canonicalJson } from "./seal";
import { CALL_OUTCOME_OPTIONS, OUTCOME_OPTIONS, SETTLE_FIELD, STAND_IN_CALLS_PREFIX, measuredUnit, type MeasuredUnit } from "./units";

export type ShapeName = ExperimentShape["shape"];

export const ALL_SHAPES: readonly ShapeName[] = [
  "retry-scenario",
  "concurrency-sweep",
  "price-read",
  "apply-proposal-then-read",
  "liquidatable-at-price",
  "call-function",
];

/** What the gate needs to know about the target. */
export interface GateContext {
  /** The shapes this target's runner can run. Default: every shape. A shape outside this list is refused. */
  shapes?: readonly ShapeName[];
  /** Markets the target touches (EVM targets). A market outside this list is refused. Default: none. */
  touchedMarkets?: readonly string[];
  /** Shown in the rendered allow-list only: how long Atlas watches a run (virtual ms). The gate does not use it. */
  watchLimitMs?: number;
  /**
   * Added E1: the names a pasted file exports, found by plain code (src/pasted-code.ts). When set, a
   * call-function experiment may only call one of them.
   */
  exportNames?: readonly string[];
}

/**
 * D06-02: the waves screen (POST /sweeps) runs exactly one shape, "concurrency-sweep", inside its bounds
 * (1..200 callers). Separate from the round's TS context, so the Claimant is never offered a shape
 * nobody bets on.
 */
export const SWEEP_GATE_CONTEXT: GateContext = { shapes: ["concurrency-sweep"] };

export type GateDecision =
  | { allowed: true; params: ExperimentShape }
  | { allowed: false; reason: string };

// ---------- bounds (one table: checked below, rendered for the Claimant) ----------

export const BOUNDS = {
  failTimes: { min: 0, max: 10 },
  attempts: { min: 1, max: 10 },
  delayMs: { min: 0, max: 60_000 },
  resolveAfterMs: { min: 0, max: 60_000 },
  callers: { min: 1, max: 200 },
  /** A JSON value a successful fake call resolves with, at most this many characters as JSON. */
  resolvesWithChars: 1_000,
  /** A price to test liquidation at, in USD 1e18 (a whole-number string): above 0, at most $1,000,000. */
  priceUsd1e18: { min: 1n, max: 1_000_000n * 10n ** 18n },
  // ---- added E1: "call-function" ----
  /** At most this many arguments. */
  callArgs: 8,
  /** The JSON values in the args (json args and stand-in return values) together, as canonical JSON. */
  argsJsonChars: 4_096,
  /** Steps a stand-in may have. */
  standInSteps: { min: 1, max: 50 },
  /** Atlas's watch limit in virtual ms. */
  watchLimitMs: { min: 1, max: 600_000 },
  /** A stand-in step's virtual delay. */
  afterMs: { min: 0, max: 600_000 },
  /** Lengths of the names and the message a person or model may write. */
  exportNameChars: 100,
  standInNameChars: 40,
  errorNameChars: 60,
  errorMessageChars: 500,
} as const;

/** Added E1: Atlas's default watch limit for a call-function run (virtual ms), as the any-code spec says. */
export const CALL_DEFAULT_WATCH_LIMIT_MS = 30_000;

type FieldSpec =
  | { kind: "int"; min: number; max: number; orAlways?: boolean }
  | { kind: "enum"; options: readonly string[] }
  | { kind: "json"; maxChars: number }
  | { kind: "markets"; allowTouchedWord: boolean }
  | { kind: "market" }
  | { kind: "usd1e18"; min: bigint; max: bigint }
  // Added E1
  | { kind: "exportName" }
  | { kind: "callArgs" };

interface ShapeSpec {
  runner: "ts" | "evm";
  /** One line, plain words: what the experiment does. */
  does: string;
  required: Record<string, FieldSpec>;
  optional: Record<string, FieldSpec>;
  /** Plain words per field, shown in the rendered allow-list. */
  notes?: Record<string, string>;
}

const int = (b: { min: number; max: number }, orAlways = false): FieldSpec => ({ kind: "int", min: b.min, max: b.max, orAlways });

export const SHAPES: Readonly<Record<ShapeName, ShapeSpec>> = {
  "retry-scenario": {
    runner: "ts",
    does: "calls the function once; the chain read it retries is a fake that fails on its first failTimes calls, then answers",
    required: {
      failTimes: int(BOUNDS.failTimes, true),
      failure: { kind: "enum", options: ["error", "never_settles"] },
    },
    optional: {
      attempts: int(BOUNDS.attempts),
      delayMs: int(BOUNDS.delayMs),
      resolveAfterMs: int(BOUNDS.resolveAfterMs),
      errorKind: { kind: "enum", options: ["seeded", "429"] },
      resolvesWith: { kind: "json", maxChars: BOUNDS.resolvesWithChars },
    },
    notes: {
      failTimes: "how many calls fail before one answers",
      failure: "error = a failing call throws; never_settles = a failing call never answers",
      attempts: "passed to the function as opts.attempts",
      delayMs: "passed to the function as opts.delayMs",
      resolveAfterMs: "an answering call answers this many ms after it is made",
      errorKind: "seeded = varied RPC errors; 429 = an HTTP 429 error every time",
      resolvesWith: "the value an answering call returns",
    },
  },
  "concurrency-sweep": {
    runner: "ts",
    does: "runs many callers at once against the same failing fake chain read",
    required: {
      callers: int(BOUNDS.callers),
      failTimes: int(BOUNDS.failTimes, true),
      failure: { kind: "enum", options: ["error"] },
    },
    optional: { delayMs: int(BOUNDS.delayMs) },
  },
  "price-read": {
    runner: "evm",
    does: "reads the oracle price of each market at the fork block",
    required: { markets: { kind: "markets", allowTouchedWord: false } },
    optional: {},
  },
  "apply-proposal-then-read": {
    runner: "evm",
    does: "applies the proposal's oracle-feed changes on the fork, then reads each market's price",
    required: { markets: { kind: "markets", allowTouchedWord: true } },
    optional: {},
  },
  "liquidatable-at-price": {
    runner: "evm",
    does: "sets one market's price and checks which positions could be liquidated",
    required: { market: { kind: "market" }, priceUsd1e18: { kind: "usd1e18", min: BOUNDS.priceUsd1e18.min, max: BOUNDS.priceUsd1e18.max } },
    optional: {},
  },
  "call-function": {
    runner: "ts",
    does: "calls one exported function of the pasted file once, with plain JSON arguments and stand-in functions Atlas controls",
    required: { exportName: { kind: "exportName" }, args: { kind: "callArgs" } },
    optional: { watchLimitMs: int(BOUNDS.watchLimitMs) },
    notes: {
      exportName: "the exported function to call",
      args: `at most ${BOUNDS.callArgs}; each {"kind":"json","value":<JSON>} or a stand-in function {"kind":"stand-in","name":<identifier>,"async":<true|false>,"calls":[<1 to ${BOUNDS.standInSteps.max} steps>],"then":"repeat_last"|"throw_exhausted"}; a step is {"do":"return","value":<JSON>,"afterMs"?:<virtual ms, async only>} or {"do":"throw","errorName":<identifier>,"message":<text>} or {"do":"never_settle"} (async only)`,
      watchLimitMs: `how long Atlas watches, in virtual ms (default ${CALL_DEFAULT_WATCH_LIMIT_MS})`,
    },
  },
};

// ---------- the check ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const show = (v: unknown): string => {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
  } catch {
    return String(v);
  }
};

function checkField(name: string, spec: FieldSpec, value: unknown, ctx: GateContext): string | undefined {
  switch (spec.kind) {
    case "int": {
      if (spec.orAlways && value === "always") return undefined;
      const range = `${spec.min} to ${spec.max}${spec.orAlways ? ', or "always"' : ""}`;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) return `${name} must be a whole number from ${range}; got ${show(value)}`;
      if (value < spec.min || value > spec.max) return `${name} ${value} is outside the allowed range (${range})`;
      return undefined;
    }
    case "enum":
      if (typeof value !== "string" || !spec.options.includes(value)) {
        return `${name} must be one of ${spec.options.map((o) => `"${o}"`).join(", ")}; got ${show(value)}`;
      }
      return undefined;
    case "json": {
      if (!isJsonValue(value, 0)) return `${name} must be plain JSON (text, numbers, true/false, null, lists, objects)`;
      const chars = JSON.stringify(value).length;
      if (chars > spec.maxChars) return `${name} is ${chars} characters as JSON; the limit is ${spec.maxChars}`;
      return undefined;
    }
    case "markets": {
      const touched = ctx.touchedMarkets ?? [];
      if (spec.allowTouchedWord && value === "touched") {
        return touched.length === 0 ? `${name} "touched": this target touches no markets` : undefined;
      }
      if (!Array.isArray(value) || value.length === 0) {
        return `${name} must be a non-empty list of market names${spec.allowTouchedWord ? ', or "touched"' : ""}`;
      }
      if (touched.length === 0) return `this target touches no markets, so no market can be read`;
      const seen = new Set<string>();
      for (const m of value) {
        if (typeof m !== "string") return `${name} must hold market names (text); got ${show(m)}`;
        if (!touched.includes(m)) return `market ${show(m)} is not one this target touches (${touched.join(", ")})`;
        if (seen.has(m)) return `market "${m}" is listed twice`;
        seen.add(m);
      }
      return undefined;
    }
    case "market": {
      const touched = ctx.touchedMarkets ?? [];
      if (typeof value !== "string") return `${name} must be a market name (text); got ${show(value)}`;
      if (!touched.includes(value)) {
        return touched.length === 0 ? `this target touches no markets, so market "${value}" cannot be used` : `market "${value}" is not one this target touches (${touched.join(", ")})`;
      }
      return undefined;
    }
    case "usd1e18": {
      if (typeof value !== "string" || !/^\d{1,40}$/.test(value)) return `${name} must be a whole-number string in USD 1e18; got ${show(value)}`;
      const v = BigInt(value);
      if (v < spec.min || v > spec.max) return `${name} ${value} is outside the allowed range (above 0, at most $1,000,000 in USD 1e18)`;
      return undefined;
    }
    case "exportName": {
      if (typeof value !== "string" || !IDENTIFIER.test(value) || value.length > BOUNDS.exportNameChars) {
        return `${name} must be the name of an exported function (letters, digits, _ or $, at most ${BOUNDS.exportNameChars} characters); got ${show(value)}`;
      }
      if (ctx.exportNames && !ctx.exportNames.includes(value)) {
        return ctx.exportNames.length === 0
          ? `the pasted code exports nothing Atlas can call, so ${show(value)} cannot be called`
          : `the pasted code does not export ${show(value)}; it exports ${ctx.exportNames.join(", ")}`;
      }
      return undefined;
    }
    case "callArgs":
      return checkCallArgs(name, value);
  }
}

/** A JavaScript-style name: what a stand-in, an error name and an exported function may be called. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** E1: the args of a call-function experiment, every bound checked; undefined when all are fine. */
function checkCallArgs(name: string, value: unknown): string | undefined {
  if (!Array.isArray(value)) return `${name} must be a list`;
  if (value.length > BOUNDS.callArgs) return `${name} has ${value.length} arguments; the limit is ${BOUNDS.callArgs}`;
  const jsonParts: JsonValue[] = [];
  const names = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const a = value[i] as unknown;
    const at = `${name}[${i}]`;
    if (!isRecord(a)) return `${at} must be an object with a "kind" field`;
    if (a.kind === "json") {
      const extra = Object.keys(a).filter((k) => k !== "kind" && k !== "value");
      if (extra.length) return `${at} (json) has no field ${extra.map(show).join(", ")}; its fields are kind, value`;
      if (!Object.prototype.hasOwnProperty.call(a, "value")) return `${at} (json) needs value`;
      if (!isJsonValue(a.value, 0)) return `${at}.value must be plain JSON (text, numbers, true/false, null, lists, objects)`;
      jsonParts.push(a.value);
      continue;
    }
    if (a.kind !== "stand-in") return `${at}.kind must be "json" or "stand-in"; got ${show(a.kind)}`;
    const extra = Object.keys(a).filter((k) => !["kind", "name", "async", "calls", "then"].includes(k));
    if (extra.length) return `${at} (stand-in) has no field ${extra.map(show).join(", ")}; its fields are kind, name, async, calls, then`;
    if (typeof a.name !== "string" || !IDENTIFIER.test(a.name) || a.name.length > BOUNDS.standInNameChars) {
      return `${at}.name must be a name (letters, digits, _ or $, at most ${BOUNDS.standInNameChars} characters); got ${show(a.name)}`;
    }
    if (names.has(a.name)) return `two stand-ins are named "${a.name}"; each needs its own name (its call count is measured by name)`;
    names.add(a.name);
    if (typeof a.async !== "boolean") return `${at}.async must be true or false`;
    if (a.then !== "repeat_last" && a.then !== "throw_exhausted") return `${at}.then must be "repeat_last" or "throw_exhausted"; got ${show(a.then)}`;
    if (!Array.isArray(a.calls) || a.calls.length < BOUNDS.standInSteps.min || a.calls.length > BOUNDS.standInSteps.max) {
      return `${at}.calls must be a list of ${BOUNDS.standInSteps.min} to ${BOUNDS.standInSteps.max} steps`;
    }
    for (let j = 0; j < a.calls.length; j++) {
      const s = a.calls[j] as unknown;
      const sat = `${at}.calls[${j}]`;
      if (!isRecord(s)) return `${sat} must be an object with a "do" field`;
      const fields = (allowed: string[]) => {
        const bad = Object.keys(s).filter((k) => !allowed.includes(k));
        return bad.length ? `${sat} (${String(s.do)}) has no field ${bad.map(show).join(", ")}; its fields are ${allowed.join(", ")}` : undefined;
      };
      if (s.do === "return") {
        const bad = fields(["do", "value", "afterMs"]);
        if (bad) return bad;
        if (!Object.prototype.hasOwnProperty.call(s, "value")) return `${sat} (return) needs value`;
        if (!isJsonValue(s.value, 0)) return `${sat}.value must be plain JSON`;
        jsonParts.push(s.value);
        if (s.afterMs !== undefined) {
          if (!a.async) return `${sat}.afterMs needs an async stand-in: a plain function returns at once, it cannot answer later`;
          const why = checkField(`${sat}.afterMs`, int(BOUNDS.afterMs), s.afterMs, {});
          if (why) return why;
        }
      } else if (s.do === "throw") {
        const bad = fields(["do", "errorName", "message"]);
        if (bad) return bad;
        if (typeof s.errorName !== "string" || !IDENTIFIER.test(s.errorName) || s.errorName.length > BOUNDS.errorNameChars) {
          return `${sat}.errorName must be a name like TimeoutError (letters, digits, _ or $, at most ${BOUNDS.errorNameChars} characters); got ${show(s.errorName)}`;
        }
        if (typeof s.message !== "string" || s.message.length > BOUNDS.errorMessageChars) return `${sat}.message must be text of at most ${BOUNDS.errorMessageChars} characters`;
      } else if (s.do === "never_settle") {
        const bad = fields(["do"]);
        if (bad) return bad;
        if (!a.async) return `${sat} never_settle needs an async stand-in: a plain function cannot leave its caller waiting`;
      } else {
        return `${sat}.do must be "return", "throw" or "never_settle"; got ${show(s.do)}`;
      }
    }
  }
  const chars = canonicalJson(jsonParts).length - 2 - Math.max(0, jsonParts.length - 1); // the values alone, without the list's brackets and commas
  if (chars > BOUNDS.argsJsonChars) return `the JSON values in ${name} are ${chars} characters as canonical JSON; the limit is ${BOUNDS.argsJsonChars}`;
  return undefined;
}

function isJsonValue(v: unknown, depth: number): v is JsonValue {
  if (depth > 10) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
  if (isRecord(v)) {
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
    return Object.values(v).every((x) => isJsonValue(x, depth + 1));
  }
  return false;
}

/**
 * A retry-scenario field the fake chain read can never use, so setting it would change nothing
 * while the person (or a model) thinks it did. Undefined when every set field can act.
 */
function retryFieldWithoutEffect(p: Record<string, unknown>): string | undefined {
  if (p.errorKind !== undefined && p.failure === "never_settles") {
    return 'errorKind has no effect with failure "never_settles": a failing call never answers, so it never returns an error';
  }
  if (p.errorKind !== undefined && p.failTimes === 0) return "errorKind has no effect with failTimes 0: no call fails";
  if (p.failTimes === "always") {
    const unused = ["resolvesWith", "resolveAfterMs"].filter((f) => p[f] !== undefined);
    if (unused.length > 0) return `${unused.join(" and ")} ${unused.length > 1 ? "have" : "has"} no effect with failTimes "always": no call ever answers`;
  }
  return undefined;
}

/**
 * Decide whether an experiment may run. Never throws. On "allowed", `params` is a fresh copy
 * holding only the shape's own fields (nothing else rides along to the runner).
 */
export function gate(params: unknown, ctx: GateContext = {}): GateDecision {
  const refuse = (reason: string): GateDecision => ({ allowed: false, reason });
  if (!isRecord(params)) return refuse("the experiment must be an object with a \"shape\" field");
  const shape = params.shape;
  if (typeof shape !== "string" || !Object.prototype.hasOwnProperty.call(SHAPES, shape)) {
    return refuse(`unknown shape ${show(shape)}; allowed shapes are ${ALL_SHAPES.join(", ")}`);
  }
  const name = shape as ShapeName;
  const allowedShapes = ctx.shapes ?? ALL_SHAPES;
  if (!allowedShapes.includes(name)) {
    return refuse(`shape "${name}" cannot run on this target; allowed here: ${allowedShapes.join(", ") || "none"}`);
  }
  const spec = SHAPES[name];
  const known = new Set(["shape", ...Object.keys(spec.required), ...Object.keys(spec.optional)]);
  const extra = Object.keys(params).filter((k) => !known.has(k));
  if (extra.length > 0) {
    return refuse(`"${name}" has no field ${extra.map((k) => show(k)).join(", ")}; its fields are ${[...known].filter((k) => k !== "shape").join(", ")}`);
  }
  for (const [field, fs] of Object.entries(spec.required)) {
    if (!Object.prototype.hasOwnProperty.call(params, field) || params[field] === undefined) {
      return refuse(`"${name}" needs ${field}`);
    }
    const why = checkField(field, fs, params[field], ctx);
    if (why) return refuse(why);
  }
  for (const [field, fs] of Object.entries(spec.optional)) {
    if (!Object.prototype.hasOwnProperty.call(params, field) || params[field] === undefined) continue;
    const why = checkField(field, fs, params[field], ctx);
    if (why) return refuse(why);
  }
  if (name === "retry-scenario") {
    const why = retryFieldWithoutEffect(params);
    if (why) return refuse(why);
  }
  // A deep copy through JSON: every allowed field is plain JSON by now.
  return { allowed: true, params: JSON.parse(JSON.stringify(params)) as ExperimentShape };
}

// ---------- questions (the one place their text lives) ----------

/** Question text, keyed by the measured field it asks about. */
export const QUESTION_TEXT = {
  calls: "How many times will the function call the RPC?",
  totalWaitMs: "How long will it wait in total, in ms?",
  outcome: "How will it end: returns, throws, or pending (never settles)?",
  [SETTLE_FIELD]: "How long until it settles (returns or throws), in ms?",
} as const;

export const PRICE_TOLERANCE_PCT = 10;
/** Added E1: a bet on a call-function run's virtual settle time must use this tolerance (share of the observed ms). */
export const VIRTUAL_MS_TOLERANCE_PCT = 10;

// ---------- E1: the call-function question text (plain code, from the gate-checked params) ----------

/**
 * E1 review round 2 (MINOR-3): characters that could hide or reorder what a bettor reads are written as a visible
 * escape (\u202e), so the bettor sees that something was there. Covered: C0 and C1 controls (newlines included),
 * bidi embeddings, overrides, isolates and marks (U+200E-200F, U+202A-202E, U+2066-2069, U+061C), zero-width
 * characters (U+200B-200D, U+2060-2064, U+FEFF) and line/paragraph separators (U+2028-2029).
 */
const HIDDEN_CHARS = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
export function visibleText(s: string): string {
  return s.replace(HIDDEN_CHARS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** JSON as it appears in a question: compact, and cut at 60 characters with "…" (the full value is in the experiment). */
function shortJson(v: JsonValue): string {
  const s = canonicalJson(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

function stepWords(step: StandInStep): string {
  switch (step.do) {
    case "return":
      return `returns ${shortJson(step.value)}${step.afterMs ? ` after ${step.afterMs} ms` : ""}`;
    case "throw":
      return `throws ${step.errorName}${step.message ? ` ("${step.message.length > 60 ? `${step.message.slice(0, 59)}…` : step.message}")` : ""}`;
    case "never_settle":
      return "never answers";
  }
}

/** "fetchRate (async) throws TimeoutError on call 1, then returns 42 on calls 2–3; any later call does the same as the last." */
function standInWords(a: Extract<ArgSpec, { kind: "stand-in" }>): string {
  const groups: { from: number; to: number; words: string }[] = [];
  a.calls.forEach((step, i) => {
    const words = stepWords(step);
    const last = groups[groups.length - 1];
    if (last && last.words === words) last.to = i + 1;
    else groups.push({ from: i + 1, to: i + 1, words });
  });
  const parts = groups.map((g) => `${g.words} on call${g.from === g.to ? ` ${g.from}` : `s ${g.from}–${g.to}`}`);
  const after = a.then === "repeat_last" ? `every later call ${groups[groups.length - 1]!.words.replace(/^returns/, "returns").trim()} too` : "any later call throws AtlasStandInExhausted";
  return `${a.name}${a.async ? " (async)" : ""} ${parts.join(", then ")}; ${after}.`;
}

/** The sentence every call-function question starts with: what Atlas will call, and what each stand-in does. */
export function describeCall(params: Extract<ExperimentShape, { shape: "call-function" }>): string {
  const args = params.args.map((a) => (a.kind === "json" ? shortJson(a.value) : a.name)).join(", ");
  const standIns = params.args.filter((a): a is Extract<ArgSpec, { kind: "stand-in" }> => a.kind === "stand-in").map(standInWords);
  return visibleText([`Atlas calls ${params.exportName}(${args}).`, ...standIns].join(" "));
}

/** The questions about one call-function experiment, every text written here. */
function callFunctionQuestions(params: Extract<ExperimentShape, { shape: "call-function" }>): Question[] {
  const d = describeCall(params);
  const fn = visibleText(params.exportName);
  const out: Question[] = [
    q("outcome", `${d} What does ${fn} do?`, "enum", { options: CALL_OUTCOME_OPTIONS }),
    q("returnedJson", `${d} If ${fn} returns, what value does it return, as JSON?`, "json"),
    q("virtualMs", `${d} How long until ${fn} returns or throws, in ms of Atlas's virtual clock?`, "number", { tolerancePct: VIRTUAL_MS_TOLERANCE_PCT }),
  ];
  for (const a of params.args) if (a.kind === "stand-in") out.push(q(`${STAND_IN_CALLS_PREFIX}${a.name}`, `${d} How many times does ${fn} call ${visibleText(a.name)}?`, "integer"));
  return out;
}

const priceQuestion = (market: string, after: boolean) =>
  after
    ? `After this proposal is applied, what will Moonwell's oracle report for 1 ${market}, in USD?`
    : `At the fork block, what will Moonwell's oracle report for 1 ${market}, in USD?`;

/** One question about one measured field, with the answer kind a bet on it must use. */
export interface Question {
  measures: string;
  text: string;
  /** The answer kind a bet must use (or "declined"). */
  kind: Exclude<BetAnswer["kind"], "declined">;
  /** The field's unit (src/units.ts). A "number" bet must carry exactly this unit. */
  unit: MeasuredUnit;
  /** enum questions: the exact options. */
  options?: readonly string[];
  /** number questions: the tolerance a bet must use, as a share of the observed value. */
  tolerancePct?: number;
}

function q(measures: string, text: string, kind: Question["kind"], extra: Partial<Question> = {}): Question {
  const unit = measuredUnit(measures);
  if (!unit) throw new Error(`no unit on file for ${measures}`); // a programming slip, caught by the unit tests
  return { measures, text, kind, unit, ...extra };
}

/**
 * The questions for an allowed experiment, filled by plain code. Empty for shapes that have no
 * runner measuring them yet (concurrency-sweep, liquidatable-at-price): nothing is asked that
 * nothing measures.
 */
export function questionsFor(params: ExperimentShape, ctx: GateContext = {}): Question[] {
  switch (params.shape) {
    case "retry-scenario":
      return [
        q("calls", QUESTION_TEXT.calls, "integer"),
        q("totalWaitMs", QUESTION_TEXT.totalWaitMs, "integer"),
        q("outcome", QUESTION_TEXT.outcome, "enum", { options: OUTCOME_OPTIONS }),
      ];
    case "price-read":
    case "apply-proposal-then-read": {
      const markets = params.markets === "touched" ? [...(ctx.touchedMarkets ?? [])] : params.markets;
      const after = params.shape === "apply-proposal-then-read";
      return markets.map((m) => q(`priceUsd1e18:${m}`, priceQuestion(m, after), "number", { tolerancePct: PRICE_TOLERANCE_PCT }));
    }
    case "call-function":
      return callFunctionQuestions(params);
    case "concurrency-sweep":
    case "liquidatable-at-price":
      return [];
  }
}

/**
 * Extra questions a PERSON may bet on through POST /bets, beyond questionsFor. Never shown to a
 * model (the Claimant answers exactly questionsFor). Today: the settle time of a retry-scenario.
 * It measures SETTLE_FIELD, the same field the TS runner writes, so a run that settles is judged on
 * its real settle time. A run that never settles has no settle time; the runner says so, and a bet
 * on it is "can't check" with that reason (a real one, not staged).
 */
export function extraQuestionsFor(params: ExperimentShape): Question[] {
  return params.shape === "retry-scenario" ? [q(SETTLE_FIELD, QUESTION_TEXT[SETTLE_FIELD], "integer")] : [];
}

/** The answer JSON a bet on this question must have, as text for a prompt. */
export function answerTemplate(question: Question): string {
  switch (question.kind) {
    case "integer":
      return `{"kind":"integer","value":<whole number, ${question.unit === "ms" ? "milliseconds" : "a count"}>}`;
    case "enum":
      return `{"kind":"enum","value":<one of ${(question.options ?? []).map((o) => `"${o}"`).join(" | ")}>,"options":${JSON.stringify(question.options ?? [])}}`;
    case "number":
      return `{"kind":"number","value":<number>,"tolerancePct":${question.tolerancePct ?? PRICE_TOLERANCE_PCT},"unit":"${question.unit}"}`;
    case "json":
      return `{"kind":"json","value":<any JSON value>}`;
  }
}

// ---------- the allow-list as text (for the Claimant prompt) ----------

function renderField(name: string, spec: FieldSpec, ctx: GateContext): string {
  switch (spec.kind) {
    case "int":
      return `${name}: whole number ${spec.min}..${spec.max}${spec.orAlways ? ' or "always"' : ""}`;
    case "enum":
      return `${name}: ${spec.options.map((o) => `"${o}"`).join(" | ")}`;
    case "json":
      return `${name}: any JSON value, at most ${spec.maxChars} characters`;
    case "markets": {
      const touched = (ctx.touchedMarkets ?? []).map((m) => `"${m}"`).join(", ") || "(none)";
      return `${name}: list of markets from [${touched}]${spec.allowTouchedWord ? ' or "touched"' : ""}`;
    }
    case "market": {
      const touched = (ctx.touchedMarkets ?? []).map((m) => `"${m}"`).join(", ") || "(none)";
      return `${name}: one market from [${touched}]`;
    }
    case "usd1e18":
      return `${name}: whole-number string, USD x 1e18, above 0 and at most 1000000e18`;
    case "exportName":
      return `${name}: ${ctx.exportNames ? `one of [${ctx.exportNames.map((n) => `"${n}"`).join(", ") || "(none)"}]` : "an exported function's name"}`;
    case "callArgs":
      return `${name}: list of arguments`;
  }
}

/**
 * The allow-list as plain text: each shape this target can run, its fields with bounds, and the
 * questions that will be asked about it. Rendered from the same table the gate checks.
 */
export function renderAllowList(ctx: GateContext = {}): string {
  const shapes = ctx.shapes ?? ALL_SHAPES;
  const lines: string[] = [
    "Allowed experiments. Anything else is refused: an unknown shape, an extra field, or a value outside its bounds.",
  ];
  for (const name of shapes) {
    const spec = SHAPES[name];
    lines.push("");
    lines.push(`shape "${name}": ${spec.does}.`);
    const note = (f: string) => (spec.notes?.[f] ? ` (${spec.notes[f]})` : "");
    for (const [f, fs] of Object.entries(spec.required)) lines.push(`  required ${renderField(f, fs, ctx)}${note(f)}`);
    for (const [f, fs] of Object.entries(spec.optional)) lines.push(`  optional ${renderField(f, fs, ctx)}${note(f)}`);
    if (name === "call-function") {
      lines.push(`  Atlas's clock is virtual: waits (setTimeout, a stand-in's afterMs) cost no real time. Atlas watches for at most watchLimitMs of virtual time (default ${CALL_DEFAULT_WATCH_LIMIT_MS}).`);
      lines.push(`  How a call ends is one of ${CALL_OUTCOME_OPTIONS.map((o) => `"${o}"`).join(", ")}. "never_settled": still waiting with nothing left that could wake it. "still_running_at_watch_limit": still working when the watch limit ran out.`);
    } else if (spec.runner === "ts" && ctx.watchLimitMs !== undefined) {
      lines.push(`  Atlas's clock is virtual: waits cost no real time. Atlas watches a run for at most ${ctx.watchLimitMs} ms of virtual time.`);
      lines.push(`  Two different endings: a run where the function provably can never finish (it is still waiting and nothing is left that could wake it: no timers, no pending work) is measured, with outcome "pending". A run that Atlas's watch limit cuts off before the end is "can't check".`);
    }
  }
  return lines.join("\n");
}

/** The questions for a shape as plain text, numbered, each with the answer JSON it needs. */
export function renderQuestions(questions: readonly Question[]): string {
  return questions
    .map((qq, i) => `${i + 1}. measures "${qq.measures}": ${qq.text}\n   answer: ${answerTemplate(qq)}`)
    .join("\n");
}
