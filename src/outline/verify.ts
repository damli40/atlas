// X1: plain code decides which parts and joins of Muse Wonder's outline are real.
//
// Plain words:
// - `parseWonderOutline` reads the model's answer: at most MAX_ANSWER_CHARS characters, JSON nested at most
//   MAX_ANSWER_DEPTH levels, then a strict schema (unknown keys refused, every length capped, part ids unique).
//   A failure is a reason in words; the caller may ask the model once more, then stops.
// - `verifyOutline` checks the outline against the files and the code map:
//   - a part is CONFIRMED only when every range it names is a file of the codebase (exact path), the range sits on
//     whole definitions the code map knows (it starts at line 1 or a definition's first line, ends at a
//     definition's last line or the file's last line; over 400 lines it must be the whole file, labelled so), and
//     its quote is whole lines STARTING at the range's first non-blank line (review M4). Otherwise UNCONFIRMED, with
//     every reason. A path like "../../etc/passwd" is simply not a file of the codebase.
//   - a join is CONFIRMED only when both parts are confirmed and the code map holds an import or call that happens
//     on a line INSIDE the first part's ranges and reaches a definition INSIDE the second part's ranges (or a file
//     the second part holds whole) (review B1). "calls" needs a call; "imports" an import (a type-only import is
//     labelled so); "data" either, in either direction, never a type-only import. Otherwise MODEL-ONLY: "Wonder
//     says; the code doesn't show it", with the reason. Wonder's evidence "matches" only when it quotes, from its
//     first line, a line where such an import or call happens.
//   - edges between two confirmed parts, under the same rule, that Wonder did not join become CODE-ONLY joins.
//   - files no confirmed part covers are listed as "not in any part".
//   - every name, purpose, pattern and path is shown with hidden characters (line breaks, bidi controls) made
//     visible by src/gate.ts visibleText; names and purposes are labelled as the model's.
//   - review B3: the work is counted BEFORE it is done (characters read, edges times joins); past MAX_VERIFY_WORK
//     the whole outline is "can't check: the outline is too large to verify". A count, not a clock, so every
//     machine gives the same answer.
// Pure and deterministic; no I/O, no clock, no model. Never throws for any outline.

import { z } from "zod";
import { visibleText } from "../gate";
import { jsonDepth } from "../seal";
import { countLines } from "./codemap";
import { anchoredProblem } from "./quote";
import type { CodeEdge, CodeMap, CodeSymbol, JoinKind, OutlineFile, VerifiedJoin, VerifiedOutline, VerifiedPart, WonderOutline } from "./types";

export const MAX_ANSWER_CHARS = 400_000;
export const MAX_ANSWER_DEPTH = 12;
export const MAX_PARTS = 40;
export const MAX_SPANS_PER_PART = 30;
export const MAX_JOINS = 200;
export const MAX_PATTERNS = 12;
/** Review B3: caps on what one outline may ask plain code to compare. */
export const MAX_SPANS_TOTAL = 200;
export const MAX_SPAN_QUOTE_CHARS = 2000;
export const MAX_EVIDENCE_QUOTE_CHARS = 1000;
export const MAX_QUOTED_CHARS_TOTAL = 100_000;
/** Review M4: a range longer than this many lines must be the whole file. */
export const MAX_RANGE_LINES = 400;
/**
 * Review B3: the most work (characters read, plus edges times joins) one verification may take. Past it the whole
 * outline is "can't check: outline too large to verify". A count, not a clock, so every machine gives the same
 * answer for the same file (a time limit would make the proof-file check depend on the machine).
 */
export const MAX_VERIFY_WORK = 20_000_000;
export const TOO_LARGE_TO_VERIFY = "can't check: the outline is too large to verify";

/** Pattern labels Atlas lists (D28 common-failure groundwork). Anything else is kept as free text, marked not listed. */
export const KNOWN_PATTERNS = [
  "rpc-call",
  "retry",
  "concurrency",
  "queue",
  "db-write",
  "db-read",
  "cache",
  "timer",
  "file-io",
  "network",
  "auth",
  "parsing",
  "validation",
  "error-handling",
  "state",
  "events",
  "logging",
  "config",
  "cli",
  "ui",
] as const;

