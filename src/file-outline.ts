// U1 (D47): the outline of ONE pasted file, by plain code: its functions (and classes) and which of them calls which.
//
// Plain words: the same parsers the code explorer uses (src/outline/parse-js.ts, parse-py.ts) read the file. Every
// top-level function or class becomes a part with its real lines. A use of one of the file's own top-level names
// inside another part's lines becomes a join "A calls B" (every line where it happens). No model is asked and the code
// never runs, so the drawing it feeds shows structure only.
// Deterministic: parts sorted by line, joins by id. Pure, no I/O.

import { parseJsFile, type ParsedFile } from "./outline/parse-js";
import type { BodyFacts, CallFacts, ThrowSite } from "./outline/types";
import { pyBodies, pyThrowsInFile } from "./outline/py-bodies";
import { maskSource } from "./failure-labels";
import { parsePyFile } from "./outline/parse-py";
import { bracketDepth, MAX_BRACKET_DEPTH } from "./outline/codemap";

export interface FilePart {
  /** The name as written (a method is "Class.method"; methods are folded into their class's part). */
  name: string;
  kind: "function" | "class" | "variable";
  exported: boolean;
  lineStart: number;
  lineEnd: number;
  signature?: string;
}
export interface FileJoin {
  id: string;
  from: string;
  to: string;
  /**
   * "calls" (a call or `new`), "uses" (any other reference, e.g. passing the function along), or U3 "wraps": `from` is
   * decorated by `to` (an `@to` line above it), so a call to `from` runs `to`'s wrapper first. A decorator is not a call
   * made by `from`'s own lines, so it is never drawn as one.
   */
  kind: "calls" | "uses" | "wraps";
  lines: number[];
}
export interface FileOutline {
  /** R3: calls with names resolved by real scope (the parsers read them). Absent: no device gets a wire. */
  callFacts?: CallFacts;
  parts: FilePart[];
  /** How many functions and classes the file really defines, when that is more than the outline keeps. */
  partsInFile?: number;
  joins: FileJoin[];
  /** Why the outline is empty or partial, in plain words (parser notes). */
  notes: string[];
  /** U3: parts whose own lines call themselves (recursion), with those lines. A self-call is not a join between parts. */
  selfCalls?: { name: string; lines: number[] }[];
  /** D65 review R5: what each function's own body holds, by syntax. A part without an entry draws no fittings. */
  bodies?: Record<string, BodyFacts>;
  /** Every place in the file that could produce an error, nested and class ones too. Absent: the run's end is not placed on a chute. */
  throwsInFile?: ThrowSite[];
}

/** At most this many parts are kept (the drawing's limit is 40). */
export const FILE_OUTLINE_MAX_PARTS = 40;

export function fileOutline(source: string, language: "js" | "ts" | "py"): FileOutline {
  if (bracketDepth(source) > MAX_BRACKET_DEPTH) return { parts: [], joins: [], notes: [`brackets nest deeper than ${MAX_BRACKET_DEPTH} levels, so plain code did not read the file's outline`] };
  let parsed: ParsedFile;
  try {
    parsed = language === "py" ? parsePyFile(source) : parseJsFile(language === "ts" ? "pasted.ts" : "pasted.js", source, language);
  } catch {
    return { parts: [], joins: [], notes: ["plain code could not parse the file's outline"] };
  }
  // Top-level definitions only (methods belong to their class's part).
  const top = parsed.symbols.filter((s) => !s.parent && (s.kind === "function" || s.kind === "class"));
  const parts: FilePart[] = top
    .map((s) => ({ name: s.name, kind: s.kind, exported: s.exported, lineStart: s.lineStart, lineEnd: s.lineEnd, ...(s.signature ? { signature: s.signature } : {}) }))
    .sort((a, b) => a.lineStart - b.lineStart || (a.name < b.name ? -1 : 1));
  const notes = [...parsed.notes];
  const partsInFile = parts.length;
  if (parts.length > FILE_OUTLINE_MAX_PARTS) {
    notes.push(`the file defines ${parts.length} functions and classes; the drawing shows the first ${FILE_OUTLINE_MAX_PARTS}`);
    parts.length = FILE_OUTLINE_MAX_PARTS;
  }
  const names = new Set(parts.map((p) => p.name));
  const enclosing = (line: number) => parts.find((p) => p.lineStart <= line && line <= p.lineEnd);
  const byId = new Map<string, FileJoin>();
  const self = new Map<string, number[]>();
  // U3: a decorator line (`@name` or `@name(...)`, the first thing on its line) wraps the part below it; it is not a
  // call made by that part's own lines.
  const textLines = source.split(/\r\n|\r|\n|\u2028|\u2029/);
  const isDecoratorLine = (line: number) => /^\s*@/.test(textLines[line - 1] ?? "");
  for (const c of parsed.calls) {
    if (!c.own || !names.has(c.local)) continue;
    const from = enclosing(c.line);
    if (!from) continue;
    if (from.name === c.local) {
      // A part's own name inside itself (recursion) is not a join between parts; a CALL of it is a self-call (U3).
      if ((c.form === "call" || c.form === "new") && !isDecoratorLine(c.line)) {
        const l = self.get(from.name) ?? [];
        if (!l.includes(c.line)) l.push(c.line);
        self.set(from.name, l);
      }
      continue;
    }
    const kind = isDecoratorLine(c.line) && from.lineStart <= c.line ? "wraps" : c.form === "call" || c.form === "new" ? "calls" : "uses";
    const id = `${from.name}->${c.local}`;
    const j = byId.get(id);
    if (j) {
      if (kind === "calls" || (kind === "wraps" && j.kind === "uses")) j.kind = kind;
      if (!j.lines.includes(c.line)) j.lines.push(c.line);
    } else byId.set(id, { id, from: from.name, to: c.local, kind, lines: [c.line] });
  }
  const joins = [...byId.values()].map((j) => ({ ...j, lines: [...j.lines].sort((a, b) => a - b) })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selfCalls = [...self.entries()].map(([name, lines]) => ({ name, lines: [...lines].sort((a, b) => a - b) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { parts, ...(partsInFile > parts.length ? { partsInFile } : {}), joins, notes, ...(selfCalls.length ? { selfCalls } : {}), ...(parsed.callFacts ? { callFacts: parsed.callFacts } : {}), bodies: language === "py" ? pyBodies(maskSource(source, "py"), source, parts) : parsed.bodies ?? {}, throwsInFile: language === "py" ? pyThrowsInFile(maskSource(source, "py"), source) : parsed.throwsInFile ?? [] };
}
