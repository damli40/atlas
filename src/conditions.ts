// R1 (D42): what a call-function result depends on that is Atlas's, not the code's.
//
// Plain words:
// - Atlas pins three things for every pasted-code run, so the same test gives the same run every time:
//   all randomness comes from one recorded seed, the time zone is UTC, and the locale is pinned (en-US for
//   JavaScript, "C" for Python). The run records all three.
// - The sandbox notices when the code leans on something Atlas controls (it read the clock, timed its own work, used
//   randomness, read the time zone or the locale, read something about the machine, built a Python set) or on
//   something nobody controls (an order Node leaves open, a timer that does not keep the process alive). It writes
//   what it noticed into the run's trace (one "conditions" event).
// - R1 review round 1 (the double run): every pasted test runs TWICE, in two fresh sandboxes, with the same seed and
//   pins. A measured field that differs between the two is not reported ("can't check"), whatever made it differ
//   (memory addresses, process ids, temp-folder paths). The second run is kept in the proof file and verify rechecks it.
// - This file turns all of that into the sentences the verdict screen and the proof card show (the words live in
//   src/paste-words.ts), merges the two runs, and lets `verify` recheck a proof file's pins, conditions and twin.
// - A condition never silently changes a verdict. Some kinds only disclose (the value is Atlas's pinned one, said
//   so); the others come with "not measured" fields whose reasons say why (those bets are "can't check").
// No I/O. Safe to load in the browser and on the server.

import { CONDITION_WORDS } from "./paste-words";
import type { PastedLanguage } from "./pasted-code";

/** The seed every call-function run uses unless it replays an older run with another one. Just a number. */
export const CALL_PINNED_SEED = "20260101";
/** The time zone every call-function run is pinned to (the sandbox gets TZ=UTC and checks it took). */
export const CALL_PINNED_TIME_ZONE = "UTC";
/** The locale every call-function run is pinned to: Node's Intl locale, or Python's C locale. */
export const CALL_PINNED_LOCALE: Record<PastedLanguage, string> = { js: "en-US", ts: "en-US", py: "C" };
/** Older proof files (before R1) carry this seed: nothing was pinned, and they carry no conditions. */
export const LEGACY_CALL_SEED = "none";
/**
 * R1 review m1: a run that started on or after this moment was made by an R1 harness, so it must carry its pins and
 * conditions. Relabelling a newer run as "seed none" (to hide its conditions) is refused by verify.
 */
export const R1_SINCE = "2026-10-28T00:00:00.000Z"; // R1 review round 2 (m3): the day of the first R1 commit

/** A seed Atlas accepts: a whole number from 1 to 2^32 - 1 (Python's PYTHONHASHSEED range; 0 would switch it off). */
export function isCallSeed(seed: unknown): seed is string {
  return typeof seed === "string" && /^[1-9]\d{0,9}$/.test(seed) && Number(seed) <= 4_294_967_295;
}

/** Every kind, in the order the conditions line lists them. */
export const CONDITION_KINDS = [
  "changed-between-runs",
  "clock",
  "timed-work",
  "randomness",
  "unseeded-randomness",
  "hash-seed",
  "time-zone-or-locale",
  "host",
  "memory-address",
  "tick-order",
  "timer-order",
  "unref-timer",
] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Kinds whose run does NOT report how the call ended (the fields carry the reason); the rest only disclose. */
export const UNDECIDED_KINDS: readonly ConditionKind[] = ["unseeded-randomness", "timer-order"];

export interface RunCondition {
  kind: ConditionKind;
  /** The plain sentence shown on the verdict screen and the proof card (from src/paste-words.ts). */
  says: string;
}

export interface Pins {
  seed: string;
  timeZone: string;
  locale: string;
}

export function pinnedFor(language: PastedLanguage, seed: string = CALL_PINNED_SEED): Pins {
  return { seed, timeZone: CALL_PINNED_TIME_ZONE, locale: CALL_PINNED_LOCALE[language] };
}

/** What the run read about the machine ("host"), and which fields differed between the two runs. */
export interface ConditionDetail {
  host?: readonly string[];
  changed?: readonly string[];
}

export function conditionSays(kind: ConditionKind, pins: Pins, detail: ConditionDetail = {}): string {
  const W = CONDITION_WORDS;
  switch (kind) {
    case "changed-between-runs":
      return W.changedBetweenRuns((detail.changed ?? []).join(", "));
    case "clock":
      return W.clock;
    case "timed-work":
      return W.timedWork;
    case "randomness":
      return W.randomness(pins.seed);
    case "unseeded-randomness":
      return W.unseededRandom;
    case "hash-seed":
      return W.hashSeed(pins.seed);
    case "time-zone-or-locale":
      return W.timeZoneOrLocale(pins.timeZone, pins.locale);
    case "host":
      return W.host((detail.host ?? []).join(", "));
    case "memory-address":
      return W.memoryAddress;
    case "tick-order":
      return W.tickOrder;
    case "timer-order":
      return W.timerOrder;
    case "unref-timer":
      return W.unrefTimer;
  }
}

