// The TS runner's control, and the TS Runner itself.
//
// Plain words: before Atlas trusts any run of the code, it runs two cases whose answer is
// already known (oracle rows S1 and S3) through the SAME sandbox and the SAME harness. If
// either one doesn't match its row exactly, `controlPassed` is false and every verdict on that
// runner becomes "can't check". The reason says which row and which field didn't match.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { Change, Experiment, Run, Target, TraceEvent } from "../../src/types.ts";
import { localExecutor } from "../executor/local.ts";
import type { Executor, Runner } from "../runner.ts";
import { RESULT_MARKER, type HarnessOutput, type WorkerRequest, type WorkerResponse } from "./harness.ts";
import { SUCCESS_VALUE, scenarioFromOracleInput, scenarioFromShape, type OracleInput } from "./shapes.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES_DIR = resolve(REPO_ROOT, "tests/fixtures");
const ORACLE_PATH = resolve(REPO_ROOT, "tests/oracle/retry-oracle.json");

/** The oracle rows the control runs. */
export const CONTROL_CASES = ["S1", "S3"] as const;
export const CONTROL_SEED = "atlas-control";
const EXPORT_NAME = "withRpcRetry";
const DEFAULT_WALL_CLOCK_MS = 10_000;

interface OracleCase {
  id: string;
  input: OracleInput;
  expected: { calls: number; waitsMs: number[]; totalWaitMs: number; logCount: number; logAttempts: string[]; outcome: string; returns?: unknown };
}

