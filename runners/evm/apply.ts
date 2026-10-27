// Level 2: derive MIP-X43's oracle-feed actions from the pull request's own files, by plain code.
//
// Plain words: the proposal tells Moonwell's price oracle "for token X, use price feed Y" fourteen
// times on Base. It does this in `mip-x43.sol::_wireCoreFeeds`, which walks a list of configs
// written in `ChainlinkOracleConfigs.sol`. Each config is three names, (A, B, C):
//   A = the Chainlink feed's name, B = the token's name, C = the market's name,
// all keys of `chains/8453.json` (the repo's address book for Base). For each config the proposal
// does exactly this (mip-x43.sol lines 207-232 at the merge commit):
//   wrapper = addresses[A + "_OEV_WRAPPER"]
//   symbol  = ERC20(addresses[B]).symbol()        <- read from the chain, not the config text
//   ChainlinkOracle.setFeed(symbol, wrapper)
// So B is NOT the symbol: for USDbC the config says "USDBC" and for WELL it says "xWELL_PROXY".
// The symbol the oracle is keyed by is whatever the token contract answers on-chain.
//
// This file reproduces that list with no model involved. It never guesses: a config line it
// cannot parse, or a name missing from the address book, is an error, not a skipped row.

import type { Address, PublicClient } from "viem";
import { tokenSymbol } from "./reads.ts";

export interface OracleConfig {
  /** A: the Chainlink feed's name in chains/8453.json, e.g. "cbETHETH_ORACLE". */
  oracleName: string;
  /** B: the token's name in chains/8453.json (not its symbol), e.g. "USDBC". */
  tokenKey: string;
  /** C: the market's name in chains/8453.json, e.g. "MOONWELL_cbETH". */
  mTokenKey: string;
  /** 1-based line of the `push(` in ChainlinkOracleConfigs.sol, for showing where it came from. */
  line: number;
}

/**
 * Remove // and /* *\/ comments from Solidity source, keeping every newline (so line numbers still
 * match the file) and leaving string literals alone (a "//" inside quotes is not a comment).
 */
export function stripSolidityComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const PUSH_START = /_oracleConfigs\s*\[\s*BASE_CHAIN_ID\s*\]\s*\.\s*push\s*\(/g;
const PUSH_FULL = /^_oracleConfigs\s*\[\s*BASE_CHAIN_ID\s*\]\s*\.\s*push\s*\(\s*OracleConfig\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)\s*\)\s*;/;

/**
 * Every uncommented `_oracleConfigs[BASE_CHAIN_ID].push(OracleConfig("A", "B", "C"));` in
 * ChainlinkOracleConfigs.sol, in file order. The push and its OracleConfig(...) may sit on
 * different lines. A push that starts but does not have exactly that shape throws, so a config
 * can never be dropped silently.
 */
export function parseBaseOracleConfigs(sol: string): OracleConfig[] {
  const code = stripSolidityComments(sol);
  const out: OracleConfig[] = [];
  for (const m of code.matchAll(PUSH_START)) {
    const at = m.index!;
    const full = PUSH_FULL.exec(code.slice(at));
    const line = code.slice(0, at).split("\n").length;
    if (!full) {
      throw new Error(`ChainlinkOracleConfigs.sol line ${line}: a BASE_CHAIN_ID push that is not OracleConfig("A", "B", "C"); refusing to guess`);
    }
    out.push({ oracleName: full[1]!, tokenKey: full[2]!, mTokenKey: full[3]!, line });
  }
  return out;
}

/** chains/8453.json → name → address. Throws on a repeated name (the lookup would be ambiguous). */
export function loadAddressBook(json: string): Map<string, Address> {
  const rows = JSON.parse(json) as Array<{ addr: string; name: string }>;
  if (!Array.isArray(rows)) throw new Error("chains/8453.json is not a list of { addr, name }");
  const book = new Map<string, Address>();
  for (const r of rows) {
    if (typeof r?.name !== "string" || typeof r?.addr !== "string") throw new Error("chains/8453.json has a row without name/addr");
    if (book.has(r.name)) throw new Error(`chains/8453.json names ${r.name} twice`);
    book.set(r.name, r.addr as Address);
  }
  return book;
}

function lookup(book: Map<string, Address>, name: string, why: string): Address {
  const a = book.get(name);
  if (!a) throw new Error(`chains/8453.json has no address named ${name} (${why})`);
  return a;
}

/** One action before the symbol is read from the chain: every address comes from the PR's own files. */
export interface PlannedFeedAction {
  config: OracleConfig;
  wrapperName: string;
  wrapper: Address;
  token: Address;
  mToken: Address;
}

/** Pure: configs + address book → wrapper, token and market address for each config. */
export function planFeedActions(configs: OracleConfig[], book: Map<string, Address>): PlannedFeedAction[] {
  return configs.map((config) => {
    const wrapperName = `${config.oracleName}_OEV_WRAPPER`;
    return {
      config,
      wrapperName,
      wrapper: lookup(book, wrapperName, `wrapper for ${config.oracleName}`),
      token: lookup(book, config.tokenKey, "token"),
      mToken: lookup(book, config.mTokenKey, "market"),
    };
  });
}

/** A planned action with its oracle key read on-chain: setFeed(symbol, wrapper). */
export interface FeedAction extends PlannedFeedAction {
  /** ERC20(token).symbol() on the fork: the key the proposal passes to setFeed. */
  symbol: string;
}

/** Read each token's symbol() on the fork, as mip-x43.sol does, to complete the actions. */
export async function resolveSymbols(client: PublicClient, planned: PlannedFeedAction[]): Promise<FeedAction[]> {
  const out: FeedAction[] = [];
  for (const p of planned) out.push({ ...p, symbol: await tokenSymbol(client, p.token) });
  return out;
}

/** A (symbol, wrapper) pair, the unit both lists are compared in. */
export interface FeedPair {
  symbol: string;
  wrapper: Address;
}

const pairKey = (p: FeedPair) => `${p.symbol}\u0000${p.wrapper.toLowerCase()}`;

export interface PairComparison {
  /** True when both lists hold the same pairs (as sets) and neither repeats a pair. */
  equal: boolean;
  onlyDerived: FeedPair[];
  onlyReal: FeedPair[];
  duplicatesDerived: FeedPair[];
  duplicatesReal: FeedPair[];
}

/** Set comparison of derived vs real (symbol, wrapper) pairs; addresses compared case-insensitively. */
export function comparePairs(derived: FeedPair[], real: FeedPair[]): PairComparison {
  const dupes = (xs: FeedPair[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => (seen.has(pairKey(x)) ? true : (seen.add(pairKey(x)), false)));
  };
  const dk = new Set(derived.map(pairKey));
  const rk = new Set(real.map(pairKey));
  const onlyDerived = derived.filter((p) => !rk.has(pairKey(p)));
  const onlyReal = real.filter((p) => !dk.has(pairKey(p)));
  const duplicatesDerived = dupes(derived);
  const duplicatesReal = dupes(real);
  return {
    equal: onlyDerived.length === 0 && onlyReal.length === 0 && duplicatesDerived.length === 0 && duplicatesReal.length === 0,
    onlyDerived,
    onlyReal,
    duplicatesDerived,
    duplicatesReal,
  };
}
