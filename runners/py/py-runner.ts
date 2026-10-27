// The Python "call-function" runner: runs one top-level function of pasted Python in the OS sandbox, after a
// control that proves the machinery measures known cases exactly. The Python twin of runners/ts/call-runner.ts:
// same experiment shape, same measured fields, same whole-run "can't check" rule, same signed result line.
//
// Plain words:
// - Plain code first reads the pasted file (src/pasted-python.ts): anything imported from outside Python's
//   standard library is a whole-run "can't check" with the reason, and nothing runs.
// - The control (runPyCallControl) runs the reference functions in runners/py/reference.py through the SAME
//   executor, boot file and harness as the pasted code, with fixed experiments whose answers are known
//   (PY_CALL_CONTROL_CASES). Every listed fact must match; otherwise controlPassed is false and every verdict on
//   the run is "can't check".
// - The experiment run (runPyCallExperiment) writes the pasted file into the sandbox as target.py, calls the
//   function once, and turns the harness's answer into a Run. Anything that means "nothing counts" becomes
//   `notMeasured.wholeRun`, never `outcome: threw`.
// - The result line is checked exactly as for JavaScript (parseCallWorkerOutput): one line, HMAC-SHA256 under a
//   fresh per-run key that went to the harness on stdin only. Why Python can keep that key from the code is
//   explained at the top of runners/py/harness.py.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { gate } from "../../src/gate.ts";
import { staticRefusalPy } from "../../src/pasted-python.ts";
import type { ArgSpec, Experiment, ExperimentShape, JsonValue, Run, Target, TraceEvent } from "../../src/types.ts";
import { pythonSandboxExecutor } from "../executor/sandbox-exec-python.ts";
import type { Executor } from "../runner.ts";
import { CALL_DEFAULT_WATCH_LIMIT_MS, type CallRunRequest, type CallWorkerResponse } from "../ts/call-harness.ts";
import { CALL_SEED, compareCallCase, parseCallWorkerOutput, toWire, type CallControlCase } from "../ts/call-runner.ts";
import { ACCESS_REASON, PROCESS_REASON, REAL_TIME_REASON } from "../ts/call-words.ts";
import {
  PY_INTERNALS_REASON,
  PY_NAMED_AT_RUN_TIME,
  PY_NESTED_HANG_REASON,
  PY_RELATIVE_IMPORT,
  PY_TAMPER_REASON,
  PY_UNCAUGHT_REASON,
  pyLoadFailedReason,
  pyMissingFunctionReason,
  pyNeedsPackageReason,
  pyNotAFunctionReason,
  pyStdlibNotLoadedReason,
  pySyntaxReason,
} from "./py-words.ts";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;

const DEFAULT_WALL_CLOCK_MS = 10_000;
/** The experiment id of every Python call-function control run. */
export const PY_CALL_CONTROL_ID = "control:call-function:py";
/** The files the sandbox gets (besides target.py and request.json), in this order for the harness fingerprint. */
const SANDBOX_FILES = ["boot.py", "harness.py", "exposed.py"] as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const own = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** SHA-256 over the harness files the sandbox runs (so a run names exactly which harness measured it). */
export function pyHarnessSha256(): string {
  return sha256(SANDBOX_FILES.map(own).join("\n"));
}

/** The reference file the control runs as its target. */
export function pyReferenceSource(): string {
  return own("reference.py");
}

/** The sentences the harness shows, with "{what}" / "{name}" / "{type}" where the detail goes (py-words.ts). */
export function pyWords(): Record<string, string> {
  const W = "{what}";
  return {
    access: ACCESS_REASON(W),
    process: PROCESS_REASON(W),
    realtime: REAL_TIME_REASON(W),
    internals: PY_INTERNALS_REASON(W),
    uncaught: PY_UNCAUGHT_REASON(W),
    nestedHang: PY_NESTED_HANG_REASON,
    needsPackage: pyNeedsPackageReason(W),
    needsRelative: pyNeedsPackageReason(PY_RELATIVE_IMPORT),
    needsRuntime: pyNeedsPackageReason(PY_NAMED_AT_RUN_TIME),
    stdlibNotLoaded: pyStdlibNotLoadedReason(W),
    tamper: PY_TAMPER_REASON(W),
    syntax: pySyntaxReason(W),
    loadFailed: pyLoadFailedReason(W),
    missingFunction: pyMissingFunctionReason("{name}"),
    notAFunction: pyNotAFunctionReason("{name}", "{type}"),
  };
}

export interface PyWorkerRequest {
  runs: CallRunRequest[];
}

export type PyAnswer =
  | { ok: true; runs: NonNullable<CallWorkerResponse["runs"]>; python?: PythonInfo }
  | { ok: false; reason: string; kind: "wholeRun" | "tampered" | "noResult" | "notStarted"; python?: PythonInfo };

