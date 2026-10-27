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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, encodeFunctionData, parseAbi, toEventSelector, type Address, type Hex, type PublicClient } from "viem";
import { CHAINLINK_ORACLE } from "./moonwell-base.ts";
import { tokenSymbol } from "./reads.ts";

/** The byte-for-byte copies of PR #578's files at its merge commit (checked by D03-04). */
export const MOONWELL_PR_COPY = join(import.meta.dirname, "..", "..", "contracts", "lib", "moonwell");

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

/** Read the PR's ChainlinkOracleConfigs.sol and chains/8453.json from contracts/lib/moonwell/ and plan the actions. */
export function planFromPrFiles(dir = MOONWELL_PR_COPY): PlannedFeedAction[] {
  const configs = readFileSync(join(dir, "proposals", "ChainlinkOracleConfigs.sol"), "utf8");
  const chain = readFileSync(join(dir, "chains", "8453.json"), "utf8");
  return planFeedActions(parseBaseOracleConfigs(configs), loadAddressBook(chain));
}

// ── Applying the actions on a local fork ────────────────────────────────────────────────────────

const SET_FEED_ABI = parseAbi(["function setFeed(string symbol, address feed)"]);
export const FEED_SET_EVENT = "event FeedSet(address feed, string symbol)";
const FEED_SET_ABI = parseAbi([FEED_SET_EVENT]);
const FEED_SET_TOPIC = toEventSelector(FEED_SET_EVENT);