const PART_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const spanSchema = z.strictObject({
  path: z.string().min(1).max(300),
  lineStart: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  lineEnd: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  quotedSnippet: z.string().min(1).max(MAX_SPAN_QUOTE_CHARS),
});
export const wonderOutlineSchema = z
  .strictObject({
    parts: z
      .array(
        z.strictObject({
          id: z.string().regex(PART_ID, "a part id is 1–64 letters, digits, _ . or -"),
          name: z.string().trim().min(1).max(120),
          purpose: z.string().trim().min(1).max(600),
          files: z.array(spanSchema).min(1).max(MAX_SPANS_PER_PART),
          patterns: z.array(z.string().trim().min(1).max(60)).max(MAX_PATTERNS),
        }),
      )
      .min(1)
      .max(MAX_PARTS),
    joins: z
      .array(
        z.strictObject({
          from: z.string().regex(PART_ID, "a join names part ids (1–64 letters, digits, _ . or -)"),
          to: z.string().regex(PART_ID, "a join names part ids (1–64 letters, digits, _ . or -)"),
          kind: z.enum(["calls", "imports", "data"]),
          evidence: z.strictObject({ path: z.string().min(1).max(300), line: z.number().int().min(-1_000_000_000).max(1_000_000_000), quotedSnippet: z.string().min(1).max(MAX_EVIDENCE_QUOTE_CHARS) }),
        }),
      )
      .max(MAX_JOINS),
  })
  .superRefine((o, ctx) => {
    const ids = o.parts.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["parts"], message: "two parts share an id" });
    const spans = o.parts.reduce((n, p) => n + p.files.length, 0);
    if (spans > MAX_SPANS_TOTAL) ctx.addIssue({ code: "custom", path: ["parts"], message: `the outline names ${spans} line ranges; at most ${MAX_SPANS_TOTAL}` });
    const quoted = o.parts.reduce((n, p) => n + p.files.reduce((m, f) => m + f.quotedSnippet.length, 0), 0) + o.joins.reduce((n, j) => n + j.evidence.quotedSnippet.length, 0);
    if (quoted > MAX_QUOTED_CHARS_TOTAL) ctx.addIssue({ code: "custom", path: ["parts"], message: `the outline quotes ${quoted} characters; at most ${MAX_QUOTED_CHARS_TOTAL}` });
  });

