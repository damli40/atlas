// R16 (final review 2, B2 and M6): one invite code shared by several judges.
// - "The person" for questions about a part, Muse Wonder's pick and the track record is the code AND the page's browser id
//   (x-atlas-browser), so one judge's question never reaches another judge's lock, bettor text or record (D19).
// - Without a browser id (the Muse Code plugin) the person is the code alone, as before.
// - Money and the code's limits stay per code; the "at once" refusal now says it is the code's limit, not "the model call failed".
// - ATLAS_DEV_SANDBOXES_AT_ONCE sets how many sandboxes all codes together may hold (default 3; fly.toml 6).
// Built from the reviewer's probe (final2/parity/shared-code.test.ts). Every model is mocked ($0).
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAs } from "../../server/access/context";
import { allowedC, makeApp, mockModels, RETRY_SRC } from "../tools/paste-fixtures";
import { ASK_TASK, runAsk } from "../../server/meta/roles/part-talk";
import { runNamer } from "../../server/meta/roles/namer";
import { runSummarizer } from "../../server/meta/roles/summarizer";
import { createModelBudget } from "../../server/meta/budget";
import { failedCallReason, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { openInviteStore } from "../../server/access/store";
import { openLedger } from "../../server/access/ledger";
import { accessFromEnv } from "../../server/access/setup";
import { SUMMARY_WORDS } from "../../src/file-summary";
import { TRACK_WORDS } from "../../src/track-record";
import { REMEMBER_WORDS } from "../../src/part-talk";

const JUDGES = { kind: "invite" as const, id: "inv_judges", label: "judges", role: "dev" as never, route: "x" };
const JUDGE_WORDS = "It waits longer each try (JUDGE-A-WORDS).";

function judge(app: ReturnType<typeof makeApp>["app"], browser: string | null) {
  let s: string | null = null;
  const call = (method: "GET" | "POST", p: string, b?: unknown) =>
    runAs({ ...JUDGES }, async () => {
      const h: Record<string, string> = { "content-type": "application/json" };
      if (browser) h["x-atlas-browser"] = browser;
      if (s) h["x-atlas-session"] = s;
      const res = await app.request(p, { method, headers: h, ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
      s ??= res.headers.get("x-atlas-session");
      return { status: res.status, json: (await res.json()) as any };
    });
  return { post: (p: string, b: unknown) => call("POST", p, b), get: (p: string) => call("GET", p) };
}

function sharedCodeApp() {
  const base = mockModels();
  const asked: string[] = [];
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    const all = a.messages.map((m) => m.content).join("\n");
    if (all.includes(ASK_TASK)) {
      asked.push(all);
      return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.001 }, content: JSON.stringify({ answer: JUDGE_WORDS }) };
    }
    return base.chat(a);
  };
  const budget = createModelBudget({ spendCeilingUsd: 5 });
  return { ...makeApp({ modelBets: { chat, budget, sparkOpen: { available: true } }, paste: { proposer: { chat } } }), asked };
}

async function openRound(j: ReturnType<typeof judge>, params: unknown = allowedC) {
  const p = await j.post("/paste", { code: RETRY_SRC });
  const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
  const e = await j.post("/experiments", { target: t, params });
  expect(e.status).toBe(200);
  return { t, id: e.json.experiment.id as string, e };
}
const lock = (j: ReturnType<typeof judge>, id: string) => j.post("/bets", { experimentId: id, who: "human", measures: "outcome", answer: { kind: "enum", value: "threw" } });
const nextParams = { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 2 }, { kind: "json", value: 100 }] };

