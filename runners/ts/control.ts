// The TS runner's control, and the TS Runner itself.
//
// Plain words: before Atlas trusts any run of the code, it runs three cases whose answer is
// already known (oracle rows S1 = returns at once, S3 = throws after five failures, S6 = never
// settles) through the SAME sandbox and the SAME harness. If any one doesn't match its row exactly,
// `controlPassed` is false and every verdict on that runner becomes "can't check". The reason says
// which row and which field didn't match.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import type { Change, Experiment, Run, Target, TraceEvent } from "../../src/types.ts";
import { localExecutor } from "../executor/local.ts";
import type { Executor, ReplayContext, Runner } from "../runner.ts";
import { checkChange, tsChangeContext } from "../change.ts";
import { BUILTINS_CHANGED_REASON, RESULT_MARKER, type HarnessOutput, type WorkerRequest, type WorkerResponse } from "./harness.ts";
import { SUCCESS_VALUE, harnessInputFromShape, scenarioFromOracleInput, type OracleInput } from "./shapes.ts";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES_DIR = resolve(REPO_ROOT, "tests/fixtures");
const ORACLE_PATH = resolve(REPO_ROOT, "tests/oracle/retry-oracle.json");

/** The oracle rows the control runs. */
export const CONTROL_CASES = ["S1", "S3", "S6"] as const;
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
  return { "worker.ts": own("worker.ts"), "harness.ts": own("harness.ts"), "shapes.ts": own("shapes.ts"), "primordials.ts": own("primordials.ts"), "target.ts": code };
}

type SandboxAnswer = { ok: true; runs: WorkerResponse["runs"] } | { ok: false; reason: string; tampered: boolean };

function isHarnessRun(r: unknown): r is WorkerResponse["runs"][number] {
  if (!r || typeof r !== "object") return false;
  const x = r as { id?: unknown; trace?: unknown; result?: { measured?: unknown; notMeasured?: unknown } };
  return (
    typeof x.id === "string" &&
    Array.isArray(x.trace) &&
    !!x.result &&
    typeof x.result.measured === "object" &&
    x.result.measured !== null &&
    typeof x.result.notMeasured === "object" &&
    x.result.notMeasured !== null
  );
}

/**
 * Reads the worker's stdout. Only lines carrying this run's marker count. The FIRST one is the
 * result; a second one, a line that does not parse, or a result the worker flagged as tampered
 * means the code under test interfered, so nothing from the run is trusted. Never throws.
 */
export function parseWorkerOutput(stdout: string, marker: string): SandboxAnswer {
  const lines = stdout.split("\n").filter((l) => l.includes(marker));
  if (lines.length === 0) return { ok: false, reason: "the sandbox gave no result line", tampered: false };
  if (lines.length > 1) {
    return { ok: false, reason: `tampering: ${lines.length} result lines carry this run's marker (only the worker writes one)`, tampered: true };
  }
  const prefix = `${RESULT_MARKER}${marker} `;
  const line = lines[0]!;
  if (!line.startsWith(prefix)) return { ok: false, reason: "tampering: the result line was changed", tampered: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(prefix.length));
  } catch {
    return { ok: false, reason: "tampering or a cut-off write: the result line is not valid JSON", tampered: true };
  }
  const p = parsed as { runs?: unknown; tampered?: unknown; changed?: unknown };
  if (p?.tampered === BUILTINS_CHANGED_REASON) {
    // B1: which built-in changed is shown only when it reads like one ("Array.prototype.push was replaced").
    const what = typeof p.changed === "string" && /^[A-Za-z][\w.]{0,60}(?:'s prototype)? (?:was replaced|was added or deleted|was frozen or sealed)$|^a property of [A-Za-z][\w.]{0,60} was (?:replaced|added or deleted)$/.test(p.changed) ? p.changed : "a built-in object changed";
    return { ok: false, reason: `${BUILTINS_CHANGED_REASON} (${what})`, tampered: true };
  }
  if (typeof p?.tampered === "string") return { ok: false, reason: `tampering: ${p.tampered}`, tampered: true };
  if (!Array.isArray(p?.runs) || !p.runs.every(isHarnessRun)) {
    return { ok: false, reason: "tampering: the result line does not have the shape the worker writes", tampered: true };
  }
  return { ok: true, runs: p.runs };
}

