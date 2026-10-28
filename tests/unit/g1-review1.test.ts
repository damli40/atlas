// G1 review round 1: the "drain the credits or block Dami" findings, one test (or more) each. Every model mocked
// (fake fetch or fake chat); no network, no key, $0. Every store in a temp folder.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runAs, type Principal } from "../../server/access/context";
import { CROSS_SITE, INVITE_COOKIE } from "../../server/access/gate";
import { modalWorstCaseUsd, openLedger } from "../../server/access/ledger";
import { meteredChainFacts, meteredGate } from "../../server/access/metered";
import { acquireStoreLock, openInviteStore } from "../../server/access/store";
import { createModelBudget, type ModelBudget } from "../../server/meta/budget";
import { createMetaClient, type ChatResult } from "../../server/meta/client";
import { estimatedCallUsd, firstTryUsd, fullWorstCaseUsd, promptTokensUpperBound, retryTryUsd } from "../../server/meta/pasted-guard";
import { museWorstCaseUsd } from "../../server/meta/roles/fixer";
import { createRunGate, createSandboxGate } from "../../server/replay-limits";
import { main as invitesCli } from "../../tools/invites";
import { CHAIN_FACTS_BLOCK } from "../../src/chain-facts";
import { RETRY_SRC, allowedA } from "../tools/paste-fixtures";
import { ENV, build, client, logLines, tmp } from "../tools/g1-fixtures";

/** A ledger + budget pair on a fresh store with one dev and one owner code. */
function pair(o: { callsPerHour?: number; devCallsPerHour?: number; ledger?: Partial<Parameters<typeof openLedger>[0]> } = {}) {
  const dir = tmp();
  const store = openInviteStore(dir, { env: ENV });
  const dev = store.create({ label: "dev-ada" }).invite;
  const dev2 = store.create({ label: "dev-bo" }).invite;
  const owner = store.create({ label: "dami", role: "owner" }).invite;
  let budget: ModelBudget | undefined;
  const ledger = openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, ownerReserveUsd: 20, modelSpentUsd: () => budget!.spentUsd(), ...(o.ledger ?? {}) });
  budget = createModelBudget({ spendCeilingUsd: 100, guard: ledger, callsPerHour: o.callsPerHour ?? 60, ...(o.devCallsPerHour !== undefined ? { devCallsPerHour: o.devCallsPerHour } : {}), experimentsPerSession: 10 });
  const as = (inv: { id: string; label: string; role: "dev" | "owner" }) => <T,>(f: () => T) => runAs({ kind: "invite", id: inv.id, label: inv.label, role: inv.role, route: "test" } as Principal, f);
  return { dir, store, ledger, budget: budget!, asDev: as(dev), asDev2: as(dev2), asOwner: as(owner), ids: { dev: dev.id, owner: owner.id } };
}

type MuseLike = { ok: boolean; reason?: string; costUnknown?: true; usage?: { usd: number } };
const okChat = (usd: number) => async (): Promise<ChatResult> => ({ ok: true, content: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd } });

