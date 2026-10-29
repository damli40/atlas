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
import { notShownAsFact } from "../../../src/trust";
import { optionHolding, quizChoiceLabel, CANT_TELL } from "../../../src/quiz";
import { canonicalJson } from "../../../src/seal";
import { visibleText } from "../../../src/gate";
import { modelDisplay } from "../../../src/claimants";
import { CLOCK_ID, deviceId, type CallTest } from "./model";
import { networkStepFor, networkStepWords } from "../../../src/network-fake";
import { watchLimitOf } from "../../../src/judge";

export interface PlayStep {
  /** Virtual ms of the step. */
  at: number;
  /** "call": a stand-in or the network fake was called; "wait": the clock jumped (a wait ended); "end": the call ended. */
  kind: "call" | "wait" | "end";
  /** The device whose lamp lights (a call), or null. */
  device: string | null;
  line: string | null;
  /** Code boxes lit during this step (a wait lights the parts that wait; the end lights the function). */
  parts: string[];
  call: number;
  /** "call 2: throws TimeoutError", "waits until 400 ms", "throws TypeError: bad" (the words on the chip). */
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
  /** U2: true when the dial's end is the watch limit (the call was still running there), not a settle time. */
  atLimit?: boolean;
}

const stepText = (s: StandInStep | undefined): string =>
  !s ? "throws AtlasStandInExhausted (no scripted answer left)" : s.do === "return" ? `returns ${short(canonicalJson(s.value))}${s.afterMs ? ` after ${s.afterMs.toLocaleString("en-US")} ms` : ""}` : s.do === "throw" ? `throws ${visibleText(s.errorName)}` : "never answers";
const short = (s: string) => {
  const v = visibleText(s);
  return v.length > 32 ? `${v.slice(0, 31)}…` : v;
};

/** U2: the thrown value in plain words: "TypeError: bad key", "undefined", "a string". Null when the run did not say. */
export function thrownWords(run: Pick<Run, "result">): string | null {
  const m = run.result.measured;
  const name = typeof m.thrownName === "string" ? m.thrownName : null;
  const msg = typeof m.thrownMessage === "string" ? m.thrownMessage : null;
  if (name) return short(`${name}${msg ? `: ${msg}` : ""}`).replace(/…$/, "…");
  const type = typeof m.thrownType === "string" ? m.thrownType : null;
  if (type === null) return null;
  if (type === "undefined" || type === "null") return `${type} (not an Error)`;
  return `a ${type} (not an Error)`;
}

/** The most steps one replay shows; past it, waits are thinned (every call is kept). */
export const MAX_PLAY_STEPS = 40;

/**
 * The run as steps on the drawing. `waitParts`: code boxes that contain a wait (plain code's reading of the file); they
 * light when the clock jumps. Every step comes from the run's own trace; the test gives only the words of a scripted
 * answer.
 */
