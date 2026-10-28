// G1 review round 2: every shared capacity gets a per-code share and an owner reserve. Each test: a dev uses up its
// share (or everything devs may use), then the owner still works. Every model mocked; no network; $0. The only
// processes started are this test's own children, each stopped by the test that started it.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAs, type Principal } from "../../server/access/context";
import { openLedger } from "../../server/access/ledger";
import { createShareLimit } from "../../server/access/shares";
import { acquireStoreLock, openInviteStore, processStartTime } from "../../server/access/store";
import { createBetStore, newRound } from "../../server/bets";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import { costUsd, createMetaClient } from "../../server/meta/client";
import { firstTryUsd, retryTryUsd } from "../../server/meta/pasted-guard";
import { BET_MAX_TOKENS, BET_RETRY_MAX_TOKENS } from "../../server/meta/roles/claimant-bets";
import { MOONWELL_PR_REF } from "../../server/evm-round";
import { TS_GATE_CONTEXT } from "../../server/app";
import { sealBet } from "../../src/seal";
import type { Experiment } from "../../src/types";
import { RETRY_SRC, allowedA } from "../tools/paste-fixtures";
import { PR } from "../tools/review-fixtures";
import { ENV, build, client, tmp } from "../tools/g1-fixtures";

const REPO = resolve(import.meta.dirname, "..", "..");
const as = (id: string, role: "dev" | "owner") => <T,>(f: () => T) => runAs({ kind: "invite", id, label: id, role, route: "test" } as Principal, f);

const exp = (id: string): Experiment => ({ id, target: { kind: "ts-fixture", ref: "x.ts", codeSha256: "a".repeat(64) }, runner: "ts", params: { shape: "retry-scenario", failTimes: 5, failure: "error" }, proposedBy: { role: "human" }, gate: { allowed: true } });
const sealedRound = (id: string) => {
  const r = newRound(exp(id), TS_GATE_CONTEXT);
  r.bets.push(sealBet({ experimentId: id, who: "human", question: "q", measures: "calls", answer: { kind: "integer", value: 5 } }));
  return r;
};

