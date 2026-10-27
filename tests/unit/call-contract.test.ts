// E1 (any-code spec): the shared contract for "call-function": the pasted target, the source scan, the gate
// bounds, the question text, the json bet kind (judge + seal) and the whole-run "can't check".
// Pure plain code: no sandbox here (see call-function.test.ts for runs).

import { describe, expect, it } from "vitest";
import { gate, questionsFor, describeCall, BOUNDS, renderAllowList } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { canonicalJson, sealBet, verifySeal } from "../../src/seal.ts";
import { notShownAsFact } from "../../src/trust.ts";
import { experimentKey, experimentName } from "../../src/experiment-name.ts";
import { PASTED_MAX_BYTES, makePastedTarget, pastedTargetProblems, scanJsSource, staticRefusal } from "../../src/pasted-code.ts";
import { measuredUnit } from "../../src/units.ts";
import type { Bet, BetAnswer, ExperimentShape, Run } from "../../src/types.ts";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const call = (over: Partial<Call> = {}): Call => ({
  shape: "call-function",
  exportName: "parseAmount",
  args: [
    { kind: "json", value: "1,5" },
    { kind: "stand-in", name: "fetchRate", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: 42 }] },
  ],
  ...over,
});

const run = (measured: Run["result"]["measured"], notMeasured: Run["result"]["notMeasured"] = {}, controlPassed = true): Run => ({
  id: "run1",
  experimentId: "e1",
  runner: "ts",
  executor: "local",
  codeSha256: "a".repeat(64),
  seed: "none",
  startedAt: "2026-10-27T10:00:00.000Z",
  finishedAt: "2026-10-27T10:00:01.000Z",
  trace: [{ t: 0, event: "start" }],
  result: { measured, notMeasured },
  controlPassed,
});
const bet = (measures: string, answer: BetAnswer): Bet =>
  sealBet({ who: "human", experimentId: "e1", question: "q", measures, answer }, new Date("2026-10-27T09:00:00.000Z"));

describe("pasted target", () => {
  it("is named by its fingerprint and carries its source and language", () => {
    const t = makePastedTarget("export function f() { return 1; }\n", "js");
    expect(t.kind).toBe("pasted");
    expect(t.ref).toBe(`pasted:${t.codeSha256.slice(0, 12)}`);
    expect(t.language).toBe("js");
    expect(pastedTargetProblems(t)).toEqual([]);
  });
  it("refuses empty code, an unknown language and more than 64 KB", () => {
    expect(() => makePastedTarget("   ", "js")).toThrow(/empty/);
    expect(() => makePastedTarget("x", "rb" as never)).toThrow(/language/);
    expect(() => makePastedTarget("x".repeat(PASTED_MAX_BYTES + 1), "ts")).toThrow(/limit is 65536/);
    // bytes, not characters: 22,000 three-byte characters are 66,000 bytes
    expect(() => makePastedTarget("€".repeat(22_000), "ts")).toThrow(/66000 bytes/);
  });
  it("a changed source no longer matches its fingerprint (verify recomputes it)", () => {
    const t = makePastedTarget("export const f = () => 1;", "ts");
    expect(pastedTargetProblems({ ...t, source: "export const f = () => 2;" })[0]).toMatch(/hashes to/);
    expect(pastedTargetProblems({ ...t, ref: "pasted:000000000000" })[0]).toMatch(/ref must be/);
  });
});

