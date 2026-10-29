// R2 (D46): timing bets near zero.
//
// Plain words: a timing bet (a number in ms) used to match only within 10% of what the run measured. Near 0 ms that
// is almost nothing: a bet of 1 ms on a run that took 0 ms "didn't match". From D46 a timing bet matches when it is
// within 10% OR within 1 ms. Every new verdict on a timing bet says which rule judged it (`timingRule: "d46"`); a
// verdict without it was judged before D46, and `verify` re-judges it with that older rule, so old proof files keep
// their verdicts. Whole-number ms bets follow D46 too since review round 1; Moonwell's USD price bets do not change.

import { beforeAll, describe, expect, it } from "vitest";
import { TIMING_RULE, judge, matchRuleWords, toleranceShort } from "../../src/judge.ts";
import { answerHow } from "../../src/paste-context.ts";
import { towardFromBets } from "../../src/change.ts";
import { gate, questionsFor } from "../../src/gate.ts";
import { sealBet } from "../../src/seal.ts";
import { buildAtlasFile, verifyAtlasFile } from "../../src/atlasfile.ts";
import { exportedFunctionsFor, makePastedTarget } from "../../src/pasted-code.ts";
import { runCallControl, runCallExperiment } from "../../runners/ts/call-runner.ts";
import type { Bet, BetAnswer, Experiment, ExperimentShape, Run, RunResult } from "../../src/types.ts";

function bet(measures: string, answer: BetAnswer): Bet {
  return { id: "bet1", experimentId: "exp1", who: "human", question: "q", measures, answer, nonce: "00".repeat(16), sealedAt: "2026-10-27T00:00:00.000Z", sealedHash: "0".repeat(64) };
}
function run(measured: RunResult["measured"]): Run {
  return { id: "run1", experimentId: "exp1", runner: "ts", executor: "local", codeSha256: "x", startedAt: "2026-10-27T00:00:00.000Z", finishedAt: "2026-10-27T00:00:01.000Z", trace: [], result: { measured, notMeasured: {} }, controlPassed: true };
}
const ms = (value: number, tolerancePct = 10): BetAnswer => ({ kind: "number", value, tolerancePct, unit: "ms" });
const usd = (value: number, tolerancePct = 10): BetAnswer => ({ kind: "number", value, tolerancePct, unit: "USD" });

describe("D46: |bet - measured| <= max(10% of measured, 1 ms)", () => {
  const cases: [number, number, "matched" | "not_matched", "matched" | "not_matched"][] = [
    // bet, measured, under D46, under the rule before D46
    [0, 0, "matched", "matched"],
    [1, 0, "matched", "not_matched"],
    [0.5, 0, "matched", "not_matched"],
    [1.0001, 0, "not_matched", "not_matched"],
    [6, 5, "matched", "not_matched"],
    [4, 5, "matched", "not_matched"],
    [7, 5, "not_matched", "not_matched"],
    [11, 10, "matched", "matched"], // 10% of 10 = 1: both rules
    [12, 10, "not_matched", "not_matched"],
    [1100, 1000, "matched", "matched"], // far from zero, 10% decides
    [1101, 1000, "not_matched", "not_matched"],
    [400.9, 400, "matched", "matched"],
    [354, 354.5, "matched", "matched"],
    [3.4, 2.5, "matched", "not_matched"], // a fractional measured value (Python virtualMs can be one)
  ];
  for (const [b, m, now, before] of cases) {
    it(`bet ${b} ms vs measured ${m} ms: ${now} (before D46: ${before})`, () => {
      const v = judge(bet("virtualMs", ms(b)), run({ virtualMs: m }));
      expect(v.outcome).toBe(now);
      expect(v.timingRule).toBe(TIMING_RULE);
      const old = judge(bet("virtualMs", ms(b)), run({ virtualMs: m }), { timingRule: null });
      expect(old.outcome).toBe(before);
      expect("timingRule" in old).toBe(false);
    });
  }
  it("a measured value stored as text is read exactly too", () => {
    expect(judge(bet("virtualMs", ms(1)), run({ virtualMs: "0" })).outcome).toBe("matched");
  });
  it("a can't-check timing verdict records no rule (no rule judged it)", () => {
    const v = judge(bet("virtualMs", ms(1)), { ...run({}), result: { measured: {}, notMeasured: { virtualMs: "because" } } });
    expect(v.outcome).toBe("cant_check");
    expect("timingRule" in v).toBe(false);
  });
});

describe("D46 changes nothing else", () => {
  it("whole-number ms bets follow D46 too (review round 1, m2; see r2-review1.test.ts); whole-number counts stay exact", () => {
    expect(judge(bet("totalWaitMs", { kind: "integer", value: 12001 }), run({ totalWaitMs: 12000 })).outcome).toBe("matched");
    expect(judge(bet("settledAtMs", { kind: "integer", value: 1 }), run({ settledAtMs: 0 })).outcome).toBe("matched");
    expect(judge(bet("calls", { kind: "integer", value: 4 }), run({ calls: 5 })).outcome).toBe("not_matched");
  });
  it("Moonwell's USD price bets: unchanged, no rule recorded", () => {
    const E18 = 10n ** 18n;
    const field = "priceUsd1e18:cbETH";
    const observed = (112n * E18 / 100n).toString(); // $1.12
    for (const [value, want] of [[1.12, "matched"], [1.2, "matched"], [1.0, "not_matched"], [0.12, "not_matched"]] as const) {
      const v = judge(bet(field, usd(value)), run({ [field]: observed }));
      expect(v.outcome, String(value)).toBe(want);
      expect(v).toEqual(judge(bet(field, usd(value)), run({ [field]: observed }), { timingRule: null }));
      expect("timingRule" in v).toBe(false);
    }
  });
  it("number, json, enum and integer verdicts carry no rule", () => {
    expect("timingRule" in judge(bet("returnedJson", { kind: "json", value: 1 }), run({ returnedJson: "1" }))).toBe(false);
  });
});

describe("bettors see the rule (D19: the screen and every model read the same words)", () => {
  it("the virtualMs question says 'within 10% or 1 ms'", () => {
    const q = questionsFor({ shape: "call-function", exportName: "f", args: [] }).find((x) => x.measures === "virtualMs")!;
    expect(answerHow(q)).toBe("a number in ms, matched within 10% or 1 ms of what the run measures");
  });
  it("USD keeps 'within 10%'", () => {
    expect(matchRuleWords("USD", 10)).toBe("within 10%");
    expect(matchRuleWords("ms", 10)).toBe("within 10% or 1 ms");
    expect(matchRuleWords("ms", 10, null)).toBe("within 10%");
    expect(toleranceShort("ms", 10)).toBe("±10% or 1 ms");
    expect(toleranceShort("USD", 10)).toBe("±10%");
  });
  it("a change's 'toward' text follows the rule its verdict recorded (older files keep their words)", () => {
    const b = bet("virtualMs", ms(50));
    const vNew = judge(b, run({ virtualMs: 0 }));
    const vOld = judge(b, run({ virtualMs: 0 }), { timingRule: null });
    expect(towardFromBets([b], [vNew])).toContain("(match if within 10% or 1 ms of what the run measures)");
    expect(towardFromBets([b], [vOld])).toContain("(match if within 10% of what the run measures)");
  });
});

