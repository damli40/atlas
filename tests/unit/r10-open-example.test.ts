// R10 (D72): the open example. With ATLAS_REQUIRE_INVITE on, anyone can play the first screen's example with no invite code,
// end to end, and nothing else. Every model is a counting fake (any call fails the test), the sandbox is this machine's,
// counted. $0, no network.
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createAgentLog } from "../../server/log/agentlog";
import { createProofStore } from "../../server/evm-round";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import type { ChatArgs, ChatResult } from "../../server/meta/client";
import { createReplayGate, createRunGate, createSandboxGate } from "../../server/replay-limits";
import { runAs } from "../../server/access/context";
import { EXAMPLE_ROUTES, INVITE_HEADER, NEEDS_INVITE, isExampleRoute, isOpenRoute, waitlistUrlFromEnv, withInviteGate } from "../../server/access/gate";
import { EXAMPLE_ALREADY_PLAYED, EXAMPLE_SHA, OWN_CODE_NEEDS_INVITE, REPLAY_MISMATCH } from "../../server/access/example-lane";
import { openLedger } from "../../server/access/ledger";
import { meteredExecutor, meteredGate } from "../../server/access/metered";
import { openInviteStore } from "../../server/access/store";
import { diskTrackStore } from "../../server/track-store";
import { localExecutor } from "../../runners/executor/local";
import type { Executor } from "../../runners/runner";
import { U1_EXAMPLE } from "../../web/u1-example";
import RECORDED from "../../server/example-round.json";
import { RETRY_SRC, SPARK_ANSWER, WONDER_ANSWER } from "../tools/paste-fixtures";

const PEPPER = "test-pepper-".padEnd(48, "x");

interface Opts {
  require?: boolean;
  proposerModel?: string;
  limits?: { perIpPerHour?: number; perHour?: number };
  waitlistUrl?: string;
  exampleCopy?: boolean;
  trackDir?: string;
  exampleSandboxesAtOnce?: number;
}

/** The hosted server as server/index.ts builds it (dev copy, owner copy, open-example copy), with counting fakes. */
function build(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "atlas-r10-"));
  const store = openInviteStore(dir, { env: { ATLAS_INVITE_PEPPER: PEPPER } });
  const dev = store.create({ label: "dev-ada" });
  const owner = store.create({ label: "dami", role: "owner" });
  let budget: ModelBudget | undefined;
  const ledger = openLedger({ dir, store, requireInvite: o.require ?? true, ceilingUsd: 100, ownerReserveUsd: 20, modelSpentUsd: () => budget!.spentUsd(), ...(o.exampleSandboxesAtOnce ? { exampleSandboxesAtOnce: o.exampleSandboxesAtOnce } : {}) });
  budget = createModelBudget({ spendCeilingUsd: 100, guard: ledger, callsPerHour: 1000, experimentsPerSession: 1000 });
  const spent = { calls: [] as ChatArgs[], execs: 0 };
  const chat = async (a: ChatArgs): Promise<ChatResult> => {
    spent.calls.push(a);
    return { ok: true, finishReason: "stop", usage: { promptTokens: 10, completionTokens: 10, usd: 0.01 }, content: a.role === "investigator" ? WONDER_ANSWER : SPARK_ANSWER };
  };
  const raw: Executor = { kind: "local", exec: (r) => (spent.execs++, localExecutor.exec(r)) };
  const opts = (): Parameters<typeof createApp>[0] => ({
    agentLog: createAgentLog(),
    proofs: createProofStore({ publish: false }),
    modelBets: { chat, budget: budget!, sparkOpen: { available: true } },
    investigator: { chat, budget: budget! },
    paste: { proposer: { chat, budget: budget!, ...(o.proposerModel ? { model: o.proposerModel } : {}) } },
    fixer: { chat, budget: budget!, museExec: null },
    adversary: { chat, budget: budget! },
    outline: { outliner: { chat, budget: budget! } },
    executor: meteredExecutor(raw, ledger),
    runGate: meteredGate(createRunGate(), ledger, "EVM run", { ownerGate: createRunGate() }),
    replayGate: meteredGate(createReplayGate(), ledger, "EVM replay", { ownerGate: createReplayGate() }),
    sandboxGate: meteredGate(createSandboxGate(), ledger, "sandbox start", { ownerGate: createSandboxGate(), count: false }),
    evmRun: async () => {
      throw new Error("no fork in this test");
    },
    trustProxy: true,
    ...(o.limits ? { exampleRunLimits: o.limits } : {}),
    ...(o.trackDir ? { trackStore: diskTrackStore(o.trackDir) } : {}),
  });
  const inner = createApp(opts());
  const ownerInner = createApp(opts());
  const exampleInner = o.exampleCopy === false ? undefined : createApp(opts());
  const app = withInviteGate(inner, { store, require: o.require ?? true, ledger, secureCookie: false, trustProxy: true, ownerInner, ...(exampleInner ? { exampleInner } : {}), ...(o.waitlistUrl ? { waitlistUrl: o.waitlistUrl } : {}) });
  return { dir, app, ledger, spent, codes: { dev: dev.code, owner: owner.code } };
}

