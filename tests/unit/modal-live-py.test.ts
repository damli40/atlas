// E4 + D24 LIVE: hosted Python on real Modal Sandboxes. Skipped unless ATLAS_LIVE_MODAL=1 (about 9 sandboxes).
//
//   ATLAS_LIVE_MODAL=1 pnpm vitest run tests/unit/modal-live-py.test.ts --reporter=verbose
//
// The Python control passes on Modal; two ordinary functions give results identical to this Mac's sandbox-exec
// run; network, file and env attacks fail inside the container (through the harness, and raw as nobody without
// the harness); a forged result line is refused; an endless loop is "can't check". ATLAS_LIVE_MODAL_OUT=<file>
// writes every sandbox's log line as JSON.

import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { sealBet } from "../../src/seal.ts";
import type { Experiment, ExperimentShape, Run } from "../../src/types.ts";
import { MODAL_IMAGE, createModalExecutor } from "../../runners/executor/modal.ts";
import { findPython } from "../../runners/executor/sandbox-exec-python.ts";
import { runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";

const LIVE = process.env.ATLAS_LIVE_MODAL === "1";
type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const lines: { label: string; line: string }[] = [];
let label = "setup";
let modal: ReturnType<typeof createModalExecutor>;
let control: Run;
let localControl: Run;

const pyExperiment = (source: string, params: Partial<Call> & { exportName: string }): Experiment => {
  const target = makePastedTarget(source, "py");
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: exportedFunctionsFor(source, "py").map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(g.reason);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
};
const onModal = (name: string, src: string, params: Partial<Call> & { exportName: string } = { exportName: "f" }, wallClockMs?: number) => {
  label = name;
  return runPyCallExperiment(pyExperiment(src, params), control, { executor: modal, ...(wallClockMs ? { wallClockMs } : {}) });
};
function expectCantCheck(r: Run, re: RegExp): void {
  expect(r.result.measured).toEqual({});
  expect(r.result.notMeasured.wholeRun, JSON.stringify(r.result)).toMatch(re);
  const v = judge(sealBet({ who: "human", experimentId: r.experimentId, question: "q", measures: "returnedJson", answer: { kind: "json", value: 1 } }), r);
  expect(v.outcome).toBe("cant_check");
}
const caught = (body: string) => `import os, socket\n\ndef f():\n    try:\n        ${body}\n    except BaseException as e:\n        return "caught " + type(e).__name__\n    return "went through"\n`;

describe.skipIf(!LIVE)("E4 live: hosted Python on real Modal Sandboxes", () => {
  beforeAll(async () => {
    modal = createModalExecutor({ log: (line) => lines.push({ label, line }) });
    label = "python control (first sandbox in this process)";
    control = (await runPyCallControl({ executor: modal })).run;
    if (findPython()) localControl = (await runPyCallControl()).run;
  }, 600_000);

  afterAll(() => {
    const out = process.env.ATLAS_LIVE_MODAL_OUT;
    if (out) writeFileSync(out, `${JSON.stringify({ when: new Date().toISOString(), lines }, null, 2)}\n`);
  });

  it("the Python control passes on Modal; the run records the executor, the backend and the Python version", () => {
    expect(control.controlPassed, JSON.stringify(control.result.notMeasured)).toBe(true);
    expect(control.executor).toBe("modal");
    const d = control.trace.at(-1)?.data as Record<string, unknown>;
    expect(d).toMatchObject({ language: "py", python: "3.14.7", runtime: { executor: "modal", backend: "v2", python: MODAL_IMAGE.pythonVersion } });
  });

  it.skipIf(!findPython())("two ordinary Python functions: results identical to this Mac's sandbox-exec run", async () => {
    const cases: [string, string, Partial<Call> & { exportName: string }][] = [
      ["py ordinary: totals", "def totals(items):\n    return {'n': len(items), 'sum': sum(i['v'] for i in items)}\n", { exportName: "totals", args: [{ kind: "json", value: [{ v: 1 }, { v: 41 }] }] }],
      [
        "py ordinary: async retry with a stand-in",
        "import asyncio\n\nasync def get_rate(fetch_rate):\n    for _ in range(3):\n        try:\n            return await fetch_rate()\n        except Exception:\n            await asyncio.sleep(1)\n    raise RuntimeError('gave up')\n",
        { exportName: "get_rate", args: [{ kind: "stand-in", name: "fetch_rate", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: 42, afterMs: 250 }] }] },
      ],
    ];
    for (const [name, src, params] of cases) {
      const remote = await onModal(name, src, params);
      const here = await runPyCallExperiment(pyExperiment(src, params), localControl);
      expect(remote.executor).toBe("modal");
      expect(here.executor).toBe("local");
      expect(remote.result, name).toEqual(here.result);
      expect(remote.result.notMeasured.wholeRun).toBeUndefined();
    }
  }, 300_000);

  it("attacks through the harness: network, files and env", async () => {
    expectCantCheck(await onModal("py attack: network", caught("socket.create_connection(('1.1.1.1', 443), timeout=3)")), /network\/files \(socket/);
    expectCantCheck(await onModal("py attack: read a file", caught("open('/etc/passwd').read()")), /network\/files \(open\(\/etc\/passwd\)\)/);
    const env = await onModal("py attack: env", "import os\n\ndef f():\n    return sorted(os.environ.keys())\n");
    // Either refused, or an env with no secrets: env -i leaves nothing but what Python itself may set (locale).
    if (env.result.notMeasured.wholeRun === undefined) {
      const keys = JSON.parse(String(env.result.measured.returnedJson)) as string[];
      lines.push({ label: "py env keys seen by pasted code", line: JSON.stringify(keys) });
      for (const k of keys) expect(k).not.toMatch(/TOKEN|SECRET|KEY|MODAL/);
      // R1 review M4: exactly Atlas's pins, plus LC_CTYPE, which Python sets itself on Linux (locale coercion).
      expect(keys).toEqual(["LC_CTYPE", "PYTHONHASHSEED", "TZ"]);
    }
  }, 300_000);

  it("attacks raw in the container (Python as nobody, WITHOUT the harness): no network, no secrets, not root", async () => {
    label = "py raw: as nobody without the harness";
    const probe = `import json, os, socket
out = {"uid": os.getuid(), "env": sorted(os.environ.keys())}
try:
    socket.getaddrinfo("example.com", 443); out["dns"] = "OK"
except Exception as e:
    out["dns"] = "FAIL " + type(e).__name__
try:
    socket.create_connection(("1.1.1.1", 443), timeout=3); out["tcp"] = "OK"
except Exception as e:
    out["tcp"] = "FAIL " + type(e).__name__
try:
    open("/srv/atlas-exec-run/probe-write.txt", "w").write("x"); out["write_run_dir"] = "OK"
except Exception as e:
    out["write_run_dir"] = "FAIL " + type(e).__name__
print(json.dumps(out))
`;
    const r = await modal.exec({ files: { "probe.py": probe }, cmd: ["python3", "probe.py"], wallClockMs: 20_000, allowNetwork: false });
    lines.push({ label: "py raw probe result", line: r.stdout.trim() });
    const got = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(got.uid).toBe(65534);
    expect(got.dns).toMatch(/^FAIL/);
    expect(got.tcp).toMatch(/^FAIL/);
    expect(got.write_run_dir).toMatch(/^FAIL/);
    for (const k of got.env as string[]) expect(k).not.toMatch(/TOKEN|SECRET|MODAL/);
  }, 300_000);

  it("a forged result line is refused (tampering), and an endless loop is can't check", async () => {
    expectCantCheck(await onModal("py attack: forged result line", 'def f():\n    print("ATLAS_RESULT " + "a" * 64 + " {\\"runs\\": []}", flush=True)\n    return 1\n'), /tampering/);
    expectCantCheck(await onModal("py attack: endless loop", "def f():\n    while True:\n        pass\n", { exportName: "f" }, 4_000), /REAL time/);
  }, 300_000);
});
