// D05-01: the scoreboard IS the Atlas mark, drawn from Verdict[] and who placed each bet, and nothing
// else. Acceptance: snapshot {person: didn't match, model: matched} fills the model's hollow dot and
// stops the person's line short of the bar; {person: matched, model: can't check} runs the person's
// line onto the bar and draws the model as an outline with a level dash and a dashed faint line;
// under prefers-reduced-motion the end state renders with no animation classes. Wired into the
// verdict screen of both flows (VerdictScreen is shared by the fixture flow and Moonwell).

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { AtlasFile } from "../../src/types";
import { MARK, scoreboardMarks } from "../../web/machines/scoreboard/marks";
import { Scoreboard } from "../../web/machines/scoreboard/Scoreboard";
import { VerdictScreen } from "../../web/screens/Verdict";
import { scoreboardCases } from "../tools/scoreboard-cases";

const [caseA, caseB] = scoreboardCases();
const ROOT = join(__dirname, "../..");

const setReducedMotion = (on: boolean) => {
  (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} });
};
afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  document.body.innerHTML = "";
});

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

describe("D05-01 scoreboard as the mark", () => {
  it("person didn't match, model matched: the hollow dot fills, the solid dot's line stops short of the bar", () => {
    const html = renderToStaticMarkup(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} still />);
    expect(html).toMatchSnapshot();
    const [mark] = scoreboardMarks(caseA!.verdicts, caseA!.bets);
    const person = mark!.dots.find((d) => d.kind === "person")!;
    const model = mark!.dots.find((d) => d.kind === "model")!;
    expect(model.filled).toBe(true);
    expect(model.line!.reachesBar).toBe(true);
    expect(model.line!.y2).toBe(MARK.barY);
    expect(person.filled).toBe(true); // the person's dot stays solid: that is who they are, not a verdict
    expect(person.line!.reachesBar).toBe(false);
    expect(person.line!.y2).toBeLessThan(MARK.barY - 10);
    // In the markup: the model's dot is a filled circle, and only one line carries data-reaches-bar.
    const host = mount(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} still />);
    expect(host.querySelector('[data-bettor="model:muse-spark-1.3"] circle.sb-dot[data-filled]')).not.toBeNull();
    expect(host.querySelector('[data-bettor="human"] .sb-line[data-reaches-bar]')).toBeNull();
    expect(host.querySelectorAll(".sb-line[data-reaches-bar]").length).toBe(1);
  });

  it("person matched, model can't check: the person's line lands on the bar; the model is an outline with a level dash and a dashed faint line", () => {
    const html = renderToStaticMarkup(<Scoreboard verdicts={caseB!.verdicts} bets={caseB!.bets} still />);
    expect(html).toMatchSnapshot();
    const host = mount(<Scoreboard verdicts={caseB!.verdicts} bets={caseB!.bets} still />);
    expect(host.querySelector('[data-bettor="human"] .sb-line[data-reaches-bar]')).not.toBeNull();
    const model = host.querySelector('[data-bettor="model:muse-spark-1.3"]')!;
    expect(model.querySelector("circle.sb-ring")).not.toBeNull();
    expect(model.querySelector("circle.sb-dot")).toBeNull();
    expect(model.querySelector(".sb-noreading")).not.toBeNull();
    const line = model.querySelector(".sb-line")!;
    expect(line.hasAttribute("data-dashed")).toBe(true);
    expect(line.hasAttribute("data-faint")).toBe(true);
    expect(line.hasAttribute("data-reaches-bar")).toBe(false);
    // No new words: the mark itself carries no text, only an aria-label from the existing verdict words.
    expect(model.closest("svg")!.querySelector("text")).toBeNull();
    expect(model.closest("svg")!.getAttribute("aria-label")).toBe("You: matched. muse-spark-1.3: can't check");
  });

  it("prefers-reduced-motion: the end state on first paint, with no animation classes", () => {
    setReducedMotion(true);
    const host = mount(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} />);
    expect(host.querySelector("[data-still]")).not.toBeNull();
    expect(host.innerHTML).not.toMatch(/sb-grow|sb-fade|sb-fill|animation-delay/);
    expect(host.querySelector('[data-bettor="model:muse-spark-1.3"] circle.sb-dot[data-filled]')).not.toBeNull();
    // Control: without the setting, the same verdicts animate (so the check above can fail).
    document.body.innerHTML = "";
    setReducedMotion(false);
    const moving = mount(<Scoreboard verdicts={caseA!.verdicts} bets={caseA!.bets} />);
    expect(moving.innerHTML).toMatch(/sb-grow/);
    expect(moving.innerHTML).toMatch(/sb-fill/);
  });

  it("is drawn from the verdicts only: a bettor with no judged bet gets a faint outline and no line", () => {
    const marks = scoreboardMarks([caseA!.verdicts[0]!], caseA!.bets);
    const model = marks[0]!.dots.find((d) => d.kind === "model")!;
    expect(model.outcome).toBeNull();
    expect(model.line).toBeNull();
    expect(model.filled).toBe(false);
    expect(scoreboardMarks([], caseA!.bets)).toEqual([]);
  });

  it("is wired into the verdict screen (both flows use it), one mark per question, from the real D04-04 round", () => {
    const f = JSON.parse(readFileSync(join(ROOT, "tests/evidence/D04-04/fixture-GFNRq1eJx7.atlas.json"), "utf8")) as AtlasFile;
    const result = { run: f.runs[0]!, verdicts: f.verdicts, bets: f.bets, betsFrozenAt: f.createdAt };
    setReducedMotion(true);
    const host = mount(<VerdictScreen shown={[]} modelShown={[]} modelName="Muse Spark 1.3 (muse-spark-1.3)" result={result} />);
    const marks = host.querySelectorAll('[data-testid="scoreboard"] svg.sb-mark');
    expect(marks.length).toBe(3);
    // totalWaitMs: the person bet 15000 (didn't match), Spark 12000 (matched).
    const wait = host.querySelector('svg.sb-mark[data-measures="totalWaitMs"]')!;
    expect(wait.querySelector('[data-bettor="human"]')!.getAttribute("data-outcome")).toBe("not_matched");
    expect(wait.querySelector('[data-bettor="model:muse-spark-1.3"]')!.getAttribute("data-outcome")).toBe("matched");
    expect(wait.getAttribute("aria-label")).toBe("You: didn't match. Muse Spark 1.3 (muse-spark-1.3): matched");
  });
});