describe("source scan (exports and imports, plain code)", () => {
  const src = [
    "// import nothing here: a comment",
    'const s = "import(\'fs\') in a string";',
    "export function plain(a) { return a; }",
    "export async function later(x: number): Promise<number> { return x; }",
    "export const arrow = (a: Map<string, number>, b = 2) => a.size + b, other = 3;",
    "export let counter: Map<string, number> = new Map(), second = 1;",
    "export class Thing {}",
    "function hidden() {}",
    "export { hidden as shown, plain as again };",
    "export default function () {}",
    "export type T = { a: number };",
    "export interface I { b: string }",
    "const re = /import\\(x\\)/g;",
    "const tpl = `require(${'x'}) ${`nested ${1}`}`;",
  ].join("\n");
  it("lists every export with its line and how it was declared", () => {
    const s = scanJsSource(src);
    expect(s.problem).toBeUndefined();
    expect(s.exports).toEqual([
      { name: "plain", line: 3, declaredAs: "function" },
      { name: "later", line: 4, declaredAs: "function" },
      { name: "arrow", line: 5, declaredAs: "const" },
      { name: "other", line: 5, declaredAs: "const" },
      { name: "counter", line: 6, declaredAs: "let" },
      { name: "second", line: 6, declaredAs: "let" },
      { name: "Thing", line: 7, declaredAs: "class" },
      { name: "shown", line: 9, declaredAs: "list" },
      { name: "again", line: 9, declaredAs: "list" },
      { name: "default", line: 10, declaredAs: "function" },
    ]);
    // Words inside comments, strings, regexes and template text are not code.
    expect(s.imports).toEqual([]);
    expect(staticRefusal(src)).toBeNull();
  });
  it("finds every way of loading other code and names it", () => {
    const cases: [string, RegExp][] = [
      ['import _ from "lodash";\nexport const f = () => 1;', /needs lodash;/],
      ['import { readFileSync } from "node:fs";', /needs Node's built-in module fs;/],
      ['import "./side-effect.js";', /needs \.\/side-effect\.js;/],
      ['export async function f() { return import("left-pad"); }', /needs left-pad;/],
      ["export async function f(m) { return import(m); }", /needs a module named at run time;/],
      ['export function f() { return require("axios"); }', /needs axios;/],
      ['export { x } from "./other";', /needs \.\/other;/],
      ['export * from "zod";', /needs zod;/],
      ['import { type A, b } from "lib";', /needs lib;/],
    ];
    for (const [code, re] of cases) expect(staticRefusal(code), code).toMatch(re);
    // A type-only import is removed before the code runs, so it loads nothing.
    expect(staticRefusal('import type { A } from "lib";\nexport function f(a: A) { return a; }')).toBeNull();
    // A property or key named import/require is not a module load.
    expect(staticRefusal("export function f(o) { return o.import + o.require({ import: 1 }); }")).toBeNull();
  });
  it("refuses CommonJS exports with a plain sentence", () => {
    expect(staticRefusal("function f() {}\nmodule.exports = { f };")).toMatch(/CommonJS exports .*line 2/);
    expect(staticRefusal("exports.f = () => 1;")).toMatch(/CommonJS/);
  });
  it("text it cannot read is refused, not guessed", () => {
    expect(staticRefusal('export const s = "never closed;\n')).toMatch(/could not read the code: a string/);
    expect(staticRefusal("export const t = `open ${1}")).toMatch(/could not read the code/);
  });
});

describe("gate: call-function bounds", () => {
  const ctx = { exportNames: ["parseAmount", "other"] };
  it("allows a well-formed experiment and copies only its fields", () => {
    const d = gate(call({ watchLimitMs: 600_000 }), ctx);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.params).toEqual(call({ watchLimitMs: 600_000 }));
  });
  const refused: [string, unknown, RegExp][] = [
    ["an export the file does not have", call({ exportName: "nope" }), /does not export "nope"; it exports parseAmount, other/],
    ["a non-identifier export name", call({ exportName: "a b" }), /exportName must be the name/],
    ["9 arguments", call({ args: Array.from({ length: 9 }, () => ({ kind: "json" as const, value: 1 })) }), /9 arguments; the limit is 8/],
    ["a non-JSON value", { ...call(), args: [{ kind: "json", value: Number.NaN }] }, /plain JSON/],
    ["an unknown arg kind", { ...call(), args: [{ kind: "file", value: 1 }] }, /must be "json" or "stand-in"/],
    ["an extra field on a json arg", { ...call(), args: [{ kind: "json", value: 1, note: "x" }] }, /has no field "note"/],
    ["afterMs on a plain stand-in", { ...call(), args: [{ kind: "stand-in", name: "f", async: false, then: "repeat_last", calls: [{ do: "return", value: 1, afterMs: 5 }] }] }, /afterMs needs an async stand-in/],
    ["never_settle on a plain stand-in", { ...call(), args: [{ kind: "stand-in", name: "f", async: false, then: "repeat_last", calls: [{ do: "never_settle" }] }] }, /never_settle needs an async stand-in/],
    ["no steps", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: [] }] }, /1 to 50 steps/],
    ["51 steps", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: Array.from({ length: 51 }, () => ({ do: "return", value: 1 })) }] }, /1 to 50 steps/],
    ["two stand-ins with one name", { ...call(), args: [1, 2].map(() => ({ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: [{ do: "never_settle" }] })) }, /two stand-ins are named "f"/],
    ["an unknown then", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "loop", calls: [{ do: "never_settle" }] }] }, /then must be/],
    ["an error name with spaces", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "Bad Error", message: "x" }] }] }, /errorName must be a name/],
    ["a 501-character message", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "E", message: "x".repeat(501) }] }] }, /at most 500 characters/],
    ["afterMs past 600 000", { ...call(), args: [{ kind: "stand-in", name: "f", async: true, then: "repeat_last", calls: [{ do: "return", value: 1, afterMs: 600_001 }] }] }, /outside the allowed range/],
    ["watchLimitMs 600 001", call({ watchLimitMs: 600_001 }), /watchLimitMs 600001 is outside/],
    ["watchLimitMs 0", call({ watchLimitMs: 0 }), /watchLimitMs 0 is outside/],
    ["JSON values over 4 KB", call({ args: [{ kind: "json", value: "x".repeat(2_100) }, { kind: "json", value: "y".repeat(2_100) }] }), /4096/],
  ];
  for (const [what, params, re] of refused) {
    it(`refuses ${what}`, () => {
      const d = gate(params, ctx);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason).toMatch(re);
    });
  }
  it("the 4 KB limit counts the JSON values only, as canonical JSON", () => {
    const at = BOUNDS.argsJsonChars - 2; // a string of n characters is n + 2 as JSON
    expect(gate(call({ args: [{ kind: "json", value: "x".repeat(at) }] }), ctx).allowed).toBe(true);
    expect(gate(call({ args: [{ kind: "json", value: "x".repeat(at + 1) }] }), ctx).allowed).toBe(false);
  });
  it("is in the rendered allow-list with its outcome words", () => {
    const text = renderAllowList({ shapes: ["call-function"], exportNames: ["parseAmount"] });
    expect(text).toContain('shape "call-function"');
    expect(text).toContain('exportName: one of ["parseAmount"]');
    expect(text).toContain('"still_running_at_watch_limit"');
  });
});

