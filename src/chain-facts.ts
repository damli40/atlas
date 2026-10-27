// D22: a small, fixed set of chain facts every Moonwell bettor sees before betting, the person and each
// Meta model alike (D19 parity).
//
// Plain words:
// - Before bets are placed, plain code (runners/evm/chain-facts.ts) opens a short-lived fork of Base at block
//   42194662, the block BEFORE the proposal ran, and reads: the price Moonwell's oracle reports for cbETH right
//   then, which feed the oracle uses for cbETH, the raw answers of the two Chainlink feeds (ETH/USD and
//   cbETH/ETH) with their decimals, and the block's timestamp. Nothing is applied on that fork.
// - This file only turns those facts into the lines src/bet-context.ts puts in the "what the bettor sees"
//   text. It is pure and has no Node imports (the page loads it).
// - What it never holds: any value after the proposal is applied, the run's own reads, or the reference the
//   judge compares against (that is a product the run computes; the raw feed answers are public chain state
//   before the run, and are shown as they are, never multiplied here).
// - Facts from any other block are refused, so a Level 1 round (which forks at 42194663 for its run) still
//   shows facts from 42194662.

import { MOONWELL_LEVEL2_BLOCK } from "./moonwell-blocks";
import { formatUsd1e18 } from "./units";

/** The only block chain facts are ever read at: one block before MIP-X43 ran. */
export const CHAIN_FACTS_BLOCK = MOONWELL_LEVEL2_BLOCK;

/** The on-screen label above the facts (D22). */
export const CHAIN_FACTS_LABEL = `Chain facts read by Atlas at block ${CHAIN_FACTS_BLOCK}, before the proposal ran`;

/** D22: the bet instruction, the same for every bettor and every model. */
export const BET_INSTRUCTION = "Give your best estimate in USD. Decline only if you cannot form any estimate at all; if you decline, say why.";

/** One raw Chainlink aggregator read: latestRoundData().answer as returned, and decimals() read on-chain. */
export interface RawFeedFact {
  address: string;
  description: string | null;
  decimals: number;
  /** latestRoundData().answer, a decimal integer string, unscaled. */
  answer: string;
}

export interface MoonwellChainFacts {
  /** Always CHAIN_FACTS_BLOCK. */
  block: number;
  /** The block's timestamp (Unix seconds), read from the fork. */
  blockTimestamp: number;
  /** Moonwell's oracle for the cbETH market, as it stands at the block (nothing applied). */
  cbEthOracle: {
    market: string;
    /** getFeed("cbETH"): the feed the oracle is wired to. */
    feed: string;
    feedDescription: string | null;
    /** getUnderlyingPrice(MOONWELL_cbETH) as returned. */
    rawUnderlyingPrice: string;
    /** The same price normalised to USD with 18 decimals (src/units.ts toUsd1e18). */
    priceUsd1e18: string;
  };
  ethUsd: RawFeedFact;
  cbEthEth: RawFeedFact;
}

/** What the server hands the page and the prompt: the facts, or why there are none. Both render the same lines. */
export type ChainFactsResult = { ok: true; facts: MoonwellChainFacts } | { ok: false; reason: string };

const DIGITS = /^\d+$/;

/** "220668365083" with 8 decimals → "2206.68365083". Places the point; never rounds. */
export function placeDecimals(answer: string, decimals: number): string {
  if (!DIGITS.test(answer)) throw new Error(`a feed answer must be a whole non-negative number, got "${answer}"`);
  if (decimals === 0) return answer;
  const padded = answer.padStart(decimals + 1, "0");
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/** Throws unless the facts are from CHAIN_FACTS_BLOCK and every number is a whole number string. */
export function assertFactsShape(f: MoonwellChainFacts): void {
  if (f.block !== CHAIN_FACTS_BLOCK) throw new Error(`chain facts must come from block ${CHAIN_FACTS_BLOCK} (before the proposal ran), got ${f.block}`);
  if (!Number.isSafeInteger(f.blockTimestamp) || f.blockTimestamp <= 0) throw new Error("chain facts: the block timestamp is not a positive whole number");
  for (const v of [f.cbEthOracle.rawUnderlyingPrice, f.cbEthOracle.priceUsd1e18, f.ethUsd.answer, f.cbEthEth.answer]) {
    if (!DIGITS.test(v)) throw new Error(`chain facts: "${v}" is not a whole non-negative number`);
  }
  for (const d of [f.ethUsd.decimals, f.cbEthEth.decimals]) {
    if (!Number.isInteger(d) || d < 0 || d > 36) throw new Error(`chain facts: ${d} is not a feed's decimals`);
  }
}

const utc = (s: number) => `${new Date(s * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "")} UTC`;
const described = (d: string | null) => (d === null ? "no description()" : `description "${d}"`);

/** The lines the bettor sees. A missing result says so in words; the run's values have no way in. */
export function chainFactsLines(r: ChainFactsResult | undefined): string[] {
  if (r === undefined) return [`${CHAIN_FACTS_LABEL}: none were read for this round.`];
  if (!r.ok) return [`${CHAIN_FACTS_LABEL}: Atlas could not read them (${r.reason}).`];
  const f = r.facts;
  assertFactsShape(f);
  const o = f.cbEthOracle;
  return [
    `${CHAIN_FACTS_LABEL}:`,
    `- Block ${f.block} timestamp: ${f.blockTimestamp} (${utc(f.blockTimestamp)}).`,
    `- Moonwell's oracle, getUnderlyingPrice(MOONWELL_cbETH ${o.market}), normalised: ${formatUsd1e18(BigInt(o.priceUsd1e18))} per cbETH (raw ${o.rawUnderlyingPrice}).`,
    `- The feed the oracle is wired to for cbETH, getFeed("cbETH"): ${o.feed}, ${described(o.feedDescription)}.`,
    `- Chainlink ETH/USD aggregator ${f.ethUsd.address}, ${described(f.ethUsd.description)}: latestRoundData answer ${f.ethUsd.answer} with ${f.ethUsd.decimals} decimals (${placeDecimals(f.ethUsd.answer, f.ethUsd.decimals)}).`,
    `- Chainlink cbETH/ETH aggregator ${f.cbEthEth.address}, ${described(f.cbEthEth.description)}: latestRoundData answer ${f.cbEthEth.answer} with ${f.cbEthEth.decimals} decimals (${placeDecimals(f.cbEthEth.answer, f.cbEthEth.decimals)}).`,
    "Nothing after the proposal is applied is shown here.",
  ];
}
