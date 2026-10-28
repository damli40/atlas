// Python executor: runs `python3` inside macOS's OS sandbox (sandbox-exec), in an empty temp folder.
//
// The boundary, in plain words:
// - macOS only. sandbox-exec is the operating system's own sandbox: the rules below are enforced by the kernel,
//   not by Python, so they hold even if the code escapes Atlas's in-process checks (runners/py/harness.py).
//   On any other OS this executor refuses to run anything; hosted runs will use Modal (batch E4).
// - The profile starts from "deny everything" and allows only:
//   - executing the one Python interpreter binary (no other program, no fork, no second process);
//   - reading the Python installation (its standard library), the run's own temp folder, and the system
//     libraries the dynamic loader needs (/usr/lib and the dyld shared cache), plus the root folder's entry;
//   - mapping code from those same places.
//   Not allowed: any network, any file write, reading anything else (the home folder, ~/.config, /etc,
//   /private/tmp), even reading file names or sizes elsewhere (no metadata reads), sysctl, and IPC lookups.
//   Each denial is proven by a test in tests/unit/py-sandbox.test.ts.
// - Python runs as `python -s -P -S -B`: no user site folder, the script's folder is not put on the import path, no
//   `site` (no third-party packages at all), no .pyc writes. R1 (D42): this was `-I` (isolated mode), which also
//   ignores every PYTHON* environment variable, including PYTHONHASHSEED, the only way to fix the seed Python orders
//   sets of text by. So the flags are -I's parts minus -E, and the environment Atlas passes is the guard instead.
// - The environment holds only what Atlas pins (PYTHON_PINNED_ENV: PYTHONHASHSEED and TZ, values checked). The
//   child never sees this process's API keys or RPC URLs.
// - A hard wall-clock limit: the process is killed (SIGKILL) when it runs out (`timedOut: true`).
//
// Which Python: the first of PYTHON_CANDIDATES that reports version 3.12 or newer, in that fixed order (so the
// same machine always picks the same one). The framework launcher (bin/python3.x) re-spawns the real binary
// inside Python.app; spawning is denied, so the real binary is executed directly. The version actually used is
// reported by the harness inside its signed result and recorded in every run's trace.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { ExecRequest, ExecResult, Executor } from "../runner.ts";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/** Where Atlas looks for python3, in this order. */
export const PYTHON_CANDIDATES = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"] as const;
/** The oldest Python the harness supports (sys._getframemodulename, asyncio's Runner, PEP 578 hooks). */
export const PYTHON_MIN: readonly [number, number] = [3, 12];
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** R1 (D42): the interpreter flags, shared with the Modal executor: -I's parts minus -E (see the top of this file). */
export const PYTHON_FLAGS = ["-s", "-P", "-S", "-B"] as const;

/**
 * R1 (D42): the only environment variables a Python sandbox may get, each with the values Atlas accepts: the string-
 * hash seed (a whole number 1..4294967295; 0 would switch hashing back to random) and the time zone (UTC only).
 */
export const PYTHON_PINNED_ENV: Readonly<Record<string, RegExp>> = {
  PYTHONHASHSEED: /^[1-9]\d{0,9}$/,
  TZ: /^UTC$/,
  // R1 review round 2 (m2): the C locale on every executor. Without these, Linux "coerces" C to C.UTF-8 and macOS's
  // sandbox cannot, so the two disagreed. Python then runs in its UTF-8 mode in both (PEP 540).
  LC_ALL: /^C$/,
  PYTHONCOERCECLOCALE: /^0$/,
};

/** The env a Python run may have: only PYTHON_PINNED_ENV keys with accepted values. Throws otherwise. */
export function pythonEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env ?? {})) {
    const ok = Object.prototype.hasOwnProperty.call(PYTHON_PINNED_ENV, k) && PYTHON_PINNED_ENV[k]!.test(v) && (k !== "PYTHONHASHSEED" || Number(v) <= 4_294_967_295);
    if (!ok) throw new Error(`Python runs with an empty environment apart from Atlas's pins (${Object.keys(PYTHON_PINNED_ENV).join(", ")}); refused "${k.slice(0, 40)}"`);
    out[k] = v;
  }
  return out;
}

export interface PythonRuntime {
  /** The binary that is executed inside the sandbox (a real path). */
  interpreter: string;
  /** sys.base_prefix, real path: the installation, readable inside the sandbox. */
  prefix: string;
  /** "3.14.7" */
  version: string;
  /** The candidate it was found through. */
  foundAs: string;
}

/** Quotes a path for the sandbox profile language (a string literal). */
const sbString = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** System paths the dynamic loader reads (libSystem and the dyld shared cache). */
export const SYSTEM_LIBRARY_PATHS = ["/usr/lib", "/System/Library/dyld", "/System/Volumes/Preboot/Cryptexes", "/System/Cryptexes"] as const;