describe("R16 (B2, D19): two judges on one shared code are two people", () => {
  it("judge A's question never closes judge B's bet, never reaches B's bettor text; A's own next round carries it", async () => {
    const { app } = sharedCodeApp();
    const A = judge(app, "judge-a-browser-aaaaaaaa");
    const B = judge(app, "judge-b-browser-bbbbbbbb");
    const b1 = await openRound(B);
    const a1 = await openRound(A);
    expect((await lock(A, a1.id)).status).toBe(200);
    const ask = await A.post("/paste/ask", { experimentId: a1.id, part: "retryWithBackoff", question: "Why wait?" });
    expect(ask.json).toMatchObject({ ok: true, answer: JUDGE_WORDS });
    // Before R16: 409 "you asked Muse Wonder about this file after this round's question was written".
    const lb = await lock(B, b1.id);
    expect(lb.status, JSON.stringify(lb.json)).toBe(200);
    // B's next round: the AIs are not told "The person's page showed these same words" about A's question.
    const b2 = await B.post("/experiments", { target: b1.t, params: nextParams });
    expect(String(b2.json.seenContext)).not.toContain("JUDGE-A-WORDS");
    expect(String(b2.json.seenContext)).not.toContain("Earlier, after locking");
    // A's next round does carry A's own answer to every AI bettor (D19 holds for A).
    const a2 = await A.post("/experiments", { target: a1.t, params: nextParams });
    expect(String(a2.json.seenContext)).toContain("JUDGE-A-WORDS");
    // And A, who asked after A's own round was written, is still refused on that round.
    const a3 = await openRound(A, { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 4 }, { kind: "json", value: 100 }] });
    expect((await lock(A, a3.id)).status).toBe(200);
    await A.post("/paste/ask", { experimentId: a3.id, part: "retryWithBackoff", question: "And now?" });
    const a4 = await openRound(A, { ...allowedC, args: [allowedC.args[0], { kind: "json", value: 5 }, { kind: "json", value: 100 }] });
    await A.post("/paste/ask", { experimentId: a3.id, part: "retryWithBackoff", question: "Once more?" });
    expect((await lock(A, a4.id)).status).toBe(409);
  }, 60_000);

  it("the 5-asks-per-part cap is per judge, not per code", async () => {
    const { app } = sharedCodeApp();
    const A = judge(app, "judge-a-browser-aaaaaaaa");
    const B = judge(app, "judge-b-browser-bbbbbbbb");
    const a = await openRound(A);
    await lock(A, a.id);
    let full = false;
    for (let i = 0; i < 8 && !full; i++) full = Boolean((await A.post("/paste/ask", { experimentId: a.id, part: "retryWithBackoff", question: `Question ${i}?` })).json.full);
    expect(full).toBe(true);
    const b = await openRound(B);
    await lock(B, b.id);
    const bAsk = await B.post("/paste/ask", { experimentId: b.id, part: "retryWithBackoff", question: "Why wait?" });
    expect(bAsk.json).toMatchObject({ ok: true });
  }, 60_000);

  it("each judge's track record is their own; the record page says so", async () => {
    const { app } = sharedCodeApp();
    const A = judge(app, "judge-a-browser-aaaaaaaa");
    const B = judge(app, "judge-b-browser-bbbbbbbb");
    const a = await openRound(A);
    await lock(A, a.id);
    const run = await A.post("/runs", { experimentId: a.id });
    expect(run.status).toBe(200);
    const ra = await A.get("/track-record");
    const rb = await B.get("/track-record");
    expect(ra.json).toMatchObject({ person: "invite" });
    expect(ra.json.record.counted).toBeGreaterThan(0);
    expect(rb.json).toMatchObject({ person: "invite", record: { counted: 0 } });
    expect(TRACK_WORDS.whoInvite).toContain("in this browser");
    expect(REMEMBER_WORDS.whereInvite).toContain("in this browser");
  }, 60_000);

  it("without a browser id (the Muse Code plugin) the person is the code alone, as before R16", async () => {
    const { app } = sharedCodeApp();
    const P1 = judge(app, null);
    const P2 = judge(app, null);
    const a = await openRound(P1);
    await lock(P1, a.id);
    await P1.post("/runs", { experimentId: a.id });
    expect((await P2.get("/track-record")).json.record.counted).toBe((await P1.get("/track-record")).json.record.counted);
    // ...and a page on the same code is a different person from the plugin.
    expect((await judge(app, "judge-c-browser-cccccccc").get("/track-record")).json.record.counted).toBe(0);
  }, 60_000);
});

