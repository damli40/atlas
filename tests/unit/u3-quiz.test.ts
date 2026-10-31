// U3 item 4: the returned-value question takes a typed value besides its options, for every bettor alike (D19);
// typed text is read by a literal-only parser (never evaluated). Item 5: the claim's words are never a verdict.

import { describe, expect, it } from "vitest";
import { quizQuestionsFor } from "../../src/quiz";
import { answerHow } from "../../src/paste-context";
import { answerTemplate } from "../../src/gate";
import { checkAnswer } from "../../server/bets";
import { validateBetsFor } from "../../server/meta/roles/claimant";
import { parseTyped } from "../../src/literal";
import { judge } from "../../src/judge";
import { sealBet } from "../../src/seal";
import type { ExperimentShape, Run } from "../../src/types";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const t: Call = { shape: "call-function", exportName: "get_user_plan", args: [{ kind: "json", value: 1 }] };
const qs = quizQuestionsFor(t, ["get_user_plan"], "py");
const value = qs.find((q) => q.measures === "returnedJson")!;
const outcome = qs.find((q) => q.measures === "outcome")!;

describe("U3 item 4: a typed returned value", () => {
  it("is offered on the returned-value question only, in the same words for the person and the models", () => {
    expect(value.allowsTyped).toBe(true);
    expect(outcome.allowsTyped).toBeUndefined();
    expect(answerHow(value)).toMatch(/; or can't tell; or type the exact value you expect, as JSON \(matched only when it is exactly the returned value\)$/);
    expect(answerTemplate(value)).toContain('or the exact value you expect, as {"kind":"json","value":<any JSON value>}');
  });

  it("is accepted from the person and from a model on that question, and refused on the others", () => {
    expect(checkAnswer(value, { kind: "json", value: "pro" })).toEqual({ ok: true, answer: { kind: "json", value: "pro" } });
    expect(checkAnswer(outcome, { kind: "json", value: "pro" }).ok).toBe(false);
    const model = validateBetsFor(qs, qs.map((q) => ({ measures: q.measures, answer: q.measures === "returnedJson" ? { kind: "json", value: "pro" } : { kind: "declined", reason: "no estimate" } }) as never));
    expect(model.ok).toBe(true);
    const bad = validateBetsFor(qs, qs.map((q) => ({ measures: q.measures, answer: q.measures === "outcome" ? { kind: "json", value: "pro" } : { kind: "declined", reason: "no estimate" } }) as never));
    expect(bad.ok).toBe(false);
  });

  it("is judged by exact equality with the returned value (key order ignored)", () => {
    const run = { id: "r", experimentId: "e", runner: "ts", executor: "local", codeSha256: "x", startedAt: "", finishedAt: "", trace: [], controlPassed: true, result: { measured: { outcome: "returned", returnedJson: '{"a":1,"b":true}' }, notMeasured: {} } } as unknown as Run;
    const bet = (v: unknown) => sealBet({ who: "human", experimentId: "e", question: value.text, measures: "returnedJson", answer: { kind: "json", value: v as never } });
    expect(judge(bet({ b: true, a: 1 }), run).outcome).toBe("matched");
    expect(judge(bet({ a: 1 }), run).outcome).toBe("not_matched");
  });

  it("reads JSON, and Python's own spelling for a Python file, never by evaluating it", () => {
    expect(parseTyped('"pro"', "py")).toEqual({ value: "pro" });
    expect(parseTyped("'pro'", "py")).toEqual({ value: "pro" });
    expect(parseTyped("{'plan': None, 'ok': True, 'n': [1, 2,]}", "py")).toEqual({ value: { plan: null, ok: true, n: [1, 2] } });
    expect(parseTyped("'pro'", "ts")).toBeNull();
    expect(parseTyped("__import__('os')", "py")).toBeNull();
    expect(parseTyped("{'__proto__': 1}", "py")).toBeNull();
    expect(parseTyped("", "py")).toBeNull();
  });
});
