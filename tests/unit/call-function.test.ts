// E1 (any-code spec): pasted JavaScript/TypeScript run end to end in the real sandbox (Node --permission), and
// made to fail on purpose. Each test pastes a small file, runs one call-function experiment through the TS
// runner, and checks what was measured, or that the WHOLE run is "can't check" with a plain reason (never a
// fake `outcome: threw`). The last block breaks the harness on purpose and checks that the control catches it.

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { makePastedTarget, exportedFunctions } from "../../src/pasted-code.ts";
import { BUILTINS_CHANGED_REASON } from "../../runners/ts/harness.ts";
import { CALL_CONTROL_CASES, CALL_SEED, runCallControl, runCallExperiment, runInSandbox, toWire } from "../../runners/ts/call-runner.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import { tsRunner } from "../../runners/ts/control.ts";
import type { Executor } from "../../runners/runner.ts";
import type { ArgSpec, BetAnswer, Experiment, ExperimentShape, Run } from "../../src/types.ts";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const CALL_OPTIONS = ["returned", "threw", "never_settled", "still_running_at_watch_limit"];

let control: Run;
beforeAll(async () => {
  control = (await runCallControl()).run;
});

function experiment(source: string, params: Partial<Call> & { exportName: string }, language: "js" | "ts" = "js"): Experiment {
  const target = makePastedTarget(source, language);
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: exportedFunctions(source).map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

async function runPasted(source: string, params: Partial<Call> & { exportName: string }, opts: { language?: "js" | "ts"; wallClockMs?: number } = {}): Promise<Run> {
  return runCallExperiment(experiment(source, params, opts.language), control, { ...(opts.wallClockMs ? { wallClockMs: opts.wallClockMs } : {}) });
}

const standIn = (name: string, calls: Extract<ArgSpec, { kind: "stand-in" }>["calls"], over: Partial<Extract<ArgSpec, { kind: "stand-in" }>> = {}): ArgSpec => ({
  kind: "stand-in",
  name,
  async: true,
  then: "repeat_last",
  calls,
  ...over,
});

/** Every bet kind on every measured field: on a whole-run can't-check run, each verdict must be cant_check with the reason. */
function expectWholeRun(r: Run, re: RegExp): void {
  expect(r.result.notMeasured.wholeRun, JSON.stringify(r.result)).toMatch(re);
  expect(r.result.measured).toEqual({});
  expect("outcome" in r.result.measured).toBe(false);
  const bets: [string, BetAnswer][] = [
    ["outcome", { kind: "enum", value: "threw", options: CALL_OPTIONS }],
    ["returnedJson", { kind: "json", value: null }],
    ["virtualMs", { kind: "number", value: 0, tolerancePct: 10, unit: "ms" }],
  ];
  for (const [measures, answer] of bets) {
    const v = judge(sealBet({ who: "human", experimentId: r.experimentId, question: "q", measures, answer }), r);
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe(r.result.notMeasured.wholeRun);
  }
}

describe("the call-function control (known cases through the same sandbox)", () => {
  it("passes on the shipped reference file, every case matched", () => {
    expect(control.controlPassed).toBe(true);
    expect(control.trace.at(-1)?.event).toBe("control_matched");
    expect(CALL_CONTROL_CASES.length).toBeGreaterThanOrEqual(9);
    // Each measured fact of each case is in the control run under "<case>.<field>".
    expect(control.result.measured["C3-async-stand-in.virtualMs"]).toBe(1950);
    expect(control.result.measured["C4-never-settles.outcome"]).toBe("never_settled");
  });
});

describe("a pasted file runs end to end", () => {
  it("JavaScript: JSON args in, JSON out, stand-in counted, virtual time measured", async () => {
    const src = `export async function parseAmount(text, fetchRate) {
  let rate;
  for (let i = 0; i < 3; i++) {
    try { rate = await fetchRate(); break; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
  }
  return { value: Number(text.replace(",", ".")) * rate, tries: 1 };
}`;
    const r = await runPasted(src, {
      exportName: "parseAmount",
      args: [{ kind: "json", value: "1,5" }, standIn("fetchRate", [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: 42, afterMs: 200 }])],
    });
    expect(r.controlPassed).toBe(true);
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 1200, "calls:fetchRate": 2, returnedJson: '{"tries":1,"value":63}', returnedType: "object" });
    expect(r.seed).toBe(CALL_SEED);
    const v = judge(sealBet({ who: "human", experimentId: "exp1", question: "q", measures: "returnedJson", answer: { kind: "json", value: { value: 63, tries: 1 } } }), r);
    expect(v.outcome).toBe("matched");
  });

  it("TypeScript with type annotations runs (Node strips the types)", async () => {
    const src = `type Rate = number;
interface Opts { scale?: number }
export function scale(x: number, opts: Opts = {}): Rate { const s: number = opts.scale ?? 2; return x * s; }
export const asConst = <T,>(v: T): T => v;`;
    const r = await runPasted(src, { exportName: "scale", args: [{ kind: "json", value: 21 }] }, { language: "ts" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "42" });
  });

  it("TypeScript with an enum: whole run can't check, in Node's own words", async () => {
    const src = `enum Color { Red, Green }\nexport function pick(): number { return Color.Green; }`;
    const r = await runPasted(src, { exportName: "pick" }, { language: "ts" });
    expectWholeRun(r, /^Node could not run the code as written: SyntaxError \[ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX\]: TypeScript enum is not supported in strip-only mode/);
    expect(r.result.notMeasured.wholeRun).not.toMatch(/atlas-exec|\/var\/|\/tmp\//);
  });

  it("a .atlas.json of a pasted round carries the source and verifies; a changed source does not", async () => {
    const src = "export function add(a, b) { return a + b; }";
    const exp = experiment(src, { exportName: "add", args: [{ kind: "json", value: 2 }, { kind: "json", value: 3 }] });
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: 5 } });
    await new Promise((r) => setTimeout(r, 5));
    const r = await runCallExperiment(exp, control);
    const file = buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() });
    const json = JSON.parse(JSON.stringify(file));
    expect(verifyAtlasFile(json).ok).toBe(true);
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.target.source = "export function add(a, b) { return a - b; }";
    const v = verifyAtlasFile(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems.join("; ")).toMatch(/hashes to/);
    const forged = JSON.parse(JSON.stringify(file));
    forged.runs[0].result.measured["virtualMs"] = 7;
    const f = verifyAtlasFile(forged);
    expect(f.ok).toBe(false);
  });

  it("the TS runner dispatches a pasted target to the call-function path (control first)", async () => {
    const exp = experiment("export const twice = (x) => x * 2;", { exportName: "twice", args: [{ kind: "json", value: 4 }] });
    const r = await tsRunner().run(exp, {});
    expect(r.controlPassed).toBe(true);
    expect(r.result.measured.returnedJson).toBe("8");
    const c = await tsRunner().control(exp.target);
    expect(c.experimentId).toBe("control:call-function");
  });
});

