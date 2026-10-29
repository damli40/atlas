// U1 (D48): the quiz. Options are written by plain code from the test only; count and time options cover every value
// once; judging is by option membership; every bettor reads the same options (D19); old proof files still verify.

import { describe, expect, it } from "vitest";
import { countOptions, coverageProblem, quizMembership, quizQuestionsFor, timeOptions, valueOptions, endingOptions } from "../../src/quiz";
import { judge } from "../../src/judge";
import { pastedBetContext } from "../../src/paste-context";
import { verifyAtlasFile } from "../../src/atlasfile";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import type { AtlasFile, Bet, ExperimentShape, QuizOption, Run } from "../../src/types";
import { RETRY_SRC, WONDER_ANSWER, allowedA, client } from "../tools/paste-fixtures";

type Call = Extract<ExperimentShape, { shape: "call-function" }>;
const test3: Call = {
  shape: "call-function",
  exportName: "retryWithBackoff",
  args: [
    {
      kind: "stand-in",
      name: "fetchIt",
      async: true,
      calls: [
        { do: "throw", errorName: "TimeoutError", message: "slow" },
        { do: "return", value: { ok: false }, afterMs: 100 },
        { do: "return", value: { ok: true }, afterMs: 600 },
      ],
      then: "repeat_last",
    },
    { kind: "json", value: 3 },
    { kind: "json", value: 100 },
  ],
};

const run = (measured: Run["result"]["measured"], notMeasured: Run["result"]["notMeasured"] = {}): Run => ({
  id: "r1",
  experimentId: "e1",
  runner: "ts",
  executor: "local",
  codeSha256: "x",
  startedAt: "2026-10-29T00:00:01.000Z",
  finishedAt: "2026-10-29T00:00:02.000Z",
  trace: [],
  result: { measured, notMeasured },
  controlPassed: true,
});
const bet = (measures: string, choice: string, options: QuizOption[]): Bet => ({
  id: `b-${measures}-${choice}`,
  experimentId: "e1",
  who: "human",
  question: "q",
  measures,
  answer: { kind: "quiz", choice, options },
  nonce: "n",
  sealedAt: "2026-10-29T00:00:00.000Z",
  sealedHash: "h",
});

describe("U1 quiz options are built by plain code from the test only", () => {
  it("count options cover every whole number from 0 once (N = 1, 2, 3, 7)", () => {
    for (const n of [1, 2, 3, 7]) {
      const o = countOptions(n);
      expect(coverageProblem(o)).toBeNull();
      expect(o.length).toBeGreaterThanOrEqual(3);
      expect(o.length).toBeLessThanOrEqual(4);
      for (let v = 0; v <= 30; v++) expect(o.filter((x) => (quizMembership(x.id, o, "count", v) as { matched: boolean }).matched).length).toBe(1);
    }
    expect(countOptions(3).map((o) => o.label)).toEqual(["0 times (never called)", "1 to 2 times", "3 times", "4 or more times"]);
  });

  it("time options are ranges from the scripted waits that cover every time from 0 once, with no overlap", () => {
    const o = timeOptions(test3);
    expect(o.map((x) => x.label)).toEqual(["0 ms (no wait at all)", "more than 0 ms, less than 100 ms", "100 ms to 700 ms", "more than 700 ms"]);
    expect(coverageProblem(o)).toBeNull();
    for (const v of [0, 0.001, 1, 99.999, 100, 350, 700, 700.0001, 5000, 600000]) expect(o.filter((x) => (quizMembership(x.id, o, "ms", v) as { matched: boolean }).matched).length).toBe(1);
    // no scripted wait: two ranges, still complete
    const flat = timeOptions({ ...test3, args: [{ kind: "json", value: 1 }] });
    expect(flat.map((x) => x.label)).toEqual(["0 ms (no wait at all)", "more than 0 ms"]);
    expect(coverageProblem(flat)).toBeNull();
    // one wait: d = S
    const one = timeOptions({ ...test3, args: [{ kind: "stand-in", name: "f", async: true, calls: [{ do: "return", value: 1, afterMs: 250 }], then: "repeat_last" }] });
    expect(one.map((x) => x.label)).toEqual(["0 ms (no wait at all)", "more than 0 ms, less than 250 ms", "exactly 250 ms", "more than 250 ms"]);
    expect(coverageProblem(one)).toBeNull();
  });

  it("the coverage check catches a gap and an overlap", () => {
    const gap: QuizOption[] = [
      { id: "a", label: "", match: { kind: "count", min: 0, max: 0 } },
      { id: "b", label: "", match: { kind: "count", min: 2, max: null } },
    ];
    expect(coverageProblem(gap)).toMatch(/gap/);
    const both: QuizOption[] = [
      { id: "a", label: "", match: { kind: "ms", min: 0, max: 100, minOpen: false, maxOpen: false } },
      { id: "b", label: "", match: { kind: "ms", min: 100, max: null, minOpen: false, maxOpen: false } },
    ];
    expect(coverageProblem(both)).toMatch(/both hold 100/);
  });

  it("returned values are the scripted returns, then the JSON arguments, then 'another value'", () => {
    expect(valueOptions(test3).map((o) => o.label)).toEqual(['{"ok":false} (what fetchIt is scripted to return)', '{"ok":true} (what fetchIt is scripted to return)', "3 (the same as argument 2)", "another value"]);
    expect(endingOptions(30000).map((o) => o.match)).toEqual([
      { kind: "word", value: "returned" },
      { kind: "word", value: "threw" },
      { kind: "word", value: "never_settled" },
      { kind: "word", value: "still_running_at_watch_limit" },
    ]);
  });

  it("the builder's only input is the test: anything a test does not have (a run, a measured value) is refused by the gate", () => {
    expect(quizQuestionsFor.length).toBe(3); // (test, exportNames?, language?) and nothing else (U2 added the language, for the gate)
    const smuggled = { ...test3, run: { result: { measured: { virtualMs: 123 } } } };
    expect(() => quizQuestionsFor(smuggled)).toThrow(/gate refuses/);
    const withMeasured = { ...test3, measured: { "calls:fetchIt": 9 } };
    expect(() => quizQuestionsFor(withMeasured)).toThrow(/gate refuses/);
    // and the same test always gives the same options (no clock, no randomness)
    expect(JSON.stringify(quizQuestionsFor(test3))).toBe(JSON.stringify(quizQuestionsFor(JSON.parse(JSON.stringify(test3)))));
    expect(quizQuestionsFor(test3).map((q) => q.measures)).toEqual(["outcome", "returnedJson", "calls:fetchIt", "virtualMs"]);
  });
});

