// D65 review R1–R5, J2–J5: what the machine says must be what the code and the run say. Each failed at 2859dab.
import { describe, expect, it } from "vitest";
import { auditMachine } from "../../renderer/machine/audit";
import { drawMachine, endOfRun, machineParts, MACHINE_MIN_WORD_PX, ranParts, ringFor, type MachineParts } from "../../renderer/authors/machine";
import { machineScript } from "../../renderer/authors/machine-script";
import { fileOutline } from "../../src/file-outline";
import { benchModel, type CallTest } from "../../web/machines/bench/model";

const model = (src: string, language: "js" | "ts" | "py", tested?: string, test: CallTest | null = null) => {
  const outline = fileOutline(src, language);
  const m = benchModel({ fileName: "p", outline, test, source: src, language });
  const full = { ...m, tested: tested ?? m.tested };
  return { outline, parts: machineParts(full, outline, src, language) };
};
const house = (p: MachineParts, id: string) => p.housings.find((h) => h.id === id)!;
const none = { loops: [] as number[], throws: [] as number[], returns: [] as number[] };

describe("R5: parts come from syntax", () => {
  const cases: [string, string, Partial<typeof none>][] = [
    ["a regex holding throw", "export function f(s) {\n  return /throw new/.test(s);\n}\n", { returns: [2], throws: [], loops: [] }],
    ["a regex holding for", "export function f(s) {\n  return /for (x)/.test(s);\n}\n", { returns: [2], loops: [] }],
    ["Symbol.for", 'export function f() {\n  return Symbol.for("x");\n}\n', { returns: [2], loops: [] }],
    ["q.for and q.while", "export function f(q) {\n  q.for(1).while(2);\n}\n", { loops: [], returns: [] }],
    ["g.throw and g.return", "export function f(g, e) {\n  g.throw(e);\n  g.return(1);\n}\n", { throws: [], returns: [] }],
    ["an object's keys", "export function f() {\n  const o = { throw: 1, return: 2 };\n  o.x = 1;\n}\n", { throws: [], returns: [] }],
    ["a nested throw never called", 'export function f() {\n  const g = () => { throw new Error("x"); };\n  return 1;\n}\n', { throws: [], returns: [3] }],
    ["a callback's return", "export function f(a) {\n  a.forEach((v) => {\n    return v;\n  });\n}\n", { returns: [] }],
    ["a loop in a nested function", "export function f() {\n  function g() {\n    for (;;) {}\n  }\n  return g;\n}\n", { loops: [], returns: [5] }],
  ];
  for (const [name, src, want] of cases) {
    it(`JS: ${name}`, () => {
      expect(house(model(src, "js", "f").parts, "f")).toMatchObject(want);
    });
  }
  it("JS: the real ones still draw", () => {
    const h = house(model('export function f(a) {\n  for (const x of a) {\n    if (x) throw new Error("no");\n  }\n  return 1;\n}\n', "js", "f").parts, "f");
    expect(h.loops).toEqual([2]);
    expect(h.throws).toEqual([3]);
    expect(h.returns).toEqual([5]);
    expect(h.throwSites[0]).toMatchObject({ name: "Error", message: "no", exact: true });
  });
  it("Python: raise, loop and return in a nested def are not the outer function's; a comprehension is not a loop", () => {
    const src = 'def f(a):\n    def g():\n        for i in a:\n            raise ValueError("x")\n        return 2\n    b = [\n        x for x in a\n    ]\n    return g\n';
    expect(house(model(src, "py", "f").parts, "f")).toMatchObject({ loops: [], throws: [], returns: [9] });
  });
  it("Python: the decorator's own return only", () => {
    const src = "def cached(fn):\n    def inner(x):\n        return fn(x)\n    return inner\n";
    expect(house(model(src, "py", "cached").parts, "cached").returns).toEqual([4]);
  });
  it("a class says class, with no fittings from its methods", () => {
    const src = 'export class K {\n  m() {\n    for (;;) { throw new Error("x"); }\n  }\n}\n';
    const { parts } = model(src, "js", "K");
    expect(house(parts, "K")).toMatchObject({ kind: "class", loops: [], throws: [], returns: [] });
    expect(drawMachine(parts, { seed: "c" }).svg).toMatch(/K: a class, lines 1–5/);
  });
});

describe("R3: wraps is a decorator, and nothing else", () => {
  it("a function passed by name is used, not wrapping", () => {
    const { parts } = model("function fmt(v) { return v; }\nexport function f(a = []) {\n  return a.map(fmt);\n}\n", "js", "f");
    expect(parts.pipes).toEqual([{ from: "f", to: "fmt", kind: "uses" }]);
    const svg = drawMachine(parts, { seed: "u" }).svg;
    expect(svg).toContain("f uses fmt");
    expect(svg).not.toContain("wraps");
  });
  it("a Python decorator still wraps", () => {
    const { parts } = model("def deco(fn):\n    return fn\n\n@deco\ndef f():\n    return 1\n", "py", "f");
    expect(parts.pipes[0]).toMatchObject({ kind: "wraps" });
  });
});