const isKind = (k: unknown): k is ConditionKind => typeof k === "string" && (CONDITION_KINDS as readonly string[]).includes(k);

/** The conditions for these kinds, in CONDITION_KINDS order, each once. Throws on a kind Atlas does not know. */
export function conditionsFromKinds(kinds: readonly string[], pins: Pins, detail: ConditionDetail = {}): RunCondition[] {
  for (const k of kinds) if (!isKind(k)) throw new Error(`unknown condition kind ${JSON.stringify(String(k).slice(0, 40))}`);
  return CONDITION_KINDS.filter((k) => kinds.includes(k)).map((kind) => ({ kind, says: conditionSays(kind, pins, detail) }));
}

type Ev = { event: string; data?: Record<string, unknown> };
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

/**
 * What a run's trace says about its conditions: the sandbox's "conditions" event (kinds, and the host reads by
 * name) and the runner's "twin_differs" event (the fields the second run measured differently). null when the
 * trace holds more than one of either event, or one that is not lists of text (a proof file someone edited).
 */
export function conditionsInTrace(trace: readonly Ev[]): { kinds: string[]; detail: ConditionDetail } | null {
  const evs = trace.filter((t) => t.event === "conditions");
  const twins = trace.filter((t) => t.event === "twin_differs");
  if (evs.length > 1 || twins.length > 1) return null;
  const kinds = evs.length === 0 ? [] : strList(evs[0]!.data?.kinds);
  const host = evs.length === 0 || evs[0]!.data?.host === undefined ? [] : strList(evs[0]!.data?.host);
  const changed = twins.length === 0 ? [] : strList(twins[0]!.data?.fields);
  if (kinds === null || host === null || changed === null) return null;
  const all = [...kinds];
  if (changed.length > 0 && !all.includes("changed-between-runs")) all.push("changed-between-runs");
  return { kinds: all, detail: { ...(host.length ? { host } : {}), ...(changed.length ? { changed } : {}) } };
}

/** Back-compatible: only the kinds (see conditionsInTrace). */
export function conditionKindsInTrace(trace: readonly Ev[]): string[] | null {
  return conditionsInTrace(trace)?.kinds ?? null;
}

/** The conditions a run's trace records, in Atlas's words. Throws on a trace Atlas did not write. */
export function conditionsFromTrace(trace: readonly Ev[], pins: Pins): RunCondition[] {
  const c = conditionsInTrace(trace);
  if (c === null) throw new Error("the trace's conditions are not in the form Atlas writes");
  return conditionsFromKinds(c.kinds, pins, c.detail);
}

// ---- the double run (R1 review round 1, B1 + B2) ----

/** Why a field is not reported when the two identical runs measured it differently. */
export const CHANGED_BETWEEN_RUNS_REASON =
  "this value changed between two identical runs (same code, same test, same seed and pins), so it depends on something Atlas does not control, such as memory addresses, process ids or paths";

/** The fields that make up how the call ended: when the outcome or its time differs, none of them is reported. */
const ENDING_FIELDS = ["outcome", "virtualMs", "returnedJson", "returnedType", "thrownName", "thrownMessage", "thrownType"];

type Result = { measured: Record<string, string | number | boolean | null>; notMeasured: Record<string, string> };

/**
 * Merges the first run's result with the second's. A field measured in both with the same value stays measured; a
 * field measured differently, or measured in only one, is not reported with CHANGED_BETWEEN_RUNS_REASON. When the
 * outcome or its time differs, every ending field is not reported (the trace then ends with "stopped_watching").
 */
export function mergeTwin(first: Result, second: Result): { result: Result; changed: string[]; endingChanged: boolean } {
  const keys = [...new Set([...Object.keys(first.measured), ...Object.keys(second.measured)])].sort();
  const has = (r: Result, k: string) => Object.prototype.hasOwnProperty.call(r.measured, k);
  const changed = keys.filter((k) => !(has(first, k) && has(second, k) && first.measured[k] === second.measured[k]));
  const endingChanged = changed.includes("outcome") || changed.includes("virtualMs");
  const measured: Result["measured"] = {};
  const notMeasured: Result["notMeasured"] = { ...first.notMeasured };
  for (const k of Object.keys(first.measured)) {
    if (changed.includes(k) || (endingChanged && ENDING_FIELDS.includes(k))) notMeasured[k] = CHANGED_BETWEEN_RUNS_REASON;
    else measured[k] = first.measured[k]!;
  }
  for (const k of changed) if (!has(first, k)) notMeasured[k] = CHANGED_BETWEEN_RUNS_REASON;
  if (endingChanged) for (const k of ENDING_FIELDS) if (k in notMeasured || k in first.measured || k in second.measured) notMeasured[k] = CHANGED_BETWEEN_RUNS_REASON;
  return { result: { measured, notMeasured }, changed, endingChanged };
}

