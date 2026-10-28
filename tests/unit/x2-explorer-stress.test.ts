// X2: the figure must draw outlines it has never seen. The live run at 058ab2a (16 parts, split files) found that the
// first routing rule could not stack its lines ("cannot be stacked without one passing through another"); the
// router now tries side jogs and L-shaped routes and breaks every such cycle. These tests draw 50 random outlines (the evidence run drew 200),
// and run the full Anatomy audit on one (the audit takes seconds each; the evidence run audited 30).
import { describe, expect, it } from "vitest";
import { auditFigure, buildFigure } from "../../web/machines/explorer/figure.mjs";
import { chalkText, CHALK_WORDS } from "../../web/machines/explorer/model";
import { randomModel } from "../tools/x2-random-outline";

describe("X2 figure on random outlines", () => {
  it("draws 50 random outlines (6–17 files, split files, up to 33 joins) without giving up", () => {
    const failed: string[] = [];
    for (let s = 1; s <= 50; s++) {
      const m = randomModel(s);
      try {
        const fig = buildFigure(m);
        const drawn = new Set([...fig.svg.matchAll(/data-line="([^"]*)"/g)].map((x) => x[1]));
        if (drawn.size !== m.lines.length) failed.push(`seed ${s}: ${drawn.size} of ${m.lines.length} lines drawn`);
      } catch (e) {
        failed.push(`seed ${s}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  }, 300_000);

  it("the Anatomy audit passes on a random outline", () => {
    for (const s of [3]) {
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
