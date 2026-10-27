// Day-7 review, server findings: S4 (the autonomous round takes ONE experiment slot, and never runs the
// code when no bettor sealed a bet) and M6 (a failed "What else?" can be asked again). Mocked models
// only; no live call. Failed on the code before its fix (tests/evidence/D07-review/*-tests-on-old-code.txt).

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createApp, type AdversaryAnswer } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { memoryRefusalWriter } from "../../server/proofs/refusals";
import { createModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import type { ExperimentShape, Run, Target } from "../../src/types";

const usage = { promptTokens: 2000, completionTokens: 200, usd: 0.011 };
const mock = (replies: (string | Error)[]) => {
  let i = 0;
  const calls: ChatArgs[] = [];
  return {
    calls,
    chat: async (a: ChatArgs): Promise<ChatResult> => {
      calls.push(a);
      const r = replies[i++];
      if (r instanceof Error) throw r;
      if (r === undefined) return { ok: false, reason: "no more replies" };
      return { ok: true, content: r, finishReason: "stop", usage };
    },
  };
};
const bets = (c: number, w: number, o: string) =>
  JSON.stringify({
    bets: [
      { measures: "calls", answer: { kind: "integer", value: c }, rationale: "r" },
      { measures: "totalWaitMs", answer: { kind: "integer", value: w }, rationale: "r" },
      { measures: "outcome", answer: { kind: "enum", value: o, options: ["returns", "throws", "pending"] }, rationale: "r" },
    ],
  });
const answer = (experiment: unknown) => JSON.stringify({ experiment, why: "w" });

function server(advReplies: (string | Error)[], sparkReplies: (string | Error)[], o: { experimentsPerSession?: number; modelRoundsPerHour?: number } = {}) {
  process.env.ATLAS_USAGE_PATH = join(mkdtempSync(join(tmpdir(), "r7-")), "u.jsonl");
  const adv = mock(advReplies);
  const spark = mock(sparkReplies);
  const budget = createModelBudget(o.experimentsPerSession ? { experimentsPerSession: o.experimentsPerSession } : {});
  const app = createApp({
    agentLog: createAgentLog(),
    refusals: memoryRefusalWriter(),
    modelBets: { chat: spark.chat, sparkOpen: { available: true }, budget },
    adversary: { chat: adv.chat, budget },
    ...(o.modelRoundsPerHour ? { perClientModelLimits: { modelRoundsPerHour: o.modelRoundsPerHour } } : {}),
  });
  const post = (p: string, b: unknown) => app.request(p, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "r7" }, body: JSON.stringify(b) });
  return { app, post, adv, spark };
}
async function first(post: (p: string, b: unknown) => Promise<Response> | Response, params: ExperimentShape) {
  const t = (await (await post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).json()) as Target;
  const e = await post("/experiments", { id: "e1", target: { ref: t.ref, codeSha256: t.codeSha256 }, params });
  expect(e.status).toBe(200);
  await post("/bets", { experimentId: "e1", who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 1 } }] });
  const r = await post("/runs", { experimentId: "e1" });
  expect(r.status).toBe(200);
  return ((await r.json()) as { run: Run }).run;
}
type Round = { bets?: { who: string }[]; verdicts?: unknown[]; models?: { status: string; reason?: string }[]; run?: Run };

