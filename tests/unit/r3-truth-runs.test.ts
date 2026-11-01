// R3 review B1, B2, B3, B4, B7: the path against REAL runs. Every trace here comes from the real runner, JavaScript and
// Python, never built by hand: hand-built traces are how the review's faults stayed hidden.
import { beforeAll, describe, expect, it } from "vitest";
import { helperRun } from "../../server/helpers";
import { partingKey, pathItems, whatHappened, type PathItem } from "../../renderer/authors/what-happened";
import { specProblems } from "../../renderer/spec";
import { gate } from "../../src/gate";
import { makePastedTarget } from "../../src/pasted-code";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";

const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const later = (ms: number, value: unknown = 1) => ({ do: "return", value, afterMs: ms });
const ok = (value: unknown = 1) => ({ do: "return", value });

let ctl: Awaited<ReturnType<typeof runCallControl>>["run"];
let pyctl: Awaited<ReturnType<typeof runPyCallControl>>["run"];
const realRun = async (lang: "js" | "py", src: string, p: Record<string, unknown>) => {
  const g = gate({ shape: "call-function", ...p }, { exportNames: [p.exportName as string] });
  if (!g.allowed) throw new Error(g.reason);
  const experiment = { id: "e1", target: makePastedTarget(src, lang), runner: "ts" as const, params: g.params as never, proposedBy: { role: "human" as const }, gate: { allowed: true as const } };
  const run = lang === "py" ? await runPyCallExperiment(experiment as never, pyctl) : await runCallExperiment(experiment as never, ctl);
  return { run, experiment };
};
/** The path in words, one entry per item: what the reader is told, in order. */
const said = (items: PathItem[]) =>
  items.map((i) => {
    switch (i.kind) {
      case "call":
        return `call ${i.name}${i.answer ? ` [${i.answer}]` : ""}${i.whileOpen ? ` (while ${i.whileOpen})` : ""}`;
      case "together":
        return `together ${i.calls.map((c) => c.name).join("+")}`;
      case "answer":
        return `answer ${i.name} at ${i.t}`;
      case "wait":
        return `wait ${i.ms}${i.answerWords ? ` [${i.answerWords}]` : ""}`;
      case "end":
        return `end ${i.words}${i.open ? ` [${i.open}]` : ""}`;
      case "late":
        return `late ${i.words}`;
      default:
        return i.kind;
    }
  });

beforeAll(async () => {
  ctl = (await runCallControl()).run;
  pyctl = (await runPyCallControl()).run;
}, 120_000);

describe("R3 B1: an answer is drawn when it arrived", () => {
  const raceJs = `export async function a(w){\n return Promise.race([w(), new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 1000))]);\n}`;
  const racePy = `import asyncio\nasync def a(w):\n    return await asyncio.wait_for(w(), 1)\n`;
  it("JS: a timeout: the code gave up before the answer came, and the drawing says so", async () => {
    const { run, experiment } = await realRun("js", raceJs, { exportName: "a", args: [si("w", [later(5000, 9)])] });
    expect(said(pathItems({ run, experiment }).items)).toEqual(["call w", "wait 1000", "end threw Error at 1,000 ms [no answer yet from w]", "late w returned 9 (scripted) at 5,000 ms, after the code had ended"]);
  });
  it("Python: the same shape, the same order, though its harness writes the answer at the call", async () => {
    const { run, experiment } = await realRun("py", racePy, { exportName: "a", args: [si("w", [later(5000, 9)])] });
    const s = said(pathItems({ run, experiment }).items);
    expect(s[0]).toBe("call w");
    expect(s[1]).toBe("wait 1000");
    expect(s[2]).toMatch(/^end threw .*at 1,000 ms/);
    expect(s[3]).toMatch(/w returned 9 \(scripted\) at 5,000 ms, after the code had ended/);
    expect(s.length).toBe(4);
  });
  it("no await: it returned at 0; the answer came after the end, and no wait is drawn for it", async () => {
    const { run, experiment } = await realRun("js", `export function a(w){\n w();\n return 1;\n}`, { exportName: "a", args: [si("w", [later(5000, 9)])] });
    expect(said(pathItems({ run, experiment }).items)).toEqual(["call w", "end returned 1 [no answer before the end]", "late w returned 9 (scripted) at 5,000 ms, after the code had ended"]);
  });
  for (const [lang, src] of [["js", `export async function a(w){\n return await w();\n}`], ["py", `async def a(w):\n    return await w()\n`]] as const) {
    it(`${lang}: a plain late answer: the wait, then the answer, in that order`, async () => {
      const { run, experiment } = await realRun(lang, src, { exportName: "a", args: [si("w", [later(400, 9)])] });
      expect(said(pathItems({ run, experiment }).items)).toEqual(["call w", "wait 400 [returned 9 (scripted)]", "end returned 9"]);
      const spec = whatHappened({ run, experiment });
      expect(spec.edges.map((e) => e.words)).toEqual([undefined, "returned 9 (scripted)"]);
    });
  }
  it("an instant answer stays on the call's own thread, and calls in turn stay in turn", async () => {
    const { run, experiment } = await realRun("js", `export async function a(x, y){\n await x();\n return y();\n}`, { exportName: "a", args: [si("x", [ok(1)]), si("y", [ok(2)])] });
    expect(said(pathItems({ run, experiment }).items)).toEqual(["call x [returned 1 (scripted)]", "call y [returned 2 (scripted)]", "end returned 2"]);
  });
});

