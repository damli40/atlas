// D65: the machine's truth and its audit. Every part comes from plain facts about the code, and a picture that hides a pipe or stacks words is not shown.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { drawMachine, machineParts, MACHINE_PART_LIMIT } from "../../renderer/authors/machine";
import { auditMachine } from "../../renderer/machine/audit";
import { machineScript } from "../../renderer/authors/machine-script";
import { fileOutline } from "../../src/file-outline";
import { benchModel } from "../../web/machines/bench/model";

const ORDERS = readFileSync(new URL("../evidence/U3/inputs/orders.ts", import.meta.url), "utf8");
const PLAN = readFileSync(new URL("../evidence/U3/inputs/plan_cache.py", import.meta.url), "utf8");
const BRANCHING = `const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoffMs(attempt: number) {
  return 200 * 2 ** attempt;
}
export function parse(text: string) {
  if (!text) throw new Error("empty");
  return JSON.parse(text);
}
export async function fetchWithRetry(fetchIt: () => Promise<string>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return parse(await fetchIt());
    } catch (e) {
      await sleep(backoffMs(i));
    }
  }
  throw new Error("gave up");
}
export async function getPrice(fetchIt: () => Promise<string>) {
  const body = await fetchWithRetry(fetchIt);
  return body.price;
}
`;
const FAN = `export function a(x) { return b(x) + c(x) + d(x) + e(x); }
function b(x) { return f(x); }
function c(x) { return f(x) + 1; }
function d(x) { return g(x); }
function e(x) { return g(x) + 2; }
function f(x) { return x; }
function g(x) { return x * 2; }
`;
const CYCLE = `export function ping(n) { return n ? pong(n - 1) : 0; }
export function pong(n) { return n ? ping(n - 1) : 1; }
`;
const ONE = `export const add = (a, b) => a + b;\n`;
const model = (src: string, language: "js" | "ts" | "py", tested?: string) => {
  const outline = fileOutline(src, language);
  const m = benchModel({ fileName: "pasted", outline, test: null, source: src, language });
  return { outline, m: { ...m, tested: tested ?? m.tested }, parts: machineParts({ ...m, tested: tested ?? m.tested }, outline, src, language) };
};

