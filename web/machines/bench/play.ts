// U1 (D47): what the drawing plays and marks AFTER the bets are sealed. Two pure functions:
// - playScript(run, test, tested): the run's own trace, as steps on the drawing (each stand-in device lights once per
//   call with its scripted answer, the clock dial moves to the virtual moment, the function box shows its ending).
//   It reads the run through calltimeline/model.ts (the trust rules live there: a run that may not be shown as fact
//   gives NO steps), and a field the run did not measure animates nothing for that field: no lamp for a stand-in
//   whose count is "can't check", no dial for a time that is "can't check", no ending for an ending that is.
// - marksOf(...): one mark per quiz question, anchored on the part it is about, with the verdict of every bettor.
// The test is used only for words (the scripted answer of call n); what happened always comes from the run.

import type { Bet, Run, StandInStep, Verdict } from "../../../src/types";
import type { Question } from "../../../src/gate";
import { timelineModel } from "../calltimeline/model";
import { optionHolding, quizChoiceLabel, CANT_TELL } from "../../../src/quiz";
import { canonicalJson } from "../../../src/seal";
import { visibleText } from "../../../src/gate";
import { modelDisplay } from "../../../src/claimants";
import { CLOCK_ID, deviceId, type CallTest } from "./model";

export interface PlayStep {
  /** Virtual ms of the call. */
  at: number;
  device: string;
  line: string | null;
  call: number;
  /** "call 2: throws TimeoutError" (the scripted answer of this call, in the trace's own terms). */
  words: string;
}
export interface Script {
  /** Why nothing plays (the run may not be shown as fact), or null. */
  notShown: string | null;
  steps: PlayStep[];
  /** Per device, the final words ("3 calls"), only for stand-ins whose count the run measured. */
  totals: Record<string, string>;
  /** The dial's end in virtual ms, or null when the time is can't-check (the dial does not move). */
  dialEndMs: number | null;
  /** The function box's ending words, or null when the ending is can't-check. */
  ending: string | null;
}

const stepText = (s: StandInStep | undefined): string =>
  !s ? "throws AtlasStandInExhausted (no scripted answer left)" : s.do === "return" ? `returns ${short(canonicalJson(s.value))}${s.afterMs ? ` after ${s.afterMs.toLocaleString("en-US")} ms` : ""}` : s.do === "throw" ? `throws ${visibleText(s.errorName)}` : "never answers";
const short = (s: string) => {
  const v = visibleText(s);
  return v.length > 32 ? `${v.slice(0, 31)}…` : v;
};

export function playScript(run: Run, test: CallTest, tested: string | null): Script {
  const tl = timelineModel(run);
  const empty: Script = { notShown: tl.notShown, steps: [], totals: {}, dialEndMs: null, ending: null };
  if (tl.notShown !== null) return empty;
  const measured = run.result.measured;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(measured, k);
  const steps: PlayStep[] = [];
  const totals: Record<string, string> = {};
  for (const lane of tl.lanes) {
    if (!has(`calls:${lane.name}`)) continue; // can't check: this device animates nothing
    const spec = test.args.find((a) => a.kind === "stand-in" && a.name === lane.name);
    const scripted = spec && spec.kind === "stand-in" ? spec : null;
    const id = deviceId(lane.name);
    for (const c of lane.calls) {
      const step = scripted ? (c.n <= scripted.calls.length ? scripted.calls[c.n - 1] : scripted.then === "repeat_last" ? scripted.calls[scripted.calls.length - 1] : undefined) : undefined;
      const said = c.answer === "no_answer_seen" ? "no answer before Atlas stopped watching" : stepText(step);
      steps.push({ at: c.t, device: id, line: tested ? `${tested}=>${id}` : null, call: c.n, words: `call ${c.n}: ${said}` });
    }
    const n = Number(measured[`calls:${lane.name}`]);
    totals[id] = `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`;
  }
  steps.sort((a, b) => a.at - b.at || a.call - b.call);
  const dialEndMs = has("virtualMs") && typeof measured.virtualMs === "number" ? measured.virtualMs : null;
  const ending = has("outcome") ? tl.readout : null;
  return { notShown: null, steps, totals, dialEndMs, ending };
}

export type MarkOutcome = Verdict["outcome"];
export interface MarkPick {
  who: string;
  name: string;
  pick: string;
  outcome: MarkOutcome;
  reason?: string;
}
export interface Mark {
  measures: string;
  /** The box the mark sits on. */
  anchor: string;
  question: string;
  /** What the run measured, as the option that holds it (or the reason it can't be checked). */
  measured: string;
  picks: MarkPick[];
}

const SHORT_Q: Record<string, string> = { outcome: "How it ends", returnedJson: "What it returns", virtualMs: "How long it takes" };

export function anchorOf(measures: string, tested: string | null): string {
  if (measures.startsWith("calls:")) return deviceId(measures.slice(6));
  if (measures === "virtualMs") return CLOCK_ID;
  return tested ?? CLOCK_ID;
}

/** One mark per quiz question: the measured option, and each bettor's pick and verdict (plain code's). */
export function marksOf(questions: readonly Question[], bets: readonly Bet[], verdicts: readonly Verdict[], run: Run, tested: string | null): Mark[] {
  return questions.map((q) => {
    const observed = Object.prototype.hasOwnProperty.call(run.result.measured, q.measures) ? run.result.measured[q.measures]! : undefined;
    const why = run.result.notMeasured[q.measures] ?? run.result.notMeasured.wholeRun;
    const holder = observed !== undefined && run.controlPassed === true && q.quiz ? optionHolding(q.quiz, q.unit, observed) : null;
    const measured = run.controlPassed !== true ? "can't check: the run is not trusted" : observed === undefined ? `can't check: ${why ?? "not measured"}` : holder ? holder.label : String(observed);
    const picks = bets
      .filter((b) => b.measures === q.measures)
      .map((b) => {
        const v = verdicts.find((x) => x.betId === b.id);
        const pick = b.answer.kind === "quiz" ? quizChoiceLabel(b.answer.options, b.answer.choice) : b.answer.kind === "declined" ? CANT_TELL : "an answer";
        return { who: b.who, name: b.who === "human" ? "You" : modelDisplay(b.who.slice(6)), pick, outcome: v?.outcome ?? "cant_check", ...(v?.reason ? { reason: v.reason } : {}) };
      })
      .sort((a, b) => (a.who === "human" ? -1 : b.who === "human" ? 1 : a.who < b.who ? -1 : 1));
    const short = q.measures.startsWith("calls:") ? `Calls to ${q.measures.slice(6)}` : (SHORT_Q[q.measures] ?? q.measures);
    return { measures: q.measures, anchor: anchorOf(q.measures, tested), question: short, measured, picks };
  });
}

export const OUTCOME_WORDS: Record<MarkOutcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };
