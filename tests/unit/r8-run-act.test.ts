// R8: the run acted out on the machine. Each motion comes from a field the run recorded; a run without that field gets no such motion.
// Fixtures in fixtures/r8-runs are real sandbox runs (the U3 mock server: models mocked, $0), captured with their third traced run.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { endOfRun, machineParts, ranParts } from "../../renderer/authors/machine";
import { actTimes, fitAct, type ActStep } from "../../renderer/authors/run-act";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";
import { runActFor } from "../../web/machines/bench/run-beats";
import type { HelperAnswer } from "../../web/api";

interface Fixture { name: string; language: "ts" | "py"; source: string; params: never; run: never; helpers: HelperAnswer | null }
const load = (name: string): Fixture => JSON.parse(readFileSync(new URL(`fixtures/r8-runs/${name}.json`, import.meta.url), "utf8")) as Fixture;

function actOf(f: Fixture, helpers: HelperAnswer | null = f.helpers) {
  const outline = fileOutline(f.source, f.language);
  const params = f.params as { exportName: string };
  const model = { ...benchModel({ fileName: "pasted", outline, test: f.params, source: f.source, language: f.language }), tested: params.exportName };
  const parts = machineParts(model, outline, f.source, f.language);
  const run = f.run as { result: { measured: Record<string, unknown> } };
  const m = run.result.measured;
  const called = (port: string) => typeof m[`calls:${port.replace(/^stand-in /, "")}`] === "number" && (m[`calls:${port.replace(/^stand-in /, "")}`] as number) > 0;
  const steps = helpers && "steps" in helpers ? helpers.steps : [];
  const end = endOfRun({ outcome: m.outcome, thrown: { name: (m.thrownName as string) ?? null, message: (m.thrownMessage as string) ?? null }, parts, tested: params.exportName, test: f.params, ran: ranParts({ tested: params.exportName, steps, parts, called }), called, thrownAt: helpers && "thrownAt" in helpers ? helpers.thrownAt ?? null : null });
  return { act: runActFor({ run: f.run, experiment: { params: f.params }, helpers, parts, model, outline, tested: params.exportName, end }), end };
}
const kinds = (s: ActStep, k: string) => s.motions.filter((m) => m.kind === k);
const all = (steps: ActStep[], k: string) => steps.flatMap((s) => kinds(s, k));

describe("R8: the example's act, from its recorded trace", () => {
  const { act, end } = actOf(load("example"));
  it("plays the recorded steps in order, in plain words", () => {
    expect(act.steps.map((s) => s.words)).toEqual([
      "Atlas calls fetchWithRetry",
      "call 1 to fetchIt: threw Error",
      "backoffMs runs",
      "sleep runs",
      "waits 100 ms",
      "call 2 to fetchIt: threw Error",
      "backoffMs runs",
      "sleep runs",
      "waits 200 ms",
      "call 3 to fetchIt: threw Error",
      "backoffMs runs",
      "sleep runs",
      "waits 400 ms",
      "threw Error at 700 ms",
    ]);
  });
  it("ink enters once, at the function Atlas calls", () => {
    expect(all(act.steps, "enter")).toEqual([{ kind: "enter", part: "fetchWithRetry" }]);
  });
  it("fetchIt flashes once per recorded call: 3, the measured count", () => {
    expect(all(act.steps, "flash")).toEqual([1, 2, 3].map(() => ({ kind: "flash", port: "stand-in fetchIt" })));
  });
  it("each call to fetchIt lights its pipe, whose one caller is known", () => {
    for (const s of act.steps.filter((x) => x.words.startsWith("call "))) expect(kinds(s, "pipe")).toEqual([{ kind: "pipe", route: "fetchWithRetry->stand-in fetchIt" }]);
  });
  it("the loop wheel turns once per recorded call to fetchIt (line 14, inside the loop on lines 12-19), not once per call in the loop", () => {
    expect(all(act.steps, "turn")).toHaveLength(3);
    for (const s of act.steps.filter((x) => kinds(x, "turn").length)) expect(s.words).toMatch(/^call \d to fetchIt/);
  });
  it("the dial sweeps for each wait on the virtual clock, with its ms: 100, 200, 400", () => {
    expect(all(act.steps, "dial")).toEqual([100, 200, 400].map((ms) => ({ kind: "dial", part: "sleep", ms })));
  });
  it("no chute drops: plain code puts the end on fetchIt's port, not the chute, and the act says so", () => {
    expect(end?.on).toBe("port");
    expect(all(act.steps, "chute")).toEqual([]);
    expect(act.quiet.join(" ")).toMatch(/No chute drops/);
  });
  it("every step names the field it comes from", () => {
    for (const s of act.steps) expect(s.field).toMatch(/run\.|helpers\./);
  });
});

