// Modal executor (E4, D16/D25): every exec gets its own throwaway Modal Sandbox, a small cloud container that is
// made for this one command and deleted right after it.
//
// The boundary, in plain words. Each layer would stop pasted code from ESCAPING (reaching the network, a secret,
// another run) on its own; together they are defence in depth. None of them protects the result key from code in
// the SAME process if Node's permission model were bypassed (review round 1, D): see the E4 evidence, Known limits.
// 1. A fresh container per exec. Nothing from an earlier run is in it, and it is terminated in a `finally`
//    (after success, an error or a timeout). If this server dies first, Modal kills it at its own timeout.
// 2. No network at all: the sandbox is created with `blockNetwork: true`, so even a DNS lookup fails.
// 3. No secrets: the sandbox gets no Modal Secrets, no volumes and no env. The command runs under `env -i`, so it
//    sees ONLY the env vars the request carries (not even Modal's own MODAL_* variables).
// 4. Not root: the command runs as the `nobody` user (setpriv, with no-new-privs). The files Atlas writes are
//    owned by root and read-only to it.
// 5. Node's permission model, with the SAME flags as the local executor (`guardedNodeArgs`): read only the run
//    folder, no writes, no network, no child processes. Python (D24, hosted) runs as `python3 -s -P -S -B` with the
//    harness's own audit hook and refusals (runners/py/harness.py); layers 1-4 replace macOS sandbox-exec.
// 6. Hard limits: CPU and memory caps on the container, Atlas's own wall-clock kill (the container is terminated
//    and the result says `timedOut: true`), stdout/stderr capped at 16 MiB each, and a cap on how many sandboxes
//    run at once, and a daily cap on sandbox starts and sandbox-seconds (review round 1, C).
//
// The per-run result key (call-worker.ts) travels on the command's STDIN only. The files go in through a separate
// first command (an unpacker that reads them as JSON on its own stdin), so the key is never in a file, argv, env
// or a log line.
//
// When Modal cannot be reached (no credentials, network down, Modal refuses) exec THROWS with the reason. It never
// falls back to the local executor: the caller turns the throw into "the run did not finish: <reason>", so no run
// ever claims executor "modal" unless a Modal sandbox ran it.
//
// The SDK is Modal's own JavaScript SDK (`modal` on npm, pinned to 0.11.0), loaded only when the first sandbox is
// made, so a server on the local executor never loads it. Tests replace it with a fake `ModalBackend`.
// Review round 1:
// - A: sandboxes are made with the SDK's V2 backend (`experimentalCreate`) explicitly. Plain `create` picks V1 or V2
//   from the machine's Modal config; V2 is the one the live suite tested, so it is pinned, and runs record it.
// - B: the SDK's CBOR library would load a native add-on (`cbor-extract`, a prebuilt .node binary from npm) into
//   this server process. `loadModalSdk` sets CBOR_NATIVE_ACCELERATION_DISABLED=true first, so it uses plain JS.

import { posix } from "node:path";
import type { ExecRequest, ExecResult, ExecRuntime, Executor } from "../runner.ts";
import { guardedNodeArgs } from "./local.ts";
import { PYTHON_FLAGS, pythonEnv } from "./sandbox-exec-python.ts";

/** The pinned image. Node and Python are the same versions as this machine's (E1 ran on Node 25.8.1). */
export const MODAL_IMAGE = {
  base: "python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d",
  nodeVersion: "v25.8.1",
  nodeUrl: "https://nodejs.org/dist/v25.8.1/node-v25.8.1-linux-x64.tar.xz",
  nodeSha256: "8c13c85f73b1f8e57d5fff0732b3f25880910aafa6d5c811073a2ec7fcd45b4c",
  pythonVersion: "Python 3.14.7",
} as const;

/** One line naming the image, stored in each run's trace. */
export const MODAL_IMAGE_LABEL = `${MODAL_IMAGE.base} + node-${MODAL_IMAGE.nodeVersion}-linux-x64 (sha256 ${MODAL_IMAGE.nodeSha256})`;

/**
 * How the image is built on top of the pinned base. The Node tarball is checked against its published SHA-256
 * before the binary is kept; the official Linux build needs libatomic1, which the slim base lacks.
 */
