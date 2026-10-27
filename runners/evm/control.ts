// The EVM runner's control, the cbETH reference price, and the pre-execution guard.
//
// Plain words: before Atlas trusts a price read from a Base fork, it checks numbers whose answer
// is already known at that block.
// - WETH, exact: Moonwell's WETH price must equal, to the last digit, the answer of the feed the
//   oracle itself is wired to for WETH (getFeed("WETH")), brought to 18 decimals. At these blocks
//   that feed is an ETH/USD "OEV wrapper" (a contract that passes a Chainlink feed through), not
//   the raw Chainlink aggregator. Whether the wrapper's answer equals the raw aggregator's answer
//   is recorded as data, not used as the control: a wrapper may serve an older round.
// - Stablecoins: each US-dollar stablecoin market must read between 0.95 and 1.05 USD after the
//   units conversion. This catches a decimals slip even when everything else agrees.
// - The fork itself: chain id 8453 and the fork's block number equal to the block asked for.
// If any one fails, the control fails and every verdict on that run is "can't check".
//
// The reference price for cbETH comes only from the two raw Chainlink aggregators (ETH/USD with 8
// decimals, cbETH/ETH with 18), read at the same block, with both decimals read on-chain and
// asserted. Never from a wrapper, never from an off-chain price service.

import type { Address, PublicClient } from "viem";
import { chainlinkTo1e18, toUsd1e18, usdTimesRatio1e18 } from "../../src/units.ts";
import { BASE_CHAIN_ID, CBETH_FEED, MARKETS, MOONWELL_WETH, MOONWELL_cbETH, RAW_FEED, USD_STABLECOINS } from "./moonwell-base.ts";
import { why } from "./redact.ts";
import { feedDecimals, getFeed, latestRoundData, localClient, readMarketPrice, type MarketPriceRead } from "./reads.ts";

/** 0.95 and 1.05 USD in USD 1e18: the stablecoin band from PASS-RULE.md. Inclusive at both ends. */
export const STABLECOIN_BAND = { min: 950_000_000_000_000_000n, max: 1_050_000_000_000_000_000n } as const;

/** Written as the reference's method; N is the fork block. */
export const CBETH_REFERENCE_METHOD = (block: number) =>
  `Chainlink ETH/USD × cbETH/ETH at block ${block}, decimals 8 and 18 read on-chain`;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An error's message with the remote RPC URL removed (anvil can echo it in a fork error). */
export { why };

export interface WethControl {
  /** The full price read of the WETH market (feedAddress is getFeed("WETH")). */
  read: MarketPriceRead;
  /** latestRoundData() of getFeed("WETH") at the fork block. */
  wiredFeedRound: { roundId: string; answer: string; updatedAt: string };
  /** wiredFeedRound.answer × 10^(18 − feedDecimals), via src/units.ts. */
  expectedRawUnderlyingPrice: string;
  matched: boolean;
}

/** Data, not the control: does the feed WETH is wired to answer the same as the raw ETH/USD aggregator? */
export interface WiredVsRaw {
  wiredFeed: Address;
  wiredFeedIsRawAggregator: boolean;
  wiredFeedAnswer: string;
  wiredFeedDecimals: number;
  rawAggregator: Address;
  rawAnswer: string;
  rawDecimals: number;
  rawRoundId: string;
  /** Both answers brought to 18 decimals and compared exactly. */
  equalAt1e18: boolean;
}

export interface StablecoinControl {
  symbol: string;
  mToken: Address;
  tokenDecimals: number;
  feedAddress: Address;
  rawUnderlyingPrice: string;
  priceUsd1e18: string;
  inBand: boolean;
}

export interface EvmControlRecord {
  forkBlock: number;
  chainId: number;
  blockNumberOnFork: number;
  weth?: WethControl;
  wiredVsRaw?: WiredVsRaw;
  stablecoins: StablecoinControl[];
  passed: boolean;
  /** Present only when passed is false: which check did not match, in plain words. */
  reasons: string[];
}