describe("R8: other runs", () => {
  it("a returning run: two calls, one wait, no chute, its value in the words", () => {
    const { act } = actOf(load("example-returns"));
    expect(act.steps.map((s) => s.words)).toEqual(["Atlas calls fetchWithRetry", "call 1 to fetchIt: threw Error", "backoffMs runs", "sleep runs", "waits 100 ms", 'call 2 to fetchIt: returned {"price":42} (scripted)', 'returned {"price":42}']);
    expect(all(act.steps, "flash")).toHaveLength(2);
    expect(all(act.steps, "chute")).toEqual([]);
  });
  it("a run that never finishes: one call that never answered, then the ending words, and no wait is made up", () => {
    const { act } = actOf(load("example-never"));
    expect(act.steps.map((s) => s.words)).toEqual(["Atlas calls fetchWithRetry", "call 1 to fetchIt: never answered", "still waiting when Atlas stopped: nothing was left to wake it"]);
    expect(all(act.steps, "dial")).toEqual([]);
    expect(all(act.steps, "turn")).toHaveLength(1);
  });
  it("a run with no helper trace: no helper step, lamp or pipe is invented, and the reason is kept", () => {
    const none = { none: "Helper order is not shown: Atlas's traced copy of this code did not finish. Your code and its sealed runs are not affected." };
    const { act } = actOf(load("example"), none);
    expect(act.steps.some((s) => /runs$/.test(s.words))).toBe(false);
    expect(all(act.steps, "pipe").every((m) => m.kind === "pipe" && m.route === "fetchWithRetry->stand-in fetchIt")).toBe(true);
    expect(all(act.steps, "lamp").map((m) => (m as { part: string }).part).sort()).toEqual(["fetchWithRetry", ...Array(6).fill(0).map((_, i) => (i % 2 ? "stand-in fetchIt" : "fetchWithRetry"))].sort());
    expect(act.quiet.join(" ")).toMatch(/No helper lamps or pipes: Helper order is not shown/);
    // Without the traced run, which part waited is not known: sleep is not known to have run, so the dial stays still and says why.
    expect(all(act.steps, "dial")).toEqual([]);
    expect(act.quiet.join(" ")).toMatch(/dial stays still/);
  });
  it("a run with no helper answer at all (still pending or lost): the same, never a guess", () => {
    const { act } = actOf(load("example"), null);
    expect(act.steps.some((s) => /runs$/.test(s.words))).toBe(false);
  });
  it("orders.ts: the chute drops at the recorded throw, out of the line the traced run gave", () => {
    const { act, end } = actOf(load("orders-throws"));
    expect(end).toMatchObject({ on: "chute", part: "fetchPage", line: 9 });
    const last = act.steps[act.steps.length - 1]!;
    expect(last.words).toBe("threw Error at 1,400 ms, out of line 9");
    expect(kinds(last, "chute")).toEqual([{ kind: "chute", part: "fetchPage" }]);
    expect(all(act.steps, "flash")).toHaveLength(4);
    // fetch is called from fetchPage, which has no loop; the loop in fetchAllOrders made one pass the trace can't count, so its wheel stays still.
    expect(all(act.steps, "turn")).toEqual([]);
    expect(act.quiet.join(" ")).toMatch(/loop wheel stays still/);
  });
  it("orders.ts returning: two calls to fetch at 0 ms, no wait made up", () => {
    const { act } = actOf(load("orders-returns"));
    expect(all(act.steps, "flash")).toHaveLength(2);
    expect(act.steps.some((s) => /wait|ms pass/.test(s.words))).toBe(false);
    expect(act.steps[act.steps.length - 1]!.words).toBe('returned ["o1","o2"]');
  });
  it("a Python file: its traced helper and its 500 ms wait", () => {
    const { act } = actOf(load("py-plan"));
    expect(act.steps.map((s) => s.words)).toEqual(["Atlas calls get_user_plan", "inner runs", "waits 500 ms", 'returned "pro"']);
    // get_user_plan's time.sleep is the one wait among the parts known to have run, and the test scripts no delay: its dial sweeps.
    expect(all(act.steps, "dial")).toEqual([{ kind: "dial", part: "get_user_plan", ms: 500 }]);
  });
});

