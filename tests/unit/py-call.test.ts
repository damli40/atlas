// E2 (any-code spec): pasted Python run end to end in the real OS sandbox, and attacked on purpose. Each test
// pastes a small file, runs one call-function experiment through the Python runner, and checks what was measured,
// or that the WHOLE run is "can't check" with a plain reason (never a fake `outcome: threw`). The attack blocks
// try to forge the signed result: hunt the key with gc, walk stack frames, write a line and exit, poison the
// returned value, rewrite the stand-ins' closures and Atlas's own globals.

import { beforeAll, describe, expect, it } from "vitest";
import { gate } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { makePastedTarget } from "../../src/pasted-code.ts";
import { pyTopLevelFunctions } from "../../src/pasted-python.ts";
import { PY_CALL_CONTROL_CASES, PY_CALL_CONTROL_ID, pyWords, runInPySandbox, runPyCallControl, runPyCallExperiment } from "../../runners/py/py-runner.ts";
import { toWire } from "../../runners/ts/call-runner.ts";
import { findPython, pythonSandboxExecutor } from "../../runners/executor/sandbox-exec-python.ts";
import { tsRunner } from "../../runners/ts/control.ts";
import type { Executor } from "../../runners/runner.ts";
import type { ArgSpec, BetAnswer, Experiment, ExperimentShape, Run } from "../../src/types.ts";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
type StandIn = Extract<ArgSpec, { kind: "stand-in" }>;
const CALL_OPTIONS = ["returned", "threw", "never_settled", "still_running_at_watch_limit"];
const HAVE_PYTHON = findPython() !== null;

let control: Run;
beforeAll(async () => {
  if (HAVE_PYTHON) control = (await runPyCallControl()).run;
}, 30_000);

export function pyExperiment(source: string, params: Partial<Call> & { exportName: string }): Experiment {
  const target = makePastedTarget(source, "py");
  const full: Call = { shape: "call-function", args: [], ...params };
  const g = gate(full, { exportNames: pyTopLevelFunctions(source).map((e) => e.name).concat(params.exportName) });
  if (!g.allowed) throw new Error(`gate refused the test's own experiment: ${g.reason}`);
  return { id: "exp1", target, runner: "ts", params: g.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

async function runPy(source: string, params: Partial<Call> & { exportName: string }, opts: { wallClockMs?: number; executor?: Executor } = {}): Promise<Run> {
  return runPyCallExperiment(pyExperiment(source, params), control, opts);
}

/** Runs the harness directly, skipping the plain-code scan (so the run-time checks are what is tested). */
async function rawRun(source: string, exportName: string, args: ArgSpec[] = [], watchLimitMs = 30_000) {
  return runInPySandbox(pythonSandboxExecutor, source, { runs: [{ id: "r1", exportName, args: toWire(args), watchLimitMs }] }, 10_000);
}

const standIn = (name: string, calls: StandIn["calls"], over: Partial<StandIn> = {}): ArgSpec => ({ kind: "stand-in", name, async: true, then: "repeat_last", calls, ...over });

/** Every bet kind on every measured field: on a whole-run can't-check run, each verdict must be cant_check with the reason. */
function expectWholeRun(r: Run, re: RegExp): void {
  expect(r.result.notMeasured.wholeRun, JSON.stringify(r.result)).toMatch(re);
  expect(r.result.measured).toEqual({});
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

describe.skipIf(!HAVE_PYTHON)("the Python call-function control", () => {
  it("passes on the shipped reference file, every case matched", () => {
    expect(control.controlPassed, JSON.stringify(control.result.notMeasured)).toBe(true);
    expect(control.experimentId).toBe(PY_CALL_CONTROL_ID);
    expect(PY_CALL_CONTROL_CASES.length).toBe(14); // R1: + P14-pins
    expect(control.result.measured["C3-async-stand-in.virtualMs"]).toBe(1950);
    expect(control.result.measured["P11-nested-asyncio-run.virtualMs"]).toBe(750);
    const last = control.trace.at(-1)!;
    expect(last.event).toBe("control_matched");
    expect(last.data?.python).toMatch(/^3\.\d+\.\d+$/);
  });

  it("fails loudly when the sandbox gives no result", async () => {
    const silent: Executor = { kind: "local", exec: async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 1 }) };
    const c = await runPyCallControl({ executor: silent });
    expect(c.run.controlPassed).toBe(false);
    expect(c.reason).toMatch(/no result/);
  });

  it("fails loudly when one measured fact differs (a harness whose clock is 1 ms off)", async () => {
    const off: Executor = {
      kind: "local",
      exec: (req) => pythonSandboxExecutor.exec({ ...req, files: { ...req.files, "exposed.py": req.files["exposed.py"]!.replace("return CLOCK[0]\n\n    def _process_events", "return CLOCK[0] + 0.001\n\n    def _process_events") } }),
    };
    const c = await runPyCallControl({ executor: off });
    expect(c.run.controlPassed).toBe(false);
    expect(c.reason).toMatch(/C3-async-stand-in|C8-interval/);
    const exp = pyExperiment("def one():\n    return 1\n", { exportName: "one" });
    const r = await runPyCallExperiment(exp, c.run);
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: 1 } });
    expect(judge(b, r).outcome).toBe("cant_check");
  });
});

