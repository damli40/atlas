// Day-5 review, S5: the caps cannot be bypassed by minting sessions.
// Before the fix (probes5/p3): 22 EVM runs, each with a new x-atlas-session, got 20 × 200 then 429, and
// a legitimate session afterwards got 429 for the rest of the hour.
// Now the caps are also counted per client address (server/client-ip.ts; X-Forwarded-For's first hop only
// with ATLAS_TRUST_PROXY=1 / trustProxy), and the last few runs of the hour are kept for addresses that have
// not run yet. Model rounds and investigations are counted per address too.
// Stand-in fork (no anvil, no RPC); the model and the Investigator are mocked chats (no Meta call).

import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { clientKey } from "../../server/client-ip";
import { createProofStore } from "../../server/evm-round";
import type { ChatResult } from "../../server/meta/client";
import { FIXTURE_FILE } from "../../server/meta/roles/fixture-finding";
import { createReplayGate, createRunGate, DEFAULT_REPLAY_LIMITS, DEFAULT_RUN_LIMITS, runLimitsFromEnv } from "../../server/replay-limits";
import { OUTCOME_OPTIONS } from "../../src/units";
import { liveRunFor, PR } from "../tools/review-fixtures";

function evmServer(opts: { trustProxy?: boolean } = {}) {
  const app = createApp({ fetchPr: async () => PR, evmRun: async (exp) => liveRunFor(exp), runGate: createRunGate(), proofs: createProofStore({ publish: false }), trustProxy: opts.trustProxy ?? true });
  const headers = (session: string, ip?: string) => ({ "content-type": "application/json", "x-atlas-session": session, ...(ip ? { "x-forwarded-for": `10.0.0.1, ${ip}` } : {}) });
  const ready = async (session: string, ip?: string) => {
    const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: headers(session, ip), body: JSON.stringify(body) })).json() as Promise<any>;
    const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
    const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).finding;
    const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
    await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    return e.experiment.id as string;
  };
  const run = async (session: string, ip?: string) => {
    const id = await ready(session, ip);
    const res = await app.request("/runs", { method: "POST", headers: headers(session, ip), body: JSON.stringify({ experimentId: id }) });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  };
  return { app, run };
}

