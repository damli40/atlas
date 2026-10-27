// The "call-function" harness: calls ONE exported function of pasted code, on a VIRTUAL clock, and writes down
// what happened. It runs inside the sandbox (runners/ts/call-worker.ts), in the same process as the code.
//
// Plain words:
// - Atlas passes the function plain JSON arguments and "stand-ins": fake functions whose answer on each call
//   was fixed before the run (return a value, return it after N virtual ms, throw a named error, never answer).
// - Time is virtual. setTimeout, setInterval, setImmediate, Date, performance.now, process.hrtime and
//   process.uptime all read Atlas's clock, which starts at VIRTUAL_EPOCH_MS and moves only when the code is
//   idle: Atlas jumps it to the next timer and fires that timer. Nothing waits for real, so a 10-minute wait
//   costs nothing, and the same experiment gives the same run every time.
// - How the call ends is decided by plain facts, as in runners/ts/harness.ts:
//   "returned" / "threw": the promise of `await fn(...args)` settled;
//   "never_settled": it has not settled, no virtual timer is left and the microtask queue is empty, so
//     nothing can ever wake it;
//   "still_running_at_watch_limit": the next timer is past Atlas's watch limit (virtual ms).
//   If the code waits on something Atlas does not control (real I/O), or Atlas's step limit ends the run, the
//   outcome is NOT measured: "can't check" with the reason, never a guess.
// - After the call settles Atlas keeps running the code's leftover timers (up to the watch limit), so a stand-in
//   called later (say from a setTimeout) is still counted. If timers are still left at the limit, the final
//   call counts were not seen and are not reported as measured.
// - Some things make the WHOLE run "can't check" (src/judge.ts shows the reason on every bet): loading other
//   code, touching the network or files (Node's ERR_ACCESS_DENIED), running code made from text (eval, new
//   Function), ending the process, blocking with Atomics.wait, a failure nobody caught, a timer started while
//   the file was loading. The guards below set ONE sticky reason the code cannot clear, and the worker sends
//   only that reason. A refusal is never recorded as `outcome: threw`: that would turn a sandbox rule into a
//   fake fact about the code.
// - The record is written with captured built-ins into objects with no prototype, and the built-ins are
//   checked each time the code hands control back (runners/ts/primordials.ts, day-6 review B1).
//
// What this is not: a security boundary. The sandbox around the process (runners/executor/local.ts) is. This
// file makes sure what Atlas REPORTS is either measured or marked "can't check".

