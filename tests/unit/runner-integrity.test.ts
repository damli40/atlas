// Review findings S1, S2, S6, S7 (day-1 adversarial review): the sandboxed TS runner must
// - hand back a large result whole (no cut at 64 KB),
// - not let the code under test forge or overwrite its own result,
// - not report "never settles" while the code still has a real timer pending (ref'd or unref'd),
// - run the never-settles row S6 in the control.
// Same-process isolation is best effort, not a security boundary: see runners/ts/worker.ts.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Experiment, Target } from "../../src/types.ts";
import { CONTROL_CASES, parseWorkerOutput, runControl, tsRunner } from "../../runners/ts/control.ts";
import { runScenario, type RetryFn } from "../../runners/ts/harness.ts";

const code = readFileSync(new URL("../fixtures/with-rpc-retry.ts", import.meta.url), "utf8");
const target: Target = { kind: "ts-fixture", ref: "tests/fixtures/with-rpc-retry.ts", codeSha256: createHash("sha256").update(code).digest("hex") };

describe("result size: a big result arrives whole", () => {
  it("300 attempts with no delay: 300 calls measured, not a parse error", async () => {
    const exp: Experiment = {
      id: "big",
      target,
      runner: "ts",
      params: { shape: "retry-scenario", failTimes: "always", failure: "error", attempts: 300, delayMs: 0 },
      proposedBy: { role: "human" },
      gate: { allowed: true },
    };
    const run = await tsRunner().run(exp, { seed: "s" });
    expect(run.controlPassed).toBe(true);
    expect(run.result.measured.calls).toBe(300);
    expect(run.result.measured.outcome).toBe("throws");
    expect(run.result.measured.thrownFromCall).toBe(300);
  });
});

describe("tampering: the code under test cannot rewrite its own result", () => {
  it("a broken target that patches process.stdout.write to print the oracle's numbers does not pass the control", async () => {
    const broken = `
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (s, ...rest) => {
  if (typeof s === "string" && s.includes("ATLAS_RESULT ")) {
    const i = s.indexOf("{");
    const out = JSON.parse(s.slice(i));
    for (const r of out.runs) {
      if (r.id === "S1") Object.assign(r.result.measured, { calls: 1, waitsMs: "", totalWaitMs: 0, logCount: 0, logAttempts: "", outcome: "returns", returned: JSON.stringify("the value") });
      if (r.id === "S3") Object.assign(r.result.measured, { calls: 5, waitsMs: "3000,3000,3000,3000", totalWaitMs: 12000, logCount: 4, logAttempts: "1/5,2/5,3/5,4/5", outcome: "throws", thrownFromCall: 5 });
    }
    return realWrite(s.slice(0, i) + JSON.stringify(out) + "\\n", ...rest);
  }
  return realWrite(s, ...rest);
};
export async function withRpcRetry() { return "nope"; }
`;
    const { run } = await runControl(broken);
    expect(run.controlPassed).toBe(false);
  });

  it("a forged result line printed from an exit handler is ignored (it lacks the per-run marker)", async () => {
    const forged = code + `\nprocess.on("exit", () => { process.stdout.write('\\nATLAS_RESULT {"runs":[]}\\n'); });\n`;
    const { run, reason } = await runControl(forged);
    expect(run.controlPassed, reason).toBe(true);
  });

  it("a malformed forged line makes runControl return controlPassed=false or ignore it, never throw", async () => {
    const malformed = code + `\nprocess.on("exit", () => { process.stdout.write('\\nATLAS_RESULT {not json\\n'); });\n`;
    const { run } = await runControl(malformed);
    expect(typeof run.controlPassed).toBe("boolean");
  });

  it("a target that defines Object.prototype.toJSON (to rewrite the result as it is written) does not pass", async () => {
    const sneaky = code + `\nObject.defineProperty(Object.prototype, "toJSON", { value() { return this; }, configurable: true });\n`;
    const { run, reason } = await runControl(sneaky);
    expect(run.controlPassed).toBe(false);
    expect(reason).toMatch(/tamper/i);
  });

  it("the parser takes only the first marker line; a second marker line or bad JSON counts as tampering", () => {
    const m = "f".repeat(32);
    const good = `noise\nATLAS_RESULT ${m} {"runs":[]}\n`;
    expect(parseWorkerOutput(good, m)).toEqual({ ok: true, runs: [] });
    const twice = `${good}ATLAS_RESULT ${m} {"runs":[]}\n`;
    const r2 = parseWorkerOutput(twice, m);
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.tampered).toBe(true);
    const bad = `ATLAS_RESULT ${m} {not json\n`;
    const r3 = parseWorkerOutput(bad, m);
    expect(r3.ok).toBe(false);
    expect(!r3.ok && r3.tampered).toBe(true);
    // A line without the marker is the code's own output and is ignored.
    expect(parseWorkerOutput(`ATLAS_RESULT {"runs":[{"id":"x"}]}\n`, m)).toMatchObject({ ok: false, tampered: false });
  });
});