describe("S4: the autonomous round uses ONE experiment slot", () => {
  it("experimentsPerSession 2: one normal round + 'What else?' still seats Muse Spark (the Adversary's slot covers the round)", async () => {
    const s = server([answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws"), bets(3, 6000, "returns")], { experimentsPerSession: 2 });
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const a = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    const round = a.round as Round;
    expect(a.ok).toBe(true);
    expect(round.models?.map((m) => m.status)).toEqual(["sealed"]);
    expect(round.bets?.filter((b) => b.who === "model:muse-spark-1.3")).toHaveLength(3);
    expect(round.verdicts).toHaveLength(3);
  });
  it("2 model rounds an hour per address: the same, the address limit is counted once", async () => {
    const s = server([answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws"), bets(3, 6000, "returns")], { modelRoundsPerHour: 2 });
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const a = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    expect(a.ok).toBe(true);
    expect((a.round as Round).models?.map((m) => m.status)).toEqual(["sealed"]);
  });
});

describe("S4: no bettor seated, no run", () => {
  it("every model gave no usable answer: the code is not run, and the answer says why in plain words", async () => {
    // The first spark reply is for round 1; round 2's reply is not JSON (no usable answer, and its one repair try fails too).
    const s = server([answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws"), "not json", "still not json"]);
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const a = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    const round = a.round as Round | undefined;
    expect(a.ok).toBe(false);
    expect(a.reason).toMatch(/^no bettor sealed a bet, so Atlas did not run it: Muse Spark 1\.3 \(muse-spark-1\.3\): no usable answer/);
    expect(round?.run).toBeUndefined();
    expect(round?.verdicts ?? []).toHaveLength(0);
    expect(a.adversary?.proposed).toBeDefined(); // the proposal itself is still shown
  });
  it("the model-bets limit is reached by the round's own count (the review's P4): not run, ok:false", async () => {
    const s = server([answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws")], { experimentsPerSession: 1 });
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const a = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    expect(a.ok).toBe(false);
    expect((a.round as Round | undefined)?.run).toBeUndefined();
    expect(s.adv.calls).toHaveLength(0); // the Adversary itself was not asked: the session's limit was already used
  });
});

describe("M6: a failed 'What else?' can be asked again", () => {
  it("'the server could not finish' is not cached", async () => {
    const s = server([new Error("socket hang up"), answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws"), bets(3, 6000, "returns")]);
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const a1 = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    expect(a1.ok).toBe(false);
    expect(a1.reason).toMatch(/could not finish|no usable answer/);
    const a2 = (await (await s.post("/adversary", { runId: run1.id })).json()) as AdversaryAnswer;
    expect(a2.ok).toBe(true);
    expect(s.adv.calls.length).toBe(2);
  });
});

describe("M4 (server): 'What else?' uses the claimant mode of the round it reads, not the page's current toggle", () => {
  it("round run with Muse Spark only; the toggle is then flipped to 'both': the autonomous round still asks Muse Spark only", async () => {
    const s = server([answer({ shape: "retry-scenario", failTimes: 2, failure: "error" })], [bets(5, 12000, "throws"), bets(3, 6000, "returns"), bets(3, 6000, "returns")]);
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const res = await s.app.request("/adversary", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "r7", "x-atlas-claimant": "both" }, body: JSON.stringify({ runId: run1.id }) });
    const a = (await res.json()) as AdversaryAnswer;
    expect(a.ok).toBe(true);
    expect((a.round as { models?: { who: string }[] }).models?.map((m) => m.who)).toEqual(["model:muse-spark-1.3"]);
  });
});

describe("M3/M7 (file): the .atlas.json records every bettor, including those who sealed nothing", () => {
  it("a round where Muse Spark gave no usable answer: its slot is in the file as no_usable_answer, and verify holds the list to the bets", async () => {
    const { verifyAtlasFile } = await import("../../src/atlasfile");
    const s = server([], ["not json", "still not json"]);
    const run1 = await first(s.post, { shape: "retry-scenario", failTimes: 5, failure: "error" });
    const file = (await (await s.app.request(`/proofs/${run1.id}`)).json()) as import("../../src/types").AtlasFile;
    expect(file.bettors?.map((b) => [b.who, b.status])).toEqual([
      ["human", "sealed"],
      ["model:muse-spark-1.3", "no_usable_answer"],
    ]);
    expect(verifyAtlasFile(file).ok).toBe(true);
    const lie = { ...file, bettors: [{ who: "human", status: "not_asked" }, { who: "model:muse-spark-1.3", status: "no_usable_answer" }] };
    const v = verifyAtlasFile(lie);
    expect(v.ok).toBe(false);
    expect(v.ok ? [] : v.problems.join("; ")).toMatch(/bettors says human sealed nothing/);
  });
});
