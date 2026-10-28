// Entry point inside the sandbox for a "call-function" run (see runners/executor/local.ts for the sandbox).
//
// The executor copies these files into an empty temp folder: this worker, call-harness.ts, call-words.ts,
// primordials.ts, harness.ts and shapes.ts (for the shared result marker and tamper sentence), the code under
// test as target.ts or target.mjs, and request.json. The worker writes ONE line to stdout:
//   ATLAS_RESULT <mac> {"runs":[...]}   or   {"wholeRun":"<why nothing counts>"}   or   {"tampered":...}
//
// Why the result cannot be forged (review round 1, B1). The code under test runs in THIS process, so it can see
// whatever this process can see: argv (also through process.report), env, every file in the sandbox folder, and
// it can write to stdout or guess fd numbers. The first version put a secret marker on the command line and
// trusted any line that carried it; process.report.getReport() showed the command line, so pasted code wrote its
// own result and exited. Two designs were possible: (a) a per-run key the code can never reach, used to
// authenticate the result, or (b) the parent working the outcome out from something the child cannot fake. (b)
// does not exist here: everything the parent receives comes from this process. So (a):
// - The parent sends a fresh 32-byte key on STDIN. The worker reads it before the code under test exists and
//   CLOSES stdin, so the key is never in argv, env, a file or process.report, and no stream can read it again.
//   It lives only in a closure variable of this module, which the code cannot import (the module hook refuses
//   every import) or reach (ES modules are strict, so stack-trace callbacks cannot hand out our functions).
// - The result line carries HMAC-SHA256(key, json). The parent recomputes it; a line it does not verify, a second
//   line, or no line at all means the run is not trusted. Writing to stdout or to any fd gives the code nothing:
//   without the key it cannot make a line that verifies.
// - process.report and process.reallyExit are refused as whole-run reasons too (call-harness.ts), and this worker
//   ends the process through its own copy of reallyExit.
//
// Order, in plain words:
// 1. Keep our own copies of what writes the result (fs.writeSync, JSON.stringify, Buffer.from, process.exit,
//    Atomics.wait), then read the request.
// 2. Put Atlas's virtual clock behind the timer and time functions, and the guards in front of the network,
//    other modules, code-from-text and the process (call-harness.ts).
// 3. Register a module hook: the ONLY import it lets through is this worker loading the target file. Any
//    import the target makes (static, dynamic, or a re-export) marks the whole run "needs package X".
// 4. Snapshot the built-ins (B1), then import the target. Then call each requested export through runCall.
// 5. Write the result. A whole-run reason replaces every measurement; changed built-ins replace everything.

import { createHmac } from "node:crypto";
import { closeSync, readFileSync, writeSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { BUILTINS_CHANGED_REASON, RESULT_MARKER } from "./harness.ts";
import { JSONParse, ObjectGetOwnPropertyDescriptor, append, armBuiltinCheck, builtinsChanged, put, record } from "./primordials.ts";
import {
  installSandboxGuards,
  installVirtualClock,
  isAccessDenied,
  noteLoadHost,
  markWholeRun,
  noteUncaught,
  pendingLoadTimers,
  runCall,
  seedRandomness,
  setRedactions,
  wholeRun,
  type CallWorkerRequest,
  type CallWorkerResponse,
} from "./call-harness.ts";
import { ACCESS_REASON, LOAD_TIMER_REASON, PIN_FAILED_REASON, missingExportReason, needsPackageReason, notAFunctionReason } from "./call-words.ts";

// ---- native references, captured before the code under test exists ----
const nativeWriteSync = writeSync;
const nativeStringify = JSON.stringify;
const nativeBufferFrom = Buffer.from.bind(Buffer);
const nativeReallyExit = (process as unknown as { reallyExit: (code: number) => never }).reallyExit;
const nativeExit = (code: number): never => Reflect.apply(nativeReallyExit, process, [code]) as never;
const nativeCreateHmac = createHmac;
const nativeWait = Atomics.wait;
const nativeOn = process.on.bind(process);
const nativeStderrWrite = process.stderr.write.bind(process.stderr);
// ---- the result key: read from stdin, then stdin is closed for good ----
let resultKey = "";
try {
  resultKey = readFileSync(0, "utf8").trim();
} catch {
  resultKey = "";
}
try {
  closeSync(0);
} catch {
  // already closed: nothing can read it either way
}

const workerUrl = import.meta.url;
const sandboxDir = fileURLToPath(new URL(".", workerUrl));

function writeAll(text: string): void {
  const buf = nativeBufferFrom(text, "utf8");
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let off = 0;
  while (off < buf.length) {
    try {
      off += nativeWriteSync(1, buf, off, buf.length - off);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e;
      nativeWait(pause, 0, 0, 2);
    }
  }
}

/** JSON.parse that turns every object into one with no prototype (nothing missing is read through Object.prototype). */
function parseOwn(text: string): unknown {
  return JSONParse(text, (_k: string, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const out = record<Record<string, unknown>>();
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) put(out, keys[i]!, ObjectGetOwnPropertyDescriptor(v, keys[i]!)!.value);
    return out;
  });
}