type App = ReturnType<typeof build>["app"];
function client(app: App, o: { code?: string; ip?: string; browser?: string } = {}) {
  let s: string | null = null;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? "203.0.113.7", ...(o.browser ? { "x-atlas-browser": o.browser } : {}), ...headers };
    if (o.code) h[INVITE_HEADER] = o.code;
    if (s) h["x-atlas-session"] = s;
    const res = await app.request(path, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    s ??= res.headers.get("x-atlas-session");
    const text = await res.text();
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { text };
    }
    return { status: res.status, json };
  };
  return { post: (p: string, b: unknown = {}, h?: Record<string, string>) => call("POST", p, b, h), get: (p: string, h?: Record<string, string>) => call("GET", p, undefined, h), session: () => s };
}

/** The first screen's example, the way the page plays it (web/screens/Studio.tsx), up to the open round. */
async function openRound(c: ReturnType<typeof client>, o: { names?: boolean; claimant?: string } = {}) {
  const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
  expect(p.status, JSON.stringify(p.json)).toBe(200);
  const target = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
  expect(target.codeSha256).toBe(EXAMPLE_SHA);
  expect((await c.post("/paste/labels", { target, exportName: "fetchWithRetry" })).status).toBe(200);
  if (o.names !== false) expect((await c.post("/paste/names", { target })).json.ok).toBe(true);
  expect((await c.post("/paste/summary", { target })).json.ok).toBe(true);
  expect((await c.post("/paste/proposals", { target, exportName: "fetchWithRetry", early: true })).status).toBe(200);
  const props = await c.post("/paste/proposals", { target, exportName: "fetchWithRetry" });
  expect(props.status).toBe(200);
  const allowed = (props.json.proposals as { id: string; gate: { allowed: boolean } }[]).filter((x) => x.gate.allowed);
  const e = await c.post("/experiments", { target, proposalId: allowed[0]!.id, quiz: true, one: true }, o.claimant ? { "x-atlas-claimant": o.claimant } : {});
  return { target, allowed, e };
}

async function playToEnd(c: ReturnType<typeof client>, o: { claimant?: string } = {}) {
  const { e, target, allowed } = await openRound(c, o);
  expect(e.status, JSON.stringify(e.json)).toBe(200);
  const id = e.json.experiment.id as string;
  const slots = await c.post(`/experiments/${id}/model-bets`);
  const b = await c.post("/bets", { experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "quiz", choice: "a" } }] });
  expect(b.status, JSON.stringify(b.json)).toBe(200);
  const r = await c.post("/runs", { experimentId: id });
  return { id, slots, r, target, allowed };
}