export const MODAL_IMAGE_COMMANDS: readonly string[] = [
  `RUN python3 -c "import urllib.request,hashlib,tarfile,io,shutil; b=urllib.request.urlopen('${MODAL_IMAGE.nodeUrl}').read(); assert hashlib.sha256(b).hexdigest()=='${MODAL_IMAGE.nodeSha256}', 'node tarball checksum'; t=tarfile.open(fileobj=io.BytesIO(b),mode='r:xz'); f=t.extractfile('node-${MODAL_IMAGE.nodeVersion}-linux-x64/bin/node'); o=open('/usr/local/bin/node','wb'); shutil.copyfileobj(f,o); o.close()"`,
  "RUN chmod 755 /usr/local/bin/node && apt-get update && apt-get install -y --no-install-recommends libatomic1 && apt-get clean && node --version",
];

/** The run folder inside the container. Its name contains "atlas-exec-" so call-runner's stderr redaction covers it. */
export const SANDBOX_DIR = "/srv/atlas-exec-run";
export const NODE_BIN = "/usr/local/bin/node";
export const PYTHON_BIN = "/usr/local/bin/python3";
/** uid/gid of `nobody` in Debian. */
export const NOBODY = 65534;
/** Same cap as the local executor, per stream. */
export const MAX_OUTPUT_CHARS = 16 * 1024 * 1024;
export const MODAL_APP_NAME = "atlas-sandboxes";
/** Review round 1 (A): the sandbox backend, pinned. */
export const MODAL_BACKEND = "v2" as const;
/** What a control run's validity depends on besides Atlas's own files (D31's cache key). */
export const MODAL_FINGERPRINT = `modal ${MODAL_BACKEND} ${MODAL_IMAGE_LABEL}`;

/** Writes the files given as JSON on stdin into the folder named by argv[1], then prints the Node version. */
export const UNPACK_JS = [
  "const fs=require('fs'),path=require('path');",
  "const dir=process.argv[1];",
  "const files=JSON.parse(fs.readFileSync(0,'utf8'));",
  "fs.mkdirSync(dir,{recursive:true,mode:0o755});",
  "for(const [p,c] of Object.entries(files)){",
  "const full=path.resolve(dir,p);",
  "if(!full.startsWith(dir+'/')){process.stderr.write('a path leaves the run folder');process.exit(3);}",
  "fs.mkdirSync(path.dirname(full),{recursive:true,mode:0o755});",
  "fs.writeFileSync(full,c,{mode:0o644});}",
  "process.stdout.write(process.version);",
].join("");

/** What every sandbox is created with. Nothing here comes from the request. */
export interface SandboxSpec {
  blockNetwork: true;
  /** Physical cores reserved, and the hard cap. */
  cpu: number;
  cpuLimit: number;
  /** MiB reserved, and the hard cap (the container is killed above it). */
  memoryMiB: number;
  memoryLimitMiB: number;
  /** Modal's own lifetime limit for the container: the backstop if this server dies mid-run. */
  timeoutMs: number;
}

export interface ModalProcess {
  stdin: { writeText(text: string): Promise<void>; close(): Promise<void> };
  stdout: ReadableStream<string>;
  stderr: ReadableStream<string>;
  wait(): Promise<number>;
}

export interface ModalSandbox {
  sandboxId: string;
  exec(cmd: string[], opts: { workdir?: string }): Promise<ModalProcess>;
  terminate(): Promise<void>;
}

/** The only part of Modal the executor uses. The real one wraps the SDK; tests pass a fake. */
export interface ModalBackend {
  createSandbox(spec: SandboxSpec): Promise<ModalSandbox>;
}

export interface ModalExecutorOptions {
  backend?: ModalBackend;
  /** Sandboxes running at once (default 4). */
  maxConcurrent?: number;
  /** Execs allowed to wait for a slot (default 16); one more is refused as busy. */
  maxQueued?: number;
  /** Time to make the sandbox and write the files (default 120 s; the very first one may build the image). */
  startupTimeoutMs?: number;
  cpu?: number;
  cpuLimit?: number;
  memoryMiB?: number;
  memoryLimitMiB?: number;
  /** One line per sandbox (no code, no output, no key). Default: stderr. */
  log?: (line: string) => void;
  /** Review round 1 (C): sandboxes this executor may start per UTC day (default 2,000). */
  maxSandboxesPerDay?: number;
  /** Review round 1 (C): sandbox-seconds (create to terminate) per UTC day (default 7,200 = 2 hours). */
  maxSandboxSecondsPerDay?: number;
  /** The clock, for tests. */
  now?: () => number;
}

