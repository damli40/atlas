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

describe("review minor 1: verify ties the recorded label to the recorded answers", () => {
  it("a proof of the example verifies; with the label removed, or added to a live answer, it does not", async () => {
    const { verifyAtlasFile } = await import("../../src/atlasfile");
    const { app } = makeApp();
    const c = client(app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    await c.post("/paste/names", { target: t });
    const props = await c.post("/paste/proposals", { target: t, exportName: "fetchWithRetry" });
    const first = (props.json.proposals as { id: string; gate: { allowed: boolean } }[]).find((x) => x.gate.allowed)!;
    const e = await c.post("/experiments", { target: t, proposalId: first.id, quiz: true, one: true }, { "x-atlas-claimant": "both" });
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`, {});
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "a" } }] });
    const run = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(run.status).toBe(200);
    const proof = await c.get(`/proofs/${run.json.run.id}`);
    const file = proof.json as { bettors: { who: string; recorded?: string }[] };
    expect(file.bettors.filter((s) => s.recorded).length).toBe(2);
    const ok = verifyAtlasFile(file);
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    const stripped = JSON.parse(JSON.stringify(file));
    for (const s of stripped.bettors) delete s.recorded;
    expect(verifyAtlasFile(stripped).ok).toBe(false);
    // and a label on an answer that is not the recorded one is refused
    // Models mocked with usable answers (the U1 mock), so the live round has sealed model bets to mislabel.
    const { mockChat } = await import("../evidence/U1/mock-server");
    const { app: app2 } = makeApp({ modelBets: { chat: mockChat, budget: (await import("../../server/meta/budget")).createModelBudget({ spendCeilingUsd: 5 }), sparkOpen: { available: true } } });
    const c2 = client(app2);
    const p2 = await c2.post("/paste", { code: RETRY_SRC, language: "ts" });
    const t2 = { ref: p2.json.target.ref, codeSha256: p2.json.target.codeSha256 };
    const e2 = await c2.post("/experiments", { target: t2, params: { shape: "call-function", exportName: p2.json.exports[0].name, args: [{ kind: "stand-in", name: "fetchIt", async: true, then: "repeat_last", calls: [{ do: "throw", errorName: "Error", message: "x" }] }] }, quiz: true, one: true }, { "x-atlas-claimant": "both" });
    await c2.post(`/experiments/${e2.json.experiment.id}/model-bets`, {});
    await c2.post("/bets", { experimentId: e2.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "a" } }] });
    const run2 = await c2.post("/runs", { experimentId: e2.json.experiment.id });
    const live = (await c2.get(`/proofs/${run2.json.run.id}`)).json as { bettors: { who: string; status: string; recorded?: string }[] };
    expect(verifyAtlasFile(live).ok).toBe(true);
    const faked = JSON.parse(JSON.stringify(live));
    for (const s of faked.bettors) if (s.who !== "human" && s.status === "sealed") s.recorded = "2026-11-02";
    expect(faked.bettors.some((s: { recorded?: string }) => s.recorded)).toBe(true);
    expect(verifyAtlasFile(faked).ok).toBe(false);
  }, 60_000);
});
