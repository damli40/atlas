// B1 (D35) bench M: the prompt plan, the cost estimate and the scoring, with a FAKE model and a FAKE run.
// Nothing here calls a model or spends money.

import { describe, expect, it } from "vitest";
import { buildPlan, estimateCost, latestCommittedDryRun, runLive, scoreBet, tally, rates, BUDGET_CAP_USD, WONDER_MODEL, type LiveDeps, type PlannedPrompt } from "../../bench/models/run.ts";
import { describeCall } from "../../src/gate.ts";
import { SPARK_MODEL, SPARK_OPEN_MODEL } from "../../src/claimants.ts";
import { validateBetOnlyOutput } from "../../server/meta/roles/claimant-bets.ts";
import { validatePastedBets } from "../../bench/models/validate.ts";
import { repairMessage } from "../../server/meta/roles/claimant.ts";
import { sealBet } from "../../src/seal.ts";
import type { Experiment, Run } from "../../src/types.ts";

const { plan, refused } = buildPlan();

function fakeRun(exp: Experiment, measured: Run["result"]["measured"], notMeasured: Run["result"]["notMeasured"] = {}, controlPassed = true): Run {
  return { id: `run-${exp.id}`, experimentId: exp.id, runner: "ts", executor: "local", codeSha256: exp.target.codeSha256, seed: "none", startedAt: "", finishedAt: "", trace: [], result: { measured, notMeasured }, controlPassed };
}

describe("bench M prompt plan (built by plain code, no model call)", () => {
  it("90 prompts, none refused by the gate, one per test", () => {
    expect(refused).toEqual([]);
    expect(plan.length).toBe(90);
    expect(new Set(plan.map((p) => p.testId)).size).toBe(90);
  });

  it("each prompt holds the whole pasted file, Atlas's call sentence and every plain-code question, and no USD instruction", () => {
    for (const p of plan) {
      const user = p.messages[1]!.content;
      expect(user).toContain(describeCall(p.experiment.params as Parameters<typeof describeCall>[0]));
      for (const q of p.questions) expect(user).toContain(`measures "${q.measures}"`);
      const src = p.experiment.target.source!;
      for (const line of src.split("\n").filter((l) => l.trim())) expect(user).toContain(line);
      expect(user).not.toMatch(/USD/);
      expect(p.messages[0]!.role).toBe("system");
    }
  });

  it("asks about outcome, returnedJson, virtualMs and every stand-in's calls", () => {
    for (const p of plan) {
      const m = p.questions.map((q) => q.measures);
      expect(m.slice(0, 3)).toEqual(["outcome", "returnedJson", "virtualMs"]);
    }
    expect(plan.some((p) => p.questions.some((q) => q.measures.startsWith("calls:")))).toBe(true);
  });

  it("the cost estimate is in the planned range and states its assumptions", () => {
    const two = estimateCost(plan, [SPARK_MODEL, SPARK_OPEN_MODEL]);
    const three = estimateCost(plan, [SPARK_MODEL, SPARK_OPEN_MODEL, WONDER_MODEL]);
    expect(two.totalCentralUsd).toBeGreaterThan(1);
    expect(two.totalCentralUsd).toBeLessThan(BUDGET_CAP_USD);
    expect(three.totalCentralUsd).toBeGreaterThan(two.totalCentralUsd);
    expect(three.assumptions.completionCentral).toBe(1500);
    // B1 review minor 9: the 32,000-token retry is in the estimate.
    expect(three.assumptions.overflowExtraCompletion).toBe(10500);
    const noOverflow = { ...three.assumptions };
    expect(noOverflow.overflowShareCentral).toBeGreaterThan(0);
  });
});

it("the bench's bet token caps are the product's (G1): 4,000, retry 8,000", async () => {
  const { BET_MAX_TOKENS, BET_RETRY_MAX_TOKENS } = await import("../../server/meta/roles/claimant-bets.ts");
  const { ESTIMATE } = await import("../../bench/models/run.ts");
  expect([ESTIMATE.betMaxTokens, ESTIMATE.betRetryMaxTokens]).toEqual([BET_MAX_TOKENS, BET_RETRY_MAX_TOKENS]);
});

