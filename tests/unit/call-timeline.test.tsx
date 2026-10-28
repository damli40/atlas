// E3: the call timeline, a generic machine for any pasted function, drawn ONLY from one run.
// - model.ts imports nothing but the Run type and the pure src/trust.ts rule (no experiment, no bet, no model).
// - Real runs (played through the real routes on the local sandbox; no model): each case's rails, pegs, marks
//   and end token equal what the trace and the measured fields say, and nothing else is drawn.
// - controlPassed false, a whole-run "can't check" and a sandbox that did not finish: nothing is drawn, no number,
//   the card prints the reason (the day-5 blocker was machines ignoring controlPassed).
// - Every drawn part is in the manifest; a run with more pegs than the rail holds is not drawn, with the reason.
// - Reduced motion paints the end state; a held moment shows only what happened by then.

import "../tools/jsdom-globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { Run } from "../../src/types";
import { CallTimeline } from "../../web/machines/calltimeline/CallTimeline";
import { MAX_PEGS, PARTS, pegXs, timelineGeometry } from "../../web/machines/calltimeline/geometry";
import { niceStep, timelineModel } from "../../web/machines/calltimeline/model";
import { TIMELINE_CASES, playCase, type PlayedCase } from "../tools/timeline-cases";

const ROOT = join(__dirname, "../..");
const runs = new Map<string, PlayedCase>();
beforeAll(async () => {
  const app = createApp();
  for (const c of TIMELINE_CASES) runs.set(c.id, await playCase(app, c));
}, 120_000);

const html = (run: Run, extra: { at?: number } = {}) => renderToStaticMarkup(<CallTimeline run={run} still theme="light" {...extra} />);
const count = (h: string, re: RegExp) => [...h.matchAll(re)].length;
const shownPegs = (h: string) => [...h.matchAll(/<g class="ct-peg" data-t="([^"]+)" data-mark="([^"]+)"( style="display:none")?/g)].map((m) => ({ t: Number(m[1]), mark: m[2]!, hidden: m[3] !== undefined }));
const traceOf = (r: PlayedCase, ev: string) => r.run.trace.filter((e) => e.event === ev);

describe("E3 call timeline: inputs", () => {
  it("model.ts imports only the Run type and the pure trust rule", () => {
    const src = readFileSync(join(ROOT, "web/machines/calltimeline/model.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(imports).toEqual(['import type { Run } from "../../../src/types";', 'import { notShownAsFact } from "../../../src/trust";']);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
    // The component takes a run, nothing else that could carry a bet or a model's words.
    const comp = readFileSync(join(ROOT, "web/machines/calltimeline/CallTimeline.tsx"), "utf8");
    expect(comp).not.toMatch(/\b(bets|verdicts|claim|rationale)\b\s*[:=]/);
  });
});

describe("E3 call timeline: real runs", () => {
  it("throws then returns: one rail (fetchIt), a slash peg at 0 ms and a dot peg at 100 ms, a dot token at 100 ms", () => {
    const r = runs.get("throws-then-returns")!;
    expect(r.run.controlPassed).toBe(true);
    const m = timelineModel(r.run);
    expect(m.notShown).toBeNull();
    expect(m.lanes.map((l) => l.name)).toEqual(["fetchIt"]);
    expect(m.lanes[0]!.calls.map((c) => [c.t, c.answer])).toEqual([
      [0, "threw"],
      [100, "returned"],
    ]);
    expect(m.lanes[0]!.measured).toBe(r.run.result.measured["calls:fetchIt"]);
    expect(m.end).toEqual({ kind: "returned", t: 100, json: '{"ok":true}', type: "object" });
    const h = html(r.run);
    expect(count(h, /data-part="lane-rail"/g)).toBe(1);
    expect(count(h, /data-part="peg"/g)).toBe(traceOf(r, "stand_in_call").length);
    expect(shownPegs(h).map((p) => p.mark)).toEqual(["threw", "returned"]);
    expect(h).toContain('data-kind="returned"');
    expect(h).toContain("returned at 100 ms: {&quot;ok&quot;:true}");
    expect(h).toContain("fetchIt: 2 calls (1 returned, 1 threw)");
  });

  it("always throws: 3 slash pegs at 0, 100 and 300 ms; a slash token at 700 ms (the code waits once more after the last call)", () => {
    const r = runs.get("always-throws")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls.map((c) => [c.t, c.answer])).toEqual([
      [0, "threw"],
      [100, "threw"],
      [300, "threw"],
    ]);
    expect(m.end).toMatchObject({ kind: "threw", t: 700, name: "TimeoutError" });
    expect(html(r.run)).toContain('data-kind="threw"');
  });

  it("never answers: a dark peg with no mark, and a ring token where the run went quiet", () => {
    const r = runs.get("never-answers")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls.map((c) => c.answer)).toEqual(["threw", "never_answered"]);
    expect(m.end).toEqual({ kind: "never_settled", t: 100 });
    const h = html(r.run);
    expect(h).toContain('data-kind="never_settled"');
    expect(h).toContain("never settled");
  });

  it("a late answer draws a rib from the call (0 ms) to the answer (250 ms)", () => {
    const r = runs.get("late-answer")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls).toEqual([{ n: 1, t: 0, answer: "returned", answeredAt: 250, afterEnd: false }]);
    const h = html(r.run);
    expect(count(h, /data-part="answer-bar"/g)).toBe(1);
    expect(h).toContain('class="ct-bar" data-t="250"');
  });

  it("still running at the watch limit: the token stands at the stop with two bars; the final count is not claimed", () => {
    const r = runs.get("still-running")!;
    expect(r.run.result.measured.outcome).toBe("still_running_at_watch_limit");
    const m = timelineModel(r.run);
    expect(m.end).toEqual({ kind: "still_running", t: 5000 });
    expect(m.lanes[0]!.measured).toBeNull();
    expect(m.lanes[0]!.notMeasured).toMatch(/final count was not seen/);
    expect(m.detail).toMatch(/calls seen \(final count not claimed\)/);
    expect(html(r.run)).toContain('data-kind="still_running"');
  });

  it("no stand-in and no wait: only the function's rail; the ruler has no ticks; the caption says everything was at 0 ms", () => {
    const r = runs.get("no-wait")!;
    const m = timelineModel(r.run);
    expect(m.lanes).toEqual([]);
    expect(m.allAtZero).toBe(true);
    const h = html(r.run);
    expect(count(h, /data-part="lane-rail"/g)).toBe(0);
    expect(count(h, /data-part="peg"/g)).toBe(0);
    expect(h).toContain("Everything happened at 0 ms of virtual time");
  });

  it("two stand-ins: two rails, named in the caption from the front, each with its own peg and rib", () => {
    const r = runs.get("two-stand-ins")!;
    const m = timelineModel(r.run);
    expect(m.lanes.map((l) => l.name)).toEqual(["a", "b"]);
    expect(m.end).toMatchObject({ kind: "returned", t: 120, json: '"b"' });
    const h = html(r.run);
    expect(count(h, /data-part="lane-rail"/g)).toBe(2);
    expect(h).toContain("from the front: a, b");
  });

  it("a held moment shows only what happened by then (the sled at 50 ms: the 100 ms peg and token hidden)", () => {
    const r = runs.get("throws-then-returns")!;
    const h = renderToStaticMarkup(<CallTimeline run={r.run} theme="light" at={50} />);
    expect(shownPegs(h)).toEqual([
      { t: 0, mark: "threw", hidden: false },
      { t: 100, mark: "returned", hidden: true },
    ]);
    expect(h).toMatch(/class="ct-end" data-t="100" data-kind="returned" style="display:none"/);
  });

  it("every drawn part is in the manifest, and every manifest name is drawn by some case", () => {
    const drawn = new Set<string>();
    for (const r of runs.values()) for (const m of html(r.run).matchAll(/data-part="([^"]+)"/g)) drawn.add(m[1]!);
    for (const p of drawn) expect(PARTS as readonly string[]).toContain(p);
    expect([...drawn].sort()).toEqual([...PARTS].sort());
  });
});

