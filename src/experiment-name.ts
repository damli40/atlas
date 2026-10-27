// How Atlas names an experiment on screen, and when two experiments are the same one. Pure plain code.
//
// Plain words:
// - An experiment's on-screen name is its shape id plus its parameters, written by this file from the
//   gate-checked params. It is never a model's own words (D07-02: a model could otherwise name an
//   experiment "prove the oracle is off" and Atlas would seem to say so).
// - Every value in the name is either a number, a word from the gate's own lists (enum options, the
//   markets the target touches), or digits. The one free-text field a shape has (`resolvesWith`, any
//   JSON value) is never printed: the name says only how long it is.
// - Two experiments are the same one when their params are deep-equal after plain spelling
//   differences are removed: key order, the order of a market list, "touched" written out as the
//   touched markets, and every field left out filled in with the value the run would use anyway (the
//   harness's own defaults, and the function's defaults read from the target's code by
//   functionDefaults). So `failTimes 5` and `failTimes 5, attempts 5` are the same experiment when the
//   function's default is 5 attempts. Also the same: failTimes 0 with any failure kind (no call fails,
//   so the kind is never used). Only this file decides that.
//
// No I/O, no clock, no model.

import type { GateContext } from "./gate";
import type { ExperimentShape } from "./types";
import { SUCCESS_VALUE } from "../runners/ts/shapes";

/** What the TS harness uses for a retry-scenario field left out (runners/ts/harness.ts, runners/ts/shapes.ts). */
export const HARNESS_DEFAULTS = { resolveAfterMs: 0, errorKind: "seeded", resolvesWith: SUCCESS_VALUE } as const;

/** The function's own defaults for the fields Atlas passes it as opts (read from its code; absent = unknown). */
export interface FunctionDefaults {
  attempts?: number;
  delayMs?: number;
}

/**
 * Reads `opts.attempts ?? X` and `opts.delayMs ?? Y` from the target's code, where X / Y is a whole-number
 * literal or a `const NAME = <whole number>` in the same file. A field it cannot read stays unknown, and
 * then an experiment that leaves it out is compared as written (never guessed).
 */
export function functionDefaults(code: string): FunctionDefaults {
  const out: FunctionDefaults = {};
  for (const field of ["attempts", "delayMs"] as const) {
    const m = new RegExp(`opts\\.${field}\\s*\\?\\?\\s*([A-Za-z_$][\\w$]*|\\d[\\d_]*)`).exec(code);
    if (!m) continue;
    const raw = m[1]!;
    const value: string | undefined = /^\d/.test(raw) ? raw : new RegExp(`(?:const|let|var)\\s+${raw}\\s*(?::\\s*number\\s*)?=\\s*(\\d[\\d_]*)\\s*;`).exec(code)?.[1];
    if (value !== undefined) out[field] = Number(value.replace(/_/g, ""));
  }
  return out;
}

/** The params with every left-out field the run would fill anyway filled in. */
function withDefaults(params: ExperimentShape, fn: FunctionDefaults): Record<string, unknown> {
  const p = { ...params } as Record<string, unknown>;
  const fill = (k: string, v: unknown) => {
    if (p[k] === undefined && v !== undefined) p[k] = v;
  };
  if (params.shape === "retry-scenario") {
    fill("attempts", fn.attempts);
    fill("delayMs", fn.delayMs);
    fill("resolveAfterMs", HARNESS_DEFAULTS.resolveAfterMs);
    // errorKind and resolvesWith have no effect in some scenarios (the gate refuses them there), so they
    // are filled only where they can act: errorKind when a call can fail with an error, resolvesWith when one can answer.
    if (params.failure === "error" && params.failTimes !== 0) fill("errorKind", HARNESS_DEFAULTS.errorKind);
    if (params.failTimes !== "always") fill("resolvesWith", HARNESS_DEFAULTS.resolvesWith);
  }
  if (params.shape === "concurrency-sweep") fill("delayMs", fn.delayMs);
  // Day-7 review M1: with failTimes 0 no call fails, so how a failing call would fail never happens: the
  // harness never reads `failure` (runners/ts/harness.ts). Provably the same run, so the same experiment.
  // attempts and delayMs are NOT merged: they go into the code under test, which may use them any way.
  if (params.shape === "retry-scenario" && params.failTimes === 0) p.failure = "(no call fails)";
  return p;
}

/** The on-screen name of a gate-allowed experiment: "price-read · markets WETH, USDC". */
export function experimentName(params: ExperimentShape): string {
  const parts: string[] = [params.shape];
  switch (params.shape) {
    case "retry-scenario": {
      parts.push(`failTimes ${params.failTimes}`, `failure ${params.failure}`);
      if (params.attempts !== undefined) parts.push(`attempts ${params.attempts}`);
      if (params.delayMs !== undefined) parts.push(`delayMs ${params.delayMs}`);
      if (params.resolveAfterMs !== undefined) parts.push(`resolveAfterMs ${params.resolveAfterMs}`);
      if (params.errorKind !== undefined) parts.push(`errorKind ${params.errorKind}`);
      if (params.resolvesWith !== undefined) parts.push(`resolvesWith (a JSON value, ${JSON.stringify(params.resolvesWith).length} characters)`);
      break;
    }
    case "concurrency-sweep":
      parts.push(`callers ${params.callers}`, `failTimes ${params.failTimes}`, `failure ${params.failure}`);
      if (params.delayMs !== undefined) parts.push(`delayMs ${params.delayMs}`);
      break;
    case "price-read":
    case "apply-proposal-then-read":
      parts.push(params.markets === "touched" ? "markets: every touched market" : `markets ${params.markets.join(", ")}`);
      break;
    case "liquidatable-at-price":
      parts.push(`market ${params.market}`, `priceUsd1e18 ${params.priceUsd1e18}`);
      break;
  }
  return parts.join(" · ");
}

/** Plain JSON with keys sorted at every level, so key order never makes two experiments differ. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** The comparison key of an experiment: canonical params, with a market list as a sorted set. */
export function experimentKey(params: ExperimentShape, ctx: GateContext = {}, fn: FunctionDefaults = {}): string {
  const p = withDefaults(params, fn);
  if (params.shape === "price-read" || params.shape === "apply-proposal-then-read") {
    const markets = params.markets === "touched" ? [...(ctx.touchedMarkets ?? [])] : [...params.markets];
    p.markets = markets.sort();
  }
  return JSON.stringify(canonical(p));
}

/** True when `params` is the same experiment as one of `already` (see experimentKey). */
export function alreadyRan(params: ExperimentShape, already: readonly ExperimentShape[], ctx: GateContext = {}, fn: FunctionDefaults = {}): boolean {
  const key = experimentKey(params, ctx, fn);
  return already.some((a) => experimentKey(a, ctx, fn) === key);
}