/**
 * Review round 1 (B): loads Modal's SDK with the CBOR library's native add-on switched off, so no native code from
 * npm is loaded into this server. Every load of the SDK goes through here.
 */
export async function loadModalSdk(): Promise<typeof import("modal")> {
  process.env.CBOR_NATIVE_ACCELERATION_DISABLED = "true";
  return import("modal");
}

/** The real backend: Modal's JS SDK, credentials from ~/.modal.toml or MODAL_TOKEN_ID/SECRET (read by the SDK, never by Atlas). */
export function sdkBackend(appName = MODAL_APP_NAME): ModalBackend {
  type Ready = { create: (spec: SandboxSpec) => Promise<ModalSandbox> };
  let ready: Promise<Ready> | null = null;
  const init = async (): Promise<Ready> => {
    const { ModalClient } = await loadModalSdk();
    const client = new ModalClient();
    const app = await client.apps.fromName(appName, { createIfMissing: true });
    const image = await client.images.fromRegistry(MODAL_IMAGE.base).dockerfileCommands([...MODAL_IMAGE_COMMANDS]).build(app);
    return {
      create: async (spec) => {
        // A: V2, explicitly (plain `create` would follow the machine's sandbox_v2 / MODAL_SANDBOX_V2 setting).
        const sb = await client.sandboxes.experimentalCreate(app, image, { ...spec });
        return {
          sandboxId: sb.sandboxId,
          exec: async (cmd, opts) => (await sb.exec(cmd, opts.workdir ? { workdir: opts.workdir } : {})) as unknown as ModalProcess,
          terminate: () => sb.terminate(),
        };
      },
    };
  };
  return {
    async createSandbox(spec) {
      const p = (ready ??= init());
      let r: Ready;
      try {
        r = await p;
      } catch (e) {
        if (ready === p) ready = null; // try again on the next run (Modal may be back)
        throw e;
      }
      return r.create(spec);
    },
  };
}

/** Thrown when the concurrency cap and the queue are both full. */
export class ModalBusyError extends Error {}
/** Review round 1 (C): thrown when today's sandbox budget is used up. Nothing runs, so nothing is judged. */
export class ModalBudgetError extends Error {}

/** Review round 1 (C): sandbox starts and sandbox-seconds per UTC day, kept in this process (a restart resets it). */
function dailyBudget(maxStarts: number, maxSeconds: number, now: () => number) {
  let day = "";
  let starts = 0;
  let seconds = 0;
  const today = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      starts = 0;
      seconds = 0;
    }
  };
  return {
    /** Counts one start, or throws when the day's budget is used up. */
    take(): void {
      today();
      if (starts >= maxStarts || seconds >= maxSeconds) {
        throw new ModalBudgetError(
          `Atlas's daily sandbox budget is used up (${starts} of ${maxStarts} sandboxes, ${Math.round(seconds)} of ${maxSeconds} sandbox-seconds today); it resets at 00:00 UTC`,
        );
      }
      starts++;
    },
    spend(ms: number): void {
      today();
      seconds += ms / 1000;
    },
    stats: () => (today(), { day, starts, seconds: Math.round(seconds) }),
  };
}

