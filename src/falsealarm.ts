// The false-alarm table, from a stored Run alone (pure: no I/O, no chain, no model).
//
// Plain words: a Level 2 run reads every market the proposal touches, before and after applying it.
// This table says, for each market, whether Atlas would surface ("flag") it:
// - cbETH is compared with the reference price from the raw Chainlink feeds (ETH/USD × cbETH/ETH);
// - every other market is compared with its own price before the proposal, at the same fork block;
// - a market is flagged when it differs from what it is compared with by more than 50%.
//
// PASS-RULE.md: "If any control fails, every verdict on that run is 'can't check'." So when the run's
// control did not pass (controlPassed is anything but true), every flag cell is null ("can't check")
// with the control's reason, and the measured numbers are shown as data only.
//
// It lives in src/ (not runners/evm/) so src/atlasfile.ts and the web page can use it without
// pulling in the fork code. runners/evm/level2.ts re-exports it.

/** Signed difference of `value` from `base`, in parts per million of `base` (bigint, truncated toward zero). */
export function diffPpm(value: bigint, base: bigint): bigint {
  if (base <= 0n) throw new RangeError("the base of a percentage must be above zero");
  return ((value - base) * 1_000_000n) / base;
}

/** "−99.9491%" style text from parts per million, 4 decimals, no floating point. */
export function ppmToPct(ppm: bigint): string {
  const neg = ppm < 0n;
  const a = neg ? -ppm : ppm;
  const whole = a / 10_000n;
  const frac = (a % 10_000n).toString().padStart(4, "0");
  return `${neg ? "-" : a === 0n ? "" : "+"}${whole}.${frac}%`;
}

/** |value − base| > pct% of base, exactly (no rounding). */
export const differsByMoreThan = (value: bigint, base: bigint, pct: bigint) => (value > base ? value - base : base - value) * 100n > base * pct;

export const FLAG_PCT = 50n;
export const FALSE_ALARM_PCT = 2n;

export interface FalseAlarmRow {
  market: string;
  preUsd1e18: string | null;
  postUsd1e18: string | null;
  diffVsPrePct: string | null;
  /** What this market's flag compares against: the raw-Chainlink reference for cbETH, the pre-apply price for the rest. */
  flagReference: "refUsd1e18:cbETH (raw Chainlink ETH/USD × cbETH/ETH)" | "pre-apply price, same fork block";
  flagReferenceUsd1e18: string | null;
  diffVsFlagReferencePct: string | null;
  /** Atlas surfaces the market when post differs from its flag reference by more than 50%. null = can't check. */
  flagged: boolean | null;
  /** Did the run's control pass? When false, flagged is null on every row (PASS-RULE.md). */
  controlPassed: boolean;
  feedBefore: string | null;
  feedAfter: string | null;
  note?: string;
}

export const CONTROL_FAILED_NOTE = (reason: string | undefined) => `can't check: the control did not pass${reason ? ` (${reason})` : ""}`;

export interface StoredRunForTable {
  controlPassed?: unknown;
  result: { measured: Record<string, unknown>; notMeasured?: Record<string, string>; references?: Record<string, { value: string }> };
  trace: { event: string; data?: Record<string, unknown> }[];
}

/**
 * The false-alarm table from a stored Level 2 Run: the rows a replayer can rebuild from an .atlas.json.
 * Market order is the order the run applied them (its "proposal_derived" trace event).
 */
export function falseAlarmFromRun(run: StoredRunForTable): FalseAlarmRow[] {
  const derived = run.trace.find((t) => t.event === "proposal_derived")?.data?.actions;
  const markets = Array.isArray(derived) ? derived.map((a) => String((a as { symbol: unknown }).symbol)) : [];
  const m = run.result.measured;
  const controlPassed = run.controlPassed === true;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  return markets.map((sym) => {
    const preS = str(`preApplyPriceUsd1e18:${sym}`);
    const postS = str(`priceUsd1e18:${sym}`);
    const preV = preS !== null ? BigInt(preS) : null;
    const postV = postS !== null ? BigInt(postS) : null;
    const isCbEth = sym === "cbETH";
    const refS = isCbEth ? (run.result.references?.["refUsd1e18:cbETH"]?.value ?? null) : preS;
    const ref = refS !== null ? BigInt(refS) : null;
    const row: FalseAlarmRow = {
      market: sym,
      preUsd1e18: preS,
      postUsd1e18: postS,
      diffVsPrePct: preV !== null && postV !== null && preV > 0n ? ppmToPct(diffPpm(postV, preV)) : null,
      flagReference: isCbEth ? "refUsd1e18:cbETH (raw Chainlink ETH/USD × cbETH/ETH)" : "pre-apply price, same fork block",
      flagReferenceUsd1e18: refS,
      diffVsFlagReferencePct: ref !== null && postV !== null && ref > 0n ? ppmToPct(diffPpm(postV, ref)) : null,
      flagged: controlPassed && ref !== null && postV !== null && ref > 0n ? differsByMoreThan(postV, ref, FLAG_PCT) : null,
      controlPassed,
      feedBefore: str(`preApplyFeedAddress:${sym}`),
      feedAfter: str(`feedAddress:${sym}`),
    };
    if (!controlPassed) row.note = CONTROL_FAILED_NOTE(run.result.notMeasured?.control);
    return row;
  });
}