describe("R3 B2: calls that overlap are drawn as overlapping", () => {
  const args = [si("x", [later(300, 1)]), si("y", [later(100, 2)])];
  for (const [lang, src] of [["js", `export async function a(x, y){\n return Promise.all([x(), y()]);\n}`], ["py", `import asyncio\nasync def a(x, y):\n    return await asyncio.gather(x(), y())\n`]] as const) {
    it(`${lang}: began together; y answered first; each answer at its own time`, async () => {
      const { run, experiment } = await realRun(lang, src, { exportName: "a", args });
      expect(said(pathItems({ run, experiment }).items)).toEqual(["together x+y", "wait 100", "answer y at 100", "wait 200", "answer x at 300", "end returned [1,2]"]);
      const spec = whatHappened({ run, experiment });
      expect(specProblems(spec)).toEqual([]);
      expect(spec.captions.map((c) => c.words).join()).toMatch(/does not say whether the code used it/);
    });
  }
  it("a call begun later, while another is out, says so", async () => {
    const src = `export async function a(x, y){\n const p = x();\n await new Promise((r) => setTimeout(r, 50));\n await y();\n return p;\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("x", [later(300, 1)]), si("y", [ok(2)])] });
    const s = said(pathItems({ run, experiment }).items);
    expect(s[0]).toBe("call x");
    expect(s[1]).toBe("wait 50");
    expect(s[2]).toBe("call y [returned 2 (scripted)] (while x)");
  });
});

describe("R3 B3: the ring goes on the first step that really departs", () => {
  const ms = (value: number) => ({ measures: "virtualMs", answer: { kind: "number" as const, value, tolerancePct: 10, unit: "ms" } });
  const count = (name: string, value: number) => ({ measures: `calls:${name}`, answer: { kind: "integer" as const, value } });
  it("a two-call test: a time is about the last call only, never a wait in the first", async () => {
    const src = `export async function a(){\n a.n = (a.n ?? 0) + 1;\n await new Promise((r) => setTimeout(r, a.n === 1 ? 3000 : 600));\n return a.n;\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [], calls: [{ exportName: "a", args: [] }, { exportName: "a", args: [], waitMs: 200 }] });
    const { items } = pathItems({ run, experiment });
    const key = partingKey(items, ms(100));
    const lastTurn = items.findIndex((i) => i.kind === "turn" && i.n === 2);
    const at = items.findIndex((i) => i.kind === "wait" && `wait:${i.t}` === key);
    expect(at).toBeGreaterThan(lastTurn);
  });
  it("it returned at 0 and left a timer running: the ring is on the end, not a wait after it", async () => {
    const { run, experiment } = await realRun("js", `export function a(){\n setTimeout(() => {}, 100);\n return 1;\n}`, { exportName: "a", args: [] });
    const { items } = pathItems({ run, experiment });
    expect(items.some((i) => i.kind === "wait")).toBe(false);
    expect(partingKey(items, ms(30))).toBe("end");
  });
  it("a folded loop unfolds around the wait that holds the parting", async () => {
    const src = `export async function a(call){\n for (let i = 0; i < 12; i++) {\n  try { return await call(i); } catch (e) { await new Promise((r) => setTimeout(r, 100 * (i + 1))); }\n }\n throw new RangeError("gave up");\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("call", [{ do: "throw", errorName: "TypeError", message: "x" }])] });
    const bets = [{ id: "b", who: "human" as const, ...ms(500) }];
    const spec = whatHappened({ run, experiment, bets, verdicts: [{ betId: "b", outcome: "not_matched" }] });
    const mark = spec.marks[0]!;
    const node = spec.nodes.find((n) => n.id === mark.on)!;
    expect(mark.noStep).toBeUndefined();
    expect(node.kind).toBe("clock");
    // 100 + 200 = 300 ms by the end of the second wait; the third reaches 600, past 550 (500 + 10%).
    expect(node.words).toBe("waited 300 ms");
  });
  it("the count passed in the part Atlas did not keep: no ring, and the words give the real count", async () => {
    const src = `export async function a(g){\n for (let i = 0; i < 3000; i++) await g();\n return 7;\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("g", [ok(1)])] });
    const bets = [{ id: "b", who: "human" as const, ...count("g", 1000) }];
    const spec = whatHappened({ run, experiment, bets, verdicts: [{ betId: "b", outcome: "not_matched" }] });
    expect(spec.marks[0]).toMatchObject({ kind: "didnt-match", noStep: true });
    expect(spec.marks[0]!.words).toMatch(/the run made 3,000, past what Atlas kept/);
    expect(spec.path?.partsWaysAt).toBeUndefined();
  });
});