describe("bench M prompt freeze reads the COMMITTED dry run", () => {
  it("finds the newest dry run added in git history and reads it from HEAD", () => {
    const d = latestCommittedDryRun();
    expect(d?.file).toMatch(/^bench\/models\/dry-run\/.+\.json$/);
    expect(Object.keys(d!.prompts).length).toBe(90);
    // The current plan (B1 builder: E3 is not on this branch) matches it, prompt for prompt.
    for (const p of plan) expect(d!.prompts[p.testId], p.testId).toBe(p.promptSha256);
  });
});

describe("bench M scoring (fake run)", () => {
  const p = plan.find((x) => x.testId === "m03b")!;
  const run = fakeRun(p.experiment, { outcome: "threw", thrownName: "BudgetExceeded", virtualMs: 650, "calls:call": 4 }, { returnedJson: "the call threw, so it returned nothing" });
  const bet = (measures: string, answer: Parameters<typeof sealBet>[0]["answer"]) => sealBet({ experimentId: p.experiment.id, who: "model:x", question: "q", measures, answer });

  it("matched, didn't match, declined, not checkable, invalid", () => {
    expect(scoreBet(bet("outcome", { kind: "enum", value: "threw", options: ["returned", "threw", "never_settled", "still_running_at_watch_limit"] }), "outcome", run).score).toBe("matched");
    expect(scoreBet(bet("virtualMs", { kind: "number", value: 500, tolerancePct: 10, unit: "ms" }), "virtualMs", run).score).toBe("didn't match");
    expect(scoreBet(bet("virtualMs", { kind: "number", value: 600, tolerancePct: 10, unit: "ms" }), "virtualMs", run).score).toBe("matched");
    expect(scoreBet(bet("calls:call", { kind: "declined", reason: "unknown: x" }), "calls:call", run).score).toBe("declined");
    expect(scoreBet(bet("returnedJson", { kind: "json", value: "x" }), "returnedJson", run)).toMatchObject({ score: "not checkable", reason: "the call threw, so it returned nothing" });
    expect(scoreBet(undefined, "outcome", run).score).toBe("invalid");
    expect(scoreBet(bet("outcome", { kind: "declined", reason: "unknown" }), "outcome", fakeRun(p.experiment, {}, { wholeRun: "needs X" })).score).toBe("not checkable");
    expect(scoreBet(bet("outcome", { kind: "declined", reason: "unknown" }), "outcome", fakeRun(p.experiment, { outcome: "threw" }, {}, false)).score).toBe("not checkable");
  });

  it("the two rates sit side by side; not-checkable questions are outside n", () => {
    const t = tally([
      { model: "a", type: "outcome", score: "matched" },
      { model: "a", type: "outcome", score: "didn't match" },
      { model: "a", type: "outcome", score: "declined" },
      { model: "a", type: "outcome", score: "not checkable" },
    ]);
    expect(t.a!.outcome!.n).toBe(3);
    expect(rates(t.a!.outcome!)).toEqual({ matchAmongAnswers: 0.5, matchCountingDeclinesAndInvalidsAsMisses: 1 / 3, declineRate: 1 / 3 });
  });
});