export function playScript(run: Run, test: CallTest, tested: string | null, waitParts: readonly string[] = []): Script {
  const tl = timelineModel(run);
  const empty: Script = { notShown: tl.notShown, steps: [], totals: {}, dialEndMs: null, ending: null };
  if (tl.notShown !== null) return empty;
  const measured = run.result.measured;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(measured, k);
  const calls: PlayStep[] = [];
  const totals: Record<string, string> = {};
  for (const lane of tl.lanes) {
    if (!has(`calls:${lane.name}`)) continue; // can't check: this device animates nothing
    const spec = test.args.find((a) => a.kind === "stand-in" && a.name === lane.name);
    const scripted = spec && spec.kind === "stand-in" ? spec : null;
    const net = test.network && test.network.replaces === lane.name ? test.network : null;
    const id = deviceId(lane.name);
    for (const c of lane.calls) {
      let said: string;
      if (c.answer === "no_answer_seen") said = "no answer before Atlas stopped watching";
      else if (net) {
        const step = networkStepFor(net, c.n);
        said = step ? networkStepWords(step, canonicalJson) : "throws AtlasStandInExhausted (no scripted answer left)";
        if (step?.do === "never_answer" && c.answer === "threw") said = `never answers; the code gave up${c.errorName ? ` (${c.errorName})` : ""}`;
      } else {
        const step = scripted ? (c.n <= scripted.calls.length ? scripted.calls[c.n - 1] : scripted.then === "repeat_last" ? scripted.calls[scripted.calls.length - 1] : undefined) : undefined;
        said = stepText(step);
      }
      calls.push({ at: c.t, kind: "call", device: id, line: tested ? `${tested}=>${id}` : null, parts: tested ? [tested] : [], call: c.n, words: `${lane.name} call ${c.n}: ${short(said).length < said.length ? said.slice(0, 60) : said}` });
    }
    const n = Number(measured[`calls:${lane.name}`]);
    totals[id] = `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`;
  }
  // U2: the waits, from the run's own record of where its clock jumped ("clock_moves"; display only, never judged).
  const ev = (run.trace ?? []).find((e) => e.event === "clock_moves");
  const at = ev?.data && Array.isArray((ev.data as { at?: unknown }).at) ? ((ev.data as { at: unknown[] }).at.filter((x): x is number => typeof x === "number" && Number.isFinite(x))) : [];
  const callTimes = new Set(calls.map((c) => c.at));
  let waits: PlayStep[] = at.filter((t) => !callTimes.has(t)).map((t) => ({ at: t, kind: "wait" as const, device: null, line: null, parts: waitParts.length ? [...waitParts] : tested ? [tested] : [], call: 0, words: `waits until ${t.toLocaleString("en-US")} ms` }));
  const room = Math.max(0, MAX_PLAY_STEPS - calls.length);
  if (waits.length > room) {
    const k = Math.ceil(waits.length / Math.max(1, room));
    waits = waits.filter((_, i) => i % k === k - 1 || i === waits.length - 1).slice(-Math.max(1, room));
  }
  const steps = [...calls, ...waits].sort((a, b) => a.at - b.at || (a.kind === b.kind ? a.call - b.call : a.kind === "wait" ? -1 : 1));
  const outcome = has("outcome") ? measured.outcome : null;
  const atLimit = outcome === "still_running_at_watch_limit" && tl.end?.kind === "still_running";
  const dialEndMs = has("virtualMs") && typeof measured.virtualMs === "number" ? measured.virtualMs : atLimit && tl.end && "t" in tl.end ? tl.end.t : null;
  let ending = has("outcome") ? tl.readout : null;
  if (ending && outcome === "threw") {
    const w = thrownWords(run);
    if (w) ending = `threw ${w} at ${(measured.virtualMs as number).toLocaleString("en-US")} ms`;
  }
  if (ending !== null) steps.push({ at: dialEndMs ?? steps[steps.length - 1]?.at ?? 0, kind: "end", device: null, line: null, parts: tested ? [tested] : [], call: 0, words: ending });
  return { notShown: null, steps, totals, dialEndMs, ending, ...(atLimit ? { atLimit: true } : {}) };
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
  // Review M3: a run that may not be shown as fact states no value on any mark.
  const notShown = notShownAsFact(run);
  return questions.map((q) => {
    const observed = Object.prototype.hasOwnProperty.call(run.result.measured, q.measures) ? run.result.measured[q.measures]! : undefined;
    const why = run.result.notMeasured[q.measures] ?? run.result.notMeasured.wholeRun;
    const holder = observed !== undefined && run.controlPassed === true && q.quiz ? optionHolding(q.quiz, q.unit, observed) : null;
    let measured = notShown !== null ? `can't check: ${notShown}` : run.controlPassed !== true ? "can't check: the run is not trusted" : observed === undefined ? `can't check: ${why ?? "not measured"}` : holder ? holder.label : String(observed);
    // U2: the thrown value, plainly ("throws undefined (not an Error)", "throws TypeError: bad key").
    if (notShown === null && q.measures === "outcome" && observed === "threw") {
      const w = thrownWords(run);
      if (w) measured = `throws ${w}`;
    }
    // U2: a call still running at the watch limit took longer than the limit.
    if (notShown === null && q.measures === "virtualMs" && observed === undefined && run.result.measured.outcome === "still_running_at_watch_limit") {
      const w = watchLimitOf(run);
      if (w !== null) measured = `more than ${w.toLocaleString("en-US")} ms (still running when Atlas stopped watching)`;
    }
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
