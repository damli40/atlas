// The TS harness: runs withRpcRetry against a fake RPC on a VIRTUAL clock.
//
// Plain words:
// - The code under test asks to wait by calling the `sleep` we hand it. Our `sleep` writes the
//   wait down and puts a timer on a virtual timeline. Nothing waits for real: when the code is
//   idle, the harness jumps the virtual clock to the next timer and fires it.
// - Every log line the code writes goes into a list (our `log`), not to the console.
// - "Never settles" is decided by plain facts, not a timeout: the code's promise has not settled,
//   there are no virtual timers left, and the microtask queue has drained (a setImmediate
//   callback runs only after every queued promise reaction has run). Nothing can ever wake it.
// - If the code is waiting on something the harness does not control (a REAL timer or real I/O),
//   the harness cannot know when or whether it would settle, so it reports "can't check" for the
//   outcome instead of guessing "pending".
// - Real timers are counted by wrapping setTimeout, setInterval and setImmediate (see
//   installRealTimerTracker). Node's own list of live resources leaves out timers that were
//   unref()'d, so it is not enough on its own: a code path that waits on an unref'd timer would
//   otherwise look like "never settles". The worker installs the wrappers BEFORE it imports the
//   code under test, so the code cannot keep a reference to the unwrapped functions.
//
// Every number in the result is counted from what happened; nothing is copied from the oracle.
//
// B1 (day-6 review): the code under test runs in this same process and may change JavaScript's
// built-ins (Array.prototype.push, JSON.stringify, a setter on Object.prototype...). The harness records
// with captured copies (runners/ts/primordials.ts), into objects with no prototype, and checks the
// built-ins every time the code hands control back. A run whose code changed a built-in is returned
// with nothing measured and BUILTINS_CHANGED_REASON, and the worker sends no result for it at all.

import { createHook } from "node:async_hooks";
import type { RunResult, TraceEvent } from "../../src/types.ts";
import { FAKE_RPC_ERRORS, HTTP_429_ERROR, SUCCESS_VALUE, seededRandom, type RetryScenario } from "./shapes.ts";
import {
  ErrorCtor,
  JSONStringify,
  MathFloor,
  NumberCtor,
  NumberIsFinite,
  ObjectHasOwn,
  PromiseCtor,
  ReflectApply,
  StringCtor,
  activeResourcesInfo,
  append,
  builtinWatch,
  plain,
  promiseReject,
  promiseResolve,
  promiseThen,
  put,
  record,
} from "./primordials.ts";

/** The signature of the function under test (structural; matches the fixture's withRpcRetry). */
export type RetryFn = (
  label: string,
  fn: () => Promise<unknown>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void },
) => Promise<unknown>;

export interface HarnessOptions {
  /** Seeds the choice of fake errors. Same seed = same errors in the same order. */
  seed: string;
  /** The label passed to withRpcRetry. */
  label?: string;
  /** Atlas's own watch limit in VIRTUAL ms (oracle: harnessWatchLimitMs). The code under test has none. */
  watchLimitMs?: number;
  /** Safety cap on virtual timer firings (stops a zero-delay loop from running forever). */
  maxSteps?: number;
}

export interface HarnessOutput {
  trace: TraceEvent[];
  result: RunResult;
}

/** request.json, written by the parent into the sandbox for worker.ts. */
export interface WorkerRequest {
  /** Named export to call in target.ts. */
  exportName: string;
  /** `callers` set (D06-02, "concurrency-sweep"): that many callers run at once on one virtual clock (runSweep). */
  runs: { id: string; scenario: RetryScenario; seed: string; label?: string; watchLimitMs?: number; callers?: number }[];
}
/** What worker.ts prints after RESULT_MARKER and the per-run marker. */
export interface WorkerResponse {
  runs: ({ id: string } & HarnessOutput)[];
  /** Set when the worker saw the code under test change something the result depends on. */
  tampered?: string;
  /** B1: which built-in changed (e.g. "Array.prototype.push was replaced"); the parent re-checks the text before showing it. */
  changed?: string;
}
/** The result line is `${RESULT_MARKER}${marker} ${json}`; the marker is random per run (see worker.ts). */
export const RESULT_MARKER = "ATLAS_RESULT ";

/**
 * Why a run that provably never finishes has no settle time. Not a watch limit: the function was
 * still waiting with nothing left that could wake it (no timers, no pending work), so it can never
 * settle and there is no time to measure.
 */