describe("the parts come from the code", () => {
  it("orders.ts: the loop, the self-call, the wait, the throw, the outside call, on the right functions", () => {
    const { parts } = model(ORDERS, "ts", "fetchAllOrders");
    const by = Object.fromEntries(parts.housings.map((h) => [h.id, h]));
    expect(by.fetchAllOrders!.tested).toBe(true);
    expect(by.fetchAllOrders!.loops.length).toBeGreaterThan(0);
    expect(by.fetchAllOrders!.throws).toEqual([]);
    expect(by.fetchPage!.selfCalls.length).toBeGreaterThan(0);
    expect(by.fetchPage!.waits.length).toBeGreaterThan(0);
    expect(by.fetchPage!.throws.length).toBe(1);
    expect(parts.ports).toMatchObject([{ name: "fetch", faked: false, from: ["fetchPage"] }]);
  });
  it("a word in a comment or a string draws nothing", () => {
    const { parts } = model('export function f() {\n  // throw for and while\n  const s = "throw while(1)";\n  return s;\n}\n', "js");
    expect(parts.housings[0]).toMatchObject({ throws: [], loops: [], waits: [] });
  });
  it("Python: a raise, a loop and a sleep", () => {
    const { parts } = model('import time\ndef f(n):\n    for i in range(n):\n        time.sleep(1)\n    raise ValueError("no")\n', "py");
    expect(parts.housings[0]!.loops).toEqual([3]);
    expect(parts.housings[0]!.throws).toEqual([5]);
    expect(parts.housings[0]!.waits).toEqual([4]);
  });
  it("every part says what it stands for, and its lines", () => {
    const { parts } = model(ORDERS, "ts", "fetchAllOrders");
    const d = drawMachine(parts, { seed: "t" });
    for (const m of d.svg.matchAll(/<g class="m-part"[^>]*aria-label="([^"]+)"/g)) expect(m[1]!.length).toBeGreaterThan(4);
    expect(d.svg).toMatch(/aria-label="fetchPage: a function, lines 3–11/);
  });
  it("every housing has one footprint: size says nothing", () => {
    const { parts } = model(BRANCHING, "ts", "getPrice");
    const d = drawMachine(parts, { seed: "t" });
    expect(new Set(d.facts!.owners.map((o) => o.part)).size).toBe(parts.housings.length);
  });
});

describe("the audit passes on real files and fails on broken pictures", () => {
  for (const [name, src, lang, tested] of [["orders", ORDERS, "ts", "fetchAllOrders"], ["python", PLAN, "py", "get_user_plan"], ["branching", BRANCHING, "ts", "getPrice"], ["fan", FAN, "js", "a"], ["one", ONE, "js", "add"]] as const) {
    it(name, () => {
      const { parts } = model(src, lang, tested);
      const t0 = performance.now();
      const d = drawMachine(parts, { seed: name });
      expect(d.tooMany).toBeUndefined();
      expect(d.problems).toEqual([]);
      expect(performance.now() - t0).toBeLessThan(400);
    });
  }
  it("two functions that call each other: a clean picture, or the chart with the reason in words, never a hidden pipe", () => {
    const { parts } = model(CYCLE, "js", "ping");
    const d = drawMachine(parts, { seed: "c" });
    if (d.problems.length) expect(d.problems.join()).toMatch(/pipe/);
  });
  it("a pipe over a part it does not join fails", () => {
    const { parts } = model(BRANCHING, "ts", "getPrice");
    const f = drawMachine(parts, { seed: "x" }).facts!;
    const other = f.owners.find((o) => o.part === "parse")!;
    const c: [number, number] = [(other.solid.x0 + other.solid.x1) / 2, (other.solid.y0 + other.solid.y1) / 2];
    const bad = { ...f, routes: [{ id: "a->b", from: "getPrice", to: "fetchWithRetry", page: [[c[0] - 40, c[1]], [c[0] + 40, c[1]]] as [number, number][], chevrons: 1, endsAtParts: true, nearEnds: [[9999, 9999], [9999, 9999]] as [[number, number], [number, number]] }] };
    expect(auditMachine(bad).join()).toMatch(/does not join/);
  });
  it("a pipe with no direction, and words on words, fail", () => {
    const r = { x0: 0, x1: 50, y0: 5000, y1: 5020 };
    const out = auditMachine({ owners: [], routes: [{ id: "p", from: "a", to: "b", page: [[0, 0], [1, 1]], chevrons: 0, endsAtParts: true, nearEnds: [[0, 0], [0, 0]] }], labels: [{ part: "a", text: "one", rect: r }, { part: "b", text: "two", rect: r }] });
    expect(out.join()).toMatch(/which way/);
    expect(out.join()).toMatch(/words overlap/);
  });
  it("past the part limit: words, and the chart", () => {
    const many = Array.from({ length: MACHINE_PART_LIMIT + 1 }, (_, i) => `export function f${i}() { return ${i}; }`).join("\n");
    const d = drawMachine(model(many, "js").parts, { seed: "x" });
    expect(d.svg).toBe("");
    expect(d.tooMany).toMatch(/box chart/);
  });
});

describe("the run through the pipes says only what the path says", () => {
  const parts = model(ORDERS, "ts", "fetchAllOrders");
  it("a call to the fake goes down the one certain route", () => {
    const withFake = { ...parts.parts, ports: [{ id: "stand-in fetch", name: "fetch", faked: true, from: ["fetchPage"] }] };
    const beats = machineScript({ nodes: [], steps: [{ id: "s0", nodes: ["n"], edges: [], provenance: "run", beat: "call", device: "fetch" }] }, withFake, parts.outline as never, "fetchAllOrders");
    expect(beats[0]!.routes).toEqual(["fetchAllOrders->fetchPage", "fetchPage->stand-in fetch"]);
    expect(beats[0]!.lamps).toContain("stand-in fetch");
  });
  it("a step with no known part lights nothing", () => {
    const beats = machineScript({ nodes: [], steps: [{ id: "s0", nodes: ["n"], edges: [], provenance: "run", beat: "note", words: "a note" }] }, parts.parts, parts.outline as never, "fetchAllOrders");
    expect(beats[0]).toMatchObject({ routes: [], lamps: [] });
  });
  it("a wait moves a dial only on a function that waits", () => {
    const beats = machineScript({ nodes: [{ id: "n", kind: "clock", words: "w", provenance: "run", sweep: 0.3 } as never], steps: [{ id: "s0", nodes: ["n"], edges: [], provenance: "run", beat: "wait", device: "clock" }] }, parts.parts, parts.outline as never, "fetchAllOrders");
    expect(beats[0]!.dial).toEqual({ part: "fetchPage", sweep: 0.3 });
  });
});
