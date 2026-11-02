// R3 journey item 1, narrowed by D61: the third run. It records which of the file's own functions ran, and in what order, for the
// drawing only. Never a value. The run is untrusted by design: it carries no signing key, its answer is read through a strict schema,
// and the code itself could change what it reports, which the caption says.
//
// The rule that makes this safe: measured facts stay unprobed. The two sealed runs run untouched and decide every verdict.
// This third run starts after they have finished, so it cannot disturb them, and it feeds nothing but the drawing: not the
// verdict, not the proof file. If what it measured differs from the sealed run in any way (a changed count, a time, how it
// ended), the probes may have changed the code's behaviour, so no helper is shown and the words say why.

import { randomBytes } from "node:crypto";
import { helperSteps, type HelperStep } from "../src/helper-steps";
import { instrumentJs } from "../src/helpers/instrument-js";
import { canonicalJson } from "../src/seal";
import type { Experiment, Run, TraceEvent } from "../src/types";
import type { Executor } from "../runners/runner";
import { pythonExecutorFor } from "../runners/ts/control";
import { runProbedCall } from "../runners/ts/call-runner";
import { runProbedPyCall } from "../runners/py/py-runner";

export type HelperAnswer = { steps: HelperStep[]; cut: boolean; thrownAt?: number } | { none: string };

export const HELPER_WORDS = {
  different: "Helper order is not shown: the separate traced run did not match the sealed run on what it measured or the steps it took.",
  // Never the runner's own words: the copy that failed is Atlas's, not the person's code.
  failed: "Helper order is not shown: Atlas's traced copy of this code did not finish. Your code and its sealed runs are not affected.",
  limit: (why: string) => `Helper order is not shown: ${why}.`,
  notPasted: "Helper order is only drawn for pasted code.",
  gone: "Helper order is no longer available for this run.",
  noParse: "Helper order is not shown: Atlas could not trace this file.",
  unsharedRun: "Helper order is not shown: the sealed run was not shown as fact.",
} as const;

const BOOKKEEPING = new Set(["call_checks", "clock_moves", "conditions", "log", "control"]);
const fingerprint = (e: TraceEvent) => {
  const d = (e.data ?? {}) as Record<string, unknown>;
  return `${e.t}|${e.event}|${typeof d.name === "string" ? d.name : ""}|${typeof d.n === "number" ? d.n : ""}|${typeof d.errorName === "string" ? d.errorName : ""}`;
};

/** How the third run differs from the sealed run, or null when it does not. Exported for the tests. */
export function differsFrom(sealed: Pick<Run, "trace" | "result">, third: { trace: TraceEvent[]; result: Run["result"] }): string | null {
  if (canonicalJson(sealed.result.measured as never) !== canonicalJson(third.result.measured as never)) return "what it measured";
  if (canonicalJson(sealed.result.notMeasured as never) !== canonicalJson(third.result.notMeasured as never)) return "what it could not measure";
  const a = sealed.trace.filter((e) => !BOOKKEEPING.has(e.event));
  const b = third.trace.filter((e) => !BOOKKEEPING.has(e.event));
  if (a.length !== b.length) return "how many events it recorded";
  for (let i = 0; i < a.length; i++) if (fingerprint(a[i]!) !== fingerprint(b[i]!)) return `event ${i + 1} of its trace`;
  return null;
}

/** The functions the test calls: the tested function's own frame is the run, not a step. */
const testedNames = (p: Experiment["params"]): string[] => (p.shape === "call-function" ? [p.exportName, ...(p.calls ?? []).map((c) => c.exportName)] : []);

export async function helperRun(exp: Experiment, sealed: Run, o: { executor?: Executor; wallClockMs?: number } = {}): Promise<HelperAnswer> {
  if (exp.target.kind !== "pasted" || exp.params.shape !== "call-function") return { none: HELPER_WORDS.notPasted };
  if (!sealed.result || "wholeRun" in sealed.result.notMeasured) return { none: HELPER_WORDS.unsharedRun };
  const seed = sealed.seed && sealed.seed !== "none" ? { seed: sealed.seed } : {};
  const source = exp.target.source;
  const language = exp.target.language;
  if (source === undefined || language === undefined) return { none: HELPER_WORDS.notPasted };
  const opts = { ...(o.executor ? { executor: language === "py" ? pythonExecutorFor(o.executor) : o.executor } : {}), ...(o.wallClockMs ? { wallClockMs: o.wallClockMs } : {}), ...seed };
  let third: { trace: TraceEvent[]; result: Run["result"]; probes: unknown; probesCut: unknown; thrownLine: unknown } | { reason: string };
  let names: string[] | undefined;
  if (language === "py") {
    third = await runProbedPyCall(exp, source, opts);
  } else {
    const probe = `__atlasP_${randomBytes(8).toString("hex")}`;
    const done = instrumentJs(source, language, probe);
    if (!done) return { none: HELPER_WORDS.noParse };
    names = done.names;
    third = await runProbedCall(exp, done.source, language, probe, opts);
  }
  if ("reason" in third) return { none: HELPER_WORDS.failed };
  // A shape that is not what a run writes is treated like any other difference.
  if (!Array.isArray(third.trace) || !third.result || typeof third.result.measured !== "object" || typeof third.result.notMeasured !== "object") return { none: HELPER_WORDS.different };
  if (differsFrom(sealed, third) !== null) return { none: HELPER_WORDS.different };
  // Python's names come from the run, so they must at least be words of the file.
  const allowed = language === "py" ? (n: string) => n.split(".").every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) && source.includes(part)) : undefined;
  const steps = helperSteps(third.probes, { ...(names ? { names } : {}), tested: testedNames(exp.params), trace: third.trace, ...(allowed ? { allowed } : {}), cut: third.probesCut });
  // Read strictly: a whole number that is a line of this file, on a run that threw. Anything else is no line at all.
  const line = third.thrownLine;
  const lines = source.split(/\r\n|\r|\n/).length;
  return third.result.measured.outcome === "threw" && typeof line === "number" && Number.isSafeInteger(line) && line >= 1 && line <= lines ? { ...steps, thrownAt: line } : steps;
}

/** What was started for each run, kept briefly: the page asks for it right after the run's answer. */
export function createHelperStore(max = 64) {
  const kept = new Map<string, Promise<HelperAnswer>>();
  return {
    put(runId: string, p: Promise<HelperAnswer>) {
      if (kept.size >= max) kept.delete(kept.keys().next().value!);
      kept.set(runId, p);
    },
    get: (runId: string) => kept.get(runId),
  };
}