describe("D61: helper order on the path: names only, never a value, never a ring", () => {
  const CART = `function subtotal(items) {\n return items.length * 2750;\n}\nfunction applyCoupon(total) {\n return Math.round(total * 0.9);\n}\nconst shippingFor = (total) => (total > 5000 ? 0 : 599);\nexport function checkout(items) {\n const t = subtotal(items);\n const after = applyCoupon(t);\n return after + shippingFor(after);\n}\n`;
  const CAPTION = "Helper order comes from a separate traced run, not the sealed ones. The code itself could change it.";
  it("the path tells the order, says where it came from, and the ring is on the end, a measured step", async () => {
    const { run, experiment } = await realRun("js", CART, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    const helpers = await helperRun(experiment as never, run);
    if ("none" in helpers) throw new Error(helpers.none);
    const bets = [{ id: "b", who: "human" as const, measures: "returnedJson", answer: { kind: "json" as const, value: 5500 } }];
    const spec = whatHappened({ run, experiment, helpers, bets, verdicts: [{ betId: "b", outcome: "not_matched" }] });
    expect(spec.nodes.map((n) => n.words)).toEqual(["subtotal", "applyCoupon", "shippingFor", "returned 5549"]);
    expect(spec.nodes.find((n) => n.id === spec.marks[0]!.on)!.words).toBe("returned 5549");
    expect(spec.captions.map((c) => c.words)).toContain(CAPTION);
    expect(spec.nodes.map((n) => `${n.words} ${n.small ?? ""}`).join()).not.toMatch(/→|5500|4950|599\b/);
    expect(JSON.stringify(spec)).not.toMatch(/matched the two sealed/);
  });
  it("when the traced run differs, the path has no helpers and a caption says why, with no internals", async () => {
    const src = `function me() { return 1; }\nexport function a() { return me.toString().length; }\n`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [] });
    const helpers = await helperRun(experiment as never, run);
    const spec = whatHappened({ run, experiment, helpers });
    expect(spec.nodes.map((n) => n.words)).toEqual(["returned 27"]);
    const words = spec.captions.map((c) => c.words).join(" ");
    expect(words).toMatch(/did not match the sealed run/);
    expect(words).not.toMatch(/__atlasP|SyntaxError|sandbox/);
    expect(words).not.toContain(CAPTION);
  });
  it("helpers mixed with stand-ins stay in the order they ran, with the wait between them", async () => {
    const src = `function total(x) {\n return x + 1;\n}\nexport async function a(load) {\n const v = await load();\n return total(v);\n}\n`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("load", [later(100, 4)])] });
    const helpers = await helperRun(experiment as never, run);
    const spec = whatHappened({ run, experiment, helpers });
    expect(spec.nodes.map((n) => n.words)).toEqual(["called load", "waited 100 ms", "total", "returned 5"]);
  });
  it("N7: Python: a helper that ran before a delayed answer is drawn before it", async () => {
    const src = `def h():\n    return 5\nasync def a(x):\n    p = x()\n    h()\n    return await p\n`;
    const { run, experiment } = await realRun("py", src, { exportName: "a", args: [si("x", [later(300, 1)])] });
    const helpers = await helperRun(experiment as never, run);
    const spec = whatHappened({ run, experiment, helpers });
    const w = spec.nodes.map((n) => n.words);
    expect(w.indexOf("h")).toBeLessThan(w.findIndex((x) => /waited 300 ms/.test(x)));
  });
  it("M8: a loop of helpers folds by name with exact counts, and a cut list says at least", async () => {
    const src = `function one(x) {\n return x;\n}\nexport function a() {\n let s = 0;\n for (let i = 0; i < 100; i++) s += one(i);\n return s;\n}\n`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [] });
    const helpers = await helperRun(experiment as never, run);
    const spec = whatHappened({ run, experiment, helpers });
    expect(spec.nodes.length).toBeLessThan(4);
    expect(spec.nodes.map((n) => n.words).join()).toContain("one 100 times");
    const many = `function one(x) {\n return x;\n}\nexport function a() {\n for (let i = 0; i < 3000; i++) one(i);\n return 1;\n}\n`;
    const r2 = await realRun("js", many, { exportName: "a", args: [] });
    const h2 = await helperRun(r2.experiment as never, r2.run);
    const s2 = whatHappened({ run: r2.run, experiment: r2.experiment, helpers: h2 });
    expect(s2.nodes.map((n) => n.words).join()).toContain("one at least 400 times");
    expect(s2.captions.map((c) => c.words).join()).toMatch(/at least/);
    expect(s2.captions.map((c) => c.words).join()).not.toMatch(/2,099|more were not drawn/);
  });
});

