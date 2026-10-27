// E4 review round 1: one test (or more) per finding, plus D31 (reuse a passed control for 10 minutes) and D32
// (warm Modal at server start). Fake Modal backends only; no network, $0. The live re-check is in
// tests/evidence/E4/README.md ("Review round 1").

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code.ts";
import { sealBet } from "../../src/seal.ts";
import type { Experiment, ExperimentShape } from "../../src/types.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import { MODAL_FINGERPRINT, cleanModalText, createModalExecutor, sdkBackend, type SandboxSpec } from "../../runners/executor/modal.ts";
import { executorFromEnv } from "../../runners/executor/select.ts";
import { warmUp } from "../../runners/executor/warm.ts";
import type { ExecRequest, Executor } from "../../runners/runner.ts";
import { CALL_CONTROL_REUSE_MS, callControlFor, callControlKey, forgetReusableControls, runCallExperiment, runInSandbox } from "../../runners/ts/call-runner.ts";
import { controlLines } from "../../web/screens/proofcard-model.ts";
import { emulatingBackend, scriptedBackend } from "./modal-fakes.ts";

const req = (over: Partial<ExecRequest> = {}): ExecRequest => ({ files: { "w.mjs": "1" }, cmd: ["node", "w.mjs"], stdin: "key\n", wallClockMs: 5_000, allowNetwork: false, ...over });
const SPEC: SandboxSpec = { blockNetwork: true, cpu: 0.5, cpuLimit: 1, memoryMiB: 512, memoryLimitMiB: 1024, timeoutMs: 60_000 };

beforeEach(() => {
  vi.restoreAllMocks();
  forgetReusableControls();
});

describe("A: the sandbox backend is pinned to V2 and recorded", () => {
  it("sdkBackend makes sandboxes with experimentalCreate (V2), never plain create (which follows machine config)", async () => {
    const experimentalCreate = vi.fn(async () => ({ sandboxId: "sb-x", exec: vi.fn(), terminate: vi.fn() }));
    const create = vi.fn();
    vi.doMock("modal", () => ({
      ModalClient: class {
        apps = { fromName: async () => ({ appId: "ap-x" }) };
        images = { fromRegistry: () => ({ dockerfileCommands: () => ({ build: async () => ({ imageId: "im-x" }) }) }) };
        sandboxes = { experimentalCreate, create };
      },
    }));
    try {
      const sb = await sdkBackend("atlas-test").createSandbox(SPEC);
      expect(sb.sandboxId).toBe("sb-x");
      expect(experimentalCreate).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("modal");
    }
  });

  it("every run records backend v2 in its runtime, and the executor's fingerprint names it", async () => {
    const r = await createModalExecutor({ backend: scriptedBackend(), log: () => {} }).exec(req());
    expect(r.runtime?.backend).toBe("v2");
    expect(MODAL_FINGERPRINT).toMatch(/^modal v2 python:3\.14\.7-slim-trixie@sha256:/);
  });
});

describe("B: no native add-on from npm is loaded into the server", () => {
  const nativeAfter = (script: string): { requireCache: number; sharedObjects: number } =>
    JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CBOR_NATIVE_ACCELERATION_DISABLED: "" } }).trim().split("\n").at(-1)!);
  const count = `
const req = (await import("node:module")).createRequire(import.meta.url);
console.log(JSON.stringify({ requireCache: Object.keys(req.cache).filter((k) => k.endsWith(".node")).length, sharedObjects: process.report.getReport().sharedObjects.filter((s) => s.endsWith(".node")).length }));`;

  it("loadModalSdk switches cbor-x's native add-on off: no .node file in require.cache or loaded at all", () => {
    const got = nativeAfter(`const { loadModalSdk } = await import("./runners/executor/modal.ts"); await loadModalSdk();${count}`);
    expect(got).toEqual({ requireCache: 0, sharedObjects: 0 });
  });

  it("control: importing the SDK directly, without the switch, DOES load the native add-on here (so the test above means something)", () => {
    const pkg = createRequire(import.meta.url).resolve("modal");
    const hasBinary = existsSync(pkg) && /cbor-extract-/.test(execFileSync("ls", ["node_modules/.pnpm"], { encoding: "utf8" }));
    if (!hasBinary) return; // no prebuilt binary for this platform: nothing native could load anyway
    const got = nativeAfter(`await import("modal");${count}`);
    expect(got.requireCache + got.sharedObjects).toBeGreaterThan(0);
  });
});