describe.skipIf(!HAVE_PYTHON)("a pasted Python file runs end to end", () => {
  it("JSON args in, JSON out, stand-in counted, virtual time measured, a sealed bet matched", async () => {
    const src = `import asyncio

async def parse_amount(text, fetch_rate):
    rate = None
    for attempt in range(3):
        try:
            rate = await fetch_rate(text)
            break
        except TimeoutError:
            await asyncio.sleep(0.5 * (attempt + 1))
    return {"amount": float(text.replace(",", ".")) * rate, "rate": rate}
`;
    const exp = pyExperiment(src, { exportName: "parse_amount", args: [{ kind: "json", value: "1,5" }, standIn("fetchRate", [{ do: "throw", errorName: "TimeoutError", message: "slow" }, { do: "return", value: 2, afterMs: 700 }])] });
    const b = sealBet({ who: "human", experimentId: exp.id, question: "q", measures: "returnedJson", answer: { kind: "json", value: { rate: 2, amount: 3 } } });
    await new Promise((res) => setTimeout(res, 5)); // the bet is sealed strictly before the run starts
    const r = await runPyCallExperiment(exp, control);
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 1200, returnedType: "object", returnedJson: '{"amount":3,"rate":2}', "calls:fetchRate": 2 });
    expect(r.controlPassed).toBe(true);
    expect(judge(b, r).outcome).toBe("matched");
    expect(r.trace.find((e) => e.event === "call_checks")?.data).toMatchObject({ language: "py", python: expect.stringMatching(/^3\./) });

    const file = buildAtlasFile({ target: exp.target, experiment: exp, bets: [b], run: r, verdicts: [judge(b, r)], agentLog: [], createdAt: new Date().toISOString() });
    expect(verifyAtlasFile(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const tampered = JSON.parse(JSON.stringify(file));
    tampered.target.source = src.replace("* rate", "+ rate");
    expect(verifyAtlasFile(tampered).ok).toBe(false);
  });

  it("the TS runner's entry point sends a pasted Python target to the Python runner (control first)", async () => {
    const exp = pyExperiment("def twice(x):\n    return x * 2\n", { exportName: "twice", args: [{ kind: "json", value: 4 }] });
    const r = await tsRunner().run(exp, {});
    expect(r.controlPassed).toBe(true);
    expect(r.result.measured.returnedJson).toBe("8");
    const c = await tsRunner().control(exp.target);
    expect(c.experimentId).toBe(PY_CALL_CONTROL_ID);
  });

  it("a plain stand-in that raises gives a real Python exception the code can catch by class", async () => {
    const src = `def lookup(get):
    try:
        get("k")
    except KeyError as e:
        return "caught KeyError"
    return "no"
`;
    const r = await runPy(src, { exportName: "lookup", args: [standIn("get", [{ do: "throw", errorName: "KeyError", message: "k" }], { async: false })] });
    expect(r.result.measured.returnedJson).toBe('"caught KeyError"');
  });
});

