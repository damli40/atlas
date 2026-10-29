// The "call-function" runner: runs one exported function of pasted JavaScript/TypeScript in the sandbox, after
// a control that proves the machinery measures known cases exactly.
//
// Plain words:
// - A pasted target carries its own source (src/pasted-code.ts). Plain code first reads it for imports and
//   CommonJS exports; any of those is a whole-run "can't check" with the reason, and nothing runs.
// - The control (runCallControl) runs the reference functions in runners/ts/call-reference.ts through the SAME
//   executor, worker, harness and files as the pasted code, with fixed experiments whose answers are known
//   (CALL_CONTROL_CASES). Every listed fact must match exactly; otherwise controlPassed is false and every
//   verdict on the run is "can't check". The control checks the HARNESS, not the pasted code: it does not depend
//   on the pasted code at all, so its run names the reference file's SHA-256.
// - The experiment run (runCallExperiment) writes the pasted file into the sandbox as target.ts or target.mjs,
//   calls the export once, and turns the worker's answer into a Run. Anything that means "nothing counts" (a
//   package import, a refused access, a missing export, changed built-ins, Atlas's wall-clock limit, no result)
//   becomes `notMeasured.wholeRun`, never `outcome: threw`.
// - Node runs with --disallow-code-generation-from-strings, so eval / new Function cannot run text as code even
//   on a path the guards in call-harness.ts miss.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { CALL_PINNED_LOCALE, CALL_PINNED_SEED, CALL_PINNED_TIME_ZONE, CLOCK_NUDGE_MS, conditionsFromTrace, isCallSeed, mergeTwin, pinnedFor, timedWorkIn, twinComparable, CHANGED_BETWEEN_RUNS_REASON, TIMED_WORK_REASON } from "../../src/conditions.ts";
import { gate } from "../../src/gate.ts";
import { staticRefusal } from "../../src/pasted-code.ts";
import type { ArgSpec, Experiment, ExperimentShape, JsonValue, Run, Target, TraceEvent } from "../../src/types.ts";
import { localExecutor } from "../executor/local.ts";
import type { ExecRuntime, Executor } from "../runner.ts";
import { CALL_DEFAULT_WATCH_LIMIT_MS, type CallRunRequest, type CallWorkerRequest, type CallWorkerResponse, type WireArg } from "./call-harness.ts";
import { BUILTINS_CHANGED_REASON, RESULT_MARKER } from "./harness.ts";

type CallShape = Extract<ExperimentShape, { shape: "call-function" }>;

const DEFAULT_WALL_CLOCK_MS = 10_000;
/** The experiment id of every call-function control run. */
export const CALL_CONTROL_ID = "control:call-function";
/**
 * R1 (D42): the seed a call-function run uses unless it replays a run with another one. Every random source the code
 * can reach draws from it (Math.random, crypto.getRandomValues / randomUUID; Python's random, uuid, secrets,
 * os.urandom and its string-hash seed), so the same test gives the same run. Before R1 this was "none".
 */
export const CALL_SEED = CALL_PINNED_SEED;
/** R1 (D42): the environment every JavaScript sandbox gets: time zone UTC and a pinned locale (checked inside). */
export const CALL_ENV: Readonly<Record<string, string>> = { TZ: CALL_PINNED_TIME_ZONE, LC_ALL: "en_US.UTF-8" };
/** The files the sandbox gets (besides the target and request.json), in this order for the harness fingerprint. */
const SANDBOX_FILES = ["call-worker.ts", "call-harness.ts", "call-words.ts", "primordials.ts", "harness.ts", "shapes.ts"] as const;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const own = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

/** SHA-256 over the harness files the sandbox runs (so a run names exactly which harness measured it). */
export function callHarnessSha256(): string {
  return sha256(SANDBOX_FILES.map(own).join("\n"));
}

/** The reference file the control runs as its target. */
export function callReferenceSource(): string {
  return own("call-reference.ts");
}