describe("S5: client address", () => {
  it("normalises addresses: IPv4, IPv4-mapped IPv6, IPv6 by /64, ports; junk is not an address", () => {
    expect(clientKey("203.0.113.5")).toBe("203.0.113.5");
    expect(clientKey("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(clientKey("203.0.113.5:4431")).toBe("203.0.113.5");
    expect(clientKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64"); // same /64, same key
    expect(clientKey("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    for (const bad of ["", "999.1.1.1", "hello", "1.2.3", "::1::2"]) expect(clientKey(bad)).toBeNull();
  });

  it("X-Forwarded-For is read only when trustProxy is on (otherwise one 'unknown' key for in-process requests)", async () => {
    const off = evmServer({ trustProxy: false });
    // Different forwarded addresses, but the header is not trusted: they all count as one client.
    const statuses = [];
    for (let i = 0; i < 9; i++) statuses.push((await off.run(`s${i}`, `198.51.100.${i + 1}`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429]);
  });
});

describe("S5: EVM runs, sessions minted per run", () => {
  it("defaults: per address 2 at once and 8 an hour; 4 of the server's 20 an hour kept for new addresses", () => {
    expect(DEFAULT_RUN_LIMITS).toMatchObject({ ipConcurrent: 2, ipPerHour: 8, reservedForNewClients: 4, globalPerHour: 20 });
    expect(DEFAULT_REPLAY_LIMITS).toMatchObject({ ipConcurrent: 1, ipPerHour: 4, reservedForNewClients: 2, globalPerHour: 10 });
    expect(runLimitsFromEnv({ ATLAS_RUNS_IP_MAX_PER_HOUR: "3", ATLAS_RUNS_RESERVED_FOR_NEW_CLIENTS: "x" })).toMatchObject({ ipPerHour: 3, reservedForNewClients: 4 });
  });

  // The reviewer's probe, with the address held fixed.
  it("22 runs from one address, a new session each time: 8 × 200 then 429; a new user afterwards still runs", async () => {
    const s = evmServer();
    const statuses: number[] = [];
    let reason = "";
    for (let i = 0; i < 22; i++) {
      const r = await s.run(`attacker-${i}`, "198.51.100.7");
      statuses.push(r.status);
      if (r.status === 429) reason = r.body.error ?? "";
    }
    expect(statuses).toEqual([...Array(8).fill(200), ...Array(14).fill(429)]);
    expect(reason).toBe("run not started: one client address may start 8 EVM runs an hour and this one has started that many in the last hour");
    expect((await s.run("judge-1", "203.0.113.9")).status).toBe(200);
  });

  it("several heavy addresses cannot use the reserved runs: those go to addresses that have not run this hour", async () => {
    const s = evmServer();
    for (let i = 0; i < 8; i++) expect((await s.run(`a${i}`, "198.51.100.1")).status).toBe(200);
    for (let i = 0; i < 8; i++) expect((await s.run(`b${i}`, "198.51.100.2")).status).toBe(200); // 16 of 20 used
    const c1 = await s.run("c0", "198.51.100.3"); // a new address: may use the reserve
    expect(c1.status).toBe(200);
    const c2 = await s.run("c1", "198.51.100.3"); // no longer new: the reserve is not for it
    expect(c2.status).toBe(429);
    expect(c2.body.error).toMatch(/last 4 EVM runs this hour are kept for clients that have not started one yet/);
    expect((await s.run("judge", "203.0.113.9")).status).toBe(200); // 18 of 20
    expect((await s.run("judge2", "203.0.113.10")).status).toBe(200); // 19
    expect((await s.run("judge3", "203.0.113.11")).status).toBe(200); // 20
    expect((await s.run("judge4", "203.0.113.12")).status).toBe(429); // the hour is used up
  });
});

describe("S5: EVM replays per address", () => {
  it("4 replays an hour per address whatever the session; 1 at once per address", () => {
    let t = 0;
    const g = createReplayGate({ ...DEFAULT_REPLAY_LIMITS, globalConcurrent: 5, sessionPerHour: 99 }, () => t);
    const slots = [1, 2, 3, 4].map((i) => g.take(`s${i}`, "198.51.100.7"));
    // 1 at once per address: the 2nd is refused while the 1st runs.
    expect(slots.map((x) => x.ok)).toEqual([true, false, false, false]);
    if (slots[0]!.ok) slots[0]!.release();
    for (let i = 5; i < 8; i++) {
      const x = g.take(`s${i}`, "198.51.100.7");
      expect(x.ok).toBe(true);
      if (x.ok) x.release();
    }
    const fifth = g.take("s9", "198.51.100.7");
    expect(fifth).toEqual({ ok: false, reason: "one client address may start 4 EVM replays an hour and this one has started that many in the last hour" });
    expect(g.take("other", "203.0.113.9").ok).toBe(true);
    t += 60 * 60 * 1000 + 1; // an hour later the address may again
    expect(g.take("s10", "198.51.100.7").ok).toBe(true);
  });
});

describe("S5: model calls per address", () => {
  const reply = JSON.stringify({
    bets: [
      { measures: "calls", answer: { kind: "integer", value: 5 }, rationale: "r" },
      { measures: "totalWaitMs", answer: { kind: "integer", value: 12000 }, rationale: "r" },
      { measures: "outcome", answer: { kind: "enum", value: "throws", options: [...OUTCOME_OPTIONS] }, rationale: "r" },
    ],
  });
  const usage = { promptTokens: 10, completionTokens: 10, usd: 0.0001 };
  const ok = (content: string) => async (): Promise<ChatResult> => ({ ok: true, content, finishReason: "stop", usage });

  it("model rounds: after the per-address limit a new session from the same address is not asked; another address is", async () => {
    let calls = 0;
    const chat = async () => (calls++, ok(reply)());
    const app = createApp({ modelBets: { chat }, trustProxy: true, perClientModelLimits: { modelRoundsPerHour: 2 } });
    const slot = async (session: string, ip: string) => {
      const h = { "content-type": "application/json", "x-atlas-session": session, "x-forwarded-for": ip };
      const t = (await (await app.request("/targets", { method: "POST", headers: h, body: JSON.stringify({ kind: "ts-fixture", ref: FIXTURE_FILE }) })).json()) as { ref: string; codeSha256: string };
      const e = (await (await app.request("/experiments", { method: "POST", headers: h, body: JSON.stringify({ target: t, params: { shape: "retry-scenario", failTimes: 5, failure: "error" } }) })).json()) as { model: { status: string; reason?: string } };
      return e.model;
    };
    expect((await slot("m1", "198.51.100.7")).status).toBe("thinking");
    expect((await slot("m2", "198.51.100.7")).status).toBe("thinking");
    expect(await slot("m3", "198.51.100.7")).toMatchObject({ status: "off", reason: "call limit reached: one client address may ask for 2 model rounds an hour" });
    expect((await slot("m4", "203.0.113.9")).status).toBe("thinking");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(3);
  });

  it("investigations: after the per-address limit a new session from the same address is not asked", async () => {
    let calls = 0;
    const chat = async () => (calls++, ok(JSON.stringify({ findings: [] }))());
    const app = createApp({ investigator: { chat, fallbackModel: null }, trustProxy: true, perClientModelLimits: { investigationsPerHour: 1 } });
    const ask = async (session: string, ip: string) => {
      const h = { "content-type": "application/json", "x-atlas-session": session, "x-forwarded-for": ip };
      const t = (await (await app.request("/targets", { method: "POST", headers: h, body: JSON.stringify({ kind: "ts-fixture", ref: FIXTURE_FILE }) })).json()) as { ref: string; codeSha256: string };
      return (await (await app.request("/investigate", { method: "POST", headers: h, body: JSON.stringify({ target: t }) })).json()) as { ok: boolean; reason?: string };
    };
    const first = await ask("i1", "198.51.100.7");
    expect(first.reason ?? "").not.toMatch(/client address/);
    const before = calls;
    expect((await ask("i2", "198.51.100.7")).reason).toBe("not asked (call limit reached: one client address may ask for 1 investigations an hour)");
    expect(calls).toBe(before); // no model call was made
    expect((await ask("i3", "203.0.113.9")).reason ?? "").not.toMatch(/client address/);
  });
});