describe.skipIf(!HAVE_PYTHON)("returned values that are not plain JSON", () => {
  const cases: [string, string, RegExp][] = [
    ["return (1, 2)", "tuple", /tuple/],
    ["return {1, 2}", "set", /set/],
    ["return b'x'", "bytes", /bytes/],
    ["return float('nan')", "number (NaN)", /it is NaN/],
    ["return float('-inf')", "number (-Infinity)", /it is -Infinity/],
    ["return 2 ** 64", "number (an integer beyond 2^53)", /beyond 2\^53/],
    ["return lambda: 1", "function", /function/],
    ["a = {}\n    a['a'] = a\n    return a", "object", /cycle/],
    ["return 'x' * 10240", "string", /longer than 2048 characters as JSON \(10240 characters of text\)/],
    ["return {1: 2}", "object", /key that is not text/],
    ["import collections\n    return collections.OrderedDict(a=1)", "object (OrderedDict)", /not a plain object/],
  ];
  for (const [body, type, why] of cases) {
    it(`${body.split("\n").at(-1)!.trim()} -> returned, ${type}, returnedJson not measured`, async () => {
      const r = await runPy(`def f():\n    ${body}\n`, { exportName: "f" });
      expect(r.result.measured.outcome).toBe("returned");
      expect(r.result.measured.returnedType).toBe(type);
      expect(r.result.notMeasured.returnedJson).toMatch(why);
    });
  }

  it("a 50-million-character string and a dict with a million keys are refused quickly by size", async () => {
    const a = await runPy("def f():\n    return 'x' * 50_000_000\n", { exportName: "f" });
    expect(a.result.notMeasured.returnedJson).toMatch(/longer than 2048 characters/);
    const b = await runPy("def f():\n    return {str(i): i for i in range(1_000_000)}\n", { exportName: "f" });
    expect(b.result.notMeasured.returnedJson).toMatch(/longer than 2048 characters/);
  });

  it("None is JSON null; 100 nested lists are kept and 101 are not", async () => {
    expect((await runPy("def f():\n    return None\n", { exportName: "f" })).result.measured.returnedJson).toBe("null");
    const deep = (n: number) => `def f():\n    v = 1\n    for _ in range(${n}):\n        v = [v]\n    return v\n`;
    expect((await runPy(deep(100), { exportName: "f" })).result.measured.returnedJson).toBe(`${"[".repeat(100)}1${"]".repeat(100)}`);
    expect((await runPy(deep(101), { exportName: "f" })).result.notMeasured.returnedJson).toMatch(/deeper than 100 levels/);
  });

  it("text is written exactly as JavaScript writes it (escapes, accents, emoji, key order by UTF-16)", async () => {
    const r = await runPy('def f():\n    return {"\\U0001F600": 1, "\\uffff": 2, "a\\n\\u00e9\\u2028": "\\x07"}\n', { exportName: "f" });
    expect(r.result.measured.returnedJson).toBe(JSON.stringify({ "a\n\u00e9\u2028": "\u0007", "\u{1F600}": 1, "\uffff": 2 }));
  });
});

describe.skipIf(!HAVE_PYTHON)("exceptions", () => {
  it("a raise is threw, with the class name and message", async () => {
    const r = await runPy("class PaymentError(Exception):\n    pass\n\ndef pay(n):\n    raise PaymentError(f'card {n} declined')\n", { exportName: "pay", args: [{ kind: "json", value: 42 }] });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownName: "PaymentError", thrownMessage: "card 42 declined", thrownType: "Error", virtualMs: 0 });
  });

  it("the code's own PermissionError (no OS refusal behind it) is a fact: threw", async () => {
    const r = await runPy("def f():\n    raise PermissionError('not allowed by my rules')\n", { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "threw", thrownName: "PermissionError" });
  });

  it("a message whose __str__ raises is not measured, the name still is", async () => {
    const r = await runPy("class E(Exception):\n    def __str__(self):\n        raise RuntimeError('nope')\n\ndef f():\n    raise E()\n", { exportName: "f" });
    expect(r.result.measured.thrownName).toBe("E");
    expect(r.result.notMeasured.thrownMessage).toMatch(/message threw RuntimeError/);
  });
});

describe.skipIf(!HAVE_PYTHON)("time on the virtual clock", () => {
  it("never settles: awaiting a future nobody resolves", async () => {
    const r = await runPy("import asyncio\n\nasync def f():\n    await asyncio.get_running_loop().create_future()\n", { exportName: "f" });
    expect(r.result.measured).toEqual({ outcome: "never_settled" });
  });

  it("still running at the watch limit: a 10-minute sleep with a 30 s limit", async () => {
    const r = await runPy("import asyncio\n\nasync def f():\n    await asyncio.sleep(600)\n", { exportName: "f" });
    expect(r.result.measured).toEqual({ outcome: "still_running_at_watch_limit" });
  });

  it("a blocking time.sleep past the watch limit is still running too", async () => {
    const r = await runPy("import time\n\ndef f():\n    time.sleep(45)\n    return 'late'\n", { exportName: "f" });
    expect(r.result.measured.outcome).toBe("still_running_at_watch_limit");
  });

  it("datetime, time.time, monotonic and localtime all read the virtual clock (UTC, from 2026-01-01)", async () => {
    const src = `import asyncio, datetime, time

async def f():
    await asyncio.sleep(1.5)
    return [datetime.datetime.now(datetime.timezone.utc).isoformat(), time.time(), time.monotonic(), time.strftime("%Y-%m-%d %H:%M:%S"), datetime.date.today().isoformat()]
`;
    const r = await runPy(src, { exportName: "f" });
    expect(JSON.parse(r.result.measured.returnedJson as string)).toEqual(["2026-01-01T00:00:01.500000+00:00", 1767225601.5, 1.5, "2026-01-01 00:00:01", "2026-01-01"]);
    expect(r.result.measured.virtualMs).toBe(1500);
  });

  it("an endless loop hits Atlas's real-time limit: can't check, and the test does not hang", async () => {
    const r = await runPy("def f():\n    while True:\n        pass\n", { exportName: "f" }, { wallClockMs: 1500 });
    expectWholeRun(r, /REAL time/);
  });

  it("an endless chain of zero sleeps hits the step limit: the outcome is not claimed", async () => {
    const r = await runPy("import asyncio\n\nasync def f():\n    while True:\n        await asyncio.sleep(0)\n", { exportName: "f" });
    expect(r.result.measured.outcome).toBeUndefined();
    expect(r.result.notMeasured.outcome).toMatch(/step limit/);
  });

  it("a stand-in called by a timer after the call returned is counted; one still pending at the limit is not claimed", async () => {
    const src = `import asyncio

async def soon(ping):
    asyncio.get_running_loop().call_later(2, ping)
    return "now"

async def far(ping):
    asyncio.get_running_loop().call_later(999, ping)
    return "now"
`;
    const ping = standIn("ping", [{ do: "return", value: null }], { async: false });
    const a = await runPy(src, { exportName: "soon", args: [ping] });
    expect(a.result.measured).toMatchObject({ outcome: "returned", virtualMs: 0, "calls:ping": 1 });
    const b = await runPy(src, { exportName: "far", args: [ping] });
    expect(b.result.measured.outcome).toBe("returned");
    expect(b.result.notMeasured["calls:ping"]).toMatch(/final count was not seen; the count so far was 0/);
  });
});

