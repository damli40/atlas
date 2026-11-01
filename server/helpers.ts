// R3 journey item 1: the third run. It records which of the file's own functions ran and what they returned (`subtotal → 5500`),
// for the drawing only.
//
// The rule that makes this safe: measured facts stay unprobed. The two sealed runs run untouched and decide every verdict.
// This third run starts after they have finished, so it cannot disturb them, and it feeds nothing but the drawing: not the
// verdict, not the proof file. If what it measured differs from the sealed run in any way (a changed count, a time, how it
// ended), the probes may have changed the code's behaviour, so no helper is shown and the words say why.

import { randomBytes } from "node:crypto";
import { helperSteps, type HelperStep, type ProbeEvent } from "../src/helper-steps";
import { instrumentJs } from "../src/helpers/instrument-js";
import { canonicalJson } from "../src/seal";
import type { Experiment, Run, TraceEvent } from "../src/types";
import type { Executor } from "../runners/runner";
import { runProbedCall } from "../runners/ts/call-runner";
import { runProbedPyCall } from "../runners/py/py-runner";

export type HelperAnswer = { steps: HelperStep[]; more: number } | { none: string };

export const HELPER_WORDS = {
  different: (what: string) => `Helper steps are not shown: the extra run made to see them went differently from the sealed run (${what}), so it can't be trusted for this.`,
  failed: (why: string) => `Helper steps are not shown: the extra run made to see them did not finish (${why}).`,
  limit: (why: string) => `Helper steps are not shown: ${why}.`,
  notPasted: "Helper steps are only drawn for pasted code.",
  noParse: "Helper steps are not shown: Atlas could not add its probes to this file.",
  unsharedRun: "Helper steps are not shown: the sealed run was not shown as fact.",
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
  const opts = { ...(o.executor ? { executor: o.executor } : {}), ...(o.wallClockMs ? { wallClockMs: o.wallClockMs } : {}), ...seed };
  const source = exp.target.source;
  const language = exp.target.language;
  if (source === undefined || language === undefined) return { none: HELPER_WORDS.notPasted };
  let third: { trace: TraceEvent[]; result: Run["result"]; probes: ProbeEvent[] } | { reason: string };
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
  if ("reason" in third) return { none: HELPER_WORDS.failed(third.reason) };
  const differs = differsFrom(sealed, third);
  if (differs !== null) return { none: HELPER_WORDS.different(differs) };
  // Python's names come from the run, so they must at least be words of the file.
  const allowed = language === "py" ? (n: string) => n.split(".").every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) && source.includes(part)) : undefined;
  return helperSteps(third.probes, { ...(names ? { names } : {}), tested: testedNames(exp.params), trace: third.trace, ...(allowed ? { allowed } : {}) });
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
