// E4 LIVE: the Modal executor on real Modal Sandboxes. Skipped unless ATLAS_LIVE_MODAL=1 (it needs Modal
// credentials on this machine and costs a little: about 20 sandboxes of a few seconds each).
//
//   ATLAS_LIVE_MODAL=1 pnpm vitest run tests/unit/modal-live.test.ts --reporter=verbose
//
// What it checks, in order: the E1 control passes on Modal and the run says so; three ordinary functions give the
// same facts on Modal as on this machine; and the attacks fail: the network (through Node, and in the container
// itself without Node's guard), reading env for secrets, forging the result line, an endless loop (Atlas's limit,
// "can't check"), a 20 MB stdout flood (capped). Every sandbox's log line (create / setup / run times) is kept, and
// ATLAS_LIVE_MODAL_OUT=<file> writes them as JSON for the evidence file.

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code.ts";
import { sealBet } from "../../src/seal.ts";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import { MAX_OUTPUT_CHARS, MODAL_IMAGE, NODE_BIN, SANDBOX_DIR, createModalExecutor, sdkBackend, type ModalBackend, type SandboxSpec } from "../../runners/executor/modal.ts";
import type { Executor } from "../../runners/runner.ts";
import { callControlFor, forgetReusableControls, runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";

const LIVE = process.env.ATLAS_LIVE_MODAL === "1";
type Call = Extract<ExperimentShape, { shape: "call-function" }>;

const lines: { label: string; line: string }[] = [];
let label = "setup";
const specs: SandboxSpec[] = [];
let backend: ModalBackend;
let modal: ReturnType<typeof createModalExecutor>;
let control: Run;
let localControl: Run;

function experiment(source: string, params: Partial<Call> & { exportName: string }, language: "js" | "ts" = "js"): Experiment {
  const target = makePastedTarget(source, language);
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: exportedFunctions(source).map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

const onModal = (name: string, e: Experiment, opts: { wallClockMs?: number; executor?: Executor } = {}) => {
  label = name;
  return runCallExperiment(e, control, { executor: opts.executor ?? modal, ...(opts.wallClockMs ? { wallClockMs: opts.wallClockMs } : {}) });
};

function expectCantCheck(r: Run, re: RegExp): void {
  expect(r.result.measured).toEqual({});
  expect(r.result.notMeasured.wholeRun, JSON.stringify(r.result)).toMatch(re);
  const v = judge(sealBet({ who: "human", experimentId: r.experimentId, question: "q", measures: "returnedJson", answer: { kind: "json", value: 42 } }), r);
  expect(v.outcome).toBe("cant_check");
}

/** Runs one command in a sandbox made with the executor's own spec, WITHOUT Atlas's env -i / nobody / Node flags. */
async function rawProbe(cmd: string[]): Promise<{ stdout: string; exitCode: number }> {
  label = `raw: ${cmd.slice(0, 2).join(" ")}`;
  const sb = await backend.createSandbox({ ...specs[0]!, timeoutMs: 60_000 });
  try {
    const p = await sb.exec(cmd, {});
    await p.stdin.close();
    const readAll = async () => {
      let text = "";
      const r = p.stdout.getReader();
      for (let x = await r.read(); !x.done; x = await r.read()) text += x.value;
      return text;
    };
    const [stdout, exitCode] = await Promise.all([readAll(), p.wait()]);
    return { stdout, exitCode };
  } finally {
    await sb.terminate();
  }
}

describe.skipIf(!LIVE)("E4 live: the Modal executor on real Modal Sandboxes", () => {
  beforeAll(async () => {
    const real = sdkBackend();
    backend = {
      createSandbox: (spec) => {
        specs.push(spec);
        return real.createSandbox(spec);
      },
    };
    modal = createModalExecutor({ backend, log: (line) => lines.push({ label, line }) });
    label = "control (first sandbox: cold)";
    control = (await runCallControl({ executor: modal })).run;
    localControl = (await runCallControl()).run;
  }, 600_000);

  afterAll(() => {
    const out = process.env.ATLAS_LIVE_MODAL_OUT;
    if (out) writeFileSync(out, `${JSON.stringify({ when: new Date().toISOString(), specs: specs.slice(0, 1), lines }, null, 2)}\n`);
  });

  it("the E1 control passes on Modal, and the run says modal with the pinned Node and Python", () => {
    expect(control.controlPassed, JSON.stringify(control.result.notMeasured)).toBe(true);
    expect(control.executor).toBe("modal");
    const rt = control.trace.at(-1)?.data?.runtime as Record<string, string>;
    expect(rt).toMatchObject({ executor: "modal", backend: "v2", node: MODAL_IMAGE.nodeVersion, python: MODAL_IMAGE.pythonVersion });
    expect(rt.sandboxId).toMatch(/^sb-/);
    expect(localControl.controlPassed).toBe(true);
  });

  it("three ordinary functions: the same facts on Modal as on this machine", async () => {
    const retry: ArgSpec = { kind: "stand-in", name: "fetchRate", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: 42, afterMs: 250 }] };
    const cases: [string, Experiment][] = [
      ["ordinary: add", experiment("export function add(a, b) { return { sum: a + b }; }", { exportName: "add", args: [{ kind: "json", value: 40 }, { kind: "json", value: 2 }] })],
      [
        "ordinary: retry with a stand-in",
        experiment(
          `export async function getRate(fetchRate: () => Promise<number>): Promise<number> {
  for (let i = 0; i < 3; i++) { try { return await fetchRate(); } catch { await new Promise((r) => setTimeout(r, 1000)); } }
  throw new Error("gave up");
}`,
          { exportName: "getRate", args: [retry] },
          "ts",
        ),
      ],
      ["ordinary: throws", experiment(`export function parse(s) { const n = Number(s); if (Number.isNaN(n)) throw new RangeError("not a number: " + s); return n; }`, { exportName: "parse", args: [{ kind: "json", value: "1,5" }] })],
    ];
    for (const [name, e] of cases) {
      const remote = await onModal(name, e);
      const here = await runCallExperiment(e, localControl);
      expect(remote.executor).toBe("modal");
      expect(here.executor).toBe("local");
      expect(remote.result, name).toEqual(here.result);
      expect(remote.result.notMeasured.wholeRun).toBeUndefined();
    }
  }, 300_000);

  it("attack: the network (fetch from pasted code) is can't check, and the container itself has no network", async () => {
    expectCantCheck(await onModal("attack: fetch", experiment(`export async function f(){ const r = await fetch("https://example.com"); return r.status; }`, { exportName: "f" })), /network|files/);
    // Without Node's guard, as root: DNS and a raw IP connection both fail inside the container.
    const raw = await rawProbe([
      NODE_BIN,
      "-e",
      `const net=require("net");fetch("https://example.com").then(r=>console.log("FETCH OK "+r.status),e=>console.log("FETCH FAIL "+(e.cause?.code??e.message)));const s=net.connect(443,"1.1.1.1");s.setTimeout(5000);s.on("connect",()=>{console.log("TCP OK");s.destroy()});s.on("timeout",()=>{console.log("TCP FAIL timeout");s.destroy()});s.on("error",e=>console.log("TCP FAIL "+e.code));`,
    ]);
    expect(raw.stdout).toMatch(/FETCH FAIL/);
    expect(raw.stdout).toMatch(/TCP FAIL/);
    expect(raw.stdout).not.toMatch(/OK/);
  }, 300_000);

  it("attack: env holds no secrets (pasted code, and a raw command through the executor, see an empty env)", async () => {
    const r = await onModal("attack: env from pasted code", experiment(`export function f(){ return Object.keys(process.env); }`, { exportName: "f" }));
    // Either the harness refuses process.env, or the env is empty; it must never hold a name.
    if (r.result.notMeasured.wholeRun === undefined) expect(r.result.measured.returnedJson).toBe("[]");
    label = "attack: env through the executor";
    const direct = await modal.exec({ files: { "e.mjs": "console.log(JSON.stringify({ env: process.env, uid: process.getuid() }))" }, cmd: ["node", "e.mjs"], wallClockMs: 10_000, allowNetwork: false });
    expect(direct.exitCode).toBe(0);
    expect(JSON.parse(direct.stdout)).toEqual({ env: {}, uid: 65534 });
    // For the evidence: the NAMES (never values) Modal itself puts in a container's env, which env -i removes.
    const names = await rawProbe(["/bin/sh", "-c", "env | cut -d= -f1 | sort | tr '\\n' ' '"]);
    lines.push({ label: "raw env NAMES Modal sets (values not read)", line: names.stdout.trim() });
    expect(names.stdout).not.toMatch(/TOKEN/);
  }, 300_000);

  it("attack: the per-run key is nowhere the code can read, and a forged result line is refused", async () => {
    let key = "";
    const spy: Executor = { kind: "modal", exec: (req) => ((key = (req.stdin ?? "").trim()), modal.exec(req)) };
    const looks = await onModal("attack: look for the key", experiment(`export function f(){ return JSON.stringify([process.argv, process.execArgv, process.env, process.title, process.argv0]); }`, { exportName: "f" }), { executor: spy });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(looks)).not.toContain(key);
    for (const l of lines) expect(l.line).not.toContain(key);
    const FAKE = `{ runs: [{ id: "exp1", trace: [], result: { measured: { outcome: "returned", virtualMs: 0, returnedType: "number", returnedJson: "42" }, notMeasured: {} } }] }`;
    const forge = `export function f(){
  process.stdout.write("\\nATLAS_RESULT " + "a".repeat(64) + " " + JSON.stringify(${FAKE}) + "\\n");
  return new Promise(() => {});
}`;
    expectCantCheck(await onModal("attack: forged result line", experiment(forge, { exportName: "f" })), /tampering/);
    const report = `export function f(){
  const m = process.report.getReport().header.commandLine.at(-1);
  process.stdout.write("\\nATLAS_RESULT " + m + " " + JSON.stringify(${FAKE}) + "\\n", () => process.reallyExit(0));
  return new Promise(() => {});
}`;
    expectCantCheck(await onModal("attack: process.report forge", experiment(report, { exportName: "f" })), /process\.report/);
  }, 300_000);

  it("attack: an endless loop hits Atlas's wall-clock limit and is can't check; the sandbox is terminated", async () => {
    const r = await onModal("attack: endless loop", experiment(`export function f(){ for(;;){} }`, { exportName: "f" }), { wallClockMs: 4_000 });
    expectCantCheck(r, /ran past Atlas's 4000 ms limit of REAL time/);
    expect(lines.at(-1)!.line).toMatch(/ timed out exit=none timedOut=true /);
  }, 300_000);

  it("attack: a 20 MB stdout flood is capped at 16 MiB and the run is can't check", async () => {
    const r = await onModal("attack: 20 MB stdout flood", experiment(`export function f(){ const s = "x".repeat(1 << 20); for (let i = 0; i < 20; i++) process.stdout.write(s); return 1; }`, { exportName: "f" }), { wallClockMs: 60_000 });
    const last = lines.at(-1)!.line;
    const chars = Number(/stdoutChars=(\d+)/.exec(last)![1]);
    expect(chars).toBeGreaterThanOrEqual(20 * (1 << 20));
    expect(MAX_OUTPUT_CHARS).toBeLessThan(chars);
    expectCantCheck(r, /no result|tampering|ran past/);
  }, 300_000);

  it("review round 1 (E, F): a memory bomb past 1 GiB is can't check with a plain reason (no Modal ids or RPC names)", async () => {
    const r = await onModal("review1: memory bomb", experiment(`export function f(){ const a=[]; for(let i=0;i<16;i++){ const b=new Uint8Array(128*1024*1024); b.fill(1); a.push(b);} return a.length; }`, { exportName: "f" }), { wallClockMs: 30_000 });
    expectCantCheck(r, /memory|stopped|exit 13[47]/);
    const why = r.result.notMeasured.wholeRun!;
    expect(why).not.toMatch(/urpc|containerManager|"ta-|sb-[A-Za-z0-9]{10}|could not start/);
    lines.push({ label: "review1: memory bomb reason", line: why });
  }, 300_000);

  it("review round 1 (D31): a passed control is reused (no new sandbox) within 10 minutes", async () => {
    forgetReusableControls();
    label = "review1: D31 control (fresh)";
    const a = await callControlFor({ executor: modal });
    const before = specs.length;
    label = "review1: D31 control (reused)";
    const b = await callControlFor({ executor: modal });
    expect(a.run.controlPassed).toBe(true);
    expect(b.run.id).toBe(a.run.id);
    expect(specs.length).toBe(before);
  }, 300_000);

  it("review round 1 (B): after all of this, no native add-on is loaded in this process", () => {
    expect((process.report.getReport() as { sharedObjects: string[] }).sharedObjects.filter((x) => x.endsWith(".node"))).toEqual([]);
  });

  it("every sandbox was made with no network and the caps, and each one got a log line", () => {
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s).toMatchObject({ blockNetwork: true, cpuLimit: 1, memoryLimitMiB: 1024 });
    expect(lines.filter((l) => l.line.startsWith("modal sandbox ")).length).toBeGreaterThanOrEqual(12);
    expect(SANDBOX_DIR).toContain("atlas-exec-");
  });
});
