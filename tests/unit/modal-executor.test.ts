// E4: the Modal executor, with fake Modal backends (no network, $0). What is checked:
// - what Atlas sends to Modal: a sandbox with no network, CPU/memory caps and a lifetime limit, and NOTHING else
//   (no env, no secrets); the run command (env -i, nobody, the local executor's Node flags);
// - the per-run key travels on the run command's stdin only (never in the spec, a command, the file upload or a log);
// - one sandbox per exec, always terminated (success, error, timeout, failed setup);
// - output caps, exit code and timedOut reported as they happened;
// - the concurrency cap and the busy refusal;
// - selection by ATLAS_EXECUTOR, and no fallback to local when Modal cannot be reached;
// - end to end through the real call-worker (emulated plumbing): the control passes and the run says "modal".
// The live suite (tests/unit/modal-live.test.ts) checks the real isolation on Modal.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctions, makePastedTarget } from "../../src/pasted-code.ts";
import type { Experiment, ExperimentShape } from "../../src/types.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import { MAX_OUTPUT_CHARS, MODAL_IMAGE, NOBODY, NODE_BIN, SANDBOX_DIR, UNPACK_JS, containerCommand, createModalExecutor } from "../../runners/executor/modal.ts";
import { executorFromEnv } from "../../runners/executor/select.ts";
import type { ExecRequest } from "../../runners/runner.ts";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import { emulatingBackend, scriptedBackend } from "./modal-fakes.ts";

const KEY = "k".repeat(16) + "-per-run-key-" + "9".repeat(16);
const req = (over: Partial<ExecRequest> = {}): ExecRequest => ({
  files: { "w.mjs": "console.log('hello')", "sub/x.txt": "data" },
  cmd: ["node", "--permission", "--allow-fs-read=.", "--disallow-code-generation-from-strings", "w.mjs"],
  stdin: `${KEY}\n`,
  wallClockMs: 5_000,
  allowNetwork: false,
  ...over,
});

function quiet() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

afterEach(() => vi.restoreAllMocks());

describe("what Atlas sends to Modal", () => {
  it("one sandbox per exec: no network, CPU and memory caps, a lifetime limit, and no env, secrets or volumes", async () => {
    const b = scriptedBackend();
    const q = quiet();
    const ex = createModalExecutor({ backend: b, log: q.log });
    const r = await ex.exec(req({ env: { ONLY: "1" } }));
    expect(r.exitCode).toBe(0);
    expect(b.rec.specs).toHaveLength(1);
    const spec = b.rec.specs[0]!;
    expect(Object.keys(spec).sort()).toEqual(["blockNetwork", "cpu", "cpuLimit", "memoryLimitMiB", "memoryMiB", "timeoutMs"]);
    expect(spec.blockNetwork).toBe(true);
    expect(spec).toMatchObject({ cpu: 0.5, cpuLimit: 1, memoryMiB: 512, memoryLimitMiB: 1024 });
    expect(spec.timeoutMs).toBeGreaterThan(5_000);
    expect(spec.timeoutMs % 1000).toBe(0);
    // A second exec makes a second sandbox; both are terminated.
    await ex.exec(req());
    expect(b.rec.specs).toHaveLength(2);
    expect(b.rec.terminated).toEqual(["sb-fake-0", "sb-fake-1"]);
  });

  it("the run command: env -i with only the request's env, as nobody with no new privileges, then node with the local executor's flags", () => {
    const cmd = containerCommand(req({ env: { A: "1", B_2: "x=y" } }));
    expect(cmd.slice(0, 4)).toEqual(["/usr/bin/env", "-i", "A=1", "B_2=x=y"]);
    expect(cmd.slice(4, 9)).toEqual(["/usr/bin/setpriv", `--reuid=${NOBODY}`, `--regid=${NOBODY}`, "--clear-groups", "--no-new-privs"]);
    expect(cmd.slice(9)).toEqual([NODE_BIN, "--permission", `--allow-fs-read=${SANDBOX_DIR}`, "--disallow-code-generation-from-strings", "w.mjs"]);
  });

  it("refuses before any sandbox exists: a widening node flag, a network host list, NODE_OPTIONS, a non-node command, odd env, a path that leaves the folder", async () => {
    const b = scriptedBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const bad: [Partial<ExecRequest>, RegExp][] = [
      [{ cmd: ["node", "--allow-net", "w.mjs"] }, /widen the sandbox/],
      [{ cmd: ["node", "--allow-child-process", "w.mjs"] }, /widen the sandbox/],
      [{ allowNetwork: { hosts: ["example.com"] } }, /cannot limit network/],
      [{ env: { NODE_OPTIONS: "--no-permission" } }, /NODE_OPTIONS/],
      [{ env: { "A B": "1" } }, /not a plain NAME=value/],
      [{ cmd: ["python3", "x.py"] }, /only "node"/],
      [{ files: { "../x.mjs": "" } }, /leaves the sandbox folder/],
      [{ files: { "/etc/x": "" } }, /leaves the sandbox folder/],
      [{ wallClockMs: 0 }, /positive/],
    ];
    for (const [over, re] of bad) await expect(ex.exec(req(over)), JSON.stringify(over)).rejects.toThrow(re);
    expect(b.rec.specs).toHaveLength(0);
  });

  it("the per-run key goes on the run command's stdin ONLY: not in the spec, any command, the file upload or the log", async () => {
    const b = scriptedBackend();
    const q = quiet();
    const ex = createModalExecutor({ backend: b, log: q.log });
    await ex.exec(req());
    // stdins: [unpack (the files as JSON), python --version (empty), the run]
    expect(b.rec.stdins).toHaveLength(3);
    expect(b.rec.stdins[2]).toBe(`${KEY}\n`);
    const elsewhere = [JSON.stringify(b.rec.specs), JSON.stringify(b.rec.cmds), b.rec.stdins[0]!, b.rec.stdins[1]!, ...q.lines];
    for (const text of elsewhere) expect(text).not.toContain(KEY);
    // The files arrived through the unpacker's stdin, as JSON.
    expect(JSON.parse(b.rec.stdins[0]!)).toEqual(req().files);
    expect(b.rec.cmds[0]).toEqual([NODE_BIN, "-e", UNPACK_JS, SANDBOX_DIR]);
  });

  it("logs one line per sandbox with durations, and never the code, the output or the key", async () => {
    const b = scriptedBackend({ run: { stdout: "SECRET-OUTPUT\n", stderr: "SECRET-ERR" } });
    const q = quiet();
    const ex = createModalExecutor({ backend: b, log: q.log });
    await ex.exec(req({ files: { "w.mjs": "const CODE_CONTENTS = 1" } }));
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatch(/^modal sandbox sb-fake-0 done exit=0 timedOut=false createMs=\d+ setupMs=\d+ runMs=\d+ totalMs=\d+ stdoutChars=14 stderrChars=10$/);
    for (const s of ["CODE_CONTENTS", "SECRET-OUTPUT", "SECRET-ERR", KEY]) expect(q.lines[0]).not.toContain(s);
  });
});

