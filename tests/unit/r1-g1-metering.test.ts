// R1 (D43) after G1: the double run's second sandbox is metered by G1's ledger like every other sandbox, on Modal
// (per-code daily starts and sandbox-seconds) and locally (local Python runs, which before went around the meter).

import { describe, expect, it } from "vitest";
import { runAs, type Principal } from "../../server/access/context";
import { openLedger } from "../../server/access/ledger";
import { meteredExecutor } from "../../server/access/metered";
import { openInviteStore } from "../../server/access/store";
import { localExecutor } from "../../runners/executor/local";
import { findPython, pythonRefusal, pythonSandboxExecutor } from "../../runners/executor/sandbox-exec-python";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner";
import { pythonExecutorFor } from "../../runners/ts/control";
import type { Executor } from "../../runners/runner";
import { gate } from "../../src/gate";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code";
import type { Experiment } from "../../src/types";
import { ENV, tmp } from "../tools/g1-fixtures";

const HAVE_PYTHON = pythonRefusal() === null && findPython() !== null;

function experiment(source: string, language: "js" | "py"): Experiment {
  const target = makePastedTarget(source, language);
  const g = gate({ shape: "call-function", exportName: "f", args: [] }, { exportNames: exportedFunctionsFor(source, language).map((e) => e.name) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: "m1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

function setup() {
  const dir = tmp();
  const store = openInviteStore(dir, { env: ENV });
  const inv = store.create({ label: "dev-twin" }).invite;
  const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
  const me: Principal = { kind: "invite", id: inv.id, label: inv.label, role: "dev", route: "test" };
  return { ledger, me };
}

describe("G1 meters both runs of a pasted test", () => {
  it("on Modal: one pasted JavaScript test is two sandbox starts (the control, reused, is one more)", async () => {
    const { ledger, me } = setup();
    // The local sandbox, presented to the ledger as Modal so its starts and seconds are counted the Modal way.
    const asModal: Executor = { kind: "modal", fingerprint: "test modal", exec: (req) => localExecutor.exec(req) };
    const ex = meteredExecutor(asModal, ledger);
    const ctl = await runAs(me, () => runCallControl({ executor: ex }));
    const afterControl = ledger.modalToday().starts;
    expect(afterControl).toBe(1);
    const r = await runAs(me, () => runCallExperiment(experiment("export const f = () => 1;", "js"), ctl.run, { executor: ex }));
    expect(r.twin).toBeDefined();
    expect(ledger.modalToday().starts - afterControl).toBe(2);
  });

  it("locally: the metered executor carries a metered Python executor, and pythonExecutorFor uses it", () => {
    const { ledger } = setup();
    const ex = meteredExecutor<Executor>({ kind: "local", exec: localExecutor.exec }, ledger, pythonSandboxExecutor);
    expect(ex.python).toBeDefined();
    expect(pythonExecutorFor(ex)).toBe(ex.python);
    expect(pythonExecutorFor({ kind: "local", exec: localExecutor.exec })).toBe(pythonSandboxExecutor); // unmetered callers unchanged
  });

  it.skipIf(!HAVE_PYTHON)("locally: a Python run with no invite code is refused by the ledger (before G1+R1 it went around it)", async () => {
    const { ledger, me } = setup();
    const ex = meteredExecutor<Executor>({ kind: "local", exec: localExecutor.exec }, ledger, pythonSandboxExecutor);
    const py = pythonExecutorFor(ex);
    const ctl = await runAs(me, () => runPyCallControl({ executor: py }));
    expect(ctl.run.controlPassed).toBe(true);
    await expect(runPyCallExperiment(experiment("def f():\n    return 1\n", "py"), ctl.run, { executor: py })).rejects.toThrow(/no invite code/);
    const ok = await runAs(me, () => runPyCallExperiment(experiment("def f():\n    return 1\n", "py"), ctl.run, { executor: py }));
    expect(ok.result.measured.returnedJson).toBe("1");
    expect(ok.twin).toBeDefined();
  });
});
