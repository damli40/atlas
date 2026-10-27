// D03-02: anvil wrapper, reads and units.
// The first block runs everywhere (no network). The second needs BASE_RPC_URL (a Base archive RPC);
// without it those tests are skipped, not failed, so a clone without the secret stays green.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { liveAnvilCount, redact, startAnvil, withAnvilFork } from "../../runners/evm/anvil.ts";
import { localClient } from "../../runners/evm/reads.ts";
import { FORK_BLOCK, TOKEN } from "../../runners/evm/moonwell-base.ts";
import { evmReadCheck } from "../tools/evm-read-check.ts";

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;

describe("anvil wrapper and reads (offline)", () => {
  it("redact hides the URL, its token path and its host", () => {
    const secret = "https://example-node.invalid/abcDEF1234567890token/"; // secret-scan: allow
    const text = `error sending request for url (${secret}) at abcDEF1234567890token on example-node.invalid`;
    const out = redact(text, secret);
    expect(out).not.toContain("abcDEF1234567890token");
    expect(out).not.toContain("example-node.invalid");
  });

  it("reads refuse any URL that is not a local fork", () => {
    expect(() => localClient("https://mainnet.base.org")).toThrow(/local anvil/);
    expect(() => localClient("http://10.0.0.1:8545")).toThrow(/local anvil/);
    expect(() => localClient("http://127.0.0.1:8545")).not.toThrow();
  });

  it.skipIf(!HAS_ANVIL)("a fork that cannot reach its RPC fails with a redacted message and leaves no process", async () => {
    const fake = "http://127.0.0.1:9/zzSecretPathToken987654"; // secret-scan: allow
    let message = "";
    try {
      const fork = await startAnvil({ forkBlock: 1, rpcUrl: fake, readyTimeoutMs: 20_000 });
      await fork.stop();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("zzSecretPathToken987654");
    expect(liveAnvilCount()).toBe(0);
  }, 30_000);
});

describe.skipIf(!HAS_RPC || !HAS_ANVIL)(`reads on a Base fork at block ${FORK_BLOCK.readCheck}`, () => {
  let result: Awaited<ReturnType<typeof evmReadCheck>>;

  it("forks, reads, and stops the fork", async () => {
    result = await evmReadCheck(FORK_BLOCK.readCheck);
    expect(result.chainId).toBe(8453);
    expect(result.blockNumberOnFork).toBe(FORK_BLOCK.readCheck);
    expect(liveAnvilCount()).toBe(0);
  }, 180_000);

  it("control: getUnderlyingPrice(MOONWELL_WETH) equals the ETH/USD answer × 1e10 exactly", () => {
    const answer = BigInt(result.rawFeeds.ethUsd.round.answer);
    expect(answer > 0n).toBe(true);
    expect(BigInt(result.markets.WETH.rawUnderlyingPrice)).toBe(answer * 10n ** 10n);
    expect(result.control.matched).toBe(true);
  });

  it("feed decimals read on-chain: ETH/USD 8, cbETH/ETH 18", () => {
    expect(result.rawFeeds.ethUsd.decimals).toBe(8);
    expect(result.rawFeeds.cbEthEth.decimals).toBe(18);
  });

  it("units trap: USDC has 6 decimals and its normalised price is between 0.98 and 1.02 USD", () => {
    const usdc = result.markets.USDC;
    expect(usdc.underlying.toLowerCase()).toBe(TOKEN.USDC.toLowerCase());
    expect(usdc.tokenDecimals).toBe(6);
    const p = BigInt(usdc.priceUsd1e18);
    expect(p >= 980_000_000_000_000_000n && p <= 1_020_000_000_000_000_000n).toBe(true);
    // The raw value is about 1e30: comparing it to a USD bet without units.ts would be wrong by 1e12.
    expect(BigInt(usdc.rawUnderlyingPrice) > 10n ** 29n).toBe(true);
  });

  it("the fork is stopped even when the work inside it throws", async () => {
    await expect(
      withAnvilFork({ forkBlock: FORK_BLOCK.readCheck }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(liveAnvilCount()).toBe(0);
  }, 120_000);
});