describe("E3 call timeline: never shown as fact when the run cannot be", () => {
  const base = () => runs.get("throws-then-returns")!.run;
  it("controlPassed false: no drawing, no number, the reason printed", () => {
    const run: Run = { ...base(), controlPassed: false, result: { ...base().result, notMeasured: { ...base().result.notMeasured, control: "case C3: virtualMs 101, expected 100" } } };
    const m = timelineModel(run);
    expect(m).toMatchObject({ lanes: [], end: null, readout: "" });
    const h = html(run);
    expect(h).toContain('data-testid="call-timeline-cant-check"');
    expect(h).toContain("case C3: virtualMs 101, expected 100");
    expect(h).not.toContain("<svg");
    expect(h).not.toContain("returned at");
  });

  it("controlPassed missing (an old or edited file): nothing drawn", () => {
    const run = { ...base(), controlPassed: undefined } as unknown as Run;
    expect(html(run)).toContain("the run has no control result");
  });

  it("a whole-run can't check (the code needs a package): nothing drawn, the reason printed", () => {
    const run: Run = { ...base(), result: { measured: { outcome: "returned", virtualMs: 0 }, notMeasured: { wholeRun: "the code needs axios; Atlas runs one pasted file on its own, with no packages or other modules" } } };
    const h = html(run);
    expect(h).toContain("the code needs axios");
    expect(h).not.toContain("<svg");
  });

  it("a run with no trace: nothing drawn", () => {
    expect(html({ ...base(), trace: [] })).toContain("the run recorded no trace");
  });
});

describe("E3 call timeline: geometry limits", () => {
  it("pegs at the same moment stand side by side in call order, marked as nudged", () => {
    const xs = pegXs([0, 0, 0], (t) => t);
    expect(xs.map((p) => p.nudged)).toEqual([false, true, true]);
    expect(xs[1]!.x - xs[0]!.x).toBeCloseTo(xs[2]!.x - xs[1]!.x);
  });

  it("a rail with more calls than it holds is not drawn: the card says why and gives the counts", () => {
    const r = runs.get("throws-then-returns")!.run;
    const calls = Array.from({ length: MAX_PEGS + 1 }, (_, i) => [
      { t: i, event: "stand_in_call", data: { name: "fetchIt", n: i + 1 } },
      { t: i, event: "stand_in_throws", data: { name: "fetchIt", n: i + 1, errorName: "E" } },
    ]).flat();
    const run: Run = { ...r, trace: [{ t: 0, event: "start", data: { exportName: "f", args: 1, watchLimitMs: 30000 } }, ...calls, { t: MAX_PEGS, event: "threw", data: { type: "Error" } }], result: { measured: { outcome: "threw", virtualMs: MAX_PEGS, [`calls:fetchIt`]: MAX_PEGS + 1 }, notMeasured: {} } };
    expect(timelineGeometry(timelineModel(run)).tooMany).toMatch(/fetchIt was called \d+ times/);
    const h = html(run);
    expect(h).toContain('data-testid="call-timeline-too-many"');
    expect(h).not.toContain("<svg");
  });

  it("the ruler's ticks are 1, 2 or 5 × 10^k, at most 6 majors", () => {
    expect(niceStep(100, 6)).toBe(20);
    expect(niceStep(700, 6)).toBe(200);
    expect(niceStep(5000, 6)).toBe(1000);
  });
});
