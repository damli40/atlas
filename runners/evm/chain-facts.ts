// D22: read the chain facts every Moonwell bettor sees, on a short-lived fork at block 42194662 (one block
// BEFORE MIP-X43 ran). Plain code only; no model is involved.
//
// Plain words:
// - Opens a local fork of Base at the block before the proposal, reads a fixed list of values, and closes it.
//   Nothing is sent to the fork: no impersonation, no setFeed, no transaction. Every read is pinned to the
//   fork block, and the fork's head is checked to still BE that block, so no later state can be read.
// - What it reads: Moonwell's getUnderlyingPrice for the cbETH market (normalised to USD by src/units.ts),
//   getFeed("cbETH") and that feed's description(), the raw Chainlink ETH/USD and cbETH/ETH latestRoundData
//   answers with their decimals() and description(), and the block's timestamp.
// - It refuses any block other than 42194662, and refuses facts whose cbETH feed is already the one the
//   proposal sets (that would be state after the proposal).
// - The facts are cached per fork block: the first round pays for one fork, later rounds reuse the answer.
//   A failed read is not cached, so the next round tries again.

import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { assertFactsShape, CHAIN_FACTS_BLOCK, type MoonwellChainFacts, type RawFeedFact } from "../../src/chain-facts.ts";
import { toUsd1e18 } from "../../src/units.ts";
import { withAnvilFork, type AnvilFork, type StartAnvilOptions } from "./anvil.ts";
import { CBETH_FEED, CHAINLINK_ORACLE, MOONWELL_cbETH, RAW_FEED, TOKEN } from "./moonwell-base.ts";

const ORACLE_ABI = parseAbi([
  "function getFeed(string symbol) view returns (address)",
  "function getUnderlyingPrice(address mToken) view returns (uint256)",
]);
const FEED_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const ERC20_ABI = parseAbi(["function decimals() view returns (uint8)"]);

/** Opens a fork, runs `fn` on it, closes it. Tests pass a stand-in; the default spawns anvil (needs BASE_RPC_URL). */
export type ForkOpener = <T>(opts: StartAnvilOptions, fn: (fork: AnvilFork) => Promise<T>) => Promise<T>;

function localOnly(url: string): PublicClient {
  const u = new URL(url);
  if (u.protocol !== "http:" || !(u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
    throw new Error("chain facts are read only from a local anvil fork (http://127.0.0.1:<port>)");
  }
  return createPublicClient({ transport: http(url, { retryCount: 0, timeout: 60_000 }) });
}

/** Read the facts from a client whose fork head is `block`. Every call is pinned to `block`. */
export async function readChainFactsFrom(client: PublicClient, block: number): Promise<MoonwellChainFacts> {
  if (block !== CHAIN_FACTS_BLOCK) throw new RangeError(`chain facts are read only at block ${CHAIN_FACTS_BLOCK} (before the proposal ran), not ${block}`);
  const blockNumber = BigInt(block);
  const head = await client.getBlockNumber({ cacheTime: 0 });
  if (head !== blockNumber) throw new Error(`the fork's head is block ${head}, not ${block}: refusing to read chain facts from any other state`);
  const at = { blockNumber } as const;

  const feedFact = async (address: Address): Promise<RawFeedFact> => {
    const [decimals, round] = await Promise.all([
      client.readContract({ address, abi: FEED_ABI, functionName: "decimals", ...at }),
      client.readContract({ address, abi: FEED_ABI, functionName: "latestRoundData", ...at }),
    ]);
    let description: string | null = null;
    try {
      description = await client.readContract({ address, abi: FEED_ABI, functionName: "description", ...at });
    } catch {
      description = null; // a contract without description() says so in words
    }
    if (round[1] < 0n) throw new Error(`feed ${address} answered a negative number at block ${block}`);
    return { address, description, decimals, answer: round[1].toString() };
  };

  const [b, feed, raw, cbEthDecimals, ethUsd, cbEthEth] = await Promise.all([
    client.getBlock(at),
    client.readContract({ address: CHAINLINK_ORACLE, abi: ORACLE_ABI, functionName: "getFeed", args: ["cbETH"], ...at }),
    client.readContract({ address: CHAINLINK_ORACLE, abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [MOONWELL_cbETH], ...at }),
    client.readContract({ address: TOKEN.cbETH, abi: ERC20_ABI, functionName: "decimals", ...at }),
    feedFact(RAW_FEED.ETH_USD.address),
    feedFact(RAW_FEED.cbETH_ETH.address),
  ]);
  if (feed.toLowerCase() === CBETH_FEED.afterProposal.toLowerCase()) {
    throw new Error(`getFeed("cbETH") at block ${block} is already the feed the proposal sets: refusing state after the proposal`);
  }
  let feedDescription: string | null = null;
  try {
    feedDescription = await client.readContract({ address: feed, abi: FEED_ABI, functionName: "description", ...at });
  } catch {
    feedDescription = null;
  }
  const facts: MoonwellChainFacts = {
    block,
    blockTimestamp: Number(b.timestamp),
    cbEthOracle: { market: MOONWELL_cbETH, feed, feedDescription, rawUnderlyingPrice: raw.toString(), priceUsd1e18: toUsd1e18(raw, cbEthDecimals).toString() },
    ethUsd,
    cbEthEth,
  };
  assertFactsShape(facts);
  return facts;
}

export interface ChainFactsReader {
  /** The facts at `block` (must be 42194662). Read once per block; later calls get the cached answer. */
  read(block: number): Promise<MoonwellChainFacts>;
  /** How many forks this reader has opened (for tests and evidence). */
  forksOpened(): number;
}

export function createChainFactsReader(
  opts: { openFork?: ForkOpener; rpcUrl?: string; readOnFork?: (fork: AnvilFork, block: number) => Promise<MoonwellChainFacts> } = {},
): ChainFactsReader {
  const open: ForkOpener = opts.openFork ?? withAnvilFork;
  const readOnFork = opts.readOnFork ?? ((fork: AnvilFork, block: number) => readChainFactsFrom(localOnly(fork.url), block));
  const cache = new Map<number, Promise<MoonwellChainFacts>>();
  let opened = 0;
  return {
    read(block: number) {
      if (block !== CHAIN_FACTS_BLOCK) return Promise.reject(new RangeError(`chain facts are read only at block ${CHAIN_FACTS_BLOCK} (before the proposal ran), not ${block}`));
      const hit = cache.get(block);
      if (hit) return hit;
      opened++;
      const p = open({ forkBlock: block, ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}) }, (fork) => readOnFork(fork, block));
      cache.set(block, p);
      p.catch(() => cache.delete(block)); // a failed read is tried again by the next round
      return p;
    },
    forksOpened: () => opened,
  };
}