describe("bench M answer check", () => {
  const pp = plan.find((x) => x.testId === "m01a")!;
  const bets = (json: unknown) =>
    JSON.stringify({ bets: [
      { measures: "outcome", answer: { kind: "enum", value: "returned", options: pp.questions[0]!.options }, rationale: "r" },
      { measures: "returnedJson", answer: { kind: "json", value: json }, rationale: "r" },
      { measures: "virtualMs", answer: { kind: "number", value: 0, tolerancePct: 10, unit: "ms" }, rationale: "r" },
    ] });

  it("E3 fixed the B1 finding: the product's bet-only check now accepts a json bet on returnedJson", () => {
    expect(validateBetOnlyOutput(bets({ A: 2 }), pp.questions).ok).toBe(true);
  });

  it("the bench's check accepts a json bet and keeps every other rule", () => {
    expect(validatePastedBets(bets({ A: 2 }), pp.questions).ok).toBe(true);
    expect(validatePastedBets(bets(null), pp.questions).ok).toBe(true);
    const deep = JSON.parse(JSON.stringify(Array.from({ length: 120 }).reduce<unknown>((v) => [v], 1)));
    expect(validatePastedBets(bets(deep), pp.questions).ok).toBe(false);
    expect(validatePastedBets(bets("x".repeat(3000)), pp.questions).ok).toBe(false);
    const wrongKind = JSON.parse(bets(1));
    wrongKind.bets[2].answer = { kind: "integer", value: 0 };
    expect(validatePastedBets(JSON.stringify(wrongKind), pp.questions).ok).toBe(false);
    const missing = JSON.parse(bets(1));
    missing.bets.pop();
    expect(validatePastedBets(JSON.stringify(missing), pp.questions).ok).toBe(false);
  });
});

describe("bench M live loop with a fake model (no network, no cost)", () => {
  const two = plan.slice(0, 2);
  const answerFor = (pp: PlannedPrompt) =>
    JSON.stringify({ bets: pp.questions.map((q) => ({ measures: q.measures, answer: q.kind === "enum" ? { kind: "enum", value: "returned", options: q.options } : q.kind === "json" ? { kind: "json", value: { A: 1, B: 0, C: 3 } } : q.kind === "number" ? { kind: "number", value: 0, tolerancePct: 10, unit: "ms" } : { kind: "integer", value: 0 }, rationale: "r" })) });

  function deps(over: Partial<LiveDeps> = {}, calls: string[] = []): LiveDeps {
    return {
      chat: async (args) => {
        calls.push(args.model);
        const pp = two.find((x) => args.messages[1]!.content === x.messages[1]!.content)!;
        return { ok: true, content: answerFor(pp), finishReason: "stop", usage: { usd: 0.01, promptTokens: 1000, completionTokens: 500 } };
      },
      validate: validatePastedBets as unknown as LiveDeps["validate"],
      repairMessage,
      run: async (exp) => fakeRun(exp, { outcome: "returned", returnedJson: '{"A":1,"B":0,"C":3}', virtualMs: 0 }),
      ...over,
    };
  }

  it("each model's bets are sealed and scored against the one run", async () => {
    const res = await runLive(two, [SPARK_MODEL, SPARK_OPEN_MODEL], deps());
    expect(res.tests.length).toBe(2);
    const scores = res.rows.filter((r) => r.type === "returnedJson");
    expect(scores.every((r) => r.score === "matched")).toBe(true);
    expect(res.spentUsd).toBeCloseTo(0.04, 5);
  });

  it("an invalid answer gets one repair try, then every question of that test is invalid", async () => {
    const calls: string[] = [];
    const res = await runLive(two.slice(0, 1), [SPARK_MODEL], deps({ chat: async (a) => (calls.push(a.model), { ok: true, content: "not json", finishReason: "stop", usage: { usd: 0.01, promptTokens: 1, completionTokens: 1 } }) }));
    expect(calls.length).toBe(2);
    expect(res.rows.every((r) => r.score === "invalid" || r.score === "not checkable")).toBe(true);
  });

  it("stops before the next model call once the cap is reached", async () => {
    const calls: string[] = [];
    const res = await runLive(two, [SPARK_MODEL, SPARK_OPEN_MODEL], deps({ chat: async (a) => (calls.push(a.model), { ok: true, content: answerFor(two.find((x) => a.messages[1]!.content === x.messages[1]!.content)!), finishReason: "stop", usage: { usd: BUDGET_CAP_USD, promptTokens: 1, completionTokens: 1 } }) }, calls));
    expect(calls.length).toBe(1);
    expect(res.stoppedBecause).toMatch(/cap/);
    expect(res.tests.length).toBe(1);
  });
});
