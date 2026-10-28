// X3 (D27): a person's track record. Plain code only: no model reads or writes any of it.
//
// Plain words. Every round ends with the person's sealed bets and the judge's verdicts (src/judge.ts). This module
// turns those two things into a short record, grouped by what each question was about:
// - outcome: how the call ended (returned, threw, never settled ...);
// - returned value: the value the function returned, as JSON;
// - timing: how long it took on Atlas's clock (virtualMs, totalWaitMs, the settle time);
// - call counts: how many times a stand-in (or the fake RPC) was called;
// - Moonwell price: the oracle price on the Moonwell fork.
// For each group it counts "matched", "didn't match" and "can't check", always with n (how many bets). It never
// gives a percentage on its own: a percentage appears only when n is at least 5, and then next to n.
//
// What it leaves out, and says so: bets sealed with `repeat: true` (E3 review r2 M2: the round repeated a test the
// person had already seen run, so they may have known the answer). Their number is shown ("2 left out").
//
// What it never holds: code, question text, answer values, or anything about other people. An entry is the bet's
// id and seal hash, the run id, the question group, the verdict's outcome, whether it was a repeat, and for numbers
// whether the guess was lower or higher than what the run measured.
//
// Wording rule (D27, "never framed as teaching"): the record says where guesses matched what the code did. It
// never says learn, teach, score, skill, right or wrong (a test reads every sentence here).

import type { Bet, Outcome, Run, Verdict } from "./types";
import { verifySeal } from "./seal";
import { SETTLE_FIELD } from "./units";