/** Runs scenarios in the sandbox. Returns per-run outputs, or a reason the sandbox gave no usable answer. */
async function execInSandbox(executor: Executor, code: string, request: WorkerRequest, wallClockMs: number): Promise<SandboxAnswer> {
  const marker = randomBytes(16).toString("hex"); // fresh per run; passed only as an argument
  let res: Awaited<ReturnType<Executor["exec"]>>;
  try {
    res = await executor.exec({
      files: { ...harnessFiles(code), "request.json": JSON.stringify(request) },
      cmd: ["node", "--permission", "--allow-fs-read=.", "worker.ts", marker],
      wallClockMs,
      allowNetwork: false,
    });
  } catch (e) {
    return { ok: false, reason: `the sandbox could not start: ${(e as Error).message}`, tampered: false };
  }
  if (res.timedOut) return { ok: false, reason: `the sandbox hit Atlas's ${wallClockMs} ms wall-clock limit`, tampered: false };
  const parsed = parseWorkerOutput(res.stdout, marker);
  if (parsed.ok && res.exitCode !== 0) {
    return { ok: false, reason: `tampering: the sandbox wrote a result but exited with code ${res.exitCode}`, tampered: true };
  }
  if (!parsed.ok && !parsed.tampered) {
    const err = res.stderr.trim().split("\n").slice(-3).join(" | ");
    return { ok: false, reason: `the sandbox exited with code ${res.exitCode} and no result${err ? ` (${err})` : ""}`, tampered: false };
  }
  return parsed;
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

/** Control on a Target: reads the fixture, checks its SHA-256 against the target, runs the CONTROL_CASES rows. */
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
    { exportName: EXPORT_NAME, runs: [{ id: exp.id, ...harnessInputFromShape(exp.params), seed, watchLimitMs: oracle.harnessWatchLimitMs }] },
    DEFAULT_WALL_CLOCK_MS,
  );
  const out = res.ok ? res.runs.find((r) => r.id === exp.id) : undefined;
  const result: Run["result"] = out
    ? out.result
    : { measured: {}, notMeasured: { run: res.ok ? "the sandbox returned no result for this experiment" : res.reason } };
  const sameCode = ctl.codeSha256 === codeSha256 && exp.target.codeSha256 === codeSha256;
  // Tampering with the result (see worker.ts) means nothing from this run is trusted: every verdict is
  // "can't check", with the reason in notMeasured.control (the judge shows it).
  const tampered = !res.ok && res.tampered;
  if (tampered) result.notMeasured.control = res.reason;
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
    controlPassed: ctl.controlPassed === true && sameCode && !tampered,
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
    replayWithChange: (run: Run, change: Change, ctx: ReplayContext) => replayTsWithChange(run, change, ctx, executor),
  };
}

// ── Change and replay (D06-01) ──────────────────────────────────────────────────────────────────
//
// Plain words: the change is applied to a scratch copy of the fixture's exact bytes, and the SAME
// experiment runs on the changed code through the SAME sandbox and harness with the SAME seed (so
// the fake RPC throws the same errors in the same order).
//
// What the control means on a replay. The control's rows (S1, S3, S6) are known answers of the
// ORIGINAL function. A change toward what the bettors expected is meant to make the function do
// something else, so those rows can stop matching the changed code BECAUSE the change did what it
// was asked (adding a time limit changes S6 by design). Gating the replay on them would mark the
// replay "can't check" exactly when the change worked, and writing new expected rows for the
// changed code would need someone to decide what it "should" do, which Atlas never does.
// So the replay's gate is a check of the HARNESS, not of the function: the same control rows, run
// on the ORIGINAL bytes, through the same harness files and executor, right before the replay. It
// proves the harness still measures the known cases exactly, whatever the change does. The changed
// code is also run on the same rows and the result is RECORDED (which rows it still matches), never
// used as a gate. Both are in the replay's last trace event, "replay_checks".

export const REPLAY_CHECKS_EVENT = "replay_checks";

function harnessSha256(): string {
  const own = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  return sha256(["worker.ts", "harness.ts", "shapes.ts", "primordials.ts"].map(own).join("\n"));
}

