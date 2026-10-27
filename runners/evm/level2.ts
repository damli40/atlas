// Level 2 ("before ship"): apply the proposal's oracle-feed actions on a fork taken one block
// before it ran, then read. Also the plain-code pass rule from proofs/moonwell/PASS-RULE.md.
//
// Plain words, in the order the run does things:
// 1. Guard: the fork must still hold the old cbETH feed and a cbETH price above $1,000
//    (assertPreExecution). Otherwise "applying" would be a no-op on already-changed state, and the
//    run stops with "fork is not pre-execution".
// 2. Control on the untouched fork: WETH exact (wired feed and raw ETH/USD), USD stablecoins in band.
// 3. Read every touched market (pre-apply prices).
// 4. Become the oracle's admin on the fork and call setFeed(symbol, wrapper) for each action
//    derived from the PR files (runners/evm/apply.ts). Every fork tx hash is recorded.
// 5. Read the same markets again (post-apply prices), the cbETH reference from the raw Chainlink
//    feeds, and the call trace of cbETH's price read (how many price sources it touches).
// What Level 2 does NOT apply: the proposal's Morpho wrapper upgrades, mToken whitelists and fee
// updates. Only the oracle-feed actions.

import type { Address, PublicClient } from "viem";
import { usdTimesRatio1e18 } from "../../src/units.ts";
import { applyFeedActions, comparePairs, planFromPrFiles, resolveSymbols, traceUnderlyingPriceSources, type AppliedFeedAction, type FeedAction, type PairComparison, type SourceCount } from "./apply.ts";
import { assertPreExecution, cbEthReference, inStablecoinBand, readControl, why, type EvmControlRecord, type ReferenceResult } from "./control.ts";
import { MOONWELL_cbETH, TEMPORAL_GOVERNOR, USD_STABLECOINS } from "./moonwell-base.ts";
import { readMarketPrice, type MarketPriceRead } from "./reads.ts";

export const LEVEL2_CAPTION = "fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor";
export const LEVEL2_NOT_APPLIED = [
  "Morpho oracle wrapper upgrades (_upgradeMorphoWrappers)",
  "mToken whitelists on the OEV fee redeemer (_whitelistMTokens)",
  "fee-split updates on the wrappers MIP-X38 had already wired (_updateExistingWrapperFees)",
  "anything on Optimism or Moonbeam",
] as const;

export type MarketRead = { ok: true; read: MarketPriceRead } | { ok: false; reason: string };

export interface Level2Record {
  forkBlock: number;
  preExecution: { cbEthFeed: Address; cbEthPriceUsd1e18: string };
  control: EvmControlRecord;
  actions: FeedAction[];
  pre: Record<string, MarketRead>;
  applied: AppliedFeedAction[];
  /** The FeedSet events the fork itself emitted vs the derived actions (should be equal). */
  forkEventsVsDerived: PairComparison;
  blockAfterApply: number;
  post: Record<string, MarketRead>;
  /** Post-apply stablecoin band (units sanity through the new wrappers). */
  postStablecoins: Array<{ symbol: string; priceUsd1e18: string | null; inBand: boolean }>;
  referencePre: ReferenceResult;
  referencePost: ReferenceResult;
  trace: { pre: SourceCount; post: SourceCount };
}

async function readOne(client: PublicClient, action: FeedAction): Promise<MarketRead> {
  try {
    const read = await readMarketPrice(client, action.mToken);
    if (read.symbol !== action.symbol) return { ok: false, reason: `market ${action.mToken} holds ${read.symbol} on-chain, not ${action.symbol}` };
    return { ok: true, read };
  } catch (e) {
    return { ok: false, reason: `the price read failed: ${why(e)}` };
  }
}

/**
 * Run Level 2 on an open fork. Throws "fork is not pre-execution: …" before touching anything when
 * the guard fails, and throws on impersonation or a reverted setFeed (with the step that failed).
 * `markets`: the symbols to report ("touched" = all derived actions); all actions are applied anyway.
 */
