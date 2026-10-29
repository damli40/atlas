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
import { networkGap } from "../../src/network-fake.ts";
import type { ArgSpec, Experiment, ExperimentShape, JsonValue, Run, Target, TraceEvent } from "../../src/types.ts";
import { MODAL_IMAGE } from "../executor/modal.ts";
import { findPython, pythonSandboxExecutor } from "../executor/sandbox-exec-python.ts";
import type { ExecRuntime, Executor } from "../runner.ts";
import { CALL_DEFAULT_WATCH_LIMIT_MS, type CallRunRequest, type CallWorkerResponse } from "../ts/call-harness.ts";
import { CALL_SEED, compareCallCase, networkToWire, parseCallWorkerOutput, reuseControl, toWire, twinRun, type CallControlCase } from "../ts/call-runner.ts";
import { ACCESS_REASON, PIN_FAILED_REASON, PROCESS_REASON, REAL_TIME_REASON } from "../ts/call-words.ts";
import { CALL_PINNED_LOCALE, CALL_PINNED_TIME_ZONE, CLOCK_NUDGE_MS, conditionsFromTrace, isCallSeed, pinnedFor } from "../../src/conditions.ts";
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
    // R1 (D42)
    pinFailed: PIN_FAILED_REASON(W),
  };
}

export interface PyWorkerRequest {
  runs: CallRunRequest[];
  /** R1 (D42): the seed (Python's random, uuid, secrets, os.urandom and PYTHONHASHSEED). Default CALL_SEED. */
  seed?: string;
  /** R1 review round 1: 1 for the second of the two identical runs (it starts with a different heap layout). */
  variant?: 0 | 1;
  /** R2 (D45): the second run only: ms the clock reading moves at each repeated read at one moment. */
  nudgeClockMs?: number;
}

/** R1 (D42): the environment of a Python run: the string-hash seed and the time zone, nothing else. */
export function pyRunEnv(seed: string): Record<string, string> {
  return { LC_ALL: "C", PYTHONCOERCECLOCALE: "0", PYTHONHASHSEED: seed, TZ: CALL_PINNED_TIME_ZONE };
}

export type PyAnswer = (
  | { ok: true; runs: NonNullable<CallWorkerResponse["runs"]>; python?: PythonInfo }
  | { ok: false; reason: string; kind: "wholeRun" | "tampered" | "noResult" | "notStarted"; python?: PythonInfo }
) & {
  /** E4: where the sandbox ran (local sandbox-exec or a Modal sandbox) and with which versions, as measured. */
  runtime?: ExecRuntime;
};

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
  const { answer, runtime } = await pySandboxAnswer(executor, code, request, wallClockMs);
  return runtime ? { ...answer, runtime } : answer;
}