describe("returned values that are not plain JSON", () => {
  const cases: [string, string, RegExp][] = [
    ["return undefined;", "undefined", /it is undefined/],
    ["return NaN;", "number (NaN)", /it is NaN/],
    ["return 10n ** 20n;", "bigint", /BigInt/],
    ["return () => 1;", "function", /function/],
    ["const a = { b: {} }; a.b.a = a; return a;", "object", /cycle/],
    ['return "x".repeat(10 * 1024);', "string", /longer than 2048 characters as JSON \(10240 characters of text\)/],
    ["return new Map([[1, 2]]);", "object (Map)", /not a plain object/],
    ['return Object.defineProperty({}, "a", { get() { throw new Error("boom"); }, enumerable: true });', "object", /getter/],
    ["return [1, , 3];", "array", /holes/],
  ];
  for (const [body, type, why] of cases) {
    it(`${body} → returned, returnedType "${type}", returnedJson not measured`, async () => {
      const r = await runPasted(`export function f() { ${body} }`, { exportName: "f" });
      expect(r.result.measured.outcome).toBe("returned");
      expect(r.result.measured.returnedType).toBe(type);
      expect(r.result.measured.returnedJson).toBeUndefined();
      expect(r.result.notMeasured.returnedJson).toMatch(why);
      expect(r.result.notMeasured.wholeRun).toBeUndefined();
    });
  }
});

