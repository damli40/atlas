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
//
// Every number in the result is counted from what happened; nothing is copied from the oracle.

import type { RunResult, TraceEvent } from "../../src/types.ts";
import { FAKE_RPC_ERRORS, HTTP_429_ERROR, SUCCESS_VALUE, seededRandom, type RetryScenario } from "./shapes.ts";

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
  runs: { id: string; scenario: RetryScenario; seed: string; label?: string; watchLimitMs?: number }[];
}
/** What worker.ts prints after RESULT_MARKER. */
export interface WorkerResponse {
  runs: ({ id: string } & HarnessOutput)[];
}
export const RESULT_MARKER = "ATLAS_RESULT ";

export const NEVER_SETTLED_REASON = "the function never settled; Atlas stopped watching (harness limit, not the code's)";
export const DEFAULT_WATCH_LIMIT_MS = 30_000;
const DEFAULT_MAX_STEPS = 10_000;

/** Waits until every queued promise reaction has run. */
const drainMicrotasks = () => new Promise<void>((r) => setImmediate(r));

/** Counts of the real Node resources (timers, sockets, file reads) alive right now, by type. */
function activeResources(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of process.getActiveResourcesInfo()) m.set(r, (m.get(r) ?? 0) + 1);
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
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return describeValue(e);
}

