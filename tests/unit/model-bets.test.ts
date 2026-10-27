// D02-06: the Claimant in bet-only mode, and the server sealing the model's bets beside the person's.
// chat() is mocked: no network, no key, nothing written to proofs/.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createBetStore } from "../../server/bets";
import { createAgentLog, sessionEmitter } from "../../server/log/agentlog";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { buildBetOnlyMessages, runClaimantBets } from "../../server/meta/roles/claimant-bets";
import { repairMessage } from "../../server/meta/roles/claimant";
import { FIXTURE_FILE, fixtureFinding } from "../../server/meta/roles/fixture-finding";
import { TS_GATE_CONTEXT } from "../../server/app";
import { questionsFor } from "../../src/gate";
import { verifySeal } from "../../src/seal";
import type { Bet, Experiment, Run, Verdict } from "../../src/types";

const FILE_TEXT = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const finding = fixtureFinding(FILE_TEXT);
const usage = { promptTokens: 1500, completionTokens: 300, usd: 0.012 };
const S3 = { shape: "retry-scenario" as const, failTimes: 5, failure: "error" as const };
const OPTIONS = ["returns", "throws", "pending"];

// Values chosen so they cannot appear by accident anywhere else in a response.
const SECRET_RATIONALE = "Zebra-quartz rationale that must stay on the server until the run.";
const SPARK = {
  bets: [
    { measures: "calls", answer: { kind: "integer", value: 7 }, rationale: SECRET_RATIONALE },
    { measures: "totalWaitMs", answer: { kind: "integer", value: 43219 }, rationale: SECRET_RATIONALE },
    { measures: "outcome", answer: { kind: "enum", value: "pending", options: OPTIONS }, rationale: SECRET_RATIONALE },
  ],
};

function mockChat(replies: (string | ChatResult)[], gate?: Promise<void>) {
  const calls: ChatArgs[] = [];
  const chat = async (args: ChatArgs): Promise<ChatResult> => {
    calls.push(JSON.parse(JSON.stringify(args)));
    if (gate) await gate;
    const r = replies[calls.length - 1];
    if (r === undefined) throw new Error("chat called more times than expected");
    return typeof r === "string" ? { ok: true, content: r, finishReason: "stop", usage } : r;
  };
  return { chat, calls };
}

const experiment: Experiment = {
  id: "e1",
  target: { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "a".repeat(64) },
  runner: "ts",
  params: S3,
  proposedBy: { role: "human" },
  gate: { allowed: true },
};
const questions = questionsFor(S3, TS_GATE_CONTEXT);
const roleInput = { experiment, questions, finding, fileText: FILE_TEXT, gateContext: TS_GATE_CONTEXT };

