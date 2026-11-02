// R7 (D69): one question, picked by plain code, the same for every bettor; and the built-in example's recorded round, replayed
// only from the exact text it was recorded from, and always marked as recorded. Every model mocked, $0.
import { describe, expect, it } from "vitest";
import { oneQuestion, quizQuestionsFor } from "../../src/quiz";
import { U1_EXAMPLE } from "../../web/u1-example";
import RECORDED from "../../server/example-round.json";
import { client, makeApp, RETRY_SRC } from "../tools/paste-fixtures";

const callTest = (calls: unknown[]) => ({ shape: "call-function", exportName: "fetchWithRetry", args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls }] });

describe("oneQuestion: plain code's pick", () => {
  it("asks how the call ends when the round has that question", () => {
    const qs = quizQuestionsFor(callTest([{ do: "throw", errorName: "Error", message: "x" }]), ["fetchWithRetry"], "ts");
    expect(qs.length).toBeGreaterThan(1);
    expect(oneQuestion(qs).map((q) => q.measures)).toEqual(["outcome"]);
  });
  it("falls back to the first question, and never to none", () => {
    const qs = quizQuestionsFor(callTest([{ do: "throw", errorName: "Error", message: "x" }]), ["fetchWithRetry"], "ts").filter((q) => q.measures !== "outcome");
    expect(oneQuestion(qs)).toEqual([qs[0]]);
    expect(oneQuestion([])).toEqual([]);
  });
});

describe("POST /experiments with one: true", () => {
  it("the person and every model get the same single question (D19)", async () => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const name = p.json.exports[0].name as string;
    const e = await c.post("/experiments", { target: t, params: { shape: "call-function", exportName: name, args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "Error", message: "x" }] }] }, quiz: true, one: true }, { "x-atlas-claimant": "both" });
    expect(e.status).toBe(200);
    expect(e.json.questions).toHaveLength(1);
    expect(e.json.seenContext).toContain("1. ");
    expect(e.json.seenContext).not.toMatch(/\n2\. /);
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    const bettors = m.calls.filter((x) => x.role === "claimant");
    expect(new Set(bettors.map((b) => b.model)).size).toBe(2);
    for (const b of bettors) {
      const text = b.messages.map((x) => x.content).join("\n");
      expect(text).toContain(e.json.seenContext);
      expect([...text.matchAll(/measures "([^"]+)"/g)].map((x) => x[1])).toEqual([e.json.questions[0].measures]);
    }
  });
  it("is refused without the quiz", async () => {
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: RETRY_SRC, language: "ts" });
    const e = await c.post("/experiments", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, params: {}, one: true });
    expect(e.status).toBe(400);
  });
});

describe("the built-in example's recorded round", () => {
  const exampleRound = async (opts: { names?: boolean; one?: boolean } = {}) => {
    const { app, m } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    if (opts.names !== false) await c.post("/paste/names", { target: t });
    const props = await c.post("/paste/proposals", { target: t, exportName: "fetchWithRetry" });
    const first = (props.json.proposals as { id: string; gate: { allowed: boolean } }[]).find((x) => x.gate.allowed)!;
    const e = await c.post("/experiments", { target: t, proposalId: first.id, quiz: true, ...(opts.one === false ? {} : { one: true }) }, { "x-atlas-claimant": "both" });
    const slots = await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    return { m, e, slots: slots.json.models as { model: string; status: string; recorded?: string }[] };
  };
  it("asks no model at all: Wonder's tests and both bets are the recorded answers, marked recorded with their day", async () => {
    const { m, e, slots } = await exampleRound();
    expect(m.calls).toHaveLength(0);
    expect(e.json.questions.map((q: { measures: string }) => q.measures)).toEqual(["outcome"]);
    expect(slots.map((s) => [s.status, s.recorded])).toEqual([
      ["sealed", RECORDED.recordedOn],
      ["sealed", RECORDED.recordedOn],
    ]);
  });
  it("a different text is asked live, and is not marked recorded", async () => {
    for (const changed of [{ one: false }, { names: false }]) {
      const { m, slots } = await exampleRound(changed);
      expect(m.calls.filter((x) => x.role === "claimant").length).toBeGreaterThanOrEqual(2);
      expect(slots.every((s) => s.recorded === undefined)).toBe(true);
    }
  });
});

describe("the proof card's credit line (plain code, from the file alone)", () => {
  it("credits Muse Wonder for the test and both bettors, and says a recorded answer is recorded", async () => {
    const { creditLine } = await import("../../web/screens/proofcard-model");
    const exp = [{ proposedBy: { role: "investigator", model: "muse-wonder-1.0" } }] as never;
    const bets = [{ who: "human" }, { who: "model:muse-spark-1.3" }, { who: "model:meta-models/muse-spark-open-1026" }] as never;
    expect(creditLine({ experiments: exp, bets, bettors: [] })).toBe("Test written by Muse Wonder · bet by Muse Spark and Muse Spark Open");
    expect(creditLine({ experiments: exp, bets, bettors: [{ who: "model:muse-spark-1.3", status: "sealed", recorded: "2026-11-02" }] })).toBe("Test written by Muse Wonder · bet by Muse Spark (its answer recorded Nov 2) and Muse Spark Open");
    expect(creditLine({ experiments: [{ proposedBy: { role: "human" } }] as never, bets: [{ who: "human" }] as never, bettors: [] })).toBe("Test written by the person");
  });
});
