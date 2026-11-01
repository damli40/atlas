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
const words = (s: HelperStep) => `${s.name}${s.threw ? " threw" : s.value !== undefined ? ` -> ${s.value}` : ""}${s.inner ? ` (+${s.inner})` : ""}`;
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
  it("JS: subtotal, applyCoupon, shippingFor, with their values, in order", async () => {
    const { answer } = await third("js", CART, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    expect(stepsOf(answer)).toEqual(["subtotal -> 5500", "applyCoupon -> 4950", "shippingFor -> 599"]);
  });
  it("Python: the same, from the profile hook, with the file untouched", async () => {
    const src = `PRICES = {"a": 1000, "b": 4500}\ndef subtotal(items):\n    return sum(PRICES[i] for i in items)\ndef apply_coupon(total):\n    return round(total * 0.9)\ndef checkout(items):\n    t = subtotal(items)\n    return apply_coupon(t)\n`;
    const { answer } = await third("py", src, { exportName: "checkout", args: [{ kind: "json", value: ["a", "b"] }] });
    expect(stepsOf(answer)).toEqual(["subtotal -> 5500", "apply_coupon -> 4950"]);
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
    expect(stepsOf(answer)).toEqual(["fib -> 8 (+24)"]);
  });
  it("a recursive tested function shows its direct calls and stays exact", async () => {
    const src = `export function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); }\n`;
    const { answer } = await third("js", src, { exportName: "fact", args: [{ kind: "json", value: 4 }] });
    expect(stepsOf(answer)).toEqual(["fact -> 6 (+2)"]);
  });
  it("closures and unnamed callbacks: the named closure is a step, the callback is not", async () => {
    const src = `export function a(xs) {\n  const double = (x) => x * 2;\n  return xs.map((x) => double(x)).length;\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [{ kind: "json", value: [1, 2] }] });
    expect(stepsOf(answer)).toEqual(["double -> 2", "double -> 4"]);
  });
  it("class methods carry the class's name; a constructor runs; `this` still works", async () => {
    const src = `class Cart {\n  constructor(n) { this.n = n; }\n  total() { return this.n * 2; }\n}\nexport function a() {\n  return new Cart(21).total();\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["Cart.constructor", "Cart.total -> 42"]);
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
    expect(stepsOf(answer)).toEqual(["sum -> 3"]);
  });
  it("Python generators and coroutines give the name, no value", async () => {
    const src = `import asyncio\nasync def slow():\n    await asyncio.sleep(0.1)\n    return 5\nasync def a():\n    return await slow()\n`;
    const { answer } = await third("py", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["slow"]);
  });
  it("an async helper in JS gives its value when it is a plain value, and keeps the await's timing", async () => {
    const src = `const wait = (ms) => new Promise((r) => setTimeout(r, ms));\nasync function slow() {\n  await wait(100);\n  return 5;\n}\nexport async function a() {\n  return await slow();\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    // `wait` gives back a promise: the name alone. `slow`'s value is placed when it came, after the wait.
    expect(stepsOf(answer)).toEqual(["wait", "slow -> 5"]);
    expect((answer as { steps: HelperStep[] }).steps[1]!.t).toBe(100);
  });
  it("a helper that throws says so", async () => {
    const src = `function bad() { throw new TypeError("no"); }\nexport function a() {\n  try { bad(); } catch { return 1; }\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect(stepsOf(answer)).toEqual(["bad threw"]);
  });
  it("a value too big gives the name alone", async () => {
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
  it("code that reads its own text behaves differently under probes: no helpers, and the words say why", async () => {
    const src = `function me() { return 1; }\nexport function a() { return me.toString().length; }\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    expect("none" in answer && answer.none).toMatch(/went differently from the sealed run/);
  });
  it("a stand-in's calls stay comparable: the third run matches the sealed one", async () => {
    const src = `function total(x) { return x + 1; }\nexport async function a(load) {\n  const v = await load();\n  return total(v);\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [si("load", [{ do: "return", value: 4 }])] });
    expect(stepsOf(answer)).toEqual(["total -> 5"]);
  });
  it("hundreds of calls stay within the limit and the count is exact", async () => {
    const src = `function one(x) { return x; }\nexport function a() {\n  let s = 0;\n  for (let i = 0; i < 1000; i++) s += one(i);\n  return s;\n}\n`;
    const { answer } = await third("js", src, { exportName: "a", args: [] });
    if ("none" in answer) throw new Error(answer.none);
    expect(answer.steps.length + answer.more).toBe(1000);
    expect(answer.steps.length).toBe(400);
  });
  it("differsFrom sees any change", () => {
    const base = { trace: [{ t: 0, event: "start" }, { t: 5, event: "returned" }], result: { measured: { outcome: "returned" }, notMeasured: {} } };
    expect(differsFrom(base as never, structuredClone(base) as never)).toBeNull();
    expect(differsFrom(base as never, { ...base, trace: [{ t: 0, event: "start" }, { t: 6, event: "returned" }] } as never)).toMatch(/event 2/);
    expect(differsFrom(base as never, { ...base, result: { measured: { outcome: "threw" }, notMeasured: {} } } as never)).toMatch(/measured/);
  });
});
