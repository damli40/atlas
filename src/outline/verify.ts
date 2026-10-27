// X1: plain code decides which parts and joins of Muse Wonder's outline are real.
//
// Plain words:
// - `parseWonderOutline` reads the model's answer: at most MAX_ANSWER_CHARS characters, JSON nested at most
//   MAX_ANSWER_DEPTH levels, then a strict schema (unknown keys refused, every length capped, part ids unique).
//   A failure is a reason in words; the caller may ask the model once more, then stops.
// - `verifyOutline` checks the outline against the files and the code map:
//   - a part is CONFIRMED only when every file span it names is a file of the codebase (exact path), its lines
//     exist, and its quoted snippet is whole lines of that span (whitespace-normalised, src/outline/quote.ts).
//     Otherwise it is UNCONFIRMED, with every reason. A path like "../../etc/passwd" is simply not a file of the
//     codebase: nothing is ever read from outside the files Atlas holds.
//   - a join is CONFIRMED only when both parts are confirmed and the code map holds an edge from a file of the
//     first part to a file of the second ("calls" needs a call edge; "imports" an import edge; "data" either,
//     because plain code cannot see data flow itself, only the import or call it travels through). Otherwise it
//     is MODEL-ONLY: "Wonder says; the code doesn't show it", with the reason.
//   - edges between two confirmed parts that Wonder did not join become CODE-ONLY joins, found by plain code.
//   - files no confirmed part covers are listed as "not in any part".
//   - every name, purpose and pattern is the model's text, labelled as such, with hidden characters (line
//     breaks, bidi controls) made visible by src/gate.ts visibleText.
// Pure and deterministic; no I/O, no clock, no model. Never throws for any outline.

import { z } from "zod";
import { visibleText } from "../gate";
import { jsonDepth } from "../seal";
import { countLines } from "./codemap";
import { quoteProblem } from "./quote";
import type { CodeEdge, CodeMap, JoinKind, OutlineFile, VerifiedJoin, VerifiedOutline, VerifiedPart, WonderOutline } from "./types";

export const MAX_ANSWER_CHARS = 400_000;
export const MAX_ANSWER_DEPTH = 12;
export const MAX_PARTS = 40;
export const MAX_SPANS_PER_PART = 30;
export const MAX_JOINS = 200;
export const MAX_PATTERNS = 12;

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
  quotedSnippet: z.string().min(1).max(4000),
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
          from: z.string().min(1).max(64),
          to: z.string().min(1).max(64),
          kind: z.enum(["calls", "imports", "data"]),
          evidence: z.strictObject({ path: z.string().min(1).max(300), line: z.number().int().min(-1_000_000_000).max(1_000_000_000), quotedSnippet: z.string().min(1).max(4000) }),
        }),
      )
      .max(MAX_JOINS),
  })
  .superRefine((o, ctx) => {
    const ids = o.parts.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["parts"], message: "two parts share an id" });
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

/**
 * The code-map edges that lead from part A's files to part B's files. An edge whose two files both belong to A, or
 * both to B, is inside one part (two parts can share a file), so it never shows a join between them.
 */
const edgesBetween = (map: CodeMap, a: VerifiedPart, b: VerifiedPart) =>
  map.edges.filter((e) => a.files.includes(e.from) && b.files.includes(e.to) && !(a.files.includes(e.to) && a.files.includes(e.from)) && !(b.files.includes(e.from) && b.files.includes(e.to)));

/** Does this code-map edge show a join of this kind? */
const edgeFits = (kind: JoinKind, e: CodeEdge) => (kind === "calls" ? e.kind === "calls" : kind === "imports" ? e.kind === "imports" : true);