describe("B1: a call that was sent and reported no usage is counted at its worst case", () => {
  it("the review's attack (timeouts on a 60k prompt, 200 tries) stops at about $3 for one $3 code", async () => {
    const s = pair({ callsPerHour: 100_000, devCallsPerHour: 100_000 });
    let sent = 0;
    const fetchImpl = (async (_u: string, init: { signal: AbortSignal }) => {
      sent++;
      return new Promise<Response>((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted due to timeout"), { name: "TimeoutError" }))));
    }) as unknown as typeof fetch;
    const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", timeoutMs: 5, fetchImpl, usagePath: join(s.dir, "usage.jsonl") }).chat);
    const prompt = "x".repeat(60_000);
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      const r = await s.asDev(() => chat({ role: "claimant", model: "muse-spark-1.3", messages: [{ role: "user", content: prompt }] }));
      if (!r.ok && /daily budget is used up/.test(r.reason)) refused++;
    }
    // Review round 2 (B8): a timed-out FIRST try is held and counted at the first try's worst case:
    // 60,000 bytes × $4/M + 16,000 tokens × $20/M = $0.56. (The retry, never reached here, holds its own.)
    const worst = firstTryUsd({ model: "muse-spark-1.3", messages: [{ role: "user", content: prompt }] });
    expect(worst).toBeCloseTo(0.56, 6);
    expect(sent).toBe(5); // 5 × $0.56 = $2.80 fits in $3; a 6th would not
    expect(refused).toBe(195);
    const today = s.ledger.today(s.ids.dev);
    expect(today.spentUsd).toBeCloseTo(2.8, 6);
    expect(today.spentUsd).toBeLessThanOrEqual(3);
    expect(s.budget.spentUsd()).toBeCloseTo(2.8, 6); // the global ceiling and the owner reserve see it too
    expect(logLines(s.dir).filter((l) => l.kind === "model" && !l.refused).every((l) => /counted at its worst case/.test(l.note))).toBe(true);
  });

  it("per outcome: a 200 with usage is its real cost; a 4xx is $0; a 5xx, a non-JSON body or a 200 without usage is the worst case; not sent is $0", async () => {
    const cases: [string, () => Response | Promise<Response>, number | "worst"][] = [
      ["200 + usage", () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 }), (1000 * 4 + 100 * 20) / 1e6],
      ["HTTP 400", () => new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }), 0],
      ["HTTP 504", () => new Response("gateway timeout", { status: 504 }), "worst"],
      ["not JSON", () => new Response("<html>", { status: 200 }), "worst"],
      ["no usage", () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 }), "worst"],
    ];
    for (const [name, respond, want] of cases) {
      const s = pair();
      const chat = s.budget.wrap(createMetaClient({ apiKey: "fake-key-0000", fetchImpl: (async () => respond()) as unknown as typeof fetch, usagePath: join(s.dir, "usage.jsonl") }).chat);
      const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "hello" }] };
      await s.asDev(() => chat(args));
      const expected = want === "worst" ? firstTryUsd(args) : want;
      expect(s.ledger.today(s.ids.dev).spentUsd, name).toBeCloseTo(expected, 9);
      expect(s.budget.spentUsd(), name).toBeCloseTo(expected, 9);
    }
    const s = pair();
    const noKey = s.budget.wrap(createMetaClient({ apiKey: "", fetchImpl: (async () => new Response("")) as unknown as typeof fetch }).chat);
    const r = await s.asDev(() => noKey({ role: "claimant", model: "not-a-meta-model", messages: [] }));
    expect(r).toMatchObject({ ok: false, notSent: true });
    expect(s.ledger.today(s.ids.dev).spentUsd).toBe(0);
  });

  it("a call that THROWS (after it may have been sent) is counted at its worst case, never $0", async () => {
    const s = pair();
    const chat = s.budget.wrap(async () => {
      throw new Error("socket hang up");
    });
    const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "x" }] };
    await expect(s.asDev(() => chat(args))).rejects.toThrow(/socket hang up/);
    expect(s.ledger.today(s.ids.dev).spentUsd).toBeCloseTo(firstTryUsd(args), 9);
  });

  it("M1: a killed muse exec (costUnknown) is counted at its computed hold, which grows with the workspace and the steps", async () => {
    const s = pair();
    const req = { files: { "a.ts": "x".repeat(20_000) }, prompt: "change it", maxSteps: 6 };
    const hold = museWorstCaseUsd(req);
    expect(hold).toBeCloseTo(6 * ((20_000 + 9 + 32_000) * 4 + 16_000 * 20) / 1e6, 9);
    const r = await s.asOwner(() => s.budget.track<MuseLike>(async () => ({ ok: false, reason: "muse exec did not finish within 240 s", costUnknown: true }), (reason) => ({ ok: false, reason }), 0, { usd: hold, what: "Muse Code" }));
    expect(r.ok).toBe(false);
    expect(s.ledger.today(s.ids.owner).spentUsd).toBeCloseTo(hold, 9);
    // On a $3 dev code, a 6-step run on a 20 KB workspace ($3.17) is not started at all.
    const d = await s.asDev(() => s.budget.track<MuseLike>(async () => ({ ok: true }), (reason) => ({ ok: false, reason }), 0, { usd: hold, what: "Muse Code" }));
    expect(d).toMatchObject({ ok: false, reason: expect.stringMatching(/daily budget is used up/) });
  });
});

