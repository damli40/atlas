// G1 (D33, D34): invite codes, per-code budgets, the owner reserve, the spend ledger on disk.
// Every model is mocked (no network, no key, $0). The gate, the ledger, the budget, the sandbox (local), the judge and
// the seals are real. Each test makes its own store in a temp folder; no real invite code exists anywhere here.

import { mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import { costUsd, createMetaClient, type ChatArgs, type ChatResult } from "../../server/meta/client";
import { createReplayGate, createRunGate } from "../../server/replay-limits";
import { runAs, type Principal } from "../../server/access/context";
import { INVITE_COOKIE, INVITE_HEADER, NEEDS_INVITE, OPEN_ROUTES, isOpenRoute, requireInviteFromEnv, withInviteGate } from "../../server/access/gate";
import { MODAL_USD_PER_SECOND_AT_CAPS, modalWorstCaseUsd, openLedger, type Ledger } from "../../server/access/ledger";
import { meteredExecutor, meteredGate } from "../../server/access/metered";
import { accessFromEnv } from "../../server/access/setup";
import { hashCode, openInviteStore, type InviteStore } from "../../server/access/store";
import { localExecutor } from "../../runners/executor/local";
import type { Executor } from "../../runners/runner";
import { SPARK_OPEN_MODEL } from "../../src/claimants";
import type { Experiment, Run } from "../../src/types";
import { main as invitesCli } from "../../tools/invites";
import { RETRY_SRC, SPARK_ANSWER, WONDER_ANSWER, allowedA } from "../tools/paste-fixtures";
import { PR } from "../tools/review-fixtures";

import { ENV, build, client, logLines, pastedRound, sum, tmp } from "../tools/g1-fixtures";

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The spending routes, each with a request that would spend if it reached the app. Every route the app registers
 * must be either here or in the gate's open list (checked below), so a new route cannot slip past this test.
 */
const SPENDING: { method: string; route: string; path: string; body?: unknown; spends: string }[] = [
  { method: "POST", route: "/targets", path: "/targets", body: { kind: "github-pr", ref: PR.target.ref }, spends: "a GitHub read (rate limit, no $)" },
  { method: "POST", route: "/experiments", path: "/experiments", body: {}, spends: "Muse Spark / Muse Spark Open bets (Meta, Baseten); chain-facts RPC read" },
  { method: "POST", route: "/investigate", path: "/investigate", body: { pr: PR.target.ref }, spends: "Muse Wonder Investigator (Meta)" },
  { method: "POST", route: "/findings", path: "/findings", body: {}, spends: "nothing (closed by default)" },
  { method: "POST", route: "/experiments/:id/model-bets", path: "/experiments/x/model-bets", spends: "nothing (waits for bets already asked)" },
  { method: "POST", route: "/bets", path: "/bets", body: {}, spends: "nothing (closed by default)" },
  { method: "POST", route: "/runs", path: "/runs", body: {}, spends: "a sandbox (Modal) or an EVM fork (RPC)" },
  { method: "POST", route: "/sweeps", path: "/sweeps", body: {}, spends: "a sandbox" },
  { method: "POST", route: "/changes", path: "/changes", body: {}, spends: "Muse Code / fixer chat (Meta) + a replay (sandbox or EVM fork)" },
  { method: "POST", route: "/adversary", path: "/adversary", body: {}, spends: "Adversary (Meta) + model bets + a run" },
  { method: "GET", route: "/replay/:runId", path: "/replay/x", spends: "a re-run from a proof card (sandbox or EVM fork)" },
  { method: "POST", route: "/paste", path: "/paste", body: { code: RETRY_SRC }, spends: "nothing itself (holds the code for later spends)" },
  { method: "POST", route: "/paste/proposals", path: "/paste/proposals", body: {}, spends: "Muse Wonder test proposals (Meta)" },
  { method: "POST", route: "/paste/claim", path: "/paste/claim", body: {}, spends: "nothing (shows a held claim)" },
  { method: "POST", route: "/outline/jobs", path: "/outline/jobs", body: { files: [{ path: "a.ts", text: "export const a = 1;\n" }] }, spends: "Muse Wonder Outliner (Meta) + GitHub reads" },
];

describe("G1 gate: every spending route refuses without a code, and nothing is spent", () => {
  it("covers every route the app registers: each is open (read only) or in the spending table", () => {
    const { inner } = build();
    const routes = [...new Set(inner.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`))];
    const spending = new Set(SPENDING.map((s) => `${s.method} ${s.route}`));
    const unaccounted = routes.filter((r) => {
      const [m, p] = r.split(" ") as [string, string];
      const sample = p.replace(/:[A-Za-z]+/g, "x");
      return !spending.has(r) && !isOpenRoute(m, sample);
    });
    expect(unaccounted).toEqual([]);
    // And every open route really is one of the read-only ones listed in the gate.
    const open = routes.filter((r) => !spending.has(r));
    expect(open.sort()).toEqual(["GET /claimants", "GET /events/:sessionId", "GET /health", "GET /outline/jobs/:id", "GET /outline/jobs/:id/atlas", "GET /outline/jobs/:id/outline", "GET /outline/jobs/:id/parts/:partId", "GET /paste/languages", "GET /proofs/:runId"]);
    expect(OPEN_ROUTES.every((r) => r.method === "GET" || /invite/.test(r.path.source))).toBe(true);
  });

  it("no code: 401 with the plain message on every spending route (also HEAD, an unknown route and a made-up code); not one model call, sandbox or fork", async () => {
    const s = build();
    // A real finished round first (with a code), so the run-based routes have a real run id to aim at.
    const withCode = client(s.app, s.codes.dev);
    const round = await pastedRound(withCode);
    expect(round.r.status).toBe(200);
    const runId = round.r.json.run.id as string;
    const before = { calls: s.spent.calls.length, execs: s.spent.execs, evm: s.spent.evm, log: logLines(s.dir).length, today: s.ledger.today(s.ids.dev) };

    const anon = client(s.app, undefined, withCode.session()!); // even with the owner's session id
    const bogus = client(s.app, "atlas_" + "A".repeat(32), withCode.session()!);
    const reqs = [
      ...SPENDING.map((r) => ({ method: r.method, path: r.path.replace("/replay/x", `/replay/${runId}`), body: r.path === "/changes" || r.path === "/adversary" ? { runId } : r.body })),
      { method: "HEAD", path: `/replay/${runId}`, body: undefined },
      { method: "POST", path: "/a-route-added-later", body: {} },
      { method: "GET", path: "/health/", body: undefined },
    ];
    for (const who of [anon, bogus]) {
      for (const r of reqs) {
        const res = await who.raw(r.method, r.path, r.body);
        expect(res.status, `${r.method} ${r.path}`).toBe(401);
        if (r.method !== "HEAD") expect(String(res.json.error)).toContain(NEEDS_INVITE);
      }
    }
    expect((await bogus.post("/paste", { code: RETRY_SRC })).json.error).toMatch(/not one Atlas knows/);
    expect({ calls: s.spent.calls.length, execs: s.spent.execs, evm: s.spent.evm, log: logLines(s.dir).length, today: s.ledger.today(s.ids.dev) }).toEqual(before);
  }, 60_000);

  it("the read-only routes stay open without a code: health, claimants, languages, a public proof card, the invite page", async () => {
    const s = build();
    const withCode = client(s.app, s.codes.dev);
    const round = await pastedRound(withCode);
    const anon = client(s.app);
    expect((await anon.get("/health")).status).toBe(200);
    expect((await anon.get("/claimants")).status).toBe(200);
    expect((await anon.get("/paste/languages")).status).toBe(200);
    const card = await anon.get(`/proofs/${round.r.json.run.id}`);
    expect(card.status).toBe(200);
    expect(card.json.target.source).toBeUndefined(); // a stranger's view of a pasted card has no code (E3)
    expect((await anon.get("/invite")).status).toBe(200);
    expect((await anon.get("/invite/status")).json).toEqual({ required: true, signedIn: false });
  }, 60_000);

  it("ATLAS_REQUIRE_INVITE: only '1' turns it on; a typo stops the server instead of meaning 'off'", () => {
    expect(requireInviteFromEnv({})).toBe(false);
    expect(requireInviteFromEnv({ ATLAS_REQUIRE_INVITE: "0" })).toBe(false);
    expect(requireInviteFromEnv({ ATLAS_REQUIRE_INVITE: "1" })).toBe(true);
    for (const bad of ["true", "yes", "", " on"]) expect(() => requireInviteFromEnv({ ATLAS_REQUIRE_INVITE: bad })).toThrow(/must be "1"/);
  });

  it("required but no code set up: the server refuses to start (no pepper; then no active code)", () => {
    const dir = tmp();
    const O = { ATLAS_PUBLIC_ORIGIN: "https://atlas.example" };
    expect(() => accessFromEnv({ ATLAS_REQUIRE_INVITE: "1", ATLAS_INVITES_DIR: dir }, { ceilingUsd: 100, modelSpentUsd: () => 0 })).toThrow(/needs ATLAS_PUBLIC_ORIGIN/);
    expect(() => accessFromEnv({ ATLAS_REQUIRE_INVITE: "1", ATLAS_INVITES_DIR: dir, ...O }, { ceilingUsd: 100, modelSpentUsd: () => 0 })).toThrow(/no invite pepper/);
    expect(() => accessFromEnv({ ATLAS_REQUIRE_INVITE: "1", ATLAS_INVITES_DIR: dir, ...ENV, ...O }, { ceilingUsd: 100, modelSpentUsd: () => 0 })).toThrow(/no invite code is active/);
    openInviteStore(dir, { env: ENV }).create({ label: "dev-ada" });
    const a = accessFromEnv({ ATLAS_REQUIRE_INVITE: "1", ATLAS_INVITES_DIR: dir, ...ENV, ...O }, { ceilingUsd: 100, modelSpentUsd: () => 0 });
    expect(a.require).toBe(true);
    expect(a.secureCookie).toBe(true); // review m4: an https public origin always makes the cookie Secure
    expect(a.notes[0]).toMatch(/invite codes required: 1 active/);
    a.release();
    const b = accessFromEnv({ ATLAS_EXECUTOR: "modal", ATLAS_INVITES_DIR: tmp() }, { ceilingUsd: 100, modelSpentUsd: () => 0 });
    expect(b.notes[0]).toMatch(/anyone who can reach this server can spend/);
    b.release();
    expect(() => accessFromEnv({ ATLAS_PUBLIC_ORIGIN: "https://atlas.example/app", ATLAS_INVITES_DIR: tmp() }, { ceilingUsd: 100, modelSpentUsd: () => 0 })).toThrow(/origin only/);
  });
});

describe("G1 invite page and cookie", () => {
  it("POST /invite sets an HttpOnly, SameSite=Strict cookie; the cookie then opens the spending routes; forget clears it", async () => {
    const s = build();
    const page = await s.app.request("/invite", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: `code=${encodeURIComponent(s.codes.dev)}` });
    expect(page.status).toBe(200);
    const cookie = page.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${INVITE_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(await page.text()).toContain("dev-ada");
    const jar = cookie.split(";")[0]!;
    const res = await s.app.request("/paste", { method: "POST", headers: { "content-type": "application/json", cookie: jar, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ code: RETRY_SRC }) });
    expect(res.status).toBe(200);
    const status = await (await s.app.request("/invite/status", { headers: { cookie: jar } })).json();
    expect(status).toMatchObject({ signedIn: true, label: "dev-ada", role: "dev", dailyUsd: 3 });
    const forget = await s.app.request("/invite/forget", { method: "POST", headers: { cookie: jar, "sec-fetch-site": "same-origin" } });
    expect(forget.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("a wrong code: 401 and no cookie; after 30 wrong tries from one address, wrong codes get 429, and a correct code still works (review M4)", async () => {
    const s = build();
    const H = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
    const bad = await s.app.request("/invite", { method: "POST", headers: H, body: JSON.stringify({ code: "atlas_" + "B".repeat(32) }) });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    for (let i = 0; i < 30; i++) await s.app.request("/invite", { method: "POST", headers: H, body: JSON.stringify({ code: "nope" }) });
    const locked = await s.app.request("/invite", { method: "POST", headers: H, body: JSON.stringify({ code: "atlas_" + "D".repeat(32) }) });
    expect(locked.status).toBe(429);
    const good = await s.app.request("/invite", { method: "POST", headers: H, body: JSON.stringify({ code: s.codes.owner }) });
    expect(good.status).toBe(200);
  });
});

describe("G1 per-code budgets (D34)", () => {
  it("a whole pasted round on a $3 dev code: spends are reserved, settled from the reported usage, and logged by label, never by code", async () => {
    const s = build();
    const c = client(s.app, s.codes.dev);
    const round = await pastedRound(c);
    expect(round.r.status).toBe(200);
    expect(round.e.json.models.map((m: { status: string }) => m.status)).toEqual(["thinking", "thinking"]);
    // 1 Wonder call + 2 bet calls (Spark, Spark Open), each $0.0164 as the mock reports.
    expect(s.spent.calls).toHaveLength(3);
    const today = s.ledger.today(s.ids.dev);
    expect(today.spentUsd).toBeCloseTo(3 * 0.0164, 6);
    expect(today.heldUsd).toBe(0);
    expect(today.running).toBe(0);
    const lines = logLines(s.dir);
    const model = lines.filter((l) => l.kind === "model");
    expect(model.map((l) => l.route).sort()).toEqual(["POST /experiments", "POST /experiments", "POST /paste/proposals"]);
    // Each call held its worst case (Spark about $1, Spark Open about $0.20: Baseten's price) and settled at the reported $0.0164.
    expect(model.map((l) => [l.invite, l.inviteId, l.usd, l.reservedUsd > 0.15])).toEqual(model.map(() => ["dev-ada", s.ids.dev, 0.0164, true]));
    expect(lines.some((l) => l.kind === "sandbox" && l.route === "POST /runs")).toBe(true);
    for (const f of ["spend-log.jsonl", "spend.json", "invites.json"]) {
      const text = readFileSync(join(s.dir, f), "utf8");
      for (const code of Object.values(s.codes)) expect(text).not.toContain(code);
      expect(statSync(join(s.dir, f)).mode & 0o077).toBe(0);
    }
  }, 60_000);

  it("a code past its daily budget is refused BEFORE the call: 'not asked: your invite's daily budget is used up'; the person's own bet and run still work at $0", async () => {
    const s = build({ devDaily: 0.5 }); // less than one call's worst case
    const c = client(s.app, s.codes.dev);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const props = await c.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
    expect(props.json.ok).toBe(false);
    expect(props.json.reason).toMatch(/your invite's daily budget is used up/);
    const e = await c.post("/experiments", { target, params: allowedA }, { "x-atlas-claimant": "both" });
    expect(e.json.models.map((m: { status: string; reason: string }) => [m.status, m.reason.slice(0, 41)])).toEqual([
      ["off", "your invite's daily budget is used up (sp"],
      ["off", "your invite's daily budget is used up (sp"],
    ]);
    expect(s.spent.calls).toHaveLength(0); // nothing was sent
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(r.status).toBe(200); // local sandbox ($0), plain-code judge ($0)
    expect(r.json.verdicts.map((v: { outcome: string }) => v.outcome)).toEqual(["matched"]);
  }, 60_000);

  it("on Modal, a used-up code's run is not started either: 'the run did not finish' with the budget reason, nothing judged", async () => {
    const s = build({ modal: true, devDaily: 0.001 }); // less than one sandbox's worst case ($0.0074 for a 10 s run)
    const c = client(s.app, s.codes.dev);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const e = await c.post("/experiments", { target, params: allowedA });
    await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
    const r = await c.post("/runs", { experimentId: e.json.experiment.id });
    expect(r.status).toBe(503);
    expect(r.json.error).toMatch(/the run did not finish: .*your invite's daily budget is used up/);
    expect(r.json).not.toHaveProperty("verdicts");
    expect(s.spent.execs).toBe(0);
  }, 60_000);

  it("Modal sandbox cost: the worst case is reserved first (Modal's own lifetime limit at the capped rate) and the measured seconds are settled", async () => {
    const s = build({ modal: true });
    const c = client(s.app, s.codes.owner);
    const round = await pastedRound(c);
    expect(round.r.status).toBe(200);
    const sandboxes = logLines(s.dir).filter((l) => l.kind === "sandbox");
    expect(sandboxes.length).toBeGreaterThanOrEqual(2); // the control, then the run
    for (const l of sandboxes) {
      expect(l.reservedUsd).toBeGreaterThanOrEqual(modalWorstCaseUsd(1));
      expect(l.usd).toBeLessThan(l.reservedUsd);
      expect(l.usd).toBeGreaterThan(0);
    }
    expect(s.ledger.modalToday().starts).toBe(sandboxes.length);
    expect(MODAL_USD_PER_SECOND_AT_CAPS).toBeCloseTo(0.00004609, 10);
  }, 60_000);

  it("the owner reserve: with $79.50 of the $100 ceiling spent, dev codes are refused and the owner's code is not", async () => {
    const s = build({ spentAtStart: 79.5 });
    const dev = client(s.app, s.codes.dev);
    const p = await dev.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const refused = await dev.post("/paste/proposals", { target, exportName: "retryWithBackoff" });
    expect(refused.json.reason).toMatch(/the money shared by invited developers is used up \(\$79\.50 of \$80\.00; the last \$20\.00 of the \$100\.00 ceiling is kept for the owner\)/);
    expect(s.spent.calls).toHaveLength(0);
    const owner = client(s.app, s.codes.owner);
    const p2 = await owner.post("/paste", { code: RETRY_SRC });
    const ok = await owner.post("/paste/proposals", { target: { ref: p2.json.target.ref, codeSha256: p2.json.target.codeSha256 }, exportName: "retryWithBackoff" });
    expect(ok.json.ok).toBe(true);
    expect(s.spent.calls).toHaveLength(1);
  });

  it("the owner reserve holds against many dev codes at once: devs together never pass ceiling minus reserve", async () => {
    // $5 ceiling, $2 reserve: devs share $3. Each dev call holds about $0.96 and really costs $0.90.
    const s = build({ ceiling: 5, ownerReserve: 2, usd: 0.9, slowMs: 20 });
    const store2 = openInviteStore(s.dir, { env: ENV });
    const devs = Array.from({ length: 6 }, (_, i) => store2.create({ label: `dev-${i}`, dailyUsd: 3 }));
    const wrapped = s.budget.wrap(async (a) => (s.spent.calls.push(a), new Promise<ChatResult>((r) => setTimeout(() => r({ ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.9 } }), 20))));
    const ask = (id: string, label: string) => runAs({ kind: "invite", id, label, role: "dev", route: "test" }, () => wrapped({ role: "claimant", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }] }));
    const results = await Promise.all(devs.flatMap((d) => [ask(d.invite.id, d.invite.label), ask(d.invite.id, d.invite.label)]));
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(3); // 3 × $0.96 held fits in $3; a 4th would not
    expect(s.budget.spentUsd()).toBeCloseTo(2.7, 6);
    expect(s.budget.spentUsd()).toBeLessThanOrEqual(3);
    // The owner can still spend the reserve.
    const owner = await runAs({ kind: "invite", id: s.ids.owner, label: "dami", role: "owner", route: "test" }, () => wrapped({ role: "claimant", model: "muse-spark-1.3", messages: [{ role: "user", content: "x" }] }));
    expect(owner.ok).toBe(true);
  });

  it("race: 20 requests at once on one $3 code can't overshoot; the 'at once' limit holds too", async () => {
    const s = build({ usd: 0.9, slowMs: 30 });
    const results = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const c = client(s.app, s.codes.dev, `race-${i}`);
        const p = await c.post("/paste", { code: RETRY_SRC });
        return c.post("/paste/proposals", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, exportName: "retryWithBackoff" });
      }),
    );
    const asked = results.filter((r) => r.json.ok === true).length;
    expect(s.spent.calls.length).toBe(asked);
    expect(asked).toBeLessThanOrEqual(3); // each holds ~$1.00 of the $3
    expect(asked).toBeGreaterThanOrEqual(1);
    expect(s.ledger.today(s.ids.dev).spentUsd).toBeLessThanOrEqual(3);
    for (const r of results.filter((x) => x.json.ok !== true)) expect(r.json.reason).toMatch(/your invite's daily budget is used up|call limit reached: this invite already has/);

    const t = build({ usd: 0.01, slowMs: 50, devMaxConcurrent: 2, devDaily: 100 });
    const wrapped = t.budget.wrap(async (a) => (t.spent.calls.push(a), new Promise<ChatResult>((r) => setTimeout(() => r({ ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.01 } }), 50))));
    const me: Principal = { kind: "invite", id: t.ids.dev, label: "dev-ada", role: "dev", route: "test" };
    const many = await Promise.all(Array.from({ length: 5 }, () => runAs(me, () => wrapped({ role: "claimant", model: "muse-spark-1.3", messages: [] }))));
    expect(many.filter((r) => r.ok)).toHaveLength(2);
    expect(many.filter((r) => !r.ok).every((r) => !r.ok && /this invite already has 2 spends running at once/.test(r.reason))).toBe(true);
  }, 60_000);

  it("a lifetime total (--total-usd) is a hard stop too", async () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const inv = store.create({ label: "dev-t", totalUsd: 1.5 }).invite;
    const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    const me: Principal = { kind: "invite", id: inv.id, label: inv.label, role: "dev", route: "test" };
    const a = runAs(me, () => ledger.reserve({ kind: "model", usd: 1, what: "x" }));
    expect(a.ok).toBe(true);
    if (a.ok) a.settle(1);
    const b = runAs(me, () => ledger.reserve({ kind: "model", usd: 1, what: "x" }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toMatch(/your invite's total budget is used up/);
  });
});

describe("G1 counters survive a restart (the old daily caps lived in memory)", () => {
  it("per code per day, the global totals and Modal's daily sandbox counters are read back from disk", async () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const inv = store.create({ label: "dev-r" }).invite;
    const me: Principal = { kind: "invite", id: inv.id, label: inv.label, role: "dev", route: "test" };
    const open = () => openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0, modalStartsPerDay: 2 });
    const one = open();
    const m = runAs(me, () => one.reserve({ kind: "model", usd: 1, what: "muse-spark-1.3" }));
    if (m.ok) m.settle(2.5); // the real cost was more than the hold
    for (let i = 0; i < 2; i++) {
      const sb = runAs(me, () => one.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
      expect(sb.ok).toBe(true);
      if (sb.ok) sb.settle(0.0002, { seconds: 4 });
    }
    // "Restart": a new ledger on the same folder.
    const two = open();
    expect(two.today(inv.id).spentUsd).toBeCloseTo(2.5 + 0.0004, 9);
    expect(two.modalToday()).toMatchObject({ starts: 2, seconds: 8 });
    const again = runAs(me, () => two.reserve({ kind: "model", usd: 0.96, what: "muse-spark-1.3" }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/your invite's daily budget is used up \(spend limit reached: \$2\.50 spent/);
    const sb3 = runAs({ kind: "system", label: "warm-up", route: "startup" }, () => two.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
    expect(sb3.ok).toBe(false);
    if (!sb3.ok) expect(sb3.reason).toMatch(/daily sandbox budget is used up \(2 of 2 sandboxes/);
    expect(two.modelUsdAllTime()).toBeCloseTo(2.5, 9);
  });

  it("a spend still open when the server stopped is counted at its worst case after the restart", () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const inv = store.create({ label: "dev-c" }).invite;
    const me: Principal = { kind: "invite", id: inv.id, label: inv.label, role: "dev", route: "POST /experiments" };
    const one = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    const held = runAs(me, () => one.reserve({ kind: "model", usd: 1.25, what: "muse-spark-1.3" }));
    expect(held.ok).toBe(true); // ...and the process dies before settle()
    const two = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    expect(two.today(inv.id)).toMatchObject({ spentUsd: 1.25, heldUsd: 0, running: 0 });
    expect(logLines(dir).at(-1)).toMatchObject({ invite: "dev-c", usd: 1.25, note: expect.stringMatching(/server stopped before this spend finished/) });
  });
});

describe("G1 identity is the code, not the address", () => {
  it("new IPv6 /64s and X-Forwarded-For hops give a code nothing extra; without invites the old per-address rule still applies", async () => {
    const s = build({ trustProxy: true, perClientModelLimits: { modelRoundsPerHour: 1 } });
    const ask = async (code: string | undefined, xff: string, i: number) => {
      const c = client(s.app, code, `xff-${i}`, { "x-forwarded-for": xff });
      const p = await c.post("/paste", { code: RETRY_SRC });
      return c.post("/paste/proposals", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, exportName: "retryWithBackoff" });
    };
    expect((await ask(s.codes.dev, "2001:db8:1:1::5", 1)).json.ok).toBe(true);
    const second = await ask(s.codes.dev, "2001:db8:9:9::5", 2); // another /64
    expect(second.json.reason).toMatch(/call limit reached: one client address may ask for 1/);
    const third = await ask(s.codes.dev, "1.2.3.4, 9.9.9.9", 3); // a made-up first hop
    expect(third.json.ok).toBe(false);
    // A different code has its own allowance.
    expect((await ask(s.codes.dev2, "2001:db8:1:1::5", 4)).json.ok).toBe(true);
    // No code with invites required: refused outright, whatever the address.
    expect((await client(s.app, undefined, "z", { "x-forwarded-for": "2001:db8:7:7::1" }).post("/paste", { code: RETRY_SRC })).status).toBe(401);

    const open = build({ require: false, trustProxy: true, perClientModelLimits: { modelRoundsPerHour: 1 } });
    const askOpen = async (xff: string, i: number) => {
      const c = client(open.app, undefined, `o-${i}`, { "x-forwarded-for": xff });
      const p = await c.post("/paste", { code: RETRY_SRC });
      return c.post("/paste/proposals", { target: { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 }, exportName: "retryWithBackoff" });
    };
    expect((await askOpen("2001:db8:1:1::5", 1)).json.ok).toBe(true);
    expect((await askOpen("2001:db8:1:1::6", 2)).json.ok).toBe(false); // same /64
    expect((await askOpen("2001:db8:2:2::6", 3)).json.ok).toBe(true); // the old, per-address rule (a local server only)
  }, 60_000);
});

describe("G1 a revoked code stops immediately", () => {
  it("revoked with the tool (another process's store) while the server runs: the next request is 401, and a spend it had queued is refused", async () => {
    const s = build();
    const c = client(s.app, s.codes.dev);
    expect((await c.post("/paste", { code: RETRY_SRC })).status).toBe(200);
    expect(invitesCli(["revoke", "dev-ada", "--dir", s.dir], () => {}, ENV)).toBe(0);
    const after = await c.post("/paste", { code: RETRY_SRC });
    expect(after.status).toBe(401);
    expect(after.json.error).toMatch(/that invite code was revoked/);
    // A model call started earlier under that code (e.g. a background job) is refused at its next spend.
    const late = runAs({ kind: "invite", id: s.ids.dev, label: "dev-ada", role: "dev", route: "POST /outline/jobs" }, () => s.ledger.reserve({ kind: "model", usd: 1, what: "outliner" }));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toMatch(/revoked/);
    // The other codes still work.
    expect((await client(s.app, s.codes.dev2).post("/paste", { code: RETRY_SRC })).status).toBe(200);
  });
});

describe("G1 Baseten (Muse Spark Open) spend is counted", () => {
  it("a Spark Open bet through the real client: Baseten's reported usage reaches the model budget, the code's ledger and the spend log", async () => {
    const usagePath = join(tmp(), "usage.jsonl");
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ choices: [{ message: { content: SPARK_ANSWER }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 1000, prompt_tokens_details: { cached_tokens: 1000 } } }), { status: 200 });
    }) as typeof fetch;
    const real = createMetaClient({ apiKey: "meta-test-key", basetenApiKey: "baseten-test-key", fetchImpl, usagePath }).chat;
    const s = build({ chat: real });
    const c = client(s.app, s.codes.dev);
    const p = await c.post("/paste", { code: RETRY_SRC });
    const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const e = await c.post("/experiments", { target, params: allowedA }, { "x-atlas-claimant": "spark-open" });
    await c.post(`/experiments/${e.json.experiment.id}/model-bets`);
    const expected = costUsd(SPARK_OPEN_MODEL, 3000, 1000, 1000);
    expect(urls).toEqual(["https://inference.baseten.co/v1/chat/completions"]);
    expect(s.budget.spentUsd()).toBeCloseTo(expected, 12);
    expect(s.ledger.today(s.ids.dev).spentUsd).toBeCloseTo(expected, 12);
    const line = logLines(s.dir).find((l) => l.kind === "model")!;
    expect(line.what).toBe(`claimant ${SPARK_OPEN_MODEL}`);
    expect(line.usd).toBeCloseTo(expected, 12);
    expect(JSON.parse(readFileSync(usagePath, "utf8").trim())).toMatchObject({ provider: "baseten", model: SPARK_OPEN_MODEL });
  });
});

describe("G1 EVM fork runs are counted per code per day", () => {
  it("a dev code's 3rd fork run of the day is refused (429) before any fork; the owner's is not", async () => {
    const s = build({ evmRunsPerDay: 2 });
    const level2 = async (code: string, session: string) => {
      const c = client(s.app, code, session);
      const t = (await c.post("/targets", { kind: "github-pr", ref: PR.target.ref })).json;
      const f = (await c.post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).json.finding;
      const e = (await c.post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id }, { "x-atlas-claimant": "spark" })).json;
      await c.post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
      return { c, id: e.experiment.id as string };
    };
    const a = await level2(s.codes.dev, "evm-1");
    expect((await a.c.post("/runs", { experimentId: a.id })).status).toBe(503); // the fake fork throws: counted, nothing judged
    expect((await a.c.post("/runs", { experimentId: a.id })).status).toBe(503);
    const third = await a.c.post("/runs", { experimentId: a.id });
    expect(third.status).toBe(429);
    expect(third.json.error).toMatch(/your invite's daily EVM fork runs are used up \(2 of 2 today\)/);
    expect(s.spent.evm).toBe(2);
    const o = await level2(s.codes.owner, "evm-2");
    expect((await o.c.post("/runs", { experimentId: o.id })).status).toBe(503);
    expect(s.spent.evm).toBe(3);
  }, 60_000);
});

describe("G1 tools/invites.ts", () => {
  it("create shows the code once and stores only its fingerprint; list never prints a fingerprint or a code; usage sums the log by label", () => {
    const dir = tmp();
    const out: string[] = [];
    expect(invitesCli(["create", "--name", "dev-ada", "--dir", dir], (l) => out.push(l), {})).toBe(0);
    const code = out.at(-1)!;
    expect(code).toMatch(/^atlas_[A-Za-z0-9_-]{32}$/);
    expect(out[0]).toMatch(/^Made dev code inv_[0-9a-f]{10} for "dev-ada": \$3\.00 a UTC day, none in all, 4 at once\.$/);
    const stored = readFileSync(join(dir, "invites.json"), "utf8");
    expect(stored).not.toContain(code);
    const pepper = readFileSync(join(dir, "pepper"), "utf8").trim();
    expect(stored).toContain(hashCode(pepper, code));
    for (const f of ["invites.json", "pepper"]) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(openInviteStore(dir).verify(code)).toMatchObject({ ok: true, invite: { label: "dev-ada", role: "dev", dailyUsd: 3 } });

    const own: string[] = [];
    invitesCli(["create", "--name", "dami", "--owner", "--dir", dir], (l) => own.push(l), {});
    expect(own[0]).toMatch(/owner code .* none a UTC day/);
    expect(() => invitesCli(["create", "--name", "dev-ada", "--dir", dir], () => {}, {})).toThrow(/already exists/);

    const listed: string[] = [];
    invitesCli(["list", "--dir", dir], (l) => listed.push(l), {});
    expect(listed).toHaveLength(2);
    expect(listed.join("\n")).not.toContain(code);
    expect(listed.join("\n")).not.toContain(hashCode(pepper, code));

    writeFileSync(
      join(dir, "spend-log.jsonl"),
      [
        { ts: new Date().toISOString(), invite: "dev-ada", route: "POST /experiments", kind: "model", what: "claimant muse-spark-1.3", usd: 0.02 },
        { ts: new Date().toISOString(), invite: "dev-ada", route: "POST /runs", kind: "sandbox", what: "modal sandbox", usd: 0.0002 },
        { ts: new Date().toISOString(), invite: "dev-ada", route: "POST /experiments", kind: "model", what: "x", usd: 0, refused: "your invite's daily budget is used up" },
      ].map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
    const used: string[] = [];
    invitesCli(["usage", "--dir", dir], (l) => used.push(l), {});
    expect(used[1]).toMatch(/^- dev-ada \(dev, daily \$3\.00\): \$0\.0202 on .* in 2 spends, 1 refused; \$0\.0202 in all$/);

    const rev: string[] = [];
    expect(invitesCli(["revoke", "dev-ada", "--dir", dir], (l) => rev.push(l), {})).toBe(0);
    expect(openInviteStore(dir).verify(code)).toEqual({ ok: false, reason: "that invite code was revoked" });
    expect(invitesCli(["revoke", "nobody", "--dir", dir], () => {}, {})).toBe(1);
  });

  it("a pepper or store file others can read is refused", () => {
    const dir = tmp();
    invitesCli(["create", "--name", "dev-ada", "--dir", dir], () => {}, {});
    chmodSync(join(dir, "pepper"), 0o644);
    expect(() => openInviteStore(dir).verify("atlas_" + "C".repeat(32))).toThrow(/can be read by other users/);
  });
});

describe("G1 the ledger refuses a spend with no code when invites are required (defence behind the gate)", () => {
  it("a sandbox or a model call outside any invite is refused; the server's own warm-up is allowed", async () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    store.create({ label: "x" });
    const ledger: Ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    const ex = meteredExecutor({ kind: "local", exec: localExecutor.exec }, ledger);
    await expect(ex.exec({ files: { "a.mjs": "" }, cmd: ["node", "a.mjs"], wallClockMs: 1000, allowNetwork: false })).rejects.toThrow(/no invite code/);
    const budget = createModelBudget({ guard: ledger });
    let sent = 0;
    const r = await budget.wrap(async () => (sent++, { ok: true, content: "", finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0, usd: 0 } }))({ role: "claimant", model: "muse-spark-1.3", messages: [] });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no invite code/) });
    expect(sent).toBe(0);
    expect(budget.startExperiment("s").ok).toBe(false);
    const warm = await runAs({ kind: "system", label: "server warm-up (D32)", route: "startup" }, () => ex.exec({ files: { "a.mjs": "" }, cmd: ["node", "a.mjs"], wallClockMs: 5000, allowNetwork: false }));
    expect(warm.exitCode).toBe(0);
    expect(sum(logLines(dir).filter((l) => l.kind === "sandbox" && !l.refused).map((l) => l.usd))).toBe(0);
  });
});
