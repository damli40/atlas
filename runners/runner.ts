// Runner and Executor interfaces.
//
// Plain words: an Executor is WHERE a command runs (this machine, or a cloud sandbox). A Runner
// is WHAT gets run (the TS harness or the EVM fork) and turns the raw output into a Run.

import type { Change, Experiment, Run, Target } from "../src/types.ts";

/** WHERE a command runs. One implementation per place (this machine, or a cloud sandbox); the Runner never knows which. */
export interface Executor {
  kind: "local" | "modal";
  /**
   * Added E4 review round 1 (D31): what a control run's validity depends on besides Atlas's own files, e.g. the
   * Node version, or the Modal backend and image. Part of the key a passed control is reused under.
   */
  fingerprint?: string;
  /**
   * R1 (D43) after G1: the executor local Python runs go through (macOS sandbox-exec), when this executor wraps it,
   * for example with the spend ledger. pythonExecutorFor uses it, so local Python sandboxes (and the double run's
   * second one) are counted like every other sandbox.
   */
  python?: Executor;
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
  }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    /**
     * Added E4: where the command actually ran, as measured by the executor (not as configured). Optional so older
     * fakes and executors still type-check; the call-function runner copies it into the run's trace.
     */
    runtime?: ExecRuntime;
    /**
     * Added E4 review round 1 (F): the command started, then the place it ran in went away under it (a Modal
     * sandbox stopped, usually out of memory). Plain words, safe to show. There is no exit code then.
     */
    stopped?: string;
  }>;
}

/** Added E4: the place and the exact versions a command ran with. */
export interface ExecRuntime {
  executor: "local" | "modal";
  /** Modal's sandbox backend, pinned (review round 1, A). Modal only. */
  backend?: "v2";
  /** `process.version` of the node that ran the command, e.g. "v25.8.1". */
  node: string;
  /** `python3 --version` inside the Modal image, e.g. "Python 3.14.7" (Modal only). */
  python?: string;
  /** The Modal image the sandbox was made from (base image digest + the pinned Node tarball). */
  image?: string;
  /** Modal's id of the throwaway sandbox (one per exec). */
  sandboxId?: string;
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