/** What happened on the fork for one setFeed call. */
export interface AppliedFeedAction {
  symbol: string;
  wrapper: Address;
  /** The fork's own transaction hash (a local anvil hash, not a Base hash). */
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: number;
  gasUsed: string;
  /** FeedSet events the oracle emitted in this transaction, decoded. */
  feedSetEvents: FeedPair[];
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** A raw JSON-RPC call to the local fork. Anvil-only methods (anvil_*) are not in viem's public client types. */
export function forkRpc(client: PublicClient): Rpc {
  return (method, params) => client.request({ method: method as never, params: params as never }) as Promise<unknown>;
}

/**
 * Become the oracle's admin on the fork (anvil_impersonateAccount + anvil_setBalance 1 ETH), then
 * send setFeed(symbol, wrapper) from it for each action, in order, waiting for each receipt.
 * Throws on the first failure with the step that failed; never skips an action.
 */
export async function applyFeedActions(client: PublicClient, admin: Address, actions: FeedPair[]): Promise<AppliedFeedAction[]> {
  const rpc = forkRpc(client);
  try {
    await rpc("anvil_impersonateAccount", [admin]);
  } catch (e) {
    throw new Error(`anvil_impersonateAccount(${admin}) failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await rpc("anvil_setBalance", [admin, "0xde0b6b3a7640000"]);
  } catch (e) {
    throw new Error(`anvil_setBalance(${admin}, 1 ETH) failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out: AppliedFeedAction[] = [];
  for (const a of actions) {
    const data = encodeFunctionData({ abi: SET_FEED_ABI, functionName: "setFeed", args: [a.symbol, a.wrapper] });
    let txHash: Hex;
    try {
      txHash = (await rpc("eth_sendTransaction", [{ from: admin, to: CHAINLINK_ORACLE, data }])) as Hex;
    } catch (e) {
      throw new Error(`setFeed("${a.symbol}", ${a.wrapper}) from ${admin} was not accepted: ${e instanceof Error ? e.message : String(e)}`);
    }
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, pollingInterval: 50, timeout: 60_000 });
    const feedSetEvents = receipt.logs
      .filter((l) => l.address.toLowerCase() === CHAINLINK_ORACLE.toLowerCase() && l.topics[0] === FEED_SET_TOPIC)
      .map((l) => {
        const d = decodeEventLog({ abi: FEED_SET_ABI, data: l.data, topics: l.topics });
        return { symbol: d.args.symbol, wrapper: d.args.feed };
      });
    out.push({ symbol: a.symbol, wrapper: a.wrapper, txHash, status: receipt.status, blockNumber: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString(), feedSetEvents });
    if (receipt.status !== "success") throw Object.assign(new Error(`setFeed("${a.symbol}", ${a.wrapper}) reverted on the fork (tx ${txHash})`), { applied: out });
  }
  try {
    await rpc("anvil_stopImpersonatingAccount", [admin]);
  } catch {
    /* the fork is thrown away after the run; nothing depends on this */
  }
  return out;
}

// ── Counting the price sources behind one read (debug_traceCall, callTracer) ────────────────────

/** latestRoundData() selector. */
export const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";

export interface CallFrame {
  type?: string;
  to?: string;
  input?: string;
  error?: string;
  calls?: CallFrame[];
}

export type SourceCount =
  | {
      ok: true;
      /** Distinct addresses called with latestRoundData() that make no further latestRoundData() call: where the numbers come from. */
      sources: Address[];
      count: number;
      /** Every distinct address called with latestRoundData(), in call order, outermost first (wrappers and proxies included). */
      latestRoundDataCallees: Address[];
      method: string;
    }
  | { ok: false; reason: string; rawShape: unknown };

export const SOURCE_COUNT_METHOD =
  "debug_traceCall with callTracer on getUnderlyingPrice; walk the call tree; keep calls whose input starts with latestRoundData() (0xfeaf968c); count the distinct callee addresses that make no further latestRoundData() call themselves (the aggregators the numbers come from; wrappers and Chainlink proxies pass a call through and are not counted)";

const isFrame = (x: unknown): x is CallFrame => typeof x === "object" && x !== null && !Array.isArray(x);

/** Pure: count the price sources in a callTracer result. Not measured when the shape is not a call tree. */
export function countPriceSources(trace: unknown): SourceCount {
  if (!isFrame(trace) || typeof trace.to !== "string" || typeof trace.input !== "string") {
    return { ok: false, reason: "the trace is not a callTracer call tree (no top-level to/input)", rawShape: summarizeShape(trace) };
  }
  const callees: string[] = [];
  const sources: string[] = [];
  let malformed = false;
  const visit = (f: CallFrame): boolean => {
    // returns: did this subtree contain a latestRoundData call?
    const isLrd = typeof f.input === "string" && f.input.toLowerCase().startsWith(LATEST_ROUND_DATA_SELECTOR) && typeof f.to === "string";
    if (isLrd && !callees.includes(f.to!.toLowerCase())) callees.push(f.to!.toLowerCase()); // call order (outermost first)
    const kids = f.calls ?? [];
    if (!Array.isArray(kids)) {
      malformed = true;
      return false;
    }
    let below = false;
    for (const k of kids) {
      if (!isFrame(k)) {
        malformed = true;
        continue;
      }
      if (visit(k)) below = true;
    }
    if (isLrd && !below && !sources.includes(f.to!.toLowerCase())) sources.push(f.to!.toLowerCase());
    return isLrd || below;
  };
  visit(trace);
  if (malformed) return { ok: false, reason: "the call tree has a calls field that is not a list of frames", rawShape: summarizeShape(trace) };
  if (callees.length === 0) return { ok: false, reason: "no latestRoundData() call appears in the trace", rawShape: summarizeShape(trace) };
  return {
    ok: true,
    sources: sources as Address[],
    count: sources.length,
    latestRoundDataCallees: callees as Address[],
    method: SOURCE_COUNT_METHOD,
  };
}

/** The keys and nesting of a trace, without values, for evidence when its shape is unexpected. */
function summarizeShape(x: unknown, depth = 0): unknown {
  if (depth > 4) return "…";
  if (Array.isArray(x)) return x.length ? [summarizeShape(x[0], depth + 1), `(${x.length} items)`] : [];
  if (isFrame(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, summarizeShape(v, depth + 1)]));
  return typeof x;
}

/** Trace getUnderlyingPrice(mToken) on the fork's latest block and count its price sources. */
export async function traceUnderlyingPriceSources(client: PublicClient, mToken: Address): Promise<SourceCount & { calledAt: "latest" }> {
  const data = encodeFunctionData({ abi: parseAbi(["function getUnderlyingPrice(address mToken) view returns (uint256)"]), functionName: "getUnderlyingPrice", args: [mToken] });
  let raw: unknown;
  try {
    raw = await forkRpc(client)("debug_traceCall", [{ to: CHAINLINK_ORACLE, data }, "latest", { tracer: "callTracer" }]);
  } catch (e) {
    return { ok: false, reason: `debug_traceCall failed: ${e instanceof Error ? e.message : String(e)}`, rawShape: null, calledAt: "latest" };
  }
  return { ...countPriceSources(raw), calledAt: "latest" };
}
