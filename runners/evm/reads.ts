// Read-only calls against a LOCAL anvil fork: oracle feeds, Chainlink answers, token decimals,
// and Moonwell's getUnderlyingPrice, with the one normalisation done by src/units.ts.
//
// Plain words: a "feed" is a Chainlink price contract; Moonwell's oracle maps each token symbol to
// one feed. `getUnderlyingPrice(market)` is the price Moonwell uses, scaled so that a token with
// d decimals reads price × 10^(36 − d). This file never rescales numbers itself: it calls
// toUsd1e18 from src/units.ts, the only place Atlas changes the scale of a number.

import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { toUsd1e18 } from "../../src/units.ts";
import { CHAINLINK_ORACLE } from "./moonwell-base.ts";

const ORACLE_ABI = parseAbi([
  "function getFeed(string symbol) view returns (address)",
  "function getUnderlyingPrice(address mToken) view returns (uint256)",
]);
const FEED_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const MTOKEN_ABI = parseAbi(["function underlying() view returns (address)"]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

/** A viem client that may only talk to anvil on this machine. Throws for any other URL. */
export function localClient(url: string): PublicClient {
  const u = new URL(url);
  if (u.protocol !== "http:" || !(u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
    throw new Error("reads.ts only reads from a local anvil fork (http://127.0.0.1:<port>)");
  }
  return createPublicClient({ transport: http(url, { retryCount: 0, timeout: 60_000 }) });
}

export async function getFeed(client: PublicClient, symbol: string): Promise<Address> {
  return client.readContract({ address: CHAINLINK_ORACLE, abi: ORACLE_ABI, functionName: "getFeed", args: [symbol] });
}

export async function feedDecimals(client: PublicClient, feed: Address): Promise<number> {
  return client.readContract({ address: feed, abi: FEED_ABI, functionName: "decimals" });
}

/** Chainlink description(); null when the contract has none or the call reverts (wrappers may not expose it). */
export async function feedDescription(client: PublicClient, feed: Address): Promise<string | null> {
  try {
    return await client.readContract({ address: feed, abi: FEED_ABI, functionName: "description" });
  } catch {
    return null;
  }
}

export interface RoundData {
  roundId: string;
  answer: string;
  startedAt: string;
  updatedAt: string;
  answeredInRound: string;
}

/** latestRoundData(), every number as a decimal string (bigint-safe). */
export async function latestRoundData(client: PublicClient, feed: Address): Promise<RoundData> {
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = await client.readContract({
    address: feed,
    abi: FEED_ABI,
    functionName: "latestRoundData",
  });
  return {
    roundId: roundId.toString(),
    answer: answer.toString(),
    startedAt: startedAt.toString(),
    updatedAt: updatedAt.toString(),
    answeredInRound: answeredInRound.toString(),
  };
}

export async function underlyingOf(client: PublicClient, mToken: Address): Promise<Address> {
  return client.readContract({ address: mToken, abi: MTOKEN_ABI, functionName: "underlying" });
}

export async function tokenDecimals(client: PublicClient, token: Address): Promise<number> {
  return client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
}

export async function tokenSymbol(client: PublicClient, token: Address): Promise<string> {
  return client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" });
}

/** Moonwell's raw price for a market: USD × 10^(36 − tokenDecimals). */
export async function getUnderlyingPrice(client: PublicClient, mToken: Address): Promise<bigint> {
  return client.readContract({ address: CHAINLINK_ORACLE, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [mToken] });
}

/** Everything recorded for one market's price read. On-chain integers are decimal strings. */
export interface MarketPriceRead {
  mToken: Address;
  underlying: Address;
  /** The underlying token's symbol, read on-chain; this is the key passed to getFeed. */
  symbol: string;
  tokenDecimals: number;
  feedAddress: Address;
  feedDecimals: number;
  feedDescription: string | null;
  /** getUnderlyingPrice(mToken) as returned. */
  rawUnderlyingPrice: string;
  /** rawUnderlyingPrice / 10^(18 − tokenDecimals), via src/units.ts: USD with 18 decimals. */
  priceUsd1e18: string;
}

/** Read one market: underlying, symbol, decimals, the oracle's feed for that symbol, and the price. */
export async function readMarketPrice(client: PublicClient, mToken: Address): Promise<MarketPriceRead> {
  const underlying = await underlyingOf(client, mToken);
  const [symbol, decimals] = await Promise.all([tokenSymbol(client, underlying), tokenDecimals(client, underlying)]);
  const feedAddress = await getFeed(client, symbol);
  const [fDecimals, fDescription, raw] = await Promise.all([
    feedDecimals(client, feedAddress),
    feedDescription(client, feedAddress),
    getUnderlyingPrice(client, mToken),
  ]);
  return {
    mToken,
    underlying,
    symbol,
    tokenDecimals: decimals,
    feedAddress,
    feedDecimals: fDecimals,
    feedDescription: fDescription,
    rawUnderlyingPrice: raw.toString(),
    priceUsd1e18: toUsd1e18(raw, decimals).toString(),
  };
}