/** Experiment args as the worker reads them: JSON values travel as text so they arrive as ordinary objects. */
export function toWire(args: ArgSpec[]): WireArg[] {
  return args.map((a): WireArg => {
    if (a.kind === "json") return { kind: "json", json: JSON.stringify(a.value) };
    return {
      kind: "stand-in",
      name: a.name,
      async: a.async,
      then: a.then,
      calls: a.calls.map((s) =>
        s.do === "return"
          ? { do: "return", json: JSON.stringify(s.value), ...(s.afterMs !== undefined ? { afterMs: s.afterMs } : {}) }
          : s.do === "throw"
            ? { do: "throw", errorName: s.errorName, message: s.message }
            : { do: "never_settle" },
      ),
    };
  });
}

function runRequest(id: string, p: CallShape): CallRunRequest {
  return { id, exportName: p.exportName, args: toWire(p.args), watchLimitMs: p.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS };
}

type CallAnswer = (
  | { ok: true; runs: NonNullable<CallWorkerResponse["runs"]> }
  | { ok: false; reason: string; kind: "wholeRun" | "tampered" | "noResult" | "notStarted" }
) & {
  /** E4: where the sandbox ran and with which versions, as the executor measured it (absent when it never started). */
  runtime?: ExecRuntime;
};

function isRun(r: unknown): r is NonNullable<CallWorkerResponse["runs"]>[number] {
  if (!r || typeof r !== "object") return false;
  const x = r as { id?: unknown; trace?: unknown; result?: { measured?: unknown; notMeasured?: unknown } };
  return typeof x.id === "string" && Array.isArray(x.trace) && !!x.result && typeof x.result.measured === "object" && x.result.measured !== null && typeof x.result.notMeasured === "object" && x.result.notMeasured !== null;
}

/** HMAC-SHA256 of the result JSON under the run's key, as the worker writes it (call-worker.ts explains why). */
export function resultMac(key: string, json: string): string {
  return createHmac("sha256", key).update(json, "utf8").digest("hex");
}

/**
 * Reads the worker's stdout. Review round 1 (B1): a result counts only when its HMAC verifies under this run's key,
 * which only the worker ever held. EVERY line that mentions ATLAS_RESULT must be that one verified line: a second
 * line, a line that does not verify, or one with run ids other than the request's means the code under test tried
 * to write a result itself, and nothing from the run is trusted. Never throws.
 */