describe("questions: written by plain code from the shape", () => {
  it("describes the call the way the spec's example does", () => {
    expect(describeCall(call())).toBe(
      'Atlas calls parseAmount("1,5", fetchRate). fetchRate (async) throws TimeoutError ("slow") on call 1, then returns 42 on call 2; every later call returns 42 too.',
    );
    const ex = describeCall(call({ args: [{ kind: "stand-in", name: "f", async: false, then: "throw_exhausted", calls: [{ do: "return", value: 1 }, { do: "return", value: 1 }, { do: "return", value: 2 }] }] }));
    expect(ex).toBe("Atlas calls parseAmount(f). f returns 1 on calls 1–2, then returns 2 on call 3; any later call throws AtlasStandInExhausted.");
  });
  it("asks about outcome, returnedJson, virtualMs and each stand-in's calls, with the right answer kinds", () => {
    const qs = questionsFor(call());
    expect(qs.map((q) => [q.measures, q.kind, q.unit])).toEqual([
      ["outcome", "enum", "enum"],
      ["returnedJson", "json", "json"],
      ["virtualMs", "number", "ms"],
      ["calls:fetchRate", "integer", "count"],
    ]);
    expect(qs[0]!.options).toEqual(["returned", "threw", "never_settled", "still_running_at_watch_limit"]);
    expect(qs[0]!.text.endsWith("What does parseAmount do?")).toBe(true);
    expect(qs[2]!.tolerancePct).toBe(10);
    // Same params, same text: the question is sealed with the bet, so it must never vary.
    expect(questionsFor(call())).toEqual(qs);
  });
  it("names an experiment without printing free text, and fills the default watch limit for sameness", () => {
    expect(experimentName(call())).toBe("call-function · exportName parseAmount · 2 args (1 JSON, 1 stand-in)");
    expect(experimentKey(call())).toBe(experimentKey(call({ watchLimitMs: 30_000 })));
  });
});

