// Runner and Executor interfaces.
//
// Plain words: an Executor is WHERE a command runs (this machine, or a cloud sandbox). A Runner
// is WHAT gets run (the TS harness or the EVM fork) and turns the raw output into a Run.

import type { Change, Experiment, Run, Target } from "../src/types.ts";

/** WHERE a command runs. One implementation per place (this machine, or a cloud sandbox); the Runner never knows which. */
export interface Executor {
  kind: "local" | "modal";
  /** Run a command in an isolated working dir with the given files, no network unless allowNetwork, hard wall-clock limit. */
  exec(req: {
    files: Record<string, string>;          // path → contents
    cmd: string[];                          // e.g. ["node", "--permission", "--allow-fs-read=.", "worker.mjs"]
    env?: Record<string, string>;
    wallClockMs: number;                    // the harness's OWN limit; the code under test has none
    allowNetwork: false | { hosts: string[] };  // evm: only the anvil port on localhost
  }): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }>;
}

export type ExecRequest = Parameters<Executor["exec"]>[0];
export type ExecResult = Awaited<ReturnType<Executor["exec"]>>;

export interface Runner {
  kind: "ts" | "evm";
  /** Must pass before any verdict on this runner counts. Returns the control run. */
  control(target: Target): Promise<Run>;
  run(exp: Experiment, opts: { seed?: string; forkBlock?: number; replayOf?: Run["replayOf"] }): Promise<Run>;
  /** Apply a Change in a scratch copy and run the SAME experiment with the SAME seed/forkBlock. */
  replayWithChange(run: Run, change: Change): Promise<Run>;
}
