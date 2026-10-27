// Which runner runs pasted code, by language (E3). The one place a new language plugs in.
//
// Plain words: the paste screen and the server ask this table three things about a language: can Atlas run it
// here, which functions does a file export, and how to run the known-case check and one experiment. A language
// with no entry shows as "coming" on the screen and nothing about it is guessed. To add Python, a batch adds one
// entry `py: { ... }` below with its own export finder, control and run; the screen and the server need no change.

import type { Experiment, Run } from "../src/types.ts";
import { exportedFunctionsFor, staticRefusalFor, type FoundExport, type PastedLanguage } from "../src/pasted-code.ts";
import type { Executor } from "./runner.ts";
import { callControlFor, runCallExperiment } from "./ts/call-runner.ts";
import { pyControlFor, runPyCallExperiment } from "./py/py-runner.ts";
import { pythonExecutorFor } from "./ts/control.ts";

export interface PastedRunner {
  /** What plain code can tell before running: the exported functions, and why the whole run would be "can't check" (null: nothing found). */
  read(source: string): { exports: FoundExport[]; refusal: string | null };
  /** The known-case check of this runner's harness (no pasted code involved). */
  control(executor: Executor): Promise<Run>;
  /** One experiment, given a control Run made by `control`. */
  run(exp: Experiment, ctl: Run, executor: Executor): Promise<Run>;
}

/** JavaScript and TypeScript share the E1 call-function runner (Node, type stripping built in). */
const jsTsRunner: PastedRunner = {
  read: (source) => ({ exports: exportedFunctionsFor(source, "js"), refusal: staticRefusalFor(source, "js") }),
  // D31 (E4): the control is reused for up to 10 minutes when it passed on this same executor and harness.
  control: async (executor) => (await callControlFor({ executor })).run,
  run: (exp, ctl, executor) => runCallExperiment(exp, ctl, { executor }),
};

/**
 * E2/E3/E4: Python runs on the executor the server chose (ATLAS_EXECUTOR): with Modal, the same Modal executor as
 * JavaScript; with the local executor, macOS sandbox-exec (E4's pythonExecutorFor; never a hard-wired one). Top-level
 * `def` / `async def` are the functions a person can pick; an import outside the standard library is refused before
 * running, and a standard-library module the sandbox does not load is refused at run time, each with its reason.
 */
const pyRunner: PastedRunner = {
  read: (source) => ({ exports: exportedFunctionsFor(source, "py"), refusal: staticRefusalFor(source, "py") }),
  control: async (executor) => (await pyControlFor({ executor: pythonExecutorFor(executor) })).run, // D31
  run: (exp, ctl, executor) => runPyCallExperiment(exp, ctl, { executor: pythonExecutorFor(executor) }),
};

export type PastedRunners = Partial<Record<PastedLanguage, PastedRunner>>;

/** The runners this build has. A language missing here is "coming". */
export const PASTED_RUNNERS: PastedRunners = { js: jsTsRunner, ts: jsTsRunner, py: pyRunner };
