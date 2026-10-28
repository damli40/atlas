// R1 (D36): what a call-function result depends on that is Atlas's, not the code's.
//
// Plain words:
// - Atlas pins three things for every pasted-code run, so the same test gives the same run every time:
//   all randomness comes from one recorded seed, the time zone is UTC, and the locale is pinned (en-US for
//   JavaScript, "C" for Python). The run records all three.
// - The sandbox notices when the code leans on something Atlas controls (it read the clock, used randomness, read
//   the time zone, built a Python set) or on something nobody controls (an order Node leaves open, a timer that does
//   not keep the process alive). It writes the kinds it noticed into the run's trace (one "conditions" event).
// - This file turns those kinds into the sentences the verdict screen and the proof card show (the words live in
//   src/paste-words.ts), and lets `verify` recheck that a proof file's conditions are exactly what its trace says.
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

/** A seed Atlas accepts: a whole number from 1 to 2^32 - 1 (Python's PYTHONHASHSEED range; 0 would switch it off). */
export function isCallSeed(seed: unknown): seed is string {
  return typeof seed === "string" && /^[1-9]\d{0,9}$/.test(seed) && Number(seed) <= 4_294_967_295;
}

/** Every kind, in the order the conditions line lists them. */
export const CONDITION_KINDS = ["clock", "clock-during-work", "randomness", "unseeded-randomness", "hash-seed", "time-zone-or-locale", "timer-order", "unref-timer"] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

/** Kinds whose run does NOT report how the call ended (the fields carry the reason); the rest only disclose. */
export const UNDECIDED_KINDS: readonly ConditionKind[] = ["clock-during-work", "unseeded-randomness", "timer-order"];

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

export function conditionSays(kind: ConditionKind, pins: Pins): string {
  const W = CONDITION_WORDS;
  switch (kind) {
    case "clock":
      return W.clock;
    case "clock-during-work":
      return W.clockDuringWork;
    case "randomness":
      return W.randomness(pins.seed);
    case "unseeded-randomness":
      return W.unseededRandom;
    case "hash-seed":
      return W.hashSeed(pins.seed);
    case "time-zone-or-locale":
      return W.timeZoneOrLocale(pins.timeZone, pins.locale);
    case "timer-order":
      return W.timerOrder;
    case "unref-timer":
      return W.unrefTimer;
  }
}

const isKind = (k: unknown): k is ConditionKind => typeof k === "string" && (CONDITION_KINDS as readonly string[]).includes(k);

/** The conditions for these kinds, in CONDITION_KINDS order, each once. Throws on a kind Atlas does not know. */
export function conditionsFromKinds(kinds: readonly string[], pins: Pins): RunCondition[] {
  for (const k of kinds) if (!isKind(k)) throw new Error(`unknown condition kind ${JSON.stringify(String(k).slice(0, 40))}`);
  return CONDITION_KINDS.filter((k) => kinds.includes(k)).map((kind) => ({ kind, says: conditionSays(kind, pins) }));
}

/**
 * The kinds the sandbox wrote into a run's trace (its "conditions" event), or [] when it wrote none. null when the
 * trace holds more than one such event or one that is not a list of text (a proof file someone edited).
 */
export function conditionKindsInTrace(trace: readonly { event: string; data?: Record<string, unknown> }[]): string[] | null {
  const evs = trace.filter((t) => t.event === "conditions");
  if (evs.length === 0) return [];
  if (evs.length > 1) return null;
  const kinds = evs[0]!.data?.kinds;
  if (!Array.isArray(kinds) || !kinds.every((k) => typeof k === "string")) return null;
  return kinds as string[];
}

/**
 * Verify (src/atlasfile.ts): a call-function run's pins and conditions. A legacy run (seed "none", from before R1)
 * carries neither. Otherwise the seed is a valid seed, the time zone and the locale are Atlas's pinned ones for the
 * language, and the conditions are exactly what the run's own trace says, in Atlas's own words.
 */
export function callRunPinProblems(r: { seed?: string; timeZone?: string; locale?: string; conditions?: unknown; trace: { event: string; data?: Record<string, unknown> }[]; result: { measured: Record<string, unknown> } }, language: PastedLanguage): string[] {
  if (r.seed === LEGACY_CALL_SEED) {
    return r.timeZone !== undefined || r.locale !== undefined || r.conditions !== undefined || r.trace.some((t) => t.event === "conditions")
      ? ["it says nothing was pinned (seed none), but it carries pins or conditions"]
      : [];
  }
  const out: string[] = [];
  if (!isCallSeed(r.seed)) out.push(`its seed ${JSON.stringify(r.seed ?? null)} is not a seed Atlas uses (a whole number from 1 to 4294967295)`);
  if (r.timeZone !== CALL_PINNED_TIME_ZONE) out.push(`its time zone is ${JSON.stringify(r.timeZone ?? null)}, not Atlas's pinned ${CALL_PINNED_TIME_ZONE}`);
  if (r.locale !== CALL_PINNED_LOCALE[language]) out.push(`its locale is ${JSON.stringify(r.locale ?? null)}, not Atlas's pinned ${CALL_PINNED_LOCALE[language]} for ${language}`);
  const kinds = conditionKindsInTrace(r.trace);
  if (kinds === null) return [...out, "its trace's conditions event is not one list of kinds"];
  let want: RunCondition[];
  try {
    want = conditionsFromKinds(kinds, { seed: r.seed ?? "", timeZone: CALL_PINNED_TIME_ZONE, locale: CALL_PINNED_LOCALE[language] });
  } catch (e) {
    return [...out, `its trace names a condition Atlas does not know (${(e as Error).message})`];
  }
  if (JSON.stringify(r.conditions ?? null) !== JSON.stringify(want)) out.push("its conditions are not the ones its trace records, in Atlas's words");
  if (kinds.some((k) => (UNDECIDED_KINDS as readonly string[]).includes(k)) && "outcome" in r.result.measured) {
    out.push("its trace says how the call ended depends on something outside the code, but it measured the outcome");
  }
  return out;
}