export const NEVER_SETTLED_REASON = "the function never settled: it was still waiting with nothing left that could wake it, so it has no settle time";
export const DEFAULT_WATCH_LIMIT_MS = 30_000;
const DEFAULT_MAX_STEPS = 10_000;

// ---- real-timer tracking ----
// Native references, captured when this module loads. In the sandbox that is before the code under
// test is imported (worker.ts imports this file first), so the harness's own timers are never counted.
type LooseFn = (...a: unknown[]) => unknown;
type Starter = (cb: unknown, ...rest: unknown[]) => object;
const nativeSetTimeout = globalThis.setTimeout as unknown as Starter;
const nativeClearTimeout = globalThis.clearTimeout as unknown as (h: unknown) => void;
const nativeSetInterval = globalThis.setInterval as unknown as Starter;
const nativeClearInterval = globalThis.clearInterval as unknown as (h: unknown) => void;
const nativeSetImmediate = globalThis.setImmediate as unknown as Starter;
const nativeClearImmediate = globalThis.clearImmediate as unknown as (h: unknown) => void;
const MapSet = Map.prototype.set;
const MapDelete = Map.prototype.delete;

type RealTimerKind = "setTimeout" | "setInterval" | "setImmediate";
/** Real timers started during the current run and not yet fired or cleared. Null outside a run. */
let currentRunTimers: Map<object, RealTimerKind> | null = null;
/** The current run's built-in checker (B1): called whenever the code under test hands control back. */
let currentWatch: (() => string | null) | null = null;
let trackerInstalled = false;

/**
 * Wraps the global timer functions so Atlas knows about every real timer the code under test starts,
 * whether or not it is unref()'d. Idempotent. Best effort: a timer from node:timers/promises is not
 * wrapped here; it is still caught by Node's resource list unless it is created with ref: false.
 * The wrappers record with captured Map functions, so a replaced Map.prototype.set cannot hide a timer.
 */
/** Starts a real timer the tracker below already watches (realTimers), so the job tracker does not count it twice. */
function coveredStart(start: Starter, args: unknown[]): object {
  atlasMaking = true;
  try {
    return ReflectApply(start, globalThis, args) as object;
  } finally {
    atlasMaking = false;
  }
}

