// The day-2 review's new limits, unit by unit: the model-call budget (S5), the session store's
// eviction rules (S4) and the refusal records (S7). chat() is mocked; nothing is written to proofs/.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createBetStore, newRound } from "../../server/bets";
import { createModelBudget, envNumber, readUsageTotal } from "../../server/meta/budget";
import type { ChatResult } from "../../server/meta/client";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import { memoryRefusalWriter, refusalFileName, scrubText, writeRefusal } from "../../server/proofs/refusals";
import { TS_GATE_CONTEXT } from "../../server/app";
import { sealBet } from "../../src/seal";
import type { Experiment } from "../../src/types";

const usage = { promptTokens: 10, completionTokens: 10, usd: 0.5 };
const ok = async (): Promise<ChatResult> => ({ ok: true, content: "{}", finishReason: "stop", usage });

describe("S5 model budget", () => {
  it("global calls per hour: the 4th call in the hour is refused; an hour later calls are allowed again", async () => {
    let t = 0;
    const b = createModelBudget({ callsPerHour: 3, now: () => t });
    const chat = b.wrap(ok);
    for (let i = 0; i < 3; i++) expect((await chat({ role: "claimant", model: "m", messages: [] })).ok).toBe(true);
    expect(await chat({ role: "claimant", model: "m", messages: [] })).toEqual({ ok: false, reason: "call limit reached" });
    expect(b.startExperiment("s").ok).toBe(false);
    t += 60 * 60 * 1000 + 1;
    expect((await chat({ role: "claimant", model: "m", messages: [] })).ok).toBe(true);
  });

  it("spend ceiling: usage.jsonl total at start plus calls since; past the ceiling nothing is asked, with a plain reason", async () => {
    const b = createModelBudget({ spendCeilingUsd: 1, spentAtStartUsd: 0.4 });
    const chat = b.wrap(ok);
    expect((await chat({ role: "claimant", model: "m", messages: [] })).ok).toBe(true); // 0.9
    expect((await chat({ role: "claimant", model: "m", messages: [] })).ok).toBe(true); // 1.4
    const refused = await chat({ role: "claimant", model: "m", messages: [] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/^spend limit reached: \$1\.40 of the \$1 ceiling is used/);
    const start = b.startExperiment("s");
    expect(start.ok).toBe(false);
  });

  it("readUsageTotal sums usd, skips unreadable lines, and a missing file is $0", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-usage-"));
    const p = join(dir, "usage.jsonl");
    writeFileSync(p, ['{"usd":0.25}', "not json", '{"usd":"1"}', '{"usd":1.5}', ""].join("\n"));
    expect(readUsageTotal(p)).toEqual({ usd: 1.75, lines: 2, skipped: 2 });
    expect(readUsageTotal(join(dir, "none.jsonl"))).toEqual({ usd: 0, lines: 0, skipped: 0 });
    expect(envNumber(undefined, 60)).toBe(60);
    expect(envNumber("abc", 60)).toBe(60);
    expect(envNumber("5", 60)).toBe(5);
  });

  it("through the server: a spent budget leaves the slot 'off' with the reason, and the person's bet and run go on", async () => {
    const budget = createModelBudget({ spendCeilingUsd: 100, spentAtStartUsd: 100 });
    let calls = 0;
    const app = createApp({ modelBets: { chat: async () => (calls++, ok()), budget } });
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "s" }, body: JSON.stringify(body) });
    const t = (await (await post("/targets", { kind: "ts-fixture", ref: FIXTURE_FILE })).json()) as { ref: string; codeSha256: string };
    const e = (await (await post("/experiments", { id: "e1", target: t, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).json()) as { model: { status: string; reason: string } };
    expect(e.model.status).toBe("off");
    expect(e.model.reason).toMatch(/^spend limit reached/);
    expect((await post("/bets", { experimentId: "e1", who: "human", measures: "calls", answer: { kind: "integer", value: 5 } })).status).toBe(200);
    expect((await post("/runs", { experimentId: "e1" })).status).toBe(200);
    expect(calls).toBe(0);
  });
});

const exp = (id: string): Experiment => ({
  id,
  target: { kind: "ts-fixture", ref: FIXTURE_FILE, codeSha256: "a".repeat(64) },
  runner: "ts",
  params: { shape: "retry-scenario", failTimes: 5, failure: "error" },
  proposedBy: { role: "human" },
  gate: { allowed: true },
});