describe("B6: sessions (the bet store)", () => {
  it("a dev code holds at most 20 sessions: its 21st drops its OWN oldest, even one with sealed bets; another code's sessions stay", () => {
    const store = createBetStore({ maxSessions: 500 });
    const other = as("inv_bbbbbbbbbb", "dev")(() => store.open("other"));
    if (other.ok) other.rounds.set("o", sealedRound("o"));
    const dev = as("inv_aaaaaaaaaa", "dev");
    for (let i = 0; i < 25; i++) {
      const s = dev(() => store.open(`fill${i}`));
      expect(s.ok).toBe(true);
      if (s.ok) s.rounds.set(`e${i}`, sealedRound(`e${i}`));
    }
    expect(store.size()).toBe(21); // 20 of the dev's + the other code's 1
    expect(store.peek("fill0")).toBeUndefined();
    expect(store.peek("fill24")).toBeDefined();
    expect(store.peek("other")).toBeDefined();
  });

  it("protection is bounded: 30 minutes from the oldest unrun sealed bet, and using the session does not extend it", () => {
    let t = Date.now();
    const store = createBetStore({ maxSessions: 1, now: () => t });
    const s = store.open("pinned");
    if (s.ok) s.rounds.set("p", sealedRound("p"));
    expect(store.open("next").ok).toBe(false);
    for (let i = 0; i < 6; i++) {
      t += 5 * 60 * 1000;
      store.touch("pinned"); // the review's "keep it protected for good" trick
    }
    t += 61 * 1000;
    expect(store.open("next").ok).toBe(true);
  });

  it("through the server: devs fill every dev session slot with protected rounds; the owner's new round still opens", async () => {
    const s = build({ devBetStore: createBetStore({ maxSessions: 3 }) });
    for (let i = 0; i < 3; i++) {
      const c = client(s.app, s.codes.dev, `fill-${i}`);
      const t = (await c.post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json;
      const e = await c.post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } });
      expect(e.status).toBe(200);
      await c.post("/bets", { experimentId: e.json.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] });
    }
    const dev2 = client(s.app, s.codes.dev2, "dev2-new");
    const t2 = (await dev2.post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json;
    expect((await dev2.post("/experiments", { target: { ref: t2.ref, codeSha256: t2.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).status).toBe(503);
    const owner = client(s.app, s.codes.owner, "owner-new");
    const t3 = (await owner.post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json;
    expect((await owner.post("/experiments", { target: { ref: t3.ref, codeSha256: t3.codeSha256 }, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } })).status).toBe(200);
  }, 60_000);
});

describe("B7: GitHub reads have shares, failures are remembered, the finale's PR stays cached", () => {
  it("a dev's 11th uncached PR read in the hour is refused (429) with nothing fetched; devs together stop at 25; the owner's read still goes through", async () => {
    let fetched = 0;
    const s = build({ fetchPr: async (r) => (fetched++, { ...PR, target: { ...PR.target, ref: `${r.owner}/${r.repo}#${r.number}` } }) });
    const dev = client(s.app, s.codes.dev);
    for (let i = 1; i <= 10; i++) expect((await dev.post("/targets", { kind: "github-pr", ref: `a/b#${i}` })).status).not.toBe(429);
    const eleventh = await dev.post("/targets", { kind: "github-pr", ref: "a/b#11" });
    expect(eleventh.status).toBe(429);
    expect(eleventh.json.error).toMatch(/this invite may make 10 GitHub reads an hour/);
    expect(fetched).toBe(10);
    const store2 = openInviteStore(s.dir, { env: ENV });
    for (let k = 0; k < 2; k++) {
      const c = client(s.app, store2.create({ label: `dev-x${k}` }).code);
      for (let i = 0; i < 10; i++) await c.post("/targets", { kind: "github-pr", ref: `c/d${k}#${i}` });
    }
    expect(fetched).toBe(25); // devs together: 25
    const owner = client(s.app, s.codes.owner);
    expect((await owner.post("/targets", { kind: "github-pr", ref: MOONWELL_PR_REF })).status).toBe(200);
  }, 60_000);

  it("a missing PR asked for 20 times reads GitHub once (the failure is remembered for 60 s)", async () => {
    let fetched = 0;
    const s = build({ fetchPr: async () => (fetched++, Promise.reject(new Error("GitHub said 404 Not Found"))) });
    const dev = client(s.app, s.codes.dev);
    for (let i = 0; i < 20; i++) {
      const r = await dev.post("/targets", { kind: "github-pr", ref: "a/b#404404" });
      expect(r.status).toBe(502);
    }
    expect(fetched).toBe(1);
  });

  it("the Moonwell PR is never pushed out of the cache: after 30 other PRs, asking again reads nothing", async () => {
    let fetched = 0;
    const s = build({ githubShares: { perDev: 100, devsTotal: 100, owner: 100, other: 100 }, fetchPr: async (r) => (fetched++, { ...PR, target: { ...PR.target, ref: `${r.owner}/${r.repo}#${r.number}` } }) });
    const owner = client(s.app, s.codes.owner);
    expect((await owner.post("/targets", { kind: "github-pr", ref: MOONWELL_PR_REF })).status).toBe(200);
    for (let i = 0; i < 30; i++) await owner.post("/targets", { kind: "github-pr", ref: `x/y#${i}` });
    const before = fetched;
    expect((await owner.post("/targets", { kind: "github-pr", ref: MOONWELL_PR_REF })).status).toBe(200);
    expect(fetched).toBe(before);
  });

  it("outline jobs on a GitHub repo take a GitHub read from the same share", () => {
    const lim = createShareLimit({ perDev: 2, devsTotal: 3, owner: 5, other: 5 }, "GitHub reads");
    const d = as("inv_aaaaaaaaaa", "dev");
    expect(d(() => lim.take()).ok).toBe(true);
    expect(d(() => lim.take()).ok).toBe(true);
    expect(d(() => lim.take())).toMatchObject({ ok: false, reason: expect.stringMatching(/this invite may make 2 GitHub reads an hour/) });
    expect(as("inv_bbbbbbbbbb", "dev")(() => lim.take()).ok).toBe(true);
    expect(as("inv_cccccccccc", "dev")(() => lim.take())).toMatchObject({ ok: false, reason: expect.stringMatching(/invited developers together may make 3/) });
    expect(as("inv_oooooooooo", "owner")(() => lim.take()).ok).toBe(true);
  });
});

describe("B8: the 'ran out of room' retry is held as its own worst case", () => {
  /** A model that spends one token per prompt BYTE (the reviewer's private-use characters) and always needs the retry. */
  function oneTokenPerByte() {
    let sent = 0;
    const fetchImpl = (async (_u: string, init: { body: string }) => {
      sent++;
      const body = JSON.parse(init.body) as { messages: { content: string }[]; max_tokens: number };
      const bytes = body.messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0);
      const first = body.max_tokens !== BET_RETRY_MAX_TOKENS;
      return new Response(JSON.stringify({ choices: [{ message: { content: first ? "" : "{}" }, finish_reason: first ? "length" : "stop" }], usage: { prompt_tokens: bytes, completion_tokens: body.max_tokens } }), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, sent: () => sent };
  }

  it("two Spark bets at once on a code with exactly two holds left: the ledger stays at or under $3.00", async () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const inv = store.create({ label: "dev-b8" }).invite;
    let budget: ModelBudget | undefined;
    const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => budget!.spentUsd() });
    budget = createModelBudget({ guard: ledger, callsPerHour: 1000, devCallsPerHour: 1000 });
    const m = oneTokenPerByte();
    const chat = budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl: m.fetchImpl, usagePath: join(dir, "usage.jsonl") }).chat);
    const prompt = "".repeat(23_000); // 69 KB of private-use characters (3 bytes each)
    const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: prompt }], maxTokens: BET_MAX_TOKENS, retryMaxTokens: BET_RETRY_MAX_TOKENS };
    const me = as(inv.id, "dev");
    for (let round = 0; round < 20; round++) await Promise.all([me(() => chat(args)), me(() => chat(args))]);
    const spent = ledger.today(inv.id).spentUsd;
    expect(spent).toBeLessThanOrEqual(3);
    expect(spent).toBeGreaterThan(2);
    // Every call that ran was within its two holds: real cost = both tries' prompts + outputs.
    const real = costUsd("muse-spark-1.3", 2 * 69_000, BET_MAX_TOKENS + BET_RETRY_MAX_TOKENS);
    expect(real).toBeCloseTo(firstTryUsd(args) + retryTryUsd(args), 9);
  });

  it("when the retry's hold is refused, the retry is not sent and the first try is booked at its real cost", async () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const inv = store.create({ label: "dev-b8b", dailyUsd: 0.7 }).invite;
    let budget: ModelBudget | undefined;
    const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => budget!.spentUsd() });
    budget = createModelBudget({ guard: ledger });
    const m = oneTokenPerByte();
    const chat = budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl: m.fetchImpl, usagePath: join(dir, "usage.jsonl") }).chat);
    const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "".repeat(23_000) }], maxTokens: BET_MAX_TOKENS, retryMaxTokens: BET_RETRY_MAX_TOKENS };
    const r = await as(inv.id, "dev")(() => chat(args));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ran out of room and was not asked again \(your invite's daily budget is used up/) });
    expect(m.sent()).toBe(1);
    expect(ledger.today(inv.id).spentUsd).toBeCloseTo(costUsd("muse-spark-1.3", 69_000, BET_MAX_TOKENS), 9);
  });
});

