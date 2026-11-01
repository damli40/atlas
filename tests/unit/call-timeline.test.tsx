// E3: the call timeline's model (web/machines/calltimeline/model.ts), still read by the bench (web/machines/bench/play.ts),
// and, since the old figure was removed (R3 M1), the same real runs through the drawing that took its place: the "what
// happened" author (renderer/authors/what-happened.ts).
// - model.ts imports nothing but the Run type and the pure src/trust.ts rule (no experiment, no bet, no model).
// - Real runs (played through the real routes on the local sandbox; no model): the path says what the trace and the
//   measured fields say, and nothing else is drawn.
// - controlPassed false, a whole-run "can't check" and a sandbox that did not finish: nothing is drawn, no number, the
//   reason is printed (the day-5 blocker was machines ignoring controlPassed).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { whatHappened } from "../../renderer/authors/what-happened";
import { drawSpec } from "../../renderer/live/draw";
import type { RenderSpec } from "../../renderer/spec";
import { specProblems } from "../../renderer/spec";
import { createApp } from "../../server/app";
import type { Run } from "../../src/types";
import { niceStep, timelineModel } from "../../web/machines/calltimeline/model";
import { TIMELINE_CASES, playCase, type PlayedCase } from "../tools/timeline-cases";

const ROOT = join(__dirname, "../..");
const runs = new Map<string, PlayedCase>();
beforeAll(async () => {
  const app = createApp();
  for (const c of TIMELINE_CASES) runs.set(c.id, await playCase(app, c));
}, 120_000);

const path = (run: Run) => whatHappened({ run, bets: [], verdicts: [] });
const said = (s: RenderSpec) => s.nodes.map((n) => n.words);
const threads = (s: RenderSpec) => s.edges.map((e) => e.words).filter(Boolean);
const captions = (s: RenderSpec) => s.captions.map((c) => c.words).join(" | ");
const calledTickets = (s: RenderSpec, name: string) => s.nodes.filter((n) => n.words === `called ${name}`).length;