export function installRealTimerTracker(): void {
  if (trackerInstalled) return;
  trackerInstalled = true;
  const track = (kind: RealTimerKind, handle: object, repeats: boolean): (() => void) => {
    currentWatch?.();
    const set = currentRunTimers;
    if (set) ReflectApply(MapSet, set, [handle, kind]);
    return () => {
      if (!repeats && set) ReflectApply(MapDelete, set, [handle]);
    };
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.setTimeout = function (cb: unknown, ...rest: unknown[]) {
    if (typeof cb !== "function") return ReflectApply(nativeSetTimeout, globalThis, [cb, ...rest]);
    let done = () => {};
    const h = coveredStart(nativeSetTimeout, [
      (...a: unknown[]) => {
        done();
        return ReflectApply(cb as LooseFn, undefined, a);
      },
      ...rest,
    ]) as object;
    done = track("setTimeout", h, false);
    return h;
  };
  g.setInterval = function (cb: unknown, ...rest: unknown[]) {
    const h = coveredStart(nativeSetInterval, [cb, ...rest]) as object;
    track("setInterval", h, true);
    return h;
  };
  g.setImmediate = function (cb: unknown, ...rest: unknown[]) {
    if (typeof cb !== "function") return ReflectApply(nativeSetImmediate, globalThis, [cb, ...rest]);
    let done = () => {};
    const h = coveredStart(nativeSetImmediate, [
      (...a: unknown[]) => {
        done();
        return ReflectApply(cb as LooseFn, undefined, a);
      },
      ...rest,
    ]) as object;
    done = track("setImmediate", h, false);
    return h;
  };
  const untrack = (h: unknown) => {
    currentWatch?.();
    if (h && typeof h === "object" && currentRunTimers) ReflectApply(MapDelete, currentRunTimers, [h]);
  };
  g.clearTimeout = (h: unknown) => {
    untrack(h);
    ReflectApply(nativeClearTimeout, globalThis, [h]);
  };
  g.clearInterval = (h: unknown) => {
    untrack(h);
    ReflectApply(nativeClearInterval, globalThis, [h]);
  };
  g.clearImmediate = (h: unknown) => {
    untrack(h);
    ReflectApply(nativeClearImmediate, globalThis, [h]);
  };
}

// ---- background work (E1 review round 1, the blind spot reported in E1) ----
// Node's list of live resources does not show one-shot background jobs (crypto.subtle.digest, a key derivation,
// compression) or a timer Node makes internally (AbortSignal.timeout). Code waiting on one looked like "pending,
// nothing left that could wake it", which is false. In the sandbox (worker.ts installs this before the import),
// every async resource except promises, ticks, microtasks and the ones ATLAS makes is tracked from creation until
// its callback starts. While one is pending and no virtual timer is waiting, Atlas waits for it for real (what a
// real run does); when one overlaps a virtual timer, which finishes first depends on real speed, so the run stops
// with "can't check". Outside the sandbox (tests calling runScenario directly) nothing is tracked: behaviour as before.
const IGNORED_ASYNC_TYPES = new Set(["PROMISE", "TickObject", "Microtask"]);
const outsideJobs = new Map<number, string>();
let atlasMaking = false;
let jobTrackerOn = false;
/** The current run's "is a virtual timer waiting?" check; null outside a run. */
let timersWaiting: (() => boolean) | null = null;
let jobRaced = "";
const OUTSIDE_WAIT_STEPS = 2_000;

/** Installs the background-work tracker (idempotent). The sandbox worker calls it before importing the code. */
export function installOutsideWorkTracker(): void {
  if (jobTrackerOn) return;
  jobTrackerOn = true;
  createHook({
    init(id: number, type: string) {
      if (IGNORED_ASYNC_TYPES.has(type) || atlasMaking) return;
      ReflectApply(MapSet, outsideJobs, [id, type]);
      if (timersWaiting?.() && jobRaced === "") jobRaced = type;
    },
    before(id: number) {
      ReflectApply(MapDelete, outsideJobs, [id]);
    },
    destroy(id: number) {
      ReflectApply(MapDelete, outsideJobs, [id]);
    },
  }).enable();
}
function pendingJobs(): string[] {
  const out: string[] = [];
  for (const k of outsideJobs.values()) if (out.indexOf(k) === -1) out.push(k);
  return out;
}
/** A virtual timer is being set: if background work is in flight, the two race. */
function noteTimerSet(): void {
  if (jobRaced === "" && outsideJobs.size > 0) jobRaced = outsideJobs.values().next().value as string;
}
/** Resolves after every queued promise reaction has run (a native setImmediate, marked as Atlas's own). */
function harnessDrain(): Promise<void> {
  return new PromiseCtor<void>((r) => {
    atlasMaking = true;
    try {
      ReflectApply(nativeSetImmediate, globalThis, [r]);
    } finally {
      atlasMaking = false;
    }
  });
}
/** About 1 ms of real time (a native setTimeout, marked as Atlas's own). */
function realPause(): Promise<void> {
  return new PromiseCtor<void>((r) => {
    atlasMaking = true;
    try {
      ReflectApply(nativeSetTimeout, globalThis, [r, 1]);
    } finally {
      atlasMaking = false;
    }
  });
}
const raceReason = (kind: string) =>
  `the code ran background work (${kind}) while a timer was also waiting, so which finished first depends on real speed, not on the code; Atlas did not guess`;

/**
 * B1 (day-6 review). The one sentence for a run whose code changed JavaScript's built-in objects
 * (Array.prototype.push, JSON.stringify, a setter on Object.prototype, ...). Such a run is never shown
 * as fact: the worker sends no result at all, and every verdict is "can't check".
 */
export const BUILTINS_CHANGED_REASON = "the code under test changed JavaScript's built-in objects, so Atlas's record of this run cannot be trusted";

/** Counts of the real Node resources (timers, sockets, file reads) alive right now, by type. */
function activeResources(): Map<string, number> {
  const m = new Map<string, number>();
  const list = activeResourcesInfo();
  for (let i = 0; i < list.length; i++) m.set(list[i]!, (m.get(list[i]!) ?? 0) + 1);
  return m;
}

/** Resource types that have more live instances now than at the start of the run. */
function grownResources(before: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, v] of activeResources()) if (v > (before.get(k) ?? 0)) out.push(k);
  return out.sort();
}

function describeValue(v: unknown): string {
  if (v === undefined) return "undefined";
  try {
    return JSONStringify(v) ?? StringCtor(v);
  } catch {
    try {
      return StringCtor(v);
    } catch {
      return "a value Atlas could not turn into text";
    }
  }
}

function describeError(e: unknown): string {
  try {
    if (e instanceof ErrorCtor) return `${e.name}: ${e.message}`;
  } catch {
    return "an error Atlas could not turn into text";
  }
  return describeValue(e);
}