describe("U1 quiz judging is by option membership", () => {
  const qs = quizQuestionsFor(test3);
  const of = (m: string) => qs.find((q) => q.measures === m)!.quiz! as QuizOption[];
  it("matched when the measured value is inside the chosen option; not when it is outside", () => {
    const r = run({ outcome: "returned", returnedJson: '{"ok":true}', "calls:fetchIt": 3, virtualMs: 700 });
    expect(judge(bet("outcome", "a", of("outcome")), r).outcome).toBe("matched");
    expect(judge(bet("outcome", "b", of("outcome")), r).outcome).toBe("not_matched");
    expect(judge(bet("returnedJson", "b", of("returnedJson")), r).outcome).toBe("matched");
    expect(judge(bet("returnedJson", "d", of("returnedJson")), r).outcome).toBe("not_matched"); // "another value"
    expect(judge(bet("calls:fetchIt", "c", of("calls:fetchIt")), r).outcome).toBe("matched"); // "3 times"
    expect(judge(bet("virtualMs", "c", of("virtualMs")), r).outcome).toBe("matched"); // 100–700 includes 700
    expect(judge(bet("virtualMs", "d", of("virtualMs")), r).outcome).toBe("not_matched");
    expect(judge(bet("returnedJson", "d", of("returnedJson")), run({ returnedJson: '{"ok":"maybe"}' })).outcome).toBe("matched");
  });
  it("can't check: a field not measured, a declined bet, a choice outside its options, options that do not fit the unit", () => {
    const r = run({ outcome: "threw" }, { virtualMs: "the call threw" });
    expect(judge(bet("virtualMs", "a", of("virtualMs")), r)).toMatchObject({ outcome: "cant_check", reason: "the call threw" });
    expect(judge({ ...bet("outcome", "a", of("outcome")), answer: { kind: "declined", reason: "can't tell" } }, r)).toMatchObject({ outcome: "cant_check", reason: "the bettor declined" });
    expect(judge(bet("outcome", "z", of("outcome")), r).outcome).toBe("cant_check");
    expect(judge(bet("outcome", "a", of("virtualMs")), r)).toMatchObject({ outcome: "cant_check", reason: expect.stringMatching(/do not fit/) });
  });
});

