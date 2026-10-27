import { describe, expect, it } from "vitest";
import oracle from "../oracle/retry-oracle.json";
import { withRpcRetry } from "../fixtures/with-rpc-retry.ts";
import { NEVER_SETTLED_REASON, runScenario, type RetryFn } from "../../runners/ts/harness.ts";
import { SUCCESS_VALUE, scenarioFromOracleInput, type OracleInput } from "../../runners/ts/shapes.ts";

const target = withRpcRetry as RetryFn;
const SEED = "atlas-d01-04";
type Case = (typeof oracle.cases)[number];
const byId = (id: string): Case => {
  const c = oracle.cases.find((x) => x.id === id);
  if (!c) throw new Error(`oracle has no case ${id}`);
  return c;
};

async function runCase(id: string, seed = SEED) {
  const c = byId(id);
  const start = performance.now();
  const out = await runScenario(target, scenarioFromOracleInput(c.input as OracleInput), { seed, watchLimitMs: oracle.harnessWatchLimitMs });
  return { c, out, wallMs: performance.now() - start };
}

describe("TS harness against the oracle table (real withRpcRetry, virtual clock)", () => {
  for (const id of ["S1", "S2", "S3", "S4", "S5", "S6", "H2"]) {
    it(`${id}: calls, waits, log lines and outcome match the oracle row`, async () => {
      const { c, out, wallMs } = await runCase(id);
      const m = out.result.measured;
      const e = c.expected;
      expect(m.calls, "calls").toBe(e.calls);
      expect(m.waitsMs, "waits").toBe(e.waitsMs.join(","));
      expect(m.totalWaitMs, "total wait").toBe(e.totalWaitMs);
      expect(m.logCount, "log count").toBe(e.logCount);
      expect(m.logAttempts, "log attempts").toBe(e.logAttempts.join(","));
      expect(m.outcome, "outcome").toBe(e.outcome);
      if (e.outcome === "returns") {
        const want = "returns" in e && typeof e.returns === "object" ? e.returns : SUCCESS_VALUE;
        expect(m.returned).toBe(JSON.stringify(want));
      }
      if (e.outcome === "throws") {
        // "throws the 5th error" / "the 3rd error": the error from the last call is the one thrown.
        expect(m.thrownFromCall).toBe(e.calls);
      }
      // eslint-disable-next-line no-console
      console.log(`${id} measured ${JSON.stringify(m)} wall=${wallMs.toFixed(1)}ms`);
    });
  }

  it("S6: reports pending with the harness-limit wording, in under 200 ms real time", async () => {
    const { out, wallMs } = await runCase("S6");
    expect(out.result.measured.outcome).toBe("pending");
    expect(out.result.measured.calls).toBe(1);
    expect(out.result.measured.totalWaitMs).toBe(0);
    expect(out.result.notMeasured.settleTime).toBe(NEVER_SETTLED_REASON);
    expect(wallMs).toBeLessThan(200);
  });

  it("S3: 12,000 virtual ms complete in under 200 ms of wall-clock time (no real sleeping)", async () => {
    const { out, wallMs } = await runCase("S3");
    expect(out.result.measured.totalWaitMs).toBe(12000);
    expect(out.result.measured.settledAtMs).toBe(12000);
    expect(wallMs).toBeLessThan(200);
  });

  it("H1 (held out, not in the acceptance list): resolves after 20,000 virtual ms with no waits", async () => {
    const { c, out } = await runCase("H1");
    expect(out.result.measured.calls).toBe(c.expected.calls);
    expect(out.result.measured.totalWaitMs).toBe(0);
    expect(out.result.measured.outcome).toBe("returns");
    expect(out.result.measured.settledAtMs).toBe(20000);
  });

  it("same seed gives deep-equal traces across two runs; a different seed changes the errors", async () => {
    const a = await runCase("S3", "seed-A");
    const b = await runCase("S3", "seed-A");
    const other = await runCase("S3", "seed-B");
    expect(a.out.trace).toEqual(b.out.trace);
    expect(a.out.result).toEqual(b.out.result);
    expect(other.out.trace).not.toEqual(a.out.trace);
  });

  it("S3: the five errors are all different", async () => {
    const { out } = await runCase("S3");
    const errors = out.trace.filter((t) => t.event === "reject").map((t) => t.data?.error);
    expect(errors).toHaveLength(5);
    expect(new Set(errors).size).toBe(5);
  });

  it("reports can't-check (not 'pending') when the code waits on a real timer the harness does not control", async () => {
    // A stand-in that ignores the injected sleep and uses a real timer: the leak plan section 10 item 7 warns about.
    const leaky: RetryFn = async (_label, fn) => {
      try {
        return await fn();
      } catch {
        await new Promise<void>((r) => setTimeout(r, 50));
        return fn();
      }
    };
    const out = await runScenario(leaky, { failTimes: 1, failure: "error" }, { seed: SEED });
    expect(out.result.measured.outcome).toBeUndefined();
    expect(out.result.notMeasured.outcome).toMatch(/does not control \(.*Timeout.*\)/);
    await new Promise((r) => setTimeout(r, 60)); // let the stray timer finish before the next test
  });

  it("stops at the virtual watch limit when the code would wait past it", async () => {
    const out = await runScenario(target, { failTimes: "always", failure: "error", attempts: 20 }, { seed: SEED, watchLimitMs: 30000 });
    expect(out.result.measured.outcome).toBe("pending");
    expect(out.result.notMeasured.settleTime).toMatch(/not settled within 30000 ms of virtual time/);
  });
});
