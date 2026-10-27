// Turns an experiment shape into the exact behaviour of the fake RPC function.
//
// Plain words: the code under test (withRpcRetry) calls a function `fn` that stands in for a
// chain read. This file decides what that stand-in does on each call: throw an error, resolve
// with a value, resolve later, or never answer at all. Errors are picked from a fixed list by a
// seeded random generator, so the same seed always gives the same errors in the same order.

import type { ExperimentShape } from "../../src/types.ts";

/** What the fake RPC does. A superset of the "retry-scenario" shape in src/types.ts:
 *  `errorKind` and `resolvesWith` exist because oracle rows S4 and S5 need them and the
 *  shared shape has no field for either. */
export interface RetryScenario {
  /** How many calls fail before one succeeds. "always" = every call fails. */
  failTimes: number | "always";
  /** How a failing call fails: rejects with an error, or returns a promise that never settles. */
  failure: "error" | "never_settles";
  /** Passed to withRpcRetry only when set; otherwise the code's own default is used. */
  attempts?: number;
  /** Passed to withRpcRetry only when set; otherwise the code's own default is used. */
  delayMs?: number;
  /** A successful call resolves this many virtual ms after it is made (0 or absent = at once). */
  resolveAfterMs?: number;
  /** "seeded" = errors drawn from FAKE_RPC_ERRORS by the seed; "429" = an HTTP 429 error every time. */
  errorKind?: "seeded" | "429";
  /** The value a successful call resolves with. Default: SUCCESS_VALUE. */
  resolvesWith?: unknown;
}

/** What a successful fake call resolves with unless the scenario says otherwise. */
export const SUCCESS_VALUE = "the value";

/** The errors a fake RPC can throw. Fixed list; the seed picks from it. */
export const FAKE_RPC_ERRORS: ReadonlyArray<{ name: string; message: string }> = [
  { name: "BlockNotFoundError", message: "Block at number 42194663 could not be found." },
  { name: "HttpRequestError", message: "HTTP request failed. Status: 502" },
  { name: "TimeoutError", message: "The request took too long to respond." },
  { name: "InternalRpcError", message: "An internal error was received. (code -32603)" },
  { name: "SocketError", message: "read ECONNRESET" },
  { name: "ResourceNotFoundRpcError", message: "header not found" },
];

export const HTTP_429_ERROR = { name: "HttpRequestError", message: "HTTP request failed. Status: 429 Too Many Requests" };

/** Seeded random numbers in [0, 1). FNV-1a hashes the seed string; mulberry32 generates. */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** From the shared experiment shape (src/types.ts) to a scenario. Only "retry-scenario" is a single run. */
export function scenarioFromShape(shape: ExperimentShape): RetryScenario {
  if (shape.shape !== "retry-scenario") {
    throw new Error(`the TS harness runs "retry-scenario" only; got "${shape.shape}"`);
  }
  const s: RetryScenario = { failTimes: shape.failTimes, failure: shape.failure, errorKind: "seeded" };
  if (shape.attempts !== undefined) s.attempts = shape.attempts;
  if (shape.delayMs !== undefined) s.delayMs = shape.delayMs;
  if (shape.resolveAfterMs !== undefined) s.resolveAfterMs = shape.resolveAfterMs;
  return s;
}

/** The `input` object of a row in tests/oracle/retry-oracle.json. */
export interface OracleInput {
  failTimes: number | "always";
  failure: "error" | "never_settles";
  distinctErrors?: boolean;
  error?: string;
  resolvesWith?: unknown;
  resolveAfterMs?: number;
  attempts?: number;
}

/** From an oracle row's input to a scenario. Fails loudly on an input it does not understand. */
export function scenarioFromOracleInput(input: OracleInput): RetryScenario {
  const known = new Set(["failTimes", "failure", "distinctErrors", "error", "resolvesWith", "resolveAfterMs", "attempts"]);
  for (const k of Object.keys(input)) {
    if (!known.has(k)) throw new Error(`oracle input field "${k}" is not understood by the harness`);
  }
  if (input.error !== undefined && input.error !== "429") {
    throw new Error(`oracle input error "${input.error}" is not understood by the harness`);
  }
  const s: RetryScenario = {
    failTimes: input.failTimes,
    failure: input.failure,
    errorKind: input.error === "429" ? "429" : "seeded",
  };
  if (input.attempts !== undefined) s.attempts = input.attempts;
  if (input.resolveAfterMs !== undefined) s.resolveAfterMs = input.resolveAfterMs;
  if ("resolvesWith" in input) s.resolvesWith = input.resolvesWith;
  return s;
}