describe("B4: prompt tokens are counted as UTF-8 bytes (an upper bound)", () => {
  it("CJK and emoji count by bytes, so their hold is up to 3-4x the old character count", () => {
    const cjk = "漢".repeat(1000); // 3 bytes each
    const emoji = "😀".repeat(1000); // 4 bytes, 2 UTF-16 units each
    expect(promptTokensUpperBound([{ content: cjk }])).toBe(3000);
    expect(promptTokensUpperBound([{ content: emoji }])).toBe(4000);
    const a = estimatedCallUsd({ model: "muse-wonder-1.0", messages: [{ role: "user", content: "a".repeat(3000) }] });
    expect(estimatedCallUsd({ model: "muse-wonder-1.0", messages: [{ role: "user", content: cjk }] })).toBeCloseTo(a, 12);
  });
});

describe("B2: calls per hour and experiments per session have per-code shares; the owner has its own", () => {
  it("a dev uses up its share of calls (and the devs' shared counter); the owner's call and experiment still go through", async () => {
    const s = pair({ callsPerHour: 8, devCallsPerHour: 4 });
    const chat = s.budget.wrap(okChat(0.003));
    const args = { role: "claimant" as const, model: "muse-spark-1.3", messages: [{ role: "user" as const, content: "hi" }] };
    let dev = 0;
    for (let i = 0; i < 10; i++) if ((await s.asDev(() => chat(args))).ok) dev++;
    expect(dev).toBe(4);
    const devMore = await s.asDev(() => chat(args));
    expect(devMore).toMatchObject({ ok: false, reason: "call limit reached: this invite may make 4 model calls an hour" });
    let dev2 = 0;
    for (let i = 0; i < 10; i++) if ((await s.asDev2(() => chat(args))).ok) dev2++;
    expect(dev2).toBe(4); // 8 in the shared counter now: full for devs
    expect((await s.asDev2(() => s.budget.startExperiment("x"))).ok).toBe(false);
    expect((await s.asOwner(() => chat(args))).ok).toBe(true);
    expect(s.asOwner(() => s.budget.startExperiment("owner-session"))).toEqual({ ok: true });
  });

  it("a dev who sends the owner's session id uses up only its own experiment count", () => {
    const s = pair();
    for (let i = 0; i < 10; i++) expect(s.asDev(() => s.budget.startExperiment("dami-session")).ok).toBe(true);
    expect(s.asDev(() => s.budget.startExperiment("dami-session")).ok).toBe(false);
    expect(s.asOwner(() => s.budget.startExperiment("dami-session"))).toEqual({ ok: true });
  });
});

