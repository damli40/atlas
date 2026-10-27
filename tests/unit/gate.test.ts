// D02-01: the experiment gate (src/gate.ts). Every shape inside bounds → allowed; anything
// unknown, extra or out of bounds → refused with a plain reason. Plus the rendered allow-list
// and the questions (one place for their text).

import { describe, expect, it } from "vitest";
import {
  ALL_SHAPES,
  BOUNDS,
  QUESTION_TEXT,
  gate,
  questionsFor,
  renderAllowList,
  renderQuestions,
  type GateContext,
} from "../../src/gate.ts";
import { QUESTIONS } from "../gate/six-cases.ts";
import { measuredUnit, OUTCOME_OPTIONS } from "../../src/units.ts";
import type { ExperimentShape } from "../../src/types.ts";

const EVM: GateContext = { touchedMarkets: ["cbETH", "WETH", "USDC"] };

const refused = (params: unknown, ctx: GateContext = EVM): string => {
  const d = gate(params, ctx);
  if (d.allowed) throw new Error(`expected a refusal for ${JSON.stringify(params)}`);
  return d.reason;
};

describe("gate: every shape inside its bounds is allowed", () => {
  const inside: ExperimentShape[] = [
    { shape: "retry-scenario", failTimes: 0, failure: "error" },
    { shape: "retry-scenario", failTimes: "always", failure: "never_settles" },
    { shape: "retry-scenario", failTimes: 10, failure: "error", attempts: 10, delayMs: 60_000, resolveAfterMs: 60_000, errorKind: "429", resolvesWith: { status: 429 } },
    { shape: "retry-scenario", failTimes: 1, failure: "error", attempts: 1, delayMs: 0, resolveAfterMs: 0, errorKind: "seeded", resolvesWith: null },
    { shape: "concurrency-sweep", callers: 1, failTimes: 0, failure: "error" },
    { shape: "concurrency-sweep", callers: 200, failTimes: "always", failure: "error", delayMs: 3000 },
    { shape: "price-read", markets: ["cbETH"] },
    { shape: "price-read", markets: ["cbETH", "WETH", "USDC"] },
    { shape: "apply-proposal-then-read", markets: "touched" },
    { shape: "apply-proposal-then-read", markets: ["WETH"] },
    { shape: "liquidatable-at-price", market: "cbETH", priceUsd1e18: "1120000000000000000" },
    { shape: "liquidatable-at-price", market: "USDC", priceUsd1e18: (1_000_000n * 10n ** 18n).toString() },
    // E1: call-function at its smallest and at its bounds
    { shape: "call-function", exportName: "f", args: [] },
    {
      shape: "call-function",
      exportName: "f",
      watchLimitMs: 600_000,
      args: [
        { kind: "json", value: { a: [1, "x", null, true] } },
        { kind: "stand-in", name: "g", async: true, then: "throw_exhausted", calls: [{ do: "return", value: 1, afterMs: 600_000 }, { do: "throw", errorName: "E", message: "" }, { do: "never_settle" }] },
      ],
    },
  ];
  it.each(inside.map((p) => [p.shape, p] as const))("%s %j", (_name, params) => {
    const d = gate(params, EVM);
    expect(d).toEqual({ allowed: true, params });
  });

  it("covers every shape in src/types.ts", () => {
    expect(new Set(inside.map((p) => p.shape))).toEqual(new Set(ALL_SHAPES));
  });

  it("returns a copy, so a later change to the input does not reach the runner", () => {
    const input = { shape: "retry-scenario", failTimes: 0, failure: "error", resolvesWith: { a: 1 } };
    const d = gate(input);
    expect(d.allowed).toBe(true);
    input.resolvesWith.a = 2;
    if (d.allowed) expect((d.params as unknown as { resolvesWith: { a: number } }).resolvesWith.a).toBe(1);
  });
});