export async function runLevel2OnFork(client: PublicClient, fork: { url: string }, forkBlock: number, progress: (step: string) => void = () => {}): Promise<Level2Record> {
  // 1. Guard first. Nothing is read or changed before it passes.
  progress(`checks the fork at ${forkBlock} is before the proposal ran`);
  const preExecution = await assertPreExecution(fork);

  // 2. Control on the untouched fork.
  progress("runs the known-case control (WETH, stablecoins)");
  const control = await readControl(client, forkBlock);

  // Derive the actions from the PR files; symbols are read on this fork, as mip-x43.sol does.
  const actions = await resolveSymbols(client, planFromPrFiles());

  // 3. Pre-apply reads, and the cbETH trace before the change (the old feed, for comparison).
  const pre: Record<string, MarketRead> = {};
  progress(`reads ${actions.length} markets before applying`);
  for (const a of actions) pre[a.symbol] = await readOne(client, a);
  const referencePre = await cbEthReference(client, forkBlock);
  const tracePre = await traceUnderlyingPriceSources(client, MOONWELL_cbETH);

  // 4. Apply as the governor.
  progress(`applies ${actions.length} oracle-feed actions as the governor`);
  const applied = await applyFeedActions(client, TEMPORAL_GOVERNOR, actions.map((a) => ({ symbol: a.symbol, wrapper: a.wrapper })));
  const forkEventsVsDerived = comparePairs(
    applied.flatMap((x) => x.feedSetEvents),
    actions.map((a) => ({ symbol: a.symbol, wrapper: a.wrapper })),
  );
  const blockAfterApply = Number(await client.getBlockNumber());

  // 5. Post-apply reads, reference, trace.
  progress(`reads ${actions.length} markets after applying`);
  const post: Record<string, MarketRead> = {};
  for (const a of actions) post[a.symbol] = await readOne(client, a);
  const postStablecoins = USD_STABLECOINS.map((symbol) => {
    const r = post[symbol];
    return r?.ok
      ? { symbol, priceUsd1e18: r.read.priceUsd1e18, inBand: inStablecoinBand(BigInt(r.read.priceUsd1e18)) }
      : { symbol, priceUsd1e18: null, inBand: false };
  });
  progress("computes the cbETH reference from the raw Chainlink feeds and traces the price read");
  const referencePost = await cbEthReference(client, forkBlock);
  const tracePost = await traceUnderlyingPriceSources(client, MOONWELL_cbETH);

  return {
    forkBlock,
    preExecution,
    control,
    actions,
    pre,
    applied,
    forkEventsVsDerived,
    blockAfterApply,
    post,
    postStablecoins,
    referencePre,
    referencePost,
    trace: { pre: tracePre, post: tracePost },
  };
}

// ── The pass rule, as plain code ─────────────────────────────────────────────────────────────────

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
  feedBefore: string | null;
  feedAfter: string | null;
  note?: string;
}

export interface PassRuleLine {
  rule: string;
  outcome: "matched" | "didn't match" | "can't check";
  detail: string;
}

export const FLAG_PCT = 50n;
export const FALSE_ALARM_PCT = 2n;

/** Build the false-alarm table: one row per touched market, cbETH judged against the raw reference. */
export function falseAlarmTable(rec: Level2Record): FalseAlarmRow[] {
  return rec.actions.map((a) => {
    const pre = rec.pre[a.symbol];
    const post = rec.post[a.symbol];
    const preV = pre?.ok ? BigInt(pre.read.priceUsd1e18) : null;
    const postV = post?.ok ? BigInt(post.read.priceUsd1e18) : null;
    const isCbEth = a.symbol === "cbETH";
    const ref = isCbEth ? (rec.referencePost.ok ? BigInt(rec.referencePost.value) : null) : preV;
    const row: FalseAlarmRow = {
      market: a.symbol,
      preUsd1e18: preV?.toString() ?? null,
      postUsd1e18: postV?.toString() ?? null,
      diffVsPrePct: preV !== null && postV !== null && preV > 0n ? ppmToPct(diffPpm(postV, preV)) : null,
      flagReference: isCbEth ? "refUsd1e18:cbETH (raw Chainlink ETH/USD × cbETH/ETH)" : "pre-apply price, same fork block",
      flagReferenceUsd1e18: ref?.toString() ?? null,
      diffVsFlagReferencePct: ref !== null && postV !== null && ref > 0n ? ppmToPct(diffPpm(postV, ref)) : null,
      flagged: ref !== null && postV !== null && ref > 0n ? differsByMoreThan(postV, ref, FLAG_PCT) : null,
      feedBefore: pre?.ok ? pre.read.feedAddress : null,
      feedAfter: post?.ok ? post.read.feedAddress : null,
    };
    const why = [!pre?.ok && pre ? `pre: ${pre.reason}` : "", !post?.ok && post ? `post: ${post.reason}` : "", isCbEth && !rec.referencePost.ok ? `reference: ${rec.referencePost.reason}` : ""].filter(Boolean);
    if (why.length) row.note = why.join("; ");
    return row;
  });
}