export const QUESTION_TYPES = ["outcome", "returned value", "timing", "call counts", "Moonwell price"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The question group of a measured field, or null for a field no group covers (not counted). */
export function questionTypeOf(measures: string): QuestionType | null {
  if (measures === "outcome") return "outcome";
  if (measures === "returnedJson") return "returned value";
  if (measures === "virtualMs" || measures === "totalWaitMs" || measures === SETTLE_FIELD) return "timing";
  if (measures === "calls" || measures.startsWith("calls:")) return "call counts";
  if (measures.startsWith("priceUsd1e18:")) return "Moonwell price";
  return null;
}

/** One of the person's bets, judged. No code, no question text, no answer value. */
export interface TrackEntry {
  runId: string;
  betId: string;
  sealedHash: string;
  type: QuestionType;
  outcome: Outcome;
  /** Sealed with `repeat: true`: left out of the counts (and counted as left out). */
  repeat: boolean;
  /** Numbers only, when it didn't match: the guess was lower ("under") or higher ("over") than what the run measured. */
  side?: "under" | "over";
  /** When the run finished (server clock). */
  at: string;
}

const numberOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The person's entries from one finished round: their bets (who "human") whose seal still verifies, each with the
 * verdict the judge gave it on this run. A bet with no verdict, or a group no question type covers, is not kept.
 */
export function entriesFromRound(bets: readonly Bet[], verdicts: readonly Verdict[], run: Pick<Run, "id" | "finishedAt">): TrackEntry[] {
  const out: TrackEntry[] = [];
  for (const b of bets) {
    if (b.who !== "human") continue;
    const type = questionTypeOf(b.measures);
    if (type === null) continue;
    if (!verifySeal(b)) continue;
    const v = verdicts.find((x) => x.betId === b.id && x.runId === run.id);
    if (!v) continue;
    let side: TrackEntry["side"];
    if (v.outcome === "not_matched" && (type === "timing" || type === "call counts") && (b.answer.kind === "integer" || b.answer.kind === "number")) {
      const seen = numberOf(v.observed);
      if (seen !== undefined && b.answer.value !== seen) side = b.answer.value < seen ? "under" : "over";
    }
    out.push({ runId: run.id, betId: b.id, sealedHash: b.sealedHash, type, outcome: v.outcome, repeat: b.repeat === true, ...(side ? { side } : {}), at: run.finishedAt });
  }
  return out;
}

export interface TypeLine {
  type: QuestionType;
  /** Bets counted (repeats left out). */
  n: number;
  matched: number;
  notMatched: number;
  cantCheck: number;
  /** Of the ones that didn't match: guesses lower / higher than the run. */
  under: number;
  over: number;
}

export interface TrackRecord {
  /** One line per question group that has at least one counted bet, in QUESTION_TYPES order. */
  lines: TypeLine[];
  /** Bets counted in all. */
  counted: number;
  /** Bets left out because they were sealed as repeats. */
  excludedRepeats: number;
  /** Distinct runs the counted bets come from. */
  rounds: number;
}

export function trackRecordOf(entries: readonly TrackEntry[]): TrackRecord {
  const lines = new Map<QuestionType, TypeLine>();
  let excludedRepeats = 0;
  const runs = new Set<string>();
  for (const e of entries) {
    if (e.repeat) {
      excludedRepeats++;
      continue;
    }
    runs.add(e.runId);
    let l = lines.get(e.type);
    if (!l) {
      l = { type: e.type, n: 0, matched: 0, notMatched: 0, cantCheck: 0, under: 0, over: 0 };
      lines.set(e.type, l);
    }
    l.n++;
    if (e.outcome === "matched") l.matched++;
    else if (e.outcome === "not_matched") {
      l.notMatched++;
      if (e.side === "under") l.under++;
      if (e.side === "over") l.over++;
    } else l.cantCheck++;
  }
  const ordered = QUESTION_TYPES.map((t) => lines.get(t)).filter((l): l is TypeLine => l !== undefined);
  return { lines: ordered, counted: ordered.reduce((n, l) => n + l.n, 0), excludedRepeats, rounds: runs.size };
}

/** The record from the entries that came before the first entry of `runId` (null when that run is not in them). */
export function recordBefore(entries: readonly TrackEntry[], runId: string): TrackRecord | null {
  const i = entries.findIndex((e) => e.runId === runId);
  return i < 0 ? null : trackRecordOf(entries.slice(0, i));
}

/** The smallest n at which a percentage is shown at all (and then always next to n). */
export const PERCENT_MIN_N = 5;

const times = (k: number) => (k === 1 ? "1 time" : `${k} times`);

/**
 * One group as words, e.g. "Timing: matched 2 of 7 · didn't match 4 · can't check 1 (n = 7). Of the 4 that didn't
 * match, your guess was lower than the run 3 times and higher 1 time." A percentage only when n ≥ 5, next to n.
 */
export function typeLineWords(l: TypeLine): string {
  const name = l.type === "Moonwell price" ? "Moonwell price" : `${l.type[0]!.toUpperCase()}${l.type.slice(1)}`;
  const pct = l.n >= PERCENT_MIN_N ? ` (${Math.round((l.matched / l.n) * 100)}% of n = ${l.n})` : ` (n = ${l.n})`;
  const parts = [`matched ${l.matched} of ${l.n}`, `didn't match ${l.notMatched}`, `can't check ${l.cantCheck}`];
  let s = `${name}: ${parts.join(" · ")}${pct}.`;
  if (l.under + l.over > 0) {
    const bits = [l.under > 0 ? `lower than the run ${times(l.under)}` : "", l.over > 0 ? `higher ${times(l.over)}` : ""].filter(Boolean);
    s += ` Of the ${l.notMatched} that didn't match, your guess was ${bits.join(" and ")}.`;
  }
  return s;
}

export const TRACK_WORDS = {
  heading: "Your track record",
  subheading: "Where your guesses matched what the code did",
  how: "Counted by plain code from your sealed bets and the judge's verdicts (src/judge.ts). No model reads or writes it.",
  empty: "No judged bets yet. After your first run, this shows where your guesses matched what the code did, by kind of question.",
  repeats: (k: number) => `${k === 1 ? "1 bet" : `${k} bets`} left out: ${k === 1 ? "it was" : "they were"} on a test you had already seen run (sealed as a repeat).`,
  counted: (n: number, rounds: number) => `${n === 1 ? "1 bet" : `${n} bets`} from ${rounds === 1 ? "1 round" : `${rounds} rounds`}.`,
  whoLocal: "Kept for this browser on this server (no invite code).",
  whoInvite: "Kept for your invite code on this server.",
  beforeHeading: "Your record before this round",
  beforeNone: "This was your first judged round on this server.",
  wonderNote: "When you ask Muse Wonder for tests, it is told only the kinds of question where your bets most often didn't match, with their counts: no code, nothing about anyone else. The betting models are not told any of this.",
} as const;

/** Every sentence a record can show (for the wording test). */
export function recordWords(r: TrackRecord): string[] {
  return [...r.lines.map(typeLineWords), TRACK_WORDS.counted(r.counted, r.rounds), ...(r.excludedRepeats > 0 ? [TRACK_WORDS.repeats(r.excludedRepeats)] : [])];
}

/** The groups where the person's bets most often didn't match: at least one "didn't match", most first, at most 3. */
export function weakSpots(r: TrackRecord): TypeLine[] {
  return r.lines
    .filter((l) => l.notMatched > 0)
    .sort((a, b) => b.notMatched / b.n - a.notMatched / a.n || b.notMatched - a.notMatched || QUESTION_TYPES.indexOf(a.type) - QUESTION_TYPES.indexOf(b.type))
    .slice(0, 3);
}

/**
 * The text Muse Wonder gets with a proposal request: question groups and counts only (no code, no question text, no
 * other person's data). Null when there is nothing to say, so the prompt is then exactly what it was before X3.
 */
export function weakSpotSummary(r: TrackRecord): string | null {
  const w = weakSpots(r);
  if (w.length === 0) return null;
  const items = w.map((l) => {
    let s = `${l.type} (${l.notMatched} of ${l.n} didn't match`;
    if (l.under + l.over > 0) s += `; guessed lower than the run ${l.under}, higher ${l.over}`;
    return `${s})`;
  });
  return `In this person's earlier rounds, their sealed bets most often did not match what the code did on these kinds of question: ${items.join("; ")}. Counted by plain code from their own bets; it says nothing about this code. Where it fits this function, prefer tests whose answers turn on those questions.`;
}