async function pySandboxAnswer(executor: Executor, code: string, request: PyWorkerRequest, wallClockMs: number): Promise<{ answer: PyAnswer; runtime?: ExecRuntime }> {
  const key = randomBytes(32).toString("hex"); // fresh per run; sent on stdin only
  const files: Record<string, string> = {};
  for (const f of SANDBOX_FILES) files[f] = own(f);
  files["target.py"] = code;
  const seed = request.seed ?? CALL_SEED;
  files["request.json"] = JSON.stringify({ words: pyWords(), runs: request.runs, seed, variant: request.variant ?? 0, pins: { timeZone: CALL_PINNED_TIME_ZONE, locale: CALL_PINNED_LOCALE.py }, ...(request.nudgeClockMs ? { nudgeClockMs: request.nudgeClockMs } : {}) });
  let res: Awaited<ReturnType<Executor["exec"]>>;
  try {
    res = await executor.exec({ files, cmd: ["python3", "boot.py"], stdin: `${key}\n`, env: pyRunEnv(seed), wallClockMs, allowNetwork: false });
  } catch (e) {
    return { answer: { ok: false, reason: `the sandbox could not start: ${(e as Error).message}`, kind: "notStarted" } };
  }
  const runtime = res.runtime;
  const done = (answer: PyAnswer) => (runtime ? { answer, runtime } : { answer });
  if (res.timedOut) {
    return done({ ok: false, reason: `the code ran past Atlas's ${wallClockMs} ms limit of REAL time (it may loop without ever handing control back), so Atlas stopped it`, kind: "noResult" });
  }
  // E4 review round 1 (F): a Modal sandbox went away under the running code. Nothing from it counts.
  if (res.stopped !== undefined) return done({ ok: false, reason: res.stopped, kind: "noResult" });
  const parsed = parseCallWorkerOutput(res.stdout, key, request.runs.map((r) => r.id));
  const python = parsed.ok || parsed.kind === "wholeRun" ? pythonOf(res.stdout) : undefined;
  if (parsed.ok && res.exitCode !== 0) return done({ ok: false, reason: `tampering: the sandbox wrote a result but exited with code ${res.exitCode}`, kind: "tampered" });
  if (!parsed.ok && parsed.kind === "noResult" && res.exitCode === 137) {
    // E4 review round 1 (E): killed from outside with no timeout: almost always the sandbox's memory limit.
    return done({ ok: false, reason: "the sandbox killed the code (exit 137), most likely because it used more memory than the sandbox allows", kind: "noResult" });
  }
  if (!parsed.ok && parsed.kind === "noResult") {
    // atlas-pyexec- is the macOS run folder, atlas-exec- the Modal one (E4); both become <sandbox>/.
    const err = res.stderr.trim().split("\n").filter((l) => /Error|error:|failed|harness/.test(l)).slice(-2).join(" | ").replaceAll(/\/[^\s'"]*atlas-(?:py)?exec-[^\s/'"]*\/?/g, "<sandbox>/");
    return done({ ok: false, reason: `the sandbox exited with code ${res.exitCode} and no result${err ? ` (${err.slice(0, 300)})` : ""}`, kind: "noResult" });
  }
  return done(python ? { ...parsed, python } : parsed);
}

function runRequest(id: string, p: CallShape): CallRunRequest {
  return { id, exportName: p.exportName, args: toWire(p.args), watchLimitMs: p.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS, ...(p.network ? { network: networkToWire(p.network) } : {}) };
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
  {
    // R1 (D42): the seed reaches random, uuid and secrets; the sandbox is in UTC with the C locale.
    id: "P14-pins",
    params: { shape: "call-function", exportName: "pinned", args: [] },
    measured: { outcome: "returned", virtualMs: 0, returnedJson: '[0.044717192733188416,"11b1dcf5","761a3fc9",0,"UTC"]' },
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
  const checks = { harnessSha256: pyHarnessSha256(), language: "py", ...(res.python ? { python: res.python.version, implementation: res.python.implementation } : {}), ...(res.runtime ? { runtime: res.runtime } : {}) };
  trace.push({ t: 0, event: controlPassed ? "control_matched" : "control_did_not_match", data: reason ? { reason, ...checks } : { cases: PY_CALL_CONTROL_CASES.map((c) => c.id), ...checks } });
  const run: Run = {
    id: nanoid(10),
    experimentId: PY_CALL_CONTROL_ID,
    runner: "ts",
    executor: executor.kind,
    codeSha256: sha256(source),
    seed: CALL_SEED,
    timeZone: CALL_PINNED_TIME_ZONE,
    locale: CALL_PINNED_LOCALE.py,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result: { measured, notMeasured },
    controlPassed,
  };
  return reason ? { run, reason } : { run };
}

// ── D31: reusing a passed Python control ─────────────────────────────────────────────────────────

/** The Python version a control on this executor runs with: the pinned image's on Modal, this Mac's otherwise. */
export function pythonVersionFor(executor: Executor): string {
  if (executor.kind === "modal") return MODAL_IMAGE.pythonVersion;
  return findPython()?.version ?? "(no python)";
}

/**
 * D31: what a Python control's result depends on: the Python harness files (boot.py, harness.py, exposed.py), the
 * reference file and its known answers, the executor kind and fingerprint, and the Python version.
 */
export function pyControlKey(executor: Executor): string {
  // R1: the seed and the pinned environment are part of what the control checks.
  return sha256(JSON.stringify(["py", pyHarnessSha256(), sha256(pyReferenceSource()), PY_CALL_CONTROL_CASES, executor.kind, executor.fingerprint ?? "(no fingerprint)", pythonVersionFor(executor), CALL_SEED, pyRunEnv(CALL_SEED), CALL_PINNED_LOCALE.py]));
}

/** D31: the Python control to rely on, reused for up to 10 minutes when it passed (see reuseControl). */
export function pyControlFor(opts: { executor?: Executor; wallClockMs?: number; now?: () => number } = {}): Promise<PyControlOutcome> {
  const executor = opts.executor ?? pythonSandboxExecutor;
  return reuseControl(pyControlKey(executor), () => runPyCallControl({ executor, ...(opts.wallClockMs ? { wallClockMs: opts.wallClockMs } : {}) }), opts.now);
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
export async function runPyCallExperiment(exp: Experiment, ctl: Run, opts: { executor?: Executor; wallClockMs?: number; replayOf?: Run["replayOf"]; seed?: string } = {}): Promise<Run> {
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
  if (exp.params.shape !== "call-function") throw new Error(`runPyCallExperiment runs "call-function" only; got "${exp.params.shape}"`);
  if (ctl.experimentId !== PY_CALL_CONTROL_ID) throw new Error(`the control run ${ctl.id} is not a Python call-function control`);
  const source = pastedPySource(exp.target);
  const executor = opts.executor ?? pythonSandboxExecutor;
  // R1 (D42): a replay passes the original run's seed, so it reproduces exactly. Older files say "none": the default.
  const seed = opts.seed !== undefined && isCallSeed(opts.seed) ? opts.seed : CALL_SEED;
  if (ctl.executor !== executor.kind) throw new Error(`the control run ${ctl.id} ran on ${ctl.executor}, not on ${executor.kind}`);
  const startedAt = new Date().toISOString();
  let result: Run["result"];
  let trace: TraceEvent[] = [];
  let python: PythonInfo | undefined;
  let runtime: ExecRuntime | undefined;
  let twin: Run["twin"];
  // U2 (D53): a network library the code imports and the test does not fake is known before running.
  const refused = networkGap(source, "py", exp.params.network) ?? staticRefusalPy(source, { fakes: exp.params.network ? [exp.params.network.replaces] : [] });
  if (refused) {
    result = { measured: {}, notMeasured: { wholeRun: refused } };
    trace.push({ t: 0, event: "refused_before_running", data: { reason: refused } });
  } else {
    const res = await runInPySandbox(executor, source, { runs: [runRequest(exp.id, exp.params)], seed }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
    if (!res.ok && res.kind === "notStarted") throw new Error(res.reason);
    python = res.python;
    runtime = res.runtime;
    const out = res.ok ? res.runs.find((r) => r.id === exp.id) : undefined;
    if (out) {
      // R1 review round 1 (B1, B2): the same test again, in a fresh sandbox, with the same seed and pins.
      const done = await twinRun(out, async () => {
        const again = await runInPySandbox(executor, source, { runs: [runRequest(exp.id, exp.params as CallShape)], seed, variant: 1, nudgeClockMs: CLOCK_NUDGE_MS }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
        if (!again.ok) return { reason: again.reason };
        const o = again.runs.find((r) => r.id === exp.id);
        return o ? { out: o } : { reason: "the sandbox returned no result for this experiment" };
      });
      result = done.result;
      trace = done.trace;
      twin = done.twin;
    } else {
      const why = res.ok ? "the sandbox returned no result for this experiment" : res.reason;
      result = { measured: {}, notMeasured: { wholeRun: why } };
      trace.push({ t: 0, event: "whole_run_cant_check", data: { reason: why } });
    }
  }
  trace.push({
    t: trace.length ? trace[trace.length - 1]!.t : 0,
    event: "call_checks",
    data: {
      harnessSha256: pyHarnessSha256(),
      language: "py",
      controlRunId: ctl.id,
      controlPassed: ctl.controlPassed === true,
      // D31: the control this run relied on finished at this time (it may be up to 10 minutes old).
      controlFinishedAt: ctl.finishedAt,
      ...(python ? { python: python.version, implementation: python.implementation } : {}),
      // E4: where it ran, as the executor measured it (local sandbox-exec has none; Modal names its sandbox).
      ...(runtime ? { runtime } : {}),
    },
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
    seed,
    timeZone: CALL_PINNED_TIME_ZONE,
    locale: CALL_PINNED_LOCALE.py,
    // R1 (D42): the conditions the sandbox noticed, in Atlas's words (verify rechecks them against the trace).
    conditions: conditionsFromTrace(trace, pinnedFor("py", seed)),
    ...(twin ? { twin } : {}),
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result,
    controlPassed: ctl.controlPassed === true,
    controlRunId: ctl.id,
    ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
  };
}
