// R9: a short plain-English summary of a drawn file, written by a Meta model from the code alone: what the file is for, what goes in and
// comes out, and one short line per drawn part. AI proposes, plain code decides: this file is the check. It reuses natural names' banned
// words (src/natural-names.ts), so a summary can't call the code safe, correct or broken, and can't say how a run will go. Pure.
//
// Plain words on what is refused:
// - A line that is too long, holds a digit or a sign that isn't ordinary punctuation, or uses a banned word is dropped.
// - A part line for a part plain code didn't draw is dropped.
// - Without a usable "what it is for" line there is no summary at all: the page then shows nothing (never a stand-in text).
// Digits are refused on purpose: the bets ask about counts and times, and a number in the summary could state one, right or not.

import { judged } from "./natural-names";

/** Hard caps, enforced here. The prompt asks for less (about 60 words overall, 12 per part), so a near miss still fits. */
export const SUMMARY_LINE_MAX_WORDS = 35;
export const SUMMARY_LINE_MAX_CHARS = 220;
/** "What it is for" and "what goes in and comes out" together. */
export const SUMMARY_MAX_WORDS = 60;
export const SUMMARY_PART_MAX_WORDS = 15;
export const SUMMARY_PART_MAX_CHARS = 110;

/**
 * Phrases a summary may not hold besides the names' banned words: claims Atlas never makes on screen (the Moonwell wording rules), and the
 * name of the AI tool in the Moonwell story. Matched as whole words, in small letters.
 */
export const SUMMARY_BANNED_PHRASES = ["off by", "caught before shipping", "ai caused", "hangs forever", "re proven", "research shows", "first", "claude"] as const; // wording-lint: allow (refused, never shown)

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
  const banned = words.find(judged);
  if (banned) return { ok: false, reason: `uses "${banned}", a word that judges the code or says how it behaves` };
  return { ok: true, text };
}

export interface FileSummary {
  /** What the file is for. */
  purpose: string;
  /** What goes in and what comes out; null when refused or not given. */
  io: string | null;
  /** One line per drawn part, keyed by the part's exact name. Only parts plain code drew. */
  parts: Record<string, string>;
}

const wordCount = (s: string) => s.split(" ").length;

/**
 * The model's answer, checked: {"purpose": "...", "io": "...", "parts": {"<part>": "..."}}. Every refused line is dropped and counted. With
 * no usable purpose line the whole summary is refused (summary: null).
 */
export function checkSummary(answer: unknown, parts: readonly string[]): { summary: FileSummary | null; refused: number; reason?: string } {
  const a = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, unknown>) : {};
  let refused = 0;
  const line = { words: SUMMARY_LINE_MAX_WORDS, chars: SUMMARY_LINE_MAX_CHARS };
  const purpose = checkSummaryLine(a.purpose, line);
  if (!purpose.ok) return { summary: null, refused: 1, reason: a.purpose === undefined ? "the answer had no summary" : "plain code refused the summary" };
  let io: string | null = null;
  if (a.io !== undefined && a.io !== null) {
    const c = checkSummaryLine(a.io, line);
    if (c.ok && wordCount(purpose.text) + wordCount(c.text) <= SUMMARY_MAX_WORDS) io = c.text;
    else refused++;
  }
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
  return { summary: { purpose: purpose.text, io, parts: out }, refused };
}

/** Who wrote the summary, as the screen and the bettors are told. */
export const SUMMARY_WORDS = {
  legend: "Summary: Muse Wonder's words (Meta's AI), not a check",
  io: "In and out:",
  partsFold: (n: number) => `What each part does, in its words (${n})`,
  panel: (line: string) => `Meta's AI says this part: ${line} (its words, not a check)`,
} as const;

/** D19: the lines every AI bettor gets when the summary was sent to the person's page, labelled as the model's words. */
export function summaryForBettors(s: FileSummary, model: string): string[] {
  return [
    `A summary ${model} (Meta's AI) wrote from the code alone. The person's page shows the same words. Its words, not a check:`,
    `- What the file is for: ${s.purpose}`,
    ...(s.io ? [`- In and out: ${s.io}`] : []),
    ...Object.entries(s.parts).map(([part, text]) => `- ${part}: ${text}`),
  ];
}
