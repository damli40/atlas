// Which executor this server runs pasted code in (E4). Chosen once, at startup, by ATLAS_EXECUTOR:
// - unset or "local": the local executor (Node's permission model on this machine);
// - "modal": a throwaway Modal Sandbox per exec (runners/executor/modal.ts). This is the hosted mode (D25).
// Anything else stops the server: a typo must never quietly mean "local".
//
// There is no fallback. With "modal", a run Modal cannot start throws, and the run "did not finish" with that reason;
// it is never run locally instead. Every Run records `executor.kind`, the executor that actually ran it.

import type { Executor } from "../runner.ts";
import { localExecutor } from "./local.ts";
import { createModalExecutor, type ModalExecutorOptions } from "./modal.ts";

const count = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d{1,4}$/.test(raw.trim())) throw new Error(`expected a whole number, got "${raw.slice(0, 20)}"`);
  return Math.min(Number(raw.trim()), max);
};

export function executorFromEnv(env: Record<string, string | undefined> = process.env, modalOpts: ModalExecutorOptions = {}): Executor {
  const choice = (env.ATLAS_EXECUTOR ?? "").trim();
  if (choice === "" || choice === "local") return localExecutor;
  if (choice === "modal") {
    return createModalExecutor({
      maxConcurrent: count(env.ATLAS_MODAL_MAX_SANDBOXES, 4, 50),
      maxQueued: count(env.ATLAS_MODAL_MAX_QUEUED, 16, 500),
      ...modalOpts,
    });
  }
  throw new Error(`ATLAS_EXECUTOR must be "local" or "modal"; got "${choice.slice(0, 40)}"`);
}