function slots(max: number, maxQueued: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return {
    get running() {
      return running;
    },
    get queued() {
      return waiting.length;
    },
    async acquire(): Promise<() => void> {
      if (running >= max) {
        if (waiting.length >= maxQueued) throw new ModalBusyError(`Atlas's Modal sandboxes are all busy (${running} running, ${waiting.length} waiting); try again shortly`);
        await new Promise<void>((r) => waiting.push(r));
      } else running++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = waiting.shift();
        if (next) next(); // the slot passes straight to the next waiter
        else running--;
      };
    },
  };
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function checkRequest(req: ExecRequest): void {
  if (req.cmd[0] !== "node" && req.cmd[0] !== "python3") throw new Error(`modal executor runs only "node" and "python3" commands; got "${req.cmd[0] ?? ""}"`);
  if (!(req.wallClockMs > 0)) throw new Error("wallClockMs must be a positive number");
  if (req.cmd[0] === "python3") {
    // Hosted Python (D24): the same rules as the macOS sandbox-exec executor. Script names only (Atlas sets the
    // interpreter flags itself), an empty environment, no network.
    const scripts = req.cmd.slice(1);
    if (scripts.length === 0 || scripts.some((a) => a.startsWith("-"))) throw new Error(`the Python command takes a script name only, no interpreter flags (Atlas sets ${PYTHON_FLAGS.join(" ")} itself)`);
    pythonEnv(req.env); // R1 (D42): only Atlas's pins (PYTHONHASHSEED, TZ); throws otherwise
    if (req.allowNetwork !== false) throw new Error("Python never gets network");
  }
  for (const [k, v] of Object.entries(req.env ?? {})) {
    if (k === "NODE_OPTIONS") throw new Error("NODE_OPTIONS is not allowed: it could switch the permission model off");
    if (!ENV_KEY.test(k) || v.includes("\0")) throw new Error(`env var "${k.slice(0, 40)}" is not a plain NAME=value pair`);
  }
  for (const p of Object.keys(req.files)) {
    const n = posix.normalize(p);
    if (p.includes("\0") || p.includes("\\") || posix.isAbsolute(n) || n === ".." || n.startsWith("../") || n === ".") throw new Error(`file path "${p}" leaves the sandbox folder`);
  }
}

/**
 * The command as it runs in the container: no inherited env, as nobody, then either Node with the local executor's
 * flags, or Python as `python3 -s -P -S -B <script>` (the same flags as the macOS sandbox-exec executor, PYTHON_FLAGS:
 * no user site, no script folder on the path, no site packages, no .pyc writes; R1 dropped -I's -E so the pinned
 * PYTHONHASHSEED is honoured, and the env holds only Atlas's pins). For Python the container, no network and the non-root user take the
 * place of sandbox-exec; the harness's audit hook and its in-process refusals are unchanged (runners/py/harness.py).
 */
export function containerCommand(req: ExecRequest): string[] {
  const env = Object.entries(req.env ?? {}).map(([k, v]) => `${k}=${v}`);
  const asNobody = ["/usr/bin/env", "-i", ...env, "/usr/bin/setpriv", `--reuid=${NOBODY}`, `--regid=${NOBODY}`, "--clear-groups", "--no-new-privs"];
  if (req.cmd[0] === "python3") return [...asNobody, PYTHON_BIN, ...PYTHON_FLAGS, ...req.cmd.slice(1)];
  return [...asNobody, NODE_BIN, ...guardedNodeArgs(req.cmd.slice(1), SANDBOX_DIR, req.allowNetwork)];
}

/** Reads a stream to its end, keeping at most `cap` characters (the rest is read and dropped, so the writer never blocks). */
async function drain(stream: ReadableStream<string>, sink: { text: string; chars: number }, cap: number): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    sink.chars += value.length;
    if (sink.text.length < cap) sink.text += value.length > cap - sink.text.length ? value.slice(0, cap - sink.text.length) : value;
  }
}

/** `p`, or a rejection with `message` after `ms`. A value that arrives late is handed to `late` (to clean it up). */
function deadline<T>(p: Promise<T>, ms: number, message: string, late?: (v: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false;
    const t = setTimeout(() => {
      over = true;
      reject(new Error(message));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        if (over) late?.(v);
        else resolve(v);
      },
      (e) => {
        clearTimeout(t);
        if (!over) reject(e);
      },
    );
  });
}

async function runSmall(sb: ModalSandbox, cmd: string[], stdin?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = await sb.exec(cmd, {});
  if (stdin !== undefined) await proc.stdin.writeText(stdin);
  await proc.stdin.close();
  const out = { text: "", chars: 0 };
  const err = { text: "", chars: 0 };
  const [exitCode] = await Promise.all([proc.wait(), drain(proc.stdout, out, 64 * 1024), drain(proc.stderr, err, 64 * 1024)]);
  return { stdout: out.text, stderr: err.text, exitCode };
}

