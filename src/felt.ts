// X4 (D56): two "felt vs happened" facts, by plain code. No I/O, no clock, no model. Safe to load in the browser.
//
// 1. Confidence: the person's one tap per round, "How sure are you overall?". It is sealed in each of their bets
//    (src/seal.ts). `roundConfidence` counts how that round's answers came out.
// 2. Normal path vs failure path: `failurePathOf` reads a test's own spec, before anything runs, and says whether the
//    test scripts a failure. It never looks at a run, and no model is asked.
//
// Neither says anything about what a person understands. They are counts of what happened.

import type { ArgSpec, Bet, Confidence, ExperimentShape, JsonValue, NetworkFake, Verdict } from "./types";

export const CONFIDENCE_LEVELS = ["sure", "think so", "guess"] as const satisfies readonly Confidence[];

export const FAILURE_PATHS = ["nothing failed", "something failed"] as const;
export type FailurePath = (typeof FAILURE_PATHS)[number];

const ERROR_WORDS = new Set(["error", "failed", "failure", "fail"]);
const STATUS_KEYS = new Set(["status", "statuscode", "status_code"]);

/** A status value that means an error: a number (or digits) from 400 to 599, or the word error / failed / failure / fail. */
function isErrorStatus(v: unknown): boolean {
  if (typeof v === "number") return v >= 400 && v <= 599;
  if (typeof v !== "string") return false;
  const t = v.trim().toLowerCase();
  if (ERROR_WORDS.has(t)) return true;
  return /^\d{3}$/.test(t) && Number(t) >= 400 && Number(t) <= 599;
}

/**
 * Whether a scripted value carries an error status: an object with a status field (status, statusCode, status_code),
 * at its top level or directly under `response`. Deeper values are left alone: `{"items":[{"status":"failed"}]}` is a
 * list of jobs, not a failed call.
 */
function hasErrorStatus(value: JsonValue): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [k, v] of Object.entries(value)) {
    if (STATUS_KEYS.has(k.toLowerCase()) && isErrorStatus(v)) return true;
    if (k.toLowerCase() === "response" && v !== undefined && hasErrorStatus(v)) return true;
  }
  return false;
}

function standInFails(a: ArgSpec): boolean {
  if (a.kind !== "stand-in") return false;
  return a.calls.some((s) => s.do === "throw" || s.do === "never_settle" || (s.do === "return" && hasErrorStatus(s.value)));
}

function networkFails(n: NetworkFake): boolean {
  return n.calls.some((s) => s.do === "throw" || s.do === "never_answer" || (s.do === "respond" && (s.status >= 400 || hasErrorStatus(s.body))));
}

/**
 * The test's tag, from its spec alone: "something failed" when any stand-in or the fake network is scripted to throw,
 * to answer with an error status, or never to answer; otherwise "nothing failed". Every call of a sequence counts.
 *
 * - `then: "throw_exhausted"` alone does not count. It is what happens when the code calls more often than the script
 *   has steps, which only a run can show; it is not a failure the test sets up.
 * - A step the code never reaches still counts, because the tag is about what the test sets up, not what ran.
 * - Null for a run on a chain fork: Atlas scripts nothing there, so saying "nothing failed" about it would claim
 *   something Atlas does not know. Those rounds are left out of the comparison, and the record says so.
 */
export function failurePathOf(params: ExperimentShape | undefined): FailurePath | null {
  if (!params) return null;
  const tag = (failed: boolean): FailurePath => (failed ? "something failed" : "nothing failed");
  switch (params.shape) {
    case "retry-scenario":
    case "concurrency-sweep":
      return tag(params.failTimes === "always" || params.failTimes > 0);
    case "call-function": {
      const args = [...params.args, ...(params.calls ?? []).flatMap((c) => c.args)];
      return tag(args.some(standInFails) || (params.network !== undefined && networkFails(params.network)));
    }
    default:
      return null;
  }
}

/** One round's count for the verdict: what the person said, and how their answers came out. */
export interface RoundConfidence {
  level: Confidence;
  matched: number;
  /** Answers plain code could compare with the run (matched + didn't match). */
  checkable: number;
  /** Answers it could not: "can't tell", or a value the run did not produce. */
  cantCheck: number;
}

/** The count for one round, or null when the person did not say how sure they were. */
export function roundConfidence(bets: readonly Bet[], verdicts: readonly Verdict[]): RoundConfidence | null {
  const mine = bets.filter((b) => b.who === "human");
  const level = mine.find((b) => b.confidence !== undefined)?.confidence;
  if (!level) return null;
  let matched = 0;
  let notMatched = 0;
  let cantCheck = 0;
  for (const b of mine) {
    const v = verdicts.find((x) => x.betId === b.id);
    if (!v) continue;
    if (v.outcome === "matched") matched++;
    else if (v.outcome === "not_matched") notMatched++;
    else cantCheck++;
  }
  return { level, matched, checkable: matched + notMatched, cantCheck };
}
