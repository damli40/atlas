// D66, D27: the remember loop, in plain code and counts. What this person bet last time and what the run did; their weakest kind of question;
// and how that count moved. Pure. It reads only their own record, which holds no code and no answer values. "Last time" shows after one answer: it is one true
// fact, not a pattern. The weakest kind and the count stay quiet under REMEMBER_MIN answers, because a few answers are not a pattern. Nothing here goes to a model, onto a proof card or to anyone but the person whose record it is.

import type { QuestionType, TrackEntry, TrackRecord, TypeLine } from "./track-record";

export const REMEMBER_MIN = 3;

/** How a call ended, as a word the record can keep: never a value. */
export const ENDINGS = ["returned", "threw", "never finished", "still running"] as const;
export type Ending = (typeof ENDINGS)[number];

const KIND_WORDS: Record<QuestionType, string> = {
  outcome: "how it ends",
  "returned value": "what it returns",
  timing: "how long it takes",
  "call counts": "how many calls it makes",
  "Moonwell price": "the Moonwell price",
};
const SAID_WORDS: Record<Ending, string> = { returned: "returns a value", threw: "throws", "never finished": "never finishes", "still running": "still running when Atlas stops watching" };
const ENDED_WORDS: Record<Ending, string> = { returned: "It returned.", threw: "It threw.", "never finished": "It never finished.", "still running": "It was still running when Atlas stopped watching." };

/** An answer plain code can compare with a run: "can't check" counts for neither side. */
const asked = (l: TypeLine) => l.matched + l.notMatched;

export interface Weakest {
  type: QuestionType;
  words: string;
  matched: number;
  of: number;
}

/** The kind of question where this person's answers matched least, once it has at least REMEMBER_MIN answers and at least one miss. */
export function weakestKind(r: TrackRecord): Weakest | null {
  const line = r.lines
    .filter((l) => asked(l) >= REMEMBER_MIN && l.notMatched > 0)
    .sort((a, b) => a.matched / asked(a) - b.matched / asked(b) || b.notMatched - a.notMatched)[0];
  return line ? { type: line.type, words: KIND_WORDS[line.type], matched: line.matched, of: asked(line) } : null;
}

export const weakestWords = (w: Weakest) => `Your weakest so far: ${w.words}, ${w.matched} of ${w.of}.`;

export interface LastRound {
  said: Ending;
  ended: Ending;
  /** The same function as this hash names: then the words can use its name. */
  sameFunction: boolean;
}

/** The last round where this person bet on how the call would end and the run shows how it did. A repeat doesn't count. */
export function lastRoundOf(entries: readonly TrackEntry[], fnHash: string | null): LastRound | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.repeat || !e.said || !e.ended) continue;
    return { said: e.said, ended: e.ended, sameFunction: fnHash !== null && e.fn === fnHash };
  }
  return null;
}

export const lastRoundWords = (l: LastRound, name: string | null) => `Last time${l.sameFunction && name ? ` on ${name}` : ""}: you bet ${SAID_WORDS[l.said]}. ${ENDED_WORDS[l.ended]}`;

export interface CountChange {
  words: string;
  from: string;
  to: string;
}

/**
 * The count that moved this round, shown once at the verdict. The kind that was weakest before this round if it moved, else the kind this
 * round's lead question was about, else nothing. Null under REMEMBER_MIN earlier answers, or when nothing new was counted (a repeat).
 */
export function countChange(before: TrackRecord, after: TrackRecord, lead: QuestionType | null): CountChange | null {
  const line = (r: TrackRecord, t: QuestionType) => r.lines.find((l) => l.type === t);
  const moved = (t: QuestionType | null | undefined): CountChange | null => {
    if (!t) return null;
    const a = line(before, t);
    const b = line(after, t);
    if (!a || !b || asked(a) < REMEMBER_MIN || asked(b) <= asked(a)) return null;
    return { words: KIND_WORDS[t], from: `${a.matched} of ${asked(a)}`, to: `${b.matched} of ${asked(b)}` };
  };
  return moved(weakestKind(before)?.type) ?? moved(lead);
}

/** Every sentence this module can say, for the word test. */
export const rememberWords = (): string[] => [
  ...ENDINGS.flatMap((s) => ENDINGS.map((e) => lastRoundWords({ said: s, ended: e, sameFunction: true }, "f"))),
  ...(Object.keys(KIND_WORDS) as QuestionType[]).map((t) => weakestWords({ type: t, words: KIND_WORDS[t], matched: 2, of: 7 })),
];
