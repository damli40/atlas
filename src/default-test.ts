// U2 (D53), U3 item 2: which of Muse Wonder's allowed tests the bet opens with. A plain-code rule, no model.
//
// The rule, in plain words: prefer the test a reader is most likely to get wrong, which is the one that hits an EDGE
// of the code: the call that comes back from a cache, the failure that uses up the last retry, the page past the
// limit. The score reads only the test and the file's text (src/code-facts.ts), never a run and never Wonder's claim
// sentence (D18: the claim stays hidden until after the run; Wonder may still aim a test at it).
//   Edges (U3):
//   +4  a second call on code that keeps state between calls (a cache, a counter): the only way to see it work
//   +2  ...with a wait between the calls (an expiry: the TTL runs out)
//   +3  the Nth failure: a device fails exactly L or L+1 times in a row from its first call, where L is a small limit
//       the code compares against or defaults to (`attempt < 3`, `retries = 3`): the retry limit is reached
//   +2  a truncation: the fake keeps answering "there is another page" (a next / cursor / more field that is not null)
//       while the test passes a page or item limit the code uses
//   The interesting paths (U2):
//   +3  a stand-in or the network fake fails at least once and LATER answers (the retry path runs, then succeeds)
//   +2  a stand-in or the network fake never answers (a hang, or the code's own timeout)
//   +1  any scripted failure at all (a throw, a never-answer, or an HTTP status of 400 or more)
//   +1  any scripted wait (an answer that comes after some virtual ms)
//   +1  the test passes any stand-in or network fake at all (the drawing has a device to light)
//   +1  the test sets its own watch limit (it expects a long wait or a hang)
//   Degenerate arguments:
//   −5  a negative number anywhere in the JSON arguments (a count of −1 retries)
//   −2  a zero or an empty value as a whole argument (0, "", [], {}): usually "zero retries" or "no input"
// The highest score wins; a tie keeps Wonder's own order.

import type { ExperimentShape, JsonValue } from "./types";
import { keptState, smallLimits, type Lang } from "./code-facts";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;
type Step = { kind: "ok" | "fail" | "never"; wait: boolean; more?: boolean };

/** What the score may read about the file: its text and language (absent: only the test is read). */
export interface CodeContext {
  source: string;
  language: Lang;
}

const NEXT_KEY = /^(?:next\w*|cursor|has_?more|more|next_?page\w*|continuation\w*)$/i;
/** True when a body says there is more to fetch: a next / cursor / more key whose value is not null, false or "". */
function saysMore(v: JsonValue, depth = 0): boolean {
  if (depth > 4 || v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return false;
  return Object.entries(v).some(([k, x]) => (NEXT_KEY.test(k) && x !== null && x !== false && x !== "") || saysMore(x, depth + 1));
}

function allArgs(t: CallShape) {
  const seen = new Set<string>();
  const out: CallShape["args"] = [];
  for (const a of [...(t.calls ?? []).flatMap((c) => c.args), ...t.args]) {
    if (a.kind === "stand-in") {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
    }
    out.push(a);
  }
  return out;
}

function stepsOf(t: CallShape): Step[][] {
  const out: Step[][] = [];
  for (const a of allArgs(t)) {
    if (a.kind !== "stand-in") continue;
    out.push(a.calls.map((c) => (c.do === "return" ? { kind: "ok", wait: (c.afterMs ?? 0) > 0, more: saysMore(c.value) } : c.do === "throw" ? { kind: "fail", wait: false } : { kind: "never", wait: false })));
  }
  if (t.network) {
    out.push(t.network.calls.map((c) => (c.do === "respond" ? { kind: c.status >= 400 ? "fail" : "ok", wait: (c.afterMs ?? 0) > 0, more: c.status < 400 && saysMore(c.body) } : c.do === "throw" ? { kind: "fail", wait: false } : { kind: "never", wait: false })));
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

/** The rule's score for one test (higher is more likely to be guessed wrong), with the edges it hits in plain words. */
export function interestScoreWhy(test: CallShape, code?: CodeContext): { score: number; edges: string[] } {
  let score = 0;
  const edges: string[] = [];
  const devices = stepsOf(test);
  const all = devices.flat();
  // ---- edges (U3) ----
  const state = code ? keptState(code.source, code.language) : [];
  if (test.calls && test.calls.length > 1) {
    if (state.length > 0) {
      score += 4;
      edges.push("calls twice on code that keeps state");
      if (test.calls.some((c) => (c.waitMs ?? 0) > 0)) {
        score += 2;
        edges.push("waits between the calls (an expiry)");
      }
    } else score += 1;
  }
  const limits = code ? smallLimits(code.source, code.language) : [];
  if (limits.length) {
    const leading = devices.map((steps) => {
      let k = 0;
      while (k < steps.length && steps[k]!.kind !== "ok") k++;
      return k;
    });
    if (leading.some((k) => k > 0 && limits.some((l) => k === l || k === l + 1))) {
      score += 3;
      edges.push("fails as many times as the code's limit");
    }
    const intArgs = test.args.flatMap((a) => (a.kind === "json" && typeof a.value === "number" && Number.isInteger(a.value) && a.value >= 1 && a.value <= 20 ? [a.value] : []));
    const pagesMore = devices.some((steps) => steps.some((s) => s.more));
    if (pagesMore && (intArgs.length > 0 || limits.length > 0)) {
      score += 2;
      edges.push("keeps saying there is another page");
    }
  }
  // ---- interesting paths (U2) ----
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
  return { score, edges };
}

/** The rule's score for one test (higher is more interesting). */
export function interestScore(test: CallShape, code?: CodeContext): number {
  return interestScoreWhy(test, code).score;
}

/** The index of the test to open with: the highest score, the first on a tie; -1 when there is none. */
export function pickDefaultTest(tests: readonly CallShape[], code?: CodeContext): number {
  let best = -1;
  let bestScore = -Infinity;
  tests.forEach((t, i) => {
    const s = interestScore(t, code);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}
