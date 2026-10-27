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
//     the second part holds whole) (review B1). "calls" needs a call; "imports" an import or a call made through
//     one (a type-only import is labelled so); "data" either, in either direction, never a type-only import. Otherwise MODEL-ONLY: "Wonder
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
  /** codeBefore[n] = how many of lines 1..n hold code (for "only comments or blank lines between" in O(1)). */
  codeBefore: number[];
  /** chars[n] = characters in lines 1..n (the quote check reads that many). */
  chars: number[];
}

class OverBudget extends Error {}

/**
 * Review M4: why a range does not sit on whole definitions (null when it does). It must start at line 1 or at the
 * first line of a definition the code map knows (only comments or blank lines may come between), and end at the
 * file's last line or at the last line of a definition (only comments or blank lines after it). A range over
 * MAX_RANGE_LINES lines must be the whole file.
 */
function boundaryProblem(f: FileInfo, a: number, b: number, spend: (n: number) => void): string | null {
  if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= f.count)) return null; // anchoredProblem says why
  const whole = a === 1 && b === f.count;
  if (b - a + 1 > MAX_RANGE_LINES && !whole) return `a range over ${MAX_RANGE_LINES} lines must be the whole file (lines 1–${f.count})`;
  spend(f.symbols.length);
  const gapOk = (from: number, to: number) => to < from || f.codeBefore[to]! - f.codeBefore[from - 1]! === 0;
  const startOk = a === 1 || f.symbols.some((s) => s.lineStart >= a && s.lineStart <= b && gapOk(a, s.lineStart - 1));
  if (!startOk) return `line ${a} is not the start of a definition the code map knows (or line 1)`;
  const endOk = b === f.count || f.symbols.some((s) => s.lineEnd <= b && s.lineEnd >= a && gapOk(s.lineEnd + 1, b));
  if (!endOk) return `line ${b} is not the end of a definition the code map knows (or the file's last line)`;
  return null;
}

interface Region {
  part: string;
  lineStart: number;
  lineEnd: number;
  whole: boolean;
}

/** Wonder-only: what plain code can and cannot say (review round 2, M2). */
export const COULD_NOT_CHECK = "Wonder says this; plain code could not check it";
export const FOUND_NO_LINK = "Atlas found no import or call for this";

/** Plain code's verdict on Wonder's outline. Pure; never throws for any outline value that passed the schema. */
export function verifyOutline(files: ReadonlyArray<Pick<OutlineFile, "path" | "text">>, codeMap: CodeMap, outline: WonderOutline, model: string): VerifiedOutline {
  try {
    return verifyCounted(files, codeMap, outline, model, false);
  } catch (e) {
    if (!(e instanceof OverBudget)) throw e;
    return verifyCounted(files, codeMap, outline, model, true);
  }
}