/** The type of an exported value, in words, for "is exported but is not a function". */
function kindOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `a ${typeof v}`;
}

/** Why loading the file failed, in Node's own words where Node gave them (path of the sandbox removed). */
function loadFailure(e: unknown): string {
  if (isAccessDenied(e)) return ACCESS_REASON("the sandbox refused an access while the file loaded");
  let name = "Error";
  let message = "";
  let code = "";
  try {
    const d = (k: string) => {
      const x = e !== null && typeof e === "object" ? ObjectGetOwnPropertyDescriptor(e, k) : undefined;
      if (x && "value" in x && typeof x.value === "string") return x.value;
      return undefined;
    };
    // The name usually lives on a prototype (SyntaxError.prototype); read data properties only, up the chain.
    let found = d("name");
    let proto: unknown = e !== null && typeof e === "object" ? Object.getPrototypeOf(e) : null;
    for (let i = 0; i < 8 && found === undefined && proto; i++) {
      const x = Object.getOwnPropertyDescriptor(proto, "name");
      if (x && "value" in x && typeof x.value === "string") found = x.value;
      proto = Object.getPrototypeOf(proto);
    }
    name = found ?? (typeof e === "string" ? "a thrown text" : "Error");
    message = d("message") ?? (typeof e === "string" ? e : "");
    code = d("code") ?? "";
  } catch {
    message = "";
  }
  const strip = (s: string) => s.split(sandboxDir).join("<sandbox>/").split(workerUrl.replace(/call-worker\.ts$/, "")).join("<sandbox>/");
  const text = strip(`${name}${code ? ` [${code}]` : ""}: ${message}`).slice(0, 400);
  return name === "SyntaxError" || code.startsWith("ERR_")
    ? `Node could not run the code as written: ${text}`
    : `the code threw while it was being loaded: ${text}`;
}