/** PASS-RULE.md applied literally to a Level 2 record. */
export function evaluatePassRule(rec: Level2Record, table = falseAlarmTable(rec)): PassRuleLine[] {
  const lines: PassRuleLine[] = [];
  const controlsOk = rec.control.passed && rec.postStablecoins.every((s) => s.inBand);

  // Controls first: if any fails, every other line is "can't check".
  const w = rec.control.weth;
  lines.push({
    rule: "Control: WETH exact (getUnderlyingPrice(MOONWELL_WETH) = ETH/USD answer × 10^10, wired feed and raw aggregator)",
    outcome: w && rec.control.wiredVsRaw ? (w.matched && rec.control.wiredVsRaw.equalAt1e18 ? "matched" : "didn't match") : "can't check",
    detail: w
      ? `WETH ${w.read.rawUnderlyingPrice} vs wired feed × 10^10 ${w.expectedRawUnderlyingPrice}; raw ETH/USD ${rec.control.wiredVsRaw?.rawAnswer ?? "not read"} (wired ${rec.control.wiredVsRaw?.wiredFeedAnswer ?? "?"})`
      : rec.control.reasons.join("; "),
  });
  const preBand = rec.control.stablecoins;
  lines.push({
    rule: "Control: USD stablecoins between 0.95 and 1.05 USD (pre-apply and post-apply)",
    outcome: preBand.length === USD_STABLECOINS.length && preBand.every((s) => s.inBand) && rec.postStablecoins.every((s) => s.inBand) ? "matched" : "didn't match",
    detail: USD_STABLECOINS.map((sym) => `${sym} pre ${preBand.find((s) => s.symbol === sym)?.priceUsd1e18 ?? "not read"} / post ${rec.postStablecoins.find((s) => s.symbol === sym)?.priceUsd1e18 ?? "not read"}`).join("; "),
  });
  if (!rec.control.passed) lines.push({ rule: "Control: fork is Base at the asked block", outcome: "didn't match", detail: rec.control.reasons.join("; ") });

  const gate = (o: PassRuleLine["outcome"]): PassRuleLine["outcome"] => (controlsOk ? o : "can't check");

  const cb = table.find((r) => r.market === "cbETH");
  lines.push({
    rule: "1. Flag rule: cbETH post-apply differs from the reference by more than 50% → surfaced",
    outcome: gate(cb?.flagged === null || !cb ? "can't check" : cb.flagged ? "matched" : "didn't match"),
    detail: cb ? `cbETH post ${cb.postUsd1e18} vs reference ${cb.flagReferenceUsd1e18}: ${cb.diffVsFlagReferencePct ?? "n/a"}; flagged = ${cb.flagged}` : "cbETH not in the derived actions",
  });

  const others = table.filter((r) => r.market !== "cbETH");
  for (const r of others) {
    const within = r.preUsd1e18 !== null && r.postUsd1e18 !== null && BigInt(r.preUsd1e18) > 0n ? !differsByMoreThan(BigInt(r.postUsd1e18), BigInt(r.preUsd1e18), FALSE_ALARM_PCT) : null;
    lines.push({
      rule: `2. False-alarm rule: ${r.market} within 2% of its pre-apply price → not surfaced`,
      outcome: gate(within === null || r.flagged === null ? "can't check" : within && r.flagged === false ? "matched" : "didn't match"),
      detail: `pre ${r.preUsd1e18 ?? "not read"}, post ${r.postUsd1e18 ?? "not read"}, diff ${r.diffVsPrePct ?? "n/a"}, within 2% = ${within}, flagged = ${r.flagged}${r.note ? ` (${r.note})` : ""}`,
    });
  }

  const t = rec.trace.post;
  lines.push({
    rule: "Single-feed trace (D04-02 acceptance): cbETH post-apply price touches 1 price source (no multiply)",
    outcome: gate(t.ok ? (t.count === 1 ? "matched" : "didn't match") : "can't check"),
    detail: t.ok ? `${t.count} source(s): ${t.sources.join(", ")}; latestRoundData called on (outermost first): ${t.latestRoundDataCallees.join(" → ")}` : `not measured: ${t.reason}`,
  });
  lines.push({
    rule: "3. Replay rule (after a proposed change: cbETH within 2% of reference and 2 sources)",
    outcome: "can't check",
    detail: "not run here: there is no proposed change yet (change-and-replay is a later task)",
  });
  return lines;
}