function verifyCounted(files: ReadonlyArray<Pick<OutlineFile, "path" | "text">>, codeMap: CodeMap, outline: WonderOutline, model: string, overBudget: boolean): VerifiedOutline {
  // Review round 2 (M4): every comparison is counted as it is made; past MAX_VERIFY_WORK the whole outline is
  // "can't check" (the second pass, with overBudget set, does no comparisons). A count, not a clock.
  let work = 0;
  const spend = (n: number) => {
    work += n;
    if (!overBudget && work > MAX_VERIFY_WORK) throw new OverBudget();
  };
  const cantCheck = overBudget ? TOO_LARGE_TO_VERIFY : undefined;
  const symbolsOf = new Map(codeMap.files.map((f) => [f.path, f.symbols] as const));
  const info = new Map<string, FileInfo>();
  for (const f of files) {
    const lines = f.text.split("\n");
    const codeBefore = [0];
    const chars = [0];
    for (const l of lines) {
      codeBefore.push(codeBefore[codeBefore.length - 1]! + (notCode(l) ? 0 : 1));
      chars.push(chars[chars.length - 1]! + l.length + 1);
    }
    spend(f.text.length);
    info.set(f.path, { lines, count: countLines(f.text), symbols: symbolsOf.get(f.path) ?? [], codeBefore, chars });
  }
  const symbolById = new Map(codeMap.files.flatMap((f) => f.symbols.map((s) => [s.id, s] as const)));
  const by = `model:${model}` as const;

  const parts: VerifiedPart[] = outline.parts.map((p) => {
    const reasons: string[] = [];
    const spans = p.files.map((s) => {
      const f = info.get(s.path);
      const whole = f !== undefined && s.lineStart === 1 && s.lineEnd === f.count;
      let reason: string | null | undefined = cantCheck;
      if (!reason) {
        if (!f) reason = `${shown(s.path)} is not a file of this codebase`;
        else {
          // The quote check squashes every character of the range once, then compares the quote once.
          const from = Math.min(f.lines.length, Math.max(0, s.lineStart - 1));
          const to = Math.min(f.lines.length, Math.max(from, s.lineEnd));
          spend(f.chars[to]! - f.chars[from]! + s.quotedSnippet.length);
          reason = boundaryProblem(f, s.lineStart, s.lineEnd, spend) ?? anchoredProblem(f.lines, f.count, s.lineStart, s.lineEnd, s.quotedSnippet);
        }
      }
      if (reason && (reason !== cantCheck || reasons.length === 0)) reasons.push(f && reason !== cantCheck ? `${shown(s.path)}: ${reason}` : reason);
      return { path: visibleText(s.path), lineStart: s.lineStart, lineEnd: s.lineEnd, ok: !reason, ...(reason ? { reason } : {}), ...(whole && !reason ? { wholeFile: true as const } : {}) };
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

  // ---- which parts each edge links (review B1, round 2 B1 and M4) ----
  // Regions by file, for the confirmed parts.
  const regions = new Map<string, Region[]>();
  for (const p of outline.parts) {
    if (partOf.get(p.id)!.status !== "confirmed") continue;
    for (const s of p.files) (regions.get(s.path) ?? regions.set(s.path, []).get(s.path)!).push({ part: p.id, lineStart: s.lineStart, lineEnd: s.lineEnd, whole: s.lineStart === 1 && s.lineEnd === info.get(s.path)!.count });
  }
  const partsAt = (path: string, line: number): Set<string> => {
    const rs = regions.get(path) ?? [];
    spend(rs.length + 1);
    return new Set(rs.filter((r) => r.lineStart <= line && line <= r.lineEnd).map((r) => r.part));
  };
  const wholeHolders = (path: string): Set<string> => new Set((regions.get(path) ?? []).filter((r) => r.whole).map((r) => r.part));
  /** Parts that hold what the edge reaches: its definition(s), or the whole target file. */
  const targetParts = (e: CodeEdge): Set<string> => {
    const out = wholeHolders(e.to);
    const rs = regions.get(e.to) ?? [];
    for (const id of e.toSymbol ? [e.toSymbol] : (e.toSymbols ?? [])) {
      const s = symbolById.get(id);
      if (!s) continue;
      spend(rs.length + 1);
      for (const r of rs) if (r.lineStart <= s.lineStart && s.lineEnd <= r.lineEnd) out.add(r.part);
    }
    return out;
  };
  /** pair "A\0B" → the edges that show A reaching B. */
  const linked = new Map<string, CodeEdge[]>();
  if (!cantCheck && !codeMap.cantMap) {
    for (const e of codeMap.edges) {
      const targets = targetParts(e);
      if (targets.size === 0) continue;
      // Review round 2 (B1): an import statement counts only for a part that holds the importing file whole. A part
      // that holds some definitions of the file links through the uses its own lines make (calls, references).
      const sources: Set<string>[] = [];
      if (e.kind === "imports") sources.push(wholeHolders(e.from));
      else {
        const seenSets = new Set<string>();
        for (const line of e.lines) {
          const at = partsAt(e.from, line);
          const key = [...at].sort().join("\u0000");
          if (!seenSets.has(key)) {
            seenSets.add(key);
            sources.push(at);
          }
        }
      }
      for (const src of sources) {
        for (const a of src) {
          if (targets.has(a)) continue;
          for (const b of targets) {
            if (src.has(b)) continue;
            spend(1);
            const k = `${a}\u0000${b}`;
            const list = linked.get(k) ?? linked.set(k, []).get(k)!;
            if (!list.includes(e)) list.push(e);
          }
        }
      }
    }
  }
  const edgesFor = (kind: JoinKind, a: string, b: string): CodeEdge[] => {
    const fwd = linked.get(`${a}\u0000${b}`) ?? [];
    if (kind === "calls") return fwd.filter((e) => e.kind === "calls");
    if (kind === "imports") return fwd;
    // "data": a real use inside the parts' lines (a call or a reference, never a bare import line or a type), either way.
    return [...fwd, ...(linked.get(`${b}\u0000${a}`) ?? [])].filter((e) => e.kind !== "imports" && !e.typeOnly);
  };
  /** Plain code positively found nothing: different files, no file of A imports a file of B, nothing it cannot follow. */
  const foundNothing = (a: VerifiedPart, b: VerifiedPart): boolean => {
    if (codeMap.cantMap || a.files.some((f) => b.files.includes(f))) return false;
    const mapFiles = codeMap.files.filter((f) => a.files.includes(f.path));
    if (mapFiles.some((f) => f.parseNotes.length > 0 || f.imports.some((i) => i.target.kind === "unresolved"))) return false;
    return !codeMap.edges.some((e) => a.files.includes(e.from) && b.files.includes(e.to));
  };

  const joins: VerifiedJoin[] = outline.joins.map((j, index) => {
    const id = `wonder:${index}`;
    const ev = j.evidence;
    const base = { id, from: j.from, to: j.to, kind: j.kind };
    const modelOnly = (reason: string, extra: Partial<VerifiedJoin> = {}): VerifiedJoin => ({ ...base, status: "model-only", codeEdges: [], reason, wonderEvidence: { path: visibleText(ev.path), line: ev.line, matches: false }, ...extra });
    const couldNot = (why: string) => modelOnly(`${COULD_NOT_CHECK}: ${why}`);
    if (cantCheck) return modelOnly(cantCheck);
    const a = partOf.get(j.from);
    const b = partOf.get(j.to);
    if (j.from === j.to) return couldNot("a join must link two different parts");
    if (!a) return couldNot(`part ${shown(j.from)} is not in Wonder's outline`);
    if (!b) return couldNot(`part ${shown(j.to)} is not in Wonder's outline`);
    if (a.status !== "confirmed") return couldNot(`part ${shown(j.from)}'s lines were not confirmed`);
    if (b.status !== "confirmed") return couldNot(`part ${shown(j.to)}'s lines were not confirmed`);
    if (codeMap.cantMap) return couldNot(codeMap.cantMap);
    const edges = edgesFor(j.kind, j.from, j.to);
    // Wonder's evidence matches only when it quotes, from its first line, a line where a counted edge happens.
    const f = info.get(ev.path);
    const matches =
      f !== undefined &&
      edges.some((e) => e.from === ev.path && e.lines.includes(ev.line)) &&
      anchoredProblem(f.lines, f.count, ev.line, Math.min(f.count, ev.line + 20), ev.quotedSnippet) === null;
    const wonderEvidence = { path: visibleText(ev.path), line: ev.line, matches };
    if (edges.length === 0) {
      if (foundNothing(a, b)) return modelOnly(`${FOUND_NO_LINK}: no file of ${shown(j.from)} imports a file of ${shown(j.to)}`, { wonderEvidence, noLinkFound: true });
      const what = j.kind === "calls" ? "call" : j.kind === "imports" ? "import or use" : "call or use (an import line alone does not count)";
      return modelOnly(`${COULD_NOT_CHECK}: it found no ${what} inside ${shown(j.from)}'s lines reaching ${shown(j.to)}'s lines${j.kind === "data" ? " (either way)" : ""}, and it does not see every kind of link`, { wonderEvidence });
    }
    const typeOnly = edges.every((e) => e.typeOnly);
    return {
      ...base,
      status: "confirmed",
      codeEdges: [...new Set(edges.map((e) => e.id))].sort(cmp),
      wonderEvidence,
      ...(typeOnly ? { typeOnly: true as const } : {}),
      ...(matches ? {} : { reason: `Wonder's quoted evidence is not the line of an import, call or use it names (${shown(ev.path)} line ${ev.line}); the code map's own edges are listed instead` }),
    };
  });

  // Code-only: links between two confirmed parts that no confirmed Wonder join (that way, or "data" either way) covers.
  const confirmedParts = parts.filter((p) => p.status === "confirmed");
  const joinedPairs = new Set(joins.filter((j) => j.status === "confirmed").flatMap((j) => (j.kind === "data" ? [`${j.from}\u0000${j.to}`, `${j.to}\u0000${j.from}`] : [`${j.from}\u0000${j.to}`])));
  for (const a of confirmedParts) {
    for (const b of confirmedParts) {
      if (a.id === b.id || joinedPairs.has(`${a.id}\u0000${b.id}`)) continue;
      const edges = linked.get(`${a.id}\u0000${b.id}`) ?? [];
      if (edges.length === 0) continue;
      const typeOnly = edges.every((e) => e.typeOnly);
      joins.push({ id: `code:${a.id}->${b.id}`, from: a.id, to: b.id, kind: edges.some((e) => e.kind === "calls") ? "calls" : "imports", status: "code-only", codeEdges: edges.map((e) => e.id).sort(cmp), ...(typeOnly ? { typeOnly: true as const } : {}) });
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
