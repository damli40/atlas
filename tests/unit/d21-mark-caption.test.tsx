// D21: under the scoreboard, wherever it is drawn, a visible caption says the mark is the pre-existing Atlas
// logo and that the scoreboard drawing it was built during the hackathon.
//
// Plain words: the caption lives inside the Scoreboard component, so a screen cannot draw the scoreboard
// without it. This test renders every place the scoreboard appears (the verdict screen, shared by the fixture
// and Moonwell flows, and the proof card, which is the end frame) from real recorded rounds and checks the
// caption is there as visible text, right after the marks. It also checks, from the source, that no other file
// draws the mark itself (the <Mark> part) or the scoreboard without going through the component.

import "../tools/jsdom-globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARK_PRE_EXISTING_CAPTION } from "../../src/captions";
import type { AtlasFile } from "../../src/types";
import { ProofCard } from "../../web/screens/ProofCard";
import { VerdictScreen } from "../../web/screens/Verdict";

const ROOT = join(__dirname, "../..");
const load = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as AtlasFile;
const FILES = {
  fixture: load("tests/evidence/D04-04/fixture-eRopGsrp2a.atlas.json"),
  moonwell: load("tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json"),
};
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

/** The caption is visible text and comes straight after the scoreboard (its next element). */
function expectCaptionUnderScoreboard(d: Document) {
  const boards = [...d.querySelectorAll('[data-testid="scoreboard"]')];
  expect(boards.length).toBeGreaterThan(0);
  for (const sb of boards) {
    const next = sb.nextElementSibling;
    expect(next?.getAttribute("data-testid")).toBe("sb-premark");
    expect(next?.textContent).toBe(MARK_PRE_EXISTING_CAPTION);
    expect(next?.hasAttribute("hidden")).toBe(false);
    expect(next?.getAttribute("aria-hidden")).toBeNull();
  }
}

describe("D21: the pre-existing-logo caption under the scoreboard", () => {
  it("says exactly what D21 decided", () => {
    expect(MARK_PRE_EXISTING_CAPTION).toBe(
      "Mark: the Atlas logo, designed Oct 26 (pre-existing). The scoreboard that draws it from the verdicts was built during the hackathon.",
    );
  });

  for (const [name, f] of Object.entries(FILES)) {
    it(`verdict screen (${name} round): caption under the scoreboard`, () => {
      const result = { run: f.runs[0]!, verdicts: f.verdicts, bets: f.bets, betsFrozenAt: f.createdAt };
      expectCaptionUnderScoreboard(doc(renderToStaticMarkup(<VerdictScreen shown={[]} modelShown={[]} modelName="Muse Spark 1.3 (muse-spark-1.3)" result={result} />)));
    });

    it(`proof card, the end frame (${name} round): caption under the scoreboard`, () => {
      const d = doc(renderToStaticMarkup(<ProofCard file={f} />));
      expectCaptionUnderScoreboard(d);
      // On the card it sits in the hero section with the mark, not in a footer far from it.
      expect(d.querySelector('section.pc-hero [data-testid="sb-premark"]')).not.toBeNull();
    });
  }

  it("no screen draws the mark or the scoreboard except through the Scoreboard component", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
      });
    // Scoreboard.tsx draws it; marks.ts only computes the geometry (it defines scoreboardMarks).
    const sources = walk(join(ROOT, "web")).filter((p) => !p.endsWith(join("scoreboard", "Scoreboard.tsx")) && !p.endsWith(join("scoreboard", "marks.ts")));
    const offenders = sources.filter((p) => {
      const s = readFileSync(p, "utf8");
      return /<Mark[\s/>]/.test(s) || /\bscoreboardMarks\(/.test(s) || /className="sb"/.test(s);
    });
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });
});