describe("thrown values that are not Errors", () => {
  it("a thrown string: threw, no name or message measured", async () => {
    const r = await runPasted(`export function f() { throw "boom"; }`, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownType: "string", virtualMs: 0 });
    expect(r.result.notMeasured.thrownName).toMatch(/threw a string \("boom"\), not an Error, so it has no name/);
    expect(r.result.notMeasured.thrownMessage).toMatch(/no message/);
  });
  it("a thrown null", async () => {
    const r = await runPasted(`export async function f() { throw null; }`, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownType: "null" });
    expect(r.result.notMeasured.thrownName).toMatch(/threw null/);
  });
  it("a thrown object whose name getter throws: that read is not measured, the rest is", async () => {
    const src = `export function f() { throw { get name() { throw new Error("nope"); }, message: "plain message" }; }`;
    const r = await runPasted(src, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownType: "object", thrownMessage: "plain message" });
    expect(r.result.notMeasured.thrownName).toMatch(/reading the thrown value's name threw Error: nope/);
  });
  it("a real Error subclass keeps its name; a stand-in TypeError is a real TypeError", async () => {
    const src = `export function f(g) { try { g(); } catch (e) { if (e instanceof TypeError) throw new RangeError("got " + e.message); } }`;
    const r = await runPasted(src, { exportName: "f", args: [standIn("g", [{ do: "throw", errorName: "TypeError", message: "bad" }], { async: false })] });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownName: "RangeError", thrownMessage: "got bad", "calls:g": 1 });
  });
});

describe("stand-ins", () => {
  it("then: throw_exhausted: the call after the last step throws AtlasStandInExhausted into the code", async () => {
    const src = `export async function f(next) { await next(); await next(); return "two"; }`;
    const r = await runPasted(src, { exportName: "f", args: [standIn("next", [{ do: "return", value: 1 }], { then: "throw_exhausted" })] });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownName: "AtlasStandInExhausted", thrownMessage: "next has no step for call 2 (it has 1)", "calls:next": 2 });
  });
  it("a stand-in called after the call settled is still counted (the code went quiet later)", async () => {
    const src = `export function f(ping) { ping(); setTimeout(() => ping(), 500); setTimeout(() => ping(), 900); return "now"; }`;
    const r = await runPasted(src, { exportName: "f", args: [standIn("ping", [{ do: "return", value: null }], { async: false })] });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 0, "calls:ping": 3 });
    expect(r.trace.filter((t) => t.event === "stand_in_call" && t.data?.afterSettle === true)).toHaveLength(2);
  });
  it("a stand-in still being called by a timer at the watch limit: the final count is not claimed", async () => {
    const src = `export function f(ping) { setInterval(() => ping(), 100); return "now"; }`;
    const r = await runPasted(src, { exportName: "f", watchLimitMs: 1000, args: [standIn("ping", [{ do: "return", value: null }], { async: false })] });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 0, returnedJson: '"now"' });
    expect(r.result.measured["calls:ping"]).toBeUndefined();
    expect(r.result.notMeasured["calls:ping"]).toMatch(/final count was not seen; the count so far was 10/);
  });
  it("a stand-in that never answers: never_settled, with the count", async () => {
    const r = await runPasted(`export async function f(rpc) { return await rpc(); }`, { exportName: "f", args: [standIn("rpc", [{ do: "never_settle" }])] });
    expect(r.result.measured).toMatchObject({ outcome: "never_settled", "calls:rpc": 1 });
    expect(r.result.notMeasured.virtualMs).toMatch(/never settled/);
  });
});