describe("S4 session store", () => {
  it("peek never creates; open creates; the least recently USED idle session is dropped first", () => {
    const store = createBetStore({ maxSessions: 2 });
    expect(store.peek("a")).toBeUndefined();
    expect(store.size()).toBe(0);
    store.open("a");
    store.open("b");
    store.touch("a"); // a used after b: b is now the least recently used
    store.open("c");
    expect(store.peek("a")).toBeDefined();
    expect(store.peek("b")).toBeUndefined();
    expect(store.peek("c")).toBeDefined();
  });

  it("a session with sealed, unrun bets is kept for 2 hours; when all are kept a new session is refused; after 2 hours it may go", () => {
    let t = 0;
    const store = createBetStore({ maxSessions: 1, now: () => t });
    const opened = store.open("victim");
    if (!opened.ok) throw new Error("open failed");
    const round = newRound(exp("v1"), TS_GATE_CONTEXT);
    round.bets.push(sealBet({ experimentId: "v1", who: "human", question: "q", measures: "calls", answer: { kind: "integer", value: 5 } }));
    opened.rounds.set("v1", round);
    const refused = store.open("newcomer");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toMatch(/sealed bets that have not run yet/);
    expect(store.peek("victim")).toBeDefined();
    t += 2 * 60 * 60 * 1000;
    expect(store.open("newcomer").ok).toBe(true);
    expect(store.peek("victim")).toBeUndefined();
  });

  it("a session whose round already ran is not protected", () => {
    const store = createBetStore({ maxSessions: 1 });
    const opened = store.open("done");
    if (!opened.ok) throw new Error("open failed");
    const round = newRound(exp("d1"), TS_GATE_CONTEXT);
    round.bets.push(sealBet({ experimentId: "d1", who: "human", question: "q", measures: "calls", answer: { kind: "integer", value: 5 } }));
    round.status = "done";
    opened.rounds.set("d1", round);
    expect(store.open("next").ok).toBe(true);
  });
});

describe("S7 refusal records", () => {
  it("file names: date-runId-betId for a can't check, date-experimentId for a gate refusal", () => {
    expect(refusalFileName({ kind: "cant_check", id: "b1", betId: "b1", runId: "r1", time: "2026-10-28T10:00:00.000Z", role: "human", experiment: {}, reason: "x" })).toBe("2026-10-28-r1-b1.json");
    expect(refusalFileName({ kind: "gate_rejection", id: "e1", time: "2026-10-28T10:00:00.000Z", role: "human", experiment: {}, reason: "x" })).toBe("2026-10-28-e1.json");
  });

  it("scrubs local paths, URLs, long secret-looking strings and the live key; keeps a 64-hex code fingerprint", () => {
    const env = { META_API_KEY: "sekrit-value-123456" } as NodeJS.ProcessEnv;
    const text = `at /Users/admin/x.ts and C:\\a\\b via https://rpc.example/abc key sekrit-value-123456 sk-ABCDEFGHIJKLMNOPQRSTUV ${"a".repeat(64)}`; // secret-scan: allow (obviously fake values)
    const out = scrubText(text, env);
    expect(out).not.toMatch(/\/Users\/|C:\\|https:|sekrit|sk-ABC/);
    expect(out).toContain("a".repeat(64));
  });

  it("writeRefusal writes only known fields, scrubbed, into the given folder; the memory writer writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-refusals-"));
    const path = writeRefusal({ kind: "cant_check", id: "b1", betId: "b1", runId: "r1", time: "2026-10-28T10:00:00.000Z", role: "human", experiment: { resolvesWith: "/Users/me/secret.txt" }, reason: "x", secret: "nope" } as never, dir);
    expect(readdirSync(dir)).toEqual(["2026-10-28-r1-b1.json"]);
    const rec = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(rec).not.toHaveProperty("secret");
    expect(JSON.stringify(rec)).not.toMatch(/\/Users\//);
    // Never overwrites: the same name again gets "-2" (an experiment id can be chosen by the client).
    const again = writeRefusal({ kind: "cant_check", id: "b1", betId: "b1", runId: "r1", time: "2026-10-28T10:00:00.000Z", role: "human", experiment: {}, reason: "y" }, dir);
    expect(again.endsWith("2026-10-28-r1-b1-2.json")).toBe(true);
    expect((JSON.parse(readFileSync(path, "utf8")) as { reason: string }).reason).toBe("x");
    const mem = memoryRefusalWriter();
    mem({ kind: "gate_rejection", id: "e1", time: "2026-10-28T10:00:00.000Z", role: "human", experiment: {}, reason: "x" });
    expect(mem.records).toHaveLength(1);
  });
});