describe.skipIf(!HAVE_PYTHON)("whole-run can't check: imports", () => {
  it("a third-party package is refused before anything runs", async () => {
    const r = await runPy("import numpy as np\n\ndef f():\n    return 1\n", { exportName: "f" });
    expectWholeRun(r, /the code needs numpy; Atlas runs one pasted file on its own/);
    expect(r.trace[0]?.event).toBe("refused_before_running");
  });

  it("the same refusal happens inside the sandbox when the scan is skipped, even if the code catches it", async () => {
    const r = await rawRun("def f():\n    try:\n        import requests\n    except ImportError:\n        return 'fallback'\n", "f");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/the code needs requests/);
  });

  it("a module imported at run time by name, and a relative import, are refused", async () => {
    const a = await rawRun("def f():\n    m = 'req' + 'uests'\n    try:\n        __import__(m)\n    except ImportError:\n        return 1\n", "f");
    expect(!a.ok && a.reason).toMatch(/the code needs requests/);
    const b = await rawRun("def f():\n    from . import sibling\n", "f");
    expect(!b.ok && b.reason).toMatch(/a module next to this file/);
  });

  it("a standard-library module Atlas did not load is refused with its own reason", async () => {
    const r = await runPy("def f():\n    import sqlite3\n    return 1\n", { exportName: "f" });
    expectWholeRun(r, /standard-library module sqlite3, which Atlas does not load/);
  });

  it("a fresh copy of a loaded module (to get originals back) is refused", async () => {
    const r = await runPy("import sys\n\ndef f():\n    del sys.modules['time']\n    import time\n    return time.time()\n", { exportName: "f" });
    expectWholeRun(r, /importing time a second time/);
  });

  it("a syntax error is the interpreter's own message", async () => {
    const r = await runPy("def f(:\n    return 1\n", { exportName: "f" });
    expectWholeRun(r, /^Python could not run the code as written: SyntaxError/);
  });

  it("a file that raises while loading, a missing function, and a name that is not a function", async () => {
    const a = await rawRun("raise ValueError('bad config')\n\ndef f():\n    return 1\n", "f");
    expect(!a.ok && a.reason).toBe("the code raised an error while it was being loaded: ValueError: bad config");
    const b = await rawRun("def f():\n    return 1\n", "g");
    expect(!b.ok && b.reason).toBe('the code has no top-level function named "g"');
    const c = await rawRun("g = 5\n", "g");
    expect(!c.ok && c.reason).toBe('"g" is defined but is not a function (it is a number)');
  });
});