describe("time", () => {
  it("never settles: an empty promise", async () => {
    const r = await runPasted(`export async function f() { await new Promise(() => {}); }`, { exportName: "f" });
    expect(r.result.measured.outcome).toBe("never_settled");
  });
  it("setTimeout far beyond the watch limit: still running at the watch limit, nothing else claimed", async () => {
    const r = await runPasted(`export async function f() { await new Promise((r) => setTimeout(r, 10 * 60 * 1000)); return 1; }`, { exportName: "f", watchLimitMs: 30_000 });
    expect(r.result.measured).toEqual({ outcome: "still_running_at_watch_limit" });
    expect(r.result.notMeasured.virtualMs).toMatch(/watch limit \(30000 ms of virtual time/);
  });
  it("a delay past Node's 2^31-1 ms limit fires after 1 ms, as in Node itself", async () => {
    const r = await runPasted(`export async function f() { await new Promise((r) => setTimeout(r, 1e12)); return 1; }`, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 1 });
  });
  it("Date.now and performance.now follow the virtual clock (a 5 s deadline loop ends at 5 s)", async () => {
    const src = `export async function f() { const start = Date.now(); let n = 0; while (Date.now() - start < 5000) { await new Promise((r) => setTimeout(r, 1000)); n++; } return { n, iso: new Date().toISOString() }; }`;
    const r = await runPasted(src, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 5000, returnedJson: '{"iso":"2026-01-01T00:00:05.000Z","n":5}' });
  });
  it("a timer started while the file loads: whole run can't check", async () => {
    const r = await runPasted(`setInterval(() => {}, 1000);\nexport function f() { return 1; }`, { exportName: "f" });
    expectWholeRun(r, /starts a timer while it is being loaded/);
  });
  it("an infinite synchronous loop hits the real wall-clock limit: whole run can't check, the test does not hang", async () => {
    const t0 = Date.now();
    const r = await runPasted(`export function f() { for (;;) {} }`, { exportName: "f" }, { wallClockMs: 1500 });
    expect(Date.now() - t0).toBeLessThan(8000);
    expectWholeRun(r, /ran past Atlas's 1500 ms limit of REAL time/);
  });
  it("background work (crypto.subtle.digest) is waited for when nothing else is left: it settles, not 'never settles'", async () => {
    const r = await runPasted(`export async function f() { const d = await crypto.subtle.digest("SHA-256", new Uint8Array(1e6)); return d.byteLength; }`, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "32", virtualMs: 0 });
  });
  it("background work racing a virtual timer: which comes first would be a guess, so the outcome is can't check", async () => {
    const src = `export async function f() { return Promise.race([crypto.subtle.digest("SHA-256", new Uint8Array(1e6)).then(() => "hash"), new Promise((r) => setTimeout(() => r("timer"), 1))]); }`;
    const r = await runPasted(src, { exportName: "f" });
    expect(r.result.measured.outcome).toBeUndefined();
    expect(r.result.notMeasured.outcome).toMatch(/background work \(HASHREQUEST\) while a timer was also waiting, so which finished first depends on real speed/);
    // Deterministic: the same race is can't check every time, never "hash" one run and "timer" the next.
    const again = await runPasted(src, { exportName: "f" });
    expect(again.result.notMeasured.outcome).toBe(r.result.notMeasured.outcome);
  });
  it("background work THEN a timer (in sequence, no race) is measured", async () => {
    const src = `export async function f() { const d = await crypto.subtle.digest("SHA-256", new Uint8Array(64)); await new Promise((r) => setTimeout(r, 100)); return d.byteLength; }`;
    const r = await runPasted(src, { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "32", virtualMs: 100 });
  });
  it("Atomics.waitAsync and WebAssembly's background compile finish on real time: whole run can't check", async () => {
    expectWholeRun(await runPasted(`export async function f() { return Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50).value; }`, { exportName: "f" }), /Atomics\.waitAsync/);
    expectWholeRun(await runPasted(`export async function f() { return WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); }`, { exportName: "f" }), /WebAssembly\.compile/);
  });
  it("a zero-delay timer loop that never ends: the step limit stops it, the outcome is not claimed", async () => {
    const src = `export async function f() { for (;;) await new Promise((r) => setTimeout(r, 0)); }`;
    const r = await runPasted(src, { exportName: "f", watchLimitMs: 600_000 }, { wallClockMs: 20_000 });
    expect(r.result.measured.outcome).toBeUndefined();
    expect(r.result.notMeasured.outcome).toMatch(/step limit/);
  }, 30_000);
});