/** Plain code's verdict on Wonder's outline. Pure; never throws for any outline value that passed the schema. */
export function verifyOutline(files: ReadonlyArray<Pick<OutlineFile, "path" | "text">>, codeMap: CodeMap, outline: WonderOutline, model: string): VerifiedOutline {
  const byPath = new Map(files.map((f) => [f.path, { text: f.text, lines: countLines(f.text) }] as const));
  const by = `model:${model}` as const;

  const parts: VerifiedPart[] = outline.parts.map((p) => {
    const reasons: string[] = [];
    const spans = p.files.map((s) => {
      const f = byPath.get(s.path);
      const reason = !f ? `${shown(s.path)} is not a file of this codebase` : quoteProblem(f.text, f.lines, s.lineStart, s.lineEnd, s.quotedSnippet);
      if (reason) reasons.push(f ? `${shown(s.path)}: ${reason}` : reason);
      return { path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd, ok: reason === null, ...(reason ? { reason } : {}) };
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

  const joins: VerifiedJoin[] = outline.joins.map((j, index) => {
    const id = `wonder:${index}`;
    const ev = j.evidence;
    const f = byPath.get(ev.path);
    const evProblem = !f ? "not a file of this codebase" : quoteProblem(f.text, f.lines, Math.max(1, ev.line - 2), Math.min(f.lines, ev.line + 20), ev.quotedSnippet);
    const wonderEvidence = { path: ev.path, line: ev.line, matches: evProblem === null && f !== undefined && ev.line >= 1 && ev.line <= f.lines };
    const base = { id, from: j.from, to: j.to, kind: j.kind, wonderEvidence };
    const a = partOf.get(j.from);
    const b = partOf.get(j.to);
    const modelOnly = (reason: string): VerifiedJoin => ({ ...base, status: "model-only", codeEdges: [], reason });
    if (j.from === j.to) return modelOnly("a join must link two different parts");
    if (!a) return modelOnly(`part ${shown(j.from)} is not in Wonder's outline`);
    if (!b) return modelOnly(`part ${shown(j.to)} is not in Wonder's outline`);
    if (a.status !== "confirmed") return modelOnly(`part ${shown(j.from)} is unconfirmed, so plain code does not know its files`);
    if (b.status !== "confirmed") return modelOnly(`part ${shown(j.to)} is unconfirmed, so plain code does not know its files`);
    const edges = edgesBetween(codeMap, a, b).filter((e) => edgeFits(j.kind, e));
    if (edges.length === 0) {
      const what = j.kind === "calls" ? "call" : j.kind === "imports" ? "import" : "import or call";
      return modelOnly(`plain code found no ${what} from a file of ${shown(j.from)} to a file of ${shown(j.to)} (it sees imports and calls between files only)`);
    }
    return {
      ...base,
      status: "confirmed",
      codeEdges: edges.map((e) => e.id).sort(cmp),
      ...(wonderEvidence.matches ? {} : { reason: `Wonder's quoted evidence does not match ${shown(ev.path)} near line ${ev.line}; the code map's own edges are listed instead` }),
    };
  });

  // Code-only: edges between two confirmed parts that no confirmed Wonder join (in that direction) covers.
  const confirmedParts = parts.filter((p) => p.status === "confirmed");
  const joinedPairs = new Set(joins.filter((j) => j.status === "confirmed").map((j) => `${j.from}\u0000${j.to}`));
  for (const a of confirmedParts) {
    for (const b of confirmedParts) {
      if (a.id === b.id || joinedPairs.has(`${a.id}\u0000${b.id}`)) continue;
      const edges = edgesBetween(codeMap, a, b);
      if (edges.length === 0) continue;
      joins.push({ id: `code:${a.id}->${b.id}`, from: a.id, to: b.id, kind: edges.some((e) => e.kind === "calls") ? "calls" : "imports", status: "code-only", codeEdges: edges.map((e) => e.id).sort(cmp) });
    }
  }

  const covered = new Set(confirmedParts.flatMap((p) => p.files));
  const notInAnyPart = codeMap.files.map((f) => f.path).filter((p) => !covered.has(p)).sort(cmp);
  const n = (s: VerifiedJoin["status"]) => joins.filter((j) => j.status === s).length;
  return {
    version: 1,
    model,
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