/** A zod error as one plain sentence (at most three issues). */
const zodWords = (err: z.ZodError) =>
  err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "answer"}: ${i.message}`)
    .join("; ");

export type ParsedAnswer = { ok: true; outline: WonderOutline } | { ok: false; error: string };

/** Reads and schema-checks the model's answer. Never throws. */
export function parseWonderOutline(content: string): ParsedAnswer {
  try {
    if (typeof content !== "string") return { ok: false, error: "the answer is not text" };
    if (content.length > MAX_ANSWER_CHARS) return { ok: false, error: `the answer is ${content.length} characters; Atlas reads at most ${MAX_ANSWER_CHARS}` };
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      return { ok: false, error: "the answer is not valid JSON" };
    }
    return checkOutlineValue(json);
  } catch (e) {
    return { ok: false, error: `the answer could not be read (${e instanceof Error ? e.name : "error"})` };
  }
}

/** The schema check on an already-parsed value (used by the proof-file check too). Never throws. */
export function checkOutlineValue(json: unknown): ParsedAnswer {
  try {
    if (jsonDepth(json, MAX_ANSWER_DEPTH) > MAX_ANSWER_DEPTH) return { ok: false, error: `the answer nests deeper than ${MAX_ANSWER_DEPTH} levels` };
    const p = wonderOutlineSchema.safeParse(json);
    if (!p.success) return { ok: false, error: `the answer does not match the outline schema (${zodWords(p.error)})` };
    return { ok: true, outline: p.data as WonderOutline };
  } catch (e) {
    return { ok: false, error: `the answer could not be checked (${e instanceof Error ? e.name : "error"})` };
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const shown = (s: string) => visibleText(s.length > 80 ? `${s.slice(0, 79)}…` : s);
/** A line that holds no code: blank, a comment, or a decorator line. */
const notCode = (l: string) => {
  const t = l.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("#") || t.startsWith("@");
};

interface FileInfo {
  lines: string[];
  count: number;
  symbols: CodeSymbol[];
  /** Prefix sums of line lengths (for the work count). */
  chars: number[];
}

/**
 * Review M4: why a range does not sit on whole definitions (null when it does). It must start at line 1 or at the
 * first line of a definition the code map knows (only comments or blank lines may come between), and end at the
 * file's last line or at the last line of a definition (only comments or blank lines after it). A range over
 * MAX_RANGE_LINES lines must be the whole file.
 */
function boundaryProblem(f: FileInfo, a: number, b: number): string | null {
  if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= f.count)) return null; // anchoredProblem says why
  const whole = a === 1 && b === f.count;
  if (b - a + 1 > MAX_RANGE_LINES && !whole) return `a range over ${MAX_RANGE_LINES} lines must be the whole file (lines 1–${f.count})`;
  const gapOk = (from: number, to: number) => f.lines.slice(from - 1, to).every(notCode);
  const startOk = a === 1 || f.symbols.some((s) => s.lineStart >= a && s.lineStart <= b && gapOk(a, s.lineStart - 1));
  if (!startOk) return `line ${a} is not the start of a definition the code map knows (or line 1)`;
  const endOk = b === f.count || f.symbols.some((s) => s.lineEnd <= b && s.lineEnd >= a && gapOk(s.lineEnd + 1, b));
  if (!endOk) return `line ${b} is not the end of a definition the code map knows (or the file's last line)`;
  return null;
}

interface Region {
  path: string;
  lineStart: number;
  lineEnd: number;
  whole: boolean;
}

const inRegions = (rs: readonly Region[], path: string, line: number) => rs.some((r) => r.path === path && r.lineStart <= line && line <= r.lineEnd);
const holdsSymbol = (rs: readonly Region[], path: string, s: CodeSymbol) => rs.some((r) => r.path === path && r.lineStart <= s.lineStart && s.lineEnd <= r.lineEnd);
const holdsFile = (rs: readonly Region[], path: string) => rs.some((r) => r.path === path && r.whole);

/**
 * Review B1: does this edge show part A reaching part B? Only when a line where it happens lies inside A's ranges
 * (and not inside B's), and what it reaches lies inside B's ranges (and not inside A's): the definition it calls or
 * imports when plain code can name it, else B must hold the whole target file.
 */
function edgeShows(e: CodeEdge, a: readonly Region[], b: readonly Region[], symbol: (id: string) => CodeSymbol | undefined): boolean {
  if (!e.lines.some((l) => inRegions(a, e.from, l) && !inRegions(b, e.from, l))) return false;
  const targets = (e.toSymbol ? [e.toSymbol] : (e.toSymbols ?? [])).map(symbol).filter((x): x is CodeSymbol => x !== undefined);
  if (targets.some((t) => holdsSymbol(b, e.to, t) && !holdsSymbol(a, e.to, t))) return true;
  return holdsFile(b, e.to) && !holdsFile(a, e.to);
}

/** Does this code-map edge show a join of this kind (direction checked by the caller)? */
const edgeFits = (kind: JoinKind, e: CodeEdge) => (kind === "calls" ? e.kind === "calls" : kind === "imports" ? e.kind === "imports" : !e.typeOnly);

