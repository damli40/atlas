// D04-02: Level 2 (apply-proposal-then-read). Offline: the pass rule's arithmetic, the trace
// counter, and "can't check" when a control fails. With BASE_RPC_URL and anvil: the real run at
// 42194662 and the pre-execution guard at 42194663. Without them those tests skip, not fail.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { countPriceSources } from "../../runners/evm/apply.ts";
import { withAnvilFork } from "../../runners/evm/anvil.ts";
import { diffPpm, differsByMoreThan, evaluatePassRule, falseAlarmTable, ppmToPct, runLevel2OnFork, type Level2Record } from "../../runners/evm/level2.ts";
import { localClient } from "../../runners/evm/reads.ts";
import { evmRunner } from "../../runners/evm/runner.ts";
import { level2Evidence, level2Experiment } from "../tools/level2-run.ts";

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;
const LRD = "0xfeaf968c";

describe("Level 2 pass-rule arithmetic (offline)", () => {
  it("percentages are exact bigint math, the 2% and 50% edges are inclusive-not-flagged", () => {
    expect(ppmToPct(diffPpm(1122662744874806300n, 2206683650838065175827n))).toBe("-99.9491%");
    expect(ppmToPct(0n)).toBe("0.0000%");
    expect(ppmToPct(diffPpm(102n, 100n))).toBe("+2.0000%");
    expect(differsByMoreThan(102n, 100n, 2n)).toBe(false); // exactly 2%: within
    expect(differsByMoreThan(10201n, 10000n, 2n)).toBe(true);
    expect(differsByMoreThan(50n, 100n, 50n)).toBe(false); // exactly 50%: not flagged
    expect(differsByMoreThan(49n, 100n, 50n)).toBe(true);
    expect(() => diffPpm(1n, 0n)).toThrow(/above zero/);
  });
});

