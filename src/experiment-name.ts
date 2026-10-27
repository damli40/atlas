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
//   differences are removed: key order, the order of a market list, and "touched" written out as the
//   touched markets. Only this file decides that.
//
// No I/O, no clock, no model.

import type { GateContext } from "./gate";
import type { ExperimentShape } from "./types";

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
export function experimentKey(params: ExperimentShape, ctx: GateContext = {}): string {
  const p = { ...params } as Record<string, unknown>;
  if (params.shape === "price-read" || params.shape === "apply-proposal-then-read") {
    const markets = params.markets === "touched" ? [...(ctx.touchedMarkets ?? [])] : [...params.markets];
    p.markets = markets.sort();
  }
  return JSON.stringify(canonical(p));
}

/** True when `params` is the same experiment as one of `already` (see experimentKey). */
export function alreadyRan(params: ExperimentShape, already: readonly ExperimentShape[], ctx: GateContext = {}): boolean {
  const key = experimentKey(params, ctx);
  return already.some((a) => experimentKey(a, ctx) === key);
}
