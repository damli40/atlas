// Which executor this server runs pasted code in (E4). Chosen once, at startup, by ATLAS_EXECUTOR:
// - unset, or "local": the local executor (Node's permission model on this machine);
// - "modal": a throwaway Modal Sandbox per exec (runners/executor/modal.ts). This is the hosted mode (D25).
// Anything else, including set-but-empty, stops the server: a typo must never quietly mean "local".
//
// There is no fallback. With "modal", a run Modal cannot start throws, and the run "did not finish" with that reason;
// it is never run locally instead. Every Run records `executor.kind`, the executor that actually ran it.

import type { Executor } from "../runner.ts";
import { localExecutor } from "./local.ts";
import { createModalExecutor, type ModalExecutorOptions } from "./modal.ts";

const count = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d{1,7}$/.test(raw.trim())) throw new Error(`expected a whole number, got "${raw.slice(0, 20)}"`);
  return Math.min(Number(raw.trim()), max);
};

export function executorFromEnv(env: Record<string, string | undefined> = process.env, modalOpts: ModalExecutorOptions = {}): Executor {
  const raw = env.ATLAS_EXECUTOR;
  if (raw === undefined) return localExecutor;
  const choice = raw.trim();
  // Review round 1 (H): set but empty (e.g. a deploy template that produced "ATLAS_EXECUTOR=") is a mistake, not "local".
  if (choice === "") throw new Error('ATLAS_EXECUTOR is set but empty: set it to "local" or "modal", or remove it');
  if (choice === "local") return localExecutor;
  if (choice === "modal") {
    return createModalExecutor({
      maxConcurrent: count(env.ATLAS_MODAL_MAX_SANDBOXES, 4, 50),
      maxQueued: count(env.ATLAS_MODAL_MAX_QUEUED, 16, 500),
      // Review round 1 (C): the daily caps (sandbox starts, and sandbox-seconds from create to terminate).
      maxSandboxesPerDay: count(env.ATLAS_MODAL_MAX_SANDBOXES_PER_DAY, 2_000, 1_000_000),
      maxSandboxSecondsPerDay: count(env.ATLAS_MODAL_MAX_SANDBOX_SECONDS_PER_DAY, 7_200, 1_000_000),
      ...modalOpts,
    });
  }
  throw new Error(`ATLAS_EXECUTOR must be "local" or "modal"; got "${choice.slice(0, 40)}"`);
}
