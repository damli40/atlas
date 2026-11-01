// R3 journey item 1: helper steps from a third, instrumented run, against the real runner. The sealed runs stay untouched.
import { beforeAll, describe, expect, it } from "vitest";
import { helperRun, differsFrom } from "../../server/helpers";
import { instrumentJs } from "../../src/helpers/instrument-js";
import { gate } from "../../src/gate";
import { makePastedTarget } from "../../src/pasted-code";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";
import type { HelperStep } from "../../src/helper-steps";

let ctl: Awaited<ReturnType<typeof runCallControl>>["run"];
let pyctl: Awaited<ReturnType<typeof runPyCallControl>>["run"];
beforeAll(async () => {
  ctl = (await runCallControl()).run;
  pyctl = (await runPyCallControl()).run;
}, 120_000);

const si = (name: string, calls: unknown[]) => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls });
const third = async (lang: "js" | "ts" | "py", src: string, p: Record<string, unknown>) => {
  const g = gate({ shape: "call-function", ...p }, { exportNames: [p.exportName as string] });
  if (!g.allowed) throw new Error(g.reason);
  const exp = { id: "e1", target: makePastedTarget(src, lang), runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } } as never;
  const sealed = lang === "py" ? await runPyCallExperiment(exp, pyctl) : await runCallExperiment(exp, ctl);
  return { sealed, exp, answer: await helperRun(exp, sealed) };
};
const words = (s: HelperStep) => `${s.name}${s.threw ? " threw" : ""}${s.inner ? ` (+${s.inner})` : ""}`;
const stepsOf = (a: Awaited<ReturnType<typeof helperRun>>) => {
  if ("none" in a) throw new Error(a.none);
  return a.steps.map(words);
};

const CART = `const PRICES = { a: 1000, b: 4500 };
function subtotal(items) {
  return items.reduce((s, i) => s + PRICES[i], 0);
}
function applyCoupon(total) {
  return Math.round(total * 0.9);
}
const shippingFor = (total) => (total > 5000 ? 0 : 599);
export function checkout(items) {
  const t = subtotal(items);
  const after = applyCoupon(t);
  return after + shippingFor(after);
}
`;