describe("M7: bet calls use 4,000 output tokens (retry 8,000), which covers every real bet answer on file", () => {
  it("the live usage log's claimant calls all fit in 4,000 output tokens", () => {
    const lines = readFileSync(join(REPO, "tests", "evidence", "usage", "usage.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { role?: string; completionTokens?: number });
    const bets = lines.filter((l) => l.role === "claimant");
    expect(bets.length).toBeGreaterThan(40);
    expect(Math.max(...bets.map((b) => b.completionTokens ?? 0))).toBeLessThanOrEqual(BET_MAX_TOKENS);
  });

  it("a 60 KB pasted bet holds about $0.32 for its first try (was $1.21)", () => {
    const args = { model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "x".repeat(60_000) }], maxTokens: BET_MAX_TOKENS, retryMaxTokens: BET_RETRY_MAX_TOKENS };
    expect(firstTryUsd(args)).toBeCloseTo(0.32, 6);
    expect(retryTryUsd(args)).toBeCloseTo(0.4, 6);
  });
});

describe("B9: the store lock after a stop", () => {
  it("a lock left with this process's own pid (a restart that got the same pid) is taken over", () => {
    const dir = tmp();
    writeFileSync(join(dir, "server.lock"), JSON.stringify({ pid: process.pid, token: "old", start: "earlier" }));
    const release = acquireStoreLock(dir);
    expect(JSON.parse(readFileSync(join(dir, "server.lock"), "utf8")).token).not.toBe("old");
    release();
    expect(existsSync(join(dir, "server.lock"))).toBe(false);
  });

  it("a pid now used by an unrelated process (start time differs) is stale; a live server with the right start time is not", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 200));
      const dir = tmp();
      writeFileSync(join(dir, "server.lock"), JSON.stringify({ pid: child.pid, token: "t", start: "not-its-start-time" }));
      const release = acquireStoreLock(dir);
      release();
      const real = processStartTime(child.pid!);
      expect(real).toBeDefined();
      writeFileSync(join(dir, "server.lock"), JSON.stringify({ pid: child.pid, token: "t", start: real }));
      expect(() => acquireStoreLock(dir)).toThrow(new RegExp(`another Atlas server \\(pid ${child.pid}\\) is already using`));
    } finally {
      child.kill("SIGTERM"); // the child this test started
    }
  });

  it("SIGTERM and SIGINT remove the lock (a server child process, started and stopped by this test)", async () => {
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const dir = tmp();
      const script = `import { acquireStoreLock } from ${JSON.stringify(join(REPO, "server", "access", "store.ts"))}; acquireStoreLock(${JSON.stringify(dir)}, { handleSignals: true }); console.log("ready"); setInterval(() => {}, 1000);`;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: REPO, stdio: ["ignore", "pipe", "inherit"] });
      await new Promise<void>((ok, fail) => {
        child.stdout!.on("data", (d: Buffer) => d.toString().includes("ready") && ok());
        child.on("exit", () => fail(new Error("the child exited early")));
      });
      expect(existsSync(join(dir, "server.lock"))).toBe(true);
      const exited = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
      child.kill(sig); // the child this test started
      expect(await exited).toBe(0);
      expect(existsSync(join(dir, "server.lock"))).toBe(false);
    }
  }, 30_000);
});

