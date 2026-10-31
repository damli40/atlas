// L1 (D57): the retry loop's plain-code rules. No I/O, no clock, no model.
//
// Plain words: after a round, when the person's sealed answers didn't match, the person may say "my answers are what I
// want". Those sealed answers become the target. The coding agent edits the file; Atlas runs the SAME test with the SAME
// seed on the changed code and judges the SAME sealed bets again. Nobody is asked to bet again and nothing is re-sealed.
// At most LOOP_MAX_TRIES re-runs per round, counted on the server, then Atlas stops and hands back to the person.
//
// Atlas still never judges correctness. "Matched" means the code did what the person bet on in this one test, nothing
// more. An edit that deletes or hard-codes the behaviour under test can match too, and plain code cannot know that. So
// every try carries the lines it changed, and the person reviews them.
//
// This file holds what the server and verify must agree on: the words of the choice, the changed lines, which bets are
// the target, when the loop stops and how it says so, and the fingerprint that makes every edit to a try fail verify.
// (The plugin keeps its own copy of LOOP_PHRASE, because an installed plugin cannot import from this repo; a test
// checks the two are the same.)

import { canonicalJson, sha256Hex } from "./seal";
import { plural } from "./words";
import type { Bet, JsonValue, Run, Verdict } from "./types";

/** The person's own words for the choice. Nothing else counts as choosing. */
export const LOOP_PHRASE = "my answers are what I want";
/** Re-runs per round. Counted on the server (server/loop.ts) and rechecked by verify. */
export const LOOP_MAX_TRIES = 3;
/** Added to every proof file that has a loop (verify requires it). */
export const LOOP_CAPTION = `the person chose their sealed answers as the target and reviews the change; "matched" means the code did what they bet on in this one test, nothing more`;

/**
 * True when `typed` is exactly the phrase. Forgiven: outer spaces, spacing between words, letter case, one pair of
 * outer quotes, a final full stop. Anything else ("yes", "go ahead", the phrase plus more words) is not the choice.
 */
export function isLoopPhrase(typed: unknown): boolean {
  if (typeof typed !== "string") return false;
  const bare = typed.trim().replace(/^["'`](.*)["'`]$/s, "$1").trim().replace(/\.$/, "").trim();
  return bare.replace(/ +/g, " ").toLowerCase() === LOOP_PHRASE.toLowerCase();
}

// ---------- the changed lines ----------

export interface LineChange {
  /** "+" a line the edit added (`line` counts in the new text); "-" a line it removed (`line` counts in the old text). */
  tag: "+" | "-";
  line: number;
  text: string;
}
export interface LineChanges {
  added: number;
  removed: number;
  lines: LineChange[];
}

/** Beyond this many old × new lines, the changed middle is listed as removed and added whole (still a true list). */
const MAX_LCS_CELLS = 4_000_000;

/**
 * The lines that differ between two versions of a file. Lines split on \n only, so a change of line endings shows as
 * changed lines instead of an empty diff under a new fingerprint. Same inputs, same answer (verify recomputes it).
 */
export function lineChanges(before: string, after: string): LineChanges {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const lines: LineChange[] = [];
  const del = (i: number) => lines.push({ tag: "-", line: start + i + 1, text: a[start + i]! });
  const add = (j: number) => lines.push({ tag: "+", line: start + j + 1, text: b[start + j]! });
  if (n === 0 || m === 0 || n * m > MAX_LCS_CELLS) {
    for (let i = 0; i < n; i++) del(i);
    for (let j = 0; j < m; j++) add(j);
  } else {
    // Longest common subsequence, walked from the front: a line kept in both is not a change.
    const w = m + 1;
    const lcs = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        i++;
        j++;
      } else if (j >= m || (i < n && lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) del(i++);
      else add(j++);
    }
  }
  return { added: lines.filter((l) => l.tag === "+").length, removed: lines.filter((l) => l.tag === "-").length, lines };
}

// ---------- the record of one loop ----------

export interface LoopChoice {
  typed: string;
  chosenAt: string;
  fromRunId: string;
}
export interface LoopTargetBet {
  betId: string;
  sealedHash: string;
}
export interface LoopTry {
  try: number;
  codeSha256: string;
  /** The code this try ran (verify re-hashes it). Withheld from anyone but the session that pasted it, like the target's. */
  source: string;
  /** What this try's edit changed since the version before it. */
  changes: LineChanges;
  /** How far this version is from the code the person bet on. */
  sinceBet: { added: number; removed: number };
  run?: Run;
  verdicts?: Verdict[];
  /** The run stopped before it measured anything (it still counts as a try). */
  didNotFinish?: { reason: string; startedAt: string; stoppedAt: string; budget: boolean };
}
export type LoopStopReason = "all_matched" | "cap" | "budget" | "cant_check" | "nothing_left";
export interface LoopStop {
  reason: LoopStopReason;
  says: string;
}
export interface AtlasLoop {
  choice: LoopChoice;
  targetBets: LoopTargetBet[];
  maxTries: typeof LOOP_MAX_TRIES;
  tries: LoopTry[];
  stopped?: LoopStop;
  /** SHA-256 of everything above. Any edit to a try that does not also recompute this fails verify. */
  fingerprint: string;
}

/** The person's sealed answers: every bet of theirs that is an answer (a "skip" asks nothing of the code). */
export function targetBetsOf(bets: readonly Bet[]): LoopTargetBet[] {
  return bets.filter((b) => b.who === "human" && b.answer.kind !== "declined").map((b) => ({ betId: b.id, sealedHash: b.sealedHash }));
}

export function loopFingerprint(loop: Omit<AtlasLoop, "fingerprint">): string {
  const { choice, targetBets, maxTries, tries, stopped } = loop;
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify({ choice, targetBets, maxTries, tries, ...(stopped ? { stopped } : {}) })) as JsonValue));
}