export interface PythonInfo {
  version: string;
  implementation: string;
}

/** The python field of a line parseCallWorkerOutput already verified (it carries the interpreter's version). */
function pythonOf(stdout: string): PythonInfo | undefined {
  const line = stdout.split("\n").find((l) => l.startsWith("ATLAS_RESULT "));
  const body = line?.replace(/^ATLAS_RESULT [0-9a-f]{64} /, "");
  try {
    const p = JSON.parse(body ?? "") as { python?: { version?: unknown; implementation?: unknown } };
    const v = p.python?.version;
    const i = p.python?.implementation;
    if (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v) && typeof i === "string" && /^[a-z]{1,20}$/.test(i)) return { version: v, implementation: i };
  } catch {
    return undefined;
  }
  return undefined;
}

/** Runs the Python harness on `code` in the sandbox. */
export async function runInPySandbox(executor: Executor, code: string, request: PyWorkerRequest, wallClockMs: number): Promise<PyAnswer> {
  const key = randomBytes(32).toString("hex"); // fresh per run; sent on stdin only
  const files: Record<string, string> = {};
  for (const f of SANDBOX_FILES) files[f] = own(f);
  files["target.py"] = code;
  files["request.json"] = JSON.stringify({ words: pyWords(), runs: request.runs });
  let res: Awaited<ReturnType<Executor["exec"]>>;
  try {
    res = await executor.exec({ files, cmd: ["python3", "boot.py"], stdin: `${key}\n`, wallClockMs, allowNetwork: false });
  } catch (e) {
    return { ok: false, reason: `the sandbox could not start: ${(e as Error).message}`, kind: "notStarted" };
  }
  if (res.timedOut) {
    return { ok: false, reason: `the code ran past Atlas's ${wallClockMs} ms limit of REAL time (it may loop without ever handing control back), so Atlas stopped it`, kind: "noResult" };
  }
  const parsed = parseCallWorkerOutput(res.stdout, key, request.runs.map((r) => r.id));
  const python = parsed.ok || parsed.kind === "wholeRun" ? pythonOf(res.stdout) : undefined;
  if (parsed.ok && res.exitCode !== 0) return { ok: false, reason: `tampering: the sandbox wrote a result but exited with code ${res.exitCode}`, kind: "tampered" };
  if (!parsed.ok && parsed.kind === "noResult") {
    const err = res.stderr.trim().split("\n").filter((l) => /Error|error:|failed|harness/.test(l)).slice(-2).join(" | ").replaceAll(/\/[^\s'"]*atlas-pyexec-[^\s/'"]*\/?/g, "<sandbox>/");
    return { ok: false, reason: `the sandbox exited with code ${res.exitCode} and no result${err ? ` (${err.slice(0, 300)})` : ""}`, kind: "noResult" };
  }
  return python ? { ...parsed, python } : parsed;
}

function runRequest(id: string, p: CallShape): CallRunRequest {
  return { id, exportName: p.exportName, args: toWire(p.args), watchLimitMs: p.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS };
}

// ── the control ──────────────────────────────────────────────────────────────────────────────────

const json = (value: JsonValue): ArgSpec => ({ kind: "json", value });

/** The known cases on runners/py/reference.py: the same nine as JavaScript, plus four Python-only ones. */
export const PY_CALL_CONTROL_CASES: readonly CallControlCase[] = [
  {
    id: "C1-json",
    params: { shape: "call-function", exportName: "combine", args: [json({ x: 40, tags: ["a", "b", "c"] }), json(2)] },
    measured: { outcome: "returned", virtualMs: 0, returnedType: "object", returnedJson: '{"nested":{"none":null,"ok":true},"sum":42,"tags":["c","b","a"]}' },
    notMeasured: ["thrownName", "thrownMessage"],
  },
  {
    id: "C2-sync-stand-in",
    params: {
      shape: "call-function",
      exportName: "use_sync_stand_in",
      args: [{ kind: "stand-in", name: "get", async: false, then: "throw_exhausted", calls: [{ do: "return", value: "A" }, { do: "throw", errorName: "TypeError", message: "bad key" }] }],
    },
    measured: { outcome: "returned", virtualMs: 0, "calls:get": 3, returnedJson: '{"first":"A","second":"True:TypeError:bad key","third":"AtlasStandInExhausted"}' },
    notMeasured: [],
  },
  {
    id: "C3-async-stand-in",
    params: {
      shape: "call-function",
      exportName: "use_async_stand_in",
      args: [
        {
          kind: "stand-in",
          name: "fetchRate",
          async: true,
          then: "repeat_last",
          calls: [{ do: "return", value: 7, afterMs: 1500 }, { do: "throw", errorName: "RangeError", message: "out of range" }, { do: "return", value: "c", afterMs: 100 }],
        },
      ],
    },
    measured: { outcome: "returned", virtualMs: 1950, "calls:fetchRate": 4, returnedJson: '{"a":7,"b":"RangeError","c":"c","d":"c","elapsed":1950,"perf":1950,"year":2026}' },
    notMeasured: [],
  },
  {
    id: "C4-never-settles",
    params: { shape: "call-function", exportName: "waits_forever", args: [{ kind: "stand-in", name: "lookup", async: true, then: "repeat_last", calls: [{ do: "never_settle" }] }] },
    measured: { outcome: "never_settled", "calls:lookup": 1 },
    notMeasured: ["virtualMs", "returnedJson"],
  },
  {
    id: "C5-throws",
    params: { shape: "call-function", exportName: "throws_named", args: [json("known message")] },
    measured: { outcome: "threw", virtualMs: 0, thrownName: "ReferenceCheckError", thrownMessage: "known message", thrownType: "Error" },
    notMeasured: ["returnedJson"],
  },
  {
    id: "C6-watch-limit",
    params: { shape: "call-function", exportName: "sleeps_long", args: [], watchLimitMs: 1000 },
    measured: { outcome: "still_running_at_watch_limit" },
    notMeasured: ["virtualMs", "returnedJson"],
  },
  {
    id: "C7-not-json",
    params: { shape: "call-function", exportName: "returns_tuple", args: [] },
    measured: { outcome: "returned", virtualMs: 0, returnedType: "tuple" },
    notMeasured: ["returnedJson"],
  },
  {
    id: "C8-interval",
    params: { shape: "call-function", exportName: "ticks", args: [] },
    measured: { outcome: "returned", virtualMs: 1200, returnedJson: "3" },
    notMeasured: [],
  },
  {
    id: "C9-after-settle",
    params: { shape: "call-function", exportName: "later_call", args: [{ kind: "stand-in", name: "ping", async: false, then: "repeat_last", calls: [{ do: "return", value: null }] }] },
    measured: { outcome: "returned", virtualMs: 0, returnedJson: '"now"', "calls:ping": 1 },
    notMeasured: [],
  },
  {
    id: "P10-blocking-sleep",
    params: { shape: "call-function", exportName: "blocking_sleep", args: [] },
    measured: { outcome: "returned", virtualMs: 2500, returnedJson: "2.5" },
    notMeasured: [],
  },
  {
    id: "P11-nested-asyncio-run",
    params: { shape: "call-function", exportName: "nested_run", args: [] },
    measured: { outcome: "returned", virtualMs: 750, returnedJson: '"inner done"' },
    notMeasured: [],
  },
  {
    id: "P12-big-int",
    params: { shape: "call-function", exportName: "big_int", args: [] },
    measured: { outcome: "returned", virtualMs: 0, returnedType: "number (an integer beyond 2^53)" },
    notMeasured: ["returnedJson"],
  },
  {
    id: "P13-js-numbers",
    params: { shape: "call-function", exportName: "js_numbers", args: [] },
    measured: { outcome: "returned", returnedJson: "[0.30000000000000004,1e+21,5e-7,0,100,9007199254740992]" },
    notMeasured: [],
  },
];

export interface PyControlOutcome {
  run: Run;
  reason?: string;
}

/**
 * Runs the known cases on the Python reference file. Fails loudly: any difference, a refused case, no result or a
 * whole-run reason all make controlPassed false, with every reason listed. Throws only when the sandbox cannot
 * start at all (this machine cannot run Python), which is a fact about the machine, not about any code.
 */
export async function runPyCallControl(opts: { executor?: Executor; wallClockMs?: number } = {}): Promise<PyControlOutcome> {
  const executor = opts.executor ?? pythonSandboxExecutor;
  const source = pyReferenceSource();
  const startedAt = new Date().toISOString();
  const reasons: string[] = [];
  const trace: TraceEvent[] = [];
  const measured: Run["result"]["measured"] = {};
  const notMeasured: Run["result"]["notMeasured"] = {};
  for (const c of PY_CALL_CONTROL_CASES) {
    const g = gate(c.params);
    if (!g.allowed) reasons.push(`${c.id}: the gate refused the known case (${g.reason})`);
  }
  const res = await runInPySandbox(executor, source, { runs: PY_CALL_CONTROL_CASES.map((c) => runRequest(c.id, c.params)) }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
  if (!res.ok) {
    if (res.kind === "notStarted") throw new Error(res.reason);
    reasons.push(res.reason);
    notMeasured.control = `the known-case check gave no result: ${res.reason}`;
  } else {
    for (const c of PY_CALL_CONTROL_CASES) {
      const out = res.runs.find((r) => r.id === c.id);
      if (out) {
        for (const ev of out.trace) trace.push({ ...ev, data: { case: c.id, ...(ev.data ?? {}) } });
        for (const [k, v] of Object.entries(out.result.measured)) measured[`${c.id}.${k}`] = v;
        for (const [k, v] of Object.entries(out.result.notMeasured)) notMeasured[`${c.id}.${k}`] = v;
      }
      reasons.push(...compareCallCase(c, out));
    }
  }
  const controlPassed = reasons.length === 0;
  const reason = controlPassed ? undefined : reasons.join("; ");
  if (reason && notMeasured.control === undefined) notMeasured.control = `the known-case check did not match: ${reason}`;
  const checks = { harnessSha256: pyHarnessSha256(), language: "py", ...(res.python ? { python: res.python.version, implementation: res.python.implementation } : {}) };
  trace.push({ t: 0, event: controlPassed ? "control_matched" : "control_did_not_match", data: reason ? { reason, ...checks } : { cases: PY_CALL_CONTROL_CASES.map((c) => c.id), ...checks } });
  const run: Run = {
    id: nanoid(10),
    experimentId: PY_CALL_CONTROL_ID,
    runner: "ts",
    executor: executor.kind,
    codeSha256: sha256(source),
    seed: CALL_SEED,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result: { measured, notMeasured },
    controlPassed,
  };
  return reason ? { run, reason } : { run };
}

// ── the experiment ───────────────────────────────────────────────────────────────────────────────

/** The pasted Python source of a target, checked against its fingerprint. Throws on a caller mistake. */
export function pastedPySource(target: Target): string {
  if (target.kind !== "pasted") throw new Error(`call-function runs pasted targets only; got "${target.kind}"`);
  if (typeof target.source !== "string") throw new Error("the pasted target carries no source");
  if (target.language !== "py") throw new Error(`the Python runner runs Python only; this target is "${String(target.language)}"`);
  if (sha256(target.source) !== target.codeSha256) throw new Error("the pasted source does not hash to the target's codeSha256");
  return target.source;
}

/**
 * Runs one Python call-function experiment, given a control Run made by runPyCallControl. The run counts only
 * when that control passed. Whole-run reasons go to notMeasured.wholeRun.
 */
export async function runPyCallExperiment(exp: Experiment, ctl: Run, opts: { executor?: Executor; wallClockMs?: number; replayOf?: Run["replayOf"] } = {}): Promise<Run> {
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
  if (exp.params.shape !== "call-function") throw new Error(`runPyCallExperiment runs "call-function" only; got "${exp.params.shape}"`);
  if (ctl.experimentId !== PY_CALL_CONTROL_ID) throw new Error(`the control run ${ctl.id} is not a Python call-function control`);
  const source = pastedPySource(exp.target);
  const executor = opts.executor ?? pythonSandboxExecutor;
  const startedAt = new Date().toISOString();
  let result: Run["result"];
  let trace: TraceEvent[] = [];
  let python: PythonInfo | undefined;
  const refused = staticRefusalPy(source);
  if (refused) {
    result = { measured: {}, notMeasured: { wholeRun: refused } };
    trace.push({ t: 0, event: "refused_before_running", data: { reason: refused } });
  } else {
    const res = await runInPySandbox(executor, source, { runs: [runRequest(exp.id, exp.params)] }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
    if (!res.ok && res.kind === "notStarted") throw new Error(res.reason);
    python = res.python;
    const out = res.ok ? res.runs.find((r) => r.id === exp.id) : undefined;
    if (out) {
      result = out.result;
      trace = [...out.trace];
    } else {
      const why = res.ok ? "the sandbox returned no result for this experiment" : res.reason;
      result = { measured: {}, notMeasured: { wholeRun: why } };
      trace.push({ t: 0, event: "whole_run_cant_check", data: { reason: why } });
    }
  }
  trace.push({
    t: trace.length ? trace[trace.length - 1]!.t : 0,
    event: "call_checks",
    data: { harnessSha256: pyHarnessSha256(), language: "py", controlRunId: ctl.id, controlPassed: ctl.controlPassed === true, ...(python ? { python: python.version, implementation: python.implementation } : {}) },
  });
  if (ctl.controlPassed !== true) {
    const why = ctl.result.notMeasured.control;
    result.notMeasured.control = typeof why === "string" ? why : "the Python call-function known-case check did not pass";
  }
  return {
    id: nanoid(10),
    experimentId: exp.id,
    runner: "ts",
    executor: executor.kind,
    codeSha256: exp.target.codeSha256,
    seed: CALL_SEED,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result,
    controlPassed: ctl.controlPassed === true,
    controlRunId: ctl.id,
    ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
  };
}