describe("M6: pastes", () => {
  it("a dev code holds at most 10 paste sessions (its 11th drops its own oldest); the owner's paste lives in the owner's app and survives any dev flood", async () => {
    const s = build();
    const owner = client(s.app, s.codes.owner, "owner-paste");
    const op = await owner.post("/paste", { code: RETRY_SRC });
    const target = { ref: op.json.target.ref, codeSha256: op.json.target.codeSha256 };
    const first = client(s.app, s.codes.dev, "dev-p0");
    const dp = await first.post("/paste", { code: RETRY_SRC });
    for (let i = 1; i <= 10; i++) expect((await client(s.app, s.codes.dev, `dev-p${i}`).post("/paste", { code: RETRY_SRC })).status).toBe(200);
    const gone = await first.post("/experiments", { target: { ref: dp.json.target.ref, codeSha256: dp.json.target.codeSha256 }, params: allowedA });
    expect(gone.status).toBe(400); // the dev's own oldest paste session was dropped
    const store2 = openInviteStore(s.dir, { env: ENV });
    for (let k = 0; k < 3; k++) {
      const code = store2.create({ label: `dev-q${k}` }).code;
      for (let i = 0; i < 10; i++) await client(s.app, code, `q${k}-${i}`).post("/paste", { code: RETRY_SRC });
    }
    expect((await owner.post("/experiments", { target, params: allowedA })).status).toBe(200);
  }, 60_000);
});

