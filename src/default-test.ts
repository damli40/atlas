// U2 (D53): which of Muse Wonder's allowed tests the bet opens with. A plain-code rule, no model.
//
// The rule, in plain words: prefer the test that makes the code do the most interesting thing.
//   +3  a stand-in or the network fake fails at least once and LATER answers (the retry path runs, then succeeds)
//   +2  a stand-in or the network fake never answers (a hang, or the code's own timeout)
//   +1  any scripted failure at all (a throw, a never-answer, or an HTTP status of 400 or more)
//   +1  any scripted wait (an answer that comes after some virtual ms)
//   +1  the test passes any stand-in or network fake at all (the drawing has a device to light)
//   +1  the test sets its own watch limit (it expects a long wait or a hang)
//   −5  a degenerate argument: a negative number anywhere in the JSON arguments (a count of −1 retries)
//   −2  a zero or an empty value as a whole argument (0, "", [], {}): usually "zero retries" or "no input"
// The highest score wins; a tie keeps Wonder's own order. The score reads only the test, never a run.

import type { ExperimentShape, JsonValue } from "./types";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;
type Step = { kind: "ok" | "fail" | "never"; wait: boolean };

function stepsOf(t: CallShape): Step[][] {
  const out: Step[][] = [];
  for (const a of t.args) {
    if (a.kind !== "stand-in") continue;
    out.push(a.calls.map((c) => (c.do === "return" ? { kind: "ok", wait: (c.afterMs ?? 0) > 0 } : c.do === "throw" ? { kind: "fail", wait: false } : { kind: "never", wait: false })));
  }
  if (t.network) {
    out.push(t.network.calls.map((c) => (c.do === "respond" ? { kind: c.status >= 400 ? "fail" : "ok", wait: (c.afterMs ?? 0) > 0 } : c.do === "throw" ? { kind: "fail", wait: false } : { kind: "never", wait: false })));
  }
  return out;
}

function hasNegative(v: JsonValue): boolean {
  if (typeof v === "number") return v < 0;
  if (Array.isArray(v)) return v.some(hasNegative);
  if (v && typeof v === "object") return Object.values(v).some(hasNegative);
  return false;
}
const isEmpty = (v: JsonValue) => v === 0 || v === "" || (Array.isArray(v) && v.length === 0) || (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

/** The rule's score for one test (higher is more interesting). */
export function interestScore(test: CallShape): number {
  let score = 0;
  const devices = stepsOf(test);
  const all = devices.flat();
  if (devices.some((steps) => steps.some((s, i) => (s.kind === "fail" || s.kind === "never") && steps.slice(i + 1).some((x) => x.kind === "ok")))) score += 3;
  if (all.some((s) => s.kind === "never")) score += 2;
  if (all.some((s) => s.kind !== "ok")) score += 1;
  if (all.some((s) => s.wait)) score += 1;
  if (devices.length > 0) score += 1;
  if (test.watchLimitMs !== undefined) score += 1;
  for (const a of test.args) {
    if (a.kind !== "json") continue;
    if (hasNegative(a.value)) score -= 5;
    else if (isEmpty(a.value)) score -= 2;
  }
  return score;
}

/** The index of the test to open with: the highest score, the first on a tie; -1 when there is none. */
export function pickDefaultTest(tests: readonly CallShape[]): number {
  let best = -1;
  let bestScore = -Infinity;
  tests.forEach((t, i) => {
    const s = interestScore(t);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}