describe("gate: refusals carry plain reasons (plan D02-01 acceptance)", () => {
  it("callers: 201", () => {
    expect(refused({ shape: "concurrency-sweep", callers: 201, failTimes: 0, failure: "error" })).toBe(
      "callers 201 is outside the allowed range (1 to 200)",
    );
  });
  it("unknown shape", () => {
    expect(refused({ shape: "fetch-url", url: "https://example.com" })).toMatch(/^unknown shape "fetch-url"; allowed shapes are retry-scenario, /);
  });
  it("attempts: 1000", () => {
    expect(refused({ shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 1000 })).toBe(
      "attempts 1000 is outside the allowed range (1 to 10)",
    );
  });
  it("markets not in the touched list", () => {
    expect(refused({ shape: "price-read", markets: ["cbETH", "DOGE"] })).toBe('market "DOGE" is not one this target touches (cbETH, WETH, USDC)');
    expect(refused({ shape: "apply-proposal-then-read", markets: ["DOGE"] })).toMatch(/market "DOGE" is not one this target touches/);
    expect(refused({ shape: "liquidatable-at-price", market: "DOGE", priceUsd1e18: "1" })).toMatch(/market "DOGE" is not one this target touches/);
  });
  it("markets when the target touches none", () => {
    expect(refused({ shape: "price-read", markets: ["cbETH"] }, {})).toBe("this target touches no markets, so no market can be read");
    expect(refused({ shape: "apply-proposal-then-read", markets: "touched" }, {})).toBe('markets "touched": this target touches no markets');
  });
});

describe("gate: more refusals", () => {
  const cases: [string, unknown, RegExp][] = [
    ["not an object", "retry-scenario", /must be an object/],
    ["null", null, /must be an object/],
    ["a list", [], /must be an object/],
    ["no shape", { failTimes: 0 }, /unknown shape undefined/],
    ["extra key", { shape: "retry-scenario", failTimes: 0, failure: "error", url: "http://x" }, /has no field "url"/],
    ["misspelt key", { shape: "retry-scenario", failtimes: 0, failure: "error" }, /has no field "failtimes"/],
    ["missing required", { shape: "retry-scenario", failure: "error" }, /needs failTimes/],
    ["failTimes 11", { shape: "retry-scenario", failTimes: 11, failure: "error" }, /failTimes 11 is outside the allowed range \(0 to 10, or "always"\)/],
    ["failTimes -1", { shape: "retry-scenario", failTimes: -1, failure: "error" }, /outside/],
    ["failTimes 1.5", { shape: "retry-scenario", failTimes: 1.5, failure: "error" }, /must be a whole number/],
    ["failTimes as text", { shape: "retry-scenario", failTimes: "3", failure: "error" }, /must be a whole number/],
    ["failTimes never", { shape: "retry-scenario", failTimes: "never", failure: "error" }, /must be a whole number/],
    ["attempts 0", { shape: "retry-scenario", failTimes: 0, failure: "error", attempts: 0 }, /attempts 0 is outside/],
    ["delayMs 60001", { shape: "retry-scenario", failTimes: 0, failure: "error", delayMs: 60_001 }, /delayMs 60001 is outside/],
    ["resolveAfterMs huge", { shape: "retry-scenario", failTimes: 0, failure: "error", resolveAfterMs: 1e9 }, /resolveAfterMs 1000000000 is outside/],
    ["failure timeout", { shape: "retry-scenario", failTimes: 0, failure: "timeout" }, /failure must be one of "error", "never_settles"/],
    ["errorKind 500", { shape: "retry-scenario", failTimes: 0, failure: "error", errorKind: "500" }, /errorKind must be one of/],
    ["resolvesWith too big", { shape: "retry-scenario", failTimes: 0, failure: "error", resolvesWith: "x".repeat(2000) }, /limit is 1000/],
    ["callers 0", { shape: "concurrency-sweep", callers: 0, failTimes: 0, failure: "error" }, /callers 0 is outside/],
    ["sweep never_settles", { shape: "concurrency-sweep", callers: 2, failTimes: 0, failure: "never_settles" }, /failure must be one of "error"/],
    ["empty markets", { shape: "price-read", markets: [] }, /non-empty list/],
    ["duplicate market", { shape: "price-read", markets: ["WETH", "WETH"] }, /listed twice/],
    ["price-read touched word", { shape: "price-read", markets: "touched" }, /non-empty list of market names$/],
    ["price zero", { shape: "liquidatable-at-price", market: "cbETH", priceUsd1e18: "0" }, /outside the allowed range/],
    ["price over $1M", { shape: "liquidatable-at-price", market: "cbETH", priceUsd1e18: (1_000_000n * 10n ** 18n + 1n).toString() }, /outside the allowed range/],
    ["price as number", { shape: "liquidatable-at-price", market: "cbETH", priceUsd1e18: 1.12 }, /whole-number string/],
    ["price with decimals", { shape: "liquidatable-at-price", market: "cbETH", priceUsd1e18: "1.12" }, /whole-number string/],
  ];
  it.each(cases)("%s", (_name, params, why) => {
    expect(refused(params)).toMatch(why);
  });

  it("a shape the target's runner cannot run is refused", () => {
    expect(refused({ shape: "price-read", markets: ["WETH"] }, { ...EVM, shapes: ["retry-scenario"] })).toBe(
      'shape "price-read" cannot run on this target; allowed here: retry-scenario',
    );
  });

  it("never throws on hostile input", () => {
    const weird = [undefined, 0, Symbol("x"), () => 1, { shape: { toString: () => "retry-scenario" } }, Object.create(null)];
    for (const w of weird) expect(gate(w).allowed).toBe(false);
  });
});

