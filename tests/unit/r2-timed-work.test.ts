// R2 (D45): code that times its own work.
//
// Plain words: Atlas's clock stands still while code works, so code that measures its own elapsed time reads 0 ms.
// Before R2 that 0 was reported as a fact with a warning line. Now the second run of Atlas's double run lets the
// clock reading move 10 ms each time the code reads it again at the same moment. A value that changes then depends on
// how long the work really took, so it is "can't check" with the reason "Atlas's clock is simulated and can't measure
// real work time". A value that stays the same (a TTL cache, a logger whose timestamps are not returned, a deadline
// loop) stays measured. These tests run the real local sandboxes (JavaScript always, Python when it is installed).

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { CHANGED_BETWEEN_RUNS_REASON, CLOCK_NUDGE_MS, TIMED_WORK_REASON, callRunPinProblems, mergeTwin } from "../../src/conditions.ts";
import { CONDITION_WORDS, TIMED_WORK_SAYS_R1 } from "../../src/paste-words.ts";
import { runCallControl, runCallExperiment, runInSandbox } from "../../runners/ts/call-runner.ts";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { findPython, pythonRefusal } from "../../runners/executor/sandbox-exec-python.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types.ts";

const HAVE_PYTHON = pythonRefusal() === null && findPython() !== null;

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
function experiment(source: string, language: "js" | "py", exportName: string, args: ArgSpec[] = []): Experiment {
  const target = makePastedTarget(source, language);
  const params: Call = { shape: "call-function", exportName, args };
  const g = gate(params, { exportNames: exportedFunctionsFor(source, language).map((e) => e.name).concat(exportName) });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: `r2-${exportName}`, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

let jsControl: Run;
let pyControl: Run | null = null;
beforeAll(async () => {
  jsControl = (await runCallControl()).run;
  if (HAVE_PYTHON) pyControl = (await runPyCallControl()).run;
}, 60_000);

async function run(source: string, language: "js" | "py", exportName = "f", args: ArgSpec[] = []): Promise<Run> {
  const exp = experiment(source, language, exportName, args);
  return language === "py" ? runPyCallExperiment(exp, pyControl!) : runCallExperiment(exp, jsControl);
}
const kinds = (r: Run) => (r.conditions ?? []).map((c) => c.kind);
const events = (r: Run, name: string) => r.trace.filter((t) => t.event === name);
const standIn = (name: string, calls: Extract<ArgSpec, { kind: "stand-in" }>["calls"], async = false): ArgSpec => ({ kind: "stand-in", name, async, then: "repeat_last", calls });

describe("D45, JavaScript: a value computed from the code's own timing is can't check", () => {
  it("an elapsed time it returns: the value is can't check, the outcome and type stay measured", async () => {
    const r = await run("export function f(){ const t = performance.now(); let x = 0; for (let i = 0; i < 1e5; i++) x = (x + i) % 7; return Math.round(performance.now() - t); }", "js");
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedType: "number", virtualMs: 0 });
    expect(r.result.measured.returnedJson).toBeUndefined();
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    expect(kinds(r)).toEqual(["clock", "timed-work", "work-time"]);
    expect(events(r, "clock_differs")).toEqual([{ t: 0, event: "clock_differs", data: { fields: ["returnedJson"] } }]);
    expect(events(r, "twin_differs")).toEqual([]);
    // The first run is Atlas's ordinary run (0 ms); only the second run's reading moved.
    expect(r.twin?.result.measured.returnedJson).toBe(String(CLOCK_NUDGE_MS));
    expect(callRunPinProblems(r, "js")).toEqual([]);
  });
  it("an outcome that branches on the elapsed time: how the call ended is can't check", async () => {
    const r = await run('export function f(){ const t = Date.now(); let x = 0; for (let i = 0; i < 1e5; i++) x += i; if (Date.now() - t > 0) throw new Error("slow"); return x; }', "js");
    for (const k of ["outcome", "virtualMs", "returnedJson", "returnedType"]) {
      expect(r.result.measured[k], k).toBeUndefined();
      expect(r.result.notMeasured[k], k).toBe(TIMED_WORK_REASON);
    }
    expect(events(r, "stopped_watching").at(-1)?.data).toEqual({ reason: TIMED_WORK_REASON });
    // virtualMs was the same in both runs (0) but goes with the outcome; verify must accept that (it did not, before R2).
    expect(r.twin?.result.measured.virtualMs).toBe(0);
    expect(callRunPinProblems(r, "js")).toEqual([]);
  });
  it('"took more than 1 ms" (bench T2 h01a\'s check) flips with the 10 ms move, so it is can\'t check', async () => {
    const r = await run("export function f(){ const p0 = performance.now(); let x = 0; for (let i = 0; i < 1e5; i++) x = (x + i) % 7; return performance.now() - p0 > 1; }", "js");
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it("process.hrtime, Date.now() and `new Date() - start` differences are all caught (R2 review B3: the calendar step is a whole 1 ms)", async () => {
    const a = await run("export function f(){ const t = process.hrtime(); for (let i = 0; i < 1e5; i++); const d = process.hrtime(t); return d[0] * 1e3 + d[1] / 1e6; }", "js");
    expect(a.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    const b = await run("export function f(){ const t = Date.now(); for (let i = 0; i < 1e5; i++); return Date.now() - t; }", "js");
    expect(b.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    const c = await run("export function f(){ const a = new Date(); for (let i = 0; i < 1e5; i++); return new Date() - a; }", "js");
    expect(c.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it('a check against a longer time ("took over a second") is not caught: reported as fast work gives it (known gap)', async () => {
    const r = await run('export function f(){ const t = performance.now(); for (let i = 0; i < 1e5; i++); return performance.now() - t > 1000 ? "slow" : "fast"; }', "js");
    expect(r.result.measured.returnedJson).toBe('"fast"');
    expect(kinds(r)).toEqual(["clock", "timed-work"]);
  });
});

describe("D45, JavaScript: ordinary code that stamps times but computes no duration stays measured", () => {
  it("a TTL cache (100 ms) that stamps and checks at once, then waits past it", async () => {
    const r = await run(
      "class Cache { constructor(){ this.m = new Map() } set(k,v,ttl){ this.m.set(k,{v,exp:Date.now()+ttl}) } get(k){ const e=this.m.get(k); if(!e) return undefined; if (e.exp<=Date.now()){ this.m.delete(k); return undefined } return e.v } }\nconst sleep=(ms)=>new Promise(r=>setTimeout(r,ms));\nexport async function f(){ const c=new Cache(); c.set(\"a\",1,100); const a=c.get(\"a\"); await sleep(150); return [a, c.get(\"a\") ?? null] }",
      "js",
    );
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "[1,null]", virtualMs: 150 });
    expect(kinds(r)).toEqual(["clock", "timed-work"]);
  });
  it("a logger around work whose timestamps are not returned", async () => {
    const r = await run('function log(m){ return "[" + new Date().toISOString() + "] " + m }\nexport function f(){ const lines=[log("start")]; let s = 0; for (let i = 0; i < 1e5; i++) s += i % 3; lines.push(log("done")); return { s, lines: lines.length } }', "js");
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '{"lines":2,"s":99999}' });
    expect(kinds(r)).toEqual(["clock", "timed-work"]);
  });
  it("a retry loop with a 1 s deadline: the waits and the call count stay measured", async () => {
    const r = await run(
      "const sleep = (ms) => new Promise(r => setTimeout(r, ms));\nexport async function f(call){ const deadline = Date.now() + 1000; for (;;) { try { return await call() } catch (e) { const left = deadline - Date.now(); if (left <= 0) throw e; await sleep(Math.min(200, left)) } } }",
      "js",
      "f",
      [standIn("call", [{ do: "throw", errorName: "Error", message: "boom" }, { do: "throw", errorName: "Error", message: "boom" }, { do: "return", value: "ok" }], true)],
    );
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"ok"', virtualMs: 400, "calls:call": 3 });
  });
  it("a 5 s deadline loop on Date.now that returns an ISO time stamp at the end: the stamp is can't check (accepted, R2 review B3), the call time and outcome stay measured", async () => {
    const r = await run("export async function f() { const start = Date.now(); let n = 0; while (Date.now() - start < 5000) { await new Promise((r) => setTimeout(r, 1000)); n++; } return { n, iso: new Date().toISOString() }; }", "js");
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 5000 });
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it("createdAt / updatedAt as ISO text from two new Date() at one moment: can't check (accepted: the gap between them is the work time)", async () => {
    const r = await run("export function f(){ return { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; }", "js");
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it("R2 review M1: code that waits until a deadline it read keeps its call time, outcome and value", async () => {
    const a = await run("const sleep = (ms) => new Promise(r => setTimeout(r, ms)); export async function f(){ const deadline = Date.now() + 1000; let s = 0; for (let i = 0; i < 1e4; i++) s += i; await sleep(Math.max(0, deadline - Date.now())); return s; }", "js");
    expect(a.result.measured).toMatchObject({ outcome: "returned", virtualMs: 1000, returnedJson: "49995000" });
    expect(a.twin?.result.measured.virtualMs).toBe(999); // the second run's timers did not move; compared with its 1 ms added back
    expect(callRunPinProblems(a, "js")).toEqual([]);
    const b = await run("const sleep = (ms) => new Promise(r => setTimeout(r, ms)); export async function f(){ const t0 = performance.now(); const v = [3,1,2].sort(); const left = 300 - (performance.now() - t0); if (left > 0) await sleep(left); return v; }", "js");
    expect(b.result.measured).toMatchObject({ outcome: "returned", virtualMs: 300, returnedJson: "[1,2,3]" });
    expect(callRunPinProblems(b, "js")).toEqual([]);
  });
  it("R2 review M1 (minimum): a call time that moved does not take an unchanged value or outcome with it", async () => {
    const r = await run("const sleep = (ms) => new Promise(r => setTimeout(r, ms)); export async function f(){ const t = Date.now(); for (let i = 0; i < 1e4; i++); await sleep(Date.now() - t + 50); return 7; }", "js");
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "7" });
    expect(r.result.notMeasured.virtualMs).toBe(TIMED_WORK_REASON);
    expect(callRunPinProblems(r, "js")).toEqual([]);
  });
  it("R2 review M2: Date.now() stays a whole number in the second run (a snowflake id does not throw)", async () => {
    const r = await run("export function f(){ const a = BigInt(Date.now()) << 12n; const b = (BigInt(Date.now()) << 12n) | 1n; return [String(a), String(b), Number.isInteger(Date.now())]; }", "js");
    expect(r.result.measured.outcome).toBe("returned");
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    expect(JSON.parse(r.twin!.result.measured.returnedJson as string)[2]).toBe(true);
  });
  it("two raw Date.now() numbers at one moment: can't check (the over-refusal this rule accepts)", async () => {
    const r = await run("export function f(){ return [Date.now(), Date.now()]; }", "js");
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it("one clock read per moment never moves: no timed-work, the second run is the same run", async () => {
    const r = await run("export async function f(){ const a = Date.now(); await new Promise(r => setTimeout(r, 30)); return Date.now() - a; }", "js");
    expect(r.result.measured).toMatchObject({ returnedJson: "30", virtualMs: 30 });
    expect(kinds(r)).toEqual(["clock"]);
    expect(r.twin?.result.measured.returnedJson).toBe("30");
  });
});

describe.skipIf(!HAVE_PYTHON)("D45, Python", () => {
  it("perf_counter around a loop: the elapsed time is can't check", async () => {
    const r = await run("import time\n\ndef f():\n    t = time.perf_counter()\n    x = sum(range(100000))\n    return time.perf_counter() - t\n", "py");
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedType: "number" });
    expect(r.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    expect(kinds(r)).toEqual(["clock", "timed-work", "work-time"]);
    expect(callRunPinProblems(r, "py")).toEqual([]);
  });
  it("time.time, datetime.now() and time_ns rounded to whole ms: all caught (R2 review B3: Python's calendar step is 10 ms)", async () => {
    const a = await run("import time\n\ndef f():\n    t = time.time()\n    s = sum(range(100000))\n    return time.time() - t\n", "py");
    expect(a.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    const b = await run("from datetime import datetime, timezone\n\ndef f():\n    a = datetime.now(timezone.utc)\n    s = sum(range(100000))\n    return (datetime.now(timezone.utc) - a).total_seconds()\n", "py");
    expect(b.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    const c = await run("import time\n\ndef f():\n    t = time.time_ns()\n    s = sum(range(100000))\n    return (time.time_ns() - t) // 1_000_000\n", "py");
    expect(c.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
    const d = await run("import time\n\ndef f():\n    t = time.time()\n    s = sum(range(100000))\n    return int((time.time() - t) * 1000)\n", "py");
    expect(d.result.notMeasured.returnedJson).toBe(TIMED_WORK_REASON);
  });
  it("raising when slow: how the call ended is can't check", async () => {
    const r = await run('import time\n\ndef f():\n    t = time.monotonic()\n    s = sum(range(100000))\n    if time.monotonic() - t > 0:\n        raise TimeoutError("slow")\n    return s\n', "py");
    expect(r.result.measured.outcome).toBeUndefined();
    expect(r.result.notMeasured.outcome).toBe(TIMED_WORK_REASON);
  });
  it("a TTL cache (0.1 s) on monotonic, and logging around work: measured", async () => {
    const a = await run("import time\n\nclass TTL:\n    def __init__(self, ttl):\n        self.ttl = ttl\n        self.d = {}\n    def set(self, k, v):\n        self.d[k] = (v, time.monotonic() + self.ttl)\n    def get(self, k):\n        v = self.d.get(k)\n        if v is None or v[1] <= time.monotonic():\n            return None\n        return v[0]\n\ndef f():\n    c = TTL(0.1)\n    c.set(\"a\", 1)\n    a = c.get(\"a\")\n    time.sleep(0.15)\n    return [a, c.get(\"a\")]\n", "py");
    expect(a.result.measured).toMatchObject({ outcome: "returned", returnedJson: "[1,null]", virtualMs: 150 });
    expect(kinds(a)).toEqual(["clock", "timed-work"]);
    const b = await run('import logging\nlogging.basicConfig(level=logging.INFO)\nlog = logging.getLogger("x")\n\ndef f():\n    log.info("start")\n    t = sum(i % 7 for i in range(100000))\n    log.info("done")\n    return t\n', "py");
    expect(b.result.measured).toMatchObject({ outcome: "returned", returnedJson: "299995" });
    expect(kinds(b)).not.toContain("work-time");
  });
  it("code that changes the nudge is caught (whole run can't check)", async () => {
    const r = await run("import sys, time\n\ndef f():\n    m = [v for k, v in sys.modules.items() if k == 'atlas_exposed']\n    for g in [getattr(time.time, '__globals__', {})]:\n        n = g.get('NUDGE')\n        if n is not None:\n            n[0] = 0.0\n    t = time.time()\n    return time.time() - t\n", "py");
    // Either Atlas refuses reaching its globals, or it sees the nudge changed: never a measured 0.
    expect(r.result.measured.returnedJson).toBeUndefined();
  });
});

describe("D45, verify: the second run's clock move is checked against the trace", () => {
  async function file(src: string) {
    const exp = experiment(src, "js", "f");
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: 0 } });
    await new Promise((r) => setTimeout(r, 5));
    const r = await runCallExperiment(exp, jsControl);
    return JSON.parse(JSON.stringify(buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() })));
  }
  it("a timed-work proof file verifies; its bet is can't check with Atlas's reason; edits are caught", async () => {
    const f = await file("export function f(){ const t = Date.now(); for (let i = 0; i < 1e5; i++); return Date.now() - t; }");
    expect(verifyAtlasFile(f).ok).toBe(true);
    expect(f.verdicts[0].outcome).toBe("cant_check");
    expect(f.verdicts[0].reason).toBe(TIMED_WORK_REASON);
    const edits: [string, (x: typeof f) => void, RegExp][] = [
      ["the value put back as a fact", (x) => { delete x.runs[0].result.notMeasured.returnedJson; x.runs[0].result.measured.returnedJson = "0"; x.verdicts[0] = judge(x.bets[0], x.runs[0]); }, /second run measured it differently/],
      ["the reason relabelled as 'changed between runs'", (x) => (x.runs[0].result.notMeasured.returnedJson = CHANGED_BETWEEN_RUNS_REASON), /does not say so|not what src\/judge.ts gives/],
      ["the clock_differs event renamed twin_differs", (x) => { for (const t of x.runs[0].trace) if (t.event === "clock_differs") t.event = "twin_differs"; }, /timed its own work .* another reason|does not say so/],
      ["the twin's timed-work removed", (x) => { for (const t of x.runs[0].twin.trace) if (t.event === "conditions") t.data.kinds = ["clock"]; }, /did not time its own work/],
    ];
    for (const [what, edit, re] of edits) {
      const x = JSON.parse(JSON.stringify(f));
      edit(x);
      const v = verifyAtlasFile(x);
      expect(v.ok, what).toBe(false);
      if (!v.ok) expect(v.problems.join("; "), what).toMatch(re);
    }
  });
  it("a run made before R2 (R1's timed-work sentence, no clock move) still verifies", async () => {
    const f = await file("export function f(){ const t = Date.now(); const u = Date.now(); return 1; }");
    expect(verifyAtlasFile(f).ok).toBe(true);
    const tw = f.runs[0].conditions.find((c: { kind: string }) => c.kind === "timed-work");
    expect(tw.says).toBe(CONDITION_WORDS.timedWork);
    tw.says = TIMED_WORK_SAYS_R1;
    expect(verifyAtlasFile(f).ok).toBe(true);
    tw.says = "nothing to see";
    expect(verifyAtlasFile(f).ok).toBe(false);
  });
});

describe("D45, the pieces", () => {
  it("mergeTwin uses the reason it is given", () => {
    const m = mergeTwin({ measured: { a: 1, b: 2 }, notMeasured: {} }, { measured: { a: 1, b: 3 }, notMeasured: {} }, TIMED_WORK_REASON);
    expect(m.result).toEqual({ measured: { a: 1 }, notMeasured: { b: TIMED_WORK_REASON } });
  });
  it("the words name the same move as the code (CLOCK_NUDGE_MS) and Dami's sentence", () => {
    expect(CLOCK_NUDGE_MS).toBe(10);
    expect(TIMED_WORK_REASON).toMatch(/^Atlas's clock is simulated and can't measure real work time: /);
    expect(CONDITION_WORDS.timedWork).toContain(`${CLOCK_NUDGE_MS} ms more at each repeated read of a stopwatch clock`);
    expect(CONDITION_WORDS.timedWork).toContain("1 ms more (JavaScript) or 10 ms more (Python) at each repeated read of the calendar clock");
    expect(CONDITION_WORDS.workTime("returnedJson")).toMatch(/Atlas's clock is simulated and can't measure real work time/);
    expect(CONDITION_WORDS.timedWork).not.toMatch(/don't reflect your machine/);
  });
  it("the worker refuses a clock move Atlas does not use", async () => {
    const res = await runInSandbox(localExecutor, "export const f = () => 1;", "js", { runs: [], nudgeClockMs: 3 }, 10_000);
    expect(res.ok).toBe(false);
  });
});

describe("R1's verify gap, found in R2: a run whose outcome changed between its two runs", () => {
  it("every ending field goes with the outcome, named or not, and verify accepts it (both reasons)", async () => {
    const { twinProblems } = await import("../../src/conditions.ts");
    for (const [reason, event] of [[CHANGED_BETWEEN_RUNS_REASON, "twin_differs"], [TIMED_WORK_REASON, "clock_differs"]] as const) {
      const first = { measured: { outcome: "returned", virtualMs: 0, returnedJson: "1", returnedType: "number" }, notMeasured: {} };
      const second = { measured: { outcome: "threw", virtualMs: 0, thrownName: "Error", thrownMessage: "slow" }, notMeasured: {} };
      const m = mergeTwin(first, second, reason);
      expect(m.result.notMeasured.virtualMs).toBe(reason);
      const kindsTwin = event === "clock_differs" ? ["clock", "timed-work"] : ["clock"];
      const r = { trace: [{ event: "conditions", data: { kinds: kindsTwin } }, { event, data: { fields: m.changed } }], result: m.result, twin: { trace: [{ event: "conditions", data: { kinds: kindsTwin } }], result: second } };
      expect(twinProblems(r), event).toEqual([]);
    }
  });
});
