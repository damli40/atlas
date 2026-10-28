// X2: the figure must draw outlines it has never seen. The live run at 058ab2a (16 parts, split files) found that the
// first routing rule could not stack its lines ("cannot be stacked without one passing through another"); the
// router now tries side jogs and L-shaped routes and breaks every such cycle. These tests draw 25 random outlines (the evidence run drew 200; review M3 made the suite's share lighter),
// and run the full Anatomy audit on seed 7, the one the reviewer's sweep failed on crowding (review minor 6).
import { describe, expect, it } from "vitest";
import { auditFigure, buildFigure, TooManyToDraw } from "../../web/machines/explorer/figure.mjs";
import { chalkText, CHALK_WORDS } from "../../web/machines/explorer/model";
import { randomModel } from "../tools/x2-random-outline";

describe("X2 figure on random outlines", () => {
  it("draws 25 random outlines (6–17 files, split files, up to 33 joins) without giving up", () => {
    const failed: string[] = [];
    for (let s = 1; s <= 25; s++) {
      const m = randomModel(s);
      try {
        let fig;
        try {
          fig = buildFigure(m);
        } catch (e) {
          if (e instanceof TooManyToDraw) continue; // listed instead: an honest outcome, not a failure
          throw e;
        }
        const drawn = new Set([...fig.svg.matchAll(/data-line="([^"]*)"/g)].map((x) => x[1]));
        if (drawn.size !== m.lines.length) failed.push(`seed ${s}: ${drawn.size} of ${m.lines.length} lines drawn`);
      } catch (e) {
        failed.push(`seed ${s}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  }, 300_000);

  it("the Anatomy audit passes on random outline seed 7 (it failed on crowding before lines were lifted)", () => {
    for (const s of [7]) {
      const a = auditFigure(buildFigure(randomModel(s)));
      if (!a.passed) console.log(`seed ${s}\n${a.report}`);
      expect(a.passed).toBe(true);
    }
  }, 300_000);

  it("a chalk tag says Wonder's words once, then plain code's reason", () => {
    expect(chalkText({ words: CHALK_WORDS, reason: `${CHALK_WORDS}: it found no import` })).toBe(`${CHALK_WORDS}: it found no import.`);
    expect(chalkText({ words: CHALK_WORDS, reason: "" })).toBe(`${CHALK_WORDS}.`);
    expect(chalkText({ words: CHALK_WORDS, reason: "a type-only import" })).toBe(`${CHALK_WORDS}. a type-only import.`);
  });
});