function loadOracle(): { cases: OracleCase[]; harnessWatchLimitMs: number } {
  return JSON.parse(readFileSync(ORACLE_PATH, "utf8"));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The files the sandbox needs besides request.json: the harness and the code under test as target.ts. */
function harnessFiles(code: string): Record<string, string> {
  const own = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  return { "worker.ts": own("worker.ts"), "harness.ts": own("harness.ts"), "shapes.ts": own("shapes.ts"), "target.ts": code };
}

/** Runs scenarios in the sandbox. Returns per-run outputs, or a reason the sandbox gave no usable answer. */
async function execInSandbox(
  executor: Executor,
  code: string,
  request: WorkerRequest,
  wallClockMs: number,
): Promise<{ ok: true; runs: WorkerResponse["runs"] } | { ok: false; reason: string }> {
  const res = await executor.exec({
    files: { ...harnessFiles(code), "request.json": JSON.stringify(request) },
    cmd: ["node", "--permission", "--allow-fs-read=.", "worker.ts"],
    wallClockMs,
    allowNetwork: false,
  });
  if (res.timedOut) return { ok: false, reason: `the sandbox hit Atlas's ${wallClockMs} ms wall-clock limit` };
  const line = res.stdout.split("\n").reverse().find((l) => l.startsWith(RESULT_MARKER));
  if (res.exitCode !== 0 || !line) {
    const err = res.stderr.trim().split("\n").slice(-3).join(" | ");
    return { ok: false, reason: `the sandbox exited with code ${res.exitCode} and no result${err ? ` (${err})` : ""}` };
  }
  return { ok: true, runs: (JSON.parse(line.slice(RESULT_MARKER.length)) as WorkerResponse).runs };
}

/** Compares one measured case to its oracle row. Returns the fields that didn't match, in plain words. */
export function compareToOracle(c: OracleCase, out: HarnessOutput): string[] {
  const m = out.result.measured;
  const e = c.expected;
  const checks: [string, unknown, unknown][] = [
    ["calls", m.calls, e.calls],
    ["waits (ms)", m.waitsMs, e.waitsMs.join(",")],
    ["total wait (ms)", m.totalWaitMs, e.totalWaitMs],
    ["log lines", m.logCount, e.logCount],
    ["log attempts", m.logAttempts, e.logAttempts.join(",")],
    ["outcome", m.outcome, e.outcome],
  ];
  if (e.outcome === "throws") checks.push(["call whose error was thrown", m.thrownFromCall, e.calls]);
  if (e.outcome === "returns") {
    const want = typeof e.returns === "object" && e.returns !== null ? e.returns : SUCCESS_VALUE;
    checks.push(["returned value", m.returned, JSON.stringify(want)]);
  }
  return checks
    .filter(([, got, want]) => got !== want)
    .map(([name, got, want]) => `${c.id}: ${name} was ${JSON.stringify(got ?? "not measured")}, the oracle row says ${JSON.stringify(want)}`);
}

export interface ControlOutcome {
  run: Run;
  /** Present only when controlPassed is false. */
  reason?: string;
}

/**
 * Runs the control on given code bytes. `expectedSha256`, when given, must equal the SHA-256 of
 * `code` or the control does not pass (Atlas would be checking different code than the target names).
 */
export async function runControl(
  code: string,
  opts: { executor?: Executor; expectedSha256?: string; wallClockMs?: number } = {},
): Promise<ControlOutcome> {
  const executor = opts.executor ?? localExecutor;
  const wallClockMs = opts.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const oracle = loadOracle();
  const cases = CONTROL_CASES.map((id) => {
    const c = oracle.cases.find((x) => x.id === id);
    if (!c) throw new Error(`oracle has no row ${id}`);
    return c;
  });
  const codeSha256 = sha256(code);
  const startedAt = new Date().toISOString();
  const reasons: string[] = [];
  const trace: TraceEvent[] = [];
  const measured: Run["result"]["measured"] = {};
  const notMeasured: Run["result"]["notMeasured"] = {};

  if (opts.expectedSha256 && opts.expectedSha256 !== codeSha256) {
    reasons.push(`the code's SHA-256 (${codeSha256}) is not the target's (${opts.expectedSha256})`);
  }

  const res = await execInSandbox(
    executor,
    code,
    {
      exportName: EXPORT_NAME,
      runs: cases.map((c) => ({ id: c.id, scenario: scenarioFromOracleInput(c.input), seed: CONTROL_SEED, watchLimitMs: oracle.harnessWatchLimitMs })),
    },
    wallClockMs,
  );
  if (!res.ok) {
    reasons.push(res.reason);
    notMeasured.control = res.reason;
  } else {
    for (const c of cases) {
      const out = res.runs.find((r) => r.id === c.id);
      if (!out) {
        reasons.push(`${c.id}: the sandbox returned no result for this row`);
        continue;
      }
      for (const ev of out.trace) trace.push({ ...ev, data: { case: c.id, ...(ev.data ?? {}) } });
      for (const [k, v] of Object.entries(out.result.measured)) measured[`${c.id}.${k}`] = v;
      for (const [k, v] of Object.entries(out.result.notMeasured)) notMeasured[`${c.id}.${k}`] = v;
      reasons.push(...compareToOracle(c, out));
    }
  }

  const controlPassed = reasons.length === 0;
  const reason = controlPassed ? undefined : reasons.join("; ");
  trace.push({ t: 0, event: controlPassed ? "control_matched" : "control_did_not_match", data: reason ? { reason } : { cases: [...CONTROL_CASES] } });

  const run: Run = {
    id: nanoid(10),
    experimentId: `control:${CONTROL_CASES.join("+")}`,
    runner: "ts",
    executor: executor.kind,
    codeSha256,
    seed: CONTROL_SEED,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result: { measured, notMeasured },
    controlPassed,
  };
  return reason ? { run, reason } : { run };
}

/** Reads the reason from a control Run's trace (Run has no reason field). */
export function controlReason(run: Run): string | undefined {
  const ev = run.trace.find((t) => t.event === "control_did_not_match");
  return typeof ev?.data?.reason === "string" ? ev.data.reason : undefined;
}

/** Reads a ts-fixture target's bytes. The ref must stay inside tests/fixtures. */
export function readFixture(target: Target): string {
  if (target.kind !== "ts-fixture") throw new Error(`the TS runner reads "ts-fixture" targets only; got "${target.kind}"`);
  // Accepts "tests/fixtures/x.ts" or "x.ts".
  const inside = target.ref.startsWith("tests/fixtures/") ? target.ref.slice("tests/fixtures/".length) : target.ref;
  const full = resolve(FIXTURES_DIR, inside);
  if (!full.startsWith(FIXTURES_DIR + sep))throw new Error(`target ref "${target.ref}" is outside tests/fixtures`);
  return readFileSync(full, "utf8");
}

/** Control on a Target: reads the fixture, checks its SHA-256 against the target, runs S1 and S3. */
export async function control(target: Target, executor: Executor = localExecutor): Promise<Run> {
  return (await runControl(readFixture(target), { executor, expectedSha256: target.codeSha256 })).run;
}

/**
 * Runs one experiment in the sandbox, given a control Run that was already made on the same code.
 * Exists so a caller (the server) can run the control once per code SHA-256 and reuse it.
 * The run counts only if that control passed AND it was made on exactly the bytes read now
 * AND those bytes are the target's; otherwise `controlPassed` is false and every verdict is "can't check".
 */
export async function runExperiment(
  exp: Experiment,
  ctl: Run,
  opts: { executor?: Executor; seed?: string; replayOf?: Run["replayOf"] } = {},
): Promise<Run> {
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
  const executor = opts.executor ?? localExecutor;
  const code = readFixture(exp.target);
  const codeSha256 = sha256(code);
  const seed = opts.seed ?? nanoid(10);
  const startedAt = new Date().toISOString();
  const oracle = loadOracle();
  const res = await execInSandbox(
    executor,
    code,
    { exportName: EXPORT_NAME, runs: [{ id: exp.id, scenario: scenarioFromShape(exp.params), seed, watchLimitMs: oracle.harnessWatchLimitMs }] },
    DEFAULT_WALL_CLOCK_MS,
  );
  const out = res.ok ? res.runs[0] : undefined;
  const result: Run["result"] = out ? out.result : { measured: {}, notMeasured: { run: res.ok ? "the sandbox returned no result" : res.reason } };
  const sameCode = ctl.codeSha256 === codeSha256 && exp.target.codeSha256 === codeSha256;
  return {
    id: nanoid(10),
    experimentId: exp.id,
    runner: "ts",
    executor: executor.kind,
    codeSha256,
    seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace: out ? out.trace : [],
    result,
    controlPassed: ctl.controlPassed && sameCode,
    controlRunId: ctl.id,
    ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
  };
}

/** The TS Runner: every run is preceded by a control on the same code through the same executor. */
export function tsRunner(executor: Executor = localExecutor): Runner {
  return {
    kind: "ts",
    control: (target) => control(target, executor),
    async run(exp: Experiment, opts): Promise<Run> {
      if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
      const ctl = await runControl(readFixture(exp.target), { executor, expectedSha256: exp.target.codeSha256 });
      return runExperiment(exp, ctl.run, {
        executor,
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
      });
    },
    async replayWithChange(_run: Run, _change: Change): Promise<Run> {
      throw new Error("replayWithChange is not built yet (change-and-replay task)");
    },
  };
}