describe("R8: timing", () => {
  const steps = (vms: number[]) => vms.map((v) => ({ vms: v }));
  it("3 to 6 s in all, whatever the virtual time, every step at least 250 ms", () => {
    for (const list of [steps([0, 0]), steps([0, 100, 0, 200, 0, 400, 0]), steps(Array(14).fill(0).map((_, i) => (i % 4 === 3 ? 30000 : 0))), steps(Array(24).fill(5))]) {
      const t = actTimes(list);
      const total = t[t.length - 1]!.at + t[t.length - 1]!.ms;
      expect(total).toBeGreaterThanOrEqual(2990);
      expect(total).toBeLessThanOrEqual(6010);
      for (const x of t) expect(x.ms).toBeGreaterThanOrEqual(250);
    }
  });
  it("a longer virtual wait takes longer on screen", () => {
    const t = actTimes(steps([0, 100, 0, 400]));
    expect(t[3]!.ms).toBeGreaterThan(t[1]!.ms);
  });
  it("a long run folds its middle so no step is under 250 ms, and the folded caption carries the exact counts", () => {
    const long: ActStep[] = Array.from({ length: 60 }, (_, i) => (i % 2 ? { words: `waits 10 ms`, vms: 10, motions: [{ kind: "dial", part: "w", ms: 10 }], field: "run.trace" } : { words: `call ${i / 2 + 1} to x: answered`, vms: 0, motions: [{ kind: "flash", port: "stand-in x" }], field: "run.trace" }));
    const fit = fitAct(long);
    expect(fit.length).toBeLessThanOrEqual(24);
    const counted = fit.reduce((n, s) => n + (/^steps /.test(s.words) ? Number(/x (\d+) times|x once/.exec(s.words)?.[1] ?? 1) : s.motions.some((m) => m.kind === "flash") ? 1 : 0), 0);
    expect(counted).toBe(30);
    expect(fit.reduce((n, s) => n + s.vms, 0)).toBe(300);
  });
});

describe("R8: each loop's lines, from the parser", () => {
  it("JavaScript: the example's loop is lines 12-19, so fetchIt's call on line 14 is inside it", () => {
    const o = fileOutline(load("example").source, "ts");
    expect(o.bodies?.fetchWithRetry?.loopSpans).toEqual([[12, 19]]);
  });
  it("Python: a loop ends at the first statement back at its indent; a nested loop is its own span", () => {
    const src = "def f(xs):\n    total = 0\n    for x in xs:\n        while x > 0:\n            x -= 1\n        total += x\n    return total\n";
    expect(fileOutline(src, "py").bodies?.f?.loopSpans).toEqual([[3, 6], [4, 5]]);
  });
});