describe("R3 B4: any path length reaches its verdict", () => {
  it("100 rounds of two alternating calls fold into one ticket with exact counts, and the bet is marked", async () => {
    const src = `export async function a(x, y){\n for (let i = 0; i < 100; i++) { await x(i); await y(i); }\n return "done";\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("x", [ok(1)]), si("y", [ok(2)])] });
    const bets = [{ id: "b", who: "human" as const, measures: "calls:x", answer: { kind: "integer" as const, value: 100 } }];
    const spec = whatHappened({ run, experiment, bets, verdicts: [{ betId: "b", outcome: "matched" }] });
    expect(specProblems(spec)).toEqual([]);
    expect(spec.nodes.length).toBeLessThan(6);
    expect(spec.nodes.map((n) => n.words).join()).toContain("called x 100 times and y 100 times");
    expect(spec.marks.length).toBe(1);
  });
  it("a miss inside the alternating loop keeps its step on its own", async () => {
    const src = `export async function a(x, y){\n for (let i = 0; i < 100; i++) { await x(i); await y(i); }\n return "done";\n}`;
    const { run, experiment } = await realRun("js", src, { exportName: "a", args: [si("x", [ok(1)]), si("y", [ok(2)])] });
    const bets = [{ id: "b", who: "human" as const, measures: "calls:x", answer: { kind: "integer" as const, value: 40 } }];
    const spec = whatHappened({ run, experiment, bets, verdicts: [{ betId: "b", outcome: "not_matched" }] });
    const node = spec.nodes.find((n) => n.id === spec.marks[0]!.on)!;
    expect(node.words).toBe("called x");
    expect(node.small).toMatch(/^41st call/);
  });
});

describe("R3 B7: a cut trace states only exact counts and the known end", () => {
  for (const [lang, src] of [
    ["js", `export async function a(g){\n for (let i = 0; i < 2000; i++) { await g(); await new Promise((r) => setTimeout(r, 10)); }\n throw new Error("end");\n}`],
    ["py", `import asyncio\nasync def a(g):\n    for i in range(3000):\n        await g()\n        await asyncio.sleep(0.005)\n    raise ValueError("end")\n`],
  ] as const) {
    it(`${lang}: no wait across the gap, no invented "no answer", the measured count, then the ending on a dashed line`, async () => {
      const { run, experiment } = await realRun(lang, src, { exportName: "a", args: [si("g", [ok(1)])] });
      expect(run.trace.some((e) => e.event === "trace_cut")).toBe(true);
      const { items } = pathItems({ run, experiment });
      const stopAt = items.findIndex((i) => i.kind === "stop");
      const n = lang === "js" ? 2000 : 3000;
      expect(items[stopAt]).toMatchObject({ cut: true });
      expect((items[stopAt] as { words: string }).words).toContain(`g ${n.toLocaleString("en-US")} times`);
      const end = items[stopAt + 1];
      expect(end).toMatchObject({ kind: "end", dashed: true, good: false });
      expect(items.length).toBe(stopAt + 2);
      // Every wait on the path is one the code really made.
      for (const i of items) if (i.kind === "wait") expect(i.ms).toBe(lang === "js" ? 10 : 5);
      const spec = whatHappened({ run, experiment });
      expect(spec.nodes.map((x) => x.words).join()).not.toMatch(/no answer seen/);
      expect(specProblems(spec)).toEqual([]);
      const dashed = spec.edges.filter((e) => e.kind === "dashed-note");
      expect(dashed.length).toBeGreaterThan(0);
      expect(spec.path?.edges).not.toContain(dashed[dashed.length - 1]!.id);
    }, 60_000);
  }
});
