// D03-03: the EVM Runner's Level 1 price read, its control, the cbETH reference, and the
// pre-execution guard for Level 2.
// The first block runs everywhere (no network). The second needs BASE_RPC_URL (a Base archive RPC);
// without it those tests are skipped, not failed.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { judge } from "../../src/judge.ts";
import type { Run } from "../../src/types.ts";
import { usdTimesRatio1e18 } from "../../src/units.ts";
import { liveAnvilCount, withAnvilFork } from "../../runners/evm/anvil.ts";
import { assertPreExecution, controlReasons, inStablecoinBand, type EvmControlRecord } from "../../runners/evm/control.ts";
import { CBETH_FEED, FORK_BLOCK, USD_STABLECOINS } from "../../runners/evm/moonwell-base.ts";
import { evmRunner } from "../../runners/evm/runner.ts";
import { humanBet, level1Experiment, level1Run } from "../tools/level1-run.ts";

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;
const E18 = 10n ** 18n;

function goodControl(): Omit<EvmControlRecord, "passed" | "reasons"> {
  const weth = {
    read: { rawUnderlyingPrice: "1965580189520000000000" },
    wiredFeedRound: { roundId: "1", answer: "196558018952", updatedAt: "1" },
    expectedRawUnderlyingPrice: "1965580189520000000000",
    matched: true,
  } as unknown as EvmControlRecord["weth"];
  return {
    forkBlock: 42194663,
    chainId: 8453,
    blockNumberOnFork: 42194663,
    weth,
    wiredVsRaw: {
      wiredFeed: "0x0", wiredFeedIsRawAggregator: false, wiredFeedAnswer: "196558018952", wiredFeedDecimals: 8,
      rawAggregator: "0x0", rawAnswer: "196558018952", rawDecimals: 8, rawRoundId: "1", equalAt1e18: true,
    } as EvmControlRecord["wiredVsRaw"],
    stablecoins: USD_STABLECOINS.map((symbol) => ({
      symbol, mToken: "0x0", tokenDecimals: 6, feedAddress: "0x0", rawUnderlyingPrice: "0", priceUsd1e18: "999900000000000000", inBand: true,
    })) as EvmControlRecord["stablecoins"],
  };
}

describe("EVM runner, offline", () => {
  it("run() refuses a missing fork block instead of defaulting it", async () => {
    await expect(evmRunner().run(level1Experiment(), {})).rejects.toThrow(/forkBlock is required/);
    await expect(evmRunner().run(level1Experiment(), { forkBlock: 0 })).rejects.toThrow(/positive whole number/);
  });

  it("control() refuses to run without a fork block", async () => {
    await expect(evmRunner().control(level1Experiment().target)).rejects.toThrow(/forkBlock is required/);
  });

  it("run() refuses shapes Level 1 does not run, and gate-rejected experiments", async () => {
    const exp = level1Experiment();
    await expect(
      evmRunner().run({ ...exp, params: { shape: "apply-proposal-then-read", markets: ["cbETH"] } }, { forkBlock: 42194662 }),
    ).rejects.toThrow(/does not run "apply-proposal-then-read" yet/);
    await expect(evmRunner().run({ ...exp, gate: { allowed: false, reason: "no" } }, { forkBlock: 42194662 })).rejects.toThrow(/rejected by the gate/);
  });

  it("control reasons: a good record passes; each failing check names itself", () => {
    expect(controlReasons(goodControl())).toEqual([]);
    const wethOff = goodControl();
    wethOff.weth = { ...wethOff.weth!, matched: false };
    expect(controlReasons(wethOff).join()).toMatch(/WETH control did not match/);
    const stableOff = goodControl();
    stableOff.stablecoins[0] = { ...stableOff.stablecoins[0]!, priceUsd1e18: "999900000000000000000000000000", inBand: false };
    expect(controlReasons(stableOff).join()).toMatch(/USDC reads .* outside 0.95–1.05 USD/);
    const missing = goodControl();
    missing.stablecoins.pop();
    expect(controlReasons(missing).join()).toMatch(/USDS stablecoin control was not read/);
    expect(controlReasons({ ...goodControl(), blockNumberOnFork: 42194662 }).join()).toMatch(/not the block asked for/);
    expect(controlReasons({ ...goodControl(), chainId: 1 }).join()).toMatch(/not Base/);
    // PASS-RULE.md names the raw ETH/USD answer: a wrapper that lags the raw feed fails the control.
    const lagging = goodControl();
    lagging.wiredVsRaw = { ...lagging.wiredVsRaw!, rawAnswer: "196600000000", equalAt1e18: false };
    expect(controlReasons(lagging).join()).toMatch(/differs from the raw ETH\/USD answer/);
    expect(controlReasons({ ...goodControl(), wiredVsRaw: undefined }).join()).toMatch(/raw ETH\/USD aggregator was not read/);
  });

  it("stablecoin band is 0.95–1.05 USD inclusive", () => {
    expect(inStablecoinBand(950_000_000_000_000_000n)).toBe(true);
    expect(inStablecoinBand(1_050_000_000_000_000_000n)).toBe(true);
    expect(inStablecoinBand(949_999_999_999_999_999n)).toBe(false);
    expect(inStablecoinBand(1_050_000_000_000_000_001n)).toBe(false);
    expect(inStablecoinBand(999_900_000_000_000_000n * 10n ** 12n)).toBe(false); // a raw 6-decimal price
  });

  it("reference arithmetic: $1,965.58 × 1.12266 = $2,206.68 in USD 1e18", () => {
    expect(usdTimesRatio1e18(1965580189520000000000n, 1122662744874806300n)).toBe(2206683650838065175827n);
  });

  it("a run whose control failed makes the 2200 bet can't check, whatever was read", () => {
    const exp = level1Experiment();
    const run: Run = {
      id: "r", experimentId: exp.id, runner: "evm", executor: "local", codeSha256: exp.target.codeSha256, forkBlock: 42194663, chainId: 8453,
      startedAt: "", finishedAt: "", trace: [],
      result: { measured: { "priceUsd1e18:cbETH": "1122662744874806300" }, notMeasured: { control: "WETH control did not match" } },
      controlPassed: false,
    };
    const v = judge(humanBet(exp), run);
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toMatch(/WETH control did not match/);
  });
});

