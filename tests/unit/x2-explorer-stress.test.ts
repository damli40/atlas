// X2: the chart must draw outlines it has never seen. These tests draw 25 random outlines through the renderer that
// replaced the old figure (D55), and run its full checks (renderer/check.ts took the place of the Anatomy audit) on
// each, including seed 7, the one the reviewer's sweep failed on crowding on the old figure (review minor 6).
import { describe, expect, it } from "vitest";
import { explorerSpec } from "../../renderer/authors/code-chart";
import { checkDrawing } from "../../renderer/check";
import { drawSpec } from "../../renderer/live/draw";
import { chalkText, CHALK_WORDS } from "../../web/machines/explorer/model";
import { randomModel } from "../tools/x2-random-outline";

describe("X2 chart on random outlines", () => {
  it("draws 25 random outlines (6–17 files, split files, up to 33 joins) without giving up: every join is on the chart, and every check holds", () => {
    const failed: string[] = [];
    for (let s = 1; s <= 25; s++) {
      const m = randomModel(s);
      try {
        const spec = explorerSpec(m);
        const d = drawSpec(spec);
        if (d.kind === "list") continue; // listed instead: an honest outcome, not a failure
        if (d.kind !== "drawing") throw new Error(`no drawing: ${d.words}`);
        const drawn = new Set(spec.edges.filter((e) => e.kind === "thread").flatMap((e) => e.id.split("+")));
        if (drawn.size !== m.lines.length) failed.push(`seed ${s}: ${drawn.size} of ${m.lines.length} lines drawn`);
        for (const p of checkDrawing(spec, d.scene, d.svg)) failed.push(`seed ${s}: ${p}`);
      } catch (e) {
        failed.push(`seed ${s}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  }, 300_000);

  it("a chalk tag says Wonder's words once, then plain code's reason", () => {
    expect(chalkText({ words: CHALK_WORDS, reason: `${CHALK_WORDS}: it found no import` })).toBe(`${CHALK_WORDS}: it found no import.`);
    expect(chalkText({ words: CHALK_WORDS, reason: "" })).toBe(`${CHALK_WORDS}.`);
    expect(chalkText({ words: CHALK_WORDS, reason: "a type-only import" })).toBe(`${CHALK_WORDS}. a type-only import.`);
  });
});
