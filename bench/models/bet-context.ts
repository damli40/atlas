// B1 (D35) bench M: the exact text a model gets before it bets on a pasted function. Pure (no I/O, no clock).
//
// Plain words: D19 says a model sees exactly what the person sees before betting, nothing more. For a pasted
// round that is: the whole pasted file (numbered), the sentence saying what Atlas will call and what each stand-in
// does, how Atlas runs code (one call, sandbox, virtual clock, watch limit, the four endings), and the questions.
// Both the call sentence and the questions are written by plain code in src/gate.ts (describeCall, questionsFor),
// the same functions the paste screen and the server use.
//
// Why this file exists: when this bench was written (Oct 28), main had no bet-context builder for PASTED rounds.
// The server's "seen context" prompt (server/meta/roles/claimant-bets.ts, buildBetOnlyMessages with seenContext)
// ends with BET_INSTRUCTION, which is Moonwell's ("Give your best estimate in USD..."), so it cannot be reused as
// is. This builder keeps that prompt's frame (the same system preamble, heading, question list, task and answer
// format) and swaps only the instruction for a unit-free one. Batch E3 will provide the canonical pasted-round
// builder; switching to it requires an amendment file committed before the live run (bench/models/PASS-RULE.md).

import { describeCall, questionsFor, renderQuestions, CALL_DEFAULT_WATCH_LIMIT_MS, type Question } from "../../src/gate.ts";
import type { PastedLanguage } from "../../src/pasted-code.ts";
import type { ExperimentShape } from "../../src/types.ts";
import { SYSTEM_PREAMBLE, numbered } from "../../server/meta/roles/claimant.ts";
import { SEEN_CONTEXT_HEADING } from "../../server/meta/roles/claimant-bets.ts";

type CallParams = Extract<ExperimentShape, { shape: "call-function" }>;

export interface ChatMessageLike {
  role: "system" | "user" | "assistant";
  content: string;
}

const LANGUAGE_NAME: Record<PastedLanguage, string> = { js: "JavaScript", ts: "TypeScript", py: "Python" };

/** The bet instruction for pasted rounds: the same rule as D22 (best estimate, decline only with a reason), no unit. */
export const PASTED_BET_INSTRUCTION =
  "Give your best prediction for every question. Decline only if you cannot form any prediction at all; if you decline, say why.";

/** What the person sees on the paste screen before betting, as text. */
export function pastedSeenContext(input: { source: string; language: PastedLanguage; params: CallParams }): string {
  const lineCount = input.source.split("\n").length;
  const watch = input.params.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS;
  return [
    `THE PASTED CODE (${LANGUAGE_NAME[input.language]}, the whole file, lines 1-${lineCount}):`,
    numbered(input.source, 1, lineCount),
    "",
    "WHAT ATLAS WILL DO",
    describeCall(input.params),
    "",
    "HOW ATLAS RUNS IT",
    "- Atlas calls the function once, in a sandbox: no network, no files, no packages.",
    "- A stand-in is a fake function Atlas passes in; its answer on each call is fixed in advance, as described above.",
    `- Atlas's clock is virtual: waits (timers, sleeps, a stand-in's delay) cost no real time. It starts at 2026-01-01T00:00:00Z. Atlas watches for at most ${watch} ms of virtual time.`,
    '- How the call ends is one of "returned", "threw", "never_settled" (still waiting with nothing left that could wake it) or "still_running_at_watch_limit" (still working when the watch limit ran out).',
    "- The returned value is compared as JSON with keys sorted.",
  ].join("\n");
}

/** The questions for one pasted call (plain code, src/gate.ts). */
export function pastedQuestions(params: CallParams): Question[] {
  return questionsFor(params);
}

/** The full prompt one model gets for one test. Same frame as the server's seen-context prompt. */
export function pastedBetMessages(input: { source: string; language: PastedLanguage; params: CallParams }): ChatMessageLike[] {
  const user = [
    SEEN_CONTEXT_HEADING,
    pastedSeenContext(input),
    "",
    "QUESTIONS (written by plain code; a person answers the same ones)",
    renderQuestions(pastedQuestions(input.params)),
    "",
    "TASK",
    "Bet on what this experiment's run will measure:",
    "exactly one bet per question, using the answer JSON shown for it.",
    PASTED_BET_INSTRUCTION,
    'To decline, bet {"kind":"declined","reason":"unknown: <why>"}.',
    "",
    "Return only this JSON object:",
    '{"bets": [{"measures": "<field>", "answer": {...}, "rationale": "<one or two sentences>"}]}',
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PREAMBLE },
    { role: "user", content: user },
  ];
}