const fake = (name: string, calls: unknown[]) => ({ shape: "call-function", exportName: "f", args: [{ kind: "stand-in", name, async: true, then: "repeat_last", calls }] }) as unknown as CallTest;
const endFor = (p: MachineParts, o: { outcome: unknown; name?: string | null; message?: string | null; steps?: { name: string }[]; test?: unknown; called?: string[]; tested?: string }) => {
  const tested = o.tested ?? "f";
  const called = (port: string) => (o.called ?? []).includes(port);
  return endOfRun({ outcome: o.outcome, thrown: { name: o.name ?? null, message: o.message ?? null }, parts: p, tested, test: o.test, ran: ranParts({ tested, steps: o.steps ?? [], parts: p, called }), called });
};

describe("R1, R2: red and the ring go only where the facts place the end", () => {
  it("it returned: no chute goes red", () => {
    const { parts } = model('export function f(x) {\n  if (x === 9) throw new Error("no");\n  return 1;\n}\n', "js", "f");
    const end = endFor(parts, { outcome: "returned" });
    expect(end).toEqual({ part: "f", on: "outlet" });
    const d = drawMachine(parts, { seed: "r", ended: true, end, ring: ringFor({ kind: "not_matched", you: "throws", end, tested: "f" }) });
    expect(d.svg).not.toContain('data-red="chute"');
  });
  it("its own throw: its chute, and only its chute", () => {
    const { parts } = model('function g() {\n  throw new Error("other");\n}\nexport function f() {\n  throw new Error("mine");\n}\n', "js", "f");
    const end = endFor(parts, { outcome: "threw", name: "Error", message: "mine" });
    expect(end).toMatchObject({ part: "f", on: "chute", line: 5 });
    const svg = drawMachine(parts, { seed: "r", ended: true, end }).svg;
    expect(svg.match(/data-red="chute"/g)).toHaveLength(1);
  });
  it("a fake threw, and an unrelated function has a throw that never ran: the fake", () => {
    const test = fake("x", [{ do: "throw", errorName: "Error", message: "from fake" }]);
    const { parts } = model('function validate(v) {\n  if (!v) throw new Error("bad");\n}\nexport async function f(x) {\n  return await x();\n}\n', "js", "f", test);
    expect(endFor(parts, { outcome: "threw", name: "Error", message: "from fake", test, called: ["stand-in x"] })).toEqual({ part: "stand-in x", on: "port" });
  });
  it("a throw caught, then another: the one that got out, and only if that function is known to have run", () => {
    const { parts } = model('function boom() {\n  throw new Error("x");\n}\nfunction real() {\n  throw new Error("real");\n}\nexport function f() {\n  try { boom(); } catch (e) {}\n  real();\n}\n', "js", "f");
    expect(endFor(parts, { outcome: "threw", name: "Error", message: "real", steps: [{ name: "boom" }, { name: "real" }] })).toMatchObject({ part: "real", on: "chute" });
    expect(endFor(parts, { outcome: "threw", name: "Error", message: "real" })).toBeNull();
  });
  it("a library's error matches no throw: no part is ringed, and the words sit alone", () => {
    const { parts } = model('export function f(s) {\n  if (s === 1) throw new Error("mine");\n  return JSON.parse(s);\n}\n', "js", "f");
    const end = endFor(parts, { outcome: "threw", name: "SyntaxError", message: "Unexpected token" });
    expect(end).toBeNull();
    const ring = ringFor({ kind: "not_matched", you: "returns a value", end, tested: "f" })!;
    expect(ring.on).toBe("words");
    const svg = drawMachine(parts, { seed: "r", ended: true, end, ring }).svg;
    expect(svg).not.toContain('class="m-ring"');
    expect(svg).toContain("you said returns a value");
    expect(svg).not.toContain('data-red="chute"');
  });
  it("two throws with the same words: not placed", () => {
    const { parts } = model('export function f(a) {\n  if (a) throw new Error("no");\n  throw new Error("no");\n}\n', "js", "f");
    expect(endFor(parts, { outcome: "threw", name: "Error", message: "no" })).toBeNull();
  });
  it("a template's start is enough, on the right class", () => {
    const { parts } = model("export function f(s) {\n  throw new TypeError(`HTTP ${s}`);\n}\n", "js", "f");
    expect(endFor(parts, { outcome: "threw", name: "TypeError", message: "HTTP 429" })).toMatchObject({ on: "chute" });
    expect(endFor(parts, { outcome: "threw", name: "Error", message: "HTTP 429" })).toBeNull();
  });
  it("a matched bet: the chute may be red, but there is no ring", () => {
    expect(ringFor({ kind: "matched", you: "throws", end: { part: "f", on: "chute", line: 2 }, tested: "f" })).toBeNull();
  });
});

