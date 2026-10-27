import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Experiment, Target } from "../../src/types.ts";
import { control, controlReason, runControl, tsRunner } from "../../runners/ts/control.ts";

const FIXTURE_REF = "tests/fixtures/with-rpc-retry.ts";
const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const target: Target = { kind: "ts-fixture", ref: FIXTURE_REF, codeSha256: createHash("sha256").update(code).digest("hex") };

describe("TS control (oracle rows S1 and S3 through the local executor)", () => {
  it("passes on the unedited fixture", async () => {
    const run = await control(target);
    expect(run.controlPassed, controlReason(run)).toBe(true);
    expect(run.executor).toBe("local");
    expect(run.result.measured["S1.calls"]).toBe(1);
    expect(run.result.measured["S3.calls"]).toBe(5);
    expect(run.result.measured["S3.totalWaitMs"]).toBe(12000);
    expect(run.result.measured["S3.thrownFromCall"]).toBe(5);
  });

  it("does not pass on a scratch copy with the attempts default changed to 3, and says why", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-edited-fixture-"));
    try {
      const edited = code.replace("export const RPC_RETRY_ATTEMPTS = 5;", "export const RPC_RETRY_ATTEMPTS = 3;");
      expect(edited).not.toBe(code);
      const path = join(dir, "with-rpc-retry.ts");
      writeFileSync(path, edited);
      const { run, reason } = await runControl(readFileSync(path, "utf8"));
      expect(run.controlPassed).toBe(false);
      expect(reason).toContain("S3: calls was 3, the oracle row says 5");
      expect(reason).not.toContain("S1:");
      expect(controlReason(run)).toBe(reason);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not pass when the code's SHA-256 is not the target's", async () => {
    const { run, reason } = await runControl(code, { expectedSha256: "0".repeat(64) });
    expect(run.controlPassed).toBe(false);
    expect(reason).toMatch(/is not the target's/);
  });

  it("does not pass when the sandbox runs out of wall-clock time", async () => {
    const { run, reason } = await runControl(code, { wallClockMs: 1 });
    expect(run.controlPassed).toBe(false);
    expect(reason).toMatch(/wall-clock limit/);
  });

  it("the Runner runs an experiment in the sandbox after a passing control (S6 shape)", async () => {
    const exp: Experiment = {
      id: "exp-s6",
      target,
      runner: "ts",
      params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" },
      proposedBy: { role: "human" },
      gate: { allowed: true },
    };
    const run = await tsRunner().run(exp, { seed: "s" });
    expect(run.controlPassed).toBe(true);
    expect(run.result.measured.outcome).toBe("pending");
    expect(run.result.measured.calls).toBe(1);
    expect(run.result.notMeasured.settleTime).toMatch(/never settled/);
  });
});
