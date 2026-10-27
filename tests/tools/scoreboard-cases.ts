// D05-01's two acceptance cases for the scoreboard, as verdicts on one question each, in the same
// shape src/judge.ts writes. Used by tests/unit/machines-scoreboard.test.tsx and the evidence page.

import type { Bet, Verdict } from "../../src/types.ts";
import { QUESTION_TEXT } from "../../src/gate.ts";

/** The two acceptance cases, as verdicts on one question each (the same shape the judge writes). */
export function scoreboardCases(): { title: string; verdicts: Verdict[]; bets: Pick<Bet, "id" | "who" | "measures" | "question">[] }[] {
  const mk = (title: string, person: Verdict["outcome"], model: Verdict["outcome"]) => ({
    title,
    bets: [
      { id: "p", who: "human" as const, measures: "calls", question: QUESTION_TEXT.calls },
      { id: "m", who: "model:muse-spark-1.3" as const, measures: "calls", question: QUESTION_TEXT.calls },
    ],
    verdicts: [
      { betId: "p", runId: "r", outcome: person, judgedBy: "src/judge.ts" as const },
      { betId: "m", runId: "r", outcome: model, judgedBy: "src/judge.ts" as const },
    ],
  });
  return [mk("person: didn't match · model: matched", "not_matched", "matched"), mk("person: matched · model: can't check", "matched", "cant_check")];
}