/** Plain code's verdict on Wonder's outline. Pure; never throws for any outline value that passed the schema. */
export function verifyOutline(files: ReadonlyArray<Pick<OutlineFile, "path" | "text">>, codeMap: CodeMap, outline: WonderOutline, model: string): VerifiedOutline {
  const symbolsOf = new Map(codeMap.files.map((f) => [f.path, f.symbols] as const));
  const info = new Map<string, FileInfo>();
  for (const f of files) {
    const lines = f.text.split("\n");
    const chars = [0];
    for (const l of lines) chars.push(chars[chars.length - 1]! + l.length + 1);
    info.set(f.path, { lines, count: countLines(f.text), symbols: symbolsOf.get(f.path) ?? [], chars });
  }
  const symbolById = new Map(codeMap.files.flatMap((f) => f.symbols.map((s) => [s.id, s] as const)));
  const symbol = (id: string) => symbolById.get(id);
  const by = `model:${model}` as const;

  // Review B3: the work this verification would take, counted before doing any of it.
  let work = 0;
  for (const p of outline.parts)
    for (const s of p.files) {
      const f = info.get(s.path);
      if (f && Number.isInteger(s.lineStart) && Number.isInteger(s.lineEnd)) work += f.chars[Math.min(f.lines.length, Math.max(0, s.lineEnd))]! - f.chars[Math.min(f.lines.length, Math.max(0, s.lineStart - 1))]!;
      work += s.quotedSnippet.length;
    }
  work += (outline.joins.length + outline.parts.length * outline.parts.length) * codeMap.edges.length * 4;
  const cantCheck = work > MAX_VERIFY_WORK ? TOO_LARGE_TO_VERIFY : undefined;

  const parts: VerifiedPart[] = outline.parts.map((p) => {
    const reasons: string[] = [];
    const spans = p.files.map((s) => {
      const f = info.get(s.path);
      const whole = f !== undefined && s.lineStart === 1 && s.lineEnd === f.count;
      const reason = cantCheck ?? (!f ? `${shown(s.path)} is not a file of this codebase` : (boundaryProblem(f, s.lineStart, s.lineEnd) ?? anchoredProblem(f.lines, f.count, s.lineStart, s.lineEnd, s.quotedSnippet)));
      if (reason && (reason !== cantCheck || reasons.length === 0)) reasons.push(f && reason !== cantCheck ? `${shown(s.path)}: ${reason}` : reason);
      return { path: visibleText(s.path), lineStart: s.lineStart, lineEnd: s.lineEnd, ok: reason === undefined || reason === null, ...(reason ? { reason } : {}), ...(whole && !reason ? { wholeFile: true as const } : {}) };
    });
    const confirmed = reasons.length === 0;
    const patterns = p.patterns.map((label) => ({ label: visibleText(label), known: (KNOWN_PATTERNS as readonly string[]).includes(label.trim().toLowerCase()) }));
    return {
      id: p.id,
      name: { text: visibleText(p.name), by },
      purpose: { text: visibleText(p.purpose), by },
      status: confirmed ? ("confirmed" as const) : ("unconfirmed" as const),
      reasons,
      spans,
      files: confirmed ? [...new Set(p.files.map((s) => s.path))].sort(cmp) : [],
      patterns,
    };
  });
  const partOf = new Map(parts.map((p) => [p.id, p] as const));
  const regionsOf = new Map(
    outline.parts.map((p) => {
      const v = partOf.get(p.id)!;
      return [p.id, v.status === "confirmed" ? p.files.map((s) => ({ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd, whole: s.lineStart === 1 && s.lineEnd === info.get(s.path)!.count })) : []] as const;
    }),
  );
  /** The edges that show a → b, both directions for "data". */
  const shownEdges = (kind: JoinKind, a: string, b: string) => {
    const ra = regionsOf.get(a)!;
    const rb = regionsOf.get(b)!;
    const forward = codeMap.edges.filter((e) => edgeFits(kind, e) && edgeShows(e, ra, rb, symbol));
    return kind === "data" ? [...forward, ...codeMap.edges.filter((e) => edgeFits(kind, e) && edgeShows(e, rb, ra, symbol))] : forward;
  };

  const joins: VerifiedJoin[] = outline.joins.map((j, index) => {
    const id = `wonder:${index}`;
    const ev = j.evidence;
    const base = { id, from: j.from, to: j.to, kind: j.kind };
    const modelOnly = (reason: string, matches = false): VerifiedJoin => ({ ...base, status: "model-only", codeEdges: [], reason, wonderEvidence: { path: visibleText(ev.path), line: ev.line, matches } });
    if (cantCheck) return modelOnly(cantCheck);
    const a = partOf.get(j.from);
    const b = partOf.get(j.to);
    if (j.from === j.to) return modelOnly("a join must link two different parts");
    if (!a) return modelOnly(`part ${shown(j.from)} is not in Wonder's outline`);
    if (!b) return modelOnly(`part ${shown(j.to)} is not in Wonder's outline`);
    if (a.status !== "confirmed") return modelOnly(`part ${shown(j.from)} is unconfirmed, so plain code does not know its lines`);
    if (b.status !== "confirmed") return modelOnly(`part ${shown(j.to)} is unconfirmed, so plain code does not know its lines`);
    const edges = shownEdges(j.kind, j.from, j.to);
    // Wonder's evidence matches only when it quotes, from its first line, a line where a counted edge happens.
    const f = info.get(ev.path);
    const matches =
      f !== undefined &&
      edges.some((e) => e.from === ev.path && e.lines.includes(ev.line)) &&
      anchoredProblem(f.lines, f.count, ev.line, Math.min(f.count, ev.line + 20), ev.quotedSnippet) === null;
    const wonderEvidence = { path: visibleText(ev.path), line: ev.line, matches };
    if (edges.length === 0) {
      const what = j.kind === "calls" ? "call" : j.kind === "imports" ? "import" : "import or call (type-only imports do not count)";
      return { ...modelOnly(`plain code found no ${what} from inside ${shown(j.from)}'s lines reaching a definition inside ${shown(j.to)}'s lines${j.kind === "data" ? " (either way)" : ""}`), wonderEvidence };
    }
    const typeOnly = edges.every((e) => e.typeOnly);
    return {
      ...base,
      status: "confirmed",
      codeEdges: [...new Set(edges.map((e) => e.id))].sort(cmp),
      wonderEvidence,
      ...(typeOnly ? { typeOnly: true as const } : {}),
      ...(matches ? {} : { reason: `Wonder's quoted evidence is not the line of an import or call it names (${shown(ev.path)} line ${ev.line}); the code map's own edges are listed instead` }),
    };
  });

  // Code-only: edges between two confirmed parts that no confirmed Wonder join (in that direction) covers.
  const confirmedParts = parts.filter((p) => p.status === "confirmed");
  const joinedPairs = new Set(joins.filter((j) => j.status === "confirmed").flatMap((j) => (j.kind === "data" ? [`${j.from}\u0000${j.to}`, `${j.to}\u0000${j.from}`] : [`${j.from}\u0000${j.to}`])));
  if (!cantCheck) {
    for (const a of confirmedParts) {
      for (const b of confirmedParts) {
        if (a.id === b.id || joinedPairs.has(`${a.id}\u0000${b.id}`)) continue;
        const edges = codeMap.edges.filter((e) => edgeShows(e, regionsOf.get(a.id)!, regionsOf.get(b.id)!, symbol));
        if (edges.length === 0) continue;
        const typeOnly = edges.every((e) => e.typeOnly);
        joins.push({ id: `code:${a.id}->${b.id}`, from: a.id, to: b.id, kind: edges.some((e) => e.kind === "calls") ? "calls" : "imports", status: "code-only", codeEdges: edges.map((e) => e.id).sort(cmp), ...(typeOnly ? { typeOnly: true as const } : {}) });
      }
    }
  }

  const covered = new Set(confirmedParts.flatMap((p) => p.files));
  const notInAnyPart = codeMap.files.map((f) => f.path).filter((p) => !covered.has(p)).sort(cmp);
  const n = (s: VerifiedJoin["status"]) => joins.filter((j) => j.status === s).length;
  return {
    version: 1,
    model,
    ...(cantCheck ? { cantCheck } : {}),
    parts,
    joins,
    notInAnyPart,
    counts: {
      confirmedParts: confirmedParts.length,
      unconfirmedParts: parts.length - confirmedParts.length,
      confirmedJoins: n("confirmed"),
      modelOnlyJoins: n("model-only"),
      codeOnlyJoins: n("code-only"),
    },
  };
}