async function main(): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(resultKey)) throw new Error("the worker was started without a valid result key");
  const req = parseOwn(readFileSync(new URL("./request.json", workerUrl), "utf8")) as CallWorkerRequest;
  const targetFile = req.targetFile;
  if (targetFile !== "target.ts" && targetFile !== "target.mjs") throw new Error("the request names no target file Atlas writes");
  setRedactions([sandboxDir, sandboxDir.replace(/\/$/, ""), new URL(".", workerUrl).href]);

  // Create the stdout/stderr streams now, before the background-work tracker starts (installSandboxGuards):
  // Node makes them lazily, and a stream made later by console.log would look like outside work forever.
  void process.stdout;
  void process.stderr;
  // R1 review round 2 (B1): the same environment on every executor. macOS adds __CF_USER_TEXT_ENCODING to every
  // process; it is removed, and the rest is put in name order, so the code sees exactly Atlas's pins, in one order.
  {
    const env = process.env as Record<string, string | undefined>;
    delete env.__CF_USER_TEXT_ENCODING;
    const pairs = Object.keys(env).sort().map((k) => [k, env[k]!] as const);
    for (const [k] of pairs) delete env[k];
    for (const [k, v] of pairs) env[k] = v;
  }
  // R1 (D42): the sandbox was started with TZ=UTC and a fixed locale; check they took, with Node's own answer, before
  // the code exists. If not, nothing from this run counts (a time-zone result would be this machine's).
  const pins = req.pins;
  const ro = Intl.DateTimeFormat().resolvedOptions();
  if (!pins || ro.timeZone !== pins.timeZone || new Date(0).getTimezoneOffset() !== 0) markWholeRun(PIN_FAILED_REASON(`the time zone to ${String(pins?.timeZone)} (it is ${String(ro.timeZone).slice(0, 40)})`));
  else if (ro.locale !== pins.locale) markWholeRun(PIN_FAILED_REASON(`the locale to ${pins.locale} (it is ${String(ro.locale).slice(0, 40)})`));
  if (typeof req.seed !== "string" || !/^[1-9]\d{0,9}$/.test(req.seed)) throw new Error("the request names no seed Atlas uses");
  seedRandomness(req.seed);
  installVirtualClock();
  installSandboxGuards();
  nativeOn("unhandledRejection", (r: unknown) => noteUncaught("rejection", r));
  nativeOn("uncaughtException", (e: unknown) => noteUncaught("exception", e));
  // Only this worker may load the target; every other import (from the target, or anything it loads) is refused.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === workerUrl && specifier === `./${targetFile}`) return nextResolve(specifier, context);
      markWholeRun(needsPackageReason(specifier));
      throw new Error(`Atlas refused this: ${needsPackageReason(specifier)}`);
    },
  });
  armBuiltinCheck(); // B1: the snapshot of the built-ins, taken before the code under test exists
  // R1 review round 2 (B1): import.meta (the file's own URL and folder) is syntax, so no read of it can be watched;
  // the file's text is checked instead (a mention in a comment also counts: a disclosure, never a fact).
  if (/\bimport\s*\.\s*meta\b/.test(readFileSync(new URL(`./${targetFile}`, workerUrl), "utf8"))) noteLoadHost("import.meta (the file's own path)");

  const payload = record<CallWorkerResponse>();
  const runs: NonNullable<CallWorkerResponse["runs"]> = [];
  let mod: Record<string, unknown> | null = null;
  try {
    mod = (await import(`./${targetFile}`)) as Record<string, unknown>;
  } catch (e) {
    markWholeRun(loadFailure(e));
  }
  if (mod && pendingLoadTimers() > 0) markWholeRun(LOAD_TIMER_REASON);

  if (mod && wholeRun() === null) {
    for (let i = 0; i < req.runs.length; i++) {
      const r = req.runs[i]!;
      const d = ObjectGetOwnPropertyDescriptor(mod, r.exportName);
      if (!d) {
        markWholeRun(missingExportReason(r.exportName));
        break;
      }
      const fn = d.value;
      if (typeof fn !== "function") {
        markWholeRun(notAFunctionReason(r.exportName, kindOf(fn)));
        break;
      }
      const res = await runCall(fn, r);
      if (builtinsChanged() !== null || wholeRun() !== null) break;
      const one = record<NonNullable<CallWorkerResponse["runs"]>[number]>();
      put(one, "id", r.id);
      put(one, "trace", res.trace);
      put(one, "result", res.result);
      append(runs, one);
    }
  }
  // The last checks, right before the result is written (nothing runs between them and the write).
  const changed = builtinsChanged();
  const whole = wholeRun();
  if (changed !== null) {
    put(payload, "tampered", BUILTINS_CHANGED_REASON);
    put(payload, "changed", changed);
  } else if (whole !== null) {
    put(payload, "wholeRun", whole);
  } else {
    put(payload, "runs", runs);
  }
  const json = nativeStringify(payload);
  const mac = nativeCreateHmac("sha256", resultKey).update(json, "utf8").digest("hex");
  writeAll(`\n${RESULT_MARKER}${mac} ${json}\n`);
  nativeExit(0);
}

main().catch((e: unknown) => {
  nativeStderrWrite(`worker failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  nativeExit(2);
});
