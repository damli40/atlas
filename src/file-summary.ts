// R9: a short plain-English summary of a drawn file, written by a Meta model from the code alone: what the file is for, and one short
// line per drawn part saying its role. AI proposes, plain code decides: this file is the check. It reuses natural names' banned words
// (src/natural-names.ts), so a summary can't call the code safe, correct or broken. Pure.
//
// Plain words on what is refused:
// - A line that is too long, holds a digit or a sign that isn't ordinary punctuation, or uses a banned word is dropped.
// - Review M1 (coordinator's decision): the summary must not answer the bet. So there is no "in and out" sentence, and a line is refused
//   when it says how a call ends or what it gives back ("returns nothing", "gives up", "rejects", "times out", "stops after") or holds a
//   number, as digits or as words ("three", "half", "twice", "a second"): the bets ask about endings, counts and times.
// - A part line for a part plain code didn't draw is dropped.
// - Without a usable "what it is for" line there is no summary at all: the page then shows one muted line saying so, never a stand-in text.
import { judged } from "./natural-names";

/** Hard caps, enforced here. The prompt asks for less (about 25 words, 12 per part), so a near miss still fits. */
export const SUMMARY_LINE_MAX_WORDS = 35;
export const SUMMARY_LINE_MAX_CHARS = 220;
export const SUMMARY_PART_MAX_WORDS = 15;
export const SUMMARY_PART_MAX_CHARS = 110;

/**
 * Phrases a summary may not hold besides the names' banned words: claims Atlas never makes on screen (the Moonwell wording rules), the
 * name of the AI tool in the Moonwell story, and (review M1) phrases that say how a call ends. Matched as whole words, in small letters.
 */
export const SUMMARY_BANNED_PHRASES = [
  "off by", "caught before shipping", "ai caused", "hangs forever", "re proven", "research shows", "first", "claude", // wording-lint: allow (refused, never shown)
  "gives up", "give up", "giving up", "gave up", "given up", "stops after", "stop after", "stopped after", "times out", "time out", "timed out", "runs out", "run out", "ran out",
  "gives back", "give back", "comes back", "come back", "ends with", "ends up", "end up", "no value", "nothing back",
] as const;

/**
 * Review M1: whole words about how a call ends or what it gives back, and numbers written as words (with ordinals and time units). The
 * bets ask about exactly these, so a summary may not say them.
 */
export const SUMMARY_OUTCOME_WORDS = [
  "nothing", "undefined", "null", "none", "nil", "empty", "void", "nan",
  "return", "returns", "returned", "returning", "raise", "raises", "raised", "raising", "reject", "rejects", "rejected", "rejecting", "rejection",
  "result", "results", "outcome", "outcomes", "finish", "finishes", "finished", "finishing", "timeout", "timeouts", "exhausted", "exhausts",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred",
  "hundreds", "thousand", "thousands", "million", "millions", "half", "halves", "quarter", "quarters", "twice", "thrice", "once", "dozen",
  "dozens", "single", "double", "triple", "second", "seconds", "third", "fourth", "fifth", "tenth", "millisecond", "milliseconds", "ms",
  "minute", "minutes", "hour", "hours",
] as const;
/** The names' list refuses words beginning "fail". In a part's role line, "after each failure" says when it acts, not how a run ends. */
const ROLE_WORDS: ReadonlySet<string> = new Set(["failure", "failures"]);