const step = (over: Record<string, unknown>) => ({ id: "s", nodes: ["n"], edges: [], provenance: "run", ...over }) as never;
describe("R4: a thread needs the true caller; a dial needs a function known to have run", () => {
  it("a helper that didn't make the call gets no thread: each helper step starts from the tested function", () => {
    const { parts, outline } = model("function b() {\n  return 2;\n}\nfunction a(flag) {\n  if (flag) b();\n  return 1;\n}\nexport function f() {\n  a(false);\n  b();\n  return 3;\n}\n", "js", "f");
    const beats = machineScript({ nodes: [], steps: [step({ beat: "call", part: "a" }), step({ beat: "call", part: "b" })] }, parts, outline, "f");
    expect(beats[0]!.routes).toEqual(["f->a"]);
    expect(beats[1]!.routes.join()).not.toContain("a->b");
  });
  it("a dial on a function that never ran stays still", () => {
    const test = fake("x", [{ do: "return", value: 1, afterMs: 500 }]);
    const { parts, outline } = model("function slow() {\n  return new Promise((r) => setTimeout(r, 100));\n}\nexport async function f(x) {\n  await x();\n  return 1;\n}\n", "js", "f", test);
    expect(house(parts, "slow").waits.length).toBe(1);
    const beats = machineScript({ nodes: [{ id: "n", kind: "clock", sweep: 0.3 } as never], steps: [step({ beat: "wait", device: "clock" })] }, parts, outline, "f");
    expect(beats[0]!.dial).toBeUndefined();
  });
  it("a fake with two possible callers: its lamp, but no thread", () => {
    const test = fake("x", [{ do: "return", value: 1 }]);
    const { parts, outline } = model("function h(x) {\n  return x();\n}\nexport async function f(x) {\n  if (x === 0) x();\n  return await h(x);\n}\n", "js", "f", test);
    const port = parts.ports.find((q) => q.name === "x");
    expect(port?.from.length).toBeGreaterThan(1);
    const beats = machineScript({ nodes: [], steps: [step({ beat: "call", device: "x" })] }, parts, outline, "f");
    expect(beats[0]!.routes).toEqual([]);
    expect(beats[0]!.lamps).toEqual([port!.id]);
  });
  it("a fake with one caller: the true route", () => {
    const test = fake("x", [{ do: "return", value: 1 }]);
    const { parts, outline } = model("function h(x) {\n  return x();\n}\nexport async function f(x) {\n  return await h(x);\n}\n", "js", "f", test);
    const beats = machineScript({ nodes: [], steps: [step({ beat: "call", device: "x" })] }, parts, outline, "f");
    expect(beats[0]!.routes).toEqual(["f->h", "h->stand-in x"]);
  });
});

describe("J2, J3, J5", () => {
  it("every word's size is reported, so the page can hold a floor of 11 px", () => {
    expect(MACHINE_MIN_WORD_PX).toBe(11);
    const { parts } = model('export function f() {\n  return 1;\n}\n', "js", "f");
    expect(drawMachine(parts, { seed: "w" }).minWords).toBeGreaterThan(5);
  });
  it("two functions calling one fake still draw", () => {
    const test = fake("x", [{ do: "return", value: 1 }]);
    const { parts } = model("function h(x) {\n  return x();\n}\nexport async function f(x) {\n  await x();\n  return h(x);\n}\n", "js", "f", test);
    const d = drawMachine(parts, { seed: "shared" });
    expect(d.tooMany).toBeUndefined();
    expect(d.problems).toEqual([]);
  });
  it("a hub calling seven helpers draws, or says so in plain words with no pipe's name", () => {
    const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    const src = `${names.map((n) => `function ${n}() {\n  return 1;\n}`).join("\n")}\nexport function hub() {\n  ${names.map((n) => `${n}();`).join("\n  ")}\n}\n`;
    const d = drawMachine(model(src, "js", "hub").parts, { seed: "h" });
    expect(d.tooMany ?? "").not.toMatch(/->|pipe hub/);
    if (!d.tooMany) expect(d.problems).toEqual([]);
  });
  it("the audit fails a pipe that ends on nothing, and a red with no throw behind it", () => {
    const f = { reds: [{ kind: "chute" as const, part: "f", line: 9 }], housings: [{ id: "f", throws: [2] }], owners: [], labels: [], routes: [{ id: "a->b", from: "a", to: "b", page: [[0, 0], [1, 1]] as [number, number][], chevrons: 1, ends: [{ part: "b", at: [900, 900, 0] as [number, number, number] }], plans: { b: { x: 0, y: 0, w: 10, d: 10 } }, nearEnds: [[0, 0], [0, 0]] as [[number, number], [number, number]] }] };
    const out = auditMachine(f).join(" | ");
    expect(out).toMatch(/ends on nothing/);
    expect(out).toMatch(/red chute on f has no throw/);
  });
  it("wide characters are measured wide", async () => {
    const { textWidth } = await import("../../renderer/machine/pencil");
    expect(textWidth("计算订单", 10)).toBeGreaterThan(textWidth("abcd", 10) * 1.5);
  });
});