import { createHook } from "node:async_hooks";
import { types as utilTypes } from "node:util";
import type { RunResult, TraceEvent } from "../../src/types.ts";
import {
  ErrorCtor,
  JSONParse,
  JSONStringify,
  NumberCtor,
  NumberIsFinite,
  ObjectDefineProperty,
  ObjectGetOwnPropertyDescriptor,
  ObjectHasOwn,
  PromiseCtor,
  ReflectApply,
  ReflectGetPrototypeOf,
  ReflectOwnKeys,
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
import {
  ACCESS_REASON,
  BLOCKING_REASON,
  REAL_TIME_REASON,
  CODEGEN_REASON,
  INTERNALS_REASON,
  PROCESS_REASON,
  UNCAUGHT_REASON,
  needsPackageReason,
} from "./call-words.ts";

// ---- captured when this module loads (in the sandbox: before the code under test exists) ----
const g = globalThis as unknown as Record<string, unknown>;
const isProxy = utilTypes.isProxy;
const ArrayIsArray = Array.isArray;
const ArraySort = Array.prototype.sort;
const ObjectPrototype = Object.prototype;
const MathTrunc = Math.trunc;
const MathMax = Math.max;
const BigIntCtor = BigInt;
const RealDate = Date;
const RealFunction = Function;
const ReflectConstruct = Reflect.construct;
const ERROR_CTORS: Record<string, ErrorConstructor> = { __proto__: null, Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError } as unknown as Record<string, ErrorConstructor>;
const nativeSetTimeout = g.setTimeout as (...a: unknown[]) => unknown;

/** Atlas's virtual clock starts here: 2026-01-01T00:00:00.000Z. Date.now() in a run is this plus the virtual ms. */
export const VIRTUAL_EPOCH_MS = 1_767_225_600_000;
/** Node's longest timer delay; a longer (or non-positive) delay becomes 1 ms, as in Node itself. */
const TIMEOUT_MAX = 2 ** 31 - 1;
export const CALL_DEFAULT_WATCH_LIMIT_MS = 30_000;
const DEFAULT_MAX_STEPS = 20_000;
/** returnedJson is stored only up to this many characters of canonical JSON. */
export const RETURNED_JSON_MAX_CHARS = 2_048;
const NAME_MAX_CHARS = 200;
const MESSAGE_MAX_CHARS = 500;
const MAX_JSON_DEPTH = 100;
/** How long (real ms, about) Atlas waits for background work when nothing else is left. */
const OUTSIDE_WAIT_MS = 2_000;
/**
 * E3 review B4: the most trace events one run keeps (a loop calling a stand-in 60,000 times made a 7.6 MB answer and
 * kept ~42 MB per run). Past it, events are counted but not kept, and one "trace_cut" event says how many were
 * dropped and how many stand-in calls each name lost, so every count stays exact. The endings are always kept.
 */
export const MAX_TRACE_EVENTS = 1_000;
const ALWAYS_KEPT: Record<string, true> = { __proto__: null, start: true, returned: true, threw: true, never_settled: true, still_running_at_watch_limit: true, stopped_watching: true, stopped_watching_after_settle: true } as unknown as Record<string, true>;

// ---------------------------------------------------------------------------------------------
// The request (written by runners/ts/call-runner.ts; JSON values travel as text so they arrive as ordinary
// objects, never as the prototype-free records the worker reads the request into).

export type WireStep = { do: "return"; json: string; afterMs?: number } | { do: "throw"; errorName: string; message: string } | { do: "never_settle" };
export type WireArg =
  | { kind: "json"; json: string }
  | { kind: "stand-in"; name: string; async: boolean; calls: WireStep[]; then: "repeat_last" | "throw_exhausted" };
export interface CallRunRequest {
  id: string;
  exportName: string;
  args: WireArg[];
  watchLimitMs: number;
}
export interface CallWorkerRequest {
  /** "target.ts" or "target.mjs": the file the worker imports. */
  targetFile: string;
  runs: CallRunRequest[];
}
export interface CallHarnessOutput {
  trace: TraceEvent[];
  result: RunResult;
}
/** What call-worker.ts prints after RESULT_MARKER and the per-run marker. Exactly one of runs / wholeRun / tampered. */
export interface CallWorkerResponse {
  runs?: ({ id: string } & CallHarnessOutput)[];
  wholeRun?: string;
  tampered?: string;
  changed?: string;
}

// ---------------------------------------------------------------------------------------------
// The one sticky whole-run reason. Module-private: the code under test cannot import this file (the worker's
// module hook refuses every import from it), so it can neither read nor clear it.

let wholeRunReason: string | null = null;

/** Records why nothing in this run counts. The first reason wins; later ones are ignored. */
export function markWholeRun(reason: string): void {
  if (wholeRunReason === null) wholeRunReason = reason;
}
/** The whole-run reason, or null while the run may still count. */
export const wholeRun = (): string | null => wholeRunReason;

/** Marks the whole run and throws, so the code cannot carry on as if the refused thing had worked. */
function refuse(reason: string): never {
  markWholeRun(reason);
  const e = new ErrorCtor(`Atlas refused this: ${reason}`);
  ObjectDefineProperty(e, "name", { __proto__: null, value: "AtlasRefused", writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  throw e;
}

/** Text with the sandbox folder's path removed (an error message may name it; it says where Atlas runs). */
let redactions: string[] = [];
export function setRedactions(paths: string[]): void {
  redactions = paths.filter((p) => typeof p === "string" && p.length > 3);
}
function redact(s: string): string {
  let out = s;
  for (let i = 0; i < redactions.length; i++) {
    const r = redactions[i]!;
    for (let at = out.indexOf(r); at !== -1; at = out.indexOf(r)) out = out.slice(0, at) + "<sandbox>" + out.slice(at + r.length);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The virtual clock. One per run; `active` is the run in progress (null while the file loads).

interface VTimer {
  id: number;
  at: number;
  seq: number;
  fire: () => void;
  /** setInterval: fires again this many ms after each firing. */
  every?: number;
  live: boolean;
  /** Fired by Atlas (a stand-in's delayed answer), not started by the code. */
  atlas: boolean;
}

class VirtualClock {
  now = 0;
  private seq = 0;
  private nextId = 1;
  timers: VTimer[] = [];
  byId = new Map<number, VTimer>();
  readonly runId: string;
  constructor(runId: string) {
    this.runId = runId;
  }
  schedule(at: number, fire: () => void, opts: { every?: number; atlas?: boolean } = {}): VTimer {
    if (outsideWork.size > 0) markRaced(outsideWork.values().next().value as string); // a timer set while background work is in flight
    const t: VTimer = { id: this.nextId++, at, seq: this.seq++, fire, live: true, atlas: opts.atlas === true };
    if (opts.every !== undefined) t.every = opts.every;
    append(this.timers, t);
    this.byId.set(t.id, t);
    return t;
  }
  cancel(t: VTimer): void {
    t.live = false;
    this.byId.delete(t.id);
  }
  /** The next live timer (removed from the list), or undefined. Ties fire in the order they were set. */
  peek(): VTimer | undefined {
    let best: VTimer | undefined;
    let bestIdx = -1;
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i]!;
      if (!t.live) continue;
      if (!best || t.at < best.at || (t.at === best.at && t.seq < best.seq)) {
        best = t;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) this.timers = [];
    return best;
  }
  take(t: VTimer): void {
    const kept: VTimer[] = [];
    for (let i = 0; i < this.timers.length; i++) if (this.timers[i] !== t && this.timers[i]!.live) append(kept, this.timers[i]!);
    this.timers = kept;
    if (t.every !== undefined && t.live) {
      t.at = this.now + t.every;
      t.seq = this.seq++;
      append(this.timers, t);
    } else {
      t.live = false;
      this.byId.delete(t.id);
    }
  }
}

let active: VirtualClock | null = null;
/** Timers the code started while it was being loaded (no run active) and has not cleared. */
let loadTimers = 0;
export const pendingLoadTimers = (): number => loadTimers;
/** Called whenever a virtual timer's callback throws: in Node that is an uncaught exception. */
let onUncaught: ((what: string) => void) | null = null;

/** The handle setTimeout / setInterval / setImmediate return: Node's Timeout methods, on Atlas's clock. */
class VTimeout {
  #timer: VTimer | null;
  #clock: VirtualClock | null;
  #ms: number;
  constructor(timer: VTimer | null, clock: VirtualClock | null, ms: number) {
    this.#timer = timer;
    this.#clock = clock;
    this.#ms = ms;
  }
  ref() {
    return this;
  }
  unref() {
    return this;
  }
  hasRef() {
    return true;
  }
  refresh() {
    const t = this.#timer;
    const c = this.#clock;
    if (t && c && t.live) {
      t.at = c.now + this.#ms;
    }
    return this;
  }
  close() {
    clearHandle(this);
    return this;
  }
  [Symbol.toPrimitive]() {
    return this.#timer ? this.#timer.id : 0;
  }
  /** @internal */
  static cancel(h: VTimeout): void {
    if (h.#timer && h.#clock) h.#clock.cancel(h.#timer);
    else if (h.#timer === null && h.#clock === null && h.#ms >= 0) {
      // a load-time timer: never fired; clearing it means it no longer counts against the run
      loadTimers = MathMax(0, loadTimers - 1);
      h.#ms = -1;
    }
  }
}

function clearHandle(h: unknown): void {
  if (h instanceof VTimeout) {
    VTimeout.cancel(h);
    return;
  }
  if (typeof h === "number" && active) {
    const t = active.byId.get(h);
    if (t) active.cancel(t);
  }
}

/** Node's own rule for a timer delay: coerce to a number; outside 1..2^31-1 (or NaN) it becomes 1 ms. */
function nodeDelay(delay: unknown): number {
  let after = NumberCtor(delay);
  if (!(after >= 1 && after <= TIMEOUT_MAX)) after = 1;
  return MathTrunc(after);
}

function startTimer(cb: (...a: unknown[]) => unknown, args: unknown[], ms: number, every: boolean): VTimeout {
  const c = active;
  if (!c) {
    loadTimers += 1;
    return new VTimeout(null, null, ms);
  }
  const t = c.schedule(
    c.now + ms,
    () => {
      try {
        ReflectApply(cb, undefined, args);
      } catch (e) {
        onUncaught?.(`a timer callback threw ${describeThrown(e)}`);
      }
    },
    every ? { every: ms } : {},
  );
  return new VTimeout(t, c, ms);
}

let clockInstalled = false;

/**
 * Puts Atlas's virtual clock behind the global timer and time functions. Called by the worker BEFORE the
 * built-ins snapshot and before the code under test is imported. Idempotent.
 */
export function installVirtualClock(): void {
  if (clockInstalled) return;
  clockInstalled = true;
  g.setTimeout = function setTimeout(cb: unknown, delay?: unknown, ...args: unknown[]) {
    // Not a function: Node throws ERR_INVALID_ARG_TYPE itself, before any timer exists.
    if (typeof cb !== "function") return ReflectApply(nativeSetTimeout, globalThis, [cb, delay, ...args]);
    return startTimer(cb as (...a: unknown[]) => unknown, args, nodeDelay(delay), false);
  };
  g.setInterval = function setInterval(cb: unknown, delay?: unknown, ...args: unknown[]) {
    if (typeof cb !== "function") return ReflectApply(nativeSetTimeout, globalThis, [cb, delay, ...args]);
    return startTimer(cb as (...a: unknown[]) => unknown, args, nodeDelay(delay), true);
  };
  g.setImmediate = function setImmediate(cb: unknown, ...args: unknown[]) {
    if (typeof cb !== "function") return ReflectApply(nativeSetTimeout, globalThis, [cb, 0, ...args]);
    return startTimer(cb as (...a: unknown[]) => unknown, args, 0, false);
  };
  g.clearTimeout = function clearTimeout(h: unknown) {
    clearHandle(h);
  };
  g.clearInterval = function clearInterval(h: unknown) {
    clearHandle(h);
  };
  g.clearImmediate = function clearImmediate(h: unknown) {
    clearHandle(h);
  };

  // ---- Date, performance.now, process.hrtime, process.uptime ----
  const virtualNow = () => VIRTUAL_EPOCH_MS + (active ? active.now : 0);
  const FakeDate = function Date(this: unknown, ...a: unknown[]) {
    if (!new.target) return ReflectApply(RealDate.prototype.toString, new RealDate(virtualNow()), []);
    return ReflectConstruct(RealDate, a.length === 0 ? [virtualNow()] : a, new.target);
  } as unknown as DateConstructor;
  ObjectDefineProperty(FakeDate, "prototype", { __proto__: null, value: RealDate.prototype, writable: false, enumerable: false, configurable: false } as PropertyDescriptor);
  ObjectDefineProperty(FakeDate, "now", { __proto__: null, value: function now() { return virtualNow(); }, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(FakeDate, "parse", { __proto__: null, value: RealDate.parse, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(FakeDate, "UTC", { __proto__: null, value: RealDate.UTC, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(RealDate.prototype, "constructor", { __proto__: null, value: FakeDate, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  g.Date = FakeDate;
  const perf = g.performance as Record<string, unknown> | undefined;
  if (perf) {
    ObjectDefineProperty(perf, "now", { __proto__: null, value: function now() { return active ? active.now : 0; }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
    // Review round 1 (minor): timeOrigin + now() must give the virtual time, as in real Node it gives the real one.
    ObjectDefineProperty(perf, "timeOrigin", { __proto__: null, value: VIRTUAL_EPOCH_MS, writable: false, enumerable: true, configurable: true } as PropertyDescriptor);
  }
  // Review round 1 (B2): AbortSignal.timeout runs on Node's INTERNAL timer (not the global setTimeout), unref'd and
  // invisible to every list Atlas reads, so a call waiting on it looked like "never settles". It now runs on the
  // virtual clock: a signal that aborts with the same TimeoutError Node uses, after `ms` virtual ms.
  const RealAbortController = g.AbortController as typeof AbortController | undefined;
  const RealDOMException = g.DOMException as typeof DOMException | undefined;
  const RealAbortSignal = g.AbortSignal as Record<string, unknown> | undefined;
  if (RealAbortController && RealDOMException && RealAbortSignal) {
    ObjectDefineProperty(RealAbortSignal, "timeout", {
      __proto__: null,
      value: function timeout(ms: unknown) {
        const delay = NumberCtor(ms);
        // Node's own check: a whole number from 0 up; anything else throws ERR_OUT_OF_RANGE / ERR_INVALID_ARG_TYPE.
        if (!(delay >= 0 && delay <= Number.MAX_SAFE_INTEGER) || MathTrunc(delay) !== delay) {
          const e = new RangeError(`The value of "delay" is out of range. It must be >= 0 && <= ${Number.MAX_SAFE_INTEGER}. Received ${StringCtor(ms)}`);
          ObjectDefineProperty(e, "code", { __proto__: null, value: "ERR_OUT_OF_RANGE", writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
          throw e;
        }
        const c = new RealAbortController();
        startTimer(() => c.abort(new RealDOMException("The operation was aborted due to timeout", "TimeoutError")), [], delay, false);
        return c.signal;
      },
      writable: true,
      enumerable: true,
      configurable: true,
    } as PropertyDescriptor);
  }
  // Intl.DateTimeFormat#format() and formatToParts() with no date read the REAL clock; give them the virtual one.
  const dtf = (g.Intl as { DateTimeFormat?: { prototype: object } } | undefined)?.DateTimeFormat?.prototype;
  if (dtf) {
    const fmtGet = ObjectGetOwnPropertyDescriptor(dtf, "format")?.get;
    const toParts = ObjectGetOwnPropertyDescriptor(dtf, "formatToParts")?.value as ((d?: unknown) => unknown) | undefined;
    if (fmtGet) {
      ObjectDefineProperty(dtf, "format", {
        __proto__: null,
        get() {
          const real = ReflectApply(fmtGet, this, []) as (d?: unknown) => string;
          return (d?: unknown) => real(d === undefined ? virtualNow() : d);
        },
        enumerable: false,
        configurable: true,
      } as PropertyDescriptor);
    }
    if (toParts) {
      ObjectDefineProperty(dtf, "formatToParts", {
        __proto__: null,
        value: function formatToParts(this: unknown, d?: unknown) {
          return ReflectApply(toParts, this, [d === undefined ? virtualNow() : d]);
        },
        writable: true,
        enumerable: false,
        configurable: true,
      } as PropertyDescriptor);
    }
  }
  const hrtime = function hrtime(prev?: [number, number]) {
    const ms = active ? active.now : 0;
    let s = MathTrunc(ms / 1000);
    let ns = MathTrunc((ms - s * 1000) * 1e6);
    if (ArrayIsArray(prev)) {
      s -= NumberCtor(prev[0]);
      ns -= NumberCtor(prev[1]);
      if (ns < 0) {
        s -= 1;
        ns += 1e9;
      }
    }
    return [s, ns];
  };
  ObjectDefineProperty(hrtime, "bigint", { __proto__: null, value: function bigint() { return BigIntCtor(MathTrunc((active ? active.now : 0) * 1e6)); }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(process, "hrtime", { __proto__: null, value: hrtime, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(process, "uptime", { __proto__: null, value: function uptime() { return (active ? active.now : 0) / 1000; }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
}

let guardsInstalled = false;

/**
 * The run-time guards: every way into the network, the files, other modules, code-from-text or the process
 * that is reachable without an import is replaced by a function that marks the whole run and throws. The
 * sandbox would block most of them anyway (ERR_ACCESS_DENIED); these make sure Atlas KNOWS the code tried,
 * even if the code catches the error. Called by the worker before the snapshot and the import. Idempotent.
 */
export function installSandboxGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const def = (obj: object, key: string, value: unknown) =>
    ObjectDefineProperty(obj, key, { __proto__: null, value, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  const proc = process as unknown as Record<string, unknown>;

  def(globalThis, "require", function require(spec: unknown) {
    return refuse(needsPackageReason(typeof spec === "string" ? spec : "a module named at run time"));
  });
  for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
    if (name in g) def(globalThis, name, function blocked() {
      return refuse(ACCESS_REASON(name));
    });
  }
  def(proc, "getBuiltinModule", function getBuiltinModule(id: unknown) {
    return refuse(needsPackageReason(typeof id === "string" ? id : "a module named at run time"));
  });
  for (const name of ["binding", "_linkedBinding", "dlopen"]) def(proc, name, function blocked() {
    return refuse(INTERNALS_REASON(`process.${name}`));
  });
  // Review round 1 (B1): reallyExit too. The worker ends the process through its own copy, taken before this runs.
  for (const name of ["exit", "reallyExit", "abort", "kill", "execve"]) def(proc, name, function blocked() {
    return refuse(PROCESS_REASON(`process.${name}`));
  });
  // Every other function on `process` (process.loadEnvFile, process.chdir, process.report.writeReport, ...) may
  // hit the sandbox's file rules. Each is wrapped so a refusal (ERR_ACCESS_DENIED) marks the whole run even when
  // the code catches the error and carries on. The wrapper changes nothing else: same this, same arguments.
  // Review round 1: refused outright. process.report shows the command line, host and paths (B1); process.stdin
  // is real input; cpuUsage / resourceUsage / threadCpuUsage are real clocks the virtual one cannot stand in for.
  const getterBlocked = (obj: object, key: string, reason: string) =>
    ObjectDefineProperty(obj, key, { __proto__: null, get() { return refuse(reason); }, set() { refuse(reason); }, enumerable: false, configurable: true } as PropertyDescriptor);
  getterBlocked(proc, "report", INTERNALS_REASON("process.report"));
  getterBlocked(proc, "stdin", ACCESS_REASON("process.stdin"));
  for (const name of ["cpuUsage", "resourceUsage", "threadCpuUsage"]) def(proc, name, function blocked() {
    return refuse(REAL_TIME_REASON(`process.${name}`));
  });
  // Listening for the process's own events: 'beforeExit' fires when the event loop runs empty, which in a real run
  // can wake a call Atlas would call "never settles". Signals, IPC messages and exit come from outside the code.
  const outsideEvent = (ev: unknown) => typeof ev === "string" && (ev === "beforeExit" || ev === "exit" || ev === "message" || ev === "disconnect" || ev.startsWith("SIG"));
  for (const name of ["on", "once", "addListener", "prependListener", "prependOnceListener"]) {
    const orig = proc[name] as (...a: unknown[]) => unknown;
    if (typeof orig !== "function") continue;
    def(proc, name, function (this: unknown, ev: unknown, ...rest: unknown[]) {
      if (outsideEvent(ev)) return refuse(REAL_TIME_REASON(`process.${name}("${String(ev)}")`));
      return ReflectApply(orig, this, [ev, ...rest]);
    });
  }
  // performance: everything that reads Node's real clock or its real event-loop timings.
  const perf = g.performance as Record<string, unknown> | undefined;
  if (perf) {
    for (const name of ["mark", "measure", "timerify", "eventLoopUtilization", "getEntries", "getEntriesByName", "getEntriesByType", "toJSON", "markResourceTiming"]) {
      def(perf, name, function blocked() {
        return refuse(REAL_TIME_REASON(`performance.${name}`));
      });
    }
    getterBlocked(perf, "nodeTiming", REAL_TIME_REASON("performance.nodeTiming"));
  }
  // Work that can wake a promise without Atlas's clock and without a resource Atlas can see:
  // - MessageChannel / BroadcastChannel: messages are delivered by another part of Node on real time, and an
  //   unref'd port is invisible to the resource list.
  // - FinalizationRegistry / WeakRef: what they do depends on when the garbage collector runs.
  // - navigator.locks: a lock is granted by Node on its own schedule.
  for (const name of ["MessageChannel", "MessagePort", "BroadcastChannel"]) {
    if (name in g) def(globalThis, name, function blocked() {
      return refuse(REAL_TIME_REASON(name));
    });
  }
  for (const name of ["FinalizationRegistry", "WeakRef"]) {
    if (name in g) def(globalThis, name, function blocked() {
      return refuse(REAL_TIME_REASON(`${name} (garbage-collector timing)`));
    });
  }
  const nav = g.navigator as object | undefined;
  if (nav) getterBlocked(nav, "locks", REAL_TIME_REASON("navigator.locks"));
  const guarded = new Set(["require", "getBuiltinModule", "binding", "_linkedBinding", "dlopen", "exit", "reallyExit", "abort", "kill", "execve", "hrtime", "uptime", "report", "stdin", "cpuUsage", "resourceUsage", "threadCpuUsage", "on", "once", "addListener", "prependListener", "prependOnceListener"]);
  const watchAccess = (obj: Record<string, unknown>, key: string, label: string) => {
    const d = ObjectGetOwnPropertyDescriptor(obj, key);
    if (!d || !ObjectHasOwn(d, "value") || typeof d.value !== "function" || !d.configurable) return;
    const orig = d.value as (...a: unknown[]) => unknown;
    def(obj, key, function (this: unknown, ...a: unknown[]) {
      try {
        return ReflectApply(orig, this, a);
      } catch (e) {
        if (isAccessDenied(e)) markWholeRun(ACCESS_REASON(label));
        throw e;
      }
    });
  };
  const procKeys = ReflectOwnKeys(proc);
  for (let i = 0; i < procKeys.length; i++) {
    const k = procKeys[i];
    if (typeof k === "string" && !guarded.has(k)) watchAccess(proc, k, `process.${k}`);
  }
  // Code made from text. The worker also runs Node with --disallow-code-generation-from-strings, so even a path
  // missed here cannot run text as code; these make sure the attempt is seen.
  def(globalThis, "eval", function evalBlocked() {
    return refuse(CODEGEN_REASON("eval"));
  });
  const fnBlocked = function Function() {
    return refuse(CODEGEN_REASON("new Function"));
  };
  (fnBlocked as unknown as { prototype: unknown }).prototype = RealFunction.prototype; // so `x instanceof Function` still works
  def(globalThis, "Function", fnBlocked);
  const protos = [RealFunction.prototype, ReflectGetPrototypeOf(async function () {}), ReflectGetPrototypeOf(function* () {}), ReflectGetPrototypeOf(async function* () {})];
  for (let i = 0; i < protos.length; i++) def(protos[i] as object, "constructor", fnBlocked);
  def(Atomics, "wait", function wait() {
    return refuse(BLOCKING_REASON);
  });
  // Atomics.waitAsync and WebAssembly's background compile finish on real time, outside every list Atlas can
  // see; a call waiting on them would look like "never settles" when it would in fact finish. Refused instead.
  def(Atomics, "waitAsync", function waitAsync() {
    return refuse(REAL_TIME_REASON("Atomics.waitAsync"));
  });
  const wasm = g.WebAssembly as Record<string, unknown> | undefined;
  if (wasm) for (const name of ["compile", "instantiate", "compileStreaming", "instantiateStreaming"]) {
    if (typeof wasm[name] === "function") def(wasm, name, function blocked() {
      return refuse(REAL_TIME_REASON(`WebAssembly.${name}`));
    });
  }
  onUncaught = (what) => markWholeRun(UNCAUGHT_REASON(what));
  installOutsideWorkTracker();
}

// ---- outside work Atlas does not control ----
// Node's list of live resources (process.getActiveResourcesInfo) does not show one-shot background jobs: a
// crypto.subtle.digest, a key derivation, a compression step. A call waiting on one of them would look like
// "nothing left that could wake it" and be reported as never settling, which is false: the job finishes and
// wakes it. So every async resource Node creates (except promises and Atlas's own drain) is tracked from
// creation until its callback starts or it is destroyed; while any is pending, a quiet run is not "never
// settled" but "waiting on something Atlas does not control" (can't check).
// Review round 1 (B2): "Timeout" and "Immediate" are no longer ignored as a type. Only the ones ATLAS creates (its
// microtask drain and its 1 ms real waits, made while `atlasCreating` is set) are skipped; a Timeout made by Node
// on the code's behalf (AbortSignal.timeout before it was moved to the virtual clock, a stream's internals) counts.
const OWN_ASYNC_TYPES = new Set(["PROMISE", "TickObject", "Microtask"]);
let atlasCreating = false;
const nativeSetImmediateFn = g.setImmediate as (...a: unknown[]) => unknown;
/** Resolves after every queued promise reaction has run, through a native setImmediate marked as Atlas's own. */
function drain(): Promise<void> {
  return new PromiseCtor<void>((r) => {
    atlasCreating = true;
    try {
      ReflectApply(nativeSetImmediateFn, globalThis, [r]);
    } finally {
      atlasCreating = false;
    }
  });
}
/** Waits about 1 ms of real time, through a native setTimeout marked as Atlas's own. */
function realPause(): Promise<void> {
  return new PromiseCtor<void>((r) => {
    atlasCreating = true;
    try {
      ReflectApply(nativeSetTimeout, globalThis, [r, 1]);
    } finally {
      atlasCreating = false;
    }
  });
}
const outsideWork = new Map<number, string>();
/**
 * Set when background work and a virtual timer were in flight at the same time (the work started while a timer
 * was set, or a timer was set while the work ran). Which finishes first then depends on real speed, so how the
 * call ends is not reported. Reset at the start of each run.
 */
let raced = false;
/** The kind of background work that raced first (fixed when the race is seen, so the reason never varies). */
let racedWith = "";
function markRaced(kind: string): void {
  if (!raced) racedWith = kind;
  raced = true;
}
const MapSetFn = Map.prototype.set;
const MapDeleteFn = Map.prototype.delete;
let trackerOn = false;
function installOutsideWorkTracker(): void {
  if (trackerOn) return;
  trackerOn = true;
  createHook({
    init(id: number, type: string) {
      if (OWN_ASYNC_TYPES.has(type) || atlasCreating) return;
      ReflectApply(MapSetFn, outsideWork, [id, type]);
      if (active && active.byId.size > 0) markRaced(type);
    },
    before(id: number) {
      ReflectApply(MapDeleteFn, outsideWork, [id]);
    },
    destroy(id: number) {
      ReflectApply(MapDeleteFn, outsideWork, [id]);
    },
  }).enable();
}
/** The kinds of background work started and not yet called back (empty outside the sandbox worker). */
function pendingOutsideWork(): string[] {
  const kinds: string[] = [];
  for (const k of outsideWork.values()) if (kinds.indexOf(k) === -1) append(kinds, k);
  return kinds;
}

/** The worker calls this from process 'unhandledRejection' / 'uncaughtException' listeners. */
export function noteUncaught(kind: "rejection" | "exception", value: unknown): void {
  if (isAccessDenied(value)) markWholeRun(ACCESS_REASON("the sandbox refused an access"));
  markWholeRun(UNCAUGHT_REASON(kind === "rejection" ? `a promise rejected with ${describeThrown(value)}` : `an exception ${describeThrown(value)}`));
}

// ---------------------------------------------------------------------------------------------
// Reading values the code produced, without trusting them.

/** An own DATA property's value (never runs a getter); undefined when absent or an accessor. */
function ownData(o: unknown, key: string): unknown {
  if (o === null || (typeof o !== "object" && typeof o !== "function")) return undefined;
  try {
    if (isProxy(o)) return undefined;
    const d = ObjectGetOwnPropertyDescriptor(o, key);
    return d && ObjectHasOwn(d, "value") ? d.value : undefined;
  } catch {
    return undefined;
  }
}

/** True when the value (or its cause, a few levels down) is Node's permission-model refusal. */
export function isAccessDenied(v: unknown, depth = 0): boolean {
  if (depth > 4 || v === null || (typeof v !== "object" && typeof v !== "function")) return false;
  if (ownData(v, "code") === "ERR_ACCESS_DENIED") return true;
  return isAccessDenied(ownData(v, "cause"), depth + 1);
}

/** A short description of a thrown value for a reason sentence (name and message only when they are plain data). */
function describeThrown(e: unknown): string {
  try {
    if (e === null) return "null";
    if (typeof e === "string") return `the text ${JSONStringify(e.length > 80 ? `${e.slice(0, 79)}…` : e)}`;
    if (typeof e !== "object" && typeof e !== "function") return `a ${typeof e}`;
    let proto: unknown = e;
    let name: unknown;
    for (let i = 0; i < 8 && proto && name === undefined; i++) {
      name = ownData(proto, "name");
      proto = ReflectGetPrototypeOf(proto as object);
    }
    const message = ownData(e, "message");
    const n = typeof name === "string" ? name.slice(0, 60) : "an object";
    return typeof message === "string" ? redact(`${n}: ${message.length > 120 ? `${message.slice(0, 119)}…` : message}`) : n;
  } catch {
    return "a value Atlas could not describe";
  }
}

class NotJson {
  readonly type: string;
  readonly reason: string;
  constructor(type: string, reason: string) {
    this.type = type;
    this.reason = reason;
  }
}

/** The type Atlas reports for a value: "string", "array", "object", "object (Map)", "number (NaN)", ... */
function typeOf(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return NumberIsFinite(v as number) ? "number" : `number (${StringCtor(v)})`;
  if (t !== "object") return t;
  try {
    if (isProxy(v)) return "object (Proxy)";
    if (ArrayIsArray(v)) return "array";
    const proto = ReflectGetPrototypeOf(v as object);
    if (proto === ObjectPrototype || proto === null) return "object";
    const ctor = ownData(proto, "constructor");
    const name = ownData(ctor, "name");
    return typeof name === "string" && /^[A-Za-z_$][\w$]{0,40}$/.test(name) ? `object (${name})` : "object (not a plain object)";
  } catch {
    return "object";
  }
}

/**
 * Canonical JSON (keys sorted, no spaces), the same text src/seal.ts canonicalJson writes for the same value.
 * Never runs the code's getters or toJSON: an accessor, a symbol key, a hidden key, a Proxy, a cycle, a class
 * instance, undefined, a function, a BigInt or a non-finite number make it "not plain JSON".
 */
function canonical(v: unknown, depth: number, seen: Set<object>, budget: { left: number }): string {
  if (budget.left < 0) throw new NotJson("", "too big");
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!NumberIsFinite(v)) throw new NotJson(typeOf(v), `it is ${StringCtor(v)}, which JSON cannot hold`);
      return JSONStringify(v);
    case "string": {
      if (v.length > budget.left) throw new NotJson("string", "too big");
      const s = JSONStringify(v);
      budget.left -= s.length;
      return s;
    }
    case "undefined":
      throw new NotJson("undefined", "it is undefined, which JSON cannot hold");
    case "function":
      throw new NotJson("function", "it is a function, which JSON cannot hold");
    case "bigint":
      throw new NotJson("bigint", "it is a BigInt, which JSON cannot hold");
    case "symbol":
      throw new NotJson("symbol", "it is a symbol, which JSON cannot hold");
  }
  const o = v as object;
  if (depth >= MAX_JSON_DEPTH) throw new NotJson(typeOf(o), `it is nested deeper than ${MAX_JSON_DEPTH} levels`); // same cap as src/seal.ts canonicalJson
  if (isProxy(o)) throw new NotJson("object (Proxy)", "it is a Proxy, whose contents Atlas does not read");
  if (seen.has(o)) throw new NotJson(typeOf(o), "it contains a cycle (an object inside itself)");
  seen.add(o);
  let out: string;
  if (ArrayIsArray(o)) {
    const keys = ReflectOwnKeys(o);
    const len = (o as unknown[]).length;
    if (keys.length !== len + 1) throw new NotJson("array", "it is a list with holes or extra properties, which JSON cannot hold exactly");
    let s = "[";
    for (let i = 0; i < len; i++) {
      const d = ObjectGetOwnPropertyDescriptor(o, StringCtor(i));
      if (!d) throw new NotJson("array", "it is a list with holes, which JSON cannot hold exactly");
      if (!ObjectHasOwn(d, "value")) throw new NotJson("array", "a list item is a getter, which Atlas does not run");
      s += (i ? "," : "") + canonical(d.value, depth + 1, seen, budget);
      budget.left -= 1;
    }
    out = `${s}]`;
  } else {
    const proto = ReflectGetPrototypeOf(o);
    if (proto !== ObjectPrototype && proto !== null) throw new NotJson(typeOf(o), "it is not a plain object (it has its own class)");
    const keys = ReflectOwnKeys(o);
    const names: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if (typeof k !== "string") throw new NotJson("object", "it has a symbol key, which JSON cannot hold");
      const d = ObjectGetOwnPropertyDescriptor(o, k)!;
      if (!d.enumerable) throw new NotJson("object", "it has a hidden (non-enumerable) key, which JSON would drop");
      if (!ObjectHasOwn(d, "value")) throw new NotJson("object", "a key is a getter, which Atlas does not run");
      append(names, k);
    }
    ReflectApply(ArraySort, names, []);
    let s = "{";
    for (let i = 0; i < names.length; i++) {
      const k = names[i]!;
      const ks = JSONStringify(k);
      budget.left -= ks.length + 2;
      s += `${i ? "," : ""}${ks}:${canonical(ObjectGetOwnPropertyDescriptor(o, k)!.value, depth + 1, seen, budget)}`;
    }
    out = `${s}}`;
  }
  seen.delete(o);
  if (budget.left < 0) throw new NotJson(typeOf(o), "too big");
  return out;
}

type Classified = { json: string; type: string } | { type: string; why: string };

/** A returned value as canonical JSON (at most RETURNED_JSON_MAX_CHARS), or why it is not stored as JSON. */
export function classifyReturned(v: unknown): Classified {
  try {
    const json = canonical(v, 0, new Set(), { left: RETURNED_JSON_MAX_CHARS });
    if (json.length > RETURNED_JSON_MAX_CHARS) return { type: typeOf(v), why: `it is ${json.length} characters as JSON; Atlas stores at most ${RETURNED_JSON_MAX_CHARS}` };
    return { json, type: typeOf(v) };
  } catch (e) {
    if (e instanceof NotJson) {
      if (e.reason === "too big") {
        let size = "";
        try {
          if (typeof v === "string") size = ` (${v.length} characters of text)`;
        } catch {
          size = "";
        }
        return { type: typeOf(v), why: `it is longer than ${RETURNED_JSON_MAX_CHARS} characters as JSON${size}; Atlas stores at most ${RETURNED_JSON_MAX_CHARS}` };
      }
      return { type: e.type || typeOf(v), why: e.reason };
    }
    return { type: typeOf(v), why: "reading it failed, so Atlas could not write it as JSON" };
  }
}

type ThrownFacts = { type: string; name?: string; nameWhy?: string; message?: string; messageWhy?: string };

/** A thrown value's name and message, read once at the moment it was thrown. A getter that throws is a fact too. */
export function classifyThrown(e: unknown): ThrownFacts {
  if (e === null || (typeof e !== "object" && typeof e !== "function")) {
    const why = `the code threw ${e === null ? "null" : `a ${typeof e}`}${typeof e === "string" ? ` (${JSONStringify(e.length > 60 ? `${e.slice(0, 59)}…` : e)})` : ""}, not an Error, so it has no`;
    return { type: e === null ? "null" : typeof e, nameWhy: `${why} name`, messageWhy: `${why} message` };
  }
  let type = "object";
  try {
    type = e instanceof ErrorCtor ? "Error" : typeOf(e);
  } catch {
    type = "object";
  }
  const out: ThrownFacts = { type };
  const read = (key: "name" | "message", max: number): { v?: string; why?: string } => {
    let raw: unknown;
    try {
      raw = (e as Record<string, unknown>)[key];
    } catch (err) {
      return { why: `reading the thrown value's ${key} threw ${describeThrown(err)}` };
    }
    if (typeof raw !== "string") return { why: `the thrown value's ${key} is ${raw === undefined ? "missing" : `not text (${typeOf(raw)})`}` };
    const text = redact(raw);
    if (text.length > max) return { why: `the thrown value's ${key} is ${text.length} characters; Atlas stores at most ${max}` };
    return { v: text };
  };
  const n = read("name", NAME_MAX_CHARS);
  if (n.v !== undefined) out.name = n.v;
  else out.nameWhy = n.why!;
  const m = read("message", MESSAGE_MAX_CHARS);
  if (m.v !== undefined) out.message = m.v;
  else out.messageWhy = m.why!;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Running one call.

export interface CallHarnessOptions {
  /** Safety cap on virtual timer firings (stops a zero-delay loop from running forever). */
  maxSteps?: number;
}

function makeError(name: string, message: string): Error {
  const Ctor = ERROR_CTORS[name];
  if (Ctor) return new Ctor(message);
  const e = new ErrorCtor(message);
  ObjectDefineProperty(e, "name", { __proto__: null, value: name, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  return e;
}

/** Resources (sockets, file reads...) alive now, by type. Atlas's clock creates none, so growth is outside work. */
function activeResources(): Map<string, number> {
  const m = new Map<string, number>();
  const list = activeResourcesInfo();
  for (let i = 0; i < list.length; i++) m.set(list[i]!, (m.get(list[i]!) ?? 0) + 1);
  return m;
}
function grownResources(before: Map<string, number>): string[] {
  const out: string[] = [];
  for (const [k, v] of activeResources()) if (v > (before.get(k) ?? 0)) append(out, k);
  return out;
}

/**
 * Calls `fn` once with the request's arguments and returns what was measured. Never throws for anything the
 * code does. A whole-run reason (see markWholeRun) is NOT returned here: the worker reads it and sends only it.
 */
export async function runCall(fn: unknown, req: CallRunRequest, opts: CallHarnessOptions = {}): Promise<CallHarnessOutput> {
  const watch = builtinWatch();
  watch();
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const watchLimitMs = req.watchLimitMs;
  const clock = new VirtualClock(req.id);
  const trace: TraceEvent[] = [];
  let dropped = 0;
  const droppedCalls = record<Record<string, number>>();
  const emit = (event: string, data?: Record<string, unknown>) => {
    if (trace.length >= MAX_TRACE_EVENTS && ALWAYS_KEPT[event] !== true) {
      dropped++;
      if (event === "stand_in_call" && data && typeof data.name === "string") put(droppedCalls, data.name, (droppedCalls[data.name] ?? 0) + 1);
      return;
    }
    const ev = record<TraceEvent>();
    put(ev, "t", clock.now);
    put(ev, "event", event);
    if (data) put(ev, "data", data);
    append(trace, ev);
  };
  const counts = new Map<string, number>();
  const standInNames: string[] = [];
  let settledAt: number | null = null;

  // ---- the arguments ----
  const args: unknown[] = [];
  for (let i = 0; i < req.args.length; i++) {
    const a = req.args[i]!;
    if (a.kind === "json") {
      append(args, JSONParse(a.json));
      continue;
    }
    const name = a.name;
    const steps = a.calls;
    const isAsync = a.async === true;
    const then = a.then;
    counts.set(name, 0);
    append(standInNames, name);
    const standIn = function (this: unknown): unknown {
      watch();
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      emit("stand_in_call", { name, n, ...(settledAt !== null ? { afterSettle: true } : {}) });
      const step: WireStep | null = n <= steps.length ? steps[n - 1]! : then === "repeat_last" ? steps[steps.length - 1]! : null;
      if (step === null) {
        const err = makeError("AtlasStandInExhausted", `${name} has no step for call ${n} (it has ${steps.length})`);
        emit("stand_in_throws", { name, n, errorName: "AtlasStandInExhausted" });
        if (isAsync) return promiseReject(err);
        throw err;
      }
      if (step.do === "throw") {
        const err = makeError(step.errorName, step.message);
        emit("stand_in_throws", { name, n, errorName: step.errorName });
        if (isAsync) return promiseReject(err);
        throw err;
      }
      if (step.do === "never_settle") {
        emit("stand_in_never_answers", { name, n });
        return new PromiseCtor<unknown>(() => {});
      }
      const value = JSONParse(step.json);
      const after = step.afterMs ?? 0;
      if (!isAsync) {
        emit("stand_in_returns", { name, n });
        return value;
      }
      if (after > 0) {
        return new PromiseCtor<unknown>((resolve) =>
          clock.schedule(
            clock.now + after,
            () => {
              emit("stand_in_returns", { name, n, afterMs: after });
              resolve(value);
            },
            { atlas: true },
          ),
        );
      }
      emit("stand_in_returns", { name, n });
      return promiseResolve(value);
    };
    ObjectDefineProperty(standIn, "name", { __proto__: null, value: name, writable: false, enumerable: false, configurable: true } as PropertyDescriptor);
    append(args, standIn);
  }

  // ---- the call ----
  type Settled = { kind: "returned"; facts: Classified } | { kind: "threw"; facts: ThrownFacts };
  let settled: Settled | null = null;
  const previous = active;
  active = clock;
  const before = activeResources();
  emit("start", { exportName: req.exportName, args: req.args.length, watchLimitMs });
  promiseThen(
    promiseThen(promiseResolve(undefined), () => ReflectApply(fn as (...a: unknown[]) => unknown, undefined, args)),
    (v: unknown) => {
      watch();
      settledAt = clock.now;
      const facts = classifyReturned(v);
      watch();
      settled = { kind: "returned", facts };
      emit("returned", "json" in facts ? { type: facts.type } : { type: facts.type, notJson: facts.why });
    },
    (e: unknown) => {
      watch();
      settledAt = clock.now;
      if (isAccessDenied(e)) markWholeRun(ACCESS_REASON("the sandbox refused an access"));
      const facts = classifyThrown(e);
      watch();
      settled = { kind: "threw", facts };
      emit("threw", { type: facts.type, ...(facts.name !== undefined ? { name: facts.name } : {}) });
    },
  );

  // ---- the virtual event loop ----
  // `stop`: Atlas stopped watching before the code went quiet. `limit`: the next timer was past the watch limit.
  let stop: string | null = null;
  let limitHit = false;
  let steps = 0;
  let realWaitMs = 0;
  raced = false;
  racedWith = "";
  try {
    for (;;) {
      await drain();
      if (watch() !== null) break;
      if (wholeRunReason !== null) break;
      if (raced) {
        stop = `the code ran background work (${racedWith || "a background job"}) while a timer was also waiting, so which finished first depends on real speed, not on the code; Atlas did not guess`;
        break;
      }
      const outside = [...grownResources(before), ...pendingOutsideWork()];
      const next = clock.peek();
      if (outside.length > 0) {
        // Background work (a hash, a compression step) takes real time but no virtual time. When it is the ONLY
        // thing left, Atlas waits for it for real, which is what a real run does. When a virtual timer is also
        // waiting, which finishes first would be a guess, so Atlas stops there (can't check).
        if (!next && realWaitMs < OUTSIDE_WAIT_MS) {
          realWaitMs += 1;
          await realPause();
          continue;
        }
        stop = `the code is waiting on something Atlas does not control (${outside.join(", ")})${next ? " while a timer is also waiting, so which comes first is not known" : ""}; Atlas did not wait for it`;
        break;
      }
      if (!next) break; // nothing scheduled and the queue is drained: quiet (settled) or never settles
      if (next.at > watchLimitMs) {
        limitHit = true;
        break;
      }
      if (++steps > maxSteps) {
        stop = `Atlas's step limit (${maxSteps} timer firings, Atlas's limit, not the code's) ended the run before the code went quiet`;
        break;
      }
      clock.now = next.at;
      clock.take(next);
      next.fire();
    }
  } finally {
    active = previous;
  }
  if (raced && stop === null) stop = "the code ran background work while a timer was also waiting, so which finished first depends on real speed, not on the code; Atlas did not guess";
  const s = settled as Settled | null;
  if (raced) emit("stopped_watching", { reason: stop ?? "background work raced a timer" });
  else if (s === null && settledAt === null) emit(limitHit ? "still_running_at_watch_limit" : stop ? "stopped_watching" : "never_settled", stop ? { reason: stop } : undefined);
  else if (stop || limitHit) emit("stopped_watching_after_settle", { reason: stop ?? `Atlas's watch limit (${watchLimitMs} ms of virtual time) ran out while the code's timers were still running after it settled` });

  if (dropped > 0) {
    const ev = record<TraceEvent>();
    put(ev, "t", clock.now);
    put(ev, "event", "trace_cut");
    // E3 review r2 minor 9: `kept` is the number really kept (the endings are kept past the cap).
    put(ev, "data", { kept: trace.length, dropped, droppedCalls });
    append(trace, ev);
  }

  // ---- measured facts ----
  const measured = record<RunResult["measured"]>();
  const notMeasured = record<RunResult["notMeasured"]>();
  const limitWords = `Atlas's watch limit (${watchLimitMs} ms of virtual time, Atlas's limit, not the code's)`;
  const callNames = () => standInNames.map((n) => `calls:${n}`);

  if (s === null || raced) {
    if (stop) {
      for (const k of ["outcome", "returnedJson", "returnedType", "thrownName", "thrownMessage", "virtualMs"]) put(notMeasured, k, `${stop}, so how the call ends was not seen`);
      for (const n of standInNames) put(notMeasured, `calls:${n}`, `${stop}; the count so far was ${counts.get(n) ?? 0}`);
    } else if (limitHit) {
      put(measured, "outcome", "still_running_at_watch_limit");
      const why = `the call was still running when ${limitWords} ran out`;
      for (const k of ["returnedJson", "returnedType", "thrownName", "thrownMessage", "virtualMs"]) put(notMeasured, k, why);
      for (const n of standInNames) put(notMeasured, `calls:${n}`, `${why}, so the final count was not seen; the count so far was ${counts.get(n) ?? 0}`);
    } else {
      put(measured, "outcome", "never_settled");
      const why = "the call never settled: it was still waiting with nothing left that could wake it";
      for (const k of ["returnedJson", "returnedType", "thrownName", "thrownMessage"]) put(notMeasured, k, why);
      put(notMeasured, "virtualMs", `${why}, so it has no settle time`);
      for (const n of standInNames) put(measured, `calls:${n}`, counts.get(n) ?? 0);
    }
    return plain({ trace, result: { measured, notMeasured } });
  }

  put(measured, "outcome", s.kind);
  put(measured, "virtualMs", settledAt!);
  if (s.kind === "returned") {
    const f = s.facts;
    put(measured, "returnedType", f.type);
    if ("json" in f) put(measured, "returnedJson", f.json);
    else put(notMeasured, "returnedJson", `the returned value is not stored as plain JSON: ${f.why}`);
    put(notMeasured, "thrownName", "the call returned, so nothing was thrown");
    put(notMeasured, "thrownMessage", "the call returned, so nothing was thrown");
  } else {
    const f = s.facts;
    put(measured, "thrownType", f.type);
    if (f.name !== undefined) put(measured, "thrownName", f.name);
    else put(notMeasured, "thrownName", f.nameWhy!);
    if (f.message !== undefined) put(measured, "thrownMessage", f.message);
    else put(notMeasured, "thrownMessage", f.messageWhy!);
    put(notMeasured, "returnedJson", "the call threw, so it returned nothing");
    put(notMeasured, "returnedType", "the call threw, so it returned nothing");
  }
  if (stop || limitHit) {
    const why = stop ?? `the code still had timers running after the call settled when ${limitWords} ran out`;
    for (const k of callNames()) put(notMeasured, k, `${why}, so the final count was not seen; the count so far was ${counts.get(k.slice(6)) ?? 0}`);
  } else {
    for (const n of standInNames) put(measured, `calls:${n}`, counts.get(n) ?? 0);
  }
  return plain({ trace, result: { measured, notMeasured } });
}
