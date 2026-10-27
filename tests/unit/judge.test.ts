import { describe, expect, it } from "vitest";
import { judge } from "../../src/judge";
import type { Bet, BetAnswer, Run, RunResult } from "../../src/types";

const E18 = 10n ** 18n;

function bet(measures: string, answer: BetAnswer, over: Partial<Bet> = {}): Bet {
  return {
    id: "bet1",
    experimentId: "exp1",
    who: "human",
    question: "q",
    measures,
    answer,
    nonce: "00".repeat(16),
    sealedAt: "2026-10-27T00:00:00.000Z",
    sealedHash: "0".repeat(64),
    ...over,
  };
}

function run(result: Partial<RunResult>, over: Partial<Run> = {}): Run {
  return {
    id: "run1",
    experimentId: "exp1",
    runner: "ts",
    executor: "local",
    codeSha256: "x",
    startedAt: "2026-10-27T00:00:00.000Z",
    finishedAt: "2026-10-27T00:00:01.000Z",
    trace: [],
    result: { measured: {}, notMeasured: {}, ...result },
    controlPassed: true,
    ...over,
  };
}

const usd = (value: number, tolerancePct = 10): BetAnswer => ({ kind: "number", value, tolerancePct, unit: "USD" });

describe("judge: can't check branches", () => {
  it("control failed → cant_check, even when the value matches", () => {
    const v = judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: { calls: 5 } }, { controlPassed: false }));
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("control run did not match the known case");
    expect(v.observed).toBeUndefined();
  });

  it("bet declined → cant_check", () => {
    const v = judge(bet("calls", { kind: "declined", reason: "no idea" }), run({ measured: { calls: 5 } }));
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("the bettor declined");
  });

  it("field listed in notMeasured → cant_check with the runner's reason", () => {
    const v = judge(
      bet("totalWaitMs", { kind: "integer", value: 1 }),
      run({ notMeasured: { totalWaitMs: "the call never settled inside the time box" } }),
    );
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("the call never settled inside the time box");
  });

  it("field absent → cant_check naming the field", () => {
    const v = judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: {} }));
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("runner did not measure calls");
  });

  it("inherited object keys like 'constructor' count as absent, not measured", () => {
    const v = judge(bet("constructor", { kind: "enum", value: "x", options: ["x"] }), run({}));
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("runner did not measure constructor");
  });

  it("bet on a different experiment → cant_check", () => {
    const v = judge(bet("calls", { kind: "integer", value: 5 }, { experimentId: "other" }), run({ measured: { calls: 5 } }));
    expect(v.outcome).toBe("cant_check");
  });

  it("number bet on a priceUsd1e18 field with a unit other than USD → cant_check", () => {
    const v = judge(
      bet("priceUsd1e18:cbETH", { kind: "number", value: 1.12, tolerancePct: 10, unit: "ETH" }),
      run({ measured: { "priceUsd1e18:cbETH": (112n * E18 / 100n).toString() } }),
    );
    expect(v.outcome).toBe("cant_check");
    expect(v.reason).toBe("bet unit is not USD");
  });

  it("observed stored in a type the bet cannot be compared with → cant_check", () => {
    expect(judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: { calls: "five" } })).outcome).toBe("cant_check");
    expect(judge(bet("outcome", { kind: "enum", value: "throw", options: ["throw"] }), run({ measured: { outcome: null } })).outcome).toBe("cant_check");
    expect(judge(bet("priceUsd1e18:cbETH", usd(2200)), run({ measured: { "priceUsd1e18:cbETH": 2205 } })).outcome).toBe("cant_check");
  });

  it("order: control check wins over declined and notMeasured", () => {
    const v = judge(
      bet("calls", { kind: "declined", reason: "x" }),
      run({ notMeasured: { calls: "n/a" } }, { controlPassed: false }),
    );
    expect(v.reason).toBe("control run did not match the known case");
  });
});

describe("judge: exact matches", () => {
  it("integer: exact", () => {
    expect(judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: { calls: 5 } })).outcome).toBe("matched");
    expect(judge(bet("calls", { kind: "integer", value: 4 }), run({ measured: { calls: 5 } })).outcome).toBe("not_matched");
    expect(judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: { calls: "5" } })).outcome).toBe("matched");
  });

  it("enum: exact, case-sensitive", () => {
    const opts = ["return", "throw", "pending"];
    expect(judge(bet("outcome", { kind: "enum", value: "throw", options: opts }), run({ measured: { outcome: "throw" } })).outcome).toBe("matched");
    expect(judge(bet("outcome", { kind: "enum", value: "Throw", options: opts }), run({ measured: { outcome: "throw" } })).outcome).toBe("not_matched");
  });

  it("verdict carries observed and judgedBy", () => {
    const v = judge(bet("calls", { kind: "integer", value: 5 }), run({ measured: { calls: 5 } }));
    expect(v).toEqual({ betId: "bet1", runId: "run1", outcome: "matched", observed: 5, judgedBy: "src/judge.ts" });
  });
});