describe("B3: Modal's daily caps have per-dev shares and an owner slice; sandboxes at once are capped for devs", () => {
  it("a dev uses up its own daily seconds; the owner's sandbox still starts (the review's 720-run attack)", () => {
    const s = pair();
    let n = 0;
    for (;;) {
      const h = s.asDev(() => s.ledger.reserve({ kind: "sandbox", usd: modalWorstCaseUsd(10_000), what: "modal sandbox", modal: true }));
      if (!h.ok) {
        expect(h.reason).toMatch(/your invite's daily sandbox share is used up \(90 of 150 sandboxes, 900 of 900 sandbox-seconds today\)/);
        break;
      }
      h.settle(0.0005, { seconds: 10 });
      if (++n > 5000) break;
    }
    expect(n).toBe(90);
    const o = s.asOwner(() => s.ledger.reserve({ kind: "sandbox", usd: modalWorstCaseUsd(10_000), what: "modal sandbox", modal: true }));
    expect(o.ok).toBe(true);
  });

  it("devs together stop at 80% of Modal's daily caps; the owner (and the warm-up) can use the rest", () => {
    const s = pair({ ledger: { modalStartsPerDay: 10, devModalStartsPerDay: 100 } });
    let devs = 0;
    for (let i = 0; i < 20; i++) {
      const h = (i % 2 ? s.asDev : s.asDev2)(() => s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
      if (h.ok) {
        devs++;
        h.settle(0.0001, { seconds: 1 });
      } else expect(h.reason).toMatch(/the invited developers' share of today's sandboxes is used up .* the rest is kept for the owner/);
    }
    expect(devs).toBe(8);
    for (let i = 0; i < 2; i++) {
      const o = s.asOwner(() => s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
      expect(o.ok).toBe(true);
      if (o.ok) o.settle(0.0001, { seconds: 1 });
    }
  });

  it("devs together hold at most 3 sandboxes at once; the owner's 4th still starts", () => {
    const s = pair();
    const held = [s.asDev, s.asDev, s.asDev2].map((as) => as(() => s.ledger.reserve({ kind: "sandbox", usd: 0, what: "local sandbox" })));
    expect(held.every((h) => h.ok)).toBe(true);
    const more = s.asDev2(() => s.ledger.reserve({ kind: "sandbox", usd: 0, what: "local sandbox" }));
    expect(more).toMatchObject({ ok: false, reason: expect.stringMatching(/invited developers already have 3 sandboxes running at once/) });
    expect(s.asOwner(() => s.ledger.reserve({ kind: "sandbox", usd: 0, what: "local sandbox" })).ok).toBe(true);
  });

  it("restart: the per-dev share and the devs' slice are read back from disk", () => {
    const s = pair({ ledger: { devModalStartsPerDay: 2 } });
    for (let i = 0; i < 2; i++) {
      const h = s.asDev(() => s.ledger.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
      if (h.ok) h.settle(0.0001, { seconds: 3 });
    }
    const again = openLedger({ dir: s.dir, store: s.store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0, devModalStartsPerDay: 2 });
    const h = s.asDev(() => again.reserve({ kind: "sandbox", usd: 0.001, what: "modal sandbox", modal: true }));
    expect(h).toMatchObject({ ok: false, reason: expect.stringMatching(/2 of 2 sandboxes, 6 of 900/) });
  });
});

describe("M3: the EVM gates (runs, replays) and the sandbox gate give the owner its own slots", () => {
  it("devs use up the shared hourly runs and the at-once slot; the owner still gets a run", () => {
    const s = pair({ ledger: { evmRunsPerDay: 100 } });
    const limits = { globalConcurrent: 1, globalPerHour: 2, sessionConcurrent: 1, sessionPerHour: 5, ipConcurrent: 1, ipPerHour: 5, reservedForNewClients: 0 };
    const gate = meteredGate(createRunGate(limits), s.ledger, "EVM run", { ownerGate: createRunGate(limits) });
    const a = s.asDev(() => gate.take("s1", "invite:a"));
    expect(a.ok).toBe(true); // holds the one at-once slot
    expect(s.asDev2(() => gate.take("s2", "invite:b")).ok).toBe(false);
    const o = s.asOwner(() => gate.take("so", "invite:o"));
    expect(o.ok).toBe(true);
    if (a.ok) a.release();
    const b = s.asDev2(() => gate.take("s2", "invite:b"));
    if (b.ok) b.release();
    expect(s.asDev(() => gate.take("s3", "invite:a")).ok).toBe(false); // 2 an hour used by devs
    if (o.ok) o.release();
    expect(s.asOwner(() => gate.take("so2", "invite:o")).ok).toBe(true);
  });

  it("the sandbox gate too: devs hold the shared at-once slots; the owner's sandbox start still gets one", () => {
    const s = pair();
    const limits = { globalConcurrent: 2, globalPerHour: 1000, sessionConcurrent: 2, sessionPerHour: 100, ipConcurrent: 2, ipPerHour: 100, reservedForNewClients: 0 };
    const gate = meteredGate(createSandboxGate(limits), s.ledger, "sandbox start", { ownerGate: createSandboxGate(limits), count: false });
    expect(s.asDev(() => gate.take("a", "invite:a")).ok).toBe(true);
    expect(s.asDev2(() => gate.take("b", "invite:b")).ok).toBe(true);
    expect(s.asDev2(() => gate.take("c", "invite:b")).ok).toBe(false);
    expect(s.asOwner(() => gate.take("o", "invite:o")).ok).toBe(true);
  });
});

describe("M2: outline jobs running at once: one per dev code, and the last slot is the owner's", () => {
  it("a dev's second running job is refused; devs fill 3 of 4 slots; the owner's job still starts", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const s = build({
      chat: async () => {
        await hold;
        return { ok: true, finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, usd: 0.001 }, content: "{}" };
      },
    });
    const store2 = openInviteStore(s.dir, { env: ENV });
    const more = [store2.create({ label: "dev-c" }).code, store2.create({ label: "dev-d" }).code];
    const job = (code: string, sess: string) => client(s.app, code, sess).post("/outline/jobs", { files: [{ path: "a.ts", text: "export function a(x: number) { return x + 1; }\n" }] });
    expect((await job(s.codes.dev, "j1")).status).toBe(202);
    const again = await job(s.codes.dev, "j2");
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/this invite already has an outline job running/);
    expect((await job(s.codes.dev2, "j3")).status).toBe(202);
    expect((await job(more[0]!, "j4")).status).toBe(202);
    const fourthDev = await job(more[1]!, "j5");
    expect(fourthDev.status).toBe(503);
    expect(fourthDev.json.error).toMatch(/the last slot is kept for the owner/);
    expect((await job(s.codes.owner, "j6")).status).toBe(202);
    release();
  }, 60_000);
});

describe("B5 and m3: a request signed only by the cookie must come from Atlas's own page", () => {
  const ORIGIN = "https://atlas.example";
  it("cookie-only POSTs and GET /replay are refused cross-site; same-origin (or the configured Origin) passes; the header path is unchanged", async () => {
    const s = build({ publicOrigin: ORIGIN });
    const jar = `${INVITE_COOKIE}=${s.codes.dev}`;
    const post = (headers: Record<string, string>) => s.app.request("/paste", { method: "POST", headers: { "content-type": "application/json", cookie: jar, "x-atlas-session": "csrf1", ...headers }, body: JSON.stringify({ code: RETRY_SRC }) });
    const refused = await post({});
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe(CROSS_SITE);
    expect((await post({ "sec-fetch-site": "same-site" })).status).toBe(403); // e.g. another tenant on a shared parent domain
    expect((await post({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ origin: "https://evil--x.modal.run" })).status).toBe(403);
    expect((await post({ "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await post({ origin: ORIGIN })).status).toBe(200);
    const replay = await s.app.request("/replay/anything", { headers: { cookie: jar } });
    expect(replay.status).toBe(403);
    // A cookie GET of a read-only page is fine.
    expect((await s.app.request("/invite/status", { headers: { cookie: jar } })).status).toBe(200);
    // The header path needs no browser headers (a cross-origin page cannot set it without a preflight).
    expect((await s.app.request("/paste", { method: "POST", headers: { "content-type": "application/json", "x-atlas-invite": s.codes.dev, "x-atlas-session": "csrf2" }, body: JSON.stringify({ code: RETRY_SRC }) })).status).toBe(200);
  });

  it("spending POSTs must be JSON: a text/plain or form body is refused before the app (415), even same-origin", async () => {
    const s = build();
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await s.app.request("/experiments", { method: "POST", headers: { "content-type": ct, "x-atlas-invite": s.codes.dev, "sec-fetch-site": "same-origin" }, body: "{}" });
      expect(r.status, ct).toBe(415);
    }
    expect(s.spent.calls).toHaveLength(0);
  });

  it("sign-in and sign-out from another site are refused (403)", async () => {
    const s = build({ publicOrigin: ORIGIN });
    const signIn = await s.app.request("/invite", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "cross-site" }, body: `code=${s.codes.dev}` });
    expect(signIn.status).toBe(403);
    expect(signIn.headers.get("set-cookie")).toBeNull();
    const signOut = await s.app.request("/invite/forget", { method: "POST", headers: { cookie: `${INVITE_COOKIE}=${s.codes.owner}`, "sec-fetch-site": "cross-site" } });
    expect(signOut.status).toBe(403);
    expect(signOut.headers.get("set-cookie")).toBeNull();
    const ok = await s.app.request("/invite", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }, body: `code=${s.codes.dev}` });
    expect(ok.status).toBe(200);
  });
});