export async function runScenario(withRpcRetry: RetryFn, scenario: RetryScenario, opts: HarnessOptions): Promise<HarnessOutput> {
  const label = opts.label ?? "atlas-read";
  const watchLimitMs = opts.watchLimitMs ?? DEFAULT_WATCH_LIMIT_MS;
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const random = seededRandom(opts.seed);

  const trace: TraceEvent[] = [];
  let now = 0;
  let seq = 0;
  const timers: { at: number; seq: number; fire: () => void }[] = [];
  const schedule = (at: number, fire: () => void) => timers.push({ at, seq: seq++, fire });
  const emit = (event: string, data?: Record<string, unknown>) => trace.push(data ? { t: now, event, data } : { t: now, event });

  const waits: number[] = [];
  const logs: string[] = [];
  let calls = 0;

  // ---- injected into the code under test ----
  const sleep = (ms: number): Promise<void> => {
    waits.push(ms);
    emit("sleep", { ms });
    const at = now + (Number.isFinite(ms) && ms > 0 ? ms : 0);
    return new Promise<void>((resolve) =>
      schedule(at, () => {
        emit("wake", { ms });
        resolve();
      }),
    );
  };
  const log = (msg: string): void => {
    logs.push(msg);
    emit("log", { msg });
  };

  // ---- the fake RPC ----
  const fn = (): Promise<unknown> => {
    calls += 1;
    const n = calls;
    emit("call", { n });
    const failing = scenario.failTimes === "always" || n <= scenario.failTimes;
    if (failing && scenario.failure === "never_settles") {
      emit("no_answer", { n });
      return new Promise<unknown>(() => {});
    }
    if (failing) {
      const pick = scenario.errorKind === "429" ? HTTP_429_ERROR : FAKE_RPC_ERRORS[Math.floor(random() * FAKE_RPC_ERRORS.length)]!;
      // The call number makes every error distinct and shows which call's error was finally thrown.
      const err = Object.assign(new Error(`${pick.message} (call ${n})`), { atlasCall: n }) as Error & { atlasCall: number; status?: number };
      err.name = pick.name;
      if (scenario.errorKind === "429") err.status = 429;
      emit("reject", { n, error: describeError(err) });
      return Promise.reject(err);
    }
    const value = "resolvesWith" in scenario ? scenario.resolvesWith : SUCCESS_VALUE;
    const after = scenario.resolveAfterMs ?? 0;
    if (after > 0) {
      return new Promise<unknown>((resolve) =>
        schedule(now + after, () => {
          emit("resolve", { n, value: describeValue(value) });
          resolve(value);
        }),
      );
    }
    emit("resolve", { n, value: describeValue(value) });
    return Promise.resolve(value);
  };

  // Only pass attempts/delayMs when the scenario sets them, so the code's own defaults are what run.
  const retryOpts: Parameters<RetryFn>[2] = { sleep, log };
  if (scenario.attempts !== undefined) retryOpts.attempts = scenario.attempts;
  if (scenario.delayMs !== undefined) retryOpts.delayMs = scenario.delayMs;

  type Settled = { kind: "returns"; value: unknown; at: number } | { kind: "throws"; error: unknown; at: number };
  let settled: Settled | null = null;
  const before = activeResources();

  emit("start", { label, ...(scenario.attempts !== undefined ? { attempts: scenario.attempts } : {}), ...(scenario.delayMs !== undefined ? { delayMs: scenario.delayMs } : {}) });
  Promise.resolve()
    .then(() => withRpcRetry(label, fn, retryOpts))
    .then(
      (value) => {
        settled = { kind: "returns", value, at: now };
      },
      (error: unknown) => {
        settled = { kind: "throws", error, at: now };
      },
    );

  // ---- the virtual event loop ----
  let stop: { outcomeReason: string } | null = null;
  let steps = 0;
  for (;;) {
    await drainMicrotasks();
    if (settled) break;
    const outside = grownResources(before);
    if (outside.length > 0) {
      stop = { outcomeReason: `the code is waiting on something Atlas does not control (${outside.join(", ")}); Atlas did not wait for it` };
      break;
    }
    if (timers.length === 0) break; // unsettled, nothing scheduled, queue drained: it can never settle
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const next = timers[0]!;
    if (next.at > watchLimitMs) {
      stop = { outcomeReason: `not settled within ${watchLimitMs} ms of virtual time; Atlas stopped watching (harness limit, not the code's)` };
      break;
    }
    if (++steps > maxSteps) {
      stop = { outcomeReason: `not settled after ${maxSteps} virtual timer steps; Atlas stopped watching (harness limit, not the code's)` };
      break;
    }
    timers.shift();
    now = next.at;
    next.fire();
  }

  // ---- measured facts ----
  const measured: RunResult["measured"] = {
    calls,
    waitCount: waits.length,
    waitsMs: waits.join(","),
    logCount: logs.length,
    logAttempts: logs.map((m) => /attempt (\d+\/\d+)/.exec(m)?.[1] ?? "?").join(","),
  };
  const notMeasured: RunResult["notMeasured"] = {};
  if (waits.every((w) => Number.isFinite(w))) measured.totalWaitMs = waits.reduce((a, b) => a + b, 0);
  else notMeasured.totalWaitMs = "the code asked to wait a non-finite number of ms";

  const s = settled as Settled | null;
  if (s) {
    measured.outcome = s.kind;
    measured.settledAtMs = s.at;
    if (s.kind === "returns") {
      measured.returned = describeValue(s.value);
      emit("returns", { value: describeValue(s.value) });
    } else {
      measured.thrown = describeError(s.error);
      const c = (s.error as { atlasCall?: unknown } | null)?.atlasCall;
      measured.thrownFromCall = typeof c === "number" ? c : null;
      emit("throws", { error: describeError(s.error) });
    }
  } else if (stop && stop.outcomeReason.startsWith("the code is waiting")) {
    // Real timer or I/O: the outcome is unknown, so it is not measured.
    notMeasured.outcome = stop.outcomeReason;
    notMeasured.settleTime = stop.outcomeReason;
    emit("stopped_watching", { reason: stop.outcomeReason });
  } else if (stop) {
    measured.outcome = "pending";
    notMeasured.settleTime = stop.outcomeReason;
    emit("stopped_watching", { reason: stop.outcomeReason });
  } else {
    measured.outcome = "pending";
    notMeasured.settleTime = NEVER_SETTLED_REASON;
    emit("pending", { reason: "unsettled, no timers left, queue drained" });
  }

  return { trace, result: { measured, notMeasured } };
}
