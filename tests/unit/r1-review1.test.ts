// R1 review round 1: the double run (B1, B2), the host condition (B1), "timed its own work" decided from the code's own
// clock reads (M1-M3), nextTick disclosed (M3), explicit locales and the code's own random.seed (M3), the pins told to
// every bettor (M5), "not known" for a run that did not finish (M6), and refusing a relabelled newer run (m1).

import { describe, expect, it, beforeAll } from "vitest";
import { gate } from "../../src/gate.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { CHANGED_BETWEEN_RUNS_REASON, callRunPinProblems, mergeTwin } from "../../src/conditions.ts";
import { CONDITION_WORDS } from "../../src/paste-words.ts";
import { pastedBetHead } from "../../src/paste-context.ts";
import { runCallControl, runCallExperiment, twinRun } from "../../runners/ts/call-runner.ts";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { findPython, pythonRefusal } from "../../runners/executor/sandbox-exec-python.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import type { Executor } from "../../runners/runner.ts";
import type { ArgSpec, Experiment, ExperimentShape, Run } from "../../src/types.ts";

const HAVE_PYTHON = pythonRefusal() === null && findPython() !== null;
type Call = Extract<ExperimentShape, { shape: "call-function" }>;
function experiment(source: string, language: "js" | "py", exportName: string, args: ArgSpec[] = []): Experiment {
  const target = makePastedTarget(source, language);
  const params: Call = { shape: "call-function", exportName, args };
  const g = gate(params, { exportNames: exportedFunctionsFor(source, language).map((e) => e.name).concat(exportName) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: `rv-${exportName}`, target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}
let js: Run;
let py: Run | null = null;
beforeAll(async () => {
  js = (await runCallControl()).run;
  if (HAVE_PYTHON) py = (await runPyCallControl()).run;
}, 60_000);
const run = (src: string, lang: "js" | "py", name: string, opts: { executor?: Executor } = {}) =>
  lang === "py" ? runPyCallExperiment(experiment(src, "py", name), py!, opts) : runCallExperiment(experiment(src, "js", name), js, opts);
const kinds = (r: Run) => (r.conditions ?? []).map((c) => c.kind);

describe("mergeTwin (plain code)", () => {
  it("keeps a field both runs measured the same; hides one that differs; a different outcome hides the whole ending", () => {
    const a = { measured: { outcome: "returned", virtualMs: 0, returnedJson: "1", "calls:x": 2 }, notMeasured: { thrownName: "n/a" } };
    const m = mergeTwin(a, { measured: { outcome: "returned", virtualMs: 0, returnedJson: "2", "calls:x": 2 }, notMeasured: {} });
    expect(m.changed).toEqual(["returnedJson"]);
    expect(m.result.measured).toEqual({ outcome: "returned", virtualMs: 0, "calls:x": 2 });
    expect(m.result.notMeasured.returnedJson).toBe(CHANGED_BETWEEN_RUNS_REASON);
    const e = mergeTwin(a, { measured: { outcome: "threw", virtualMs: 0, thrownName: "E", "calls:x": 2 }, notMeasured: {} });
    expect(e.endingChanged).toBe(true);
    expect(Object.keys(e.result.measured)).toEqual(["calls:x"]);
    expect(e.result.notMeasured.thrownName).toBe(CHANGED_BETWEEN_RUNS_REASON);
  });
  it("a second run that does not finish makes the whole run can't check, with why", async () => {
    const out = await twinRun({ trace: [], result: { measured: { outcome: "returned" }, notMeasured: {} } }, async () => ({ reason: "the sandbox exited" }));
    expect(out.result.measured).toEqual({});
    expect(out.result.notMeasured.wholeRun).toMatch(/second, identical run of this test did not finish \(the sandbox exited\)/);
    expect(out.twin).toBeUndefined();
  });
});

describe("the double run catches values that change between identical runs (B1, B2)", () => {
  for (const [what, src] of [
    ["process.pid", "export const f = () => process.pid;"],
    ["process.cwd()", "export const f = () => process.cwd();"],
    ["an error's stack (temp-folder paths)", "export const f = () => new Error('x').stack.split('\\n').slice(0, 2).join('|');"],
    ["process.memoryUsage().heapUsed", "export const f = () => process.memoryUsage().heapUsed;"],
  ] as const) {
    it(`JavaScript: ${what} is not reported; the outcome still is; the twin is kept`, async () => {
      const r = await run(src, "js", "f");
      expect(r.result.measured.outcome).toBe("returned");
      expect(r.result.measured.returnedJson).toBeUndefined();
      expect(r.result.notMeasured.returnedJson).toBe(CHANGED_BETWEEN_RUNS_REASON);
      expect(kinds(r)).toEqual(expect.arrayContaining(["changed-between-runs", "host"]));
      expect(r.conditions?.find((c) => c.kind === "changed-between-runs")?.says).toContain("returnedJson");
      expect(r.twin?.result.measured.returnedJson).toBeDefined();
    });
  }
  const pyCases = [
    ["a set of plain objects (ordered by memory address; the second run starts with another heap layout)", "class A:\n    def __init__(s, n):\n        s.n = n\n\ndef f():\n    return [a.n for a in set(A(i) for i in range(40))]\n"],
    ["a default repr in an f-string", "class User:\n    pass\n\ndef f():\n    return f'created {User()}'\n"],
    ["id()", "def f():\n    return id(object()) % 1000\n"],
    ["os.getpid()", "import os\n\ndef f():\n    return os.getpid()\n"],
  ] as const;
  for (const [what, src] of pyCases) {
    it.skipIf(!HAVE_PYTHON)(`Python: ${what} is not reported`, async () => {
      for (let i = 0; i < 3; i++) {
        const r = await run(src, "py", "f");
        expect(r.result.measured.outcome).toBe("returned");
        expect(r.result.measured.returnedJson, `try ${i}`).toBeUndefined();
        expect(kinds(r)).toContain("changed-between-runs");
      }
    });
  }
  it.skipIf(!HAVE_PYTHON)("Python: uuid.uuid1 (the real clock and a network address) is refused", async () => {
    const r = await run("import uuid\n\ndef f():\n    return str(uuid.uuid1())\n", "py", "f");
    expect(r.result.notMeasured.wholeRun).toMatch(/uuid\.uuid1/);
  });
  it.skipIf(!HAVE_PYTHON)("Python: a set of text stays measured (the hash seed is pinned), and its wording names text, not objects", async () => {
    const r = await run("def f():\n    return list({'apple', 'banana', 'cherry'})\n", "py", "f");
    expect(r.result.measured.returnedJson).toBeDefined();
    expect(r.conditions?.find((c) => c.kind === "hash-seed")?.says).toMatch(/text or bytes.*A set of objects is ordered by memory addresses/);
  });
});

describe("proof files carry and verify the twin", () => {
  it("verify catches a twin edited to agree, or a reported field the twin measured differently", async () => {
    const r = await run("export const f = () => [process.pid, 1];", "js", "f");
    expect(callRunPinProblems(r, "js")).toEqual([]);
    const forged = JSON.parse(JSON.stringify(r)) as Run;
    forged.result.measured.returnedJson = "[1,1]";
    delete forged.result.notMeasured.returnedJson;
    expect(callRunPinProblems(forged, "js").join("; ")).toMatch(/second run measured it differently|changed between the two runs, but the run does not say so/);
    const noTwin = JSON.parse(JSON.stringify(r)) as Run;
    delete noTwin.twin;
    noTwin.startedAt = "2026-11-01T00:00:00.000Z";
    expect(callRunPinProblems(noTwin, "js").join("; ")).toMatch(/no second run/);
  });
});

describe("the host condition names what was read", () => {
  it("JavaScript: process.platform is measured, same both runs, and the sentence names it", async () => {
    const r = await run("export const f = () => process.platform;", "js", "f");
    expect(r.result.measured.returnedJson).toBe(JSON.stringify(process.platform));
    expect(r.conditions?.find((c) => c.kind === "host")?.says).toContain("process.platform");
  });
  it.skipIf(!HAVE_PYTHON)("Python: sys.platform (read from the code) is named", async () => {
    const r = await run("import sys\n\ndef f():\n    return sys.platform\n", "py", "f");
    expect(r.result.measured.returnedJson).toBeDefined();
    expect(r.conditions?.find((c) => c.kind === "host")?.says).toContain("sys.platform");
  });
});

describe("words", () => {
  it("M5: every bettor is told the pins before sealing", () => {
    const exp = experiment("export const f = () => 1;", "js", "f");
    const head = pastedBetHead({ experiment: exp, questions: [] } as unknown as Parameters<typeof pastedBetHead>[0]);
    expect(head).toContain("Atlas runs it on a simulated clock starting 2026-01-01 UTC, in time zone UTC with an en-US locale, with randomness seeded (seed 20260101).");
    const p = experiment("def f():\n    return 1\n", "py", "f");
    expect(pastedBetHead({ experiment: p, questions: [] } as unknown as Parameters<typeof pastedBetHead>[0])).toContain("with a C locale");
  });
  it("B1 / M6: 'None' says only what Atlas looked for; a run that did not finish is 'not known'", async () => {
    expect(CONDITION_WORDS.none).not.toMatch(/the code read no/);
    expect(CONDITION_WORDS.none).toMatch(/second time/);
    const r = await run("export function f(){ return fetch('http://x'); }", "js", "f");
    expect(r.result.notMeasured.wholeRun).toBeDefined();
    expect(r.conditions).toEqual([]);
    expect(CONDITION_WORDS.notKnown).toMatch(/did not finish/);
  });
  it("a second run is made on the same executor (two sandboxes per pasted test)", async () => {
    let n = 0;
    const counting: Executor = { ...localExecutor, exec: (req) => (n++, localExecutor.exec(req)) };
    await runCallExperiment(experiment("export const f = () => 1;", "js", "f"), js, { executor: counting });
    expect(n).toBe(2);
  });
});
