// The one moment everything serves (D60): what you bet and what the run did, side by side. Plain code picks which question
// leads (D63: the sharpest you answered), else the run's ending alone. Never scripted, and the same
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

/**
 * D63: the sharpest question leads: the most specific one you answered. A value you typed, then what it returns, a count, a time,
 * and how it ends last. Among equals, one you did not match comes first. A bet can be right and still lead, so a right bet does not
 * headline "returns a value".
 */
function sharpness(mark: MomentMark, you: MomentMark["picks"][number]): number {
  if (/^typed /.test(you.pick)) return 0;
  if (mark.measures === "returnedJson") return 1;
  if (mark.measures.startsWith("calls")) return 2;
  if (mark.measures === "virtualMs") return 3;
  return 4;
}

/** Null when the run may not be shown as fact: then there is no moment, only the reason. */
export function momentOf(marks: readonly MomentMark[], run: Pick<Run, "result" | "trace" | "controlPassed">, language?: CodeLanguage): Moment | null {
  if (notShownAsFact(run as Run) !== null) return null;
  const answered = marks
    .map((mark, i) => ({ mark, i, you: mark.picks.find((p) => p.who === "human") }))
    .filter((x): x is { mark: MomentMark; i: number; you: MomentMark["picks"][number] } => x.you !== undefined && (x.you.outcome === "matched" || x.you.outcome === "not_matched"));
  answered.sort((a, b) => sharpness(a.mark, a.you) - sharpness(b.mark, b.you) || Number(a.you.outcome === "matched") - Number(b.you.outcome === "matched") || a.i - b.i);
  const lead = answered[0];
  if (!lead) {
    const ending = runEnding(run, language);
    return ending === null ? null : { kind: "ending", measures: null, question: null, you: null, run: ending, bettors: [] };
  }
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
