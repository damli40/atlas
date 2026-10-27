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
import { resultMac } from "../../runners/ts/call-runner.ts";
import { localExecutor } from "../../runners/executor/local.ts";
import type { Executor } from "../../runners/runner.ts";
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
    // Day-6 B1: the built-in snapshot now names what changed, in plain words.
    expect(reason).toMatch(/changed JavaScript's built-in objects.*Object\.prototype/);
  });

  // E1 review round 1: the marker became a per-run key on stdin, and a result line carries HMAC(key, json).
  it("the parser counts only lines signed with the run's key; two signed lines or bad JSON count as tampering", () => {
    const key = "f".repeat(64);
    const signed = (body: string) => `ATLAS_RESULT ${resultMac(key, body)} ${body}`;
    const good = `noise\n${signed('{"runs":[]}')}\n`;
    expect(parseWorkerOutput(good, key)).toEqual({ ok: true, runs: [] });
    const r2 = parseWorkerOutput(`${good}${signed('{"runs":[]}')}\n`, key);
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.tampered).toBe(true);
    const r3 = parseWorkerOutput(`${signed("{not json")}\n`, key);
    expect(r3.ok).toBe(false);
    expect(!r3.ok && r3.tampered).toBe(true);
    // A line that does not carry this run's key is the code's own output: ignored, never a result.
    expect(parseWorkerOutput(`ATLAS_RESULT {"runs":[{"id":"x"}]}\n`, key)).toMatchObject({ ok: false, tampered: false });
    expect(parseWorkerOutput(`ATLAS_RESULT ${"0".repeat(64)} {"runs":[]}\n`, key)).toMatchObject({ ok: false, tampered: false });
    expect(parseWorkerOutput(good, "e".repeat(64))).toMatchObject({ ok: false, tampered: false });
    // A guessed line next to the real one is ignored; the real one still counts.
    expect(parseWorkerOutput(`ATLAS_RESULT ${"1".repeat(64)} {"runs":[{"id":"S1"}]}\n${good}`, key)).toEqual({ ok: true, runs: [] });
  });

  // E1 review round 1 (B1) on the retry path: the reviewer's forge, adapted to a changed withRpcRetry. It reads the
  // command line from process.report (the old marker lived there), writes a result claiming S1-S6 matched, and ends
  // the process before the worker can write. The key is not on the command line, so the line cannot verify.
  it("a changed withRpcRetry that forges a result from process.report and exits early does not pass the control", async () => {
    const forge = `
// Every field the control compares, set to the oracle's answer: on the old marker channel this forged line PASSED the control.
const M = {
  S1: { calls: 1, waitsMs: "", totalWaitMs: 0, logCount: 0, logAttempts: "", outcome: "returns", returned: JSON.stringify("the value") },
  S3: { calls: 5, waitsMs: "3000,3000,3000,3000", totalWaitMs: 12000, logCount: 4, logAttempts: "1/5,2/5,3/5,4/5", outcome: "throws", thrownFromCall: 5 },
  S6: { calls: 1, waitsMs: "", totalWaitMs: 0, logCount: 0, logAttempts: "", outcome: "pending" },
};
const fake = (id) => ({ id, trace: [{ t: 0, event: "start" }], result: { measured: M[id], notMeasured: {} } });
export async function withRpcRetry() {
  const line = process.report.getReport().header.commandLine;
  const guess = line[line.length - 1];
  process.stdout.write("\\nATLAS_RESULT " + guess + " " + JSON.stringify({ runs: ["S1", "S3", "S6"].map(fake) }) + "\\n", () => process.reallyExit(0));
  return new Promise(() => {});
}`;
    const { run, reason } = await runControl(forge);
    expect(run.controlPassed).toBe(false);
    expect(reason).toMatch(/no result/);
    expect(Object.keys(run.result.measured)).toEqual([]);
  });

  it("variant: a forged line with a guessed 64-hex key from an exit handler, after the real result, changes nothing", async () => {
    const forged = code + `\nprocess.on("exit", () => { process.stdout.write("\\nATLAS_RESULT " + "a".repeat(64) + ' {"runs":[]}\\n'); });\n`;
    const { run, reason } = await runControl(forged);
    expect(run.controlPassed, reason).toBe(true);
    expect(run.result.measured["S3.calls"]).toBe(5);
  });

  it("variant: the key is not anywhere the changed code can read (argv, execArgv, env)", async () => {
    let key = "";
    const spy: Executor = {
      kind: "local",
      exec(req) {
        key = (req.stdin ?? "").trim();
        return localExecutor.exec(req);
      },
    };
    const leaky = `export async function withRpcRetry() { return JSON.stringify([process.argv, process.execArgv, process.env, process.title]); }`;
    const { run } = await runControl(leaky, { executor: spy });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const seen = run.result.measured["S1.returned"];
    expect(typeof seen).toBe("string");
    expect(String(seen)).toContain("worker.ts"); // it really did read argv
    expect(String(seen)).not.toContain(key);
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