/** Throws when the replay would not be the same experiment with the same inputs. */
export function assertSameTsReplay(original: Run, exp: Experiment, change: Change): void {
  if (original.runner !== "ts") throw new Error(`run ${original.id} is an ${original.runner} run, not a TS run`);
  if (original.experimentId !== exp.id) throw new Error(`run ${original.id} ran experiment ${original.experimentId}, not ${exp.id}`);
  if (change.runId !== original.id) throw new Error(`change ${change.id} is for run ${change.runId}, not ${original.id}`);
  if (original.seed === undefined || original.seed === "") throw new Error(`run ${original.id} has no seed, so a same-seed replay is impossible`);
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
}

async function replayTsWithChange(original: Run, change: Change, ctx: ReplayContext, executor: Executor): Promise<Run> {
  const exp = ctx.experiment;
  const progress = (s: string) => {
    try {
      ctx.onProgress?.(s);
    } catch {
      // a progress line that could not be written never stops a replay
    }
  };
  assertSameTsReplay(original, exp, change);
  const code = readFixture(exp.target);
  const originalSha = sha256(code);
  if (originalSha !== original.codeSha256 || originalSha !== exp.target.codeSha256) {
    throw new Error(`the fixture's bytes (${originalSha}) are not the bytes run ${original.id} ran (${original.codeSha256}); the change cannot be replayed on them`);
  }
  progress("applies the change in a scratch copy");
  const checked = await checkChange(change.diff, tsChangeContext(exp.target.ref, code));
  if (!checked.ok) throw new Error(`the change cannot be replayed: ${checked.reason}`);
  const changed = checked.changedFiles[exp.target.ref]!;
  const changedSha = sha256(changed);
  const seed = original.seed!;

  progress("checks the harness on the original code (S1, S3, S6)");
  const harness = await runControl(code, { executor, expectedSha256: originalSha });
  const onChanged = await runControl(changed, { executor });

  progress(`re-runs ${exp.id} on the changed code with the same seed (${seed})`);
  const startedAt = new Date().toISOString();
  const oracle = loadOracle();
  const res = await execInSandbox(
    executor,
    changed,
    { exportName: EXPORT_NAME, runs: [{ id: exp.id, ...harnessInputFromShape(exp.params), seed, watchLimitMs: oracle.harnessWatchLimitMs }] },
    DEFAULT_WALL_CLOCK_MS,
  );
  const out = res.ok ? res.runs.find((r) => r.id === exp.id) : undefined;
  const result: Run["result"] = out ? out.result : { measured: {}, notMeasured: { run: res.ok ? "the sandbox returned no result for this experiment" : res.reason } };
  const tampered = !res.ok && res.tampered;
  if (tampered) result.notMeasured.control = res.reason;
  if (harness.run.controlPassed !== true) result.notMeasured.control = `the harness check on the original code did not match: ${harness.reason ?? "no reason given"}`;
  const trace: TraceEvent[] = out ? [...out.trace] : [];
  trace.push({
    t: trace.length ? trace[trace.length - 1]!.t : 0,
    event: REPLAY_CHECKS_EVENT,
    data: {
      replayOf: original.id,
      changeId: change.id,
      sameSeed: true,
      seed,
      originalSeed: original.seed,
      originalCodeSha256: originalSha,
      changedCodeSha256: changedSha,
      changedLines: checked.changedLines,
      harnessSha256: harnessSha256(),
      // B1: a replay whose changed code changed JavaScript's built-ins fails this check too, with that reason.
      harnessCheck: {
        on: "original code",
        rows: [...CONTROL_CASES],
        passed: harness.run.controlPassed === true && !tampered,
        runId: harness.run.id,
        ...(tampered ? { reason: res.ok ? "" : res.reason } : harness.reason ? { reason: harness.reason } : {}),
      },
      changedCodeOnKnownRows: {
        note: "recorded only, not a gate: these rows are known answers of the original function",
        rows: [...CONTROL_CASES],
        allStillMatch: onChanged.run.controlPassed,
        ...(onChanged.reason ? { differences: onChanged.reason } : {}),
      },
    },
  });
  const run: Run = {
    id: nanoid(10),
    experimentId: exp.id,
    runner: "ts",
    executor: executor.kind,
    codeSha256: changedSha,
    seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result,
    controlPassed: harness.run.controlPassed === true && !tampered,
    controlRunId: harness.run.id,
    replayOf: { runId: original.id, changeId: change.id },
  };
  if (run.seed !== original.seed) throw new Error(`replay seed ${run.seed} is not the original seed ${original.seed}`);
  return run;
}