describe("R10: the example plays end to end with no invite code (ATLAS_REQUIRE_INVITE=1)", () => {
  it("drawing, labels, names, summary, tests, recorded AI bets, the visitor's bet, the sandbox run, the verdict, the proof card, the sentence and the track record; no model asked", async () => {
    const s = build();
    const c = client(s.app, { browser: "b_visitor_000000000001" });
    for (const claimant of [undefined, "both"]) {
      const cc = claimant ? client(s.app, { browser: "b_visitor_000000000001" }) : c;
      const { id, slots, r } = await playToEnd(cc, claimant ? { claimant } : {});
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      const models = slots.json.models as { status: string; recorded?: string }[];
      expect(models.length).toBe(claimant === "both" ? 2 : 1);
      expect(models.every((m) => m.status === "sealed" && m.recorded === RECORDED.recordedOn)).toBe(true);
      expect(r.json.verdicts.length).toBeGreaterThan(0);
      expect(r.json.track.person).toBe("browser");
      const runId = r.json.run.id as string;
      expect((await cc.get(`/proofs/${runId}`)).status).toBe(200); // the proof card, read only
      expect((await cc.get(`/runs/${runId}/helpers`)).status).toBe(200);
      const claim = await cc.post("/paste/claim", { experimentId: id });
      expect(claim.status, JSON.stringify(claim.json)).toBe(200);
      expect(typeof claim.json.claim).toBe("string");
    }
    const rec = await c.get("/track-record");
    expect(rec.status).toBe(200);
    expect(rec.json.person).toBe("browser");
    expect((await c.get("/remember")).status).toBe(200);
    // Not one model call; the sandbox ran, booked in the ledger as the open example.
    expect(s.spent.calls).toHaveLength(0);
    expect(s.spent.execs).toBeGreaterThan(0);
    expect(s.ledger.modalToday().starts).toBe(0); // local executor: no Modal starts
  }, 120_000);

  it("the Moonwell replay is a saved file: no code, no chain read", async () => {
    const s = build();
    const c = client(s.app);
    const saved = await c.get("/moonwell/saved");
    expect(saved.status).toBe(200);
    expect(saved.json.runs[0].runner).toBe("evm");
    // A new Moonwell run (its chain check) still needs a code.
    const ready = await c.get("/moonwell/ready");
    expect(ready.status).toBe(401);
    expect(ready.json.error).toContain(NEEDS_INVITE);
  });

  it("a stranger can open the proof card of an example played with no code (it lives in the open example's copy)", async () => {
    const s = build();
    const { r } = await playToEnd(client(s.app));
    expect(r.status).toBe(200);
    const card = await client(s.app, { ip: "198.51.100.9" }).get(`/proofs/${r.json.run.id}`);
    expect(card.status).toBe(200);
    expect(card.json.target.source).toBeUndefined();
  }, 60_000);
});

describe("R10: everything beyond the example still needs a code", () => {
  const PAID: { method: string; path: string; body?: unknown }[] = [
    { method: "POST", path: "/targets", body: { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578" } },
    { method: "POST", path: "/investigate", body: {} },
    { method: "POST", path: "/findings", body: {} },
    { method: "POST", path: "/sweeps", body: {} },
    { method: "POST", path: "/changes", body: {} },
    { method: "POST", path: "/adversary", body: {} },
    { method: "POST", path: "/loop/choose", body: {} },
    { method: "POST", path: "/loop/rerun", body: {} },
    { method: "POST", path: "/outline/jobs", body: { files: [{ path: "a.ts", text: "export const a = 1;\n" }] } },
    { method: "GET", path: "/replay/x" },
    { method: "GET", path: "/moonwell/ready" },
    { method: "POST", path: "/proofs/x/keep", body: {} },
    { method: "DELETE", path: "/proofs/x/keep" },
    { method: "GET", path: "/proofs/x/pencil.png" },
    { method: "GET", path: "/outline/jobs/x/labels" },
    { method: "POST", path: "/a-route-added-later", body: {} },
  ];
  it("every other paid route: 401 with the waitlist in the answer, nothing asked or run", async () => {
    const s = build({ waitlistUrl: "https://tally.so/r/atlas-waitlist" });
    for (const r of PAID) {
      expect(isOpenRoute(r.method, r.path) || isExampleRoute(r.method, r.path), r.path).toBe(false);
      const res = await s.app.request(r.path, { method: r.method, headers: { "content-type": "application/json" }, ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}) });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
      const json = (await res.json()) as { error: string; waitlist?: string };
      expect(json.error).toBe(NEEDS_INVITE);
      expect(json.waitlist).toBe("https://tally.so/r/atlas-waitlist");
    }
    expect(s.spent.calls).toHaveLength(0);
    expect(s.spent.execs).toBe(0);
  });

  it("own code, a sample file, another language: refused at /paste with the one line", async () => {
    const s = build();
    const c = client(s.app);
    for (const body of [{ code: RETRY_SRC }, { code: U1_EXAMPLE, language: "js" }, { code: "def f():\n    return 1\n", language: "py" }]) {
      const r = await c.post("/paste", body);
      expect(r.status).toBe(401);
      expect(r.json.error).toBe(OWN_CODE_NEEDS_INVITE);
      expect(r.json.invite).toEqual({ required: true, page: "/invite" });
    }
    expect(OWN_CODE_NEEDS_INVITE).toBe(NEEDS_INVITE); // one sentence wherever the visitor meets it
    expect(s.spent.calls).toHaveLength(0);
  });

  it("the gate's list of open-example routes is exactly what the page's example uses", () => {
    const reached = ["POST /paste", "POST /paste/labels", "POST /paste/names", "POST /paste/summary", "POST /paste/proposals", "POST /experiments", "POST /experiments/e_1/model-bets", "POST /bets", "POST /runs", "POST /paste/claim", "GET /runs/r_1/helpers", "GET /track-record", "GET /remember", "GET /events/s_1"];
    for (const r of reached) expect(isExampleRoute(r.split(" ")[0]!, r.split(" ")[1]!), r).toBe(true);
    expect(EXAMPLE_ROUTES).toHaveLength(reached.length);
    for (const r of EXAMPLE_ROUTES) expect(r.why.length).toBeGreaterThan(20); // each entry says why it is safe
    for (const r of ["GET /replay/r_1", "POST /proofs/r_1/keep", "GET /proofs/r_1/pencil.png", "POST /outline/jobs", "POST /changes", "GET /moonwell/ready", "POST /paste/x", "GET /paste", "POST /experiments/e_1/model-bets/x"]) expect(isExampleRoute(r.split(" ")[0]!, r.split(" ")[1]!), r).toBe(false);
  });
});