describe("Sweep: the owner's app copy keeps every in-memory capacity apart", () => {
  it("a dev's session, paste and run are invisible to the owner and the reverse (two app instances)", async () => {
    const s = build();
    const dev = client(s.app, s.codes.dev, "same-session-id");
    const owner = client(s.app, s.codes.owner, "same-session-id");
    const dp = await dev.post("/paste", { code: RETRY_SRC });
    const t = { ref: dp.json.target.ref, codeSha256: dp.json.target.codeSha256 };
    expect((await owner.post("/experiments", { target: t, params: allowedA })).status).toBe(400); // not in the owner's app
    expect((await dev.post("/experiments", { target: t, params: allowedA })).status).toBe(200);
    expect(s.ownerInner).toBeDefined();
  });

  it("live-log streams: no code gets 401; a dev holds at most 4 at once (the 5th is 429); the owner's stream still opens", async () => {
    const s = build({ streams: { perDev: 4, devsTotal: 40 } });
    expect((await s.app.request("/events/abc")).status).toBe(401);
    const open = await Promise.all(Array.from({ length: 4 }, (_, i) => s.app.request(`/events/s${i}`, { headers: { "x-atlas-invite": s.codes.dev } })));
    expect(open.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await s.app.request("/events/s5", { headers: { "x-atlas-invite": s.codes.dev } })).status).toBe(429);
    const mine = await s.app.request("/events/o1", { headers: { "x-atlas-invite": s.codes.owner } });
    expect(mine.status).toBe(200);
    // Closing one dev stream frees its slot.
    await open[0]!.body!.cancel();
    await new Promise((r) => setTimeout(r, 20));
    const again = await s.app.request("/events/s6", { headers: { "x-atlas-invite": s.codes.dev } });
    expect(again.status).toBe(200);
    for (const r of [...open.slice(1), mine, again]) await r.body?.cancel();
  });
});

describe("minors", () => {
  it("m12: a replay opened by typing the URL (Sec-Fetch-Site: none) passes the gate with the cookie; a link from another site does not", async () => {
    const s = build({ publicOrigin: "https://atlas.example" });
    const jar = `atlas_invite=${s.codes.dev}`;
    expect((await s.app.request("/replay/x", { headers: { cookie: jar, "sec-fetch-site": "none" } })).status).toBe(404); // past the gate
    expect((await s.app.request("/replay/x", { headers: { cookie: jar, "sec-fetch-site": "cross-site" } })).status).toBe(403);
  });

  it("m9: one dev code holds at most 2 sandboxes at once, so another dev still gets one", () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    const a = store.create({ label: "a" }).invite;
    const b = store.create({ label: "b" }).invite;
    const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    const da = as(a.id, "dev");
    expect(da(() => ledger.reserve({ kind: "sandbox", usd: 0, what: "local" })).ok).toBe(true);
    expect(da(() => ledger.reserve({ kind: "sandbox", usd: 0, what: "local" })).ok).toBe(true);
    expect(da(() => ledger.reserve({ kind: "sandbox", usd: 0, what: "local" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/this invite already has 2 sandboxes running/) });
    expect(as(b.id, "dev")(() => ledger.reserve({ kind: "sandbox", usd: 0, what: "local" })).ok).toBe(true);
  });
});