describe("what Atlas reports back", () => {
  it("exit code, stdout and stderr as they came, and the measured runtime", async () => {
    const b = scriptedBackend({ run: { stdout: ["a", "b\n"], stderr: "warn", exitCode: 3 } });
    const r = await createModalExecutor({ backend: b, log: () => {} }).exec(req());
    expect(r).toMatchObject({ stdout: "ab\n", stderr: "warn", exitCode: 3, timedOut: false });
    expect(r.runtime).toEqual({ executor: "modal", node: MODAL_IMAGE.nodeVersion, python: MODAL_IMAGE.pythonVersion, image: expect.stringContaining(MODAL_IMAGE.base), sandboxId: "sb-fake-0" });
  });

  it("stdout is capped at 16 MiB, and the rest is read and dropped (a 20 MB flood)", async () => {
    const chunk = "x".repeat(1024 * 1024);
    const b = scriptedBackend({ run: { stdout: Array.from({ length: 20 }, () => chunk) } });
    const q = quiet();
    const r = await createModalExecutor({ backend: b, log: q.log }).exec(req());
    expect(r.stdout.length).toBe(MAX_OUTPUT_CHARS);
    expect(q.lines[0]).toContain(`stdoutChars=${20 * 1024 * 1024}`);
  });

  it("Atlas's wall-clock limit: the sandbox is terminated and the result says timedOut, with no exit code", async () => {
    const b = scriptedBackend({ run: { hang: true } });
    const q = quiet();
    const t0 = Date.now();
    const r = await createModalExecutor({ backend: b, log: q.log }).exec(req({ wallClockMs: 300 }));
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(r).toMatchObject({ timedOut: true, exitCode: null });
    expect(b.rec.terminated).toEqual(["sb-fake-0"]);
    expect(q.lines[0]).toContain("timed out");
  });

  it("an error at any step throws with the step named, and the sandbox is still terminated", async () => {
    const cases: [Parameters<typeof scriptedBackend>[0], RegExp][] = [
      [{ run: { execError: "stream reset" } }, /Modal could not run the command in a sandbox: stream reset/],
      [{ unpack: { exitCode: 3, stderr: "a path leaves the run folder" } }, /could not write the files into a sandbox: the unpacker exited with code 3/],
      [{ unpack: { stdout: "v20.1.0" } }, /runs Node v20\.1\.0, not the pinned v25\.8\.1/],
      [{ python: { stdout: "Python 3.11.2" } }, /runs Python 3\.11\.2, not the pinned Python 3\.14\.7/],
    ];
    for (const [opts, re] of cases) {
      const b = scriptedBackend(opts);
      await expect(createModalExecutor({ backend: b, log: () => {} }).exec(req())).rejects.toThrow(re);
      expect(b.rec.terminated).toEqual(["sb-fake-0"]);
    }
  });

  it("Modal unreachable: throws with the reason (no sandbox to terminate)", async () => {
    const b = scriptedBackend({ createError: "UNAVAILABLE: name resolution failed" });
    await expect(createModalExecutor({ backend: b, log: () => {} }).exec(req())).rejects.toThrow(/Modal could not create a sandbox: UNAVAILABLE: name resolution failed/);
    expect(b.rec.terminated).toEqual([]);
  });

  it("a sandbox that takes longer than the startup limit: throws, and the late sandbox is terminated when it arrives", async () => {
    let open!: () => void;
    const b = scriptedBackend({ createGate: new Promise<void>((r) => (open = r)) });
    await expect(createModalExecutor({ backend: b, log: () => {}, startupTimeoutMs: 100 }).exec(req())).rejects.toThrow(/did not start a sandbox within 100 ms/);
    open();
    await vi.waitFor(() => expect(b.rec.terminated).toEqual(["sb-fake-0"]));
  });

  it("Python is checked once per executor, not per run", async () => {
    const b = scriptedBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    await ex.exec(req());
    await ex.exec(req());
    expect(b.rec.cmds.filter((c) => c[0] === "/usr/local/bin/python3")).toHaveLength(1);
  });
});