describe("R16 (B2): the code's \"at once\" limit says so", () => {
  const ledgerRefusal = "call limit reached: this invite already has 4 spends running at once (its limit is 4); try again when one finishes";
  const refused = async (): Promise<ChatResult> => ({ ok: false, reason: ledgerRefusal });
  it("names, summary and answers name the limit; any other failure stays \"the model call failed\"", async () => {
    expect(failedCallReason(ledgerRefusal)).toBe('this invite code is at its "at once" limit (4 model calls and sandboxes already running on it, its limit is 4; everyone using the code counts); try again when one finishes');
    expect(failedCallReason("no Meta API key: set META_API_KEY")).toBe("the model call failed");
    const names = await runNamer({ source: RETRY_SRC, language: "ts", parts: [{ name: "retryWithBackoff", kind: "function", lineStart: 2, lineEnd: 12 }] as never }, { chat: refused });
    expect(names).toMatchObject({ ok: false, reason: expect.stringContaining('"at once" limit') });
    const summary = await runSummarizer({ source: RETRY_SRC, language: "ts", parts: [{ name: "retryWithBackoff", kind: "function", lineStart: 2, lineEnd: 12 }] as never }, { chat: refused });
    expect(summary).toMatchObject({ ok: false, reason: expect.stringContaining('"at once" limit') });
    const answer = await runAsk({ source: RETRY_SRC, language: "ts", part: { name: "retryWithBackoff", lineStart: 2, lineEnd: 12 }, question: "Why?" }, { chat: refused });
    expect(answer).toMatchObject({ ok: false, reason: expect.stringContaining('"at once" limit') });
    expect(SUMMARY_WORDS.atOnce(failedCallReason(ledgerRefusal))).toMatch(/^No summary this time: Meta's AI wasn't asked: this invite code is at its "at once" limit/);
  });
  it("the real ledger's refusal is the sentence the roles recognise (two pastes at once on a code with the default 4)", () => {
    const dir = mkdtempSync(join(tmpdir(), "r16-ledger-"));
    const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: "p".repeat(64), ATLAS_INVITE_SECRET: "s".repeat(64) } as never });
    const { invite } = store.create({ label: "judges", dailyUsd: 10 });
    const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    const held = [];
    for (let i = 0; i < 4; i++) held.push(runAs({ ...JUDGES, id: invite.id }, () => ledger.reserve({ kind: "model", usd: 0.01, what: "names" })));
    expect(held.every((h) => h.ok)).toBe(true);
    const fifth = runAs({ ...JUDGES, id: invite.id }, () => ledger.reserve({ kind: "model", usd: 0.01, what: "summary" }));
    expect(fifth.ok).toBe(false);
    expect(failedCallReason((fifth as { reason: string }).reason)).toContain('"at once" limit (4 model calls and sandboxes already running on it, its limit is 4');
  });
});

describe("R16 (M6): ATLAS_DEV_SANDBOXES_AT_ONCE", () => {
  const env = (extra: Record<string, string>) => ({ ATLAS_INVITE_PEPPER: "p".repeat(64), ATLAS_INVITE_SECRET: "s".repeat(64), ...extra });
  const sandboxesFor = (n: number, value?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "r16-dev-"));
    const access = accessFromEnv(env({ ATLAS_INVITES_DIR: dir, ...(value !== undefined ? { ATLAS_DEV_SANDBOXES_AT_ONCE: value } : {}) }), { ceilingUsd: 100, modelSpentUsd: () => 0 });
    const codes = Array.from({ length: n }, (_, i) => access.store.create({ label: `dev${i}`, dailyUsd: 10, maxConcurrent: 20 }).invite);
    // Each code starts 2 sandboxes (its own fixed limit); count how many start in all.
    let started = 0;
    for (const inv of codes) for (let k = 0; k < 2; k++) if (runAs({ ...JUDGES, id: inv.id }, () => access.ledger.reserve({ kind: "sandbox", usd: 0.0001, what: "sandbox" })).ok) started++;
    access.release();
    return started;
  };
  it("default 3 for all codes together; 6 when set (fly.toml); one code still holds at most 2", () => {
    expect(sandboxesFor(4)).toBe(3);
    expect(sandboxesFor(4, "6")).toBe(6);
    expect(sandboxesFor(1, "6")).toBe(2);
    expect(sandboxesFor(4, "not a number")).toBe(3);
  });
});
