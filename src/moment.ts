// The one moment everything serves (D60): what you bet and what the run did, side by side. Plain code picks which question
// leads (D64: a miss on how it ended first, never a count or a time), else the run's ending alone. Never scripted, and the same
// words on the verdict screen, the proof card and the film's frame. Pure.

import { visibleText } from "./gate";
import { literalOfJsonText, type CodeLanguage } from "./literal";
import type { Run } from "./types";
import { notShownAsFact } from "./trust";

export interface MomentMark {
  measures: string;
  question: string;
  measured: string;
  picks: readonly { who: string; name: string; pick: string; outcome: "matched" | "not_matched" | "cant_check"; reason?: string }[];
}

export interface Moment {
  /** "not_matched" and "matched" lead with your bet. "ending" has no bet to set beside the run. */
  kind: "not_matched" | "matched" | "ending";
  /** The question that leads; the drawing's ring or tick goes with this one bet. */
  measures: string | null;
  question: string | null;
  /** What you bet, in the option's own words. */
  you: string | null;
  /** What the run did, from measured facts only. */
  run: string;
  /** The same question for every bettor, in a fixed order: you, Muse Spark, Muse Spark Open, any other. */
  bettors: { who: string; name: string; pick: string; outcome: "matched" | "not_matched" | "cant_check" }[];
}

const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);
const ms = (n: number) => `${Math.round(n).toLocaleString("en-US")} ms`;
const times = (n: number) => (n === 1 ? "once" : `${n.toLocaleString("en-US")} times`);

/**
 * What was thrown, in plain words: "TypeError: bad key", or "a string (not an Error)". Null when nothing was measured. Hidden
 * characters are shown as escapes, so a value cannot read as something it is not.
 */
export function thrownWords(run: Pick<Run, "result">, max = 140): string | null {
  const m = run.result.measured as Record<string, unknown>;
  const name = typeof m.thrownName === "string" ? m.thrownName : null;
  const msg = typeof m.thrownMessage === "string" ? m.thrownMessage : null;
  if (name) return clip(visibleText(`${name}${msg ? `: ${msg}` : ""}`), max);
  const type = typeof m.thrownType === "string" ? m.thrownType : null;
  if (type === null) return null;
  if (type === "undefined" || type === "null") return `${type} (not an Error)`;
  return `a ${visibleText(type)} (not an Error)`;
}

/** The run's ending, kept as separate facts, so nothing is ever cut out of finished words. */
export interface EndingFacts {
  /** "returned 5", "threw TypeError: x". */
  what: string;
  /** " at 1,400 ms". */
  at: string;
  /** ", after 4 calls to fetch". Empty when any count was not measured: a partial count must not read as the whole. */
  after: string;
}

export function endingFacts(run: Pick<Run, "result" | "trace">, language?: CodeLanguage): EndingFacts | null {
  const m = run.result.measured as Record<string, unknown>;
  const notMeasured = (run.result.notMeasured ?? {}) as Record<string, unknown>;
  const counts = Object.entries(m).filter(([k, v]) => k.startsWith("calls:") && typeof v === "number" && v > 0) as [string, number][];
  const total = counts.reduce((sum, [, v]) => sum + v, 0);
  const someUnknown = Object.keys(notMeasured).some((k) => k.startsWith("calls:"));
  const after = someUnknown || total === 0 ? "" : counts.length === 1 ? `, after ${total === 1 ? "1 call" : `${total.toLocaleString("en-US")} calls`} to ${clip(visibleText(counts[0]![0].slice(6)), 24)}` : `, after ${total.toLocaleString("en-US")} calls`;
  const seq = run.trace?.some((e) => e.event === "call_start" && (e.data as { n?: number } | undefined)?.n === 2);
  const at = typeof m.virtualMs === "number" && m.virtualMs > 0 ? (seq ? ` ${ms(m.virtualMs)} into its last call` : ` at ${ms(m.virtualMs)}`) : "";
  if (m.outcome === "returned") {
    if (typeof m.returnedJson === "string") return { what: `returned ${clip(visibleText(literalOfJsonText(m.returnedJson, language)), 120)}`, at, after };
    const type = typeof m.returnedType === "string" ? m.returnedType : null;
    if (type === "undefined") return { what: "returned nothing", at, after };
    if (type === null) return { what: "returned a value", at, after };
    if (/^(NaN|Infinity|-Infinity|-0)$/.test(type)) return { what: `returned ${type}`, at, after };
    return { what: `returned ${/^[aeiou]/.test(type) ? "an" : "a"} ${clip(visibleText(type), 60)}`, at, after };
  }
  if (m.outcome === "threw") {
    const words = thrownWords(run, 120);
    return { what: words ? `threw ${words}` : "threw", at, after };
  }
  if (m.outcome === "never_settled") return { what: "never finished: nothing was left to wake it", at: "", after };
  if (m.outcome === "still_running_at_watch_limit") return { what: "still running when Atlas stopped watching", at: "", after };
  return null;
}

/** How the run ended, from measured facts. Null when nothing about its ending was measured. */
export function runEnding(run: Pick<Run, "result" | "trace">, language?: CodeLanguage): string | null {
  const e = endingFacts(run, language);
  return e ? `${e.what}${e.at}${e.after}` : null;
}

const rank = (who: string) => (who === "human" ? 0 : /open/i.test(who) ? 2 : /spark/i.test(who) ? 1 : 3);

