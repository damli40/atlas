// D04-00 pre-flight for Level 2: at fork 42194662 (one block before MIP-X43 ran), does every OEV
// wrapper the proposal points the oracle at already have code, and is the oracle's admin the
// TemporalGovernor? If a wrapper has no code, setFeed would point at an empty address and Level 2
// cannot run at that block, and a fallback would be needed. This script only reads; it never works around.
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level2-precheck.ts tests/evidence/D04-00/precheck.json )
// The RPC URL is never written.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Address } from "viem";
import { withAnvilFork } from "../../runners/evm/anvil.ts";
import { MOONWELL_PR_COPY, planFromPrFiles } from "../../runners/evm/apply.ts";
import { CHAINLINK_ORACLE, FORK_BLOCK, TEMPORAL_GOVERNOR } from "../../runners/evm/moonwell-base.ts";
import { localClient } from "../../runners/evm/reads.ts";

export function prFiles() {
  return {
    configs: readFileSync(join(MOONWELL_PR_COPY, "proposals", "ChainlinkOracleConfigs.sol"), "utf8"),
    chain: readFileSync(join(MOONWELL_PR_COPY, "chains", "8453.json"), "utf8"),
  };
}

export const plannedFromPr = () => planFromPrFiles();

export async function level2Precheck(forkBlock = FORK_BLOCK.beforeProposal) {
  const planned = plannedFromPr();
  return withAnvilFork({ forkBlock }, async (fork) => {
    const client = localClient(fork.url);
    const chainId = await client.getChainId();
    const blockNumberOnFork = Number(await client.getBlockNumber());
    const wrappers = [];
    for (const p of planned) {
      const code = (await client.getCode({ address: p.wrapper })) ?? "0x";
      const codeBytes = code === "0x" ? 0 : (code.length - 2) / 2;
      wrappers.push({ config: p.config, wrapperName: p.wrapperName, wrapper: p.wrapper, codeBytes, hasCode: codeBytes > 0 });
    }
    const admin = (await client.readContract({
      address: CHAINLINK_ORACLE,
      abi: parseAbi(["function admin() view returns (address)"]),
      functionName: "admin",
    })) as Address;
    const adminIsTemporalGovernor = admin.toLowerCase() === TEMPORAL_GOVERNOR.toLowerCase();
    const missing = wrappers.filter((w) => !w.hasCode).map((w) => w.wrapperName);
    return {
      forkBlock,
      chainId,
      blockNumberOnFork,
      oracle: CHAINLINK_ORACLE,
      admin,
      expectedAdmin: TEMPORAL_GOVERNOR,
      adminIsTemporalGovernor,
      wrapperCount: wrappers.length,
      distinctWrapperCount: new Set(wrappers.map((w) => w.wrapper.toLowerCase())).size,
      wrappers,
      missingCode: missing,
      passed: wrappers.length === 14 && missing.length === 0 && adminIsTemporalGovernor && chainId === 8453 && blockNumberOnFork === forkBlock,
    };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "tests/evidence/D04-00/precheck.json";
  const r = await level2Precheck();
  writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), ...r }, null, 2) + "\n");
  process.stdout.write(`passed ${r.passed}; ${r.wrapperCount} wrappers (${r.distinctWrapperCount} distinct), missing code: ${r.missingCode.join(", ") || "none"}; admin ${r.admin}\n`);
}