/**
 * Review round 1 (E): Modal's own plumbing text (task and sandbox ids, internal RPC names, its "waiting on pid"
 * lines) is removed from anything a person may see. Lines that are only Modal's are dropped; ids are masked.
 */
export function cleanModalText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/urpc method|waiting on pid \d+|containerManager\.|TaskExecWait|FAILED_PRECONDITION/i.test(l))
    .join("\n")
    .replaceAll(/\b(?:ta|sb|ap|im|fu|in)-[A-Za-z0-9]{10,}\b/g, "<modal-id>");
}

const message = (e: unknown) => cleanModalText((e instanceof Error ? e.message : String(e)).replaceAll(/\s+/g, " ")).slice(0, 300);

/** A Modal error that means the sandbox went away under a running command (out of memory, killed, shutting down). */
const sandboxGone = (e: unknown) => /shutting down|NOT_FOUND|terminated|FAILED_PRECONDITION|EOF|UNAVAILABLE/i.test(e instanceof Error ? e.message : String(e));

export interface ModalExecutor extends Executor {
  kind: "modal";
  /** Sandboxes running now and execs waiting for one (for tests and the startup note). */
  stats(): { running: number; queued: number };
  /** Review round 1 (C): today's starts and sandbox-seconds. */
  budget(): { day: string; starts: number; seconds: number };
}