describe("the code reaches outside the sandbox: whole run can't check, never outcome: threw", () => {
  const cases: [string, string, RegExp][] = [
    ["fetch", `export async function f() { try { await fetch("http://127.0.0.1:8787/health"); } catch {} return "caught"; }`, /network\/files \(fetch\)/],
    ["fs via process.getBuiltinModule", `export function f() { try { return process.getBuiltinModule("fs").readFileSync("/etc/hosts", "utf8"); } catch { return "caught"; } }`, /needs Node's built-in module fs/],
    ["a file read the sandbox refuses (ERR_ACCESS_DENIED), caught by the code", `export function f() { try { process.loadEnvFile("/etc/hosts"); } catch (e) { return e.code; } }`, /network\/files \(process\.loadEnvFile\)/],
    ["process.report (a file write)", `export function f() { try { process.report.writeReport("r.json"); } catch {} return 1; }`, /process\.report\.writeReport/],
    ["process.exit", `export function f() { process.exit(0); }`, /end or control the process \(process\.exit\)/],
    ["process.binding", `export function f() { try { process.binding("fs"); } catch {} return 1; }`, /Node's internals \(process\.binding\)/],
    ["eval", `export function f() { try { return eval("1 + 1"); } catch { return 2; } }`, /code made from text \(eval\)/],
    ["new Function", `export function f() { return new Function("return 1")(); }`, /code made from text \(new Function\)/],
    ["the async function constructor", `export async function f() { const AF = (async () => {}).constructor; return AF("return 1")(); }`, /code made from text \(new Function\)/],
    ["Atomics.wait", `export function f() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); return 1; }`, /Atomics\.wait/],
    ["require at run time", `export function f() { return typeof require === "function" && require("left-pad"); }`, /needs left-pad/],
  ];
  for (const [what, src, re] of cases) {
    it(what, async () => {
      expectWholeRun(await runPasted(src, { exportName: "f" }), re);
    });
  }
  it("an uncaught rejection from work the code started is whole-run can't check", async () => {
    const src = `export async function f(rpc) { rpc(); await new Promise((r) => setTimeout(r, 10)); return 1; }`;
    expectWholeRun(await runPasted(src, { exportName: "f", args: [standIn("rpc", [{ do: "throw", errorName: "TimeoutError", message: "x" }])] }), /nobody catching it/);
  });
  it("a timer callback that throws is whole-run can't check", async () => {
    expectWholeRun(await runPasted(`export function f() { setTimeout(() => { throw new Error("late"); }, 5); return 1; }`, { exportName: "f" }), /a timer callback threw Error: late/);
  });
});

describe("imports are refused twice: by the scan before running, and by the module hook while running", () => {
  it("the scan refuses an import before any sandbox starts", async () => {
    const r = await runPasted(`import _ from "lodash";\nexport function f() { return 1; }`, { exportName: "f" });
    expectWholeRun(r, /needs lodash/);
    expect(r.trace[0]!.event).toBe("refused_before_running");
  });
  it("the module hook refuses a static import even when the scan is skipped", async () => {
    const res = await runInSandbox(localExecutor, `import _ from "lodash";\nexport function f() { return 1; }`, "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 10_000);
    expect(res).toMatchObject({ ok: false, kind: "wholeRun" });
    if (!res.ok) expect(res.reason).toMatch(/needs lodash/);
  });
  it("the module hook refuses a dynamic import of a built-in, even one the code catches", async () => {
    const code = `export async function f() { try { await import("node:fs"); } catch {} return "caught"; }`;
    const res = await runInSandbox(localExecutor, code, "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 10_000);
    expect(res).toMatchObject({ ok: false, kind: "wholeRun" });
    if (!res.ok) expect(res.reason).toMatch(/needs Node's built-in module fs/);
  });
  it("require() at run time is refused by the sandbox guard even when the scan is skipped", async () => {
    const code = `export function f() { try { return require("left-pad"); } catch { return "caught"; } }`;
    const res = await runInSandbox(localExecutor, code, "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 10_000);
    expect(res).toMatchObject({ ok: false, kind: "wholeRun" });
    if (!res.ok) expect(res.reason).toMatch(/needs left-pad/);
  });
  it("the module hook refuses importing Atlas's own harness files from the sandbox folder", async () => {
    const code = `export async function f() { try { await import("./call-harness.ts"); } catch {} return 1; }`;
    const res = await runInSandbox(localExecutor, code, "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 10_000);
    expect(res).toMatchObject({ ok: false, kind: "wholeRun" });
  });
});

describe("built-ins changed by the code: whole run can't check (B1 reason)", () => {
  const cases: [string, string][] = [
    ["Promise", `Promise.prototype.then = function () { return this; };\nexport function f() { return 1; }`],
    ["JSON", `export function f() { JSON.stringify = () => "{}"; return 1; }`],
    ["Object.prototype", `export function f() { Object.defineProperty(Object.prototype, "outcome", { set() {}, configurable: true }); return 1; }`],
    ["globalThis.setTimeout", `export function f() { globalThis.setTimeout = (cb) => cb(); return 1; }`],
  ];
  for (const [what, src] of cases) {
    it(what, async () => {
      expectWholeRun(await runPasted(src, { exportName: "f" }), new RegExp(BUILTINS_CHANGED_REASON.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")));
    });
  }
});

describe("the export", () => {
  it("missing: whole run can't check", async () => {
    const exp = experiment("export function g() {}", { exportName: "f" });
    expectWholeRun(await runCallExperiment(exp, control), /no export named "f"/);
  });
  it("not a function: whole run can't check", async () => {
    expectWholeRun(await runPasted("export const f = 42;", { exportName: "f" }), /"f" is exported but is not a function \(it is a number\)/);
  });
  it("CommonJS: refused with a plain sentence", async () => {
    expectWholeRun(await runPasted("function f() {}\nmodule.exports = { f };\nexport {};", { exportName: "f" }), /CommonJS exports/);
  });
  it("the code throws while it loads: whole run can't check, not outcome threw", async () => {
    expectWholeRun(await runPasted(`throw new Error("at load");\nexport function f() {}`, { exportName: "f" }), /threw while it was being loaded: Error: at load/);
  });
});

describe("a broken measurement path fails the control loudly, and then every verdict is can't check", () => {
  /** An executor that runs the real sandbox with ONE harness line changed: the virtual clock is off by 1 ms per timer. */
  const brokenClock: Executor = {
    kind: "local",
    exec(req) {
      const h = req.files["call-harness.ts"];
      if (h === undefined) throw new Error("no harness file to break");
      const broken = h.replace("clock.now = next.at;", "clock.now = next.at + 1;");
      if (broken === h) throw new Error("the line to break was not found: update this test with the harness");
      return localExecutor.exec({ ...req, files: { ...req.files, "call-harness.ts": broken } });
    },
  };
  /** One that loses the stand-in counts. */
  const brokenCounts: Executor = {
    kind: "local",
    exec(req) {
      const h = req.files["call-harness.ts"]!;
      const broken = h.replace("counts.set(name, n);", "counts.set(name, 0);");
      if (broken === h) throw new Error("the line to break was not found: update this test with the harness");
      return localExecutor.exec({ ...req, files: { ...req.files, "call-harness.ts": broken } });
    },
  };

  it("a clock off by 1 ms: the control does not pass and names the case and field", async () => {
    const c = await runCallControl({ executor: brokenClock });
    expect(c.run.controlPassed).toBe(false);
    expect(c.reason).toMatch(/C3-async-stand-in: virtualMs was \d+, the known answer is 1950/);
    expect(c.reason).toMatch(/C8-interval: virtualMs was \d+, the known answer is 1200/);
    expect(c.run.trace.at(-1)!.event).toBe("control_did_not_match");

    // A pasted run measured by the same broken harness: every verdict is can't check, with the control's reason.
    const exp = experiment(`export async function f() { await new Promise((r) => setTimeout(r, 100)); return 1; }`, { exportName: "f" });
    const r = await runCallExperiment(exp, c.run, { executor: brokenClock });
    expect(r.controlPassed).toBe(false);
    expect(r.result.measured.virtualMs).toBe(101); // the broken clock's number: measured, but never trusted
    for (const [measures, answer] of [
      ["virtualMs", { kind: "number", value: 101, tolerancePct: 10, unit: "ms" }],
      ["returnedJson", { kind: "json", value: 1 }],
      ["outcome", { kind: "enum", value: "returned", options: CALL_OPTIONS }],
    ] as [string, BetAnswer][]) {
      const v = judge(sealBet({ who: "human", experimentId: exp.id, question: "q", measures, answer }), r);
      expect(v.outcome).toBe("cant_check");
      expect(v.reason).toMatch(/^the run is not trusted: the known-case check did not match: C3-async-stand-in: virtualMs/);
    }
  });

  it("lost stand-in counts: the control does not pass", async () => {
    const c = await runCallControl({ executor: brokenCounts });
    expect(c.run.controlPassed).toBe(false);
    expect(c.reason).toMatch(/C2-sync-stand-in: calls:get was 0, the known answer is 3/);
  });

  it("a control whose sandbox gives no result does not pass either", async () => {
    const silent: Executor = { kind: "local", exec: async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 }) };
    const c = await runCallControl({ executor: silent });
    expect(c.run.controlPassed).toBe(false);
    expect(c.reason).toMatch(/exited with code 0 and no result/);
  });

  it("the wire format keeps JSON values as text so they arrive as ordinary objects", () => {
    expect(toWire([{ kind: "json", value: { a: [1] } }])).toEqual([{ kind: "json", json: '{"a":[1]}' }]);
  });
});