describe("C: a daily cap on sandbox starts and sandbox-seconds", () => {
  it("past the daily start cap: refused before any sandbox exists, with the reason; the next UTC day starts afresh", async () => {
    let now = Date.parse("2026-10-27T10:00:00Z");
    const b = scriptedBackend();
    const ex = createModalExecutor({ backend: b, log: () => {}, maxSandboxesPerDay: 2, now: () => now });
    await ex.exec(req());
    await ex.exec(req());
    await expect(ex.exec(req())).rejects.toThrow(/^Atlas's daily sandbox budget is used up \(2 of 2 sandboxes, \d+ of 7200 sandbox-seconds today\); it resets at 00:00 UTC$/);
    expect(b.rec.specs).toHaveLength(2);
    expect(ex.stats()).toEqual({ running: 0, queued: 0 }); // the refused exec gave its slot back
    now = Date.parse("2026-10-28T00:00:01Z");
    await ex.exec(req());
    expect(ex.budget()).toMatchObject({ day: "2026-10-28", starts: 1 });
  });

  it("past the daily sandbox-seconds cap: refused", async () => {
    const ex = createModalExecutor({ backend: scriptedBackend({ run: { hang: true } }), log: () => {}, maxSandboxSecondsPerDay: 1 });
    const r = await ex.exec(req({ wallClockMs: 1_100 }));
    expect(r.timedOut).toBe(true);
    await expect(ex.exec(req())).rejects.toThrow(/daily sandbox budget is used up \(1 of 2000 sandboxes, 1 of 1 sandbox-seconds today\)/);
  });

  it("through the server: 'the run did not finish' with the budget reason, and no verdicts", async () => {
    const { createApp } = await import("../../server/app.ts");
    const { createProofStore } = await import("../../server/evm-round.ts");
    const { FIXTURE_FILE } = await import("../../server/meta/roles/fixture-finding.ts");
    const app = createApp({ executor: createModalExecutor({ backend: scriptedBackend(), log: () => {}, maxSandboxesPerDay: 0 }), proofs: createProofStore({ publish: false }) });
    const h = { "content-type": "application/json", "x-atlas-session": "budget" };
    const ask = async (path: string, body?: unknown) => {
      const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const t = (await ask("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    await ask("/experiments", { id: "e-b", target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } });
    await ask("/bets", { experimentId: "e-b", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] });
    const r = await ask("/runs", { experimentId: "e-b" });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/^the run did not finish: .*Atlas's daily sandbox budget is used up/);
    expect(r.body).not.toHaveProperty("verdicts");
  });

  it("the env settings: ATLAS_MODAL_MAX_SANDBOXES_PER_DAY and ATLAS_MODAL_MAX_SANDBOX_SECONDS_PER_DAY", async () => {
    const ex = executorFromEnv({ ATLAS_EXECUTOR: "modal", ATLAS_MODAL_MAX_SANDBOXES_PER_DAY: "1" }, { backend: scriptedBackend(), log: () => {} }) as ReturnType<typeof createModalExecutor>;
    await ex.exec(req());
    await expect(ex.exec(req())).rejects.toThrow(/1 of 1 sandboxes/);
    expect(() => executorFromEnv({ ATLAS_EXECUTOR: "modal", ATLAS_MODAL_MAX_SANDBOX_SECONDS_PER_DAY: "two hours" })).toThrow(/whole number/);
  });
});

const MODAL_WAIT_LINE = 'waiting on pid 10: waiting on PID 10 in sandbox "ta-01M5ZKBPAVKWRENTAZ5ZB51NF6": urpc method "containerManager.WaitPID" failed: EOF';

describe("E: Modal's internal text never reaches a reason a person sees", () => {
  it("cleanModalText drops Modal's own lines and masks its ids", () => {
    expect(cleanModalText(`real error\n${MODAL_WAIT_LINE}`)).toBe("real error");
    expect(cleanModalText("sandbox sb-01M5ZKBT2RPY691TK1XVY8D2TB said no")).toBe("sandbox <modal-id> said no");
  });

  it("exit 137 with Modal's wait line on stderr: a plain out-of-memory reason, no task id, no RPC name", async () => {
    const ex = createModalExecutor({ backend: scriptedBackend({ run: { exitCode: 137, stderr: MODAL_WAIT_LINE } }), log: () => {} });
    const r = await runInSandbox(ex, "export function f(){ return 1; }", "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 5_000);
    expect(r).toMatchObject({ ok: false, kind: "noResult", reason: "the sandbox killed the code (exit 137), most likely because it used more memory than the sandbox allows" });
  });

  it("a thrown Modal error is cleaned too", async () => {
    const ex = createModalExecutor({ backend: scriptedBackend({ createError: 'boom in sandbox "ta-01M5ZKBPAVKWRENTAZ5ZB51NF6"' }), log: () => {} });
    await expect(ex.exec(req())).rejects.toThrow(/boom in sandbox "<modal-id>"/);
  });
});

describe("F: a sandbox that dies under the code is reported as stopped, never as 'could not start'", () => {
  it("wait() rejects with Modal's shutting-down error after the command started: a result that says stopped", async () => {
    const b = scriptedBackend({ run: { waitError: "TaskExecWait FAILED_PRECONDITION: Modal Sandbox is shutting down" } });
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const r = await ex.exec(req());
    expect(r.stopped).toMatch(/^the sandbox stopped while the code ran \(.*\); this usually means the code used more than the sandbox's 1024 MiB of memory$/);
    expect(r.stopped).not.toMatch(/TaskExecWait|ta-/);
    expect(r).toMatchObject({ exitCode: null, timedOut: false });
    expect(b.rec.terminated).toEqual(["sb-fake-0"]);
    const run = await runInSandbox(ex, "export function f(){ return 1; }", "js", { runs: [{ id: "x", exportName: "f", args: [], watchLimitMs: 1000 }] }, 5_000);
    expect(run).toMatchObject({ ok: false, kind: "noResult" });
    expect(run.ok === false && run.reason).toMatch(/^the sandbox stopped while the code ran/);
    expect(run.ok === false && run.reason).not.toMatch(/could not start/);
  });

  it("any other wait() error is still an infrastructure failure", async () => {
    const ex = createModalExecutor({ backend: scriptedBackend({ run: { waitError: "permission denied by policy" } }), log: () => {} });
    await expect(ex.exec(req())).rejects.toThrow(/Modal could not run the command in a sandbox: permission denied by policy/);
  });
});

describe("G: a failed stdin write is its own reason, never blamed on the code", () => {
  it("the input never arrived and the run hit the wall clock: an infrastructure error, not timedOut", async () => {
    const b = scriptedBackend({ run: { stdinError: "stream reset by peer" } });
    await expect(createModalExecutor({ backend: b, log: () => {} }).exec(req({ wallClockMs: 300 }))).rejects.toThrow(/Modal did not deliver the run's input \(stdin\): stream reset by peer/);
    expect(b.rec.terminated).toEqual(["sb-fake-0"]);
  });
});

describe("H: ATLAS_EXECUTOR set but empty is a startup error", () => {
  it("'', ' ', and a tab throw; unset is still local", () => {
    for (const v of ["", " ", "\t", "\n"]) expect(() => executorFromEnv({ ATLAS_EXECUTOR: v }), JSON.stringify(v)).toThrow(/set but empty/);
    expect(executorFromEnv({})).toBe(localExecutor);
  });
});

describe("J: every wait has a deadline", () => {
  it("starting the run command never answers: refused after the startup limit, sandbox terminated", async () => {
    const b = scriptedBackend({ runFor: () => ({ execHang: true }) });
    const t0 = Date.now();
    await expect(createModalExecutor({ backend: b, log: () => {}, startupTimeoutMs: 200 }).exec(req())).rejects.toThrow(/starting the command took more than 200 ms/);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(b.rec.terminated).toEqual(["sb-fake-0"]);
  });

  it("the Python check never answers: refused after the startup limit (each sandbox checks its own)", async () => {
    const b = scriptedBackend({ python: { execHang: true } });
    await expect(createModalExecutor({ backend: b, log: () => {}, startupTimeoutMs: 200 }).exec(req())).rejects.toThrow(/writing the files took more than 200 ms/);
    expect(b.rec.terminated).toEqual(["sb-fake-0"]);
  });
});

// ── D31 and D32 ───────────────────────────────────────────────────────────────────────────────────

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const experiment = (source: string, params: Partial<Call> & { exportName: string }): Experiment => {
  const target = makePastedTarget(source, "js");
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: exportedFunctions(source).map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
};

describe("D31: a passed control is reused for up to 10 minutes, under the measuring-code + executor + image key", () => {
  it("reused within 10 minutes (no new sandbox), run again after; the key names the executor and its fingerprint", async () => {
    let now = Date.now();
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const first = await callControlFor({ executor: ex, now: () => now });
    expect(first.run.controlPassed).toBe(true);
    now += CALL_CONTROL_REUSE_MS - 1_000;
    const again = await callControlFor({ executor: ex, now: () => now });
    expect(again.run.id).toBe(first.run.id);
    expect(b.rec.specs).toHaveLength(1);
    now = Date.parse(first.run.finishedAt) + CALL_CONTROL_REUSE_MS + 1;
    const later = await callControlFor({ executor: ex, now: () => now });
    expect(later.run.id).not.toBe(first.run.id);
    expect(b.rec.specs).toHaveLength(2);
    expect(callControlKey(ex)).not.toBe(callControlKey(localExecutor));
    expect(callControlKey({ ...ex, fingerprint: "modal v2 some-other-image" })).not.toBe(callControlKey(ex));
  });

  it("two runs asking at once share ONE control run", async () => {
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const [a, c] = await Promise.all([callControlFor({ executor: ex }), callControlFor({ executor: ex })]);
    expect(a.run.id).toBe(c.run.id);
    expect(b.rec.specs).toHaveLength(1);
  });

  it("a control that did not pass is never reused, nor one that threw", async () => {
    let execs = 0;
    const silent: Executor = { kind: "local", fingerprint: "silent", exec: async () => (execs++, { stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 }) };
    expect((await callControlFor({ executor: silent })).run.controlPassed).toBe(false);
    expect((await callControlFor({ executor: silent })).run.controlPassed).toBe(false);
    expect(execs).toBe(2);
    let throws = 0;
    const broken: Executor = { kind: "local", fingerprint: "broken", exec: async () => (throws++, Promise.reject(new Error("down"))) };
    await expect(callControlFor({ executor: broken })).rejects.toThrow(/down/);
    await expect(callControlFor({ executor: broken })).rejects.toThrow(/down/);
    expect(throws).toBe(2);
  });

  it("the run names the control it relied on and its time; the .atlas.json verifies; the proof card says when; a moved time fails verify", async () => {
    const ctl = (await callControlFor({ executor: localExecutor })).run;
    const exp = experiment("export function add(a, b) { return a + b; }", { exportName: "add", args: [{ kind: "json", value: 2 }, { kind: "json", value: 3 }] });
    const bet = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: 5 } });
    await new Promise((r) => setTimeout(r, 5));
    const run = await runCallExperiment(exp, (await callControlFor({ executor: localExecutor })).run);
    expect(run.controlRunId).toBe(ctl.id);
    const checks = run.trace.find((t) => t.event === "call_checks")!.data!;
    expect(checks).toMatchObject({ controlRunId: ctl.id, controlFinishedAt: ctl.finishedAt, controlPassed: true });
    const file = JSON.parse(JSON.stringify(buildAtlasFile({ target: exp.target, experiment: exp, bets: [bet], run, verdicts: [judge(bet, run)], agentLog: [], createdAt: new Date().toISOString() })));
    expect(verifyAtlasFile(file)).toMatchObject({ ok: true });
    expect(controlLines(run)[0]).toMatch(new RegExp(`^known-case check of Atlas's measuring code matched at ${ctl.finishedAt.replaceAll(".", "\\.")} \\(control run ${ctl.id}\\), \\d+ s before this run$`));

    const late = JSON.parse(JSON.stringify(file));
    late.runs[0].trace.find((t: { event: string }) => t.event === "call_checks").data.controlFinishedAt = new Date(Date.parse(run.startedAt) + 1000).toISOString();
    expect(verifyAtlasFile(late)).toMatchObject({ ok: false, problems: [expect.stringMatching(/finished after the run started/)] });
    const stale = JSON.parse(JSON.stringify(file));
    stale.runs[0].trace.find((t: { event: string }) => t.event === "call_checks").data.controlFinishedAt = new Date(Date.parse(run.startedAt) - 12 * 60_000).toISOString();
    expect(verifyAtlasFile(stale)).toMatchObject({ ok: false, problems: [expect.stringMatching(/more than the 10 minutes/)] });
    const other = JSON.parse(JSON.stringify(file));
    other.runs[0].trace.find((t: { event: string }) => t.event === "call_checks").data.controlRunId = "someOther";
    expect(verifyAtlasFile(other).ok).toBe(false);
  });

  it("a control made on one executor is refused for a run on another (never claim modal when local ran)", async () => {
    const ctl = (await callControlFor({ executor: localExecutor })).run;
    const ex = createModalExecutor({ backend: scriptedBackend(), log: () => {} });
    await expect(runCallExperiment(experiment("export const f = () => 1;", { exportName: "f" }), ctl, { executor: ex })).rejects.toThrow(/ran on local, not on modal/);
  });
});

describe("D32: Modal is warmed once at server start, without blocking or stopping it", () => {
  it("warm-up runs the control in one sandbox, logs it, and the first run then reuses it", async () => {
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const lines: string[] = [];
    await warmUp(ex, (l) => lines.push(l));
    expect(lines).toEqual([expect.stringMatching(/^Modal warm-up: Modal is reachable; the known-case check passed in a sandbox in \d+ ms and is reused for 10 minutes$/)]);
    expect(b.rec.specs).toHaveLength(1);
    await callControlFor({ executor: ex });
    expect(b.rec.specs).toHaveLength(1);
  });

  it("a failed warm-up is one log line and the promise still resolves; the local executor is never warmed", async () => {
    const lines: string[] = [];
    const ex = createModalExecutor({ backend: scriptedBackend({ createError: "UNAVAILABLE: down" }), log: () => {} });
    await expect(warmUp(ex, (l) => lines.push(l))).resolves.toBeUndefined();
    expect(lines).toEqual([expect.stringMatching(/^Modal warm-up failed \(the server keeps running; each run will try Modal again\): .*UNAVAILABLE: down/)]);
    const spy = vi.spyOn(localExecutor, "exec");
    await warmUp(localExecutor, (l) => lines.push(l));
    expect(spy).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
  });
});
