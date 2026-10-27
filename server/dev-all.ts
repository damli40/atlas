// `pnpm dev:all`: starts the Hono server (port 8787) and the Vite dev server together, prints both,
// and stops both when either stops or on Ctrl-C. Vite forwards /api/* to 8787 (vite.config.ts).

import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];
let stopping = false;

function start(name: string, args: string[]): void {
  const child = spawn("pnpm", ["exec", ...args], { stdio: "inherit", env: process.env });
  children.push(child);
  child.on("exit", (code) => {
    if (!stopping) console.log(`[dev:all] ${name} stopped (exit ${code}); stopping the other one`);
    stopAll(code ?? 0);
  });
}

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

start("server", ["tsx", "server/index.ts"]);
start("vite", ["vite"]);
