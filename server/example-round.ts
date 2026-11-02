// R7 (D69): the built-in example's round, recorded once from real Meta calls (server/example-round.json, written by
// tests/evidence/R7/record-example.mts on 2026-11-02; R9 added answers recorded from the text with the file summary, the same day, by
// tests/evidence/R9/record-example.mts). So the first screen's demo path calls no model: nothing to fail, no cost.
//
// Plain words on trust:
// - The recorded answers are replayed through the SAME plain code as a live answer: Wonder's tests through the proposer's
//   checks and the gate, each bettor's answer through the bet checks and the seal. Nothing here decides a verdict.
// - A bettor's recorded answer is used only when the prompt it would get now is byte for byte the prompt it got when
//   recorded (its sha256). Any change to the text (another question, a label from an earlier run, names left off) and
//   the model is asked live, as on any other code. So a recorded answer was always sealed from the same text the person
//   sees, and it was recorded before any person answered.
// - The page is told which answers are recorded (ModelSlot.recorded) and must say so on screen. Never shown as live.
import { createHash } from "node:crypto";
import RECORDED from "./example-round.json";
import type { ChatArgs, ChatResult } from "./meta/client";
import { NO_USAGE } from "./meta/roles/claimant";

/** The day the example's answers were recorded (ISO date). */
export const EXAMPLE_RECORDED_ON: string = RECORDED.recordedOn;

export const promptSha256 = (messages: ChatArgs["messages"]): string => createHash("sha256").update(JSON.stringify(messages)).digest("hex");

/** Muse Wonder's kept answer for the example's tests, as a chat that makes no call. Null when none is kept for this model. */
export function recordedTestsChat(model: string): ((a: ChatArgs) => Promise<ChatResult>) | null {
  if (RECORDED.tests.model !== model) return null;
  return async () => ({ ok: true, content: RECORDED.tests.content, finishReason: "stop", usage: NO_USAGE });
}

/** The recorded bet answer for exactly this prompt from this model, or null. */
export function recordedBet(model: string, messages: ChatArgs["messages"]): string | null {
  const sha = promptSha256(messages);
  return RECORDED.bets.find((b) => b.model === model && b.promptSha256 === sha)?.content ?? null;
}