describe("questions: one place, plain code", () => {
  it("the day-1 gate reads the same text (not a copy)", () => {
    expect(QUESTIONS).toBe(QUESTION_TEXT);
  });

  it("retry-scenario asks calls (integer), totalWaitMs (integer), outcome (enum of the runner's words)", () => {
    const qs = questionsFor({ shape: "retry-scenario", failTimes: 0, failure: "error" });
    expect(qs.map((q) => [q.measures, q.kind, q.unit])).toEqual([
      ["calls", "integer", "count"],
      ["totalWaitMs", "integer", "ms"],
      ["outcome", "enum", "enum"],
    ]);
    expect(qs[2]!.options).toEqual(OUTCOME_OPTIONS);
    expect(qs.map((q) => q.text)).toEqual([QUESTION_TEXT.calls, QUESTION_TEXT.totalWaitMs, QUESTION_TEXT.outcome]);
  });

  it("price questions: one per market, unit USD, tolerance fixed at 10%; 'touched' expands from the context", () => {
    const qs = questionsFor({ shape: "apply-proposal-then-read", markets: "touched" }, EVM);
    expect(qs.map((q) => q.measures)).toEqual(["priceUsd1e18:cbETH", "priceUsd1e18:WETH", "priceUsd1e18:USDC"]);
    expect(qs[0]!.text).toBe("After this proposal is applied, what will Moonwell's oracle report for 1 cbETH, in USD?");
    for (const q of qs) {
      expect(q.unit).toBe("USD");
      expect(measuredUnit(q.measures)).toBe("USD");
      expect(q.tolerancePct).toBe(10);
    }
  });

  it("no questions for shapes nothing measures yet", () => {
    expect(questionsFor({ shape: "concurrency-sweep", callers: 2, failTimes: 0, failure: "error" })).toEqual([]);
  });
});

describe("rendered allow-list (text for the Claimant)", () => {
  it("shows only the shapes allowed on the target, with the bounds the gate checks", () => {
    const text = renderAllowList({ shapes: ["retry-scenario"] });
    expect(text).toContain('shape "retry-scenario"');
    expect(text).not.toContain("concurrency-sweep");
    expect(text).toContain(`failTimes: whole number ${BOUNDS.failTimes.min}..${BOUNDS.failTimes.max} or "always"`);
    expect(text).toContain(`attempts: whole number 1..10`);
    expect(text).toContain(`delayMs: whole number 0..60000`);
    expect(text).toContain(`failure: "error" | "never_settles"`);
  });

  it("lists the touched markets for EVM shapes", () => {
    expect(renderAllowList(EVM)).toContain('markets: list of markets from ["cbETH", "WETH", "USDC"] or "touched"');
  });

  it("renders each question with the exact answer JSON it needs", () => {
    const text = renderQuestions(questionsFor({ shape: "retry-scenario", failTimes: 0, failure: "error" }));
    expect(text).toContain('1. measures "calls": How many times will the function call the RPC?');
    expect(text).toContain('{"kind":"enum","value":<one of "returns" | "throws" | "pending">,"options":["returns","throws","pending"]}');
  });
});
