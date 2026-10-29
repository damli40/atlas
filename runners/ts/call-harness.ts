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
  TIMER_ORDER_REASON,
  UNCAUGHT_REASON,
  UNREF_AFTER_SETTLE_REASON,
  UNREF_REASON,
  UNSEEDED_RANDOM_REASON,
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
const TextEncoderCtor = TextEncoder;
const DOMExceptionCtor = g.DOMException as (new (message: string, name: string) => Error) | undefined;
const MathImul = Math.imul;
const Uint8ArrayCtor = Uint8Array;
const TypedArrayProto = ReflectGetPrototypeOf(Uint8Array.prototype) as object;
const taBuffer = ObjectGetOwnPropertyDescriptor(TypedArrayProto, "buffer")!.get!;
const taByteOffset = ObjectGetOwnPropertyDescriptor(TypedArrayProto, "byteOffset")!.get!;
const taByteLength = ObjectGetOwnPropertyDescriptor(TypedArrayProto, "byteLength")!.get!;

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
/** U2: the most clock moments one run's "clock_moves" event lists (the rest are counted as `more`). */
const MAX_CLOCK_MOVES = 300;
/** U2 review m6: Node's built-in fetch stops waiting for a server's headers after this long (undici headersTimeout). */
export const NODE_FETCH_GIVES_UP_MS = 300_000;
const ALWAYS_KEPT: Record<string, true> = { __proto__: null, clock_moves: true, start: true, returned: true, threw: true, never_settled: true, still_running_at_watch_limit: true, stopped_watching: true, stopped_watching_after_settle: true } as unknown as Record<string, true>;

// ---------------------------------------------------------------------------------------------
// The request (written by runners/ts/call-runner.ts; JSON values travel as text so they arrive as ordinary
// objects, never as the prototype-free records the worker reads the request into).

export type WireStep = { do: "return"; json: string; afterMs?: number } | { do: "throw"; errorName: string; message: string } | { do: "never_settle" };
export type WireArg =
  | { kind: "json"; json: string }
  | { kind: "stand-in"; name: string; async: boolean; calls: WireStep[]; then: "repeat_last" | "throw_exhausted" };