export function parseCallWorkerOutput(stdout: string, key: string, expectedIds?: readonly string[]): CallAnswer {
  const lines = stdout.split("\n").filter((l) => l.includes(RESULT_MARKER.trim()));
  if (lines.length === 0) return { ok: false, reason: "the sandbox gave no result line", kind: "noResult" };
  if (lines.length > 1) return { ok: false, reason: `tampering: ${lines.length} result lines (only the worker writes one)`, kind: "tampered" };
  const line = lines[0]!;
  const m = /^ATLAS_RESULT ([0-9a-f]{64}) (.*)$/.exec(line);
  if (!m) return { ok: false, reason: "tampering: a result line not in the worker's form", kind: "tampered" };
  const want = Buffer.from(resultMac(key, m[2]!), "hex");
  const got = Buffer.from(m[1]!, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "tampering: a result line that does not carry this run's key (the worker did not write it)", kind: "tampered" };
  const body = m[2]!;
  let p: CallWorkerResponse;
  try {
    p = JSON.parse(body) as CallWorkerResponse;
  } catch {
    return { ok: false, reason: "tampering or a cut-off write: the result line is not valid JSON", kind: "tampered" };
  }
  if (p?.tampered === BUILTINS_CHANGED_REASON) {
    const what =
      typeof p.changed === "string" && /^[A-Za-z][\w.]{0,60}(?:'s prototype)? (?:was replaced|was added or deleted|was frozen or sealed)$|^a property of [A-Za-z][\w.]{0,60} was (?:replaced|added or deleted)$/.test(p.changed)
        ? p.changed
        : "a built-in object changed";
    return { ok: false, reason: `${BUILTINS_CHANGED_REASON} (${what})`, kind: "tampered" };
  }
  if (p?.tampered !== undefined) return { ok: false, reason: "tampering: the result line has a field the worker does not write that way", kind: "tampered" };
  if (typeof p?.wholeRun === "string") {
    if (p.runs !== undefined) return { ok: false, reason: "tampering: the result line has both runs and a whole-run reason", kind: "tampered" };
    const r = p.wholeRun.length > 600 ? `${p.wholeRun.slice(0, 599)}…` : p.wholeRun;
    return { ok: false, reason: r, kind: "wholeRun" };
  }
  if (!Array.isArray(p?.runs) || !p.runs.every(isRun)) return { ok: false, reason: "tampering: the result line does not have the shape the worker writes", kind: "tampered" };
  // The worker answers exactly the runs it was asked, in order (it may stop early only with a whole-run reason).
  if (expectedIds && (p.runs.length !== expectedIds.length || p.runs.some((r, i) => r.id !== expectedIds[i]))) {
    return { ok: false, reason: "tampering: the result's runs are not the runs Atlas asked for", kind: "tampered" };
  }
  return { ok: true, runs: p.runs };
}

/** Runs the worker on `code` in the sandbox. */
export async function runInSandbox(executor: Executor, code: string, language: "js" | "ts", request: Omit<CallWorkerRequest, "targetFile" | "seed" | "pins"> & { seed?: string }, wallClockMs: number): Promise<CallAnswer> {
  const answer = await sandboxAnswer(executor, code, language, request, wallClockMs);
  return answer.res?.runtime ? { ...answer.parsed, runtime: answer.res.runtime } : answer.parsed;
}

async function sandboxAnswer(executor: Executor, code: string, language: "js" | "ts", request: Omit<CallWorkerRequest, "targetFile" | "seed" | "pins"> & { seed?: string }, wallClockMs: number): Promise<{ parsed: CallAnswer; res?: Awaited<ReturnType<Executor["exec"]>> }> {
  const key = randomBytes(32).toString("hex"); // fresh per run; sent on stdin only
  const targetFile = language === "ts" ? "target.ts" : "target.mjs";
  const files: Record<string, string> = {};
  for (const f of SANDBOX_FILES) files[f] = own(f);
  files[targetFile] = code;
  const seed = request.seed ?? CALL_SEED;
  files["request.json"] = JSON.stringify({ targetFile, runs: request.runs, seed, pins: { timeZone: CALL_PINNED_TIME_ZONE, locale: CALL_PINNED_LOCALE.js }, ...(request.nudgeClockMs ? { nudgeClockMs: request.nudgeClockMs } : {}) } satisfies CallWorkerRequest);
  let res: Awaited<ReturnType<Executor["exec"]>>;
  try {
    res = await executor.exec({
      files,
      cmd: ["node", "--permission", "--allow-fs-read=.", "--disallow-code-generation-from-strings", "call-worker.ts"],
      stdin: `${key}\n`,
      env: { ...CALL_ENV },
      wallClockMs,
      allowNetwork: false,
    });
  } catch (e) {
    return { parsed: { ok: false, reason: `the sandbox could not start: ${(e as Error).message}`, kind: "notStarted" } };
  }
  if (res.timedOut) {
    return { res, parsed: { ok: false, reason: `the code ran past Atlas's ${wallClockMs} ms limit of REAL time (it may loop without ever handing control back), so Atlas stopped it`, kind: "noResult" } };
  }
  // E4 review round 1 (F): the sandbox went away under the running code. Nothing from it counts, said truthfully.
  if (res.stopped !== undefined) return { res, parsed: { ok: false, reason: res.stopped, kind: "noResult" } };
  const parsed = parseCallWorkerOutput(res.stdout, key, request.runs.map((r) => r.id));
  if (parsed.ok && res.exitCode !== 0) return { res, parsed: { ok: false, reason: `tampering: the sandbox wrote a result but exited with code ${res.exitCode}`, kind: "tampered" } };
  if (!parsed.ok && parsed.kind === "noResult" && res.exitCode === 137) {
    // E4 review round 1 (E): the process was killed from outside (SIGKILL). With no wall-clock timeout, that is
    // almost always the sandbox's memory limit. Said plainly; no runtime plumbing text.
    return { res, parsed: { ok: false, reason: "the sandbox killed the code (exit 137), most likely because it used more memory than the sandbox allows", kind: "noResult" } };
  }
  if (!parsed.ok && parsed.kind === "noResult") {
    const err = res.stderr.trim().split("\n").filter((l) => /Error|error:|failed/.test(l)).slice(0, 2).join(" | ").replaceAll(/\/[^\s'"]*atlas-exec-[^\s/'"]*\/?/g, "<sandbox>/");
    return { res, parsed: { ok: false, reason: `the sandbox exited with code ${res.exitCode} and no result${err ? ` (${err.slice(0, 300)})` : ""}`, kind: "noResult" } };
  }
  return { res, parsed };
}

// ── the control ──────────────────────────────────────────────────────────────────────────────────

/** One known case: an experiment on the reference file, and the facts it must measure exactly. */
export interface CallControlCase {
  id: string;
  params: CallShape;
  /** Every listed field must be measured with exactly this value. */
  measured: Record<string, string | number | boolean | null>;
  /** Every listed field must be in notMeasured (any reason). */
  notMeasured: string[];
}

const json = (value: JsonValue): ArgSpec => ({ kind: "json", value });

export const CALL_CONTROL_CASES: readonly CallControlCase[] = [
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
      exportName: "useSyncStandIn",
      args: [{ kind: "stand-in", name: "get", async: false, then: "throw_exhausted", calls: [{ do: "return", value: "A" }, { do: "throw", errorName: "TypeError", message: "bad key" }] }],
    },
    measured: { outcome: "returned", virtualMs: 0, "calls:get": 3, returnedJson: '{"first":"A","second":"true:TypeError:bad key","third":"AtlasStandInExhausted"}' },
    notMeasured: [],
  },
  {
    id: "C3-async-stand-in",
    params: {
      shape: "call-function",
      exportName: "useAsyncStandIn",
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
    params: { shape: "call-function", exportName: "waitsForever", args: [{ kind: "stand-in", name: "lookup", async: true, then: "repeat_last", calls: [{ do: "never_settle" }] }] },
    measured: { outcome: "never_settled", "calls:lookup": 1 },
    notMeasured: ["virtualMs", "returnedJson"],
  },
  {
    id: "C5-throws",
    params: { shape: "call-function", exportName: "throwsNamed", args: [json("known message")] },
    measured: { outcome: "threw", virtualMs: 0, thrownName: "ReferenceCheckError", thrownMessage: "known message", thrownType: "Error" },
    notMeasured: ["returnedJson"],
  },
  {
    id: "C6-watch-limit",
    params: { shape: "call-function", exportName: "sleepsLong", args: [], watchLimitMs: 1000 },
    measured: { outcome: "still_running_at_watch_limit" },
    notMeasured: ["virtualMs", "returnedJson"],
  },
  {
    id: "C7-not-json",
    params: { shape: "call-function", exportName: "returnsUndefined", args: [] },
    measured: { outcome: "returned", virtualMs: 0, returnedType: "undefined" },
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
    params: { shape: "call-function", exportName: "laterCall", args: [{ kind: "stand-in", name: "ping", async: false, then: "repeat_last", calls: [{ do: "return", value: null }] }] },
    measured: { outcome: "returned", virtualMs: 0, returnedJson: '"now"', "calls:ping": 1 },
    notMeasured: [],
  },
  {
    // R1 (D42): the seed reaches Math.random and crypto.randomUUID, and the sandbox is in UTC with locale en-US.
    id: "C10-pins",
    params: { shape: "call-function", exportName: "pinned", args: [] },
    measured: { outcome: "returned", virtualMs: 0, returnedJson: '{"h":0,"n":"1,234.5","r":0.6301390916173888,"tz":"UTC","u":"1a2e5e7a-b23e-4d78-bd00-f3572d54db87"}' },
    notMeasured: [],
  },
];

/** The differences between one case's run and its known answer, in plain words (empty when it matched). */
export function compareCallCase(c: CallControlCase, out: { result: Run["result"] } | undefined): string[] {
  if (!out) return [`${c.id}: the sandbox returned no result for this case`];
  const problems: string[] = [];
  for (const [k, want] of Object.entries(c.measured)) {
    const got = Object.prototype.hasOwnProperty.call(out.result.measured, k) ? out.result.measured[k] : undefined;
    if (got !== want) problems.push(`${c.id}: ${k} was ${JSON.stringify(got ?? "not measured")}, the known answer is ${JSON.stringify(want)}`);
  }
  for (const k of c.notMeasured) {
    if (!Object.prototype.hasOwnProperty.call(out.result.notMeasured, k)) problems.push(`${c.id}: ${k} should not be measured, but it was`);
  }
  return problems;
}

export interface CallControlOutcome {
  run: Run;
  reason?: string;
}

/**
 * Runs the known cases on the reference file. Fails loudly: any difference, a refused case, no result or a
 * whole-run reason all make controlPassed false, with every reason listed.
 */
export async function runCallControl(opts: { executor?: Executor; wallClockMs?: number } = {}): Promise<CallControlOutcome> {
  const executor = opts.executor ?? localExecutor;
  const source = callReferenceSource();
  const startedAt = new Date().toISOString();
  const reasons: string[] = [];
  const trace: TraceEvent[] = [];
  const measured: Run["result"]["measured"] = {};
  const notMeasured: Run["result"]["notMeasured"] = {};
  for (const c of CALL_CONTROL_CASES) {
    const g = gate(c.params);
    if (!g.allowed) reasons.push(`${c.id}: the gate refused the known case (${g.reason})`);
  }
  const res = await runInSandbox(executor, source, "ts", { runs: CALL_CONTROL_CASES.map((c) => runRequest(c.id, c.params)) }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
  if (!res.ok) {
    if (res.kind === "notStarted") throw new Error(res.reason);
    reasons.push(res.reason);
    notMeasured.control = `the known-case check gave no result: ${res.reason}`;
  } else {
    for (const c of CALL_CONTROL_CASES) {
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
  const ran = res.runtime ? { runtime: res.runtime } : {};
  trace.push({ t: 0, event: controlPassed ? "control_matched" : "control_did_not_match", data: reason ? { reason, harnessSha256: callHarnessSha256(), ...ran } : { cases: CALL_CONTROL_CASES.map((c) => c.id), harnessSha256: callHarnessSha256(), ...ran } });
  const run: Run = {
    id: nanoid(10),
    experimentId: CALL_CONTROL_ID,
    runner: "ts",
    executor: executor.kind,
    codeSha256: sha256(source),
    seed: CALL_SEED,
    timeZone: CALL_PINNED_TIME_ZONE,
    locale: CALL_PINNED_LOCALE.js,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result: { measured, notMeasured },
    controlPassed,
  };
  return reason ? { run, reason } : { run };
}

// ── D31: reusing a passed control ────────────────────────────────────────────────────────────────

/** D31: a passed call-function control is reused for at most this long, then run again. */
export const CALL_CONTROL_REUSE_MS = 10 * 60_000;

/**
 * D31: what a call-function control's result depends on. The control checks Atlas's measuring code, never the
 * pasted code, so it is valid for every paste as long as these are the same: the harness and worker files the
 * sandbox runs, the reference file and its known answers, the executor kind, and the executor's fingerprint (the
 * Node version locally; the Modal backend, image digest and Node checksum on Modal).
 */
export function callControlKey(executor: Executor): string {
  return sha256(
    // R1: the seed, the pinned time zone / locale and the sandbox's environment are part of what the control checks.
    JSON.stringify([callHarnessSha256(), sha256(callReferenceSource()), CALL_CONTROL_CASES, executor.kind, executor.fingerprint ?? "(no fingerprint)", CALL_SEED, CALL_PINNED_TIME_ZONE, CALL_PINNED_LOCALE.js, CALL_ENV]),
  );
}

const reusable = new Map<string, Promise<{ run: Run }>>();

/**
 * D31: a passed control under `key`, reused within 10 minutes of when it finished; otherwise `start()` runs a new
 * one. A control that did not pass, or threw, is never kept. Two runs asking at once share one control run. Shared
 * by the JavaScript and the Python call-function controls (their keys differ).
 */
export async function reuseControl<T extends { run: Run }>(key: string, start: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const held = reusable.get(key) as Promise<T> | undefined;
  if (held) {
    const got = await held.catch(() => undefined);
    if (got && got.run.controlPassed === true && now() - Date.parse(got.run.finishedAt) <= CALL_CONTROL_REUSE_MS) return got;
    if (reusable.get(key) === held) reusable.delete(key);
  }
  const fresh = start();
  reusable.set(key, fresh);
  try {
    const got = await fresh;
    if (got.run.controlPassed !== true && reusable.get(key) === fresh) reusable.delete(key);
    return got;
  } catch (e) {
    if (reusable.get(key) === fresh) reusable.delete(key);
    throw e;
  }
}

/** D31: the control to rely on for a JavaScript/TypeScript call-function run (see reuseControl). */
export function callControlFor(opts: { executor?: Executor; wallClockMs?: number; now?: () => number } = {}): Promise<CallControlOutcome> {
  const executor = opts.executor ?? localExecutor;
  return reuseControl(callControlKey(executor), () => runCallControl({ executor, ...(opts.wallClockMs ? { wallClockMs: opts.wallClockMs } : {}) }), opts.now);
}

/** For tests: forget every reusable control. */
export function forgetReusableControls(): void {
  reusable.clear();
}

// ── R1 review round 1: the double run ────────────────────────────────────────────────────────────

type Out = { trace: TraceEvent[]; result: Run["result"] };

/**
 * R1 review round 1 (B1, B2): every pasted test runs twice, in two fresh sandboxes, with the same seed and pins. A
 * field the two runs measured differently is not reported (CHANGED_BETWEEN_RUNS_REASON), whatever made it differ:
 * memory addresses, process ids, temp-folder paths. The second run is kept as the run's `twin`; verify rechecks it.
 * If the second run does not finish, nothing from either counts (whole-run can't check, with why).
 *
 * R2 (D45): the second run is started with the clock nudge (`again` passes CLOCK_NUDGE_MS to the sandbox). When that
 * run timed its own work (its clock moved), every field that differs is "can't check" with TIMED_WORK_REASON and named
 * in a "clock_differs" event instead. Without timed work the nudge never fires, so the second run is the same run.
 */
export async function twinRun(first: Out, again: () => Promise<{ out?: Out; reason?: string }>): Promise<{ trace: TraceEvent[]; result: Run["result"]; twin?: Out }> {
  const second = await again();
  if (!second.out) {
    const why = `the second, identical run of this test did not finish (${second.reason ?? "no result"}), so Atlas cannot tell which values stay the same between runs`;
    return { trace: [{ t: 0, event: "whole_run_cant_check", data: { reason: why } }], result: { measured: {}, notMeasured: { wholeRun: why } } };
  }
  const timed = timedWorkIn(second.out.trace);
  const reason = timed ? TIMED_WORK_REASON : CHANGED_BETWEEN_RUNS_REASON;
  // R2 review M1: the call time compared as the code saw it too (a wait until a deadline the code read).
  const merged = mergeTwin(first.result, timed ? twinComparable(first.result, second.out) : second.out.result, reason);
  const trace = [...first.trace];
  const t = trace.length ? trace[trace.length - 1]!.t : 0;
  if (merged.changed.length > 0) trace.push({ t, event: timed ? "clock_differs" : "twin_differs", data: { fields: merged.changed } });
  if (merged.endingChanged) trace.push({ t, event: "stopped_watching", data: { reason } });
  return { trace, result: merged.result, twin: { trace: second.out.trace, result: second.out.result } };
}

// ── the experiment ───────────────────────────────────────────────────────────────────────────────

/** The pasted source of a target, checked against its fingerprint. Throws on a caller mistake (not a code fact). */
export function pastedSource(target: Target): { source: string; language: "js" | "ts" } {
  if (target.kind !== "pasted") throw new Error(`call-function runs pasted targets only; got "${target.kind}"`);
  if (typeof target.source !== "string") throw new Error("the pasted target carries no source");
  if (target.language !== "js" && target.language !== "ts") throw new Error(`the TS runner runs JavaScript and TypeScript; this target is "${String(target.language)}"`);
  if (sha256(target.source) !== target.codeSha256) throw new Error("the pasted source does not hash to the target's codeSha256");
  return { source: target.source, language: target.language };
}

/**
 * Runs one call-function experiment, given a control Run made by runCallControl. The run counts only when that
 * control passed. Whole-run reasons go to notMeasured.wholeRun.
 */
export async function runCallExperiment(exp: Experiment, ctl: Run, opts: { executor?: Executor; wallClockMs?: number; replayOf?: Run["replayOf"]; seed?: string } = {}): Promise<Run> {
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
  if (exp.params.shape !== "call-function") throw new Error(`runCallExperiment runs "call-function" only; got "${exp.params.shape}"`);
  if (ctl.experimentId !== CALL_CONTROL_ID) throw new Error(`the control run ${ctl.id} is not a call-function control`);
  const executorKind = (opts.executor ?? localExecutor).kind;
  if (ctl.executor !== executorKind) throw new Error(`the control run ${ctl.id} ran on ${ctl.executor}, not on ${executorKind}`);
  const { source, language } = pastedSource(exp.target);
  const executor = opts.executor ?? localExecutor;
  // R1 (D42): a replay passes the original run's seed, so it reproduces exactly. Older files say "none": the default.
  const seed = opts.seed !== undefined && isCallSeed(opts.seed) ? opts.seed : CALL_SEED;
  const startedAt = new Date().toISOString();
  let result: Run["result"];
  let trace: TraceEvent[] = [];
  let runtime: ExecRuntime | undefined;
  let twin: Run["twin"];
  const refused = staticRefusal(source);
  if (refused) {
    result = { measured: {}, notMeasured: { wholeRun: refused } };
    trace.push({ t: 0, event: "refused_before_running", data: { reason: refused } });
  } else {
    const res = await runInSandbox(executor, source, language, { runs: [runRequest(exp.id, exp.params)], seed }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
    if (!res.ok && res.kind === "notStarted") throw new Error(res.reason);
    runtime = res.runtime;
    const out = res.ok ? res.runs.find((r) => r.id === exp.id) : undefined;
    if (out) {
      // R1 review round 1 (B1, B2): the same test again, in a fresh sandbox, with the same seed and pins.
      const done = await twinRun(out, async () => {
        const again = await runInSandbox(executor, source, language, { runs: [runRequest(exp.id, exp.params as CallShape)], seed, nudgeClockMs: CLOCK_NUDGE_MS }, opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS);
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
  trace.push({ t: trace.length ? trace[trace.length - 1]!.t : 0, event: "call_checks", data: {
      harnessSha256: callHarnessSha256(),
      controlRunId: ctl.id,
      controlPassed: ctl.controlPassed === true,
      // D31: which control this run relied on, and when that control finished (it may be up to 10 minutes old).
      controlFinishedAt: ctl.finishedAt,
      ...(runtime ? { runtime } : {}),
    },
  });
  if (ctl.controlPassed !== true) {
    const why = ctl.result.notMeasured.control;
    result.notMeasured.control = typeof why === "string" ? why : "the call-function known-case check did not pass";
  }
  return {
    id: nanoid(10),
    experimentId: exp.id,
    runner: "ts",
    executor: executor.kind,
    codeSha256: exp.target.codeSha256,
    seed,
    timeZone: CALL_PINNED_TIME_ZONE,
    locale: CALL_PINNED_LOCALE[language],
    // R1 (D42): the conditions the sandbox noticed, in Atlas's words (verify rechecks them against the trace).
    conditions: conditionsFromTrace(trace, pinnedFor(language, seed)),
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
