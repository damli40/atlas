// Starts and stops a local Base fork with Foundry's `anvil`.
//
// Plain words: anvil runs a private copy of Base on this machine, starting from the real chain's
// state at one block. It fetches the state it needs from the remote RPC as it goes. Atlas then
// reads prices from this local copy only, never from the remote node directly.
//
// Rules this file keeps:
// - The RPC URL is a secret. It is passed to anvil as an argument and is never logged. anvil's
//   own output is kept in memory with the URL replaced by "<rpc>", and only shown (redacted) in
//   an error message when anvil fails to start.
// - One process per fork. stop() kills it (SIGTERM, then SIGKILL after a grace period), and any
//   fork still running when Node exits is killed too, so a failed or timed-out test leaves no
//   anvil behind.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { redact } from "./redact.ts";

export interface AnvilFork {
  /** http://127.0.0.1:<port>: the only URL reads may use. */
  url: string;
  port: number;
  forkBlock: number;
  /** Kill the process and wait until it has exited. Safe to call more than once. */
  stop(): Promise<void>;
}

export interface StartAnvilOptions {
  forkBlock: number;
  /** Defaults to process.env.BASE_RPC_URL. */
  rpcUrl?: string;
  /** How long to wait for the fork to answer before giving up. Default 60 s. */
  readyTimeoutMs?: number;
}

const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = () => {
    for (const p of live) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  process.on("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      killAll();
      process.exit(130);
    });
  }
}

/** Number of anvil processes this module started that have not exited yet (for tests). */
export function liveAnvilCount(): number {
  return live.size;
}

export { redact } from "./redact.ts";

/** Ask the OS for a free TCP port on 127.0.0.1. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

async function rpcAnswers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: unknown };
    return typeof body.result === "string";
  } catch {
    return false;
  }
}

/** Start `anvil --fork-url <rpc> --fork-block-number N --port <free> --silent` and wait until it answers. */
export async function startAnvil(opts: StartAnvilOptions): Promise<AnvilFork> {
  const rpcUrl = opts.rpcUrl ?? process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error("BASE_RPC_URL is not set: cannot fork Base");
  if (!Number.isSafeInteger(opts.forkBlock) || opts.forkBlock <= 0) {
    throw new RangeError(`forkBlock must be a positive whole number, got ${opts.forkBlock}`);
  }
  const readyTimeoutMs = opts.readyTimeoutMs ?? 60_000;
  installExitHook();

  const port = await freePort();
  const child = spawn(
    "anvil",
    ["--fork-url", rpcUrl, "--fork-block-number", String(opts.forkBlock), "--port", String(port), "--host", "127.0.0.1", "--silent"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  live.add(child);

  // Keep the last few KB of output, redacted, for an error message. Never printed otherwise.
  let output = "";
  const keep = (chunk: Buffer) => {
    output = (output + redact(chunk.toString("utf8"), rpcUrl)).slice(-4000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  let exited = false;
  let exitInfo = "";
  const exitedPromise = new Promise<void>((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      exitInfo = `code ${code ?? "null"}, signal ${signal ?? "none"}`;
      live.delete(child);
      resolve();
    });
    child.once("error", (err) => {
      exited = true;
      exitInfo = `spawn error: ${redact(err.message, rpcUrl)}`;
      live.delete(child);
      resolve();
    });
  });

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (exited) return Promise.resolve();
    if (stopping) return stopping;
    stopping = (async () => {
      child.kill("SIGTERM");
      const grace = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 3000).unref());
      if ((await Promise.race([exitedPromise.then(() => "exited" as const), grace])) === "timeout") {
        child.kill("SIGKILL");
        await exitedPromise;
      }
    })();
    return stopping;
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`anvil exited before it was ready (${exitInfo}). Output (redacted): ${output.trim() || "<none>"}`);
    }
    if (await rpcAnswers(url)) return { url, port, forkBlock: opts.forkBlock, stop };
    await new Promise((r) => setTimeout(r, 250));
  }
  await stop();
  throw new Error(`anvil did not answer within ${readyTimeoutMs} ms. Output (redacted): ${output.trim() || "<none>"}`);
}

/** Start a fork, run `fn` against it, and always stop the fork afterwards (also on error). */
export async function withAnvilFork<T>(opts: StartAnvilOptions, fn: (fork: AnvilFork) => Promise<T>): Promise<T> {
  const fork = await startAnvil(opts);
  try {
    return await fn(fork);
  } finally {
    await fork.stop();
  }
}
