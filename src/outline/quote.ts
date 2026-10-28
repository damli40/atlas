// X1: does a model's quote match the file's bytes?
//
// Plain words: whitespace runs count as one space (indentation and line breaks do not matter), Atlas's own "12| "
// line-number prefixes are removed when EVERY quoted line has one, and the quote must be whole consecutive lines
// (never a fragment from the middle of a line). A quote with fewer than 12 letters or digits pins nothing (a run
// of "}" appears everywhere) and never matches.
//
// Review B3: every check here takes time in proportion to the text it reads (the span plus the quote), never
// (lines × quote²) as the first version did. The span's lines are squashed once and joined with one space; then
// - `anchoredProblem` (the outline's rule, review M4) asks: does the quote start at the span's FIRST non-blank
//   line and end exactly at the end of a line? One prefix comparison.
// - `matchesWholeLines` (the Investigator's rule: the quote may start at any line) compares a rolling hash of the
//   quote with the hash of the joined text at every line start where a line would end the quote, and confirms a
//   hash match with one direct comparison. At most MAX_HASH_CONFIRMS direct comparisons, then it says no.

import { lineSpan } from "../words";

export const MIN_QUOTE_WORD_CHARS = 12;
/** Review B3: the longest quote Atlas compares (characters). The outline schema caps quotes lower. */
export const MAX_QUOTE_CHARS = 8000;
const MAX_HASH_CONFIRMS = 64;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function normaliseQuote(q: string): string {
  const lines = q.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  const prefixed = nonEmpty.length > 0 && nonEmpty.every((l) => /^\s*\d+\| ?/.test(l));
  return squash(prefixed ? lines.map((l) => l.replace(/^\s*\d+\| ?/, "")).join("\n") : q);
}

/** The span's non-blank lines squashed and joined with " ", with where each line starts and ends in the joined text. */
function joinLines(lines: readonly string[]): { joined: string; starts: number[]; ends: Set<number> } {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends = new Set<number>();
  let at = 0;
  for (const l of lines) {
    const sq = squash(l);
    if (sq === "") continue;
    if (parts.length) at += 1;
    starts.push(at);
    parts.push(sq);
    at += sq.length;
    ends.add(at);
  }
  return { joined: parts.join(" "), starts, ends };
}

const M1 = 67_108_859; // primes below 2^26: products stay below 2^53, so plain numbers are exact
const M2 = 67_108_837;
const B = 131;

/**
 * True when the (normalised) quote is exactly a run of consecutive whole lines of `lines`, starting at any line.
 * Same answers as the first version (tests/unit/outline-verify.test.ts compares them), in linear time.
 */
export function matchesWholeLines(quote: string, lines: readonly string[]): boolean {
  if (quote === "" || quote.length > MAX_QUOTE_CHARS) return false;
  const { joined, starts, ends } = joinLines(lines);
  const n = joined.length;
  const m = quote.length;
  if (m > n) return false;
  const h1 = new Float64Array(n + 1);
  const h2 = new Float64Array(n + 1);
  const p1 = new Float64Array(n + 1);
  const p2 = new Float64Array(n + 1);
  p1[0] = 1;
  p2[0] = 1;
  for (let i = 0; i < n; i++) {
    const c = joined.charCodeAt(i);
    h1[i + 1] = (h1[i]! * B + c) % M1;
    h2[i + 1] = (h2[i]! * B + c) % M2;
    p1[i + 1] = (p1[i]! * B) % M1;
    p2[i + 1] = (p2[i]! * B) % M2;
  }
  let q1 = 0;
  let q2 = 0;
  for (let i = 0; i < m; i++) {
    q1 = (q1 * B + quote.charCodeAt(i)) % M1;
    q2 = (q2 * B + quote.charCodeAt(i)) % M2;
  }
  const sub = (h: Float64Array, p: Float64Array, mod: number, a: number, b: number) => (((h[b]! - ((h[a]! * p[b - a]!) % mod)) % mod) + mod) % mod;
  let confirms = 0;
  for (const s of starts) {
    const e = s + m;
    if (e > n || !ends.has(e)) continue;
    if (sub(h1, p1, M1, s, e) !== q1 || sub(h2, p2, M2, s, e) !== q2) continue;
    if (joined.startsWith(quote, s)) return true;
    if (++confirms >= MAX_HASH_CONFIRMS) return false;
  }
  return false;
}

/** Fewer than MIN_QUOTE_WORD_CHARS letters or digits: the reason; else null. */
function tooShort(q: string): string | null {
  const wordChars = (q.match(/[\p{L}\p{N}_]/gu) ?? []).length;
  return wordChars < MIN_QUOTE_WORD_CHARS ? `the quoted snippet has ${wordChars} letters or digits; at least ${MIN_QUOTE_WORD_CHARS} are needed to pin a place` : null;
}

const outside = (a: number, b: number, n: number) => `${lineSpan(a, b)} ${a === b ? "is" : "are"} not inside 1–${n}`;
const validRange = (a: number, b: number, n: number) => Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= n;

/**
 * Review M4: why `quote` is not whole lines of lineStart..lineEnd STARTING AT the range's first non-blank line
 * (null when it is). `fileLines` is the file split on "\n". Time: one pass over the span and the quote.
 */
export function anchoredProblem(fileLines: readonly string[], lineCount: number, lineStart: number, lineEnd: number, quote: string): string | null {
  if (!validRange(lineStart, lineEnd, lineCount)) return outside(lineStart, lineEnd, lineCount);
  if (quote.length > MAX_QUOTE_CHARS) return `the quoted snippet is longer than ${MAX_QUOTE_CHARS} characters`;
  const q = normaliseQuote(quote);
  const short = tooShort(q);
  if (short) return short;
  const { joined, ends } = joinLines(fileLines.slice(lineStart - 1, lineEnd));
  if (!(joined.startsWith(q) && ends.has(q.length))) return `the quoted snippet is not whole lines starting at the first line of ${lineStart}–${lineEnd}`;
  return null;
}

/** The Investigator's rule: why `quote` is not whole lines anywhere in lineStart..lineEnd (null when it is). */
export function quoteProblem(fileLines: readonly string[], lineCount: number, lineStart: number, lineEnd: number, quote: string): string | null {
  if (!validRange(lineStart, lineEnd, lineCount)) return outside(lineStart, lineEnd, lineCount);
  const q = normaliseQuote(quote);
  const short = tooShort(q);
  if (short) return short;
  if (!matchesWholeLines(q, fileLines.slice(lineStart - 1, lineEnd))) return `the quoted snippet is not whole lines of ${lineStart}–${lineEnd}`;
  return null;
}