describe.skipIf(!HAS_RPC || !HAS_ANVIL)("Level 1 on Base forks (MIP-X43)", () => {
  it(`after the fact, block ${FORK_BLOCK.proposalExecuted}: cbETH ≈ $1.12, reference ≈ $2,2xx, control passed, 2200 bet judged`, async () => {
    const exp = level1Experiment();
    const bet = humanBet(exp);
    const run = await level1Run(FORK_BLOCK.proposalExecuted, exp);
    expect(run.controlPassed).toBe(true);
    expect(run.forkBlock).toBe(FORK_BLOCK.proposalExecuted);
    expect(run.chainId).toBe(8453);

    const m = run.result.measured;
    const price = BigInt(m["priceUsd1e18:cbETH"] as string);
    expect(price >= 1n * E18 && price <= 13n * E18 / 10n).toBe(true);
    expect(String(m["feedAddress:cbETH"]).toLowerCase()).toBe(CBETH_FEED.afterProposal.toLowerCase());
    expect(m["feedDecimals:cbETH"]).toBe(18);

    const ref = run.result.references?.["refUsd1e18:cbETH"];
    expect(ref).toBeDefined();
    const refValue = BigInt(ref!.value);
    expect(refValue >= 15n * 10n ** 20n && refValue <= 35n * 10n ** 20n).toBe(true);
    expect(ref!.method).toBe(`Chainlink ETH/USD × cbETH/ETH at block ${FORK_BLOCK.proposalExecuted}, decimals 8 and 18 read on-chain`);
    const inputs = run.trace.find((e) => e.event === "reference")?.data?.inputs as { ethUsd: { decimals: number }; cbEthEth: { decimals: number } };
    expect(inputs.ethUsd.decimals).toBe(8);
    expect(inputs.cbEthEth.decimals).toBe(18);

    const verdict = judge(bet, run);
    expect(verdict.outcome).toBe("not_matched");
    expect(verdict.observed).toBe(m["priceUsd1e18:cbETH"]);
    expect(liveAnvilCount()).toBe(0);
  }, 300_000);

  it(`one block before, ${FORK_BLOCK.beforeProposal}: cbETH ≈ $2,2xx on the old feed 0xB0Ba…`, async () => {
    const run = await level1Run(FORK_BLOCK.beforeProposal);
    expect(run.controlPassed).toBe(true);
    const price = BigInt(run.result.measured["priceUsd1e18:cbETH"] as string);
    expect(price > 2n * 10n ** 21n && price < 25n * 10n ** 20n).toBe(true);
    expect(String(run.result.measured["feedAddress:cbETH"]).toLowerCase()).toBe(CBETH_FEED.before.toLowerCase());
  }, 300_000);

  it("assertPreExecution passes at 42194662 and fails at 42194663 with \"fork is not pre-execution\"", async () => {
    const pre = await withAnvilFork({ forkBlock: FORK_BLOCK.beforeProposal }, (fork) => assertPreExecution(fork));
    expect(pre.cbEthFeed.toLowerCase()).toBe(CBETH_FEED.before.toLowerCase());
    expect(BigInt(pre.cbEthPriceUsd1e18) > 10n ** 21n).toBe(true);
    await expect(
      withAnvilFork({ forkBlock: FORK_BLOCK.proposalExecuted }, (fork) => assertPreExecution(fork)),
    ).rejects.toThrow(/fork is not pre-execution/);
    expect(liveAnvilCount()).toBe(0);
  }, 300_000);
});