/** A sentence from the ledger or the Modal executor that means money ran out (not "wait a few seconds"). */
const BUDGET_REASON = /budget is used up|spend limit reached|kept for the owner|share of today's sandboxes is used up|sandbox share is used up|sandboxes? (per|a) day|daily cap/i;
export const isBudgetReason = (reason: string) => BUDGET_REASON.test(reason);

/** Why this whole run compares nothing with anything, or null when it measured something. */
export function wholeRunCantCheck(run: Pick<Run, "controlPassed" | "result">): string | null {
  if (run.controlPassed !== true) return run.result.notMeasured.control ?? "Atlas's own known-case check did not match first";
  return run.result.notMeasured.wholeRun ?? null;
}

const MATCHED_MEANS = `"Matched" means the code did what you bet on in this one test, nothing more: read the changed lines before you accept them`;

/**
 * Whether the loop stops after these tries, and its plain sentence. Plain code on the verdicts of the person's target
 * bets; the server and verify both call this, so a stored stop that the tries do not earn fails verify.
 */
export function loopStopOf(tries: readonly LoopTry[], targetBets: readonly LoopTargetBet[], maxTries: number = LOOP_MAX_TRIES): LoopStop | null {
  const last = tries.at(-1);
  if (!last) return null;
  const capWords = `Atlas stopped: that was re-run ${tries.length} of ${maxTries}, the most it does per round. The rest is yours`;
  if (last.didNotFinish) {
    if (last.didNotFinish.budget) return { reason: "budget", says: `Atlas stopped: there is no budget left for another re-run (${last.didNotFinish.reason}). The rest is yours` };
    return tries.length >= maxTries ? { reason: "cap", says: `${capWords}. The last re-run did not finish, so it measured nothing (${last.didNotFinish.reason})` } : null;
  }
  const whole = last.run ? wholeRunCantCheck(last.run) : "the try has no run";
  if (whole !== null) return { reason: "cant_check", says: `Atlas stopped: this whole run is "can't check", so there is nothing to compare your answers with (${whole}). The rest is yours` };
  const mine = targetBets.map((t) => last.verdicts?.find((v) => v.betId === t.betId));
  const count = (o: Verdict["outcome"]) => mine.filter((v) => v?.outcome === o).length;
  if (mine.length > 0 && count("matched") === mine.length) return { reason: "all_matched", says: `Atlas stopped: every answer you sealed matched on re-run ${tries.length}. ${MATCHED_MEANS}` };
  if (count("not_matched") > 0) return tries.length >= maxTries ? { reason: "cap", says: `${capWords}. ${count("not_matched")} of your ${plural(mine.length, "answer")} still didn't match` } : null;
  if (count("matched") === 0) return { reason: "cant_check", says: `Atlas stopped: none of your answers could be checked on this run, so there is nothing to compare them with. The rest is yours` };
  return { reason: "nothing_left", says: `Atlas stopped: none of your answers is left as "didn't match", but ${mine.length - count("matched")} could not be checked on this run, so Atlas cannot say they matched. ${MATCHED_MEANS}` };
}
