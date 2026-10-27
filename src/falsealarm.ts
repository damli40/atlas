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
  /**
   * PASS-RULE.md rule 2 (false alarms): is the post-apply price within 2% of the pre-apply price at the
   * same fork block? null = can't check (a price missing, or the control did not pass). Every market
   * has one; for cbETH it is data only (cbETH is judged by rule 1, the flag rule).
   */
  withinFalseAlarmPct: boolean | null;
  /** Did the run's control pass? When false, flagged is null on every row (PASS-RULE.md). */
  controlPassed: boolean;
  feedBefore: string | null;
  feedAfter: string | null;
  note?: string;
}

/** Rule 2's test: post within 2% of pre (inclusive). null when it can't be checked. */
export const withinPct = (controlPassed: boolean, pre: bigint | null, post: bigint | null): boolean | null =>
  controlPassed && pre !== null && post !== null && pre > 0n ? !differsByMoreThan(post, pre, FALSE_ALARM_PCT) : null;

/**
 * What the table says about one row, in PASS-RULE.md's words. "unchanged" only when the two prices are
 * exactly equal; a market that moved but stayed within 2% says so, never "unchanged".
 */
export function rowWords(r: FalseAlarmRow): string {
  if (!r.controlPassed) return "can't check";
  if (r.market === "cbETH") return r.flagged === null ? "can't check" : r.flagged ? "flagged: more than 50% from raw Chainlink" : "not flagged: within 50% of raw Chainlink";
  if (r.withinFalseAlarmPct === null || r.flagged === null) return "can't check";
  if (r.flagged) return "flagged: moved more than 50%";
  if (!r.withinFalseAlarmPct) return "moved more than 2% (not flagged)";
  return r.preUsd1e18 === r.postUsd1e18 ? "unchanged (not flagged)" : "within 2% (not flagged)";
}

/** The summary line's counts, per rule: rule 1 for cbETH, rule 2 for every other market. */
export function tableCounts(rows: FalseAlarmRow[]) {
  const others = rows.filter((r) => r.market !== "cbETH");
  const cb = rows.find((r) => r.market === "cbETH");
  return {
    markets: rows.length,
    controlPassed: rows.every((r) => r.controlPassed),
    cbEthFlagged: cb ? cb.flagged : null,
    within2Pct: others.filter((r) => r.withinFalseAlarmPct === true && r.flagged === false).length,
    unchanged: others.filter((r) => r.withinFalseAlarmPct === true && r.flagged === false && r.preUsd1e18 === r.postUsd1e18).length,
    movedMoreThan2Pct: others.filter((r) => r.withinFalseAlarmPct === false || r.flagged === true).length,
    othersFlagged: others.filter((r) => r.flagged === true).length,
    cantCheck: others.filter((r) => r.withinFalseAlarmPct === null || r.flagged === null).length,
  };
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
      withinFalseAlarmPct: withinPct(controlPassed, preV, postV),
      controlPassed,
      feedBefore: str(`preApplyFeedAddress:${sym}`),
      feedAfter: str(`feedAddress:${sym}`),
    };
    if (!controlPassed) row.note = CONTROL_FAILED_NOTE(run.result.notMeasured?.control);
    return row;
  });
}

// ── PASS-RULE.md rule 3 (the replay rule), pure: used by the server and by .atlas.json verify ─────

/** The fields of a Run the replay rule reads (structural, so this file imports no types). */
interface RunLike {
  forkBlock?: number | undefined;
  controlPassed: boolean;
  result: { measured: Record<string, string | number | boolean | null>; notMeasured: Record<string, string>; references?: Record<string, { value: string; method: string }> | undefined };
}

/** One line of the pass rule, in its own words. */
export interface PassRuleLine {
  rule: string;
  outcome: "matched" | "didn't match" | "can't check";
  detail: string;
}

/** PASS-RULE.md rule 3: the replay's cbETH must be within this many percent of the reference. */
export const REPLAY_RULE_PCT = 2n;
/** PASS-RULE.md rule 3: the number of distinct price sources while pricing cbETH on the replay. */
export const REPLAY_RULE_SOURCES = 2;

/**
 * PASS-RULE.md rule 3 applied literally to a replay Run, one line per check. Reads only the replay's
 * measured fields and reference (and the original's fork block). If the replay's control did not
 * pass, both rule lines are "can't check".
 */
export function evaluateReplayRule(replay: RunLike, original: { id: string; forkBlock?: number | undefined }): PassRuleLine[] {
  const lines: PassRuleLine[] = [];
  const same = replay.forkBlock !== undefined && replay.forkBlock === original.forkBlock;
  lines.push({
    rule: "Same experiment at the same block (the replay's fork block equals the original run's)",
    outcome: replay.forkBlock === undefined || original.forkBlock === undefined ? "can't check" : same ? "matched" : "didn't match",
    detail: `original run ${original.id} forked at ${original.forkBlock ?? "no block"}; the replay forked at ${replay.forkBlock ?? "no block"}`,
  });
  const ok = replay.controlPassed === true && same;
  const gateWhy = replay.controlPassed !== true ? `the replay's control did not pass: ${replay.result.notMeasured.control ?? "no reason given"}` : "the replay was not at the same block";
  const m = replay.result.measured;
  const nm = replay.result.notMeasured;
  const post = m["priceUsd1e18:cbETH"];
  const ref = replay.result.references?.["refUsd1e18:cbETH"];
  let within: PassRuleLine;
  if (!ok) within = { rule: "", outcome: "can't check", detail: gateWhy };
  else if (typeof post !== "string" || !/^\d+$/.test(post)) within = { rule: "", outcome: "can't check", detail: `cbETH was not measured on the replay: ${nm["priceUsd1e18:cbETH"] ?? "no value"}` };
  else if (!ref || !/^\d+$/.test(ref.value) || BigInt(ref.value) === 0n) within = { rule: "", outcome: "can't check", detail: `the reference was not measured on the replay: ${nm["refUsd1e18:cbETH"] ?? "no value"}` };
  else {
    const p = BigInt(post);
    const r = BigInt(ref.value);
    const inside = !differsByMoreThan(p, r, REPLAY_RULE_PCT);
    within = { rule: "", outcome: inside ? "matched" : "didn't match", detail: `cbETH ${post} vs reference ${ref.value} (USD, 18 decimals): ${ppmToPct(diffPpm(p, r))}; within ${REPLAY_RULE_PCT}% = ${inside}` };
  }
  lines.push({ ...within, rule: `3a. Replay rule: cbETH within ${REPLAY_RULE_PCT}% of the reference (raw Chainlink ETH/USD × cbETH/ETH, same block)` });
  const n = m["priceSources:cbETH"];
  lines.push({
    rule: `3b. Replay rule: ${REPLAY_RULE_SOURCES} distinct aggregators' latestRoundData called while pricing cbETH (two feeds multiplied)`,
    outcome: !ok ? "can't check" : typeof n !== "number" ? "can't check" : n === REPLAY_RULE_SOURCES ? "matched" : "didn't match",
    detail: !ok ? gateWhy : typeof n === "number" ? `${n} price source(s) counted by the call trace` : `not measured: ${nm["priceSources:cbETH"] ?? "no value"}`,
  });
  return lines;
}

