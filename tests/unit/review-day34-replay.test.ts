// S5 (days 3–4 review): GET /replay of an EVM run is capped at once and per hour, per session and
// across the server, with 429 and a plain reason. The fork is a stand-in (no anvil, no RPC).

import { describe, expect, it } from "vitest";
import { createReplayGate, DEFAULT_REPLAY_LIMITS, replayLimitsFromEnv } from "../../server/replay-limits";
import type { Experiment, Run } from "../../src/types";
import { level2Round, liveRunFor } from "../tools/review-fixtures";

/** A stand-in fork: the round's run returns at once; each replay waits until released. */
function heldFork() {
  let calls = 0;
  const waiting: Array<() => void> = [];
  const evmRun = async (exp: Experiment): Promise<Run> => {
    if (++calls > 1) await new Promise<void>((r) => waiting.push(r));
    return liveRunFor(exp);
  };
  return { evmRun, releaseAll: () => waiting.splice(0).forEach((r) => r()), calls: () => calls };
}

const replay = (app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> }, runId: string, session?: string) =>
  Promise.resolve(app.request(`/replay/${runId}`, { headers: session ? { "x-atlas-session": session } : {} }));
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("S5: EVM replays are capped", () => {
  it("defaults are small, and the environment can set them (bad values keep the default)", () => {
    expect(DEFAULT_REPLAY_LIMITS).toEqual({ globalConcurrent: 1, globalPerHour: 10, sessionConcurrent: 1, sessionPerHour: 3 });
    expect(replayLimitsFromEnv({ ATLAS_REPLAY_MAX_CONCURRENT: "2", ATLAS_REPLAY_SESSION_MAX_PER_HOUR: "5", ATLAS_REPLAY_MAX_PER_HOUR: "lots" })).toEqual({ ...DEFAULT_REPLAY_LIMITS, globalConcurrent: 2, sessionPerHour: 5 });
  });

  it("at once: a second replay while one runs gets 429 (per session, then across the server)", async () => {
    // Before the fix: every parallel GET /replay started its own fork.
    const f = heldFork();
    const gate = createReplayGate({ globalConcurrent: 2, globalPerHour: 100, sessionConcurrent: 1, sessionPerHour: 100 });
    const { app, r } = await level2Round(f.evmRun, { replayGate: gate });
    const id = r.body.run.id;
    const first = replay(app, id, "s1");
    await tick();
    const same = await replay(app, id, "s1");
    expect(same.status).toBe(429);
    expect(((await same.json()) as { error: string }).error).toMatch(/this session runs at most 1 EVM replay\(s\) at once/);
    const other = replay(app, id, "s2");
    await tick();
    const third = await replay(app, id, "s3");
    expect(third.status).toBe(429);
    expect(((await third.json()) as { error: string }).error).toMatch(/the server runs at most 2 EVM replay\(s\) at once/);
    f.releaseAll();
    expect((await first).status).toBe(200);
    expect((await other).status).toBe(200);
    expect(f.calls()).toBe(3); // the round + 2 replays; the refused ones never reached the fork
    const again = replay(app, id, "s1"); // the slot was given back
    await tick();
    f.releaseAll();
    expect((await again).status).toBe(200);
  });

  it("per hour: the session's and the server's hourly caps, then a fresh hour", async () => {
    let t = 1_000_000;
    const gate = createReplayGate({ globalConcurrent: 5, globalPerHour: 3, sessionConcurrent: 5, sessionPerHour: 2 }, () => t);
    const { app, r } = await level2Round(async (exp) => liveRunFor(exp), { replayGate: gate });
    const id = r.body.run.id;
    expect((await replay(app, id, "a")).status).toBe(200);
    expect((await replay(app, id, "a")).status).toBe(200);
    const a3 = await replay(app, id, "a");
    expect(a3.status).toBe(429);
    expect(((await a3.json()) as { error: string }).error).toMatch(/this session may start 2 EVM replays an hour/);
    expect((await replay(app, id, "b")).status).toBe(200);
    const b2 = await replay(app, id, "b");
    expect(b2.status).toBe(429);
    expect(((await b2.json()) as { error: string }).error).toMatch(/the server allows 3 EVM replays an hour/);
    t += 60 * 60 * 1000 + 1;
    expect((await replay(app, id, "a")).status).toBe(200);
  });

  it("an EVM replay without the session header is refused (the per-session cap must not be skipped)", async () => {
    const { app, r } = await level2Round(async (exp) => liveRunFor(exp));
    const res = await replay(app, r.body.run.id);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/needs the x-atlas-session header/);
  });
});