describe("cost and abuse limits", () => {
  it("at most maxConcurrent sandboxes at once; the queue is bounded; one more is refused as busy", async () => {
    let free!: () => void;
    const gateOpen = new Promise<void>((r) => (free = r));
    const b = scriptedBackend({ createGate: gateOpen });
    const ex = createModalExecutor({ backend: b, log: () => {}, maxConcurrent: 2, maxQueued: 1 });
    const runs = [ex.exec(req()), ex.exec(req()), ex.exec(req())];
    await vi.waitFor(() => expect(ex.stats()).toEqual({ running: 2, queued: 1 }));
    await expect(ex.exec(req())).rejects.toThrow(/all busy \(2 running, 1 waiting\)/);
    expect(b.rec.specs).toHaveLength(2); // the queued one has not made a sandbox yet
    free();
    const done = await Promise.all(runs);
    expect(done.every((r) => r.exitCode === 0)).toBe(true);
    expect(b.rec.terminated).toHaveLength(3);
    expect(ex.stats()).toEqual({ running: 0, queued: 0 });
  });

  it("a failed run gives its slot back", async () => {
    const b = scriptedBackend({ createError: "boom" });
    const ex = createModalExecutor({ backend: b, log: () => {}, maxConcurrent: 1, maxQueued: 0 });
    for (let i = 0; i < 3; i++) await expect(ex.exec(req())).rejects.toThrow(/boom/);
    expect(ex.stats()).toEqual({ running: 0, queued: 0 });
  });
});

