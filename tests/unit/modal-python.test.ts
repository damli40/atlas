// E4 + D24: hosted Python. When the executor is Modal, pasted Python runs in a Modal sandbox as
// `python3 -I -S -B boot.py`, as nobody, with no network and an empty env; the container takes the place of macOS
// sandbox-exec, and the harness's audit hook and in-process refusals are unchanged. Fake Modal backends only ($0);
// the live checks are in tests/unit/modal-live-py.test.ts.

import { beforeEach, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import type { Experiment, ExperimentShape } from "../../src/types.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import { MODAL_IMAGE, NOBODY, PYTHON_BIN, containerCommand, createModalExecutor } from "../../runners/executor/modal.ts";
import { findPython, pythonSandboxExecutor } from "../../runners/executor/sandbox-exec-python.ts";
import { PY_CALL_CONTROL_ID, pyControlFor, pyControlKey, pythonVersionFor, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { forgetReusableControls } from "../../runners/ts/call-runner.ts";
import { pythonExecutorFor, tsRunner } from "../../runners/ts/control.ts";
import { emulatingBackend, scriptedBackend } from "./modal-fakes.ts";

const HAS_PY = findPython() !== null;
type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const pyExperiment = (source: string, params: Partial<Call> & { exportName: string }): Experiment => {
  const target = makePastedTarget(source, "py");
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: exportedFunctionsFor(source, "py").map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
};

beforeEach(() => forgetReusableControls());

describe("the Python command in the container", () => {
  it("env -i, nobody with no new privileges, then python3 -s -P -S -B and the script: the macOS executor's flags", () => {
    expect(containerCommand({ files: {}, cmd: ["python3", "boot.py"], wallClockMs: 1000, allowNetwork: false })).toEqual([
      "/usr/bin/env",
      "-i",
      "/usr/bin/setpriv",
      `--reuid=${NOBODY}`,
      `--regid=${NOBODY}`,
      "--clear-groups",
      "--no-new-privs",
      PYTHON_BIN,
      "-s",
      "-P",
      "-S",
      "-B",
      "boot.py",
    ]);
  });

  it("the key goes on stdin only for Python too", async () => {
    const b = scriptedBackend();
    await createModalExecutor({ backend: b, log: () => {} }).exec({ files: { "boot.py": "x" }, cmd: ["python3", "boot.py"], stdin: "secret-key-123\n", wallClockMs: 1000, allowNetwork: false });
    expect(b.rec.stdins.filter((x) => x.includes("secret-key-123"))).toEqual(["secret-key-123\n"]);
    expect(JSON.stringify(b.rec.cmds)).not.toContain("secret-key-123");
  });
});

describe("which executor runs pasted Python", () => {
  it("Modal for Modal (never locally); macOS sandbox-exec for the local executor", () => {
    const ex = createModalExecutor({ backend: scriptedBackend(), log: () => {} });
    expect(pythonExecutorFor(ex)).toBe(ex);
    expect(pythonExecutorFor(localExecutor)).toBe(pythonSandboxExecutor);
  });

  it("D31 for Python: the key names the Python harness, the executor and the Python version", () => {
    const ex = createModalExecutor({ backend: scriptedBackend(), log: () => {} });
    expect(pythonVersionFor(ex)).toBe(MODAL_IMAGE.pythonVersion);
    expect(pyControlKey(ex)).not.toBe(pyControlKey(pythonSandboxExecutor));
    expect(pyControlKey({ ...ex, fingerprint: "modal v2 another-image" })).not.toBe(pyControlKey(ex));
  });
});

describe.skipIf(!HAS_PY)("end to end through the real Python harness (Modal plumbing emulated on this machine)", () => {
  it("the Python control passes on 'modal', is reused, and runs record the executor, the runtime and the Python version", async () => {
    const b = emulatingBackend();
    const ex = createModalExecutor({ backend: b, log: () => {} });
    const ctl = await pyControlFor({ executor: ex });
    expect(ctl.reason).toBeUndefined();
    expect(ctl.run).toMatchObject({ experimentId: PY_CALL_CONTROL_ID, executor: "modal", controlPassed: true });
    expect(ctl.run.trace.at(-1)?.data).toMatchObject({ language: "py", runtime: { executor: "modal", backend: "v2", python: MODAL_IMAGE.pythonVersion } });
    expect((await pyControlFor({ executor: ex })).run.id).toBe(ctl.run.id);
    expect(b.rec.specs).toHaveLength(1);

    const run = await tsRunner(ex).run(pyExperiment("def add(a, b):\n    return a + b\n", { exportName: "add", args: [{ kind: "json", value: 2 }, { kind: "json", value: 3 }] }), {});
    expect(run.executor).toBe("modal");
    expect(run.controlRunId).toBe(ctl.run.id);
    expect(run.result.measured).toMatchObject({ outcome: "returned", returnedJson: "5" });
    expect(run.trace.at(-1)?.data).toMatchObject({ language: "py", controlFinishedAt: ctl.run.finishedAt, runtime: { executor: "modal" } });
    expect(b.rec.cmds.some((c) => c.includes(PYTHON_BIN) && c.includes("-P") && c.includes("PYTHONHASHSEED=20260101") && c.includes("TZ=UTC") && c.includes("boot.py"))).toBe(true);
  });

  it("a Python control made locally is refused for a Modal run", async () => {
    const ctl = await pyControlFor({ executor: pythonSandboxExecutor });
    const ex = createModalExecutor({ backend: scriptedBackend(), log: () => {} });
    await expect(runPyCallExperiment(pyExperiment("def f():\n    return 1\n", { exportName: "f" }), ctl.run, { executor: ex })).rejects.toThrow(/ran on local, not on modal/);
  });
});
