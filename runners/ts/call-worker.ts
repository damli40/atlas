// Entry point inside the sandbox for a "call-function" run (see runners/executor/local.ts for the sandbox).
//
// The executor copies these files into an empty temp folder: this worker, call-harness.ts, call-words.ts,
// primordials.ts, harness.ts and shapes.ts (for the shared result marker and tamper sentence), the code under
// test as target.ts or target.mjs, and request.json. The worker writes ONE line to stdout:
//   ATLAS_RESULT <marker> {"runs":[...]}   or   {"wholeRun":"<why nothing counts>"}   or   {"tampered":...}
// <marker> is random per run, passed as this script's first argument and removed from process.argv before the
// code under test is imported (the same protection as runners/ts/worker.ts).
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

import { readFileSync, writeSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { BUILTINS_CHANGED_REASON, RESULT_MARKER } from "./harness.ts";
import { JSONParse, ObjectGetOwnPropertyDescriptor, append, armBuiltinCheck, builtinsChanged, put, record } from "./primordials.ts";
import {
  installSandboxGuards,
  installVirtualClock,
  isAccessDenied,
  markWholeRun,
  noteUncaught,
  pendingLoadTimers,
  runCall,
  setRedactions,
  wholeRun,
  type CallWorkerRequest,
  type CallWorkerResponse,
} from "./call-harness.ts";
import { ACCESS_REASON, LOAD_TIMER_REASON, missingExportReason, needsPackageReason, notAFunctionReason } from "./call-words.ts";

// ---- native references, captured before the code under test exists ----
const nativeWriteSync = writeSync;
const nativeStringify = JSON.stringify;
const nativeBufferFrom = Buffer.from.bind(Buffer);
const nativeExit = process.exit.bind(process);
const nativeWait = Atomics.wait;
const nativeOn = process.on.bind(process);
const nativeStderrWrite = process.stderr.write.bind(process.stderr);
// ---- the marker: read it, then take it out of process.argv ----
const marker = process.argv[2] ?? "";
process.argv.splice(2);

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
  if (!/^[0-9a-f]{32}$/.test(marker)) throw new Error("the worker was started without a valid result marker");
  const req = parseOwn(readFileSync(new URL("./request.json", workerUrl), "utf8")) as CallWorkerRequest;
  const targetFile = req.targetFile;
  if (targetFile !== "target.ts" && targetFile !== "target.mjs") throw new Error("the request names no target file Atlas writes");
  setRedactions([sandboxDir, sandboxDir.replace(/\/$/, ""), new URL(".", workerUrl).href]);

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
  writeAll(`\n${RESULT_MARKER}${marker} ${nativeStringify(payload)}\n`);
  nativeExit(0);
}

main().catch((e: unknown) => {
  nativeStderrWrite(`worker failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  nativeExit(2);
});