describe("the unpacker (runs for real on this machine's Node)", () => {
  it("writes nested files read-only to others, and prints the Node version", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-unpack-")));
    try {
      const out = execFileSync(process.execPath, ["-e", UNPACK_JS, join(dir, "run")], { input: JSON.stringify({ "a.ts": "A", "x/y.json": "{}" }), encoding: "utf8" });
      expect(out).toBe(process.version);
      expect(readFileSync(join(dir, "run", "x", "y.json"), "utf8")).toBe("{}");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a path that leaves the folder (second line of defence after the executor's own check)", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-unpack-")));
    try {
      expect(() => execFileSync(process.execPath, ["-e", UNPACK_JS, join(dir, "run")], { input: JSON.stringify({ "../escape.txt": "x" }), stdio: "pipe" })).toThrow();
      expect(() => readFileSync(join(dir, "escape.txt"))).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("selection: ATLAS_EXECUTOR", () => {
  it("unset or local → the local executor; modal → the Modal executor; anything else stops the server", () => {
    expect(executorFromEnv({})).toBe(localExecutor);
    expect(executorFromEnv({ ATLAS_EXECUTOR: "local" })).toBe(localExecutor);
    expect(executorFromEnv({ ATLAS_EXECUTOR: "modal" }).kind).toBe("modal");
    for (const v of ["Modal", "lokal", "modal,local", "remote"]) expect(() => executorFromEnv({ ATLAS_EXECUTOR: v })).toThrow(/must be "local" or "modal"/);
    expect(() => executorFromEnv({ ATLAS_EXECUTOR: "modal", ATLAS_MODAL_MAX_SANDBOXES: "lots" })).toThrow(/whole number/);
  });

  it("Modal unreachable in hosted mode: the run does not happen, with the reason; it never runs locally instead", async () => {
    const local = vi.spyOn(localExecutor, "exec");
    const ex = executorFromEnv({ ATLAS_EXECUTOR: "modal" }, { backend: scriptedBackend({ createError: "UNAUTHENTICATED: token missing" }), log: () => {} });
    await expect(runCallControl({ executor: ex })).rejects.toThrow(/the sandbox could not start: Modal could not create a sandbox: UNAUTHENTICATED: token missing/);
    expect(local).not.toHaveBeenCalled();
  });
});

describe("end to end through the real call-worker (Modal plumbing emulated on this machine)", () => {
  type Call = Extract<ExperimentShape, { shape: "call-function" }>;
  const experiment = (source: string, params: Partial<Call> & { exportName: string }): Experiment => {
    const target = makePastedTarget(source, "js");
    const full: Call = { shape: "call-function", args: [], ...params };
    const g = gate(full, { exportNames: exportedFunctions(source).map((e) => e.name).concat(params.exportName) });
    if (!g.allowed) throw new Error(g.reason);
    return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
  };

  it("the control passes, the runs say executor modal with the measured runtime, and a forged result line is refused", async () => {
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const ctl = await runCallControl({ executor: ex });
    expect(ctl.reason).toBeUndefined();
    expect(ctl.run.controlPassed).toBe(true);
    expect(ctl.run.executor).toBe("modal");
    expect(ctl.run.trace.at(-1)?.data?.runtime).toMatchObject({ executor: "modal", node: process.version, sandboxId: "sb-emulated-0" });

    const ok = await runCallExperiment(experiment("export function add(a, b) { return a + b; }", { exportName: "add", args: [{ kind: "json", value: 2 }, { kind: "json", value: 3 }] }), ctl.run, { executor: ex });
    expect(ok.executor).toBe("modal");
    expect(ok.result.measured).toMatchObject({ outcome: "returned", returnedJson: "5" });
    expect(ok.trace.at(-1)?.data?.runtime).toMatchObject({ executor: "modal", sandboxId: "sb-emulated-1" });

    const forged = await runCallExperiment(
      experiment(`export function f(){ console.log("ATLAS_RESULT " + "0".repeat(64) + " " + JSON.stringify({ runs: [] })); return 1; }`, { exportName: "f" }),
      ctl.run,
      { executor: ex },
    );
    expect(forged.result.notMeasured.wholeRun).toMatch(/tampering/);
    expect(forged.result.measured).toEqual({});
    expect(b.rec.terminated).toEqual(["sb-emulated-0", "sb-emulated-1", "sb-emulated-2"]);
  });
});

describe("through the server (the retry fixture, which every executor also runs)", () => {
  const wire = async (executor: ReturnType<typeof createModalExecutor>, session: string) => {
    const { createApp } = await import("../../server/app.ts");
    const { createProofStore } = await import("../../server/evm-round.ts");
    const { FIXTURE_FILE } = await import("../../server/meta/roles/fixture-finding.ts");
    const app = createApp({ executor, proofs: createProofStore({ publish: false }) });
    const h = { "content-type": "application/json", "x-atlas-session": session };
    const ask = async (path: string, body?: unknown) => {
      const res = await app.request(path, body === undefined ? { headers: h } : { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as any };
    };
    const t = (await ask("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).body;
    expect((await ask("/experiments", { id: "e-m", target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).status).toBe(200);
    expect((await ask("/bets", { experimentId: "e-m", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] })).status).toBe(200);
    return ask;
  };

  it("Modal unreachable: 'the run did not finish' with Modal's reason; nothing judged, nothing run locally", async () => {
    const local = vi.spyOn(localExecutor, "exec");
    const ask = await wire(createModalExecutor({ backend: scriptedBackend({ createError: "UNAVAILABLE: Modal is down" }), log: () => {} }), "e4-down");
    const r = await ask("/runs", { experimentId: "e-m" });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/^the run did not finish: .*Modal could not create a sandbox: UNAVAILABLE: Modal is down/);
    expect(r.body).not.toHaveProperty("verdicts");
    expect(local).not.toHaveBeenCalled();
  });

  it("Modal up (plumbing emulated): the fixture's control and run go through it, and the run says modal", async () => {
    const b = emulatingBackend();
    const ask = await wire(createModalExecutor({ backend: b, log: () => {} }), "e4-up");
    const r = await ask("/runs", { experimentId: "e-m" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.run.executor).toBe("modal");
    expect(r.body.run.controlPassed).toBe(true);
    expect(r.body.verdicts.map((v: { outcome: string }) => v.outcome)).toEqual(["matched"]);
    expect(b.rec.specs.length).toBeGreaterThanOrEqual(2); // the control and the run, each in its own sandbox
    expect(b.rec.terminated).toHaveLength(b.rec.specs.length);
  });
});