describe("judge: json bets, call outcome words, whole-run can't check", () => {
  it("a json bet matches by canonical JSON (key order and spacing do not matter)", () => {
    const r = run({ returnedJson: canonicalJson({ a: 1, b: [true, null] }) });
    expect(judge(bet("returnedJson", { kind: "json", value: { b: [true, null], a: 1 } }), r).outcome).toBe("matched");
    expect(judge(bet("returnedJson", { kind: "json", value: { a: 1, b: [true] } }), r).outcome).toBe("not_matched");
    expect(judge(bet("returnedJson", { kind: "json", value: "1" }), run({ returnedJson: "1" })).outcome).toBe("not_matched"); // the text "1" is not the number 1
    expect(judge(bet("returnedJson", { kind: "json", value: 1 }), run({ returnedJson: "1" })).outcome).toBe("matched");
  });
  it("a json bet on a field that is not JSON, or another kind on returnedJson, is can't check", () => {
    expect(judge(bet("calls:f", { kind: "json", value: 2 }), run({ "calls:f": 2 })).reason).toMatch(/bet unit "json" does not match measured unit "count"/);
    expect(judge(bet("returnedJson", { kind: "integer", value: 1 }), run({ returnedJson: "1" })).reason).toMatch(/does not match measured unit "json"/);
    expect(judge(bet("returnedJson", { kind: "json", value: 1 }), run({}, { returnedJson: "the returned value is not stored as plain JSON: it is undefined" })).reason).toMatch(/undefined/);
  });
  it("a json bet whose value is not plain JSON cannot be compared", () => {
    const b = { ...bet("returnedJson", { kind: "json", value: 1 }), answer: { kind: "json", value: Number.NaN } } as Bet;
    expect(judge(b, run({ returnedJson: "1" })).reason).toBe("the bet's value is not plain JSON");
  });
  it("outcome bets must draw every option from ONE list (call words or retry words)", () => {
    const callOpts = ["returned", "threw", "never_settled", "still_running_at_watch_limit"];
    expect(judge(bet("outcome", { kind: "enum", value: "threw", options: callOpts }), run({ outcome: "threw" })).outcome).toBe("matched");
    expect(judge(bet("outcome", { kind: "enum", value: "returns", options: ["returns", "throws", "pending"] }), run({ outcome: "returns" })).outcome).toBe("matched");
    const mixed = judge(bet("outcome", { kind: "enum", value: "threw", options: ["returned", "threw", "pending"] }), run({ outcome: "threw" }));
    expect(mixed.outcome).toBe("cant_check");
    expect(mixed.reason).toMatch(/options include "pending", which the runner never reports/);
    // A call-function bet judged on a retry run: the word is not one of the bet's options, so no verdict.
    expect(judge(bet("outcome", { kind: "enum", value: "threw", options: callOpts }), run({ outcome: "throws" })).reason).toBe("observed value is not one of the options");
  });
  it("stand-in call counts and virtual ms have units; thrownName has none (no bet can be judged on it yet)", () => {
    expect(measuredUnit("calls:fetchRate")).toBe("count");
    expect(measuredUnit("calls:")).toBeUndefined();
    expect(measuredUnit("virtualMs")).toBe("ms");
    expect(judge(bet("calls:fetchRate", { kind: "integer", value: 2 }), run({ "calls:fetchRate": 2 })).outcome).toBe("matched");
    expect(judge(bet("virtualMs", { kind: "number", value: 1000, tolerancePct: 10, unit: "ms" }), run({ virtualMs: 1050 })).outcome).toBe("matched");
    expect(judge(bet("thrownName", { kind: "json", value: "TypeError" }), run({ thrownName: "TypeError" })).reason).toMatch(/no unit on file for thrownName/);
  });
  it("a whole-run reason makes EVERY bet can't check with that reason, whatever it measured", () => {
    const why = "the code needs lodash; Atlas runs one pasted file on its own, with no packages or other modules";
    const r = run({ outcome: "returned", "calls:f": 1 }, { wholeRun: why });
    for (const b of [bet("outcome", { kind: "enum", value: "returned", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] }), bet("calls:f", { kind: "integer", value: 1 }), bet("returnedJson", { kind: "json", value: 1 })]) {
      const v = judge(b, r);
      expect(v.outcome).toBe("cant_check");
      expect(v.reason).toBe(why);
    }
    expect(notShownAsFact(r)).toBe(`Atlas could not check this run, so nothing from it is shown as fact: ${why}`);
  });
});

describe("seal: the json bet kind", () => {
  it("seals and verifies; the value is part of the hash", () => {
    const b = bet("returnedJson", { kind: "json", value: { z: [1, { y: null }], a: "x" } });
    expect(verifySeal(b)).toBe(true);
    expect(verifySeal({ ...b, answer: { kind: "json", value: { z: [1, { y: null }], a: "X" } } })).toBe(false);
    // Key order is not part of the answer: the same value written in another order still verifies.
    expect(verifySeal({ ...b, answer: { kind: "json", value: { a: "x", z: [1, { y: null }] } } })).toBe(true);
  });
  it("refuses to seal a value that is not plain JSON", () => {
    expect(() => bet("returnedJson", { kind: "json", value: { a: undefined } as never })).toThrow(/undefined/);
    expect(() => bet("returnedJson", { kind: "json", value: Number.POSITIVE_INFINITY })).toThrow(/Infinity/);
  });
});