describe("U1 D19: every bettor reads the same options, byte for byte", () => {
  it("the bettor text lists each question's options exactly as the quiz shows them", () => {
    const questions = quizQuestionsFor(test3);
    const text = pastedBetContext({ experiment: { target: { kind: "pasted", ref: "pasted:x", codeSha256: "a".repeat(64), language: "ts", source: RETRY_SRC }, params: test3, proposedBy: { role: "human" } }, questions, exportLine: 2 });
    for (const q of questions) for (const o of q.quiz!) expect(text).toContain(`(${o.id}) ${o.label}`);
    expect(text).toContain("or can't tell");
  });

  it("server: a quiz round gives the page and every model the same text with the options; models answer by letter; the proof verifies", async () => {
    const calls: ChatArgs[] = [];
    const chat = async (a: ChatArgs): Promise<ChatResult> => {
      calls.push(JSON.parse(JSON.stringify(a)));
      if (a.role === "investigator") return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: WONDER_ANSWER };
      const all = a.messages.map((m) => m.content).join("\n");
      const qs = [...all.matchAll(/measures "([^"]+)"/g)].map((m) => m[1]!);
      return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0 }, content: JSON.stringify({ bets: qs.map((m) => ({ measures: m, answer: { kind: "quiz", choice: "a" }, rationale: "mock" })) }) };
    };
    const app = createApp({ agentLog: createAgentLog(), modelBets: { chat, budget: createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: true } }, paste: { proposer: { chat } } });
    const c = client(app);
    const pasted = await c.post("/paste", { code: RETRY_SRC, language: "ts" });
    expect(pasted.status).toBe(200);
    expect(pasted.json.outline.parts.map((p: { name: string }) => p.name)).toEqual(["retryWithBackoff"]);
    const target = pasted.json.target;
    const e = await c.post("/experiments", { target, params: allowedA, quiz: true }, { "x-atlas-claimant": "both" });
    expect(e.status).toBe(200);
    const questions = e.json.questions as { kind: string; quiz: QuizOption[] }[];
    expect(questions.every((q) => q.kind === "quiz" && q.quiz.length >= 2)).toBe(true);
    const seen = e.json.seenContext as string;
    for (const q of questions) for (const o of q.quiz) expect(seen).toContain(`(${o.id}) ${o.label}`);
    // wait for both models, then compare their prompts with the page's text
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {}); // waits for the models' sealed bets
    const betPrompts = calls.filter((x) => x.role === "claimant");
    expect(betPrompts.length).toBe(2);
    for (const p of betPrompts) expect(p.messages.map((m) => m.content).join("\n")).toContain(seen);
    // a non-quiz round with the same test does not reuse the quiz text (the key includes the questions)
    const plain = await c.post("/experiments", { target, params: allowedA }, { "x-atlas-claimant": "spark" });
    expect(plain.json.seenContext).not.toBe(seen);
    // the person taps one option and says "can't tell" to the rest
    const qm = (questions as unknown as { measures: string }[]).map((q) => q.measures);
    const sealed = await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: qm.map((m, i) => ({ measures: m, answer: i === 0 ? { kind: "quiz", choice: "a" } : { kind: "declined", reason: "can't tell" } })) });
    expect(sealed.status).toBe(200);
    const bad = await c.post("/bets", { experimentId: plain.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "a" } }] });
    expect(bad.status).toBe(400); // a quiz answer to a free question is refused
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(r.status).toBe(200);
    const bets = r.json.bets as Bet[];
    expect(bets.filter((b) => b.answer.kind === "quiz").length).toBeGreaterThanOrEqual(1 + 2 * qm.length);
    for (const b of bets) if (b.answer.kind === "quiz") expect(b.answer.options.length).toBeGreaterThanOrEqual(2);
    expect(r.json.proof.ok).toBe(true);
    const file = (await c.get(`/proofs/${r.json.run.id}`)).json as AtlasFile;
    expect(verifyAtlasFile(file).ok).toBe(true);
    // tampered options are caught by verify
    const tampered = JSON.parse(JSON.stringify(file)) as AtlasFile;
    const qb = tampered.bets.find((b) => b.answer.kind === "quiz")!;
    if (qb.answer.kind === "quiz") qb.answer.options[0]!.label = "something the test never said";
    const v = verifyAtlasFile(tampered);
    expect(v.ok).toBe(false);
  }, 60_000);
});

describe("U1 review round 1", () => {
  const qs = quizQuestionsFor(test3);
  const of = (m: string) => qs.find((q) => q.measures === m)!.quiz! as QuizOption[];
  it("m4: a measured value no option holds is can't check, never didn't match", () => {
    expect(judge(bet("outcome", "a", of("outcome")), run({ outcome: "pending" })).outcome).toBe("cant_check");
    expect(judge(bet("virtualMs", "a", of("virtualMs")), run({ virtualMs: -5 })).outcome).toBe("cant_check");
  });
  it("m5: two values cut to the same words get different labels", () => {
    const long = (n: number) => "x".repeat(n);
    const o = valueOptions({ ...test3, args: [{ kind: "json", value: long(60) }, { kind: "json", value: long(61) }] });
    const labels = o.map((x) => x.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it("M3: the marks state no measured value when the run may not be shown as fact", async () => {
    const { marksOf } = await import("../../web/machines/bench/play");
    const r = run({ outcome: "returned" }, { wholeRun: "the code imports a package" });
    const marks = marksOf(qs, [], [], r, "retryWithBackoff");
    for (const m of marks) expect(m.measured).toMatch(/^can't check/);
  });
});