/** Pure: the reasons the control did not pass (empty list = passed). */
export function controlReasons(r: Omit<EvmControlRecord, "passed" | "reasons">): string[] {
  const out: string[] = [];
  if (r.chainId !== BASE_CHAIN_ID) out.push(`the fork reports chain id ${r.chainId}, not Base (${BASE_CHAIN_ID})`);
  if (r.blockNumberOnFork !== r.forkBlock) out.push(`the fork is at block ${r.blockNumberOnFork}, not the block asked for (${r.forkBlock})`);
  if (!r.weth) out.push("the WETH control was not read");
  else if (!r.weth.matched) {
    out.push(
      `WETH control did not match: getUnderlyingPrice(MOONWELL_WETH) = ${r.weth.read.rawUnderlyingPrice}, ` +
        `the oracle's own WETH feed answer brought to 18 decimals = ${r.weth.expectedRawUnderlyingPrice}`,
    );
  }
  // PASS-RULE.md (committed before any EVM run) names the raw ETH/USD answer, so the wired feed
  // must also equal the raw aggregator at this block. A lagging wrapper gives "can't check".
  if (r.weth && !r.wiredVsRaw) out.push("the raw ETH/USD aggregator was not read, so PASS-RULE.md's WETH control cannot be checked");
  else if (r.wiredVsRaw && !r.wiredVsRaw.equalAt1e18) {
    out.push(
      `WETH's wired feed answer (${r.wiredVsRaw.wiredFeedAnswer}) differs from the raw ETH/USD answer ` +
        `(${r.wiredVsRaw.rawAnswer}) at this block; PASS-RULE.md checks against the raw answer`,
    );
  }
  const seen = new Set(r.stablecoins.map((s) => s.symbol));
  for (const sym of USD_STABLECOINS) if (!seen.has(sym)) out.push(`the ${sym} stablecoin control was not read`);
  for (const s of r.stablecoins) {
    if (!s.inBand) out.push(`${s.symbol} reads ${s.priceUsd1e18} USD 1e18, outside 0.95–1.05 USD`);
  }
  return out;
}

export function inStablecoinBand(priceUsd1e18: bigint): boolean {
  return priceUsd1e18 >= STABLECOIN_BAND.min && priceUsd1e18 <= STABLECOIN_BAND.max;
}

/**
 * Read a market, checking the on-chain symbol is the one asked for. Throws with a plain reason
 * when the mToken is unknown or its symbol differs.
 */
export async function readNamedMarket(client: PublicClient, symbol: string): Promise<MarketPriceRead> {
  const mToken = Object.prototype.hasOwnProperty.call(MARKETS, symbol) ? MARKETS[symbol] : undefined;
  if (!mToken) throw new Error(`Atlas has no Moonwell Base market address on file for ${symbol}`);
  const read = await readMarketPrice(client, mToken);
  if (read.symbol !== symbol) throw new Error(`market ${mToken} holds ${read.symbol} on-chain, not ${symbol}`);
  return read;
}

/** Run every control check on an open fork. Never throws: a failed read becomes a reason. */
export async function readControl(client: PublicClient, forkBlock: number): Promise<EvmControlRecord> {
  const base: Omit<EvmControlRecord, "passed" | "reasons"> = { forkBlock, chainId: 0, blockNumberOnFork: -1, stablecoins: [] };
  const errors: string[] = [];
  try {
    base.chainId = await client.getChainId();
    base.blockNumberOnFork = Number(await client.getBlockNumber());
  } catch (e) {
    errors.push(`the fork did not answer its chain id or block number: ${why(e)}`);
  }

  try {
    const read = await readMarketPrice(client, MOONWELL_WETH);
    if (read.symbol !== "WETH") throw new Error(`MOONWELL_WETH holds ${read.symbol}, not WETH`);
    if (read.tokenDecimals !== 18) throw new Error(`WETH reports ${read.tokenDecimals} decimals, not 18`);
    const round = await latestRoundData(client, read.feedAddress);
    const expected = chainlinkTo1e18(BigInt(round.answer), read.feedDecimals).toString();
    base.weth = {
      read,
      wiredFeedRound: { roundId: round.roundId, answer: round.answer, updatedAt: round.updatedAt },
      expectedRawUnderlyingPrice: expected,
      matched: read.rawUnderlyingPrice === expected,
    };

    const rawDecimals = await feedDecimals(client, RAW_FEED.ETH_USD.address);
    const raw = await latestRoundData(client, RAW_FEED.ETH_USD.address);
    base.wiredVsRaw = {
      wiredFeed: read.feedAddress,
      wiredFeedIsRawAggregator: same(read.feedAddress, RAW_FEED.ETH_USD.address),
      wiredFeedAnswer: round.answer,
      wiredFeedDecimals: read.feedDecimals,
      rawAggregator: RAW_FEED.ETH_USD.address,
      rawAnswer: raw.answer,
      rawDecimals,
      rawRoundId: raw.roundId,
      equalAt1e18: chainlinkTo1e18(BigInt(round.answer), read.feedDecimals) === chainlinkTo1e18(BigInt(raw.answer), rawDecimals),
    };
  } catch (e) {
    errors.push(`the WETH control could not be read: ${why(e)}`);
  }

  for (const sym of USD_STABLECOINS) {
    try {
      const r = await readNamedMarket(client, sym);
      base.stablecoins.push({
        symbol: sym,
        mToken: r.mToken,
        tokenDecimals: r.tokenDecimals,
        feedAddress: r.feedAddress,
        rawUnderlyingPrice: r.rawUnderlyingPrice,
        priceUsd1e18: r.priceUsd1e18,
        inBand: inStablecoinBand(BigInt(r.priceUsd1e18)),
      });
    } catch (e) {
      errors.push(`the ${sym} stablecoin control could not be read: ${why(e)}`);
    }
  }

  // Every check that "was not read" also has a read error above saying why; keep only that one.
  const reasons = [...errors, ...controlReasons(base).filter((r) => !r.endsWith("was not read"))];
  return { ...base, passed: reasons.length === 0, reasons };
}

