// POST /runs on the EVM runner is capped at once and per hour, per session and across the server
// (the open item in tests/evidence/D04-review/README.md), in the same style as the /replay caps (S5).
// The fork is a stand-in (no anvil, no RPC); no model is asked.

import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createProofStore } from "../../server/evm-round";
import { createRunGate, DEFAULT_RUN_LIMITS, runLimitsFromEnv } from "../../server/replay-limits";
import type { Experiment, Run } from "../../src/types";
import { liveRunFor, PR } from "../tools/review-fixtures";

const tick = () => new Promise((r) => setTimeout(r, 5));

/** A stand-in fork whose runs wait until released. */
function heldFork() {
  let calls = 0;
  const waiting: Array<() => void> = [];
  const evmRun = async (exp: Experiment): Promise<Run> => {
    calls++;
    await new Promise<void>((r) => waiting.push(r));
    return liveRunFor(exp);
  };
  return { evmRun, releaseAll: () => waiting.splice(0).forEach((r) => r()), calls: () => calls };
}

function server(evmRun: (exp: Experiment) => Promise<Run>, runGate = createRunGate()) {
  const app = createApp({ fetchPr: async () => PR, evmRun, runGate, proofs: createProofStore({ publish: false }) });
  /** One sealed round in `session`, ready to run. Returns the experiment id. */
  const ready = async (session: string) => {
    const h = { "content-type": "application/json", "x-atlas-session": session };
    const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) })).json() as Promise<any>;
    const t = await post("/targets", { kind: "github-pr", ref: PR.target.ref });
    const f = (await post("/findings", { target: { ref: t.ref, codeSha256: t.codeSha256 }, file: "proposals/ChainlinkOracleConfigs.sol", lineStart: 42, lineEnd: 42 })).finding;
    const e = await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "apply-proposal-then-read", markets: "touched" }, findingId: f.id });
    await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "priceUsd1e18:cbETH", answer: { kind: "number", value: 2200 } }] });
    return e.experiment.id as string;
  };
  const run = (session: string, experimentId: string) =>
    Promise.resolve(app.request("/runs", { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": session }, body: JSON.stringify({ experimentId }) }));
  return { app, ready, run };
}

describe("POST /runs: EVM runs are capped", () => {
  it("defaults, and the environment can set them (bad values keep the default)", () => {
    expect(DEFAULT_RUN_LIMITS).toEqual({ globalConcurrent: 2, globalPerHour: 20, sessionConcurrent: 1, sessionPerHour: 6, ipConcurrent: 2, ipPerHour: 8, reservedForNewClients: 4 }); // day-5 S5 added the last three
    expect(runLimitsFromEnv({ ATLAS_RUNS_MAX_CONCURRENT: "3", ATLAS_RUNS_SESSION_MAX_PER_HOUR: "2", ATLAS_RUNS_MAX_PER_HOUR: "-1" })).toEqual({ ...DEFAULT_RUN_LIMITS, globalConcurrent: 3, sessionPerHour: 2 });
    // The replay variables do not move the run caps.
    expect(runLimitsFromEnv({ ATLAS_REPLAY_MAX_CONCURRENT: "9" })).toEqual(DEFAULT_RUN_LIMITS);
  });

  it("at once: a second run in the same session, then a third across the server, get 429 with the reason; the refused round stays open", async () => {
    const f = heldFork();
    const s = server(f.evmRun, createRunGate({ globalConcurrent: 2, globalPerHour: 100, sessionConcurrent: 1, sessionPerHour: 100 }));
    const a1 = await s.ready("a");
    const a2 = await s.ready("a");
    const b1 = await s.ready("b");
    const c1 = await s.ready("c");
    const first = s.run("a", a1);
    await tick();
    const same = await s.run("a", a2);
    expect(same.status).toBe(429);
    expect(((await same.json()) as { error: string }).error).toBe("run not started: this session runs at most 1 EVM run(s) at once and one is running");
    const other = s.run("b", b1);
    await tick();
    const third = await s.run("c", c1);
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toMatch(/the server runs at most 2 EVM run\(s\) at once/);
    expect(f.calls()).toBe(2); // the refused runs never reached the fork
    f.releaseAll();
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
    // The refused round was not frozen: once the slot is free it runs.
    const retry = s.run("a", a2);
    await tick();
    f.releaseAll();
    expect((await retry).status).toBe(200);
  });

  it("per hour: the session's and the server's hourly caps, then a fresh hour", async () => {
    let t = 1_000_000;
    const s = server(async (exp) => liveRunFor(exp), createRunGate({ globalConcurrent: 5, globalPerHour: 3, sessionConcurrent: 5, sessionPerHour: 2 }, () => t));
    const ids = { a: [await s.ready("a"), await s.ready("a"), await s.ready("a")], b: [await s.ready("b"), await s.ready("b")] };
    expect((await s.run("a", ids.a[0]!)).status).toBe(200);
    expect((await s.run("a", ids.a[1]!)).status).toBe(200);
    const over = await s.run("a", ids.a[2]!);
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toMatch(/this session may start 2 EVM runs an hour/);
    expect((await s.run("b", ids.b[0]!)).status).toBe(200);
    const server3 = await s.run("b", ids.b[1]!);
    expect(server3.status).toBe(429);
    expect(((await server3.json()) as { error: string }).error).toMatch(/the server allows 3 EVM runs an hour/);
    t += 60 * 60 * 1000 + 1;
    expect((await s.run("a", ids.a[2]!)).status).toBe(200);
  });

  it("a run that throws gives its slot back", async () => {
    let fail = true;
    const s = server(
      async (exp) => {
        if (fail) throw new Error("fork failed");
        return liveRunFor(exp);
      },
      createRunGate({ globalConcurrent: 1, globalPerHour: 100, sessionConcurrent: 1, sessionPerHour: 100 }),
    );
    const x = await s.ready("a");
    const y = await s.ready("a");
    expect((await s.run("a", x)).status).toBe(503); // final review S2: "the run did not finish", try again
    fail = false;
    expect((await s.run("a", y)).status).toBe(200);
  });

  it("the TS sandbox runs are not capped by this gate", async () => {
    const gate = createRunGate({ globalConcurrent: 0, globalPerHour: 0, sessionConcurrent: 0, sessionPerHour: 0 });
    const app = createApp({ runGate: gate, proofs: createProofStore({ publish: false }) });
    const h = { "content-type": "application/json", "x-atlas-session": "ts" };
    const post = async (path: string, body: unknown) => {
      const r = await app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const t = (await post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).body;
    const e = (await post("/experiments", { target: { ref: t.ref, codeSha256: t.codeSha256 }, params: { shape: "retry-scenario", failTimes: "always", failure: "error" } })).body;
    await post("/bets", { experimentId: e.experiment.id, who: "human", bets: [{ measures: "calls", answer: { kind: "integer", value: 5 } }] });
    expect((await post("/runs", { experimentId: e.experiment.id })).status).toBe(200);
  });
});