describe("Claimant bet-only mode (role)", () => {
  it("valid answer: one call, one sealed bet per question, model id on every bet, rationale sealed, log lines carry model + usage", async () => {
    const m = mockChat([JSON.stringify(SPARK)]);
    const log = createAgentLog();
    const r = await runClaimantBets(roleInput, { chat: m.chat, log: sessionEmitter(log, "s1") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.model).toBe("muse-spark-1.3");
    expect(m.calls[0]!.role).toBe("claimant");
    expect(r.bets.map((b) => b.measures)).toEqual(["calls", "totalWaitMs", "outcome"]);
    for (const b of r.bets) {
      expect(b.who).toBe("model:muse-spark-1.3");
      expect(b.experimentId).toBe("e1");
      expect(b.rationale).toBe(SECRET_RATIONALE);
      expect(verifySeal(b)).toBe(true);
    }
    expect(r.bets.map((b) => b.question)).toEqual(questions.map((q) => q.text));
    const events = log.history("s1").map((e) => e.event);
    const claimant = events.filter((e) => e.role === "claimant");
    expect(claimant).toHaveLength(1);
    expect(claimant[0]!.model).toBe("muse-spark-1.3");
    expect(claimant[0]!.usage).toEqual(usage);
    expect(events.some((e) => e.role === "seal" && /seals 3 bets from muse-spark-1.3/.test(e.action))).toBe(true);
    // No log line carries the bets' values or the rationale.
    expect(JSON.stringify(events)).not.toMatch(/43219|Zebra-quartz/);
  });

  it("the prompt holds the chosen experiment and the same plain-code questions, and asks for bets only", () => {
    const [sys, user] = buildBetOnlyMessages(roleInput);
    expect(sys!.content).toMatch(/You propose. You never decide./);
    expect(user!.content).toContain(JSON.stringify(S3));
    for (const q of questions) expect(user!.content).toContain(q.text);
    expect(user!.content).toContain('{"bets": [');
    expect(user!.content).not.toMatch(/Pick ONE allowed experiment/);
  });

  it("the prompt says plainly: provably never finishing is measured as pending; cut off by the watch limit is can't check", () => {
    const user = buildBetOnlyMessages(roleInput)[1]!.content;
    expect(user).toMatch(/provably can never finish .* is measured, with outcome "pending"/);
    expect(user).toMatch(/watch limit cuts off before the end is "can't check"/);
  });

  it("garbage → exactly one repair try → { ok: false } with the reason; nothing invented", async () => {
    const m = mockChat(["this is not json", JSON.stringify({ bets: [{ measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "x" }] })]);
    const log = createAgentLog();
    const r = await runClaimantBets(roleInput, { chat: m.chat, log: sessionEmitter(log, "s1") });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.messages.at(-1)!.content).toBe(repairMessage("the answer is not valid JSON"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/no bet on "totalWaitMs", "outcome"/);
    expect(r).not.toHaveProperty("bets");
    const actions = log.history("s1").map((e) => e.event.action);
    expect(actions[0]).toMatch(/not usable: the answer is not valid JSON/);
    expect(actions.at(-1)).toMatch(/^no usable answer \(no bet on/);
    for (const e of log.history("s1").filter((x) => x.event.role === "claimant")) expect(e.event.usage).toEqual(usage);
  });

  it("a failed model call is no usable answer with its reason, and the log line still names the model", async () => {
    const m = mockChat([{ ok: false, reason: "the API answered 503" }]);
    const log = createAgentLog();
    const r = await runClaimantBets(roleInput, { chat: m.chat, log: sessionEmitter(log, "s1") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("the model call failed: the API answered 503");
    const e = log.history("s1")[0]!.event;
    expect(e.model).toBe("muse-spark-1.3");
    expect(e.usage).toEqual({ promptTokens: 0, completionTokens: 0, usd: 0 });
  });

  it("wrong kind or options are refused like the full Claimant's bets; declined is allowed", async () => {
    const wrongOpts = { bets: SPARK.bets.map((b) => (b.measures === "outcome" ? { ...b, answer: { kind: "enum", value: "pending", options: ["pending"] } } : b)) };
    const declined = { bets: SPARK.bets.map((b) => (b.measures === "totalWaitMs" ? { ...b, answer: { kind: "declined", reason: "unknown: clock" } } : b)) };
    const m = mockChat([JSON.stringify(wrongOpts), JSON.stringify(declined)]);
    const r = await runClaimantBets(roleInput, { chat: m.chat });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]!.messages.at(-1)!.content).toMatch(/must have options/);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bets.find((b) => b.measures === "totalWaitMs")!.answer).toEqual({ kind: "declined", reason: "unknown: clock" });
  });
});

// ---------- through the server ----------

function setup(replies: (string | ChatResult)[], gate?: Promise<void>) {
  const m = mockChat(replies, gate);
  const agentLog = createAgentLog();
  const app = createApp({ betStore: createBetStore(), agentLog, modelBets: { chat: m.chat } });
  const session = "model-bets-test";
  const responses: { path: string; text: string }[] = [];
  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify(body) });
    const text = await res.clone().text();
    responses.push({ path, text });
    return res;
  };
  const begin = async () => {
    const target = (await (await post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).json()) as { ref: string; codeSha256: string };
    return post("/experiments", { id: "e1", target, params: S3 });
  };
  const humanBets = async () => {
    await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } });
    await post("/bets", { experimentId: "e1", who: "human", measures: "totalWaitMs", answer: { kind: "integer", value: 98765 } });
    await post("/bets", { experimentId: "e1", who: "human", measures: "outcome", answer: { kind: "enum", value: "throws" } });
  };
  return { ...m, agentLog, session, post, begin, humanBets, responses };
}

type RunBody = { run: Run; verdicts: Verdict[]; bets: Bet[]; model: { status: string; reason?: string } };

