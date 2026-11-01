// The one moment everything serves (D60): what you bet and what the run did, side by side. Plain code picks which question
// leads: the first you did not match, else the first you matched, else the run's ending alone. Never scripted, and the same
// words on the verdict screen, the proof card and the film's frame. Pure.

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

const ms = (n: number) => `${Math.round(n).toLocaleString("en-US")} ms`;
const clip = (s: string, n: number) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);
const times = (n: number) => (n === 1 ? "once" : `${n.toLocaleString("en-US")} times`);

/** How the run ended, from measured facts. Null when nothing about its ending was measured. */
export function runEnding(run: Pick<Run, "result" | "trace">): string | null {
  const m = run.result.measured as Record<string, unknown>;
  const outcome = m.outcome;
  const counts = Object.entries(m).filter(([k, v]) => k.startsWith("calls:") && typeof v === "number" && v > 0) as [string, number][];
  const total = counts.reduce((sum, [, v]) => sum + v, 0);
  const after = total === 0 ? "" : counts.length === 1 ? `, after ${total === 1 ? "1 call" : `${total.toLocaleString("en-US")} calls`} to ${clip(counts[0]![0].slice(6), 24)}` : `, after ${total.toLocaleString("en-US")} calls`;
  const seq = run.trace?.some((e) => e.event === "call_start" && (e.data as { n?: number } | undefined)?.n === 2);
  const at = typeof m.virtualMs === "number" ? (seq ? ` ${ms(m.virtualMs)} into its last call` : ` at ${ms(m.virtualMs)}`) : "";
  if (outcome === "returned") return `returned ${typeof m.returnedJson === "string" ? clip(m.returnedJson, 60) : "a value"}${at}${after}`;
  if (outcome === "threw") {
    const name = typeof m.thrownName === "string" ? m.thrownName : "an error";
    const message = typeof m.thrownMessage === "string" && m.thrownMessage !== "" ? `: ${clip(m.thrownMessage, 60)}` : "";
    return `threw ${clip(name, 30)}${message}${at}${after}`;
  }
  if (outcome === "never_settled") return `never finished: nothing was left to wake it${after}`;
  if (outcome === "still_running_at_watch_limit") return `still running when Atlas stopped watching${after}`;
  return null;
}

const rank = (who: string) => (who === "human" ? 0 : /open/i.test(who) ? 2 : /spark/i.test(who) ? 1 : 3);

/** What the run did about this question: its own fact, and how it ended when that is a different fact. */
function runFact(mark: MomentMark, run: Pick<Run, "result" | "trace">): string {
  const m = run.result.measured as Record<string, unknown>;
  const ending = runEnding(run);
  if (mark.measures.startsWith("calls:") && typeof m[mark.measures] === "number") {
    const fact = `called ${clip(mark.measures.slice(6), 24)} ${times(m[mark.measures] as number)}`;
    const end = ending?.replace(/, after .*$/, "");
    return end ? `${fact}, then ${end}` : fact;
  }
  return ending ?? mark.measured;
}

/** Null when the run may not be shown as fact: then there is no moment, only the reason. */
export function momentOf(marks: readonly MomentMark[], run: Pick<Run, "result" | "trace" | "controlPassed">): Moment | null {
  if (notShownAsFact(run as Run) !== null) return null;
  const mine = (m: MomentMark) => m.picks.find((p) => p.who === "human");
  const lead = marks.find((m) => mine(m)?.outcome === "not_matched") ?? marks.find((m) => mine(m)?.outcome === "matched") ?? null;
  if (!lead) {
    const ending = runEnding(run);
    return ending === null ? null : { kind: "ending", measures: null, question: null, you: null, run: ending, bettors: [] };
  }
  const you = mine(lead)!;
  return {
    kind: you.outcome === "not_matched" ? "not_matched" : "matched",
    measures: lead.measures,
    question: lead.question,
    you: you.pick,
    run: runFact(lead, run),
    bettors: [...lead.picks].sort((a, b) => rank(a.who) - rank(b.who) || (a.who < b.who ? -1 : 1)).map(({ who, name, pick, outcome }) => ({ who, name, pick, outcome })),
  };
}
