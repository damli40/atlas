// Local executor: runs a Node command in a child process inside an empty temp folder.
//
// The boundary, in plain words:
// - Fresh temp folder per run. Only the files the caller passes are written there, and the
//   folder is deleted afterwards.
// - Node's permission model (`--permission`, stable in Node 25) is ALWAYS switched on. With it,
//   the child may read only its own temp folder. It may not write files, open network
//   connections, start child processes or worker threads, or load native add-ons. A blocked
//   attempt throws ERR_ACCESS_DENIED inside the child. Checked on Node 25.8.1, see
//   tests/unit/executor.test.ts. The older flag `--experimental-permission` is REJECTED by
//   Node 25 ("bad option"), so it is never used.
// - The child gets only the env vars the caller passes. Nothing from this process's
//   environment is inherited, so API keys and RPC URLs never reach the code under test.
// - A hard wall-clock limit: the child is killed (SIGKILL) when it runs out, and the result
//   says `timedOut: true`. This limit is Atlas's own, not the code's.
//
// What this boundary is NOT: it isn't an OS sandbox (no container, no seccomp). It relies on
// Node's permission model. Native code or a security flaw in Node itself would get past it.
// Only `node` commands run here: for any other program there is no way to enforce "no network",
// so they are refused rather than run unguarded.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { ExecRequest, ExecResult, Executor } from "../runner.ts";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** Rewrites the caller's node flags. Returns the final argv after the node binary. Shared with the Modal executor. */
export function guardedNodeArgs(args: string[], dir: string, allowNetwork: ExecRequest["allowNetwork"]): string[] {
  if (allowNetwork !== false) {
    // Node's permission model is all-or-nothing for network (--allow-net), so a host list cannot be honoured.
    throw new Error("local executor cannot limit network to specific hosts; refusing rather than allowing every host");
  }
  const out: string[] = [];
  for (const a of args) {
    if (a === "--permission" || a === "--experimental-permission") continue; // added below in its current form
    if (a === "--allow-fs-read=." || a === "--allow-fs-read=./") continue; // the temp folder is always readable
    if (a.startsWith("--allow-") || a.startsWith("--experimental-") || a === "--no-permission") {
      throw new Error(`local executor refuses the node flag "${a}" (it would widen the sandbox)`);
    }
    out.push(a);
  }
  return ["--permission", `--allow-fs-read=${dir}`, ...out];
}

function safePath(dir: string, p: string): string {
  const n = normalize(p);
  if (isAbsolute(n) || n === ".." || n.startsWith(`..${sep}`)) throw new Error(`file path "${p}" leaves the sandbox folder`);
  return join(dir, n);
}

export const localExecutor: Executor = {
  kind: "local",
  fingerprint: `local node ${process.version}`,
  async exec(req: ExecRequest): Promise<ExecResult> {
    if (req.cmd[0] !== "node") throw new Error(`local executor runs only "node" commands; got "${req.cmd[0] ?? ""}"`);
    if (!(req.wallClockMs > 0)) throw new Error("wallClockMs must be a positive number");
    if (req.env && "NODE_OPTIONS" in req.env) throw new Error("NODE_OPTIONS is not allowed: it could switch the permission model off");

    // realpath: on macOS the temp dir is behind a symlink (/var -> /private/var); the permission model checks real paths.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "atlas-exec-")));
    try {
      for (const [p, contents] of Object.entries(req.files)) {
        const full = safePath(dir, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, contents);
      }
      const args = guardedNodeArgs(req.cmd.slice(1), dir, req.allowNetwork);

      return await new Promise<ExecResult>((resolve, reject) => {
        const started = performance.now();
        const child = spawn(process.execPath, args, {
          cwd: dir,
          env: { ...(req.env ?? {}) },
          stdio: [req.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
        });
        if (req.stdin !== undefined && child.stdin) {
          child.stdin.on("error", () => {}); // the child may exit before reading it; that is its answer, not ours
          child.stdin.end(req.stdin);
        }
        // Raw bytes, decoded once at the end: decoding each chunk on its own turned a multi-byte character split
        // across two pipe reads into two U+FFFD, which broke the result line's HMAC (tests/unit/local-executor-utf8).
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
          resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), exitCode: code, timedOut, durationMs: Math.round(performance.now() - started), runtime: { executor: "local", node: process.version } });
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