describe("judge: plain numbers, tolerance relative to the observed value", () => {
  const n = (value: number, tolerancePct: number): BetAnswer => ({ kind: "number", value, tolerancePct, unit: "ms" });
  it("matches inside the band and not outside", () => {
    expect(judge(bet("totalWaitMs", n(11000, 10)), run({ measured: { totalWaitMs: 12000 } })).outcome).toBe("matched");
    expect(judge(bet("totalWaitMs", n(10700, 10)), run({ measured: { totalWaitMs: 12000 } })).outcome).toBe("not_matched");
    // exactly on the edge: |12000 − 10800| × 100 = 120000 = 10 × 12000
    expect(judge(bet("totalWaitMs", n(10800, 10)), run({ measured: { totalWaitMs: 12000 } })).outcome).toBe("matched");
  });
  it("zero tolerance means exact", () => {
    expect(judge(bet("totalWaitMs", n(12000, 0)), run({ measured: { totalWaitMs: 12000 } })).outcome).toBe("matched");
    expect(judge(bet("totalWaitMs", n(12001, 0)), run({ measured: { totalWaitMs: 12000 } })).outcome).toBe("not_matched");
  });
  it("no float drift: 0.1 + 0.2 vs 0.3 at 0% is not_matched, at a tiny tolerance matched", () => {
    expect(judge(bet("x", n(0.1 + 0.2, 0)), run({ measured: { x: 0.3 } })).outcome).toBe("not_matched");
    expect(judge(bet("x", n(0.1 + 0.2, 0.000001)), run({ measured: { x: 0.3 } })).outcome).toBe("matched");
  });
  it("negative tolerance → cant_check", () => {
    expect(judge(bet("x", n(1, -5)), run({ measured: { x: 1 } })).outcome).toBe("cant_check");
  });
});

describe("judge: USD 1e18 prices in bigint", () => {
  const cb = "priceUsd1e18:cbETH";
  const observed112 = (112n * E18 / 100n).toString(); // $1.12
  const observed2205 = (2205n * E18).toString(); // $2,205

  it("bet 2200 USD vs observed $1.12 at 10% → not_matched", () => {
    expect(judge(bet(cb, usd(2200)), run({ measured: { [cb]: observed112 } })).outcome).toBe("not_matched");
  });

  it("bet 2250 USD vs observed $2,205 at 10% → matched", () => {
    expect(judge(bet(cb, usd(2250)), run({ measured: { [cb]: observed2205 } })).outcome).toBe("matched");
  });

  it("bet 1.0 USD vs observed $1.12 at 10% → not_matched (tolerance is a share of the observed value)", () => {
    // |1.12 − 1.0| = 0.12 > 10% of 1.12 = 0.112. Relative to the bet it would be 0.12 > 0.10 too,
    // so also pin the case where the two rules disagree: bet 1.24 vs observed 1.12.
    expect(judge(bet(cb, usd(1.0)), run({ measured: { [cb]: observed112 } })).outcome).toBe("not_matched");
    // |1.12 − 1.24| = 0.12 ≤ 10% of the BET (0.124) but > 10% of the OBSERVED (0.112) → not_matched.
    expect(judge(bet(cb, usd(1.24)), run({ measured: { [cb]: observed112 } })).outcome).toBe("not_matched");
  });

  it("$1.12 observed is not_matched against 2200 at any tolerance under 100%", () => {
    expect(judge(bet(cb, usd(2200, 99.99)), run({ measured: { [cb]: observed112 } })).outcome).toBe("not_matched");
  });

  it("uses exact decimal conversion of the bet (2205.05 at 0% matches 2205.05e18 exactly)", () => {
    expect(judge(bet(cb, usd(2205.05, 0)), run({ measured: { [cb]: "2205050000000000000000" } })).outcome).toBe("matched");
  });

  it("attaches the same-block reference when present", () => {
    const ref = { value: observed2205, method: "Chainlink ETH/USD × cbETH/ETH at block N" };
    const v = judge(bet(cb, usd(2250)), run({ measured: { [cb]: observed2205 }, references: { "refUsd1e18:cbETH": ref } }));
    expect(v.reference).toEqual(ref);
    expect(v.observed).toBe(observed2205);
  });
});

describe("judge is pure", () => {
  it("does not mutate its inputs and returns the same verdict twice", () => {
    const b = bet("calls", { kind: "integer", value: 5 });
    const r = run({ measured: { calls: 5 } });
    const before = JSON.stringify([b, r]);
    expect(judge(b, r)).toEqual(judge(b, r));
    expect(JSON.stringify([b, r])).toBe(before);
  });
});
