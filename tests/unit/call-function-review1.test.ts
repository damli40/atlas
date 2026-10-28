// E1 review round 1: the reviewer's attacks as regression tests, plus variants, plus the sweep of every API
// that can wake a promise without going through Atlas's clock. Each test runs in the real sandbox.
//
// B1: pasted code wrote Atlas's result line itself (it read the secret marker from process.report and exited
//     with process.reallyExit). Now the result is authenticated with a per-run key sent on stdin only.
// B2: AbortSignal.timeout ran on Node's internal timer, so a call waiting on it was reported "never settled"
//     and a race against setTimeout returned the wrong winner. Now it runs on the virtual clock.

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code.ts";
import { parseCallWorkerOutput, resultMac, runCallControl, runCallExperiment, runInSandbox } from "../../runners/ts/call-runner.ts";
import { runControl } from "../../runners/ts/control.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import type { Executor } from "../../runners/runner.ts";
import type { Experiment, ExperimentShape, Run } from "../../src/types.ts";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
let control: Run;
beforeAll(async () => {
  control = (await runCallControl()).run;
});

function experiment(source: string, params: Partial<Call> & { exportName: string }): Experiment {
  const target = makePastedTarget(source, "js");
  const g = gate({ shape: "call-function", args: [], ...params }, { exportNames: exportedFunctions(source).map((e) => e.name) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
const runPasted = (source: string, params: Partial<Call> & { exportName: string } = { exportName: "f" }, executor?: Executor) =>
  runCallExperiment(experiment(source, params), control, executor ? { executor } : {});

/** Whole run can't check, and a bet on the forged value is can't check too. */
function expectNotTrusted(r: Run, re: RegExp): void {
  expect(r.result.measured).toEqual({});
  expect(r.result.notMeasured.wholeRun).toMatch(re);
  const v = judge(sealBet({ who: "human", experimentId: r.experimentId, question: "q", measures: "returnedJson", answer: { kind: "json", value: 42 } }), r);
  expect(v.outcome).toBe("cant_check");
}

describe("B1: the result channel cannot be forged by the code under test", () => {
  const FAKE = `{ runs: [{ id: "exp1", trace: [], result: { measured: { outcome: "returned", virtualMs: 0, returnedType: "number", returnedJson: "42" }, notMeasured: {} } }] }`;

  it("the reviewer's attack: read the marker from process.report, write a result, reallyExit", async () => {
    const forge = `export function f(){
  const m = process.report.getReport().header.commandLine.at(-1);
  process.stdout.write("\\nATLAS_RESULT " + m + " " + JSON.stringify(${FAKE}) + "\\n", () => process.reallyExit(0));
  return new Promise(() => {});
}`;
    expectNotTrusted(await runPasted(forge), /process\.report/);
  });

  it("variant: no report, a forged line with a guessed key, then the call never settles (the real line follows)", async () => {
    const src = `export function f(){
  process.stdout.write("\\nATLAS_RESULT " + "a".repeat(64) + " " + JSON.stringify(${FAKE}) + "\\n");
  return new Promise(() => {});
}`;
    expectNotTrusted(await runPasted(src), /tampering: 2 result lines|does not carry this run's key/);
  });

  it("variant: a forged line through console.log, then the process is ended through process.reallyExit", async () => {
    const src = `export function f(){ console.log("ATLAS_RESULT " + "0".repeat(64) + " " + JSON.stringify(${FAKE})); process.reallyExit(0); }`;
    expectNotTrusted(await runPasted(src), /process\.reallyExit|tampering/);
  });

  it("variant: a forged line, then an endless loop so the worker never writes (Atlas's real-time limit, not the forged line)", async () => {
    const src = `export function f(){ process._rawDebug("x"); process.stdout.write("\\nATLAS_RESULT " + "b".repeat(64) + " {\\"runs\\":[]}\\n"); for(;;){} }`;
    const r = await runCallExperiment(experiment(src, { exportName: "f" }), control, { wallClockMs: 1500 });
    expectNotTrusted(r, /ran past Atlas's 1500 ms limit/);
  });

  it("variant: reading stdin for the key is refused, and the key is nowhere the code can look", async () => {
    let key = "";
    const spy: Executor = {
      kind: "local",
      exec(req) {
        key = (req.stdin ?? "").trim();
        expect(req.cmd.join(" ")).not.toContain(key);
        expect(Object.values(req.files).join("\n")).not.toContain(key);
        return localExecutor.exec(req);
      },
    };
    const looks = `export function f(){ return JSON.stringify([process.argv, process.execArgv, process.env, process.title, process.argv0]); }`;
    const r = await runPasted(looks, { exportName: "f" }, spy);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.result.measured.outcome).toBe("returned");
    // R1 review round 1: argv names the run's temp folder, so the two identical runs differ and the value is not
    // reported; the key is in neither run.
    expect(r.result.notMeasured.returnedJson).toMatch(/changed between two identical runs/);
    expect(JSON.stringify(r)).not.toContain(key);
    expectNotTrusted(await runPasted(`export function f(){ return process.stdin.read(); }`), /process\.stdin/);
  });

  it("the parent accepts only a line whose HMAC verifies, with the requested run ids", () => {
    const key = "1".repeat(64);
    const body = JSON.stringify({ runs: [{ id: "a", trace: [], result: { measured: {}, notMeasured: {} } }] });
    const good = `\nATLAS_RESULT ${resultMac(key, body)} ${body}\n`;
    expect(parseCallWorkerOutput(good, key, ["a"]).ok).toBe(true);
    expect(parseCallWorkerOutput(good, "2".repeat(64), ["a"])).toMatchObject({ ok: false, kind: "tampered" });
    expect(parseCallWorkerOutput(good, key, ["b"])).toMatchObject({ ok: false, kind: "tampered" });
    expect(parseCallWorkerOutput(good.replace('"a"', '"A"'), key)).toMatchObject({ ok: false, kind: "tampered" }); // body edited after signing
    expect(parseCallWorkerOutput(`ATLAS_RESULT forged\n${good}`, key, ["a"])).toMatchObject({ ok: false, kind: "tampered" });
    expect(parseCallWorkerOutput("", key)).toMatchObject({ ok: false, kind: "noResult" });
  });
});

describe("B2: AbortSignal.timeout runs on the virtual clock", () => {
  it("the reviewer's input 1: a call woken by AbortSignal.timeout(20) returns at 20 virtual ms when something keeps the process alive (was: never settled)", async () => {
    // R1 (B1 review MINOR 3): AbortSignal.timeout's timer is unref'd, as in Node. Kept alive by a ref'd timer, it wakes at 20 ms.
    const r = await runPasted(`export async function f(){ const keep = setTimeout(() => {}, 1000); await new Promise(r => AbortSignal.timeout(20).addEventListener('abort', r)); clearTimeout(keep); return 'woke'; }`);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"woke"', virtualMs: 20 });
  });
  it("R1: AbortSignal.timeout alone (nothing keeps the process alive): how the call ends is can't check, with the unref reason", async () => {
    const r = await runPasted(`export async function f(){ await new Promise(r => AbortSignal.timeout(20).addEventListener('abort', r)); return 'woke'; }`);
    expect(r.result.measured.outcome).toBeUndefined();
    expect(r.result.notMeasured.outcome).toMatch(/unref'd timer/);
    expect(r.conditions?.map((c) => c.kind)).toContain("unref-timer");
  });
  it("the reviewer's input 2: the race with setTimeout(1000) is won by the abort at 5 ms, as in real Node", async () => {
    const r = await runPasted(`export async function f(){ return await Promise.race([new Promise(r=>AbortSignal.timeout(5).addEventListener('abort',()=>r('abort'))), new Promise(r=>setTimeout(()=>r('timer'),1000))]); }`);
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '"abort"', virtualMs: 5 });
  });
  it("the abort reason is Node's TimeoutError; AbortSignal.any follows it; bad delays throw as in Node", async () => {
    const r = await runPasted(`export async function f(){ const keep = setTimeout(() => {}, 1000); const s = AbortSignal.any([AbortSignal.timeout(30)]); await new Promise(r => s.addEventListener('abort', r)); clearTimeout(keep); let bad = "no throw"; try { AbortSignal.timeout(-1); } catch (e) { bad = e.code; } return [s.reason.name, s.reason.message, bad]; }`);
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 30, returnedJson: '["TimeoutError","The operation was aborted due to timeout","ERR_OUT_OF_RANGE"]' });
  });
  it("an AbortSignal.timeout made while the file loads is a load-time timer: whole run can't check", async () => {
    expectNotTrusted(await runPasted(`const s = AbortSignal.timeout(10);\nexport function f(){ return 1; }`), /timer while it is being loaded/);
  });
});

describe("the sweep: every way a promise can wake without Atlas's clock", () => {
  it("console.log and process.stdout.write do not count as outside work (the call and its counts are measured)", async () => {
    const t0 = Date.now();
    const r = await runPasted(`export async function f(ping){ console.log("hi"); process.stdout.write("x\\n"); ping(); await new Promise(r => setTimeout(r, 10)); return 1; }`, {
      exportName: "f",
      args: [{ kind: "stand-in", name: "ping", async: false, then: "repeat_last", calls: [{ do: "return", value: null }] }],
    });
    expect(r.result.measured).toMatchObject({ outcome: "returned", virtualMs: 10, "calls:ping": 1 });
    expect(Date.now() - t0).toBeLessThan(1500); // no 2 s wait for a stream that never "finishes"
  });
  const works: [string, string, string][] = [
    ["queueMicrotask chains (drained before every timer)", `export async function f(){ let n = 0; await new Promise(r => { const step = () => (++n < 100 ? queueMicrotask(step) : r()); queueMicrotask(step); }); return n; }`, "100"],
    // R1: from a timer callback (a nextTick in the call's synchronous part races promise callbacks: can't check, see r1 tests).
    ["process.nextTick", `export async function f(){ await new Promise(r => setTimeout(r, 1)); return await new Promise(r => process.nextTick(() => r("tick"))); }`, '"tick"'],
    ["Blob.text (native read, waited for)", `export async function f(){ return await new Blob(["abc"]).text(); }`, '"abc"'],
    ["ReadableStream (microtasks)", `export async function f(){ const s = new ReadableStream({ start(c){ c.enqueue("a"); c.enqueue("b"); c.close(); } }); let out = ""; for await (const x of s) out += x; return out; }`, '"ab"'],
    ["Response.json (stream over a Blob)", `export async function f(){ return await new Response('{"a":1}').json(); }`, '{"a":1}'],
    ["structuredClone, with an ArrayBuffer transfer (synchronous)", `export function f(){ const b = new ArrayBuffer(8); const c = structuredClone({ b }, { transfer: [b] }); return [b.byteLength, c.b.byteLength]; }`, "[0,8]"],
    ["EventTarget dispatch by the code (synchronous)", `export async function f(){ const t = new EventTarget(); const p = new Promise(r => t.addEventListener("go", () => r("went"))); setTimeout(() => t.dispatchEvent(new Event("go")), 10); return await p; }`, '"went"'],
    ["CompressionStream (zlib job, waited for)", `export async function f(){ const s = new Blob(["x".repeat(1000)]).stream().pipeThrough(new CompressionStream("gzip")); return (await new Response(s).arrayBuffer()).byteLength > 0; }`, "true"],
  ];
  for (const [what, src, json] of works) {
    it(`works: ${what}`, async () => {
      const r = await runPasted(src);
      expect(r.result.measured.outcome, JSON.stringify(r.result.notMeasured)).toBe("returned");
      expect(r.result.measured.returnedJson).toBe(json);
    });
  }

  it("an endless microtask chain never hands control back: Atlas's real-time limit, whole run can't check", async () => {
    const r = await runCallExperiment(experiment(`export async function f(){ const loop = () => queueMicrotask(loop); loop(); await new Promise(() => {}); }`, { exportName: "f" }), control, { wallClockMs: 1500 });
    expectNotTrusted(r, /ran past Atlas's 1500 ms limit/);
  });

  const refused: [string, string, RegExp][] = [
    ["MessageChannel (delivered on real time; an unref'd port is invisible)", `export async function f(){ const { port1, port2 } = new MessageChannel(); port2.unref(); return await new Promise(r => { port2.onmessage = e => r(e.data); port1.postMessage(1); }); }`, /MessageChannel/],
    ["BroadcastChannel", `export function f(){ new BroadcastChannel("x"); return 1; }`, /BroadcastChannel/],
    ["FinalizationRegistry (garbage-collector timing)", `export function f(){ new FinalizationRegistry(() => {}); return 1; }`, /FinalizationRegistry/],
    ["WeakRef (garbage-collector timing)", `export function f(){ return new WeakRef({}).deref() ? 1 : 0; }`, /WeakRef/],
    ["process.on('beforeExit') (fires when the loop runs empty)", `export async function f(){ await new Promise(r => process.once("beforeExit", r)); return 1; }`, /beforeExit/],
    ["process.on('SIGTERM')", `export function f(){ process.on("SIGTERM", () => {}); return 1; }`, /SIGTERM/],
    ["navigator.locks", `export async function f(){ return await navigator.locks.request("a", async () => 1); }`, /navigator\.locks/],
    ["Atomics.waitAsync", `export async function f(){ return Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5).value; }`, /Atomics\.waitAsync/],
  ];
  for (const [what, src, re] of refused) {
    it(`refused as whole-run can't check: ${what}`, async () => {
      expectNotTrusted(await runPasted(src), re);
    });
  }
});

describe("minor: real clocks are faked or refused", () => {
  it("performance.timeOrigin + performance.now() is the virtual time; Intl formats the virtual date", async () => {
    const src = `export async function f(){ await new Promise(r => setTimeout(r, 1500)); const p = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); return [new Date(performance.timeOrigin + performance.now()).toISOString(), p.format(), p.formatToParts().find(x => x.type === "year").value]; }`;
    const r = await runPasted(src);
    expect(r.result.measured.returnedJson).toBe('["2026-01-01T00:00:01.500Z","01/01/2026","2026"]');
  });
  for (const [api, src] of [
    ["process.cpuUsage", "process.cpuUsage()"],
    ["process.resourceUsage", "process.resourceUsage()"],
    ["performance.eventLoopUtilization", "performance.eventLoopUtilization()"],
    ["performance.mark", 'performance.mark("a")'],
    ["performance.nodeTiming", "performance.nodeTiming"],
  ] as const) {
    it(`refused: ${api}`, async () => {
      expectNotTrusted(await runPasted(`export function f(){ ${src}; return 1; }`), new RegExp(api.replace(".", "\\.")));
    });
  }
});

describe("the old retry harness: background work is no longer reported as pending", () => {
  it("a changed withRpcRetry that awaits a hash before calling the RPC: S1 returns (was: pending)", async () => {
    const code = `export async function withRpcRetry(label, fn, opts = {}) { await crypto.subtle.digest("SHA-256", new Uint8Array(1e6)); return fn(); }`;
    const c = await runControl(code);
    expect(c.run.result.measured["S1.outcome"]).toBe("returns");
    expect(c.run.result.measured["S1.calls"]).toBe(1);
  });
  it("a hash racing the code's sleep: how it ends is can't check, not a guess", async () => {
    const code = `export async function withRpcRetry(label, fn, opts = {}) { const sleep = opts.sleep; await Promise.race([crypto.subtle.digest("SHA-256", new Uint8Array(1e6)), sleep(10)]); return fn(); }`;
    const c = await runControl(code);
    expect(c.run.result.measured["S1.outcome"]).toBeUndefined();
    expect(c.run.result.notMeasured["S1.outcome"]).toMatch(/background work \(HASHREQUEST\) while a timer was also waiting/);
  });
});