export function createModalExecutor(opts: ModalExecutorOptions = {}): ModalExecutor {
  const backend = opts.backend ?? sdkBackend();
  const pool = slots(Math.max(1, opts.maxConcurrent ?? 4), Math.max(0, opts.maxQueued ?? 16));
  const startupMs = opts.startupTimeoutMs ?? 120_000;
  const log = opts.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = opts.now ?? Date.now;
  const daily = dailyBudget(opts.maxSandboxesPerDay ?? 2_000, opts.maxSandboxSecondsPerDay ?? 7_200, now);

  return {
    kind: "modal",
    fingerprint: MODAL_FINGERPRINT,
    stats: () => ({ running: pool.running, queued: pool.queued }),
    budget: () => daily.stats(),
    async exec(req: ExecRequest): Promise<ExecResult> {
      checkRequest(req);
      const cmd = containerCommand(req); // throws on a widening flag or a host list, before any sandbox exists
      const release = await pool.acquire();
      try {
        daily.take(); // C: before any sandbox exists
      } catch (e) {
        release();
        throw e;
      }
      const t0 = performance.now();
      const since = () => Math.round(performance.now() - t0);
      let sb: ModalSandbox | undefined;
      let phase = "create";
      const times = { createMs: -1, setupMs: -1, runMs: -1 };
      let status = "error";
      let exitCode: number | null = null;
      let timedOut = false;
      let stopped: string | undefined;
      const out = { text: "", chars: 0 };
      const err = { text: "", chars: 0 };
      try {
        const spec: SandboxSpec = {
          blockNetwork: true,
          cpu: opts.cpu ?? 0.5,
          cpuLimit: opts.cpuLimit ?? 1,
          memoryMiB: opts.memoryMiB ?? 512,
          memoryLimitMiB: opts.memoryLimitMiB ?? 1024,
          timeoutMs: Math.ceil((startupMs + req.wallClockMs + 30_000) / 1000) * 1000,
        };
        sb = await deadline(backend.createSandbox(spec), startupMs, `Modal did not start a sandbox within ${startupMs} ms`, (late) => void late.terminate().catch(() => {}));
        times.createMs = since();
        const box = sb;

        // The files go in, and Python's version is read in THIS sandbox, at the same time (J: per sandbox, each
        // with a deadline, so one slow sandbox never holds another exec).
        phase = "write the files into";
        const [unpack, pyCheck] = await deadline(
          Promise.all([runSmall(box, [NODE_BIN, "-e", UNPACK_JS, SANDBOX_DIR], JSON.stringify(req.files)), runSmall(box, [PYTHON_BIN, "--version"])]),
          startupMs,
          `writing the files took more than ${startupMs} ms`,
        );
        if (unpack.exitCode !== 0) throw new Error(`the unpacker exited with code ${unpack.exitCode}${unpack.stderr ? ` (${message(unpack.stderr)})` : ""}`);
        const node = unpack.stdout.trim();
        if (node !== MODAL_IMAGE.nodeVersion) throw new Error(`the image runs Node ${node.slice(0, 40) || "(none)"}, not the pinned ${MODAL_IMAGE.nodeVersion}`);
        const py = `${pyCheck.stdout}${pyCheck.stderr}`.trim();
        if (pyCheck.exitCode !== 0 || py !== MODAL_IMAGE.pythonVersion) throw new Error(`the image runs ${py.slice(0, 40) || "no Python"}, not the pinned ${MODAL_IMAGE.pythonVersion}`);
        times.setupMs = since() - times.createMs;

        phase = "run the command in";
        const proc = await deadline(box.exec(cmd, { workdir: SANDBOX_DIR }), startupMs, `starting the command took more than ${startupMs} ms`); // J
        const started = performance.now();
        // stdin: the request's text (the per-run key), then EOF. G: a failure is remembered, not swallowed.
        let stdinError: string | undefined;
        const stdinDone = (async () => {
          try {
            if (req.stdin !== undefined) await proc.stdin.writeText(req.stdin);
            await proc.stdin.close();
          } catch (e) {
            stdinError = message(e);
          }
        })();
        const exitP = proc.wait();
        const outP = drain(proc.stdout, out, MAX_OUTPUT_CHARS);
        const errP = drain(proc.stderr, err, MAX_OUTPUT_CHARS);
        for (const p of [exitP, outP, errP, stdinDone]) (p as Promise<unknown>).catch(() => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        const limit = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), req.wallClockMs)));
        let done: { code: number } | "timeout";
        try {
          done = await Promise.race([Promise.all([exitP, outP, errP]).then(([code]) => ({ code })), limit]);
        } catch (e) {
          // F: the command DID start; the sandbox went away under it (out of memory, killed). That is a fact about
          // this run, never "could not start".
          if (!sandboxGone(e)) throw e;
          stopped = `the sandbox stopped while the code ran (${message(e).slice(0, 120)}); this usually means the code used more than the sandbox's ${spec.memoryLimitMiB} MiB of memory`;
          done = { code: -1 };
        } finally {
          clearTimeout(timer);
        }
        times.runMs = Math.round(performance.now() - started);
        if (done === "timeout") {
          // G: if the run's input never arrived, the code was waiting for Atlas, not looping.
          if (stdinError !== undefined) throw new Error(`Modal did not deliver the run's input (stdin): ${stdinError}`);
          timedOut = true;
          status = "timed out";
        } else if (stopped !== undefined) {
          status = "stopped";
        } else {
          exitCode = done.code;
          status = "done";
        }
        const runtime: ExecRuntime = { executor: "modal", backend: MODAL_BACKEND, node, python: py, image: MODAL_IMAGE_LABEL, sandboxId: box.sandboxId };
        return {
          stdout: out.text,
          stderr: cleanModalText(err.text), // E
          exitCode,
          timedOut,
          durationMs: times.runMs,
          runtime,
          ...(stopped !== undefined ? { stopped } : {}),
        };
      } catch (e) {
        if (e instanceof ModalBudgetError) throw e;
        throw new Error(`Modal could not ${phase} a sandbox: ${message(e)}`);
      } finally {
        if (sb) {
          const id = sb.sandboxId;
          await deadline(sb.terminate(), 15_000, "terminate took more than 15 s").catch((e: unknown) => log(`modal sandbox ${id} terminate failed (Modal's own timeout still ends it): ${message(e)}`));
        }
        daily.spend(performance.now() - t0); // C: create to terminate, as Atlas measured it
        release();
        log(
          `modal sandbox ${sb?.sandboxId ?? "(none)"} ${status} exit=${exitCode ?? "none"} timedOut=${timedOut} createMs=${times.createMs} setupMs=${times.setupMs} runMs=${times.runMs} totalMs=${since()} stdoutChars=${out.chars} stderrChars=${err.chars}`,
        );
      }
    },
  };
}