/** Plain helper for the README: the reference recomputed from its recorded inputs equals the stored value. */
export function referenceRecomputes(ref: ReferenceResult): boolean {
  if (!ref.ok) return false;
  const eth = BigInt(ref.inputs.ethUsd.answer) * 10n ** BigInt(18 - ref.inputs.ethUsd.decimals);
  const ratio = BigInt(ref.inputs.cbEthEth.answer) * 10n ** BigInt(18 - ref.inputs.cbEthEth.decimals);
  return usdTimesRatio1e18(eth, ratio).toString() === ref.value;
}

/**
 * The false-alarm table from a stored Level 2 Run alone (no Level2Record): the rows a replayer can
 * rebuild from an .atlas.json. Same rule as falseAlarmTable: cbETH is compared with the raw-Chainlink
 * reference, every other market with its own pre-apply price; flagged = differs by more than 50%.
 * Market order is the order the run applied them (its "proposal_derived" trace event).
 */
export function falseAlarmFromRun(run: { result: { measured: Record<string, unknown>; references?: Record<string, { value: string }> }; trace: { event: string; data?: Record<string, unknown> }[] }): FalseAlarmRow[] {
  const derived = run.trace.find((t) => t.event === "proposal_derived")?.data?.actions;
  const markets = Array.isArray(derived) ? derived.map((a) => String((a as { symbol: unknown }).symbol)) : [];
  const m = run.result.measured;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  return markets.map((sym) => {
    const preS = str(`preApplyPriceUsd1e18:${sym}`);
    const postS = str(`priceUsd1e18:${sym}`);
    const preV = preS !== null ? BigInt(preS) : null;
    const postV = postS !== null ? BigInt(postS) : null;
    const isCbEth = sym === "cbETH";
    const refS = isCbEth ? (run.result.references?.["refUsd1e18:cbETH"]?.value ?? null) : preS;
    const ref = refS !== null ? BigInt(refS) : null;
    return {
      market: sym,
      preUsd1e18: preS,
      postUsd1e18: postS,
      diffVsPrePct: preV !== null && postV !== null && preV > 0n ? ppmToPct(diffPpm(postV, preV)) : null,
      flagReference: isCbEth ? "refUsd1e18:cbETH (raw Chainlink ETH/USD × cbETH/ETH)" : "pre-apply price, same fork block",
      flagReferenceUsd1e18: refS,
      diffVsFlagReferencePct: ref !== null && postV !== null && ref > 0n ? ppmToPct(diffPpm(postV, ref)) : null,
      flagged: ref !== null && postV !== null && ref > 0n ? differsByMoreThan(postV, ref, FLAG_PCT) : null,
      feedBefore: str(`preApplyFeedAddress:${sym}`),
      feedAfter: str(`feedAddress:${sym}`),
    } satisfies FalseAlarmRow;
  });
}