/** One fixed order for bettors, everywhere: you, Muse Spark, Muse Spark Open, any other. */
export const bettorOrder = (a: { who: string }, b: { who: string }) => rank(a.who) - rank(b.who) || (a.who < b.who ? -1 : 1);

/** What the run did about this question: its own fact, and how it ended when that is a different fact. */
function runFact(mark: MomentMark, run: Pick<Run, "result" | "trace">, language?: CodeLanguage): string {
  const m = run.result.measured as Record<string, unknown>;
  const e = endingFacts(run, language);
  if (mark.measures.startsWith("calls:") && typeof m[mark.measures] === "number") {
    const fact = `called ${clip(visibleText(mark.measures.slice(6)), 24)} ${times(m[mark.measures] as number)}`;
    return e ? `${fact}, then ${e.what}${e.at}` : fact;
  }
  return e ? `${e.what}${e.at}${e.after}` : mark.measured;
}

const isEnding = (measures: string) => measures === "outcome";
const isCount = (measures: string) => measures === "calls" || measures.startsWith("calls:");
const isTime = (measures: string) => measures === "virtualMs" || measures === "totalWaitMs";

/**
 * D64: which question leads. A missed ending, then a missed value, then a matched value, then a matched ending. Never a count or a
 * time: "sharpest first" (D63) put a blue "matched" over "then threw Error". Null: this answer cannot lead.
 */
function leadRank(measures: string, outcome: "matched" | "not_matched"): number | null {
  if (isEnding(measures)) return outcome === "not_matched" ? 0 : 3;
  if (isCount(measures) || isTime(measures)) return null;
  return outcome === "not_matched" ? 1 : 2;
}

/** Null when the run may not be shown as fact: then there is no moment, only the reason. */
export function momentOf(marks: readonly MomentMark[], run: Pick<Run, "result" | "trace" | "controlPassed">, language?: CodeLanguage): Moment | null {
  if (notShownAsFact(run as Run) !== null) return null;
  const answered = marks
    .map((mark, i) => ({ mark, i, you: mark.picks.find((p) => p.who === "human") }))
    .filter((x): x is { mark: MomentMark; i: number; you: MomentMark["picks"][number] & { outcome: "matched" | "not_matched" } } => x.you !== undefined && (x.you.outcome === "matched" || x.you.outcome === "not_matched"));
  const ranked = answered.flatMap((x) => {
    const r = leadRank(x.mark.measures, x.you.outcome);
    return r === null ? [] : [{ ...x, r }];
  });
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  const ending = runEnding(run, language);
  // Only when the run has no ending to show and nothing else was answered can a count or a time stand in: there is no other fact.
  const lead = ranked[0] ?? (ending === null ? answered[0] : undefined);
  if (!lead) return ending === null ? null : { kind: "ending", measures: null, question: null, you: null, run: ending, bettors: [] };
  return {
    kind: lead.you.outcome === "not_matched" ? "not_matched" : "matched",
    measures: lead.mark.measures,
    question: lead.mark.question,
    you: lead.you.pick,
    run: runFact(lead.mark, run, language),
    bettors: [...lead.mark.picks].sort(bettorOrder).map(({ who, name, pick, outcome }) => ({ who, name, pick, outcome })),
  };
}

/**
 * D64: a claim test proves nothing about a sentence if it never reached what the sentence is about. Plain code compares this run with
 * the last one, and counts the calls to the fakes. Null when neither holds. The words only say what was measured.
 */
export function reachNote(run: Pick<Run, "result" | "trace">, last: string | null, language?: CodeLanguage): string | null {
  const m = run.result.measured as Record<string, unknown>;
  const notMeasured = (run.result.notMeasured ?? {}) as Record<string, unknown>;
  const fakes = Object.entries(m).filter(([k, v]) => k.startsWith("calls:") && typeof v === "number") as [string, number][];
  const countsKnown = !Object.keys(notMeasured).some((k) => k.startsWith("calls:"));
  const none = countsKnown && fakes.length > 0 && fakes.every(([, v]) => v === 0);
  const what = endingFacts(run, language)?.what ?? null;
  const same = last !== null && what === last;
  if (!none && !same) return null;
  const calls = fakes.map(([k]) => clip(visibleText(k.slice(6)), 24)).join(" or ");
  const head = same && none ? `This test ended the same way as the last one and made 0 calls to ${calls}.` : same ? "This test ended the same way as the last one." : `This test made 0 calls to ${calls}.`;
  return `${head} It may not reach what the sentence is about.`;
}

/**
 * The same moment from a proof file's rows or a chain round: one row per bet, with what the bettor said and what the run measured.
 * Rows are grouped by question in the order they come.
 */
export function momentOfRows(rows: readonly { who: string; name: string; measures: string; question: string; said: string; observed: string; outcome: "matched" | "not_matched" | "cant_check" | null }[], run: Pick<Run, "result" | "trace" | "controlPassed">, language?: CodeLanguage): Moment | null {
  const marks = new Map<string, MomentMark>();
  for (const r of rows) {
    const m = marks.get(r.measures) ?? { measures: r.measures, question: r.question, measured: r.observed, picks: [] };
    (m.picks as MomentMark["picks"][number][]).push({ who: r.who, name: r.name, pick: r.said, outcome: r.outcome ?? "cant_check" });
    if (r.who === "human") m.measured = r.observed;
    marks.set(r.measures, m);
  }
  return momentOf([...marks.values()], run, language);
}