/** The run's result when the code changed a built-in: nothing measured, the reason in notMeasured.control. */
function untrusted(trace: TraceEvent[], what: string): HarnessOutput {
  const notMeasured = record<RunResult["notMeasured"]>();
  put(notMeasured, "control", `${BUILTINS_CHANGED_REASON} (${what})`);
  append(trace, { t: 0, event: "builtins_changed", data: { what } });
  return plain({ trace, result: { measured: record<RunResult["measured"]>(), notMeasured } });
}

/** A copy of the scenario's own fields, read once at the start (never through a prototype later). */
function ownScenario(s: RetryScenario): RetryScenario {
  const out = record<RetryScenario>();
  for (const k of ["failTimes", "failure", "attempts", "delayMs", "resolveAfterMs", "errorKind", "resolvesWith"] as const) {
    if (ObjectHasOwn(s, k)) put(out, k, (s as unknown as Record<string, unknown>)[k]);
  }
  return out;
}

export async function runScenario(withRpcRetry: RetryFn, scenarioIn: RetryScenario, opts: HarnessOptions): Promise<HarnessOutput> {
  // B1: everything the hooks below need is read now, before the code under test runs, and the run's
  // built-in checker is called each time the code hands control back to Atlas.
  installRealTimerTracker(); // no-op when the worker already installed it before importing the code
  const watch = builtinWatch();
  watch(); // first, before reading anything the code could have changed while it was loaded
  const previousWatch = currentWatch;
  currentWatch = watch;
  const scenario = ownScenario(scenarioIn);
  const label = opts.label ?? "atlas-read";
  const watchLimitMs = opts.watchLimitMs ?? DEFAULT_WATCH_LIMIT_MS;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const random = seededRandom(opts.seed);
  const failTimes = scenario.failTimes;
  const neverSettles = scenario.failure === "never_settles";
  const is429 = scenario.errorKind === "429";
  const value = ObjectHasOwn(scenario, "resolvesWith") ? scenario.resolvesWith : SUCCESS_VALUE;
  const valueText = describeValue(value);
  const resolveAfter = scenario.resolveAfterMs ?? 0;

  const trace: TraceEvent[] = [];
  let now = 0;
  let seq = 0;
  const timers: { at: number; seq: number; fire: () => void }[] = [];
  const schedule = (at: number, fire: () => void) => {
    noteTimerSet();
    append(timers, { at, seq: seq++, fire });
  };
  const emit = (event: string, data?: Record<string, unknown>) => append(trace, data ? { t: now, event, data } : { t: now, event });

  const waits: number[] = [];
  const logs: string[] = [];
  let calls = 0;

  // ---- injected into the code under test ----
  // Each hook first turns what the code passed into a plain number or string (that may run the code's
  // own valueOf/toString), THEN checks the built-ins, then records with the captured functions only.
  const sleep = (msIn: number): Promise<void> => {
    const ms = typeof msIn === "number" ? msIn : NumberCtor(msIn);
    watch();
    append(waits, ms);
    emit("sleep", { ms });
    const at = now + (NumberIsFinite(ms) && ms > 0 ? ms : 0);
    return new PromiseCtor<void>((resolve) =>
      schedule(at, () => {
        emit("wake", { ms });
        resolve();
      }),
    );
  };
  const log = (msgIn: string): void => {
    const msg = typeof msgIn === "string" ? msgIn : StringCtor(msgIn);
    watch();
    append(logs, msg);
    emit("log", { msg });
  };

  // ---- the fake RPC ----
  const fn = (): Promise<unknown> => {
    watch();
    calls += 1;
    const n = calls;
    emit("call", { n });
    const failing = failTimes === "always" || n <= failTimes;
    if (failing && neverSettles) {
      emit("no_answer", { n });
      return new PromiseCtor<unknown>(() => {});
    }
    if (failing) {
      const pick = is429 ? HTTP_429_ERROR : FAKE_RPC_ERRORS[MathFloor(random() * FAKE_RPC_ERRORS.length)]!;
      // The call number makes every error distinct and shows which call's error was finally thrown.
      const message = `${pick.message} (call ${n})`;
      const err = new ErrorCtor(message);
      put(err, "name", pick.name);
      put(err, "atlasCall", n);
      if (is429) put(err, "status", 429);
      emit("reject", { n, error: `${pick.name}: ${message}` });
      return promiseReject(err);
    }
    if (resolveAfter > 0) {
      return new PromiseCtor<unknown>((resolve) =>
        schedule(now + resolveAfter, () => {
          emit("resolve", { n, value: valueText });
          resolve(value);
        }),
      );
    }
    emit("resolve", { n, value: valueText });
    return promiseResolve(value);
  };

  // Only pass attempts/delayMs when the scenario sets them, so the code's own defaults are what run.
  const retryOpts: Parameters<RetryFn>[2] = {
    sleep,
    log,
    ...(scenario.attempts !== undefined ? { attempts: scenario.attempts } : {}),
    ...(scenario.delayMs !== undefined ? { delayMs: scenario.delayMs } : {}),
  };

  // What the run ended with, described when it happened (describing may run the code's own toString or
  // getters, so the built-ins are checked again right after).
  type Settled = { kind: "returns"; text: string; at: number } | { kind: "throws"; text: string; fromCall: number | null; at: number };
  let settled: Settled | null = null;
  const realTimers = new Map<object, RealTimerKind>();
  const previousRunTimers = currentRunTimers;
  currentRunTimers = realTimers;
  const before = activeResources();

  emit("start", { label, ...(scenario.attempts !== undefined ? { attempts: scenario.attempts } : {}), ...(scenario.delayMs !== undefined ? { delayMs: scenario.delayMs } : {}) });
  promiseThen(
    promiseThen(promiseResolve(undefined), () => withRpcRetry(label, fn, retryOpts)),
    (v: unknown) => {
      watch();
      const at = now;
      const text = describeValue(v);
      watch();
      settled = { kind: "returns", text, at };
    },
    (error: unknown) => {
      watch();
      const at = now;
      const text = describeError(error);
      let fromCall: number | null = null;
      try {
        const c = error !== null && (typeof error === "object" || typeof error === "function") && ObjectHasOwn(error, "atlasCall") ? (error as { atlasCall?: unknown }).atlasCall : undefined;
        fromCall = typeof c === "number" ? c : null;
      } catch {
        fromCall = null;
      }
      watch();
      settled = { kind: "throws", text, fromCall, at };
    },
  );

  // ---- the virtual event loop ----
  // `stop` is set when Atlas stops watching BEFORE the function finished. In every such case the run
  // did not see the end, so the counts so far are partial and are not reported as measured.
  let stop: { kind: "outside" | "watch" | "steps"; outcomeReason: string } | null = null;
  let steps = 0;
  let jobWaits = 0;
  jobRaced = "";
  timersWaiting = () => timers.length > 0;
  try {
    for (;;) {
      await harnessDrain();
      if (watch() !== null) break; // B1: the record is not trusted; nothing below runs on changed built-ins
      if (jobRaced !== "") {
        stop = { kind: "outside", outcomeReason: raceReason(jobRaced) };
        break;
      }
      if (settled) break;
      // Real timers the code started. A setImmediate always runs on the next turn, so Atlas waits for
      // those (counted as steps). Any other real timer is time Atlas does not control: stop, can't check.
      if (realTimers.size > 0) {
        const kinds = [...new Set(realTimers.values())].sort();
        if (kinds.every((k) => k === "setImmediate")) {
          if (++steps > maxSteps) {
            stop = { kind: "steps", outcomeReason: `Atlas's step limit (${maxSteps} steps, Atlas's limit, not the code's) ended the run before the function finished` };
            break;
          }
          continue;
        }
        stop = { kind: "outside", outcomeReason: `the code is waiting on a real timer Atlas does not control (${kinds.join(", ")}); Atlas did not wait for it` };
        break;
      }
      const outside = grownResources(before);
      if (outside.length > 0) {
        stop = { kind: "outside", outcomeReason: `the code is waiting on something Atlas does not control (${outside.join(", ")}); Atlas did not wait for it` };
        break;
      }
      const jobs = pendingJobs();
      if (jobs.length > 0) {
        if (timers.length === 0 && jobWaits++ < OUTSIDE_WAIT_STEPS) {
          await realPause();
          continue;
        }
        stop = { kind: "outside", outcomeReason: `the code is waiting on something Atlas does not control (${jobs.join(", ")}); Atlas did not wait for it` };
        break;
      }
      if (timers.length === 0) break; // unsettled, nothing scheduled, queue drained: it can never settle
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = timers[0]!;
      if (next.at > watchLimitMs) {
        stop = { kind: "watch", outcomeReason: `Atlas's watch limit (${watchLimitMs} ms of virtual time, Atlas's limit, not the code's) ended the run before the function finished` };
        break;
      }
      if (++steps > maxSteps) {
        stop = { kind: "steps", outcomeReason: `Atlas's step limit (${maxSteps} virtual timer steps, Atlas's limit, not the code's) ended the run before the function finished` };
        break;
      }
      timers.shift();
      now = next.at;
      next.fire();
    }
  } finally {
    currentRunTimers = previousRunTimers;
    currentWatch = previousWatch;
    timersWaiting = null;
  }
  const changed = watch();
  if (changed !== null) return untrusted(trace, changed);

  // ---- measured facts ----
  // Written into objects with no prototype through defineProperty (B1), then copied out as plain data.
  const measured = record<RunResult["measured"]>();
  const notMeasured = record<RunResult["notMeasured"]>();
  // A negative or non-finite wait is not a span of time (a real timer treats it as 0), so no total is reported.
  const badWait = waits.find((w) => !NumberIsFinite(w) || w < 0);
  const totalWait = badWait === undefined ? waits.reduce((a, b) => a + b, 0) : null;
  const s = settled as Settled | null;

  if (stop) {
    // Atlas stopped watching while the function was still working (virtual timers left, or a real
    // timer / real I/O it does not control). The function did not finish while Atlas watched, so how
    // it ends and how many calls/waits it makes in total were NOT observed. The numbers so far go
    // into the trace, marked partial; none of them is reported as measured.
    const r = stop.outcomeReason;
    put(notMeasured, "outcome", `${r}, so how it ends was not seen`);
    put(notMeasured, "settledAtMs", r);
    put(notMeasured, "calls", `${r}; the count so far was ${calls}`);
    put(notMeasured, "waitCount", `${r}; the count so far was ${waits.length}`);
    put(notMeasured, "waitsMs", `${r}; the waits asked for so far were [${waits.join(",")}]`);
    put(notMeasured, "totalWaitMs", `${r}; the waits asked for so far added up to ${totalWait ?? "a number that is not a real span of time (a negative or non-finite wait)"}${totalWait === null ? "" : " ms"}`);
    put(notMeasured, "logCount", `${r}; the count so far was ${logs.length}`);
    put(notMeasured, "logAttempts", `${r}; the log lines so far were ${logs.length}`);
    emit("stopped_watching", {
      reason: r,
      partial: true,
      callsSoFar: calls,
      waitsSoFarMs: waits.join(","),
      logLinesSoFar: logs.length,
    });
    return plain({ trace, result: { measured, notMeasured } });
  }

  // The function settled, or it can never settle (nothing left that could wake it): the counts are final.
  put(measured, "calls", calls);
  put(measured, "waitCount", waits.length);
  put(measured, "waitsMs", waits.join(","));
  put(measured, "logCount", logs.length);
  put(measured, "logAttempts", logs.map((m) => /attempt (\d+\/\d+)/.exec(m)?.[1] ?? "?").join(","));
  if (totalWait !== null) put(measured, "totalWaitMs", totalWait);
  else put(notMeasured, "totalWaitMs", `the code asked to wait ${badWait} ms, which is ${NumberIsFinite(badWait) ? "negative" : "not a finite number"}; the waits do not add up to a real span of time`);

  if (s) {
    put(measured, "outcome", s.kind);
    put(measured, "settledAtMs", s.at);
    if (s.kind === "returns") {
      put(measured, "returned", s.text);
      emit("returns", { value: s.text });
    } else {
      put(measured, "thrown", s.text);
      put(measured, "thrownFromCall", s.fromCall);
      emit("throws", { error: s.text });
    }
  } else {
    // Unsettled, no virtual timers left, nothing outside Atlas pending, queue drained: it can never settle.
    put(measured, "outcome", "pending");
    put(notMeasured, "settledAtMs", NEVER_SETTLED_REASON); // the settle-time field (SETTLE_FIELD in src/units.ts)
    emit("pending", { reason: "unsettled, no timers left, queue drained" });
  }

  return plain({ trace, result: { measured, notMeasured } });
}