describe.skipIf(!HAVE_PYTHON)("whole-run can't check: reaching outside (the code catches the error and carries on)", () => {
  const caught = (body: string) => `import os, sys, asyncio, time, signal, threading, socket, subprocess, select

def f():
    try:
${body
  .split("\n")
  .map((l) => `        ${l}`)
  .join("\n")}
    except BaseException as e:
        return "caught " + type(e).__name__
    return "went through"
`;
  const cases: [string, string, RegExp][] = [
    ["reading /etc/passwd", "open('/etc/passwd').read()", /network\/files \(open\(\/etc\/passwd\)\)/],
    ["writing a file", "open('out.txt', 'w').write('x')", /network\/files \(open\(out\.txt\)\)/],
    ["listing a folder", "os.listdir('/')", /network\/files \(os\.listdir\)/],
    ["a network connection", "socket.create_connection(('1.1.1.1', 80))", /network\/files \(socket/],
    ["a subprocess", "subprocess.run(['/bin/echo', 'hi'])", /end or control the process \(subprocess\.Popen\)/],
    ["os.system", "os.system('echo hi')", /end or control the process \(os\.system\)/],
    ["os.fork", "os.fork()", /end or control the process \(os\.fork\)/],
    ["ctypes", "import ctypes", /ctypes/],
    ["the raw _ctypes module", "import _ctypes", /_ctypes/],
    ["a thread", "threading.Thread(target=print).start()", /threads/],
    ["a signal handler (it would be handed a stack frame)", "signal.signal(signal.SIGALRM, lambda s, fr: None)", /signal\.signal/],
    ["a real-time signal timer", "signal.setitimer(signal.ITIMER_REAL, 0.01)", /signal\.setitimer/],
    ["CPU time", "time.process_time()", /time\.process_time/],
    ["select with a real timeout", "select.select([], [], [], 0.01)", /select\.select/],
    ["reading stdin", "input()", /builtins\.input/],
  ];
  for (const [what, body, re] of cases) {
    it(what, async () => {
      const r = await runPy(caught(body), { exportName: "f" });
      expectWholeRun(r, re);
    });
  }

  it("sys.exit that escapes the call ends the process: can't check; caught by the code it is ordinary Python", async () => {
    expectWholeRun(await runPy("import sys\n\ndef f():\n    sys.exit(3)\n", { exportName: "f" }), /end or control the process \(SystemExit\)/);
    // SystemExit is an exception Python code may catch; doing so is a fact about the code, not a refusal.
    const r = await runPy(caught("sys.exit(3)"), { exportName: "f" });
    expect(r.result.measured.returnedJson).toBe('"caught SystemExit"');
  });

  it("an OS refusal that escapes the call is never recorded as threw", async () => {
    const r = await rawRun("def f():\n    raise PermissionError(1, 'Operation not permitted')\n", "f");
    expect(!r.ok && r.reason).toMatch(/network\/files \(the sandbox refused an access\)/);
  });

  it("a thread pool through asyncio (run_in_executor / to_thread) is refused", async () => {
    const r = await runPy("import asyncio\n\nasync def f():\n    try:\n        return await asyncio.to_thread(len, 'x')\n    except Exception:\n        return 'caught'\n", { exportName: "f" });
    expectWholeRun(r, /thread pool/);
  });

  it("os._exit before the result: no result, can't check", async () => {
    const r = await runPy("import os\n\ndef f():\n    os._exit(0)\n", { exportName: "f" });
    expectWholeRun(r, /process \(os\._exit\)|no result/);
  });

  it("a callback that fails with nobody catching it, and a task whose error is never read", async () => {
    const a = await runPy("import asyncio\n\nasync def f():\n    asyncio.get_running_loop().call_soon(lambda: 1 / 0)\n    await asyncio.sleep(1)\n    return 'done'\n", { exportName: "f" });
    expectWholeRun(a, /nobody catching it \(ZeroDivisionError\)/);
    const b = await runPy("import asyncio\n\nasync def boom():\n    raise ValueError('x')\n\nasync def f():\n    asyncio.ensure_future(boom())\n    await asyncio.sleep(1)\n    return 'done'\n", { exportName: "f" });
    expectWholeRun(b, /nobody catching it \(ValueError\)/);
  });

  it("an atexit function, a gc callback and turning the garbage collector back on are refused", async () => {
    for (const body of ["import atexit\n    atexit.register(print)", "import gc\n    gc.callbacks.append(lambda *a: None)", "import gc\n    gc.enable()"]) {
      const r = await runPy(`def f():\n    ${body}\n    return 1\n`, { exportName: "f" });
      expectWholeRun(r, /atexit|gc\./);
    }
  });
});

describe.skipIf(!HAVE_PYTHON)("attacks on the result channel", () => {
  it("gc key hunt: gc.get_objects / get_referrers are refused, so no key is found", async () => {
    const src = `import gc

def f():
    try:
        found = [o for o in gc.get_objects() if isinstance(o, str) and len(o) == 64]
    except Exception:
        found = []
    return len(found)
`;
    expectWholeRun(await runPy(src, { exportName: "f" }), /garbage|gc\.get_objects/);
    const r2 = await runPy("import gc\n\ndef f(get):\n    try:\n        return len(gc.get_referrers(get))\n    except Exception:\n        return -1\n", { exportName: "f", args: [standIn("get", [{ do: "return", value: 1 }], { async: false })] });
    expectWholeRun(r2, /gc\.get_referrers/);
  });

  const frameWalks: [string, string][] = [
    ["sys._getframe", "import sys\n\ndef f():\n    try:\n        return str(sys._getframe(1).f_locals)\n    except Exception:\n        return 'x'\n"],
    ["a traceback's tb_frame", "def f():\n    try:\n        raise ValueError()\n    except ValueError as e:\n        try:\n            return str(e.__traceback__.tb_frame.f_back.f_locals)\n        except Exception:\n            return 'x'\n"],
    ["inspect.stack", "import inspect\n\ndef f():\n    try:\n        return str([fr.frame.f_locals for fr in inspect.stack()])\n    except Exception:\n        return 'x'\n"],
    ["traceback.format_exc", "import traceback\n\ndef f():\n    try:\n        1 / 0\n    except ZeroDivisionError:\n        try:\n            return traceback.format_exc()\n        except Exception:\n            return 'x'\n"],
    ["a coroutine's cr_frame", "import asyncio\n\nasync def f():\n    try:\n        return str(asyncio.current_task().get_coro().cr_frame.f_back)\n    except Exception:\n        return 'x'\n"],
    ["sys.settrace", "import sys\n\ndef f():\n    try:\n        sys.settrace(lambda fr, ev, arg: None)\n    except Exception:\n        pass\n    return 1\n"],
    ["sys.setprofile", "import sys\n\ndef f():\n    try:\n        sys.setprofile(lambda fr, ev, arg: None)\n    except Exception:\n        pass\n    return 1\n"],
    ["sys.monitoring", "import sys\n\ndef f():\n    try:\n        sys.monitoring.use_tool_id(3, 'x')\n        sys.monitoring.register_callback(3, sys.monitoring.events.CALL, print)\n    except Exception:\n        pass\n    return 1\n"],
    ["adding an audit hook", "import sys\n\ndef f():\n    sys.addaudithook(lambda e, a: None)\n    return 1\n"],
  ];
  for (const [what, src] of frameWalks) {
    it(`frame walking through ${what} is refused`, async () => {
      expectWholeRun(await runPy(src, { exportName: "f" }), /stack frame|internals|sys\.settrace|sys\.setprofile|sys\.monitoring|sys\.addaudithook/);
    });
  }

  it("gc.set_debug(DEBUG_SAVEALL) + gc.garbage (a route with no audit event) is refused", async () => {
    const src = "import gc\n\ndef f():\n    try:\n        gc.set_debug(gc.DEBUG_SAVEALL)\n    except Exception:\n        pass\n    gc.collect()\n    return len(gc.garbage)\n";
    expectWholeRun(await runPy(src, { exportName: "f" }), /gc\.set_debug/);
  });

  it("lowering the recursion limit does not break Atlas's own reading of the result", async () => {
    const src = "import sys\n\ndef f():\n    sys.setrecursionlimit(50)\n    v = 1\n    for _ in range(40):\n        v = [v]\n    return {'deep': v}\n";
    const r = await runPy(src, { exportName: "f" });
    expect(r.result.measured.returnedJson).toBe(`{"deep":${"[".repeat(40)}1${"]".repeat(40)}}`);
  });

  it("a stand-in called 20,000 times: the count is exact, the trace is cut and says so", async () => {
    const src = "def f(get):\n    for _ in range(20000):\n        get()\n    return 'ok'\n";
    const r = await runPy(src, { exportName: "f", args: [standIn("get", [{ do: "return", value: 1 }], { async: false })] });
    expect(r.result.measured["calls:get"]).toBe(20000);
    expect(r.trace.some((e) => e.event === "trace_cut")).toBe(true);
  });

  it("the stand-in's generator: opening its frame, throwing into it or closing it are all refused", async () => {
    const find = "    gen = [c.cell_contents for c in get.__closure__ if hasattr(c.cell_contents, '__self__')][0].__self__\n";
    const get = standIn("get", [{ do: "return", value: 1 }], { async: false });
    for (const [act, re] of [
      ["str(gen.gi_frame.f_locals)", /gi_frame/],
      ["gen.throw(ValueError('rewind'))", /stand-in was interrupted/],
      ["gen.close()", /stand-in was closed/],
    ] as const) {
      const r = await runPy(`def f(get):\n    get()\n${find}    try:\n        ${act}\n    except BaseException:\n        pass\n    return 1\n`, { exportName: "f", args: [get] });
      expectWholeRun(r, re);
    }
  });

  it("rewiring a stand-in's closure changes only what the code sees: the count stays the real one", async () => {
    const src = `def f(get):
    a = get()
    for c in get.__closure__:
        if hasattr(c.cell_contents, "__self__"):
            c.cell_contents = lambda args: ("ret", "fake")
    b = get()
    c = get()
    return [a, b, c]
`;
    const r = await runPy(src, { exportName: "f", args: [standIn("get", [{ do: "return", value: "real" }], { async: false })] });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: '["real","fake","fake"]', "calls:get": 1 });
  });

  it("moving Atlas's virtual clock backwards through a function's globals is refused", async () => {
    const r = await runPy("import time\n\ndef f():\n    time.sleep(2)\n    time.time.__globals__['CLOCK'][0] = 0.5\n    return time.monotonic()\n", { exportName: "f" });
    expectWholeRun(r, /virtual clock was moved backwards/);
  });

  it("editing Atlas's exposed globals (to silence its refusals) is caught", async () => {
    const src = `import asyncio

async def f():
    g = asyncio.get_running_loop().time.__globals__
    g["cant"] = lambda *a: None
    try:
        await asyncio.to_thread(len, "x")
    except Exception:
        pass
    return "ran anyway"
`;
    expectWholeRun(await runPy(src, { exportName: "f" }), /changed Atlas's own measuring machinery \(exposed\.py's cant\)/);
  });

  it("replacing a function's code, building code objects and loading marshal data are refused", async () => {
    for (const body of ["(lambda: 1).__code__ = (lambda: 2).__code__", "(lambda: 1).__code__.replace(co_consts=(2,))", "import marshal\n        marshal.loads(b'\\xe3')", "import types\n        types.FunctionType((lambda: 1).__code__, {})"]) {
      const r = await runPy(`def f():\n    try:\n        ${body}\n    except BaseException:\n        pass\n    return 1\n`, { exportName: "f" });
      expectWholeRun(r, /internals|__code__|code\.__new__|marshal|function\.__new__/);
    }
  });

  it("_imp.create_builtin (a fresh signal module with the original functions) is refused", async () => {
    const src = "import _imp, importlib.machinery\n\ndef f():\n    try:\n        spec = importlib.machinery.BuiltinImporter.find_spec('_signal')\n        return str(_imp.create_builtin(spec))\n    except Exception:\n        return 'x'\n";
    expectWholeRun(await runPy(src, { exportName: "f" }), /_imp\.create_builtin|importing _signal/);
  });

  it("a forged result line followed by os._exit is rejected (it does not carry the run's key)", async () => {
    const body = JSON.stringify({ runs: [{ id: "exp1", trace: [], result: { measured: { outcome: "returned", returnedJson: "42", virtualMs: 0 }, notMeasured: {} } }] });
    const src = `import os, hashlib, hmac

def f():
    body = ${JSON.stringify(body)}.encode()
    mac = hmac.new(b"0" * 64, body, hashlib.sha256).hexdigest().encode()
    os.write(1, b"\\nATLAS_RESULT " + mac + b" " + body + b"\\n")
    os._exit(0)
`;
    const r = await runPy(src, { exportName: "f" });
    expect(r.result.measured).toEqual({});
    expect(r.result.notMeasured.wholeRun).toMatch(/tampering|process \(os\._exit\)/);
  });

  it("a forged line printed before returning normally: two lines, tampering", async () => {
    const src = 'def f():\n    print("ATLAS_RESULT " + "a" * 64 + " {\\"runs\\": []}", flush=True)\n    return 1\n';
    const r = await runPy(src, { exportName: "f" });
    expectWholeRun(r, /tampering/);
  });

  it("a returned object whose __del__ writes a forged line cannot sneak it in", async () => {
    const src = `import os

class Sneaky:
    def __del__(self):
        os.write(1, b"\\nATLAS_RESULT " + b"b" * 64 + b' {"runs":[]}\\n')

def f():
    return Sneaky()
`;
    const r = await runPy(src, { exportName: "f" });
    expectWholeRun(r, /tampering/);
  });

  it("the key is in no argv, environment variable or file the code can read", async () => {
    let seenKey = "";
    let seenFiles = "";
    const spy: Executor = {
      kind: "local",
      exec: (req) => {
        seenKey = (req.stdin ?? "").trim();
        seenFiles = JSON.stringify(req.files) + JSON.stringify(req.cmd) + JSON.stringify(req.env ?? {});
        return pythonSandboxExecutor.exec(req);
      },
    };
    const src = "import os, sys\n\ndef f():\n    return [sys.argv, sys.orig_argv, dict(os.environ)]\n";
    const r = await runPy(src, { exportName: "f" }, { executor: spy });
    expect(seenKey).toMatch(/^[0-9a-f]{64}$/);
    expect(seenFiles).not.toContain(seenKey);
    expect(r.result.measured.outcome).toBe("returned");
    expect(String(r.result.measured.returnedJson)).not.toContain(seenKey);
    expect(String(r.result.measured.returnedJson)).toContain("boot.py");
  });
});