/** The sandbox profile for one Python run. Every path must be a real path (/var is /private/var on macOS). */
export function pythonSandboxProfile(o: { interpreter: string; prefix: string; workdir: string }): string {
  const sys = SYSTEM_LIBRARY_PATHS.map((p) => `(subpath ${sbString(p)})`).join(" ");
  return [
    "(version 1)",
    "(deny default)",
    `(allow process-exec (literal ${sbString(o.interpreter)}))`,
    `(allow file-read* (subpath ${sbString(o.prefix)}) (subpath ${sbString(o.workdir)}) (literal "/") ${sys})`,
    `(allow file-map-executable (subpath ${sbString(o.prefix)}) ${sys})`,
    "",
  ].join("\n");
}

/** Why Atlas will not run Python on this machine, or null when it can. */
export function pythonRefusal(): string | null {
  if (process.platform !== "darwin") return `Python runs locally only on macOS (inside sandbox-exec); this machine is ${process.platform}, so hosted runs use Modal`;
  if (!existsSync(SANDBOX_EXEC)) return "this Mac has no /usr/bin/sandbox-exec, so Atlas will not run Python here";
  return null;
}

let cached: PythonRuntime | null | undefined;

/** The Python Atlas uses on this machine (fixed candidate order; cached), or null when there is none. */
export function findPython(): PythonRuntime | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (pythonRefusal()) return null;
  for (const cand of PYTHON_CANDIDATES) {
    if (!existsSync(cand)) continue;
    let out: string;
    try {
      out = execFileSync(cand, ["-I", "-S", "-c", "import sys; print(sys.base_prefix); print('%d.%d.%d' % sys.version_info[:3]); print(sys.executable)"], {
        env: {},
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      continue;
    }
    const [prefixRaw, version, exe] = out.trim().split("\n");
    if (!prefixRaw || !version || !exe) continue;
    const [maj, min] = version.split(".").map(Number);
    if (!(maj! > PYTHON_MIN[0] || (maj === PYTHON_MIN[0] && min! >= PYTHON_MIN[1]))) continue;
    const prefix = realpathSync(prefixRaw);
    const app = join(prefix, "Resources/Python.app/Contents/MacOS/Python");
    const interpreter = existsSync(app) ? realpathSync(app) : realpathSync(exe);
    cached = { interpreter, prefix, version, foundAs: cand };
    return cached;
  }
  return null;
}

function safePath(dir: string, p: string): string {
  const n = normalize(p);
  if (isAbsolute(n) || n === ".." || n.startsWith(`..${sep}`)) throw new Error(`file path "${p}" leaves the sandbox folder`);
  return join(dir, n);
}

export const pythonSandboxExecutor: Executor = {
  kind: "local",
  /** E4 (D31): part of the Python control's reuse key. */
  get fingerprint() {
    return `local sandbox-exec python ${findPython()?.version ?? "(none)"}`;
  },
  async exec(req: ExecRequest): Promise<ExecResult> {
    if (req.cmd[0] !== "python3") throw new Error(`the Python executor runs only "python3" commands; got "${req.cmd[0] ?? ""}"`);
    const scripts = req.cmd.slice(1);
    if (scripts.length === 0 || scripts.some((a) => a.startsWith("-"))) throw new Error(`the Python executor takes a script name only, no interpreter flags (it sets ${PYTHON_FLAGS.join(" ")} itself)`);
    if (req.allowNetwork !== false) throw new Error("the Python executor never allows network");
    const env = pythonEnv(req.env);
    if (!(req.wallClockMs > 0)) throw new Error("wallClockMs must be a positive number");
    const refused = pythonRefusal();
    if (refused) throw new Error(refused);
    const py = findPython();
    if (!py) throw new Error(`no Python ${PYTHON_MIN.join(".")}+ found at ${PYTHON_CANDIDATES.join(", ")}`);

    const dir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-pyexec-")));
    const profileDir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-pyprofile-")));
    try {
      for (const [p, contents] of Object.entries(req.files)) {
        const full = safePath(dir, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
      }
      const profile = join(profileDir, "python.sb");
      writeFileSync(profile, pythonSandboxProfile({ interpreter: py.interpreter, prefix: py.prefix, workdir: dir }));
      return await new Promise<ExecResult>((resolve, reject) => {
        const started = performance.now();
        const child = spawn(SANDBOX_EXEC, ["-f", profile, py.interpreter, ...PYTHON_FLAGS, ...scripts], {
          cwd: dir,
          env,
          stdio: [req.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        });
        if (req.stdin !== undefined && child.stdin) {
          child.stdin.on("error", () => {}); // the child may exit before reading it; that is its answer, not ours
          child.stdin.end(req.stdin);
        }
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outBytes = 0;
        let errBytes = 0;
        let timedOut = false;
        child.stdout!.on("data", (b: Buffer) => {
          if (outBytes < MAX_OUTPUT_BYTES) out.push(b);
          outBytes += b.length;
        });
        child.stderr!.on("data", (b: Buffer) => {
          if (errBytes < MAX_OUTPUT_BYTES) err.push(b);
          errBytes += b.length;
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, req.wallClockMs);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          // Decoded once, at the end: a character split across two chunks stays whole.
          resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), exitCode: code, timedOut, durationMs: Math.round(performance.now() - started) });
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(profileDir, { recursive: true, force: true });
    }
  },
};