// ---------------------------------------------------------------------------------------------
// D06-02: many callers at once ("concurrency-sweep").
//
// Plain words: N callers each call the real function at virtual time 0, at the same moment. Every
// caller gets its own fake chain read with the SAME failure pattern (fails its first failTimes calls,
// then answers). All callers share ONE virtual clock, so when they wait the same fixed time, they wake
// at the same virtual moment and call again together. The harness writes down the virtual time of
// every call; nothing here assumes the schedule, it is counted from what happened.
// `callTimesMs` is written as "t:count,t:count" in time order; web/screens/scale-model.ts parseCallTimes reads it.
// B1: the same rules as runScenario: hooks record with captured functions only, and the built-ins are
// checked each time the code hands control back.

/** What a sweep runs: how many callers, and the one failure pattern every caller's fake read follows. */
export interface SweepScenario {
  callers: number;
  failTimes: number | "always";
  /** Passed to the function as opts.delayMs only when set; otherwise the code's own default runs. */
  delayMs?: number;
}

export async function runSweep(withRpcRetry: RetryFn, sweepIn: SweepScenario, opts: HarnessOptions): Promise<HarnessOutput> {
  installRealTimerTracker();
  const watch = builtinWatch();
  watch(); // first, before reading anything the code could have changed while it was loaded
  const previousWatch = currentWatch;
  currentWatch = watch;
  const label = opts.label ?? "atlas-read";
  const watchLimitMs = opts.watchLimitMs ?? DEFAULT_WATCH_LIMIT_MS;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const random = seededRandom(opts.seed);
  const n = sweepIn.callers;
  const failTimes = sweepIn.failTimes;
  const delayMs = ObjectHasOwn(sweepIn, "delayMs") ? sweepIn.delayMs : undefined;

  let now = 0;
  let seq = 0;
  const timers: { at: number; seq: number; fire: () => void }[] = [];
  const schedule = (at: number, fire: () => void) => {
    noteTimerSet();
    append(timers, { at, seq: seq++, fire });
  };

  /** Virtual time of every call, per caller, in call order. */
  const callTimes: number[][] = Array.from({ length: n }, () => []);
  const waits: number[][] = Array.from({ length: n }, () => []);
  let logLines = 0;
  type Settled = { kind: "returns" | "throws"; at: number };
  const settled: (Settled | null)[] = Array.from({ length: n }, () => null);
  let settledCount = 0;

  const retryOptsFor = (i: number): Parameters<RetryFn>[2] => {
    const sleep = (msIn: number): Promise<void> => {
      const ms = typeof msIn === "number" ? msIn : NumberCtor(msIn);
      watch();
      append(waits[i]!, ms);
      const at = now + (NumberIsFinite(ms) && ms > 0 ? ms : 0);
      return new PromiseCtor<void>((resolve) => schedule(at, resolve));
    };
    return {
      sleep,
      log: () => {
        watch();
        logLines += 1;
      },
      ...(delayMs !== undefined ? { delayMs } : {}),
    };
  };
  const fnFor = (i: number) => (): Promise<unknown> => {
    watch();
    append(callTimes[i]!, now);
    const k = callTimes[i]!.length;
    if (failTimes === "always" || k <= failTimes) {
      const pick = FAKE_RPC_ERRORS[MathFloor(random() * FAKE_RPC_ERRORS.length)]!;
      const err = new ErrorCtor(`${pick.message} (caller ${i + 1}, call ${k})`);
      put(err, "name", pick.name);
      return promiseReject(err);
    }
    return promiseResolve(SUCCESS_VALUE);
  };

  const realTimers = new Map<object, RealTimerKind>();
  const previousRunTimers = currentRunTimers;
  currentRunTimers = realTimers;
  const before = activeResources();

  for (let i = 0; i < n; i++) {
    promiseThen(
      promiseThen(promiseResolve(undefined), () => withRpcRetry(label, fnFor(i), retryOptsFor(i))),
      () => {
        watch();
        put(settled, i, { kind: "returns", at: now });
        settledCount += 1;
      },
      () => {
        watch();
        put(settled, i, { kind: "throws", at: now });
        settledCount += 1;
      },
    );
  }

  // The same virtual event loop as runScenario, for all callers at once.
  let stop: string | null = null;
  let steps = 0;
  let jobWaits = 0;
  jobRaced = "";
  timersWaiting = () => timers.length > 0;
  try {
    for (;;) {
      await harnessDrain();
      if (watch() !== null) break; // B1: the record is not trusted
      if (jobRaced !== "") {
        stop = raceReason(jobRaced);
        break;
      }
      if (settledCount === n) break;
      if (realTimers.size > 0) {
        const kinds = [...new Set(realTimers.values())].sort();
        if (kinds.every((k) => k === "setImmediate")) {
          if (++steps > maxSteps) {
            stop = `Atlas's step limit (${maxSteps} steps, Atlas's limit, not the code's) ended the run before every caller finished`;
            break;
          }
          continue;
        }
        stop = `the code is waiting on a real timer Atlas does not control (${kinds.join(", ")}); Atlas did not wait for it`;
        break;
      }
      const outside = grownResources(before);
      if (outside.length > 0) {
        stop = `the code is waiting on something Atlas does not control (${outside.join(", ")}); Atlas did not wait for it`;
        break;
      }
      const jobs = pendingJobs();
      if (jobs.length > 0) {
        if (timers.length === 0 && jobWaits++ < OUTSIDE_WAIT_STEPS) {
          await realPause();
          continue;
        }
        stop = `the code is waiting on something Atlas does not control (${jobs.join(", ")}); Atlas did not wait for it`;
        break;
      }
      if (timers.length === 0) break; // some callers can never settle: nothing left that could wake them
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = timers[0]!;
      if (next.at > watchLimitMs) {
        stop = `Atlas's watch limit (${watchLimitMs} ms of virtual time, Atlas's limit, not the code's) ended the run before every caller finished`;
        break;
      }
      if (++steps > maxSteps) {
        stop = `Atlas's step limit (${maxSteps} virtual timer steps, Atlas's limit, not the code's) ended the run before every caller finished`;
        break;
      }
      timers.shift();
      now = next.at;
      next.fire();
    }
  } finally {
    currentRunTimers = previousRunTimers;
    currentWatch = previousWatch;
    timersWaiting = null;
  }
  const changed = watch();
  if (changed !== null) return untrusted([{ t: 0, event: "start", data: { label, callers: n } }], changed);

  // ---- what happened, counted ----
  const byTime = new Map<number, number>();
  for (const list of callTimes) for (const t of list) byTime.set(t, (byTime.get(t) ?? 0) + 1);
  const instants = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  const callTimesText = instants.map(([t, c]) => `${t}:${c}`).join(",");
  const totalCalls = instants.reduce((a, [, c]) => a + c, 0);

  const trace: TraceEvent[] = [{ t: 0, event: "start", data: { label, callers: n, failTimes, ...(delayMs !== undefined ? { delayMs } : {}) } }];
  const settles = new Map<number, { returns: number; throws: number }>();
  for (const s of settled) {
    if (!s) continue;
    const e = settles.get(s.at) ?? { returns: 0, throws: 0 };
    e[s.kind] += 1;
    settles.set(s.at, e);
  }
  const moments = [...new Set([...byTime.keys(), ...settles.keys()])].sort((a, b) => a - b);
  for (const t of moments) {
    if (byTime.has(t)) trace.push({ t, event: "calls", data: { count: byTime.get(t)! } });
    if (settles.has(t)) trace.push({ t, event: "settled", data: settles.get(t)! });
  }

  const measured = record<RunResult["measured"]>();
  const notMeasured = record<RunResult["notMeasured"]>();
  if (stop) {
    for (const f of ["calls", "callTimesMs", "waveCount", "largestWave", "sameScheduleCallers", "returnedCount", "threwCount", "pendingCount", "lastSettledAtMs"]) {
      put(notMeasured, f, f === "callTimesMs" ? `${stop}; the calls so far were at ${callTimesText || "no time"}` : stop);
    }
    trace.push({ t: now, event: "stopped_watching", data: { reason: stop, partial: true, callsSoFar: totalCalls } });
    return plain({ trace, result: { measured, notMeasured } });
  }

  put(measured, "callers", n);
  put(measured, "calls", totalCalls);
  put(measured, "callTimesMs", callTimesText);
  put(measured, "waveCount", instants.length);
  put(measured, "largestWave", instants.reduce((a, [, c]) => Math.max(a, c), 0));
  // How many callers called at exactly the same virtual times as caller 1 (the "same schedule").
  const first = callTimes[0]!.join(",");
  put(measured, "sameScheduleCallers", callTimes.filter((l) => l.join(",") === first).length);
  put(measured, "callerWaitsMs", waits.every((w) => w.join(",") === waits[0]!.join(",")) ? waits[0]!.join(",") : "not the same for every caller");
  put(measured, "logCount", logLines);
  put(measured, "returnedCount", settled.filter((s) => s?.kind === "returns").length);
  put(measured, "threwCount", settled.filter((s) => s?.kind === "throws").length);
  put(measured, "pendingCount", settled.filter((s) => s === null).length);
  if (settledCount === n) put(measured, "lastSettledAtMs", settled.reduce((a, s) => Math.max(a, s!.at), 0));
  else put(notMeasured, "lastSettledAtMs", `${n - settledCount} caller(s) never settled, so there is no last settle time`);
  return plain({ trace, result: { measured, notMeasured } });
}
