// D04-00 / D04-01: deriving MIP-X43's oracle-feed actions from the PR's own files.
// Offline tests run everywhere; the fork tests need BASE_RPC_URL and anvil, and skip without them.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { comparePairs, loadAddressBook, parseBaseOracleConfigs, planFeedActions, stripSolidityComments } from "../../runners/evm/apply.ts";
import { TOUCHED_MARKETS } from "../../runners/evm/moonwell-base.ts";
import { level2Precheck, plannedFromPr, prFiles } from "../tools/level2-precheck.ts";
import { derivedVsReal, realFeedSetPairs } from "../tools/level2-derive.ts";

const HAS_RPC = Boolean(process.env.BASE_RPC_URL);
const HAS_ANVIL = spawnSync("anvil", ["--version"]).status === 0;

describe("ChainlinkOracleConfigs.sol parser (offline)", () => {
  it("finds the 14 uncommented Base pushes in the PR file, with their lines, and skips the 6 commented ones", () => {
    const configs = parseBaseOracleConfigs(prFiles().configs);
    expect(configs).toHaveLength(14);
    expect(configs.map((c) => c.tokenKey)).toEqual([
      "DAI", "USDC", "USDBC", "cbETH", "AERO", "cbBTC", "EURC", "xWELL_PROXY", "USDS", "TBTC", "VIRTUAL", "MORPHO", "cbXRP", "MAMO",
    ]);
    const cb = configs.find((c) => c.tokenKey === "cbETH")!;
    expect(cb).toEqual({ oracleName: "cbETHETH_ORACLE", tokenKey: "cbETH", mTokenKey: "MOONWELL_cbETH", line: 41 });
    // None of the commented-out configs (WETH, wstETH, rETH, weETH, wrsETH, LBTC) leaks in.
    for (const k of ["WETH", "wstETH", "rETH", "weETH", "wrsETH", "LBTC"]) expect(configs.some((c) => c.tokenKey === k)).toBe(false);
  });

  it("handles a push split over lines, // and /* */ comments, and a // inside a string", () => {
    const sol = [
      "_oracleConfigs[BASE_CHAIN_ID].push(",
      '    OracleConfig("A_ORACLE", "TOK", "MOONWELL_TOK")',
      ");",
      "// _oracleConfigs[BASE_CHAIN_ID].push(",
      '//     OracleConfig("X", "Y", "Z")',
      "// );",
      "/* _oracleConfigs[BASE_CHAIN_ID].push(",
      '   OracleConfig("P", "Q", "R")); */',
      '_oracleConfigs[OPTIMISM_CHAIN_ID].push(OracleConfig("O", "O", "O"));',
      '_oracleConfigs[BASE_CHAIN_ID].push(OracleConfig("B//1", "T2", "M2")); // trailing',
    ].join("\n");
    expect(parseBaseOracleConfigs(sol)).toEqual([
      { oracleName: "A_ORACLE", tokenKey: "TOK", mTokenKey: "MOONWELL_TOK", line: 1 },
      { oracleName: "B//1", tokenKey: "T2", mTokenKey: "M2", line: 10 },
    ]);
    expect(stripSolidityComments("a /* x\ny */ b").split("\n")).toHaveLength(2);
  });

  it("refuses a Base push it cannot read instead of dropping it", () => {
    expect(() => parseBaseOracleConfigs('_oracleConfigs[BASE_CHAIN_ID].push(\n  makeConfig("A")\n);')).toThrow(/line 1: .*refusing to guess/);
  });

  it("maps each config to its wrapper, token and market through the PR's chains/8453.json", () => {
    const planned = plannedFromPr();
    expect(planned).toHaveLength(14);
    const cb = planned.find((p) => p.config.tokenKey === "cbETH")!;
    expect(cb.wrapperName).toBe("cbETHETH_ORACLE_OEV_WRAPPER");
    expect(cb.wrapper).toBe("0x67996D1ff7a3711a91E2839d1059Fcb950C0495D");
    expect(cb.mToken).toBe("0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5");
    const usdc = planned.find((p) => p.config.tokenKey === "USDC")!;
    const usdbc = planned.find((p) => p.config.tokenKey === "USDBC")!;
    expect(usdc.wrapper).toBe(usdbc.wrapper); // USDC and USDbC share one wrapper
    expect(new Set(planned.map((p) => p.wrapper)).size).toBe(13);
  });

  it("a name missing from the address book throws, and a repeated name is refused", () => {
    const book = loadAddressBook(JSON.stringify([{ addr: "0x1", name: "TOK" }, { addr: "0x2", name: "MOONWELL_TOK" }]));
    expect(() => planFeedActions([{ oracleName: "A", tokenKey: "TOK", mTokenKey: "MOONWELL_TOK", line: 1 }], book)).toThrow(/no address named A_OEV_WRAPPER/);
    expect(() => loadAddressBook(JSON.stringify([{ addr: "0x1", name: "X" }, { addr: "0x2", name: "X" }]))).toThrow(/names X twice/);
  });

  it("pair comparison is a set comparison that reports both sides and repeats", () => {
    const a = { symbol: "A", wrapper: "0xAb" as const };
    const b = { symbol: "B", wrapper: "0x01" as const };
    expect(comparePairs([a, b], [b, { ...a, wrapper: "0xab" }]).equal).toBe(true);
    const r = comparePairs([a], [b]);
    expect(r.equal).toBe(false);
    expect(r.onlyDerived).toEqual([a]);
    expect(r.onlyReal).toEqual([b]);
    expect(comparePairs([a, a], [a]).duplicatesDerived).toEqual([a]);
  });

  it("the stored real FeedSet data holds 14 events whose symbols are TOUCHED_MARKETS", () => {
    const real = realFeedSetPairs();
    expect(real).toHaveLength(14);
    expect(real.map((p) => p.symbol)).toEqual([...TOUCHED_MARKETS]);
  });

  it("probe: using the config's token name as the setFeed key (instead of symbol() on-chain) would get 3 of 14 wrong", () => {
    const wrong = plannedFromPr().map((p) => ({ symbol: p.config.tokenKey, wrapper: p.wrapper }));
    const r = comparePairs(wrong, realFeedSetPairs());
    expect(r.equal).toBe(false);
    expect(r.onlyDerived.map((p) => p.symbol).sort()).toEqual(["TBTC", "USDBC", "xWELL_PROXY"]);
  });
});

describe.skipIf(!HAS_RPC || !HAS_ANVIL)("Level 2 pre-flight on a Base fork at 42194662 (needs BASE_RPC_URL)", () => {
  it("all 14 wrappers have code and the oracle admin is the TemporalGovernor", async () => {
    const r = await level2Precheck();
    expect(r.missingCode).toEqual([]);
    expect(r.wrapperCount).toBe(14);
    expect(r.adminIsTemporalGovernor).toBe(true);
    expect(r.passed).toBe(true);
  }, 180_000);

  it("the 14 derived (symbol, wrapper) pairs equal the 14 real FeedSet pairs as a set", async () => {
    const r = await derivedVsReal();
    expect(r.comparison.onlyDerived).toEqual([]);
    expect(r.comparison.onlyReal).toEqual([]);
    expect(r.derivedCount).toBe(14);
    expect(r.setEqual).toBe(true);
  }, 180_000);
});
