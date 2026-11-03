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

import type { Bet, Confidence, ExperimentShape, Outcome, Run, Verdict } from "./types";
import { CONFIDENCE_LEVELS, failurePathOf, type FailurePath } from "./felt";
import { FELT_WORDS } from "./paste-words";
import { sha256Hex, verifySeal } from "./seal";
import { SETTLE_FIELD } from "./units";
import type { Ending } from "./remember";

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
  /** X4 (D56): what the person said when they sealed this round, read from the sealed bet. Absent when they said nothing. */
  confidence?: Confidence;
  /** X4 (D56): whether the test scripted a failure (src/felt.ts). Absent on a chain run and on entries from before X4. */
  path?: FailurePath;
  /** D66, on a bet about how the call ends: which ending the person chose and which the run shows. Words from a fixed list, never a value. */
  said?: Ending;
  ended?: Ending;
  /** D66: a hash of the function's name, so "last time on this function" can be told without keeping the name. */
  fn?: string;
  /** Which code and which test, as a hash: the same pair again is a repeat, in any session. */
  round?: string;
}

/** Which ending an answer chose: a tap's own option, or the old screens' word. Null for anything else. */
function endingSaid(a: Bet["answer"]): Ending | null {
  const word = a.kind === "quiz" ? a.options.find((o) => o.id === a.choice)?.match : a.kind === "enum" ? { kind: "word" as const, value: (a as { value?: unknown }).value } : null;
  if (!word || word.kind !== "word") return null;
  return endingOfWord(word.value);
}
const endingOfWord = (w: unknown): Ending | null => (w === "returned" || w === "returns" ? "returned" : w === "threw" || w === "throws" ? "threw" : w === "never_settled" || w === "pending" ? "never finished" : w === "still_running_at_watch_limit" ? "still running" : null);

const numberOf = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Which function, in which code: a hash, so another file's `f` isn't this `f`. */
export const functionKey = (name: string, codeSha: string) => sha256Hex(`fn:${name}:${codeSha}`).slice(0, 16);
const canonicalJsonOf = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * The person's entries from one finished round: their bets (who "human") whose seal still verifies, each with the
 * verdict the judge gave it on this run. A bet with no verdict, or a group no question type covers, is not kept.
 */
export function entriesFromRound(bets: readonly Bet[], verdicts: readonly Verdict[], run: Pick<Run, "id" | "finishedAt"> & Partial<Pick<Run, "result">>, params?: ExperimentShape, codeSha?: string): TrackEntry[] {
  const out: TrackEntry[] = [];
  const path = failurePathOf(params);
  const fn = params?.shape === "call-function" && codeSha ? functionKey(params.exportName, codeSha) : undefined;
  // Holds no code: a fingerprint of which code and which test, to count them once.
  const round = codeSha && params ? sha256Hex(`round:${codeSha}:${canonicalJsonOf(params)}`).slice(0, 16) : undefined;
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
    out.push({ runId: run.id, betId: b.id, sealedHash: b.sealedHash, type, outcome: v.outcome, repeat: b.repeat === true, ...(round ? { round } : {}), ...(side ? { side } : {}), at: run.finishedAt, ...(b.confidence ? { confidence: b.confidence } : {}), ...(path ? { path } : {}), ...memoryOf(b, type, v, run, fn) });
  }
  return out;
}

/** D66: only on the bet about how it ended, and only when the verdict could compare it with the run. */
function memoryOf(b: Bet, type: QuestionType, v: Verdict, run: Partial<Pick<Run, "result">>, fn: string | undefined): Pick<TrackEntry, "said" | "ended" | "fn"> {
  if (type !== "outcome" || v.outcome === "cant_check") return fn ? { fn } : {};
  const said = endingSaid(b.answer);
  const ended = endingOfWord((run.result?.measured as { outcome?: unknown } | undefined)?.outcome);
  return { ...(said && ended ? { said, ended } : {}), ...(fn ? { fn } : {}) };
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
  /** X4 (D56): by how sure the person said they were, and by whether the test scripted a failure. */
  felt: FeltCounts;
}

/** Answers at one "how sure" level. `n` is what plain code could compare with a run (matched + didn't match). */
export interface LevelLine {
  level: Confidence;
  /** Distinct rounds at this level. */
  rounds: number;
  n: number;
  matched: number;
  cantCheck: number;
}
/** Answers on one side of "nothing failed" / "something failed". */
export interface PathLine {
  n: number;
  matched: number;
  cantCheck: number;
}
export interface FeltCounts {
  /** All three levels, always in the same order. */
  levels: LevelLine[];
  nothingFailed: PathLine;
  somethingFailed: PathLine;
  /** Counted answers with no tag: from a chain run, or from before X4. */
  untagged: number;
}

function feltCounts(counted: readonly TrackEntry[]): FeltCounts {
  const side = (path: FailurePath): PathLine => {
    const es = counted.filter((e) => e.path === path);
    const matched = es.filter((e) => e.outcome === "matched").length;
    const cantCheck = es.filter((e) => e.outcome === "cant_check").length;
    return { n: es.length - cantCheck, matched, cantCheck };
  };
  return {
    levels: CONFIDENCE_LEVELS.map((level) => {
      const es = counted.filter((e) => e.confidence === level);
      const cantCheck = es.filter((e) => e.outcome === "cant_check").length;
      return { level, rounds: new Set(es.map((e) => e.runId)).size, n: es.length - cantCheck, matched: es.filter((e) => e.outcome === "matched").length, cantCheck };
    }),
    nothingFailed: side("nothing failed"),
    somethingFailed: side("something failed"),
    untagged: counted.filter((e) => e.path === undefined).length,
  };
}