describe("real timers: 'never settles' only when nothing at all is pending", () => {
  it("an UNREF'd real timer the code waits on is can't check, not 'pending'", async () => {
    const unrefTarget: RetryFn = async (_l, fn) => {
      await new Promise<void>((r) => {
        setTimeout(r, 20).unref();
      });
      return fn();
    };
    const out = await runScenario(unrefTarget, { failTimes: 0, failure: "error" }, { seed: "s" });
    expect(out.result.measured.outcome).toBeUndefined();
    expect(out.result.notMeasured.outcome).toMatch(/real timer|does not control/);
    await new Promise((r) => setTimeout(r, 40));
  });

  it("an unref'd setInterval is can't check too", async () => {
    let h: ReturnType<typeof setInterval> | undefined;
    const t: RetryFn = async (_l, fn) => {
      await new Promise<void>((r) => {
        h = setInterval(r, 20);
        h.unref();
      });
      return fn();
    };
    const out = await runScenario(t, { failTimes: 0, failure: "error" }, { seed: "s" });
    clearInterval(h);
    expect(out.result.measured.outcome).toBeUndefined();
  });

  it("the code's own setImmediate is waited for (it always runs on the next turn), so the outcome is measured", async () => {
    const imm: RetryFn = async (_l, fn) => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      return fn();
    };
    const out = await runScenario(imm, { failTimes: 0, failure: "error" }, { seed: "s" });
    expect(out.result.measured.outcome).toBe("returns");
  });

  it("negative waits are not added up as if time passed", async () => {
    const out = await runScenario(
      (async (_l, fn, o) => {
        try {
          return await fn();
        } catch {
          await o.sleep!(-3000);
          return fn();
        }
      }) as RetryFn,
      { failTimes: 1, failure: "error" },
      { seed: "s" },
    );
    expect(out.result.measured.totalWaitMs).toBeUndefined();
    expect(out.result.notMeasured.totalWaitMs).toMatch(/negative/);
  });
});

describe("control covers the never-settles path", () => {
  it("CONTROL_CASES includes S6 alongside S1 and S3", () => {
    expect([...CONTROL_CASES]).toEqual(["S1", "S3", "S6"]);
  });

  it("code that gives up on a call that never answers passes S1 and S3 but fails the control on S6", async () => {
    // The edit races each call against a few microtask hops (no timer, so S1 and S3 are unchanged).
    // Only a call that never answers (S6) loses the race, so only S6 can catch this edit.
    const edited = code.replace(
      "export async function withRpcRetry<T>(",
      "export async function withRpcRetry<T>(...a: any[]) { const [l, fn, o] = a; const giveUp = async () => { for (let i = 0; i < 50; i++) await null; throw new Error('gave up'); }; return _orig(l, () => Promise.race([fn(), giveUp()]), o); }\nasync function _orig<T>(",
    );
    expect(edited).not.toBe(code);
    const { run, reason } = await runControl(edited);
    expect(run.controlPassed).toBe(false);
    expect(reason).toMatch(/S6: /);
    expect(reason).not.toMatch(/S1: |S3: /);
  });
});
