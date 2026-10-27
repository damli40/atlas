// X1: does a model's quote match the file's bytes? The same rule as the Investigator's finding check
// (server/meta/roles/investigator.ts normaliseQuote / matchesWholeLines / MIN_QUOTE_WORD_CHARS), copied here so the
// proof-file check in src/ does not load the server's model client. tests/unit/outline-verify.test.ts checks the
// two copies agree on the same inputs.
//
// Plain words: whitespace runs count as one space (indentation and line breaks do not matter), Atlas's own
// "12| " line-number prefixes are removed when EVERY quoted line has one, and the quote must be whole consecutive
// lines of the span (not a fragment from the middle of a line). A quote with fewer than 12 letters or digits pins
// nothing (a run of "}" appears everywhere) and never matches.

import { lineSpan } from "../words";

export const MIN_QUOTE_WORD_CHARS = 12;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function normaliseQuote(q: string): string {
  const lines = q.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const prefixed = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\d+\| ?/.test(l));
  return squash(prefixed ? lines.map((l) => l.replace(/^\s*\d+\| ?/, "")).join("\n") : q);
}

export function matchesWholeLines(quote: string, lines: readonly string[]): boolean {
  const sq = lines.map(squash);
  for (let i = 0; i < sq.length; i++) {
    if (sq[i] === "" || !quote.startsWith(sq[i]!)) continue;
    let acc = "";
    for (let j = i; j < sq.length; j++) {
      if (sq[j] === "") continue;
      acc = acc ? `${acc} ${sq[j]}` : sq[j]!;
      if (acc === quote) return true;
      if (!quote.startsWith(acc)) break;
    }
  }
  return false;
}

/** Why `quote` is not whole lines lineStart..lineEnd of `text` (null when it is). Lines are 1-based, inclusive. */
export function quoteProblem(text: string, lineCount: number, lineStart: number, lineEnd: number, quote: string): string | null {
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 1 || lineEnd < lineStart || lineEnd > lineCount) {
    return `${lineSpan(lineStart, lineEnd)} ${lineStart === lineEnd ? "is" : "are"} not inside 1–${lineCount}`;
  }
  const q = normaliseQuote(quote);
  const wordChars = (q.match(/[\p{L}\p{N}_]/gu) ?? []).length;
  if (wordChars < MIN_QUOTE_WORD_CHARS) return `the quoted snippet has ${wordChars} letters or digits; at least ${MIN_QUOTE_WORD_CHARS} are needed to pin a place`;
  if (!matchesWholeLines(q, text.split("\n").slice(lineStart - 1, lineEnd))) return `the quoted snippet is not whole lines of ${lineStart}–${lineEnd}`;
  return null;
}
