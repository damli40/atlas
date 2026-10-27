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
    /**
     * Added E1 review round 1: text written to the child's stdin, then stdin is closed. The call-function worker
     * reads its per-run result key from here, so the key is never on the command line or in a file.
     */
    stdin?: string;
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
  /**
   * Apply a Change in a scratch copy and run the SAME experiment with the SAME seed/forkBlock.
   * Changed D06-01 (noted in tests/evidence/D06-01/README.md): a Run names its experiment only by
   * id, so the caller passes the experiment itself in `ctx`. The runner asserts it is the run's.
   */
  replayWithChange(run: Run, change: Change, ctx: ReplayContext): Promise<Run>;
}

export interface ReplayContext {
  /** The experiment `run` ran (run.experimentId must equal experiment.id). */
  experiment: Experiment;
  /** One short present-tense line per step (the server streams them to the agent log). */
  onProgress?: (step: string) => void;
}
