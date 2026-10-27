// Day-5 review, S6 + m7: the scoreboard (the film's end frame and the proof card).
// S6: each bettor's name (a model's with its Meta model id, D10) and the outcome words (matched / didn't
//     match / can't check) are VISIBLE text, not only an aria-label. Before the fix the only visible text
//     was the question.
// m7: bets from two experiments on the same question are two marks, not one.
// Inputs: the real D04-04 rounds (tests/tools/scoreboard-cases.ts). No network, no model.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Bet, Verdict } from "../../src/types";
import { scoreboardMarks } from "../../web/machines/scoreboard/marks";
import { Scoreboard } from "../../web/machines/scoreboard/Scoreboard";
import { scoreboardCases } from "../tools/scoreboard-cases";

const [caseA, caseB] = scoreboardCases();
/** What a reader sees: the text nodes, with every attribute (aria-label included) removed. */
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("S6: names and outcomes are visible", () => {
  it("case A: 'You · didn't match' and the Meta model id with 'matched', in visible text", () => {
    const html = renderToStaticMarkup(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} still />);
    const text = visible(html);
    expect(text).toContain("muse-spark-1.3 · matched");
    expect(text).toMatch(/You · (didn't match|matched|can't check)/);
  });

  it("a display name keeps the model id beside it (D10)", () => {
    const text = visible(renderToStaticMarkup(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} names={{ "model:muse-spark-1.3": "Muse Spark 1.3" }} still />));
    expect(text).toContain("Muse Spark 1.3 (muse-spark-1.3) · matched");
    const already = visible(renderToStaticMarkup(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} names={{ "model:muse-spark-1.3": "Muse Spark 1.3 (muse-spark-1.3)" }} still />));
    expect(already).toContain("Muse Spark 1.3 (muse-spark-1.3) · matched");
    expect(already).not.toContain("(muse-spark-1.3) (muse-spark-1.3)");
  });

  it("case B shows every outcome it has in words, one line per bettor", () => {
    const html = renderToStaticMarkup(<Scoreboard verdicts={caseB!.verdicts} bets={caseB!.bets} still />);
    const lines = [...html.matchAll(/<li data-bettor="([^"]+)">([^<]*(?:<!-- -->[^<]*)*)<\/li>/g)].map((m) => m[2]!.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l).toMatch(/ · (matched|didn't match|can't check|no bet)$/);
  });
});

describe("m7: two experiments, one question → two marks", () => {
  it("before the fix the second experiment's bet was merged into the first mark", () => {
    const v = (betId: string, outcome: Verdict["outcome"]) => ({ betId, runId: "r", outcome, judgedBy: "src/judge.ts" }) as Verdict;
    const b = (id: string, experimentId: string) => ({ id, who: "human", measures: "calls", question: "calls?", experimentId }) as Bet;
    const marks = scoreboardMarks([v("h1", "not_matched"), v("h2", "matched")], [b("h1", "e1"), b("h2", "e2")]);
    expect(marks.map((m) => m.dots.map((d) => d.outcome))).toEqual([["not_matched"], ["matched"]]);
  });
});
