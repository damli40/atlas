// Whether a run may be shown as fact, decided by plain code from the run alone.
//
// Plain words: a drawing or a sentence may only show what plain code measured. When Atlas's
// known-case check (the "control": a case whose answer is known, run first on the same code) did not
// match, or the sandbox never finished the run, nothing from that run is shown as fact: no machine
// motion, no readout numbers, no "Ask why" sentence. The page shows the reason instead.
// Same rule as src/judge.ts step 1: only a strict `controlPassed === true` counts.
// Added E1: a run whose runner wrote `notMeasured.wholeRun` (the code needed a package, the sandbox refused an
// access, the export was missing, ...) is not shown as fact either; the page shows that reason.
// Imports types only; no I/O, no clock, no model.

import type { Run } from "./types";

const own = (o: unknown, k: string): unknown =>
  o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;

/**
 * null when the run may be shown as fact. Otherwise the one sentence the page shows in its place:
 * "Atlas's known-case check did not match, so this run is not shown as fact: <reason>", or, when the
 * control passed but the sandbox returned nothing, "The sandbox did not finish this run, so nothing from
 * it is shown as fact: <reason>".
 */
export function notShownAsFact(run: Pick<Run, "controlPassed" | "trace" | "result">): string | null {
  const notMeasured = run.result?.notMeasured;
  if (run.controlPassed !== true) {
    const why = own(notMeasured, "control");
    const reason =
      typeof why === "string" && why.trim()
        ? why
        : run.controlPassed === false
          ? "the control run did not match the known case"
          : "the run has no control result";
    return `Atlas's known-case check did not match, so this run is not shown as fact: ${reason}`;
  }
  const whole = own(notMeasured, "wholeRun");
  if (typeof whole === "string" && whole.trim()) return `Atlas could not check this run, so nothing from it is shown as fact: ${whole}`;
  const sandbox = own(notMeasured, "run");
  if (typeof sandbox === "string" && sandbox.trim()) return `The sandbox did not finish this run, so nothing from it is shown as fact: ${sandbox}`;
  if (!Array.isArray(run.trace) || run.trace.length === 0) return "The sandbox did not finish this run, so nothing from it is shown as fact: the run recorded no trace";
  return null;
}