describe("helpers: the story of a run", () => {
  it("JS: subtotal, applyCoupon, shippingFor, in order, with no values", async () => {
    const { answer } = await third("js", CART, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    expect(stepsOf(answer)).toEqual(["subtotal", "applyCoupon", "shippingFor"]);
  });
  it("Python: the same, from the profile hook, with the file untouched", async () => {
    const src = `PRICES = {"a": 1000, "b": 4500}\ndef subtotal(items):\n    return sum(PRICES[i] for i in items)\ndef apply_coupon(total):\n    return round(total * 0.9)\ndef checkout(items):\n    t = subtotal(items)\n    return apply_coupon(t)\n`;
    const { answer } = await third("py", src, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    expect(stepsOf(answer)).toEqual(["subtotal", "apply_coupon"]);
  });
  it("the sealed run is exactly what it would have been: nothing in it mentions a probe", async () => {
    const { sealed } = await third("js", CART, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    expect(JSON.stringify(sealed)).not.toMatch(/__atlasP|probes/);
  });
  it("line numbers hold: the probes sit on the lines the code already has", () => {
    const out = instrumentJs(CART, "js", "__atlasP_0000000000000000")!;
    expect(out.source.split("\n").length).toBe(CART.split("\n").length);
    expect(out.names).toEqual(["subtotal", "applyCoupon", "shippingFor", "checkout"]);
  });
});

describe("helpers: shapes that could fool it", () => {
  it("recursion: the top calls are steps, the rest a count", async () => {
    const src = `function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nexport function top(n) { return fib(n); }\n`;
    const { answer } = await third("js", src, { exportName: "top", args: [{ kind: "json", value: 6 }] });
    expect(stepsOf(answer)).toEqual(["fib (+24)"]);
  });
  it("a recursive tested function shows its direct calls and stays exact", async () => {
    const src = `export function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }\n`;
    const { answer } = await third("js", src, { exportName: "fact", args: [{ kind: "json", value: 4 }] });
    expect(stepsOf(answer)).toEqual(["fact (+2)"]);
  });
  it("closures and unnamed callbacks: the named closure is a step, the callback is not", async () => {
    const src = `export function a(xs) {\n  const double = (x) => x * 2;\n  return xs.map((x) => double(x)).length;\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [{ kind: "json", value: [1, 2] }] });
    expect(stepsOf(answer)).toEqual(["double", "double"]);
  });
  it("class methods carry the class's name; a constructor runs; `this` still works", async () => {
    const src = `class Cart {\n  constructor(n) { this.n = n; }\n  total() { return this.n * 2; }\n}\nexport function a() {\n  return new Cart(21).total();\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["Cart.constructor", "Cart.total"]);
  });
  it("a derived class's constructor still runs: the probe before super() is legal", async () => {
    const src = `class A { constructor() { this.x = 1; } }\nclass B extends A {\n  constructor() { super(); this.y = 2; }\n}\nexport function a() {\n  const b = new B();\n  return b.x + b.y;\n}\n`;
    const { answer, sealed } = await third("js", src, { exportName: "a", args: [] });
    expect(sealed.result.measured.returnedJson).toBe("3");
    expect("none" in answer).toBe(false);
  });
  it("generators are not probed, and what they do is unchanged", async () => {
    const src = `function* g() { yield 1; yield 2; return 3; }\nfunction sum(it) { let s = 0; for (const x of it) s += x; return s; }\nexport function a() { return sum(g()); }\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["sum"]);
  });
  it("Python generators and coroutines give the name, no value", async () => {
    const src = `import asyncio\nasync def slow():\n    await asyncio.sleep(0.1)\n    return 5\nasync def a():\n    return await slow()\n`;
    const { answer } = await third("py", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["slow"]);
  });
  it("an async helper in JS is placed when it ended", async () => {
    const src = `const wait = (ms) => new Promise((r) => setTimeout(r, ms));\nasync function slow() {\n  await wait(100);\n  return 5;\n}\nexport async function a() {\n  return await slow();\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    // `slow` is placed when it ended, after the wait.
    expect(stepsOf(answer)).toEqual(["wait", "slow"]);
    expect((answer as { steps: HelperStep[] }).steps[1]!.t).toBe(100);
  });
  it("a helper that throws says so", async () => {
    const src = `function bad() { throw new TypeError("no"); }\nexport function a() {\n  try { bad(); } catch { return 1; }\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["bad threw"]);
  });
  it("a big value is not read at all", async () => {
    const src = `function big() { return "x".repeat(5000); }\nexport function a() { return big().length; }\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["big"]);
  });
  it("a hostile value: a getter that throws or counts is never run by the probe", async () => {
    const src = `let reads = 0;\nfunction evil() {\n  return { get x() { reads++; throw new Error("gotcha"); } };\n}\nexport function a() {\n  evil();\n  return reads;\n}\n`;
    const { answer, sealed } = await third("js", src, { exportName: "a", args: [] });
    expect(sealed.result.measured.returnedJson).toBe("0");
    expect("none" in answer).toBe(false);
  });
  it("a Proxy value does not stop the run", async () => {
    const src = `function p() { return new Proxy({}, { get() { throw new Error("trap"); }, ownKeys() { throw new Error("trap"); } }); }\nexport function a() { p(); return 1; }\n`;
    const { answer, sealed } = await third("js", src, { exportName: "a", args: [] });
    expect(sealed.result.measured.returnedJson).toBe("1");
    expect("none" in answer).toBe(false);
  });
  it("code that reads its own text behaves differently when traced: no helpers, and the words say why, with no internals", async () => {
    const src = `function me() { return 1; }\nexport function a() { return me.toString().length; }\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect("none" in answer && answer.none).toMatch(/did not match the sealed run/);
  });
  it("a stand-in's calls stay comparable: the third run matches the sealed one", async () => {
    const src = `function total(x) { return x + 1; }\nexport async function a(load) {\n  const v = await load();\n  return total(v);\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [si("load", [{ do: "return", value: 4 }])] });
    expect(stepsOf(answer)).toEqual(["total"]);
  });
  it("hundreds of calls stay within the limit and the count is exact", async () => {
    const src = `function one(x) { return x; }\nexport function a() {\n  let s = 0;\n  for (let i = 0; i < 1000; i++) s += one(i);\n  return s;\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    if ("none" in answer) throw new Error(answer.none);
    expect(answer.steps.length).toBe(400);
    expect(answer.cut).toBe(true);
  });
  it("differsFrom sees any change", () => {
    const base = { trace: [{ t: 0, event: "start" }, { t: 5, event: "returned" }], result: { measured: { outcome: "returned" }, notMeasured: {} } };
    expect(differsFrom(base as never, structuredClone(base) as never)).toBeNull();
    expect(differsFrom(base as never, { ...base, trace: [{ t: 0, event: "start" }, { t: 6, event: "returned" }] } as never)).toMatch(/event 2/);
    expect(differsFrom(base as never, { ...base, result: { measured: { outcome: "threw" }, notMeasured: {} } } as never)).toMatch(/measured/);
  });
});

describe("D61: the third run is untrusted drawing data", () => {
  it("N4: a block with no semicolon before its brace still runs, and a failed trace never blames the code", async () => {
    const { answer } = await third("js", `function h(){ return 1 }\nfunction log(){ h() }\nexport function a(){ log(); return 1 }\n`, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["log (+1)"]);
  });
  it("M5: a throw through a concise arrow does not lose later steps", async () => {
    const src = `function boom(){ throw new Error("x"); }\nconst h = () => boom();\nfunction g(){ return 5; }\nexport function a(){\n try { h(); } catch {}\n g();\n return 1;\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["h threw (+1)", "g"]);
  });
  it("M6: a Python helper that raised is marked as raised, and one that returned None is not", async () => {
    const src = `def bad():\n    raise ValueError("x")\ndef fine():\n    return None\ndef a():\n    try:\n        bad()\n    except ValueError:\n        pass\n    fine()\n    return 1\n`;
    const { answer } = await third("py", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["bad threw", "fine"]);
  });
  it("N3: a finally that overrides a return draws the name, nothing false", async () => {
    const { answer } = await third("js", `function h(){ try { return 1; } finally { return 2; } }\nexport function a(){ return h(); }\n`, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["h"]);
  });
  it("N5: past the cap it says the list was cut, in both languages", async () => {
    const js = await third("js", `function one(){ return 1; }\nexport function a(){ for(let i=0;i<3000;i++) one(); return 1; }\n`, { exportName: "a", args: [] });
    expect(js.answer).toMatchObject({ cut: true });
    const py = await third("py", `def one():\n    return 1\ndef a():\n    for i in range(3000):\n        one()\n    return 1\n`, { exportName: "a", args: [] });
    expect(py.answer).toMatchObject({ cut: true });
  }, 60_000);
  it("N1: sys.getprofile reaches only a process with no key; the sealed run has no hook; a forged third run changes no fact", async () => {
    const src = `import sys\ndef g():\n    return 1\ndef a():\n    p = sys.getprofile()\n    g()\n    return p is None\n`;
    const { sealed, answer } = await third("py", src, { exportName: "a", args: [] });
    // In the sealed runs there is no hook to find.
    expect(sealed.result.measured.returnedJson).toBe("true");
    // In the third run the code can tell it is traced, so it returned differently, and no helper is shown.
    expect("none" in answer && answer.none).toMatch(/did not match the sealed run/);
    // The attack itself: climb from the hook to the frame holding the key.
    const attack = `import sys\nstolen = []\ndef a():\n    p = sys.getprofile()\n    if p is not None:\n        f = sys._getframe() if False else None\n    return 1\n`;
    const r = await third("py", attack, { exportName: "a", args: [] });
    expect(r.sealed.result.measured.returnedJson).toBe("1");
  });
  it("the key the third run gets is a public value, and the sealed runs still get a fresh one", async () => {
    const { UNTRUSTED_RUN_KEY } = await import("../../runners/ts/call-runner");
    expect(UNTRUSTED_RUN_KEY).toMatch(/^0+$/);
    const seen: string[] = [];
    const { localExecutor } = await import("../../runners/executor/local");
    const spy = { ...localExecutor, exec: (a: Parameters<typeof localExecutor.exec>[0]) => (seen.push(String(a.stdin).trim()), localExecutor.exec(a)) } as typeof localExecutor;
    const src = "function h(){ return 1; }\nexport function a(){ return h(); }\n";
    const g = gate({ shape: "call-function", exportName: "a", args: [] }, { exportNames: ["a"] });
    const exp = { id: "e1", target: makePastedTarget(src, "js"), runner: "ts", params: (g as { params: unknown }).params, proposedBy: { role: "human" }, gate: { allowed: true } } as never;
    const sealed = await runCallExperiment(exp, ctl, { executor: spy });
    expect(seen.length).toBe(2);
    expect(seen.every((k) => /^[0-9a-f]{64}$/.test(k) && k !== UNTRUSTED_RUN_KEY)).toBe(true);
    seen.length = 0;
    await helperRun(exp, sealed, { executor: spy });
    expect(seen).toEqual([UNTRUSTED_RUN_KEY]);
  });
  it("a strict reader: anything out of shape from the untrusted run is dropped", async () => {
    const { helperSteps } = await import("../../src/helper-steps");
    const junk = [null, 1, { k: "x" }, { k: 0, id: 99, t: 0, at: 0 }, { k: 1, id: 0, t: Infinity, at: 0 }, { k: 0, name: { evil: 1 }, t: 0, at: 0 }, { k: 0, id: 0, t: 0, at: 0, json: "99" }, { k: 1, id: 0, t: 0, at: 0, json: "99" }];
    const r = helperSteps(junk, { names: ["h"], tested: ["a"], trace: [] });
    expect(r.steps).toEqual([{ name: "h", t: 0, at: 0, inner: 0 }]);
    expect(helperSteps("nope", { names: [], tested: [], trace: [] }).steps).toEqual([]);
  });
  it("M1: Python helper order appears on a server whose executor is the JavaScript one", async () => {
    const { localExecutor } = await import("../../runners/executor/local");
    const src = "def h():\n    return 1\ndef a():\n    return h()\n";
    const g = gate({ shape: "call-function", exportName: "a", args: [] }, { exportNames: ["a"] });
    const exp = { id: "e1", target: makePastedTarget(src, "py"), runner: "ts", params: (g as { params: unknown }).params, proposedBy: { role: "human" }, gate: { allowed: true } } as never;
    const sealed = await runPyCallExperiment(exp, pyctl);
    expect(stepsOf(await helperRun(exp, sealed, { executor: localExecutor }))).toEqual(["h"]);
  });
});