/**
 * Verify: a run with a twin. Every field the run measured, the twin measured with the same value; every field the
 * run's "twin_differs" event names is not reported, with Atlas's reason; and every field measured differently
 * really is named there.
 */
export function twinProblems(r: { trace: Ev[]; result: Result; twin?: { trace: Ev[]; result: Result } }): string[] {
  if (!r.twin) return [];
  const out: string[] = [];
  const c = conditionsInTrace(r.trace);
  const named = c?.detail.changed ?? [];
  for (const [k, v] of Object.entries(r.result.measured)) {
    if (!Object.prototype.hasOwnProperty.call(r.twin.result.measured, k) || r.twin.result.measured[k] !== v) out.push(`it reports ${k}, but its second run measured it differently`);
  }
  for (const k of named) if (r.result.notMeasured[k] !== CHANGED_BETWEEN_RUNS_REASON) out.push(`its trace says ${k} changed between the two runs, but the run does not say so`);
  for (const k of Object.keys(r.twin.result.measured)) {
    if (!Object.prototype.hasOwnProperty.call(r.result.measured, k) && r.result.notMeasured[k] === CHANGED_BETWEEN_RUNS_REASON && !named.includes(k)) out.push(`${k} is marked as changed between runs, but the trace does not name it`);
  }
  return out;
}

/**
 * Verify (src/atlasfile.ts): a call-function run's pins and conditions. A legacy run (seed "none", from before R1)
 * carries none of them, and must have started before R1_SINCE. Otherwise the seed is a valid seed, the time zone
 * and the locale are Atlas's pinned ones for the language, the conditions are exactly what the run's own trace
 * says, in Atlas's words, and (when it has one) its twin agrees with what it reports.
 */
export function callRunPinProblems(
  r: { seed?: string; timeZone?: string; locale?: string; conditions?: unknown; startedAt: string; twin?: { trace: Ev[]; result: Result }; trace: Ev[]; result: Result },
  language: PastedLanguage,
): string[] {
  if (r.seed === LEGACY_CALL_SEED) {
    if (Date.parse(r.startedAt) >= Date.parse(R1_SINCE)) return ["it says nothing was pinned (seed none), but it started after Atlas began pinning every run, so its conditions are missing"];
    return r.timeZone !== undefined || r.locale !== undefined || r.conditions !== undefined || r.twin !== undefined || r.trace.some((t) => t.event === "conditions" || t.event === "twin_differs")
      ? ["it says nothing was pinned (seed none), but it carries pins or conditions"]
      : [];
  }
  const out: string[] = [];
  if (!isCallSeed(r.seed)) out.push(`its seed ${JSON.stringify(r.seed ?? null)} is not a seed Atlas uses (a whole number from 1 to 4294967295)`);
  if (r.timeZone !== CALL_PINNED_TIME_ZONE) out.push(`its time zone is ${JSON.stringify(r.timeZone ?? null)}, not Atlas's pinned ${CALL_PINNED_TIME_ZONE}`);
  if (r.locale !== CALL_PINNED_LOCALE[language]) out.push(`its locale is ${JSON.stringify(r.locale ?? null)}, not Atlas's pinned ${CALL_PINNED_LOCALE[language]} for ${language}`);
  const c = conditionsInTrace(r.trace);
  if (c === null) return [...out, "its trace's conditions are not in the form Atlas writes"];
  let want: RunCondition[];
  try {
    want = conditionsFromKinds(c.kinds, { seed: r.seed ?? "", timeZone: CALL_PINNED_TIME_ZONE, locale: CALL_PINNED_LOCALE[language] }, c.detail);
  } catch (e) {
    return [...out, `its trace names a condition Atlas does not know (${(e as Error).message})`];
  }
  if (JSON.stringify(r.conditions ?? null) !== JSON.stringify(want)) out.push("its conditions are not the ones its trace records, in Atlas's words");
  if (c.kinds.some((k) => (UNDECIDED_KINDS as readonly string[]).includes(k)) && "outcome" in r.result.measured) {
    out.push("its trace says how the call ended depends on something outside the code, but it measured the outcome");
  }
  // A run that ran to the end (no whole-run reason) since R1 has its second run.
  if (r.result.notMeasured.wholeRun === undefined && !r.twin && Date.parse(r.startedAt) >= Date.parse(R1_SINCE)) out.push("it has no second run, which every pasted test has since R1");
  if (r.result.notMeasured.wholeRun !== undefined && r.conditions !== undefined && (r.conditions as unknown[]).length > 0) out.push("it did not run to the end (whole-run can't check), but it claims conditions");
  for (const p of twinProblems(r)) out.push(p);
  return out;
}