/** One line, cleaned to single spaces, or the reason it is refused. */
export function checkSummaryLine(raw: unknown, caps: { words: number; chars: number }): { ok: true; text: string } | { ok: false; reason: string } {
  if (typeof raw !== "string") return { ok: false, reason: "not text" };
  // Curly apostrophes read as straight ones; nothing else is changed.
  const text = raw.trim().replace(/\s+/g, " ").replace(/[‘’]/g, "'");
  if (text === "") return { ok: false, reason: "empty" };
  if (text.length > caps.chars) return { ok: false, reason: `longer than ${caps.chars} characters` };
  if (/[0-9]/.test(text)) return { ok: false, reason: "has a digit" };
  if (!/^[A-Za-z ,.;:'()-]+$/.test(text)) return { ok: false, reason: "only letters, spaces and plain punctuation are allowed" };
  if (/[A-Za-z]\(/.test(text)) return { ok: false, reason: "reads as code (a name right before a bracket)" };
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w !== "");
  if (words.length === 0) return { ok: false, reason: "no words" };
  if (text.split(" ").length > caps.words) return { ok: false, reason: `more than ${caps.words} words` };
  const flat = ` ${words.join(" ")} `;
  const phrase = SUMMARY_BANNED_PHRASES.find((p) => flat.includes(` ${p} `));
  if (phrase) return { ok: false, reason: `says "${phrase}"` };
  const outcome = words.find((w) => (SUMMARY_OUTCOME_WORDS as readonly string[]).includes(w));
  if (outcome) return { ok: false, reason: `uses "${outcome}", a word about how a call ends or a number` };
  const banned = words.find((w) => !ROLE_WORDS.has(w) && judged(w));
  if (banned) return { ok: false, reason: `uses "${banned}", a word that judges the code or says how it behaves` };
  return { ok: true, text };
}

export interface FileSummary {
  /** What the file is for. */
  purpose: string;
  /** One line per drawn part, keyed by the part's exact name. Only parts plain code drew. */
  parts: Record<string, string>;
}

/**
 * The model's answer, checked: {"purpose": "...", "parts": {"<part>": "..."}}. Every refused line is dropped and counted; any other field
 * (an "in and out" sentence included) is ignored. With no usable purpose line the whole summary is refused (summary: null).
 */
export function checkSummary(answer: unknown, parts: readonly string[]): { summary: FileSummary | null; refused: number; reason?: string } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  let refused = 0;
  const purpose = checkSummaryLine(a.purpose, { words: SUMMARY_LINE_MAX_WORDS, chars: SUMMARY_LINE_MAX_CHARS });
  if (!purpose.ok) return { summary: null, refused: 1, reason: a.purpose === undefined ? "the answer had no summary" : "plain code refused the summary" };
  const got = a.parts && typeof a.parts === "object" && !Array.isArray(a.parts) ? (a.parts as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const part of parts) {
    if (!Object.prototype.hasOwnProperty.call(got, part)) continue;
    const c = checkSummaryLine(got[part], { words: SUMMARY_PART_MAX_WORDS, chars: SUMMARY_PART_MAX_CHARS });
    if (c.ok) out[part] = c.text;
    else refused++;
  }
  // Lines for parts that were not drawn are refused too (counted, never kept).
  refused += Object.keys(got).filter((k) => !parts.includes(k)).length;
  return { summary: { purpose: purpose.text, parts: out }, refused };
}

/** Who wrote the summary, as the screen and the bettors are told. PLACEHOLDER wording for Dami (legend and none). */
export const SUMMARY_WORDS = {
  legend: "Summary: Muse Wonder's words (Meta's AI). Its reading can repeat the code's own comments; the run is the check",
  partsFold: (n: number) => `What each part does, in its words (${n})`,
  panel: (line: string) => `Meta's AI says this part: ${line} (its words, not a check)`,
  // R12 (D73): a limit (spend or calls) also leaves no summary; the line no longer blames the AI for it.
  none: "No summary this time: Meta's AI wasn't asked (a limit was reached), was slow, or its words didn't pass Atlas's checks.",
} as const;

/** D19: the lines every AI bettor gets when the summary was sent to the person's page, labelled as the model's words. */
export function summaryForBettors(s: FileSummary, model: string): string[] {
  return [
    `A summary ${model} (Meta's AI) wrote from the code alone. The person's page shows the same words. Its words, not a check:`,
    `- What the file is for: ${s.purpose}`,
    ...Object.entries(s.parts).map(([part, text]) => `- ${part}: ${text}`),
  ];
}