describe("R10: tampering is refused, and never reaches a model or the sandbox", () => {
  const nothingSpent = (s: ReturnType<typeof build>, execs = 0) => {
    expect(s.spent.calls).toHaveLength(0);
    expect(s.spent.execs).toBe(execs);
  };

  it("the example with one changed byte (or a trailing newline) is someone's own code", async () => {
    const s = build();
    const c = client(s.app);
    const i = U1_EXAMPLE.indexOf("100");
    for (const code of [U1_EXAMPLE.slice(0, i) + "101" + U1_EXAMPLE.slice(i + 3), U1_EXAMPLE + "\n", U1_EXAMPLE.replace(/;/, ",")]) {
      const r = await c.post("/paste", { code, language: "ts" });
      expect(r.status).toBe(401);
    }
    nothingSpent(s);
  });

  it("a different question id, a test of one's own, an edited test, all questions, a finding: refused", async () => {
    const s = build();
    const c = client(s.app);
    const { target, allowed, e } = await openRound(c);
    expect(e.status).toBe(200);
    expect(allowed.length).toBeGreaterThan(1);
    const bad = [
      { target, proposalId: allowed[1]!.id, quiz: true, one: true },
      { target, proposalId: "ps_made_up", quiz: true, one: true },
      { target, params: { shape: "call-function", exportName: "fetchWithRetry", args: [] }, quiz: true, one: true },
      { target, params: { shape: "call-function", exportName: "fetchWithRetry", args: [] }, editedFrom: allowed[0]!.id, quiz: true, one: true },
      { target, proposalId: allowed[0]!.id, quiz: true },
      { target, proposalId: allowed[0]!.id },
      { target, proposalId: allowed[0]!.id, quiz: true, one: true, findingId: "f_x" },
    ];
    for (const body of bad) {
      const r = await c.post("/experiments", body);
      if (body.proposalId === "ps_made_up") {
        expect(r.status).toBe(400); // no such test in this session: refused before the example check
        continue;
      }
      expect(r.status, JSON.stringify(body)).toBe(401);
      expect(r.json.error).toBe(OWN_CODE_NEEDS_INVITE);
    }
    // "Test this claim" asks Wonder live.
    expect((await c.post("/paste/proposals", { target, exportName: "fetchWithRetry", claimOf: e.json.experiment.id })).status).toBe(401);
    nothingSpent(s);
  });

  it("a forged 'example' flag in a body or a header changes nothing", async () => {
    const s = build();
    const c = client(s.app);
    const forged = await c.post("/paste", { code: RETRY_SRC, language: "ts", example: true });
    expect(forged.status).toBe(400); // the body is strict: an unknown field is refused, nothing read
    for (const h of [{ "x-atlas-example": "1" }, { "x-atlas-open-example": "true" }] as Record<string, string>[]) {
      expect((await c.post("/paste", { code: RETRY_SRC }, h)).status).toBe(401);
    }
    // A made-up proposal set from a developer's session cannot be borrowed: a dev's own round, no code.
    const dev = client(s.app, { code: s.codes.dev });
    const p = await dev.post("/paste", { code: RETRY_SRC });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const props = await dev.post("/paste/proposals", { target: t, exportName: "retryWithBackoff" });
    const devCalls = s.spent.calls.length;
    const anonOnDevSession = client(s.app);
    // Same session id as the developer's, no code.
    const res = await s.app.request("/experiments", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": dev.session()! }, body: JSON.stringify({ target: t, proposalId: props.json.proposals[0].id, quiz: true, one: true }) });
    // In the open example's own copy of the app the developer's session does not even exist (400: unknown target).
    expect(res.status).toBe(400);
    void anonOnDevSession;
    // Without that separate copy (one app for both), the route itself refuses it: 401.
    const one = build({ exampleCopy: false });
    const dev1 = client(one.app, { code: one.codes.dev });
    const p1 = await dev1.post("/paste", { code: RETRY_SRC });
    const t1 = { ref: p1.json.target.ref, codeSha256: p1.json.target.codeSha256 };
    const props1 = await dev1.post("/paste/proposals", { target: t1, exportName: "retryWithBackoff" });
    const calls1 = one.spent.calls.length;
    const res1 = await one.app.request("/experiments", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": dev1.session()! }, body: JSON.stringify({ target: t1, proposalId: props1.json.proposals[0].id, quiz: true, one: true }) });
    expect(res1.status).toBe(401);
    expect(one.spent.calls.length).toBe(calls1);
    expect(s.spent.calls.length).toBe(devCalls);
  });

  it("replay mismatch (the bettors' text is not the recorded one): 503 with the plain sentence; no model asked, nothing kept", async () => {
    const s = build();
    const c = client(s.app);
    // Without the names the bettors' text differs from the recorded one.
    const { e } = await openRound(c, { names: false });
    expect(e.status).toBe(503);
    expect(e.json.error).toBe(REPLAY_MISMATCH);
    nothingSpent(s);
  });

  it("replay mismatch (no recorded tests for this server's test writer): 503, Wonder never asked live", async () => {
    const s = build({ proposerModel: "muse-wonder-9" });
    const c = client(s.app);
    const p = await c.post("/paste", { code: U1_EXAMPLE, language: "ts" });
    const t = { ref: p.json.target.ref, codeSha256: p.json.target.codeSha256 };
    const r = await c.post("/paste/proposals", { target: t, exportName: "fetchWithRetry" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe(REPLAY_MISMATCH);
    nothingSpent(s);
  });

  it("the same question again in one session (a repeat, never recorded): refused with its own line", async () => {
    const s = build();
    const c = client(s.app);
    const first = await playToEnd(c);
    expect(first.r.status).toBe(200);
    const execs = s.spent.execs;
    const again = await c.post("/experiments", { target: first.target, proposalId: first.allowed[0]!.id, quiz: true, one: true });
    expect(again.status).toBe(401);
    expect(again.json.error).toBe(EXAMPLE_ALREADY_PLAYED);
    nothingSpent(s, execs);
  }, 60_000);

  it("the ledger itself refuses the open example any model call or EVM run, and caps its sandboxes at once", () => {
    const s = build({ exampleSandboxesAtOnce: 1 });
    const p = { kind: "example" as const, label: "the open example (no invite code)", route: "POST /runs", ip: "203.0.113.7" };
    runAs(p, () => {
      const m = s.ledger.reserve({ kind: "model", usd: 0.01, what: "a bet" });
      expect(m.ok).toBe(false);
      expect(s.ledger.precheck().ok).toBe(false);
      expect(s.ledger.reserve({ kind: "evm", usd: 0, what: "fork" }).ok).toBe(false);
      const a = s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "run" });
      expect(a.ok).toBe(true);
      const b = s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "run" });
      expect(b.ok).toBe(false);
      if (a.ok) a.settle(0.0001);
      expect(s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "run" }).ok).toBe(true);
    });
  });
});