describe.skipIf(!HAVE_PYTHON)("poisoned returned objects cannot make Atlas sign a value the code did not return", () => {
  const poisons: [string, string, string, RegExp][] = [
    ["a dict subclass that lies about its items", "class D(dict):\n    def items(self):\n        return [('forged', True)]\n    def __iter__(self):\n        return iter(['forged'])\n    def keys(self):\n        return ['forged']\n", "D(real=1)", /^object \(D\)$/],
    ["a float subclass with a forged repr", "class F(float):\n    def __repr__(self):\n        return '42'\n", "F(1.5)", /^object \(F\)$/],
    ["a str subclass", "class S(str):\n    def __str__(self):\n        return 'forged'\n", "S('real')", /^object \(S\)$/],
    ["an object that claims to be a dict", "class Fake:\n    @property\n    def __class__(self):\n        return dict\n    def __json__(self):\n        return {'forged': True}\n", "Fake()", /^object \(Fake\)$/],
    ["a list subclass", "class L(list):\n    def __iter__(self):\n        return iter([42])\n", "L([1, 2])", /^object \(L\)$/],
    ["an int subclass with __eq__", "class I(int):\n    def __eq__(self, o):\n        return True\n    __hash__ = int.__hash__\n", "I(7)", /^object \(I\)$/],
  ];
  for (const [what, cls, expr, type] of poisons) {
    it(what, async () => {
      const r = await runPy(`${cls}\ndef f():\n    return ${expr}\n`, { exportName: "f" });
      expect(r.result.measured.outcome).toBe("returned");
      expect(r.result.measured.returnedType).toMatch(type);
      expect(r.result.measured.returnedJson).toBeUndefined();
    });
  }

  it("a poisoned value nested in a plain dict, and a poisoned key, make the whole value not JSON", async () => {
    const a = await runPy("class F(float):\n    pass\n\ndef f():\n    return {'ok': [1, F(2.0)]}\n", { exportName: "f" });
    // R1 (B1 review B-1): the type is the RETURNED value's own (a dict); the item inside is named in the reason.
    expect(a.result.measured.returnedType).toBe("object");
    expect(a.result.notMeasured.returnedJson).toMatch(/at \.ok\[1\], object \(F\).*not a plain object/);
    const b = await runPy("class K(str):\n    def __eq__(self, o):\n        return True\n    __hash__ = str.__hash__\n\ndef f():\n    return {K('a'): 1}\n", { exportName: "f" });
    expect(b.result.notMeasured.returnedJson).toMatch(/key that is not text/);
  });

  it("patching builtins, json, sys.stdout, sys.modules and __import__ changes nothing Atlas reports (proven harmless)", async () => {
    const src = `import builtins, json, sys

def f(get):
    builtins.type = lambda *a: dict
    builtins.isinstance = lambda *a: True
    builtins.len = lambda x: 0
    builtins.repr = lambda x: "forged"
    builtins.sorted = lambda *a, **k: ["forged"]
    json.dumps = lambda *a, **k: '"forged"'
    sys.stdout = None
    sys.modules["json"] = None
    builtins.__import__ = None
    return {"real": [1, 2.5, get()]}
`;
    const r = await runPy(src, { exportName: "f", args: [standIn("get", [{ do: "return", value: "x" }], { async: false })] });
    expect(r.result.measured).toEqual({ outcome: "returned", virtualMs: 0, returnedType: "object", returnedJson: '{"real":[1,2.5,"x"]}', "calls:get": 1 });
  });

  it("replacing time.time with the code's own function changes only what the code sees", async () => {
    const r = await runPy("import time, asyncio\n\nasync def f():\n    time.time = lambda: 0\n    await asyncio.sleep(2)\n    return time.time()\n", { exportName: "f" });
    expect(r.result.measured).toMatchObject({ outcome: "returned", returnedJson: "0", virtualMs: 2000 });
  });
});

describe("the sentences the Python harness shows", () => {
  it("reuse the JavaScript wording where the cause is the same, with a slot for the detail", () => {
    const w = pyWords();
    expect(w.access).toBe("the code tried to use the network/files ({what}), which Atlas does not allow");
    expect(w.needsPackage).toBe("the code needs {what}; Atlas runs one pasted file on its own, with no packages or other modules");
    expect(w.missingFunction).toBe('the code has no top-level function named "{name}"');
    expect(w.internals).toBe("the code tried to reach Python's internals ({what}), which Atlas does not allow");
    for (const v of Object.values(w)) expect(v).not.toMatch(/Node/);
  });
});