describe("M5: one server process per store", () => {
  it("a second lock on the same store is refused while the first holder lives; a lock left by a dead process is taken over", () => {
    const dir = tmp();
    const release = acquireStoreLock(dir);
    expect(() => acquireStoreLock(dir)).toThrow(/another Atlas server \(pid \d+(, this process)?\) is already using the invite store/);
    release();
    const again = acquireStoreLock(dir);
    again();
    writeFileSync(join(dir, "server.lock"), "999999\n"); // no such process
    const taken = acquireStoreLock(dir);
    expect(JSON.parse(readFileSync(join(dir, "server.lock"), "utf8")).pid).toBe(process.pid);
    taken();
  });
});

describe("minors", () => {
  it("m6: codes but no spend.json: the ledger refuses to open; ledger-init (on purpose) makes an empty one", () => {
    const dir = tmp();
    const store = openInviteStore(dir, { env: ENV });
    store.create({ label: "dev-ada" });
    const open = () => openLedger({ dir, store, requireInvite: true, ceilingUsd: 100, modelSpentUsd: () => 0 });
    expect(open).not.toThrow(); // made with the first code
    writeFileSync(join(dir, "spend.json"), "", { mode: 0o600 });
    expect(open).toThrow();
    unlinkSync(join(dir, "spend.json"));
    expect(open).toThrow(/spend\.json is missing but .* already holds invite codes/);
    const out: string[] = [];
    expect(invitesCli(["ledger-init", "--dir", dir], (l) => out.push(l), ENV)).toBe(0);
    expect(open).not.toThrow();
    expect(invitesCli(["ledger-init", "--dir", dir], () => {}, ENV)).toBe(1);
  });

  it("m5: a store folder inside the repo is refused (server and tool)", () => {
    const inRepo = resolve(__dirname, "..", "..", "node_modules", ".g1-store-test");
    mkdirSync(inRepo, { recursive: true });
    expect(() => openInviteStore(inRepo, { env: ENV })).toThrow(/inside the repo/);
    expect(() => invitesCli(["create", "--name", "x", "--dir", inRepo], () => {}, ENV)).toThrow(/inside the repo/);
  });

  it("m2: a chain-facts read counts as one EVM run of the invite; success cached, a failure cached 60 s", async () => {
    const s = pair({ ledger: { evmRunsPerDay: 2 } });
    let t = 0;
    let reads = 0;
    let fail = true;
    const read = meteredChainFacts(async () => {
      reads++;
      if (fail) throw new Error("RPC down");
      return { block: CHAIN_FACTS_BLOCK } as never;
    }, s.ledger, () => t);
    await expect(s.asDev(() => read(CHAIN_FACTS_BLOCK))).rejects.toThrow(/RPC down/);
    await expect(s.asDev(() => read(CHAIN_FACTS_BLOCK))).rejects.toThrow(/RPC down/); // cached failure: no new read
    expect(reads).toBe(1);
    t += 61_000;
    fail = false;
    await s.asDev(() => read(CHAIN_FACTS_BLOCK));
    await s.asDev(() => read(CHAIN_FACTS_BLOCK)); // cached success
    expect(reads).toBe(2);
    expect(s.ledger.today(s.ids.dev).evmRuns).toBe(2);
  });

  it("m4: with an https public origin the cookie is Secure", async () => {
    const s = build({ publicOrigin: "https://atlas.example" });
    const r = await s.app.request("/invite", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }, body: `code=${s.codes.dev}` });
    expect(r.headers.get("set-cookie")).toMatch(/Secure/);
  });
});
