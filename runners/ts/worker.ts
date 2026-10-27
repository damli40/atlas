// Entry point inside the sandboxed child process (see runners/executor/local.ts).
//
// The executor copies four files into an empty temp folder: this worker, harness.ts, shapes.ts,
// the code under test as target.ts, plus request.json. The worker loads target.ts, runs every
// requested scenario through the harness, and writes ONE line to stdout:
//   ATLAS_RESULT <marker> {"runs":[...]}
// <marker> is a random value the parent passes as this script's first argument, fresh for every run.
//
// How the result is protected, in plain words (and how far that goes):
// - Before the code under test is imported, the worker keeps its own references to the functions it
//   needs to write the result (fs.writeSync, JSON.stringify, Buffer.from, process.exit), and the
//   harness wraps the timer functions. Changing process.stdout.write or JSON.stringify later does not
//   touch the result.
// - The marker is read from the arguments and then REMOVED from process.argv before the import, so
//   the code under test cannot read it there. The parent accepts only the first line that carries the
//   marker; a second one, or one that does not parse, is treated as tampering and the run is not trusted.
// - The result is written with a blocking write to fd 1, in a loop, so all of it is out before exit.
//   (process.stdout.write to a pipe is asynchronous on macOS, and exiting right after it cut results
//   at 64 KB.)
// - B1 (day-6 review): the code under test may be a change a MODEL wrote, so Atlas no longer assumes it
//   is friendly. Before the import, primordials.ts captures every built-in the harness and this worker
//   use to record and write the result, and armBuiltinCheck() snapshots the built-in objects (every own
//   property of Object.prototype, Array.prototype, Promise.prototype, JSON, ... and the globals that name
//   them). The request is copied into objects with no prototype, the harness records into objects with
//   no prototype, and the built-ins are compared with the snapshot each time the code hands control back
//   and once more right before the result is written. If ANY built-in changed, even if the code put it
//   back, no result is sent: only BUILTINS_CHANGED_REASON, and every verdict on the run is "can't check".
// - This guards the RECORD. It is not the security boundary: the sandbox around the process (local.ts:
//   no network, no file writes, no child processes) is the real boundary, and code in this process can
//   still do things the snapshot does not look at (it would then be caught only if it changed the record).

import { readFileSync, writeSync } from "node:fs";
import { BUILTINS_CHANGED_REASON, RESULT_MARKER, installRealTimerTracker, runScenario, runSweep, type RetryFn, type WorkerRequest, type WorkerResponse } from "./harness.ts";
import { JSONParse, ObjectGetOwnPropertyDescriptor, append, armBuiltinCheck, builtinsChanged, put, record } from "./primordials.ts";

// ---- native references, captured before the code under test exists ----
const nativeWriteSync = writeSync;
const nativeStringify = JSON.stringify;
const nativeBufferFrom = Buffer.from.bind(Buffer);
const nativeExit = process.exit.bind(process);
const nativeWait = Atomics.wait;
// ---- the marker: read it, then take it out of process.argv ----
const marker = process.argv[2] ?? "";
process.argv.splice(2);

/** Writes all of `text` to fd 1 with blocking writes. Retries on EAGAIN (a full, non-blocking pipe). */
function writeAll(text: string): void {
  const buf = nativeBufferFrom(text, "utf8");
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let off = 0;
  while (off < buf.length) {
    try {
      off += nativeWriteSync(1, buf, off, buf.length - off);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
      nativeWait(pause, 0, 0, 2); // the reader has not caught up; wait 2 ms and try again
    }
  }
}

/** JSON.parse that turns every object into one with no prototype (nothing missing is ever read through Object.prototype). */
function parseOwn(text: string): unknown {
  return JSONParse(text, (_k: string, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const out = record<Record<string, unknown>>();
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) put(out, keys[i]!, ObjectGetOwnPropertyDescriptor(v, keys[i]!)!.value);
    return out;
  });
}

async function main(): Promise<void> {
  if (!/^[0-9a-f]{32}$/.test(marker)) throw new Error("the worker was started without a valid result marker");
  const req = parseOwn(readFileSync(new URL("./request.json", import.meta.url), "utf8")) as WorkerRequest;
  installRealTimerTracker();
  armBuiltinCheck(); // B1: the snapshot of the built-ins, taken before the code under test exists
  // A variable specifier keeps the type checker from resolving a file that exists only in the sandbox.
  const targetPath = "./target.ts";
  const mod = (await import(targetPath)) as Record<string, unknown>;
  const target = mod[req.exportName];
  if (typeof target !== "function") throw new Error(`target.ts has no exported function "${req.exportName}"`);

  const runs: WorkerResponse["runs"] = [];
  for (let i = 0; i < req.runs.length; i++) {
    if (builtinsChanged() !== null) break;
    const r = req.runs[i]!;
    const hopts = record<{ seed: string; label?: string; watchLimitMs?: number }>();
    put(hopts, "seed", r.seed);
    if (r.label !== undefined) put(hopts, "label", r.label);
    if (r.watchLimitMs !== undefined) put(hopts, "watchLimitMs", r.watchLimitMs);
    // D06-02: a sweep runs `callers` callers at once with the same failure pattern, on one virtual clock.
    let res;
    if (r.callers !== undefined) {
      const sweep = record<{ callers: number; failTimes: number | "always"; delayMs?: number }>();
      put(sweep, "callers", r.callers);
      put(sweep, "failTimes", r.scenario.failTimes);
      if (r.scenario.delayMs !== undefined) put(sweep, "delayMs", r.scenario.delayMs);
      res = await runSweep(target as RetryFn, sweep, hopts);
    } else {
      res = await runScenario(target as RetryFn, r.scenario, hopts);
    }
    const one = record<WorkerResponse["runs"][number]>();
    put(one, "id", r.id);
    put(one, "trace", res.trace);
    put(one, "result", res.result);
    append(runs, one);
  }
  // The last check, right before the result is written (nothing runs between it and the write).
  const changed = builtinsChanged();
  const payload = record<WorkerResponse>();
  if (changed !== null) {
    put(payload, "tampered", BUILTINS_CHANGED_REASON);
    put(payload, "changed", changed);
  } else {
    put(payload, "runs", runs);
  }
  writeAll(`\n${RESULT_MARKER}${marker} ${nativeStringify(payload)}\n`);
  // Exit now: a never-settled promise must not keep the process alive, and the whole answer is written.
  nativeExit(0);
}

main().catch((e: unknown) => {
  process.stderr.write(`worker failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  nativeExit(2);
});