describe("model bets through the server (D02-06)", () => {
  it("Spark's values are in no pre-run API response and no log line; after the run both bettors are revealed, judged and seal-checked", async () => {
    const s = setup([JSON.stringify(SPARK)]);
    const created = (await (await s.begin()).json()) as { model: { status: string; who: string } };
    expect(created.model).toMatchObject({ status: "thinking", who: "model:muse-spark-1.3" });
    await s.humanBets();
    const slot = (await (await s.post("/experiments/e1/model-bets", {})).json()) as { model: { status: string; display: string; sealed: Record<string, unknown>[] } };
    expect(slot.model.status).toBe("sealed");
    expect(slot.model.display).toBe("Muse Spark 1.3 (muse-spark-1.3)");
    expect(slot.model.sealed.map((b) => b.measures)).toEqual(["calls", "totalWaitMs", "outcome"]);
    for (const b of slot.model.sealed) {
      expect(b.sealedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(b).sort()).toEqual(["experimentId", "id", "measures", "question", "sealedAt", "sealedHash", "who"]);
    }
    // Every response before the run: none holds Spark's answers, its rationale, or any nonce.
    const preRun = s.responses.map((r) => r.text).join("\n");
    expect(preRun).not.toMatch(/43219|Zebra-quartz|"nonce"/);
    expect(preRun).not.toMatch(/"value":"pending"|"value":7\b/); // Spark's outcome and calls bets (the person bet "throws" and 5)
    expect(preRun).not.toMatch(/model:muse-spark-1.3","question":"[^"]*","measures":"[^"]*","answer"/); // no model bet carries an answer
    expect(JSON.stringify(s.agentLog.history(s.session))).not.toMatch(/43219|Zebra-quartz/);

    const res = await s.post("/runs", { experimentId: "e1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunBody;
    const spark = body.bets.filter((b) => b.who === "model:muse-spark-1.3");
    const mine = body.bets.filter((b) => b.who === "human");
    expect(spark).toHaveLength(3);
    expect(mine).toHaveLength(3);
    // Both judged; Spark's revealed bets hash to exactly what was shown before the run.
    for (const b of [...spark, ...mine]) {
      expect(verifySeal(b)).toBe(true);
      expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(body.run.startedAt));
      expect(body.verdicts.some((v) => v.betId === b.id)).toBe(true);
    }
    for (const b of spark) expect(slot.model.sealed.find((x) => x.id === b.id)!.sealedHash).toBe(b.sealedHash);
    const out = (who: string, m: string) => body.verdicts.find((v) => v.betId === body.bets.find((b) => b.who === who && b.measures === m)!.id)!.outcome;
    expect(out("model:muse-spark-1.3", "calls")).toBe("not_matched"); // 7 vs 5
    expect(out("model:muse-spark-1.3", "outcome")).toBe("not_matched"); // pending vs throws
    expect(out("human", "calls")).toBe("matched");
    expect(spark[0]!.rationale).toBe(SECRET_RATIONALE); // revealed (and sealed) after the run

    const roles = s.agentLog.history(s.session).map((e) => e.event.role);
    expect(roles.indexOf("claimant")).toBeGreaterThan(-1);
    expect(roles.indexOf("claimant")).toBeLessThan(roles.lastIndexOf("runner"));
  }, 30000);

  it("the prompt never sees the person's bets, even ones placed while Spark is still thinking", async () => {
    let release!: () => void;
    const s = setup([JSON.stringify(SPARK)], new Promise<void>((ok) => (release = ok)));
    await s.begin();
    await s.humanBets(); // 98765 is the person's totalWaitMs bet
    release();
    await s.post("/experiments/e1/model-bets", {});
    expect(s.calls).toHaveLength(1);
    expect(JSON.stringify(s.calls)).not.toContain("98765");
  });

  it("garbage → one repair → no usable answer: the slot says why, and the person's bets are still judged", async () => {
    const s = setup(["{ not json", "still not json"]);
    await s.begin();
    await s.humanBets();
    const slot = (await (await s.post("/experiments/e1/model-bets", {})).json()) as { model: { status: string; reason: string; sealed: unknown[] } };
    expect(s.calls).toHaveLength(2);
    expect(slot.model).toMatchObject({ status: "no_usable_answer", reason: "the answer is not valid JSON", sealed: [] });
    const body = (await (await s.post("/runs", { experimentId: "e1" })).json()) as RunBody;
    expect(body.bets.every((b) => b.who === "human")).toBe(true);
    expect(body.verdicts).toHaveLength(3);
    expect(body.verdicts.map((v) => v.outcome)).toEqual(["matched", "not_matched", "matched"]);
    expect(body.model).toMatchObject({ status: "no_usable_answer" });
    const claimant = s.agentLog.history(s.session).filter((e) => e.event.role === "claimant");
    expect(claimant.at(-1)!.event.action).toBe("no usable answer (the answer is not valid JSON)");
    expect(claimant.at(-1)!.event.model).toBe("muse-spark-1.3");
  }, 30000);

  it("Break it right away: the run waits for Spark's bets, then freezes both sets", async () => {
    let release!: () => void;
    const s = setup([JSON.stringify(SPARK)], new Promise<void>((ok) => (release = ok)));
    await s.begin();
    await s.humanBets();
    const running = s.post("/runs", { experimentId: "e1" });
    await new Promise((ok) => setTimeout(ok, 20));
    // Bets are frozen for the person as soon as the run is asked for.
    expect((await s.post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 4 } })).status).toBe(409);
    release();
    const body = (await (await running).json()) as RunBody;
    expect(body.bets.filter((b) => b.who !== "human")).toHaveLength(3);
    for (const b of body.bets) expect(Date.parse(b.sealedAt)).toBeLessThan(Date.parse(body.run.startedAt));
  }, 30000);

  it("a server built without modelBets asks no model and says so", async () => {
    const app = createApp();
    const post = (p: string, b: unknown) => app.request(p, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "off" }, body: JSON.stringify(b) });
    const target = await (await post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).json();
    const created = (await (await post("/experiments", { id: "e1", target, params: S3 })).json()) as { model: { status: string; reason: string } };
    expect(created.model).toMatchObject({ status: "off", reason: "this server asks no Meta model for bets" });
  });
});