describe("E3 call timeline: inputs", () => {
  it("model.ts imports only the Run type and the pure trust rule", () => {
    const src = readFileSync(join(ROOT, "web/machines/calltimeline/model.ts"), "utf8");
    const imports = [...src.matchAll(/^\s*import\s[^;]*;/gm)].map((m) => m[0].trim());
    expect(imports).toEqual(['import type { Run } from "../../../src/types";', 'import { notShownAsFact } from "../../../src/trust";']);
    expect(src).not.toMatch(/\brequire\(|\bimport\(/);
  });
});

describe("E3 call timeline: real runs", () => {
  it("throws then returns: a throw at 0 ms and an answer at 100 ms; the path counts what the run measured", () => {
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
    const s = path(r.run);
    expect(specProblems(s)).toEqual([]);
    expect(said(s)).toEqual(["called fetchIt", "waited 100 ms", "called fetchIt", 'returned {"ok":true}']);
    expect(threads(s)).toEqual(["threw TimeoutError", "answered"]);
    expect(calledTickets(s, "fetchIt")).toBe(r.run.result.measured["calls:fetchIt"]);
    expect(calledTickets(s, "fetchIt")).toBe(r.run.trace.filter((e) => e.event === "stand_in_call").length);
  });

  it("always throws: 3 throws at 0, 100 and 300 ms; it threw at 700 ms (the code waits once more after the last call)", () => {
    const r = runs.get("always-throws")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls.map((c) => [c.t, c.answer])).toEqual([
      [0, "threw"],
      [100, "threw"],
      [300, "threw"],
    ]);
    expect(m.end).toMatchObject({ kind: "threw", t: 700, name: "TimeoutError" });
    const s = path(r.run);
    expect(said(s)).toEqual(["called fetchIt", "waited 100 ms", "called fetchIt", "waited 200 ms", "called fetchIt", "waited 400 ms", "threw TimeoutError at 700 ms"]);
    expect(s.nodes.at(-1)!.pin).toBe("red");
  });

  it("never answers: the answer is 'never answered', the ending says nothing could wake it, no time is invented for it", () => {
    const r = runs.get("never-answers")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls.map((c) => c.answer)).toEqual(["threw", "never_answered"]);
    expect(m.end).toEqual({ kind: "never_settled", t: 100 });
    const s = path(r.run);
    expect(threads(s)).toEqual(["threw TimeoutError", "never answered"]);
    expect(s.nodes.at(-1)!.words).toBe("still waiting when Atlas stopped: nothing was left to wake it");
    expect(s.nodes.at(-1)!.words).not.toMatch(/ms/);
    expect(captions(s)).toMatch(/Time is not reported: the call never settled/);
  });

  it("a late answer: the wait, then the answer on the thread leaving the wait, at 250 ms", () => {
    const r = runs.get("late-answer")!;
    const m = timelineModel(r.run);
    expect(m.lanes[0]!.calls).toEqual([{ n: 1, t: 0, answer: "returned", answeredAt: 250, afterEnd: false }]);
    const s = path(r.run);
    expect(said(s)).toEqual(["called fetchIt", "waited 250 ms", "returned 7"]);
    expect(s.edges.map((e) => e.words)).toEqual([undefined, "answered"]);
  });

  it("still running at the watch limit: the path says so; the final count is not claimed, and the count so far is called that", () => {
    const r = runs.get("still-running")!;
    expect(r.run.result.measured.outcome).toBe("still_running_at_watch_limit");
    const m = timelineModel(r.run);
    expect(m.end).toEqual({ kind: "still_running", t: 5000 });
    expect(m.lanes[0]!.measured).toBeNull();
    expect(m.lanes[0]!.notMeasured).toMatch(/final count was not seen/);
    expect(m.detail).toMatch(/calls seen \(final count not claimed\)/);
    const s = path(r.run);
    expect(s.nodes.at(-1)!.words).toBe("still running when Atlas stopped watching");
    expect(captions(s)).toMatch(/Atlas does not claim a final count of check: .*final count was not seen; the count so far was 6/);
    expect(captions(s)).toMatch(/Atlas's limit, not the code's/);
  });

  it("no stand-in and no wait: the path is only the ending; no call and no wait is drawn", () => {
    const r = runs.get("no-wait")!;
    const m = timelineModel(r.run);
    expect(m.lanes).toEqual([]);
    expect(m.allAtZero).toBe(true);
    const s = path(r.run);
    expect(said(s)).toEqual(["returned 1.5"]);
    expect(s.edges).toEqual([]);
    expect(captions(s)).toMatch(/Atlas's clock is virtual: nothing waited for real/);
  });

  it("two stand-ins racing: begun together, b answers at 120 ms, the code ends, a's answer is a note after the end", () => {
    const r = runs.get("two-stand-ins")!;
    const m = timelineModel(r.run);
    expect(m.lanes.map((l) => l.name)).toEqual(["a", "b"]);
    expect(m.end).toMatchObject({ kind: "returned", t: 120, json: '"b"' });
    const s = path(r.run);
    expect(said(s)).toEqual(["called a and b together", "waited 120 ms", "b answered", 'returned "b"', "a answered at 300 ms, after the code had ended"]);
    expect(s.edges.at(-1)!.kind).toBe("dashed-note");
    expect(s.path!.edges).not.toContain(s.edges.at(-1)!.id);
    expect(s.edges.find((e) => e.to === s.nodes[3]!.id)!.words).toBe("no answer yet from a");
    expect(captions(s)).toMatch(/does not say whether the code used it/);
  });

  it("every caption is drawn whole, on a wide page and a phone: the line cap never cuts a reason or a count off", () => {
    for (const r of runs.values()) {
      const s = path(r.run);
      for (const narrow of [false, true]) {
        const d = drawSpec(s, { narrow });
        if (d.kind !== "drawing") throw new Error(`expected a drawing, got ${d.kind}`);
        expect(d.scene.captions.map((b) => b.lines.map((l) => l.text).join(" "))).toEqual(s.captions.map((c) => c.words));
      }
    }
  });

  it("the story runs in the order things happened: every step points at the next node, so nothing shows before its time", () => {
    for (const r of runs.values()) {
      const s = path(r.run);
      expect(s.steps.flatMap((x) => x.nodes)).toEqual(s.nodes.map((n) => n.id));
      expect(s.steps.flatMap((x) => x.edges)).toEqual(s.edges.map((e) => e.id));
    }
  });
});

describe("E3 call timeline: never shown as fact when the run cannot be", () => {
  const base = () => runs.get("throws-then-returns")!.run;
  /** Nothing from the run reaches the page: no node, no number from the run, the reason printed in place of the drawing. */
  const expectNothingDrawn = (run: Run, reason: string) => {
    const s = path(run);
    expect(s.notShown).toContain(reason);
    expect([s.nodes, s.edges, s.steps, s.marks, s.captions]).toEqual([[], [], [], [], []]);
    const d = drawSpec(s);
    if (d.kind !== "not-shown") throw new Error(`expected no drawing, got ${d.kind}`);
    expect(d.html).toContain(reason.replace(/'/g, "&#39;"));
    expect(d.html).not.toContain("<svg");
    expect(d.html).not.toMatch(/returned|called fetchIt|waited/);
  };
  it("controlPassed false: no drawing, no number, the reason printed", () => {
    const run: Run = { ...base(), controlPassed: false, result: { ...base().result, notMeasured: { ...base().result.notMeasured, control: "case C3: virtualMs 101, expected 100" } } };
    const m = timelineModel(run);
    expect(m).toMatchObject({ lanes: [], end: null, readout: "" });
    expectNothingDrawn(run, "case C3: virtualMs 101, expected 100");
  });

  it("controlPassed missing (an old or edited file): nothing drawn", () => {
    expectNothingDrawn({ ...base(), controlPassed: undefined } as unknown as Run, "the run has no control result");
  });

  it("a whole-run can't check (the code needs a package): nothing drawn, the reason printed", () => {
    const run: Run = { ...base(), result: { measured: { outcome: "returned", virtualMs: 0 }, notMeasured: { wholeRun: "the code needs axios; Atlas runs one pasted file on its own, with no packages or other modules" } } };
    expectNothingDrawn(run, "the code needs axios");
  });

  it("a run with no trace: nothing drawn", () => {
    expectNothingDrawn({ ...base(), trace: [] }, "the run recorded no trace");
  });
});

describe("E3 call timeline: model limits", () => {
  it("the ruler's ticks are 1, 2 or 5 × 10^k, at most 6 majors", () => {
    expect(niceStep(100, 6)).toBe(20);
    expect(niceStep(700, 6)).toBe(200);
    expect(niceStep(5000, 6)).toBe(1000);
  });
});