describe("price-source counter over a callTracer tree (offline)", () => {
  const frame = (to: string, input: string, calls: unknown[] = []) => ({ type: "STATICCALL", to, input, calls });
  it("wrapper → proxy → aggregator counts 1 source; a composite over two proxies counts 2", () => {
    const single = frame("0xoracle", "0xfc57d4df", [frame("0xwrap", LRD, [frame("0xproxy", LRD, [frame("0xagg", LRD)])])]);
    const r1 = countPriceSources(single);
    expect(r1.ok && r1.count).toBe(1);
    expect(r1.ok && r1.latestRoundDataCallees).toEqual(["0xwrap", "0xproxy", "0xagg"]);
    const composite = frame("0xoracle", "0xfc57d4df", [
      frame("0xcomp", LRD, [frame("0xethusd", LRD, [frame("0xa1", LRD)]), frame("0xethusd", "0x313ce567"), frame("0xratio", LRD, [frame("0xa2", LRD)])]),
    ]);
    const r2 = countPriceSources(composite);
    expect(r2.ok && r2.count).toBe(2);
  });
  it("an unexpected shape is not measured, with the raw shape kept", () => {
    const r = countPriceSources({ structLogs: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.rawShape).toEqual({ structLogs: [] });
    expect(countPriceSources(frame("0xo", "0x00")).ok).toBe(false); // no latestRoundData at all
    expect(countPriceSources({ to: "0xo", input: "0x", calls: "nope" }).ok).toBe(false);
  });
});

function fakeRecord(controlPassed: boolean): Level2Record {
  const read = (symbol: string, price: string, feed: string) => ({ ok: true as const, read: { mToken: "0x1", underlying: "0x2", symbol, tokenDecimals: 18, feedAddress: feed, feedDecimals: 8, feedDescription: null, rawUnderlyingPrice: price, priceUsd1e18: price } });
  const action = (symbol: string) => ({ symbol, wrapper: "0xw", token: "0xt", mToken: "0xm", wrapperName: "W", config: { oracleName: "A", tokenKey: symbol, mTokenKey: "C", line: 1 } });
  const ref = { ok: true as const, value: "2206000000000000000000", method: "m", inputs: {} as never };
  return {
    forkBlock: 42194662,
    preExecution: { cbEthFeed: "0xB0Ba", cbEthPriceUsd1e18: "2206000000000000000000" },
    control: { forkBlock: 42194662, chainId: 8453, blockNumberOnFork: 42194662, stablecoins: [], passed: controlPassed, reasons: controlPassed ? [] : ["WETH control did not match"] },
    actions: [action("cbETH"), action("DAI")] as never,
    pre: { cbETH: read("cbETH", "2206000000000000000000", "0xold"), DAI: read("DAI", "1000000000000000000", "0xold2") } as never,
    applied: [],
    forkEventsVsDerived: { equal: true, onlyDerived: [], onlyReal: [], duplicatesDerived: [], duplicatesReal: [] },
    blockAfterApply: 42194664,
    post: { cbETH: read("cbETH", "1122000000000000000", "0xnew"), DAI: read("DAI", "1030000000000000000", "0xnew2") } as never,
    postStablecoins: [],
    referencePre: ref,
    referencePost: ref,
    trace: { pre: { ok: false, reason: "x", rawShape: null }, post: { ok: true, sources: ["0xagg"], count: 1, latestRoundDataCallees: ["0xagg"], method: "m" } },
  };
}

describe("pass rule evaluation (offline)", () => {
  it("flags cbETH, and a market 3% off its pre-apply price fails the false-alarm line (not hidden)", () => {
    const rec = fakeRecord(true);
    const table = falseAlarmTable(rec);
    expect(table.find((r) => r.market === "cbETH")!.flagged).toBe(true);
    expect(table.find((r) => r.market === "DAI")!.flagged).toBe(false); // 3% is not a >50% flag…
    const lines = evaluatePassRule(rec, table);
    expect(lines.find((l) => l.rule.includes("DAI"))!.outcome).toBe("didn't match"); // …but it breaks the 2% rule
    expect(lines.find((l) => l.rule.startsWith("1. Flag rule"))!.outcome).toBe("matched");
  });
  it("a failed control turns every rule line into can't check", () => {
    const lines = evaluatePassRule(fakeRecord(false));
    for (const l of lines.filter((x) => /^[123]\./.test(x.rule) || x.rule.startsWith("Single-feed"))) expect(l.outcome).toBe("can't check");
  });
});

describe.skipIf(!HAS_RPC || !HAS_ANVIL)("Level 2 on real Base forks (needs BASE_RPC_URL)", () => {
  it("at 42194662: control passes, 14 actions applied, cbETH flagged vs reference, 13 others within 2%, 1 price source, 2200 bet not matched", async () => {
    const r = await level2Evidence();
    if (!r.ok) throw new Error(r.error);
    expect(r.run.controlPassed).toBe(true);
    expect(r.rec.applied).toHaveLength(14);
    expect(r.rec.applied.every((a) => a.status === "success")).toBe(true);
    expect(r.derivedVsReal.equal).toBe(true);
    expect(r.rec.forkEventsVsDerived.equal).toBe(true);
    const cb = r.table.find((x) => x.market === "cbETH")!;
    expect(cb.flagged).toBe(true);
    expect(BigInt(cb.postUsd1e18!)).toBeLessThan(2n * 10n ** 18n);
    for (const row of r.table.filter((x) => x.market !== "cbETH")) {
      expect(row.flagged, row.market).toBe(false);
      expect(differsByMoreThan(BigInt(row.postUsd1e18!), BigInt(row.preUsd1e18!), 2n), row.market).toBe(false);
    }
    expect(r.rec.trace.post.ok && r.rec.trace.post.count).toBe(1);
    expect(r.rec.trace.pre.ok && r.rec.trace.pre.count).toBe(2);
    expect(r.verdict.outcome).toBe("not_matched");
    expect(r.passRule.filter((l) => !l.rule.startsWith("3.")).every((l) => l.outcome === "matched")).toBe(true);
  }, 300_000);

  it("evmRunner().run takes the same path: post-apply cbETH in priceUsd1e18:cbETH, pre-apply kept separately", async () => {
    const run = await evmRunner().run(level2Experiment(), { forkBlock: 42194662 });
    expect(run.controlPassed).toBe(true);
    expect(run.forkBlock).toBe(42194662);
    expect(BigInt(run.result.measured["priceUsd1e18:cbETH"] as string)).toBeLessThan(2n * 10n ** 18n);
    expect(BigInt(run.result.measured["preApplyPriceUsd1e18:cbETH"] as string)).toBeGreaterThan(10n ** 21n);
    expect(run.result.measured.appliedFeedActions).toBe(14);
    expect(run.result.measured["priceSources:cbETH"]).toBe(1);
    expect(run.result.references?.["refUsd1e18:cbETH"]).toBeDefined();
  }, 300_000);

  it("at 42194663 (after the proposal ran) it stops before applying anything: fork is not pre-execution", async () => {
    await expect(withAnvilFork({ forkBlock: 42194663 }, (fork) => runLevel2OnFork(localClient(fork.url), fork, 42194663))).rejects.toThrow(/fork is not pre-execution/);
  }, 180_000);
});
