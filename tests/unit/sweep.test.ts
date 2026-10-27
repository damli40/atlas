// D06-02: "concurrency-sweep" through the real sandbox. 1 to 200 callers each call the real
// withRpcRetry with the same failure pattern, on one virtual clock. Nothing here assumes the schedule:
// the expected wave times are derived from the fixture's own constants (RPC_RETRY_ATTEMPTS, RPC_RETRY_DELAY_MS).

import { describe, expect, it } from "vitest";
import { SWEEP_GATE_CONTEXT, gate } from "../../src/gate.ts";
import { notShownAsFact } from "../../src/trust.ts";
import type { Experiment, ExperimentShape, Run, Target } from "../../src/types.ts";
import { control, runExperiment } from "../../runners/ts/control.ts";
import { RPC_RETRY_ATTEMPTS, RPC_RETRY_DELAY_MS } from "../fixtures/with-rpc-retry.ts";
import { bucketCallTimes, parseCallTimes, shareInWaves } from "../../web/screens/scale-model.ts";

const FIXTURE_SHA256 = "f3d2c59f05151be85d8a950c009e63de8015e638d3af6f2fd1c2a729393ad101";
const target: Target = { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts", codeSha256: FIXTURE_SHA256 };

function experiment(params: unknown): Experiment {
  const d = gate(params, SWEEP_GATE_CONTEXT);
  if (!d.allowed) throw new Error(d.reason);
  return { id: "sweep-test", target, runner: "ts", params: d.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

let ctl: Run | undefined;
async function sweep(params: Omit<Extract<ExperimentShape, { shape: "concurrency-sweep" }>, "shape">, seed = "sweep-seed") {
  ctl ??= await control(target);
  const t0 = performance.now();
  const run = await runExperiment(experiment({ shape: "concurrency-sweep", ...params }), ctl, { seed });
  return { run, wallMs: performance.now() - t0 };
}

/** The wave times the fixture's own constants imply when every call fails: one per attempt, DELAY apart. */
const allFailWaves = Array.from({ length: RPC_RETRY_ATTEMPTS }, (_, i) => i * RPC_RETRY_DELAY_MS);

describe("concurrency-sweep (D06-02), real withRpcRetry in the sandbox", () => {
  it("the gate allows 1..200 callers and refuses 0 and 201", () => {
    expect(gate({ shape: "concurrency-sweep", callers: 1, failTimes: 3, failure: "error" }, SWEEP_GATE_CONTEXT).allowed).toBe(true);
    expect(gate({ shape: "concurrency-sweep", callers: 200, failTimes: "always", failure: "error" }, SWEEP_GATE_CONTEXT).allowed).toBe(true);
    for (const callers of [0, 201]) {
      const d = gate({ shape: "concurrency-sweep", callers, failTimes: 3, failure: "error" }, SWEEP_GATE_CONTEXT);
      expect(d.allowed).toBe(false);
      expect(!d.allowed && d.reason).toMatch(/callers .* is outside the allowed range \(1 to 200\)/);
    }
    // The sweep context allows the sweep only: no retry-scenario rides along on this route.
    expect(gate({ shape: "retry-scenario", failTimes: 1, failure: "error" }, SWEEP_GATE_CONTEXT).allowed).toBe(false);
  });

  it("200 callers, the first 3 calls fail: 4 waves at 0, 3,000, 6,000, 9,000 ms virtual, 100% of calls in them, under 5 s real", async () => {
    const { run, wallMs } = await sweep({ callers: 200, failTimes: 3, failure: "error" });
    expect(notShownAsFact(run), "the control passed and the run finished").toBeNull();
    const m = run.result.measured;
    expect(m.callTimesMs).toBe("0:200,3000:200,6000:200,9000:200");
    expect(m.calls).toBe(800);
    expect(m.waveCount).toBe(4);
    expect(m.sameScheduleCallers).toBe(200);
    expect(m.returnedCount).toBe(200);
    expect(m.lastSettledAtMs).toBe(9000);
    expect(shareInWaves(parseCallTimes(String(m.callTimesMs)), [0, 3000, 6000, 9000])).toBeGreaterThanOrEqual(0.95);
    expect(wallMs).toBeLessThan(5000);
  });

  it("200 callers, every call fails: one wave per attempt (5, the 5th at 12,000 ms), every caller throws at 12,000 ms", async () => {
    const { run, wallMs } = await sweep({ callers: 200, failTimes: "always", failure: "error" });
    expect(notShownAsFact(run)).toBeNull();
    const m = run.result.measured;
    expect(parseCallTimes(String(m.callTimesMs))).toEqual(allFailWaves.map((t) => ({ t, count: 200 })));
    expect(allFailWaves).toEqual([0, 3000, 6000, 9000, 12000]);
    expect(m.callerWaitsMs).toBe("3000,3000,3000,3000");
    expect(m.threwCount).toBe(200);
    expect(m.lastSettledAtMs).toBe(12000);
    // The four waits sit between the five waves: the first four waves alone hold 80% of the calls.
    expect(shareInWaves(parseCallTimes(String(m.callTimesMs)), [0, 3000, 6000, 9000])).toBeCloseTo(0.8, 5);
    expect(wallMs).toBeLessThan(5000);
  });

  it("1 caller makes the same schedule as 200: the wave size is the caller count", async () => {
    const one = (await sweep({ callers: 1, failTimes: 3, failure: "error" })).run.result.measured;
    expect(one.callTimesMs).toBe("0:1,3000:1,6000:1,9000:1");
    expect(one.largestWave).toBe(1);
  });

  it("same seed, same run; the sweep replays deep-equal", async () => {
    const a = (await sweep({ callers: 50, failTimes: "always", failure: "error" }, "same")).run;
    const b = (await sweep({ callers: 50, failTimes: "always", failure: "error" }, "same")).run;
    expect(b.result).toEqual(a.result);
    expect(b.trace).toEqual(a.trace);
  });

  it("a delay that would run past Atlas's watch limit is can't check, not a made-up schedule", async () => {
    const { run } = await sweep({ callers: 10, failTimes: "always", failure: "error", delayMs: 60000 });
    expect(run.result.measured.callTimesMs).toBeUndefined();
    expect(run.result.notMeasured.callTimesMs).toMatch(/watch limit/);
  });

  it("buckets call times for the chart: every call lands in a bucket, nothing invented", () => {
    const b = bucketCallTimes([{ t: 0, count: 200 }, { t: 3000, count: 200 }, { t: 12000, count: 7 }], 250);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(407);
    expect(b.find((x) => x.from === 3000)?.count).toBe(200);
    expect(b.find((x) => x.from === 250)?.count).toBe(0);
    expect(b.at(-1)?.from).toBe(12000);
  });
});

describe("POST /sweeps (D06-02)", () => {
  async function setup() {
    const { createApp } = await import("../../server/app");
    const refusals: { kind: string; reason: string }[] = [];
    const app = createApp({ refusals: (r) => void refusals.push(r as { kind: string; reason: string }) });
    const post = (path: string, body: unknown) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-session": "sweep-srv" }, body: JSON.stringify(body) });
    const t = (await (await post("/targets", { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts" })).json()) as Target;
    return { post, refusals, target: { ref: t.ref, codeSha256: t.codeSha256 } };
  }

  it("runs 200 callers after the control and returns the measured call times", async () => {
    const { post, target } = await setup();
    const res = await post("/sweeps", { target, params: { shape: "concurrency-sweep", callers: 200, failTimes: 3, failure: "error" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: Run; control: { passed: boolean } };
    expect(body.control.passed).toBe(true);
    expect(body.run.controlPassed).toBe(true);
    expect(body.run.result.measured.callTimesMs).toBe("0:200,3000:200,6000:200,9000:200");
  });

  it("the gate decides: 201 callers and a retry-scenario are refused (422) and recorded, nothing runs", async () => {
    const { post, target, refusals } = await setup();
    const over = await post("/sweeps", { target, params: { shape: "concurrency-sweep", callers: 201, failTimes: 3, failure: "error" } });
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: string }).error).toMatch(/callers 201 is outside the allowed range/);
    const other = await post("/sweeps", { target, params: { shape: "retry-scenario", failTimes: 3, failure: "error" } });
    expect(other.status).toBe(422);
    expect(refusals.map((r) => r.kind)).toEqual(["gate_rejection", "gate_rejection"]);
  });

  it("an unregistered target is refused", async () => {
    const { post } = await setup();
    const res = await post("/sweeps", { target: { ref: "tests/fixtures/with-rpc-retry.ts", codeSha256: "0".repeat(64) }, params: { shape: "concurrency-sweep", callers: 2, failTimes: 1, failure: "error" } });
    expect(res.status).toBe(400);
  });
});
