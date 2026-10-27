// D03-02 read check: fork Base at one block and collect the reads the acceptance checks need.
// Used by tests/unit/evm-reads.test.ts and, to write evidence, run directly:
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/evm-read-check.ts 42195500 <out.json> )
// The RPC URL is never written: the output names only the fork's local port and block.

import { writeFileSync } from "node:fs";
import { withAnvilFork } from "../../runners/evm/anvil.ts";
import { feedDecimals, feedDescription, latestRoundData, localClient, readMarketPrice } from "../../runners/evm/reads.ts";
import { FORK_BLOCK, MOONWELL_USDC, MOONWELL_WETH, MOONWELL_cbETH, RAW_FEED } from "../../runners/evm/moonwell-base.ts";
import { chainlinkTo1e18 } from "../../src/units.ts";

export async function evmReadCheck(forkBlock: number) {
  return withAnvilFork({ forkBlock }, async (fork) => {
    const client = localClient(fork.url);
    const chainId = await client.getChainId();
    const blockNumber = await client.getBlockNumber();

    const ethUsd = {
      address: RAW_FEED.ETH_USD.address,
      decimals: await feedDecimals(client, RAW_FEED.ETH_USD.address),
      description: await feedDescription(client, RAW_FEED.ETH_USD.address),
      round: await latestRoundData(client, RAW_FEED.ETH_USD.address),
    };
    const cbEthEth = {
      address: RAW_FEED.cbETH_ETH.address,
      decimals: await feedDecimals(client, RAW_FEED.cbETH_ETH.address),
      description: await feedDescription(client, RAW_FEED.cbETH_ETH.address),
      round: await latestRoundData(client, RAW_FEED.cbETH_ETH.address),
    };

    const weth = await readMarketPrice(client, MOONWELL_WETH);
    const usdc = await readMarketPrice(client, MOONWELL_USDC);
    const cbeth = await readMarketPrice(client, MOONWELL_cbETH);

    // The control: WETH's Moonwell price must equal the raw ETH/USD answer brought to 18 decimals.
    const ethUsd1e18 = chainlinkTo1e18(BigInt(ethUsd.round.answer), ethUsd.decimals).toString();
    const control = {
      rule: "getUnderlyingPrice(MOONWELL_WETH) == ETH/USD latestRoundData().answer × 10^(18 − 8), exact",
      wethRawUnderlyingPrice: weth.rawUnderlyingPrice,
      ethUsdAnswerTimes1e10: ethUsd1e18,
      matched: weth.rawUnderlyingPrice === ethUsd1e18 && ethUsd.decimals === 8,
    };

    return {
      forkBlock,
      blockNumberOnFork: Number(blockNumber),
      chainId,
      rpc: "local anvil fork; remote RPC URL not recorded",
      rawFeeds: { ethUsd, cbEthEth },
      markets: { WETH: weth, USDC: usdc, cbETH: cbeth },
      control,
    };
  });
}

// Run directly: write the evidence file.
if (import.meta.url === `file://${process.argv[1]}`) {
  const block = Number(process.argv[2] ?? FORK_BLOCK.readCheck);
  const out = process.argv[3];
  const started = new Date().toISOString();
  const result = await evmReadCheck(block);
  const json = JSON.stringify({ startedAt: started, finishedAt: new Date().toISOString(), ...result }, null, 2) + "\n";
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}
