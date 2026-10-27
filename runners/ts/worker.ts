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
// - This is BEST EFFORT, not a security boundary. The code under test runs in the same process as
//   the harness, so code written to attack the harness could still get around it (for example by
//   changing built-in prototypes the harness relies on). Atlas runs the user's own code to see what it
//   does, not code from an attacker; the sandbox around the process (local.ts) is the real boundary
//   for network, files and child processes.

import { readFileSync, writeSync } from "node:fs";
import { RESULT_MARKER, installRealTimerTracker, runScenario, runSweep, type RetryFn, type WorkerRequest, type WorkerResponse } from "./harness.ts";

// ---- native references, captured before the code under test exists ----
const nativeWriteSync = writeSync;
const nativeStringify = JSON.stringify;
const nativeBufferFrom = Buffer.from.bind(Buffer);
const nativeExit = process.exit.bind(process);
const nativeWait = Atomics.wait;
const PROTOTYPES_TO_CHECK: { name: string; proto: object }[] = [
  { name: "Object", proto: Object.prototype },
  { name: "Array", proto: Array.prototype },
  { name: "String", proto: String.prototype },
  { name: "Number", proto: Number.prototype },
  { name: "Boolean", proto: Boolean.prototype },
];

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

/** A toJSON added to a built-in prototype would let the code rewrite the result while it is written. */
function prototypeTampering(): string | undefined {
  for (const { name, proto } of PROTOTYPES_TO_CHECK) {
    if (Object.prototype.hasOwnProperty.call(proto, "toJSON")) return `the code under test added toJSON to ${name}.prototype`;
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!/^[0-9a-f]{32}$/.test(marker)) throw new Error("the worker was started without a valid result marker");
  const req = JSON.parse(readFileSync(new URL("./request.json", import.meta.url), "utf8")) as WorkerRequest;
  installRealTimerTracker();
  // A variable specifier keeps the type checker from resolving a file that exists only in the sandbox.
  const targetPath = "./target.ts";
  const mod = (await import(targetPath)) as Record<string, unknown>;
  const target = mod[req.exportName];
  if (typeof target !== "function") throw new Error(`target.ts has no exported function "${req.exportName}"`);

  const out: WorkerResponse = { runs: [] };
  for (const r of req.runs) {
    const hopts = {
      seed: r.seed,
      ...(r.label !== undefined ? { label: r.label } : {}),
      ...(r.watchLimitMs !== undefined ? { watchLimitMs: r.watchLimitMs } : {}),
    };
    // D06-02: a sweep runs `callers` callers at once with the same failure pattern, on one virtual clock.
    const res =
      r.callers !== undefined
        ? await runSweep(target as RetryFn, { callers: r.callers, failTimes: r.scenario.failTimes, ...(r.scenario.delayMs !== undefined ? { delayMs: r.scenario.delayMs } : {}) }, hopts)
        : await runScenario(target as RetryFn, r.scenario, hopts);
    out.runs.push({ id: r.id, ...res });
  }
  const tampered = prototypeTampering();
  const payload: WorkerResponse = tampered ? { runs: [], tampered } : out;
  writeAll(`\n${RESULT_MARKER}${marker} ${nativeStringify(payload)}\n`);
  // Exit now: a never-settled promise must not keep the process alive, and the whole answer is written.
  nativeExit(0);
}

main().catch((e: unknown) => {
  process.stderr.write(`worker failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  nativeExit(2);
});