describe("R10: the example's run limits", () => {
  it("per address an hour, and all visitors without a code together an hour; an invite code is not counted", async () => {
    const s = build({ limits: { perIpPerHour: 2, perHour: 3 } });
    const runFrom = async (ip: string) => (await playToEnd(client(s.app, { ip }))).r;
    expect((await runFrom("198.51.100.1")).status).toBe(200);
    expect((await runFrom("198.51.100.1")).status).toBe(200);
    const third = await runFrom("198.51.100.1");
    expect(third.status).toBe(429);
    expect(third.json.error).toMatch(/2 example runs without an invite code an hour/);
    expect((await runFrom("198.51.100.2")).status).toBe(200);
    const global = await runFrom("198.51.100.3");
    expect(global.status).toBe(429);
    expect(global.json.error).toMatch(/this hour's 3 example runs/);
    // A developer's code plays the example as before, outside these limits.
    const dev = await playToEnd(client(s.app, { ip: "198.51.100.3", code: s.codes.dev }));
    expect(dev.r.status).toBe(200);
    expect(s.spent.calls).toHaveLength(0); // the example's answers are recorded for invited people too
  }, 180_000);
});

describe("R10: track records of visitors with no code", () => {
  it("are kept apart from invited people's (in memory), so no flood of browser ids can push a saved record off the disk", async () => {
    const trackDir = mkdtempSync(join(tmpdir(), "atlas-r10-track-"));
    const s = build({ trackDir });
    const filesBefore = existsSync(join(trackDir, "track-record")) ? readdirSync(join(trackDir, "track-record")).length : 0;
    const anon = client(s.app, { browser: "b_visitor_000000000002" });
    expect((await playToEnd(anon)).r.status).toBe(200);
    const filesAfter = existsSync(join(trackDir, "track-record")) ? readdirSync(join(trackDir, "track-record")).length : 0;
    expect(filesAfter).toBe(filesBefore);
    const mine = await anon.get("/track-record");
    expect(mine.json.person).toBe("browser");
    expect(mine.json.record.total ?? mine.json.record.sealed ?? JSON.stringify(mine.json.record)).toBeTruthy();
    // Another browser sees nothing of it.
    const other = await client(s.app, { browser: "b_visitor_000000000003" }).get("/track-record");
    expect(JSON.stringify(other.json.record)).not.toBe(JSON.stringify(mine.json.record));
  }, 60_000);
});

describe("R10: the waitlist link (ATLAS_WAITLIST_URL)", () => {
  it("unset or empty: no link; a plain https address is used; anything else stops the server", () => {
    expect(waitlistUrlFromEnv({})).toBeUndefined();
    expect(waitlistUrlFromEnv({ ATLAS_WAITLIST_URL: "  " })).toBeUndefined();
    expect(waitlistUrlFromEnv({ ATLAS_WAITLIST_URL: "https://tally.so/r/abc123" })).toBe("https://tally.so/r/abc123");
    expect(waitlistUrlFromEnv({ ATLAS_WAITLIST_URL: "https://forms.gle/AbC" })).toBe("https://forms.gle/AbC");
    for (const bad of ["http://tally.so/r/abc", "javascript:alert(1)", "tally.so/r/abc", "https://user:pw@tally.so/r", 'https://tally.so/r/a"onmouseover=x', "https://tally.so/" + "a".repeat(600), "data:text/html,hi"]) {
      expect(() => waitlistUrlFromEnv({ ATLAS_WAITLIST_URL: bad }), bad).toThrow(/ATLAS_WAITLIST_URL/);
    }
  });
  it("the page learns it from /invite/status, and the invite page links it", async () => {
    const s = build({ waitlistUrl: "https://tally.so/r/abc123" });
    const st = await client(s.app).get("/invite/status");
    expect(st.json).toEqual({ required: true, signedIn: false, waitlist: "https://tally.so/r/abc123" });
    const page = await (await s.app.request("/invite")).text();
    expect(page).toContain('href="https://tally.so/r/abc123"');
    const none = build();
    expect((await client(none.app).get("/invite/status")).json.waitlist).toBeNull();
    expect(await (await none.app.request("/invite")).text()).not.toContain("waitlist");
  });
});

describe("R10: local development (ATLAS_REQUIRE_INVITE unset) behaves as before", () => {
  it("no code: own code is read and the example's answers are still recorded", async () => {
    const s = build({ require: false });
    const c = client(s.app);
    expect((await c.post("/paste", { code: RETRY_SRC })).status).toBe(200);
    const { r } = await playToEnd(client(s.app));
    expect(r.status).toBe(200);
    // A second question is allowed locally (no example lane): it asks the models (the counting fake).
    const c2 = client(s.app);
    const { target, allowed } = await openRound(c2);
    const e2 = await c2.post("/experiments", { target, proposalId: allowed[1]!.id, quiz: true, one: true });
    expect(e2.status).toBe(200);
    await c2.post(`/experiments/${e2.json.experiment.id}/model-bets`);
    expect(s.spent.calls.length).toBeGreaterThan(0);
  }, 60_000);
});