/** U2 (D53): one step of the fake network, as the worker reads it (the body travels as JSON text). */
export type WireNetStep = { do: "respond"; status: number; json: string; afterMs?: number } | { do: "throw"; errorName: string; message: string } | { do: "never_answer" };
export interface CallRunRequest {
  id: string;
  exportName: string;
  args: WireArg[];
  watchLimitMs: number;
  /** U2 (D53): the scripted fake installed as the global `fetch` for this run (the real network stays blocked). */
  network?: { name: "fetch" | "requests" | "urllib" | "httpx"; calls: WireNetStep[]; then: "repeat_last" | "throw_exhausted" };
}
export interface CallWorkerRequest {
  /** "target.ts" or "target.mjs": the file the worker imports. */
  targetFile: string;
  runs: CallRunRequest[];
  /** R1 (D42): the seed every random source is pinned to (the runner records it in the Run). */
  seed: string;
  /** R1 (D42): the time zone and locale the sandbox must have; the worker checks them before the code exists. */
  pins: { timeZone: string; locale: string };
  /** R2 (D45): the second run of the double run only: ms the clock moves at each repeated read at one moment. */
  nudgeClockMs?: number;
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
// R1 (D42): conditions. What a result depends on that is Atlas's (its clock, its seed, its time zone and locale) or
// nobody's (an order Node leaves open, a timer that does not keep the process alive). Each kind is a word from
// src/conditions.ts CONDITION_KINDS; the run's trace ends with one "conditions" event listing them. Kinds noticed
// while the file loads (no run active) count for every run. Module-private, like the whole-run reason.

const loadConds = record<Record<string, true>>();
let runConds = record<Record<string, true>>();
/** Set when how the call ends depends on something outside the code; the first reason wins. */
let undecided: string | null = null;
/** The virtual time of the last clock read in this run. */
let lastReadAt = -1;
/** R1 review B1: what the code read about the machine, by name (the "host" condition says which). */
let hostReads = record<Record<string, true>>();
const loadHostReads = record<Record<string, true>>();
/** True only while the called function's own synchronous part runs (before it returns its promise). */
let inSyncCall = false;

function noteCondition(kind: string): void {
  put(active ? runConds : loadConds, kind, true);
}
function noteUndecided(kind: string, reason: string): void {
  noteCondition(kind);
  if (active && undecided === null) undecided = reason;
}
/**
 * R2 (D45): the second run of the double run plays the code as if its work took time. Each repeated read at one
 * virtual moment adds time to the run's drift: clockNudgeMs (10 ms) for a stopwatch clock (performance.now,
 * process.hrtime, process.uptime), and a whole 1 ms for the calendar clock (Date.now, new Date(), Intl), so Date.now()
 * stays a whole number and a Date (whole ms) shows it (R2 review B3, M2). The drift stays added for the rest of the
 * run, as real time would. Only the readings move; the virtual clock and its timers do not. The run's drift is written
 * in its "conditions" event (driftMs), so the call's time can also be compared as the code saw it (src/conditions.ts
 * twinComparable, R2 review M1). 0 in the first run.
 */
let clockNudgeMs = 0;
let driftMs = 0;
/** R2 (D45): the worker sets the second run's nudge (src/conditions.ts CLOCK_NUDGE_MS) before the code loads. */
export function setClockNudge(ms: number): void {
  clockNudgeMs = ms;
}
/**
 * The code read the clock. R1 review M1-M3: two or more reads at one moment of the virtual clock mean the code timed
 * its own work, which takes no time here ("timed-work"). Decided from the code's own reads, never from CPU time, so
 * the same test gives the same answer on every machine. Returns the ms to add to this reading: the run's drift
 * (R2, D45), always 0 in the first run.
 */
function noteClockRead(stopwatch: boolean): number {
  noteCondition("clock");
  if (!active) return 0;
  if (lastReadAt === active.now) {
    noteCondition("timed-work");
    driftMs += stopwatch ? clockNudgeMs : clockNudgeMs / 10;
  }
  lastReadAt = active.now;
  return driftMs;
}
const noteHost = () => noteCondition("time-zone-or-locale");
/**
 * R1 review M3: date text that does not depend on the time zone: an ISO date alone (read as UTC by the standard) or an
 * ISO date and time with "Z" or an offset. Any other text may be read as local time.
 */
const ZONED_DATE_TEXT = /^[+-]?\d{4,6}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
/** R1 review round 2: the worker notes, while the file loads, a detail it sees in the file itself (import.meta). */
export function noteLoadHost(what: string): void {
  noteHostRead(what);
}
/** R1 review B1: the code read a detail of the machine (process id, platform, CPU count, a stack trace's paths, ...). */
function noteHostRead(what: string): void {
  noteCondition("host");
  put(active ? hostReads : loadHostReads, what, true);
}

// ---- R1 (D42): seeded randomness. sfc32, seeded from the seed text (cyrb128); the same seed gives the same values
// on every machine, because it is plain 32-bit arithmetic. Math.random, crypto.getRandomValues and
// crypto.randomUUID all draw from it.
const rng = new Uint32Array(4);
function nextU32(): number {
  const a = rng[0]!;
  const b = rng[1]!;
  const c = rng[2]!;
  const d = rng[3]!;
  const t = (((a + b) >>> 0) + d) >>> 0;
  rng[3] = (d + 1) >>> 0;
  rng[0] = (b ^ (b >>> 9)) >>> 0;
  rng[1] = (c + (c << 3)) >>> 0;
  const r = ((c << 21) | (c >>> 11)) >>> 0;
  rng[2] = (r + t) >>> 0;
  return t;
}
/** Seeds every random source the code can reach. The worker calls it with the run's seed before the code loads. */
export function seedRandomness(seed: string): void {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ MathImul(h1 ^ k, 597399067);
    h2 = h3 ^ MathImul(h2 ^ k, 2869860233);
    h3 = h4 ^ MathImul(h3 ^ k, 951274213);
    h4 = h1 ^ MathImul(h4 ^ k, 2716044179);
  }
  h1 = MathImul(h3 ^ (h1 >>> 18), 597399067);
  h2 = MathImul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = MathImul(h1 ^ (h3 >>> 17), 951274213);
  h4 = MathImul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  rng[0] = h1 >>> 0;
  rng[1] = h2 >>> 0;
  rng[2] = h3 >>> 0;
  rng[3] = h4 >>> 0;
  for (let i = 0; i < 15; i++) nextU32();
}
seedRandomness("1");
/** A number in [0, 1) with 53 random bits, like Math.random. */
function seededFloat(): number {
  return ((nextU32() >>> 5) * 67108864 + (nextU32() >>> 6)) / 9007199254740992;
}
function seededFill(bytes: Uint8Array): void {
  let w = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (i % 4 === 0) w = nextU32();
    bytes[i] = (w >>> ((i % 4) * 8)) & 255;
  }
}
const HEX = "0123456789abcdef";
function seededUuid(): string {
  const b = new Uint8ArrayCtor(16);
  seededFill(b);
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  let s = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += "-";
    s += HEX[b[i]! >>> 4]! + HEX[b[i]! & 15]!;
  }
  return s;
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
  /** R1: a setImmediate callback (due at once, after the current callbacks). */
  immediate: boolean;
  /** R1: false after unref(): this timer alone does not keep a real Node process alive. */
  ref: boolean;
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
  schedule(at: number, fire: () => void, opts: { every?: number; atlas?: boolean; immediate?: boolean; ref?: boolean } = {}): VTimer {
    if (outsideWork.size > 0) markRaced(outsideWork.values().next().value as string); // a timer set while background work is in flight
    const t: VTimer = { id: this.nextId++, at, seq: this.seq++, fire, live: true, atlas: opts.atlas === true, immediate: opts.immediate === true, ref: opts.ref !== false };
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
  /** R1: true when some live timer would keep a real Node process alive (Atlas's own stand-in answers stand for real I/O, which does). */
  hasRef(): boolean {
    for (let i = 0; i < this.timers.length; i++) if (this.timers[i]!.live && this.timers[i]!.ref) return true;
    return false;
  }
  /** R1: true when a live timer of the code matches `test`. */
  anyCodeTimer(test: (t: VTimer) => boolean): boolean {
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i]!;
      if (t.live && !t.atlas && test(t)) return true;
    }
    return false;
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
  // R1 (review MINOR 3): ref/unref are recorded, and hasRef tells the truth. A call left waiting only on unref'd
  // timers is "can't check" (a plain script would exit first; a program that stays up would not).
  ref() {
    if (this.#timer) this.#timer.ref = true;
    return this;
  }
  unref() {
    if (this.#timer) this.#timer.ref = false;
    return this;
  }
  hasRef() {
    return this.#timer ? this.#timer.ref : true;
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

function startTimer(cb: (...a: unknown[]) => unknown, args: unknown[], ms: number, every: boolean, kind: { immediate?: boolean; ref?: boolean } = {}): VTimeout {
  const c = active;
  if (!c) {
    loadTimers += 1;
    return new VTimeout(null, null, ms);
  }
  // R1 (review M-2): a setImmediate next to a timer due within 1 ms. Real Node runs them in either order (the
  // review saw 26 of 30 one way); Atlas's order would be its own choice, so how the call ends is not reported.
  const now = c.now;
  if (kind.immediate === true ? c.anyCodeTimer((x) => !x.immediate && x.at > now && x.at <= now + 1) : ms <= 1 && c.anyCodeTimer((x) => x.immediate)) {
    noteUndecided("timer-order", TIMER_ORDER_REASON);
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
    { ...(every ? { every: ms } : {}), ...(kind.immediate === true ? { immediate: true } : {}), ...(kind.ref === false ? { ref: false } : {}) },
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
    return startTimer(cb as (...a: unknown[]) => unknown, args, 0, false, { immediate: true });
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
  // R1 (D42): every read of the clock is noted (the "conditions" line), and two reads at one virtual moment with real
  // work between them make how the call ends "can't check" (noteClockRead).
  const virtualNow = () => {
    const nudge = noteClockRead(false);
    return VIRTUAL_EPOCH_MS + (active ? active.now : 0) + nudge;
  };
  const realToString = RealDate.prototype.toString;
  const FakeDate = function Date(this: unknown, ...a: unknown[]) {
    if (!new.target) {
      noteHost(); // Date() as a function gives the local time as text
      return ReflectApply(realToString, new RealDate(virtualNow()), []);
    }
    // Local date parts (new Date(2026, 0, 1)) or a date text (which may be read as local time) depend on the time zone.
    if (a.length >= 2 || (a.length === 1 && typeof a[0] === "string" && !ZONED_DATE_TEXT.test(a[0]))) noteHost();
    return ReflectConstruct(RealDate, a.length === 0 ? [virtualNow()] : a, new.target);
  } as unknown as DateConstructor;
  ObjectDefineProperty(FakeDate, "prototype", { __proto__: null, value: RealDate.prototype, writable: false, enumerable: false, configurable: false } as PropertyDescriptor);
  ObjectDefineProperty(FakeDate, "now", { __proto__: null, value: function now() { return virtualNow(); }, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  const realParse = RealDate.parse;
  ObjectDefineProperty(FakeDate, "parse", {
    __proto__: null,
    value: function parse(s: unknown) {
      if (!(typeof s === "string" && ZONED_DATE_TEXT.test(s))) noteHost();
      return ReflectApply(realParse, RealDate, [s]);
    },
    writable: true,
    enumerable: false,
    configurable: true,
  } as PropertyDescriptor);
  ObjectDefineProperty(FakeDate, "UTC", { __proto__: null, value: RealDate.UTC, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(RealDate.prototype, "constructor", { __proto__: null, value: FakeDate, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  g.Date = FakeDate;
  const perf = g.performance as Record<string, unknown> | undefined;
  if (perf) {
    ObjectDefineProperty(perf, "now", { __proto__: null, value: function now() { const nudge = noteClockRead(true); return (active ? active.now : 0) + nudge; }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
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
        // R1 (review MINOR 3): Node's own timer here is unref'd, so Atlas's is too.
        startTimer(() => c.abort(new RealDOMException("The operation was aborted due to timeout", "TimeoutError")), [], delay, false, { ref: false });
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
    const nudge = noteClockRead(true);
    const ms = (active ? active.now : 0) + nudge;
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
  ObjectDefineProperty(hrtime, "bigint", { __proto__: null, value: function bigint() { const nudge = noteClockRead(true); return BigIntCtor(MathTrunc(((active ? active.now : 0) + nudge) * 1e6)); }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(process, "hrtime", { __proto__: null, value: hrtime, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
  ObjectDefineProperty(process, "uptime", { __proto__: null, value: function uptime() { const nudge = noteClockRead(true); return ((active ? active.now : 0) + nudge) / 1000; }, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);

  installSeededRandomness();
  installOrderAndHostNotes();
}

const defHidden = (obj: object, key: PropertyKey, value: unknown) =>
  ObjectDefineProperty(obj, key, { __proto__: null, value, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);

/**
 * R1 (D42): every random source the code can reach without an import draws from Atlas's seeded generator, and each
 * use is noted. Randomness Atlas cannot seed (crypto.subtle making keys, randomized signatures and encryption) makes
 * how the call ends "can't check" instead.
 */
function installSeededRandomness(): void {
  defHidden(Math, "random", function random() {
    noteCondition("randomness");
    return seededFloat();
  });
  const cryptoObj = g.crypto as object | undefined;
  if (!cryptoObj) return;
  const proto = ReflectGetPrototypeOf(cryptoObj) as Record<string, unknown> | null;
  if (!proto) return;
  const realGRV = proto.getRandomValues as ((a: unknown) => unknown) | undefined;
  const realUUID = proto.randomUUID as (() => unknown) | undefined;
  if (typeof realGRV === "function") {
    defHidden(proto, "getRandomValues", function getRandomValues(this: unknown, arr: unknown) {
      // The real call first: it checks the argument and throws Node's own errors (wrong type, more than 65,536 bytes).
      const out = ReflectApply(realGRV, this, [arr]);
      noteCondition("randomness");
      seededFill(new Uint8ArrayCtor(ReflectApply(taBuffer, arr, []) as ArrayBuffer, ReflectApply(taByteOffset, arr, []) as number, ReflectApply(taByteLength, arr, []) as number));
      return out;
    });
  }
  if (typeof realUUID === "function") {
    defHidden(proto, "randomUUID", function randomUUID(this: unknown) {
      if (this !== cryptoObj) return ReflectApply(realUUID, this, []); // Node's own "illegal invocation" error
      noteCondition("randomness");
      return seededUuid();
    });
  }
  const subtle = ObjectGetOwnPropertyDescriptor(proto, "subtle")?.get;
  const subtleObj = subtle ? (ReflectApply(subtle, cryptoObj, []) as object) : undefined;
  const sp = subtleObj ? (ReflectGetPrototypeOf(subtleObj) as Record<string, unknown> | null) : null;
  if (!sp) return;
  const RANDOMIZED = /^(ECDSA|RSA-PSS|RSA-OAEP|ML-DSA)/i;
  const algName = (alg: unknown) => (typeof alg === "string" ? alg : alg !== null && typeof alg === "object" ? ownData(alg, "name") : undefined);
  for (const name of ["generateKey", "encapsulateKey", "encapsulateBits", "sign", "encrypt", "wrapKey"]) {
    const real = sp[name];
    if (typeof real !== "function") continue;
    defHidden(sp, name, function (this: unknown, ...a: unknown[]) {
      const alg = algName(name === "wrapKey" ? a[3] : a[0]);
      if (name === "generateKey" || name.startsWith("encapsulate") || (typeof alg === "string" && RANDOMIZED.test(alg))) {
        noteUndecided("unseeded-randomness", UNSEEDED_RANDOM_REASON(`crypto.subtle.${name}${typeof alg === "string" ? ` (${alg.slice(0, 20)})` : ""}`));
      }
      return ReflectApply(real as (...x: unknown[]) => unknown, this, a);
    });
  }
}

/**
 * R1 (D42): process.nextTick from the call's own synchronous part (its order against promise callbacks depends on how
 * the caller starts the call), and every read of the time zone or the locale (Atlas runs in UTC with en-US).
 */
function installOrderAndHostNotes(): void {
  // R1 review M3: only IMPLICIT dependence counts. A call that names its locale (and, for dates, its time zone) does
  // not depend on Atlas's pins, so it gets no condition. `explicit` reads the arguments without running any getter.
  // R1 review round 2 (B3): [] and undefined both mean "the default locale". A locale is named only when it is a
  // non-empty string, or a non-empty list whose items are all non-empty strings.
  const named = (v: unknown) =>
    (typeof v === "string" && v.length > 0) || (ArrayIsArray(v) && (v as unknown[]).length > 0 && (v as unknown[]).every((x) => typeof x === "string" && x.length > 0));
  const zoneNamed = (opts: unknown) => opts !== null && typeof opts === "object" && typeof ownData(opts, "timeZone") === "string";
  const wrapHost = (obj: object | undefined, names: string[], explicit: (a: unknown[]) => boolean = () => false) => {
    if (!obj) return;
    for (const name of names) {
      const d = ObjectGetOwnPropertyDescriptor(obj, name);
      if (!d || typeof d.value !== "function") continue;
      const real = d.value as (...x: unknown[]) => unknown;
      const w = function (this: unknown, ...a: unknown[]) {
        if (!explicit(a)) noteHost();
        return ReflectApply(real, this, a);
      };
      ObjectDefineProperty(w, "name", { __proto__: null, value: name, writable: false, enumerable: false, configurable: true } as PropertyDescriptor);
      ObjectDefineProperty(obj, name, { __proto__: null, value: w, writable: d.writable, enumerable: d.enumerable, configurable: true } as PropertyDescriptor);
    }
  };
  // Date methods that read or write LOCAL time (the UTC ones and toISOString / toJSON do not).
  wrapHost(RealDate.prototype, ["getFullYear", "getYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes", "getTimezoneOffset", "setFullYear", "setYear", "setMonth", "setDate", "setHours", "setMinutes", "toString", "toDateString", "toTimeString"]);
  wrapHost(RealDate.prototype, ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"], (a) => named(a[0]) && zoneNamed(a[1]));
  wrapHost(Number.prototype, ["toLocaleString"], (a) => named(a[0]));
  wrapHost(BigInt.prototype, ["toLocaleString"], (a) => named(a[0]));
  wrapHost(Array.prototype, ["toLocaleString"], (a) => named(a[0]));
  wrapHost(String.prototype, ["localeCompare"], (a) => named(a[1]));
  wrapHost(String.prototype, ["toLocaleUpperCase", "toLocaleLowerCase"], (a) => named(a[0]));
  const intl = g.Intl as Record<string, unknown> | undefined;
  if (intl) {
    for (const name of ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter", "DurationFormat"]) {
      const real = intl[name];
      if (typeof real !== "function") continue;
      const explicit = (a: unknown[]) => named(a[0]) && (name !== "DateTimeFormat" || zoneNamed(a[1]));
      defHidden(intl, name, new Proxy(real as (...x: unknown[]) => unknown, {
        apply(t, thisArg, a) {
          if (!explicit(a)) noteHost();
          return ReflectApply(t, thisArg, a);
        },
        construct(t, a, nt) {
          if (!explicit(a)) noteHost();
          return ReflectConstruct(t, a, nt);
        },
      }));
    }
  }
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
    const w = function (this: unknown, ...a: unknown[]) {
      try {
        return ReflectApply(orig, this, a);
      } catch (e) {
        if (isAccessDenied(e)) markWholeRun(ACCESS_REASON(label));
        throw e;
      }
    };
    // R1 review: keep the function's own extras (process.memoryUsage.rss, process.hrtime.bigint).
    const extra = ReflectOwnKeys(orig);
    for (let i = 0; i < extra.length; i++) {
      const k = extra[i]!;
      if (k === "length" || k === "name" || k === "prototype") continue;
      const kd = ObjectGetOwnPropertyDescriptor(orig, k);
      if (kd) ObjectDefineProperty(w, k, kd);
    }
    def(obj, key, w);
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
  // R1 (review MINOR 4): process.nextTick called by the code itself during the call's synchronous part. Its order
  // against promise callbacks depends on how the caller starts the call (Atlas starts it inside a promise callback, so
  // promises run first; a CommonJS script calling it directly runs the tick first). Installed last, so it wraps the
  // access watcher above; Node's own internals (console.log's stream, for one) also call process.nextTick, and those
  // calls are told apart by their caller (a node: frame) and do not count.
  // R1 review M3: disclosed, not refused. Atlas calls the function from a plain async function (promise callbacks run
  // first, as in an ES module); the "tick-order" condition says so.
  const realNextTick = process.nextTick;
  const nextTick = function nextTick(...a: unknown[]) {
    if (inSyncCall && !calledFromNode(nextTick)) noteCondition("tick-order");
    return ReflectApply(realNextTick, process, a);
  };
  defHidden(process, "nextTick", nextTick);
  installHostReadNotes();
}

/**
 * R1 review B1: reads of the machine the code runs on. Values that change between runs (a process id, a memory
 * figure, a temp-folder path) are caught by the double run; values that stay the same here but differ by machine (the
 * platform, the CPU count) are measured and the "host" condition names them.
 */
function installHostReadNotes(): void {
  const proc = process as unknown as Record<string, unknown>;
  for (const name of ["pid", "ppid", "platform", "arch", "version", "versions", "release", "execPath", "argv", "argv0", "execArgv", "title", "config", "features"]) {
    const d = ObjectGetOwnPropertyDescriptor(proc, name);
    if (!d || !d.configurable) continue;
    const getReal = d.get ? (d.get as () => unknown) : null;
    const value = d.value;
    ObjectDefineProperty(proc, name, {
      __proto__: null,
      get() {
        noteHostRead(`process.${name}`);
        return getReal ? ReflectApply(getReal, proc, []) : value;
      },
      set: d.set,
      enumerable: d.enumerable,
      configurable: true,
    } as PropertyDescriptor);
  }
  for (const name of ["cwd", "memoryUsage", "availableMemory", "constrainedMemory", "getuid", "geteuid", "getgid", "getegid", "getgroups", "umask", "uptime", "getActiveResourcesInfo"]) {
    const real = proc[name];
    if (typeof real !== "function" || name === "uptime") continue; // uptime is Atlas's clock (installVirtualClock)
    const w = function (this: unknown, ...a: unknown[]) {
      noteHostRead(`process.${name}()`);
      return ReflectApply(real as (...x: unknown[]) => unknown, this, a);
    };
    for (const k of ReflectOwnKeys(real as object)) {
      if (k === "length" || k === "name" || k === "prototype") continue;
      const kd = ObjectGetOwnPropertyDescriptor(real as object, k);
      if (kd) ObjectDefineProperty(w, k, kd); // process.memoryUsage.rss() and friends
    }
    defHidden(proc, name, w);
  }
  // R1 review round 2 (B1): process.env holds only Atlas's pins, so any read of it is Atlas's sandbox, not the code:
  // the time zone / locale variables count as time-zone-or-locale, every other read (a key, the list of keys) as host.
  // Reads made by Node's own code (a "node:" caller) do not count.
  const envD = ObjectGetOwnPropertyDescriptor(proc, "env");
  if (envD && envD.configurable && envD.value && typeof envD.value === "object") {
    const realEnv = envD.value as Record<string, unknown>;
    const zoneKey = (k: unknown) => typeof k === "string" && (k === "TZ" || k === "LANG" || k === "LANGUAGE" || k.startsWith("LC_"));
    const noteEnv = (k: unknown, trap: unknown) => {
      if (calledFromNode(trap)) return;
      if (zoneKey(k)) noteHost();
      else noteHostRead("process.env");
    };
    const traps: ProxyHandler<Record<string, unknown>> = {
      get(t, k) {
        if (typeof k === "string") noteEnv(k, traps.get);
        return t[k as string];
      },
      has(t, k) {
        noteEnv(k, traps.has);
        return k in t;
      },
      ownKeys(t) {
        noteEnv(undefined, traps.ownKeys);
        return ReflectOwnKeys(t);
      },
      getOwnPropertyDescriptor(t, k) {
        noteEnv(k, traps.getOwnPropertyDescriptor);
        return ObjectGetOwnPropertyDescriptor(t, k);
      },
    };
    ObjectDefineProperty(proc, "env", { __proto__: null, value: new Proxy(realEnv, traps), writable: true, enumerable: envD.enumerable, configurable: true } as PropertyDescriptor);
  }
  const nav = g.navigator as object | undefined;
  const navProto = nav ? (ReflectGetPrototypeOf(nav) as object | null) : null;
  if (navProto) {
    for (const name of ["hardwareConcurrency", "platform", "userAgent", "language", "languages"]) {
      const d = ObjectGetOwnPropertyDescriptor(navProto, name);
      if (!d || !d.get || !d.configurable) continue;
      const getReal = d.get as () => unknown;
      ObjectDefineProperty(navProto, name, {
        __proto__: null,
        get() {
          if (name === "language" || name === "languages") noteHost();
          else noteHostRead(`navigator.${name}`);
          return ReflectApply(getReal, this, []);
        },
        enumerable: d.enumerable,
        configurable: true,
      } as PropertyDescriptor);
    }
  }
  // A stack trace names the files and folders the code runs from. V8 asks Error.prepareStackTrace when the code first
  // reads an error's .stack; Atlas notes it there and writes V8's own format. Atlas's own reads are not counted.
  const ErrorProtoToString = ErrorCtor.prototype.toString;
  defHidden(ErrorCtor, "prepareStackTrace", function prepareStackTrace(err: unknown, frames: unknown[]) {
    if (!atlasReadingStack) noteHostRead("an error's stack trace (file paths)");
    let head = "Error";
    try {
      head = ReflectApply(ErrorProtoToString, err, []) as string;
    } catch {
      head = "Error";
    }
    let s = head;
    for (let i = 0; i < frames.length; i++) s += `\n    at ${StringCtor(frames[i])}`;
    return s;
  });
}
let atlasReadingStack = false;

const ErrorCaptureStackTrace = (ErrorCtor as unknown as { captureStackTrace: (o: object, f: unknown) => void }).captureStackTrace;
const StringSplit = String.prototype.split;
const StringIncludes = String.prototype.includes;
/** True when the function that called `below` is Node's own code (a "node:" frame), not the code under test. */
function calledFromNode(below: unknown): boolean {
  const holder: { stack?: unknown } = {};
  let st: unknown;
  atlasReadingStack = true;
  try {
    ReflectApply(ErrorCaptureStackTrace, ErrorCtor, [holder, below]);
    st = holder.stack;
  } catch {
    return false;
  } finally {
    atlasReadingStack = false;
  }
  if (typeof st !== "string") return false;
  const lines = ReflectApply(StringSplit, st, ["\n"]) as string[];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (ReflectApply(StringIncludes, line, ["call-harness.ts"]) as boolean) continue; // Atlas's own wrappers
    return (ReflectApply(StringIncludes, line, ["(node:"]) as boolean) || (ReflectApply(StringIncludes, line, ["at node:"]) as boolean);
  }
  return false;
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
  /** R1 (review B-1): where inside the returned value the problem is ("" = the value itself), e.g. "[0]" or ".when". */
  path = "";
  constructor(type: string, reason: string) {
    this.type = type;
    this.reason = reason;
  }
}

const IDENT = /^[A-Za-z_$][\w$]{0,30}$/;
/** Adds one step of the path to a problem found inside a list or object (never for "too big", which has no place). */
function inside(e: unknown, step: string): unknown {
  if (e instanceof NotJson && e.reason !== "too big" && e.path.length < 80) e.path = step + e.path;
  return e;
}
const keyStep = (k: string) => (IDENT.test(k) ? `.${k}` : `[${JSONStringify(k.length > 30 ? `${k.slice(0, 29)}…` : k)}]`);

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
      try {
        s += (i ? "," : "") + canonical(d.value, depth + 1, seen, budget);
      } catch (e) {
        throw inside(e, `[${i}]`);
      }
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
      try {
        s += `${i ? "," : ""}${ks}:${canonical(ObjectGetOwnPropertyDescriptor(o, k)!.value, depth + 1, seen, budget)}`;
      } catch (e) {
        throw inside(e, keyStep(k));
      }
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
      // R1 (review B-1): the type is always the RETURNED value's own (a list holding a BigInt is an array); the item
      // inside that JSON cannot hold is named in the reason, with where it is.
      if (e.path !== "") return { type: typeOf(v), why: `an item inside it (at ${e.path}${e.type ? `, ${e.type}` : ""}) is not plain JSON: ${e.reason}` };
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

  // ---- U2 (D53): the fake network, installed as the global fetch for this run only ----
  // Counted like a stand-in (calls:fetch, the same trace events). A Response-like answer: status, ok, headers,
  // json() and text() of the scripted body. A call that never answers waits until the code's own AbortSignal aborts it
  // (fetch has no timeout of its own), as real fetch does.
  const net = req.network && req.network.name === "fetch" ? req.network : undefined;
  let netPending = 0;
  let fetchBefore: PropertyDescriptor | undefined;
  if (net) {
    const name = net.name;
    const steps = net.calls;
    counts.set(name, 0);
    append(standInNames, name);
    const abortError = (signal: unknown): unknown => {
      const reason = signal && typeof signal === "object" ? (signal as { reason?: unknown }).reason : undefined;
      if (reason !== undefined) return reason;
      return DOMExceptionCtor ? new DOMExceptionCtor("This operation was aborted", "AbortError") : makeError("AbortError", "This operation was aborted");
    };
    // Review M3/M4: the body on the wire is the scripted body as JSON text, once. text() gives those bytes and json()
    // parses them, so the two always agree; a body can be read once (a second read rejects with TypeError, as in real
    // fetch); arrayBuffer() and blob()-less code paths read the same bytes.
    const response = (status: number, json: string, url: string): Record<string, unknown> => {
      let used = false;
      const read = <T>(f: () => T): Promise<T> => {
        if (used) return promiseReject(makeError("TypeError", "Body is unusable: Body has already been read"));
        used = true;
        r.bodyUsed = true;
        try {
          return promiseResolve(f()) as Promise<T>;
        } catch (e) {
          return promiseReject(e);
        }
      };
      const r: Record<string, unknown> = {
        status,
        ok: status >= 200 && status <= 299,
        statusText: "",
        url,
        redirected: false,
        type: "basic",
        bodyUsed: false,
        headers: {
          get: (k: unknown) => (StringCtor(k).toLowerCase() === "content-type" ? "application/json" : null),
          has: (k: unknown) => StringCtor(k).toLowerCase() === "content-type",
          forEach: (cb: (v: string, k: string) => void) => cb("application/json", "content-type"),
        },
        json: () => read(() => JSONParse(json)),
        text: () => read(() => json),
        arrayBuffer: () => read(() => new TextEncoderCtor().encode(json).buffer),
        bytes: () => read(() => new TextEncoderCtor().encode(json)),
        clone: () => {
          if (used) throw makeError("TypeError", "Response.clone: Body has already been consumed.");
          return response(status, json, url);
        },
      };
      return r;
    };
    const fakeFetch = function fetch(this: unknown, input?: unknown, init?: unknown): Promise<unknown> {
      try {
        return fetchBody(input, init);
      } catch (e) {
        // Real fetch never throws synchronously: anything that goes wrong reading its arguments rejects instead.
        return promiseReject(e);
      }
    };
    const fetchBody = (input?: unknown, init?: unknown): Promise<unknown> => {
      watch();
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      emit("stand_in_call", { name, n, ...(settledAt !== null ? { afterSettle: true } : {}) });
      const url = typeof input === "string" ? input : input && typeof input === "object" && typeof (input as { url?: unknown }).url === "string" ? (input as { url: string }).url : StringCtor(input);
      const signal = init && typeof init === "object" ? (init as { signal?: unknown }).signal : undefined;
      if (signal && typeof signal === "object" && (signal as { aborted?: unknown }).aborted === true) {
        emit("stand_in_throws", { name, n, errorName: "AbortError" });
        return promiseReject(abortError(signal));
      }
      const step: WireNetStep | null = n <= steps.length ? steps[n - 1]! : net.then === "repeat_last" ? steps[steps.length - 1]! : null;
      if (step === null) {
        emit("stand_in_throws", { name, n, errorName: "AtlasStandInExhausted" });
        return promiseReject(makeError("AtlasStandInExhausted", `${name} has no step for call ${n} (it has ${steps.length})`));
      }
      if (step.do === "throw") {
        emit("stand_in_throws", { name, n, errorName: step.errorName });
        const err = step.errorName === "AbortError" || step.errorName === "TimeoutError" ? (DOMExceptionCtor ? new DOMExceptionCtor(step.message, step.errorName) : makeError(step.errorName, step.message)) : makeError(step.errorName, step.message);
        return promiseReject(err);
      }
      return new PromiseCtor<unknown>((resolve, reject) => {
        let done = false;
        // Review M2: an open request keeps a real Node process alive, so while this call is unanswered Atlas keeps
        // firing even the code's unref'd timers (AbortSignal.timeout), as a real run would.
        netPending++;
        let giveUp: VTimer | null = null;
        const onAbort = () => {
          if (done) return;
          done = true;
          netPending--;
          if (giveUp) clock.cancel(giveUp);
          const why = abortError(signal);
          const nm = why && typeof why === "object" && typeof (why as { name?: unknown }).name === "string" ? (why as { name: string }).name : "the abort reason";
          emit("stand_in_throws", { name, n, errorName: nm, aborted: true });
          reject(why);
        };
        if (signal && typeof signal === "object" && typeof (signal as { addEventListener?: unknown }).addEventListener === "function") {
          (signal as { addEventListener: (t: string, f: () => void, o: unknown) => void }).addEventListener("abort", onAbort, { once: true });
        }
        if (step.do === "never_answer") {
          emit("stand_in_never_answers", { name, n });
          // Review m6: Node's built-in fetch gives up on a server that never sends headers after 300 s (undici's
          // headersTimeout), with TypeError "fetch failed". The fake does the same on Atlas's clock.
          giveUp = clock.schedule(
            clock.now + NODE_FETCH_GIVES_UP_MS,
            () => {
              if (done) return;
              done = true;
              netPending--;
              emit("stand_in_throws", { name, n, errorName: "TypeError", gaveUp: true });
              reject(makeError("TypeError", "fetch failed"));
            },
            { atlas: true },
          );
          return;
        }
        const after = step.afterMs ?? 0;
        const answer = () => {
          if (done) return;
          done = true;
          netPending--;
          emit("stand_in_returns", after > 0 ? { name, n, afterMs: after } : { name, n });
          resolve(response(step.status, step.json, url));
        };
        if (after > 0) clock.schedule(clock.now + after, answer, { atlas: true });
        else answer();
      });
    };
    fetchBefore = ObjectGetOwnPropertyDescriptor(globalThis, "fetch");
    ObjectDefineProperty(globalThis, "fetch", { __proto__: null, value: fakeFetch, writable: true, enumerable: false, configurable: true } as PropertyDescriptor);
  }

  // ---- the call ----
  type Settled = { kind: "returned"; facts: Classified } | { kind: "threw"; facts: ThrownFacts };
  let settled: Settled | null = null;
  const previous = active;
  active = clock;
  // R1: this run's conditions start from those noticed while the file loaded.
  runConds = record<Record<string, true>>();
  for (const k of ReflectOwnKeys(loadConds)) put(runConds, k as string, true);
  undecided = null;
  lastReadAt = -1;
  driftMs = 0;
  hostReads = record<Record<string, true>>();
  for (const k of ReflectOwnKeys(loadHostReads)) put(hostReads, k as string, true);
  let unrefStop = false;
  const before = activeResources();
  emit("start", { exportName: req.exportName, args: req.args.length, watchLimitMs });
  promiseThen(
    promiseThen(promiseResolve(undefined), () => {
      inSyncCall = true; // R1: the function's own synchronous part (process.nextTick here races promise callbacks)
      try {
        return ReflectApply(fn as (...a: unknown[]) => unknown, undefined, args);
      } finally {
        inSyncCall = false;
      }
    }),
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
  // U2 (D53): each moment the virtual clock jumped to (a wait ending), for the drawing's replay only. Not a measured
  // fact: no bet is judged on it.
  const moves: number[] = [];
  let movesMore = 0;
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
      if (!clock.hasRef() && netPending === 0) {
        // R1 (review MINOR 3): only unref'd timers are left. A plain Node script would exit here; a program that
        // stays up would fire them. Which one is true depends on the caller, so Atlas stops and does not guess.
        noteCondition("unref-timer");
        unrefStop = true;
        stop = settled === null ? UNREF_REASON : UNREF_AFTER_SETTLE_REASON;
        break;
      }
      if (next.at > watchLimitMs) {
        limitHit = true;
        break;
      }
      if (++steps > maxSteps) {
        stop = `Atlas's step limit (${maxSteps} timer firings, Atlas's limit, not the code's) ended the run before the code went quiet`;
        break;
      }
      if (next.at > clock.now) {
        if (moves.length < MAX_CLOCK_MOVES) append(moves, next.at);
        else movesMore++;
      }
      clock.now = next.at;
      clock.take(next);
      next.fire();
    }
  } finally {
    active = previous;
    // U2: the fake network belongs to this run only; the blocked fetch comes back.
    if (net) {
      if (fetchBefore) ObjectDefineProperty(globalThis, "fetch", fetchBefore);
      else ReflectApply(Reflect.deleteProperty, undefined, [globalThis, "fetch"]);
    }
  }
  if (raced && stop === null) stop = "the code ran background work while a timer was also waiting, so which finished first depends on real speed, not on the code; Atlas did not guess";
  // R1 (D42): how the call ended depends on something outside the code (timed work on a clock that does not move
  // during work, an order Node leaves open, randomness Atlas cannot seed). Like a race: nothing about how it ended
  // is reported, and the trace says why.
  const undecidedWhy = raced ? null : undecided;
  if (undecidedWhy !== null) stop = undecidedWhy;
  const notDecided = raced || undecidedWhy !== null;
  const s = (undecidedWhy !== null ? null : settled) as Settled | null;
  if (notDecided) emit("stopped_watching", { reason: stop ?? "background work raced a timer" });
  else if (s === null && settledAt === null) emit(limitHit ? "still_running_at_watch_limit" : stop ? "stopped_watching" : "never_settled", stop ? { reason: stop } : undefined);
  else if (stop || limitHit) emit(unrefStop && s === null ? "stopped_watching" : "stopped_watching_after_settle", { reason: stop ?? `Atlas's watch limit (${watchLimitMs} ms of virtual time) ran out while the code's timers were still running after it settled` });

  if (moves.length > 0) {
    const ev = record<TraceEvent>();
    put(ev, "t", clock.now);
    put(ev, "event", "clock_moves");
    put(ev, "data", movesMore > 0 ? { at: moves, more: movesMore } : { at: moves });
    append(trace, ev);
  }
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

  // R1 (D42): the conditions this run noticed, in one event (src/conditions.ts reads it; verify rechecks it).
  const kinds = ReflectOwnKeys(runConds) as string[];
  if (kinds.length > 0) {
    const ev = record<TraceEvent>();
    put(ev, "t", clock.now);
    put(ev, "event", "conditions");
    const host = ReflectOwnKeys(hostReads) as string[];
    const data = record<Record<string, unknown>>();
    put(data, "kinds", ReflectApply(ArraySort, kinds, []));
    if (host.length > 0) put(data, "host", ReflectApply(ArraySort, host, []));
    // R2 review M1: the second run's added time, so its call time can be compared as the code saw it.
    if (driftMs > 0) put(data, "driftMs", driftMs);
    put(ev, "data", data);
    append(trace, ev);
  }

  if (s === null || notDecided) {
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
