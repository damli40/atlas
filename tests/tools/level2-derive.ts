// D04-01: derive MIP-X43's 14 (symbol, wrapper) actions from the PR files by plain code, reading
// each token's symbol() on a fork at 42194662, and compare them as a set with the 14 real FeedSet
// events stored in tests/oracle/mipx43-feedset-42194663.json.
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level2-derive.ts tests/evidence/D04-01/derived-vs-real.json )

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { comparePairs, resolveSymbols, type FeedAction, type FeedPair } from "../../runners/evm/apply.ts";
import { withAnvilFork } from "../../runners/evm/anvil.ts";
import { FORK_BLOCK } from "../../runners/evm/moonwell-base.ts";
import { localClient } from "../../runners/evm/reads.ts";
import { plannedFromPr } from "./level2-precheck.ts";

export const FEEDSET_FILE = join(import.meta.dirname, "..", "oracle", "mipx43-feedset-42194663.json");

export function realFeedSetPairs(): FeedPair[] {
  const d = JSON.parse(readFileSync(FEEDSET_FILE, "utf8")) as { events: Array<{ symbol: string; wrapper: `0x${string}` }> };
  return d.events.map((e) => ({ symbol: e.symbol, wrapper: e.wrapper }));
}

/** Derive the 14 actions on a fork at the given block (the symbol is read on-chain, as mip-x43.sol does). */
export async function deriveActionsOnFork(forkBlock = FORK_BLOCK.beforeProposal): Promise<FeedAction[]> {
  const planned = plannedFromPr();
  return withAnvilFork({ forkBlock }, (fork) => resolveSymbols(localClient(fork.url), planned));
}

export async function derivedVsReal(forkBlock = FORK_BLOCK.beforeProposal) {
  const actions = await deriveActionsOnFork(forkBlock);
  const derived = actions.map((a) => ({ symbol: a.symbol, wrapper: a.wrapper }));
  const real = realFeedSetPairs();
  const cmp = comparePairs(derived, real);
  return {
    forkBlock,
    method:
      "ChainlinkOracleConfigs.sol uncommented BASE_CHAIN_ID pushes (A, B, C) -> wrapper = chains/8453.json[A + \"_OEV_WRAPPER\"], symbol = ERC20(chains/8453.json[B]).symbol() on the fork (mip-x43.sol _wireCoreFeeds)",
    derivedCount: derived.length,
    realCount: real.length,
    setEqual: cmp.equal,
    comparison: cmp,
    derived: actions.map((a) => ({
      line: a.config.line,
      config: [a.config.oracleName, a.config.tokenKey, a.config.mTokenKey],
      token: a.token,
      symbolOnChain: a.symbol,
      wrapperName: a.wrapperName,
      wrapper: a.wrapper,
      mToken: a.mToken,
    })),
    real,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "tests/evidence/D04-01/derived-vs-real.json";
  const r = await derivedVsReal();
  writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), ...r }, null, 2) + "\n");
  process.stdout.write(`derived ${r.derivedCount}, real ${r.realCount}, set equal ${r.setEqual}; only derived ${r.comparison.onlyDerived.length}, only real ${r.comparison.onlyReal.length}\n`);
}
