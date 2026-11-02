// Cold test: ordinary files should draw as a machine. Eleven realistic files of 2 to 8 functions, written for this measure, not for the router.
import { describe, expect, it } from "vitest";
import { drawMachine, machineParts } from "../../renderer/authors/machine";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";

import { FILES } from "../evidence/R5/realistic-files";

describe("ordinary files draw as a machine", () => {
  const results = Object.entries(FILES).map(([name, [src, lang, tested]]) => {
    const outline = fileOutline(src, lang);
    const m = { ...benchModel({ fileName: "p", outline, test: null, source: src, language: lang }), tested };
    const t0 = performance.now();
    const d = drawMachine(machineParts(m, outline, src, lang), { seed: name });
    const fits = (W: number, H: number) => d.minWords * Math.min(1.7, (W - 20) / d.width, (H - 20) / d.height) >= 11;
    return { fit1280: !d.tooMany && fits(806, 672), fit1440: !d.tooMany && fits(907, 852), name, parts: m.boxes.length, ok: !d.tooMany && d.problems.length === 0, ms: Math.round(performance.now() - t0), w: Math.round(d.width), h: Math.round(d.height), minWords: d.minWords, why: d.tooMany ?? d.problems[0] };
  });
  it("the measure", () => {
    console.log(JSON.stringify(results));
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(10);
    expect(results.find((r) => r.name === "latency")!.ok).toBe(true);
  });
  it("what the fallback says has no pipe's name in it", () => {
    for (const r of results) if (r.why) expect(r.why).not.toMatch(/->|pipe [a-z]+/);
  });
});