/** D56: at a "how sure" level, no percentage under this many rounds. */
export const LEVEL_PERCENT_MIN_ROUNDS = 10;
/** The "nothing failed / something failed" line stays hidden until each side has this many answers. */
export const PATH_MIN_ANSWERS = 3;

/** One level as a sentence. A percentage only at LEVEL_PERCENT_MIN_ROUNDS rounds or more. */
export function levelWords(l: LevelLine): string {
  if (l.rounds === 0) return FELT_WORDS.levelNone(l.level);
  if (l.n === 0) return FELT_WORDS.levelUnchecked(l.level, l.rounds);
  return FELT_WORDS.levelMatched(l.level, l.rounds, l.matched, l.n, l.rounds >= LEVEL_PERCENT_MIN_ROUNDS ? Math.round((l.matched / l.n) * 100) : null);
}

/** The sentences of the "how sure" part: one per level, or one saying none was given. */
export function levelsWords(f: FeltCounts): string[] {
  return f.levels.every((l) => l.rounds === 0) ? [FELT_WORDS.levelsEmpty] : f.levels.map(levelWords);
}

/** The comparison line, or the note saying why it is still hidden, then what may be missing from it. */
export function pathWords(f: FeltCounts): { line: string | null; notes: string[] } {
  const { nothingFailed: a, somethingFailed: b, untagged } = f;
  const ready = a.n >= PATH_MIN_ANSWERS && b.n >= PATH_MIN_ANSWERS;
  const cant = a.cantCheck + b.cantCheck;
  return {
    line: ready ? FELT_WORDS.paths(a.matched, a.n, b.matched, b.n) : null,
    notes: [...(ready ? [] : [FELT_WORDS.pathsWait(PATH_MIN_ANSWERS, a.n, b.n)]), ...(ready && cant > 0 ? [FELT_WORDS.pathsCantCheck(cant)] : []), ...(untagged > 0 ? [FELT_WORDS.pathsUntagged(untagged)] : [])],
  };
}

export function trackRecordOf(entries: readonly TrackEntry[]): TrackRecord {
  const lines = new Map<QuestionType, TypeLine>();
  let excludedRepeats = 0;
  const runs = new Set<string>();
  const counted: TrackEntry[] = [];
  for (const e of entries) {
    if (e.repeat) {
      excludedRepeats++;
      continue;
    }
    counted.push(e);
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
  return { lines: ordered, counted: ordered.reduce((n, l) => n + l.n, 0), excludedRepeats, rounds: runs.size, felt: feltCounts(counted) };
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
  // R16 (review M4): plain code writes it; Muse Wonder is told only the kinds you miss most, with counts (REMEMBER_WORDS.how).
  how: "Counted and written by plain code from your sealed bets and the judge's verdicts (src/judge.ts); no model writes it. Muse Wonder is told only the kinds of question you miss most, with their counts.",
  empty: "No judged bets yet. After your first run, this shows where your guesses matched what the code did, by kind of question.",
  repeats: (k: number) => `${k === 1 ? "1 bet" : `${k} bets`} left out: ${k === 1 ? "it was" : "they were"} on a test you had already seen run (sealed as a repeat).`,
  counted: (n: number, rounds: number) => `${n === 1 ? "1 bet" : `${n} bets`} from ${rounds === 1 ? "1 round" : `${rounds} rounds`}.`,
  whoLocal: "Kept for this browser on this server (no invite code).",
  // R16 (review B2): one code may be shared, so each browser on it keeps its own record.
  whoInvite: "Kept for your invite code in this browser, on this server.",
  // R16: past the code's cap of browsers with a record of their own (DAMI: placeholder wording).
  whoShared: "This code is used in many browsers, so this browser's record is shared with the code's other late browsers, on this server.",
  beforeHeading: "Your record before this round",
  beforeNone: "This was your first judged round on this server.",
  wonderNote: "When you ask Muse Wonder for tests, it is told only the kinds of question where your bets most often didn't match, with their counts: no code, nothing about anyone else. The betting models are not told any of this.",
} as const;

/** Every sentence a record can show (for the wording test). */
export function recordWords(r: TrackRecord): string[] {
  const p = pathWords(r.felt);
  return [...r.lines.map(typeLineWords), TRACK_WORDS.counted(r.counted, r.rounds), ...(r.excludedRepeats > 0 ? [TRACK_WORDS.repeats(r.excludedRepeats)] : []), ...levelsWords(r.felt), ...(p.line ? [p.line] : []), ...p.notes];
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
  return `In this person's earlier rounds, their sealed bets most often did not match what the code did on these kinds of question: ${items.join("; ")}. Counted by plain code from their own bets; it says nothing about this code. Use this only to choose between tests that show the flaw equally well; it never changes which flaw you test.`;
}