export type ReferenceResult =
  | {
      ok: true;
      value: string;
      method: string;
      inputs: { ethUsd: { address: Address; decimals: number; answer: string; roundId: string }; cbEthEth: { address: Address; decimals: number; answer: string; roundId: string } };
    }
  | { ok: false; reason: string };

/**
 * The cbETH reference in USD 1e18 at the fork block:
 * ETH/USD answer × 10^(18 − 8) × cbETH/ETH answer / 10^18, both from the raw aggregators.
 * Not measured (ok: false) when either decimals() is not what PASS-RULE.md requires, an answer is
 * not above zero, or a read fails.
 */
export async function cbEthReference(client: PublicClient, forkBlock: number): Promise<ReferenceResult> {
  try {
    // Read AT the fork block, as the method text says (review M3). On a Level 2 fork the latest block
    // is later (Atlas's own setFeed transactions); they do not touch these aggregators, but the
    // reference is defined at the fork block, so it is read there.
    const at = BigInt(forkBlock);
    const [ethDec, ratioDec] = await Promise.all([
      feedDecimals(client, RAW_FEED.ETH_USD.address, at),
      feedDecimals(client, RAW_FEED.cbETH_ETH.address, at),
    ]);
    if (ethDec !== RAW_FEED.ETH_USD.decimals) {
      return { ok: false, reason: `the ETH/USD aggregator reports ${ethDec} decimals on-chain, not ${RAW_FEED.ETH_USD.decimals}` };
    }
    if (ratioDec !== RAW_FEED.cbETH_ETH.decimals) {
      return { ok: false, reason: `the cbETH/ETH aggregator reports ${ratioDec} decimals on-chain, not ${RAW_FEED.cbETH_ETH.decimals}` };
    }
    const [eth, ratio] = await Promise.all([
      latestRoundData(client, RAW_FEED.ETH_USD.address, at),
      latestRoundData(client, RAW_FEED.cbETH_ETH.address, at),
    ]);
    if (BigInt(eth.answer) <= 0n || BigInt(ratio.answer) <= 0n) {
      return { ok: false, reason: `an aggregator answered a non-positive value (ETH/USD ${eth.answer}, cbETH/ETH ${ratio.answer})` };
    }
    const value = usdTimesRatio1e18(chainlinkTo1e18(BigInt(eth.answer), ethDec), chainlinkTo1e18(BigInt(ratio.answer), ratioDec));
    return {
      ok: true,
      value: value.toString(),
      method: CBETH_REFERENCE_METHOD(forkBlock),
      inputs: {
        ethUsd: { address: RAW_FEED.ETH_USD.address, decimals: ethDec, answer: eth.answer, roundId: eth.roundId },
        cbEthEth: { address: RAW_FEED.cbETH_ETH.address, decimals: ratioDec, answer: ratio.answer, roundId: ratio.roundId },
      },
    };
  } catch (e) {
    return { ok: false, reason: `the reference feeds could not be read: ${why(e)}` };
  }
}

/** cbETH must read above $1,000 on a pre-execution fork (it read about $2,241 the block before MIP-X43). */
export const PRE_EXECUTION_MIN_CBETH_USD1E18 = 10n ** 21n;

/**
 * Guard for Level 2: a fork meant to be "one block before the proposal"
 * must still have the old cbETH feed and a cbETH price above 1e21 (USD 1e18). Otherwise applying
 * the proposal would be a no-op on already-changed state, and Level 2 would silently read the
 * after-the-fact numbers. Throws "fork is not pre-execution: ..." when either check fails.
 */
export async function assertPreExecution(fork: { url: string }): Promise<{ cbEthFeed: Address; cbEthPriceUsd1e18: string }> {
  const client = localClient(fork.url);
  let feed: Address;
  try {
    feed = await getFeed(client, "cbETH");
  } catch (e) {
    throw new Error(`the pre-execution check could not read getFeed("cbETH"): ${why(e)}`);
  }
  if (!same(feed, CBETH_FEED.before)) {
    throw new Error(`fork is not pre-execution: getFeed("cbETH") is ${feed}, not the pre-proposal feed ${CBETH_FEED.before}`);
  }
  let read: MarketPriceRead;
  try {
    read = await readMarketPrice(client, MOONWELL_cbETH);
  } catch (e) {
    throw new Error(`the pre-execution check could not read the cbETH price: ${why(e)}`);
  }
  const price = toUsd1e18(BigInt(read.rawUnderlyingPrice), read.tokenDecimals);
  if (price <= PRE_EXECUTION_MIN_CBETH_USD1E18) {
    throw new Error(`fork is not pre-execution: cbETH reads ${price} USD 1e18, not above ${PRE_EXECUTION_MIN_CBETH_USD1E18}`);
  }
  return { cbEthFeed: feed, cbEthPriceUsd1e18: price.toString() };
}
