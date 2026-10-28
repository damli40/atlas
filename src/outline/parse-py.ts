// X1: reads one Python file with a small scanner written in TypeScript (no model, never runs the code).
//
// Plain words: Python marks blocks by indentation, and the things the code map needs (top-level `def` and
// `class`, methods of top-level classes, `import` / `from ... import`, and calls of imported names) all sit at the
// start of a "logical line" (a statement, which may span several physical lines inside brackets). So the scanner:
// 1. splits the text into tokens (names, operators, strings, numbers), skipping comments and reading every
//    string form (quotes, triple quotes, prefixes like r/b/f, f-string expressions with nested quotes);
// 2. groups tokens into logical lines with their indentation;
// 3. reads definitions, imports and calls from those lines.
//
// Why not Python's own `ast` module: the proof-file check (src/atlasfile.ts verify) must re-read the code
// synchronously, in-process, on any machine, without starting a Python process. This scanner is pure, has no
// I/O, and cannot execute anything. It reads a SUBSET of Python: what is not listed above (decorator arguments,
// nested functions, star-args semantics, conditional imports' conditions) is not interpreted. When it meets
// something it cannot read (an unclosed string or bracket), it says so in parseNotes and keeps what it read.

import type { CodeSymbol, ImportName } from "./types";
import type { ParsedFile, RawCall, RawImport } from "./parse-js";

type Tok = { t: "name" | "op" | "str" | "num"; v: string; line: number; start: number; end: number };

const SIG_MAX = 200;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string, n = SIG_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Review minor 5: direction controls and zero-width characters are never part of a name. */
const HIDDEN = /[\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
const isNameStart = (c: string) => /[A-Za-z_\u00A0-\uFFFF]/.test(c) && !HIDDEN.test(c);
const isNamePart = (c: string) => /[\w\u00A0-\uFFFF]/.test(c) && !HIDDEN.test(c);
const STRING_PREFIX = /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/;
const MAX_FSTRING_NESTING = 16;
const MULTI_OPS = ["->", "**", ":=", "==", "!=", "<=", ">="];
const KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "type"]);

interface Logical {
  indent: number;
  toks: Tok[];
}

/** Tokens grouped into logical lines, plus any problem that stopped the scan. */
function scan(src: string): { lines: Logical[]; problem?: string } {
  const lines: Logical[] = [];
  let cur: Tok[] = [];
  let curIndent = 0;
  let depth = 0;
  let i = 0;
  let line = 1;
  let atLineStart = true;
  let col = 0;
  let problem: string | undefined;

  const flush = () => {
    if (cur.length > 0) lines.push({ indent: curIndent, toks: cur });
    cur = [];
  };

  /** Reads a string starting at i (at its quote, after any prefix). Returns false when it is not closed. */
  const readString = (isF: boolean, nest: number): boolean => {
    const q = src[i]!;
    const triple = src.startsWith(q.repeat(3), i);
    const close = triple ? q.repeat(3) : q;
    i += close.length;
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        if (src[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (src.startsWith(close, i)) {
        i += close.length;
        return true;
      }
      if (c === "\n") {
        if (!triple) return false;
        line++;
      }
      if (isF && c === "{") {
        if (src[i + 1] === "{") {
          i += 2;
          continue;
        }
        // An f-string expression: read until its matching "}", stepping over nested strings.
        if (nest >= MAX_FSTRING_NESTING) return false;
        i++;
        let d = 1;
        while (i < src.length && d > 0) {
          const e = src[i]!;
          if (e === "\n") line++;
          if (e === "{" || e === "(" || e === "[") d++;
          else if (e === "}" || e === ")" || e === "]") d--;
          if (d === 0) break;
          if (e === "'" || e === '"') {
            if (!readString(false, nest + 1)) return false;
            continue;
          }
          const pre = /^[rRbBuUfF]{1,2}(?=['"])/.exec(src.slice(i, i + 3));
          if (pre && STRING_PREFIX.test(pre[0]) && !isNamePart(src[i - 1] ?? " ")) {
            i += pre[0].length;
            if (!readString(/[fF]/.test(pre[0]), nest + 1)) return false;
            continue;
          }
          i++;
        }
        if (d !== 0) return false;
        i++; // the closing "}"
        continue;
      }
      i++;
    }
    return false;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (atLineStart) {
      // Measure indentation of a new physical line (only meaningful outside brackets).
      col = 0;
      let j = i;
      while (j < src.length && (src[j] === " " || src[j] === "\t" || src[j] === "\f")) {
        col = src[j] === "\t" ? (Math.floor(col / 8) + 1) * 8 : col + 1;
        j++;
      }
      i = j;
      atLineStart = false;
      if (depth === 0 && cur.length === 0) curIndent = col;
      continue;
    }
    if (c === "\n") {
      line++;
      i++;
      atLineStart = true;
      if (depth === 0) flush();
      continue;
    }
    if (c === "\r" || c === " " || c === "\t" || c === "\f") {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      i += src[i + 1] === "\n" ? 2 : 3;
      line++;
      continue; // explicit line joining
    }
    const start = i;
    const startLine = line;
    if (c === "'" || c === '"') {
      if (!readString(false, 0)) {
        problem = `an unclosed string starts on line ${startLine}`;
        break;
      }
      cur.push({ t: "str", v: src.slice(start, i), line: startLine, start, end: i });
      continue;
    }
    if (isNameStart(c)) {
      let j = i + 1;
      while (j < src.length && isNamePart(src[j]!)) j++;
      const word = src.slice(i, j);
      if ((src[j] === "'" || src[j] === '"') && STRING_PREFIX.test(word)) {
        i = j;
        if (!readString(/[fF]/.test(word), 0)) {
          problem = `an unclosed string starts on line ${startLine}`;
          break;
        }
        cur.push({ t: "str", v: src.slice(start, i), line: startLine, start, end: i });
        continue;
      }
      i = j;
      cur.push({ t: "name", v: word, line: startLine, start, end: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) j++;
      i = j;
      cur.push({ t: "num", v: src.slice(start, i), line: startLine, start, end: i });
      continue;
    }
    // Operators: the few multi-character ones the reader cares about, else one character.
    const two = src.slice(i, i + 3);
    const op = two.startsWith("...") ? "..." : (MULTI_OPS.find((o) => two.startsWith(o)) ?? c);
    if (op === "(" || op === "[" || op === "{") depth++;
    if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
    i += op.length;
    cur.push({ t: "op", v: op, line: startLine, start, end: i });
  }
  if (!problem && depth > 0) problem = "a bracket is not closed by the end of the file";
  flush();
  return { lines, ...(problem ? { problem } : {}) };
}

const isOp = (t: Tok | undefined, v: string) => t?.t === "op" && t.v === v;
const isName = (t: Tok | undefined, v?: string) => t?.t === "name" && (v === undefined || t.v === v);

/** A dotted name starting at index k ("a.b.c"), and the index after it. */
function dotted(toks: Tok[], k: number): { name: string; next: number } | null {
  if (!isName(toks[k])) return null;
  let name = toks[k]!.v;
  let j = k + 1;
  while (isOp(toks[j], ".") && isName(toks[j + 1])) {
    name += `.${toks[j + 1]!.v}`;
    j += 2;
  }
  return { name, next: j };
}

/** Splits tokens at depth-0 commas (depth counted from the start of `toks`). */
function splitTopCommas(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let part: Tok[] = [];
  let d = 0;
  for (const t of toks) {
    if (t.t === "op" && "([{".includes(t.v)) d++;
    if (t.t === "op" && ")]}".includes(t.v)) d--;
    if (d === 0 && isOp(t, ",")) {
      out.push(part);
      part = [];
      continue;
    }
    part.push(t);
  }
  if (part.length) out.push(part);
  return out;
}

function parseImport(l: Logical): RawImport[] {
  const toks = l.toks;
  const line = toks[0]!.line;
  if (isName(toks[0], "import")) {
    return splitTopCommas(toks.slice(1)).flatMap((part) => {
      const d = dotted(part, 0);
      if (!d) return [];
      const alias = isName(part[d.next], "as") && isName(part[d.next + 1]) ? part[d.next + 1]!.v : undefined;
      // Review round 3 (R3-B1, L3): `import a.b.c` also loads and binds the package `a` (a/__init__.py).
      const top = d.name.split(".")[0]!;
      const extra = !alias && top !== d.name ? [{ line, specifier: top, kind: "static" as const, names: [{ imported: "*", local: top }] }] : [];
      return [{ line, specifier: d.name, kind: "static" as const, names: [{ imported: "*", local: alias ?? d.name }] }, ...extra];
    });
  }
  // from <dots><module> import a [as b], (c, d) | *
  let k = 1;
  let dots = "";
  while (isOp(toks[k], ".") || isOp(toks[k], "...")) {
    dots += toks[k]!.v;
    k++;
  }
  let mod = "";
  if (!isName(toks[k], "import")) {
    const d = dotted(toks, k);
    if (!d) return [];
    mod = d.name;
    k = d.next;
  }
  if (!isName(toks[k], "import")) return [];
  let rest = toks.slice(k + 1);
  if (isOp(rest[0], "(")) rest = rest.slice(1, isOp(rest[rest.length - 1], ")") ? -1 : undefined);
  const names: ImportName[] = [];
  for (const part of splitTopCommas(rest)) {
    if (isOp(part[0], "*")) names.push({ imported: "*", local: "*" });
    else if (isName(part[0])) names.push({ imported: part[0]!.v, local: isName(part[1], "as") && isName(part[2]) ? part[2]!.v : part[0]!.v });
  }
  return [{ line, specifier: `${dots}${mod}`, kind: "static", names }];
}

/** Parameter texts, written return type and header text of `def name(...) -> R:` starting at token index k (the `def`). */
function defHeader(src: string, toks: Tok[], k: number): { signature: string; params: string[]; returns?: string } {
  const open = k + 2;
  let d = 0;
  let close = -1;
  for (let j = open; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.t === "op" && "([{".includes(t.v)) d++;
    if (t.t === "op" && ")]}".includes(t.v)) {
      d--;
      if (d === 0) {
        close = j;
        break;
      }
    }
  }
  if (!isOp(toks[open], "(") || close < 0) return { signature: cap(squash(src.slice(toks[k]!.start, toks[toks.length - 1]!.end))), params: [] };
  const params = splitTopCommas(toks.slice(open + 1, close))
    .filter((p) => p.length > 0)
    .map((p) => cap(squash(src.slice(p[0]!.start, p[p.length - 1]!.end)), 120));
  let colon = -1;
  d = 0;
  for (let j = close + 1; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.t === "op" && "([{".includes(t.v)) d++;
    if (t.t === "op" && ")]}".includes(t.v)) d--;
    if (d === 0 && isOp(t, ":")) {
      colon = j;
      break;
    }
  }
  const end = colon > 0 ? toks[colon - 1]!.end : toks[close]!.end;
  const arrow = isOp(toks[close + 1], "->") && colon > close + 2 ? cap(squash(src.slice(toks[close + 2]!.start, toks[colon - 1]!.end)), 120) : undefined;
  const from = isName(toks[0], "async") && k === 1 ? toks[0]!.start : toks[k]!.start;
  return { signature: cap(squash(src.slice(from, end))), params, ...(arrow ? { returns: arrow } : {}) };
}

/** Literal `__all__ = ["a", "b"]` (or a tuple): the names, or null when it is not a plain list of strings. */
function allNames(l: Logical): string[] | null {
  const t = l.toks;
  if (!(isName(t[0], "__all__") && isOp(t[1], "="))) return null;
  const inner = t.slice(3, -1);
  if (!(isOp(t[2], "[") || isOp(t[2], "("))) return null;
  const out: string[] = [];
  for (const part of splitTopCommas(inner)) {
    if (part.length !== 1 || part[0]!.t !== "str") return null;
    const m = /^[rRuU]?(['"])(.*)\1$/.exec(part[0]!.v);
    if (!m) return null;
    out.push(m[2]!);
  }
  return out;
}

/** Calls that load or run code by name: listed as dynamic imports, never followed (review round 3, R3-B1). */
const DYNAMIC_LOADERS = new Set(["import_module", "__import__", "run_module", "run_path", "spec_from_file_location", "module_from_spec", "load_source", "exec", "eval", "execfile"]);

const COMPOUND = new Set(["if", "elif", "else", "while", "for", "try", "except", "finally", "with", "def", "class", "match", "case"]);

/**
 * X1 review round 3 (R3-B1): one logical line may hold several statements: `a = 1; import db`, or a one-line
 * compound statement `if x: import db`, `try: from db import f`. Each is split into its own statement (a body after
 * a header's ":" one level deeper), so every import is read where it is.
 */
function splitStatements(lines: Logical[]): Logical[] {
  const out: Logical[] = [];
  const push = (indent: number, toks: Tok[]): void => {
    if (toks.length === 0) return;
    // Split at ";" outside brackets.
    let d = 0;
    let startAt = 0;
    const parts: Tok[][] = [];
    toks.forEach((x, j) => {
      if (x.t === "op" && "([{".includes(x.v)) d++;
      if (x.t === "op" && ")]}".includes(x.v)) d--;
      if (d === 0 && isOp(x, ";")) {
        parts.push(toks.slice(startAt, j));
        startAt = j + 1;
      }
    });
    parts.push(toks.slice(startAt));
    for (const part of parts) {
      if (part.length === 0) continue;
      const k = isName(part[0], "async") ? 1 : 0;
      if (part[k]?.t === "name" && COMPOUND.has(part[k]!.v)) {
        // The ":" that ends the header (outside brackets; `lambda x: …` inside a header is inside brackets or after it).
        let dd = 0;
        let colon = -1;
        for (let j = k + 1; j < part.length; j++) {
          const x = part[j]!;
          if (x.t === "op" && "([{".includes(x.v)) dd++;
          if (x.t === "op" && ")]}".includes(x.v)) dd--;
          if (dd === 0 && isName(x, "lambda")) break;
          if (dd === 0 && isOp(x, ":")) {
            colon = j;
            break;
          }
        }
        if (colon >= 0 && colon < part.length - 1) {
          out.push({ indent, toks: part.slice(0, colon + 1) });
          push(indent + 1, part.slice(colon + 1));
          continue;
        }
      }
      out.push({ indent, toks: part });
    }
  };
  for (const l of lines) push(l.indent, l.toks);
  return out;
}

/**
 * X1 review round 3 (R3-M1): every name a statement binds: all assignment targets (tuple unpacking, starred, chained
 * `a = b = …`, augmented, annotated), `for`/`async for` targets, `with … as x` / `as (a, b)`, `except … as x`, `:=`,
 * `case` captures, and def/class names. Not names after "." or inside [ ] (attributes and subscripts are not names).
 */
function boundNames(t: Tok[]): Set<string> {
  const out = new Set<string>();
  const namesIn = (toks: Tok[]) => {
    let sq = 0;
    toks.forEach((x, j) => {
      if (isOp(x, "[")) sq++;
      if (isOp(x, "]")) sq--;
      if (x.t === "name" && sq === 0 && !KEYWORDS.has(x.v) && !isOp(toks[j - 1], ".") && !isOp(toks[j + 1], ".") && !isOp(toks[j + 1], "(")) out.add(x.v);
    });
  };
  const k = isName(t[0], "async") ? 1 : 0;
  const head = t[k];
  if (isName(head, "def") || isName(head, "class")) {
    if (isName(t[k + 1])) out.add(t[k + 1]!.v);
  } else if (isName(head, "for")) {
    const inAt = t.findIndex((x, j) => j > k && isName(x, "in"));
    namesIn(t.slice(k + 1, inAt < 0 ? t.length : inAt));
  } else if (isName(head, "case")) {
    // Capture patterns: bare names (not dotted value patterns, not class patterns `Point(...)`, not keyword names).
    t.forEach((x, j) => {
      if (j > 0 && x.t === "name" && x.v !== "_" && !KEYWORDS.has(x.v) && !isOp(t[j - 1], ".") && !isOp(t[j + 1], ".") && !isOp(t[j + 1], "(") && !isOp(t[j + 1], "=")) out.add(x.v);
    });
  } else if (!(isName(head, "import") || isName(head, "from") || isName(head, "global") || isName(head, "nonlocal"))) {
    // Assignment targets: everything left of the last "=" outside brackets (an annotation's ":" ends the target).
    let d = 0;
    let lastEq = -1;
    for (let j = 0; j < t.length; j++) {
      const x = t[j]!;
      if (x.t === "op" && "([{".includes(x.v)) d++;
      if (x.t === "op" && ")]}".includes(x.v)) d--;
      if (d === 0 && isOp(x, "=")) lastEq = j;
    }
    if (lastEq > 0) {
      const left = t.slice(0, lastEq);
      const colon = left.findIndex((x) => isOp(x, ":"));
      namesIn(colon >= 0 && isName(left[0]) && colon === 1 ? left.slice(0, 1) : left);
    } else if (isName(t[0]) && isOp(t[1], ":") && !KEYWORDS.has(t[0]!.v)) out.add(t[0]!.v); // `x: int` (annotation only)
  }
  // `with … as x` / `as (a, b)` and `except … as x`, anywhere in the statement (not in import lines).
  if (!(isName(head, "import") || isName(head, "from"))) {
    for (let j = 0; j + 1 < t.length; j++) {
      if (!isName(t[j], "as")) continue;
      if (isName(t[j + 1])) out.add(t[j + 1]!.v);
      else if (isOp(t[j + 1], "(")) {
        let d = 0;
        let q = j + 1;
        const inner: Tok[] = [];
        for (; q < t.length; q++) {
          if (isOp(t[q], "(")) d++;
          if (isOp(t[q], ")") && --d === 0) break;
          if (q > j + 1) inner.push(t[q]!);
        }
        namesIn(inner);
      }
    }
  }
  // The walrus binds in the enclosing function.
  for (let j = 1; j < t.length; j++) if (isOp(t[j], ":=") && isName(t[j - 1])) out.add(t[j - 1]!.v);
  return out;
}

export function parsePyFile(text: string): ParsedFile {
  const out: ParsedFile = { symbols: [], imports: [], calls: [], exportedLocals: [], notes: [] };
  const { lines: physical, problem } = scan(text);
  const lines = splitStatements(physical);
  if (problem) out.notes.push(`the Python reader stopped early: ${problem}; what came before it was read`);
  const lastLine = (l: Logical) => {
    const t = l.toks[l.toks.length - 1]!;
    return t.line + (text.slice(t.start, t.end).split("\n").length - 1);
  };
  /** The last line of the block opened by lines[idx] (lines after it with a deeper indent). */
  const blockEnd = (idx: number): number => {
    const base = lines[idx]!.indent;
    let end = lastLine(lines[idx]!);
    for (let j = idx + 1; j < lines.length && lines[j]!.indent > base; j++) end = lastLine(lines[j]!);
    return end;
  };
  let all: string[] | null = null;

  let decoratorStart: number | null = null;
  /** The top-level class whose body we are in, and its body's indent. */
  let cls: { name: string; idx: number; bodyIndent: number | null } | null = null;

  lines.forEach((l, idx) => {
    const t = l.toks;
    if (t.length === 0) return;
    if (l.indent === 0) cls = null;
    // Imports (at any indent: inside try/except, functions, `if TYPE_CHECKING:`).
    if (isName(t[0], "import") || (isName(t[0], "from") && !isOp(t[1], "("))) {
      out.imports.push(...parseImport(l));
    }
    if (isOp(t[0], "@")) {
      if (decoratorStart === null) decoratorStart = t[0]!.line;
      return;
    }
    const k = isName(t[0], "async") && isName(t[1], "def") ? 1 : 0;
    const isDef = isName(t[k], "def") && isName(t[k + 1]);
    const isClass = isName(t[0], "class") && isName(t[1]);
    const start = decoratorStart ?? t[0]!.line;
    decoratorStart = null;
    if (l.indent === 0) {
      if (isDef) {
        const name = t[k + 1]!.v;
        out.symbols.push({ name, kind: "function", exported: !name.startsWith("_"), lineStart: start, lineEnd: blockEnd(idx), ...defHeader(text, t, k) });
      } else if (isClass) {
        const name = t[1]!.v;
        const colon = t.findIndex((x, j) => j > 1 && isOp(x, ":"));
        const header = colon > 0 ? squash(text.slice(t[0]!.start, t[colon - 1]!.end)) : name;
        out.symbols.push({ name, kind: "class", exported: !name.startsWith("_"), lineStart: start, lineEnd: blockEnd(idx), signature: cap(header) });
        cls = { name, idx, bodyIndent: null };
      } else if (isName(t[0]) && !KEYWORDS.has(t[0]!.v) && (isOp(t[1], "=") || isOp(t[1], ":"))) {
        const name = t[0]!.v;
        const a = allNames(l);
        if (a) all = a;
        if (!out.symbols.some((s) => s.name === name && s.parent === undefined)) {
          out.symbols.push({ name, kind: "variable", exported: !name.startsWith("_"), lineStart: t[0]!.line, lineEnd: lastLine(l) });
        }
      }
    } else if (cls) {
      const c = cls as { name: string; idx: number; bodyIndent: number | null };
      if (c.bodyIndent === null) c.bodyIndent = l.indent;
      if (l.indent === c.bodyIndent && isDef) {
        const name = t[k + 1]!.v;
        out.symbols.push({ name, kind: "function", exported: !c.name.startsWith("_"), parent: c.name, lineStart: start, lineEnd: blockEnd(idx), ...defHeader(text, t, k) });
      }
    }
  });
  if (all) {
    const listed = new Set<string>(all);
    for (const s of out.symbols) if (s.parent === undefined) s.exported = listed.has(s.name);
  }

  // ---- scopes (review round 2, M3) ----
  // Each `def` (any depth) is a scope: its parameters and the names its body binds (`x = …`, `for x in`, `with … as
  // x`, `except … as x`, inner def/class). An import INSIDE a def binds only within that def. A name used inside a
  // def that the def binds itself is not the module's import.
  interface Scope {
    from: number;
    to: number;
    names: Set<string>;
  }
  const scopes: Scope[] = [];
  lines.forEach((l, idx) => {
    const t = l.toks;
    const k = isName(t[0], "async") && isName(t[1], "def") ? 1 : 0;
    if (!(isName(t[k], "def") && isName(t[k + 1]) && isOp(t[k + 2], "("))) return;
    const names = new Set<string>();
    let d = 0;
    let close = t.length;
    for (let j = k + 2; j < t.length; j++) {
      if (t[j]!.t === "op" && "([{".includes(t[j]!.v)) d++;
      if (t[j]!.t === "op" && ")]}".includes(t[j]!.v) && --d === 0) {
        close = j;
        break;
      }
    }
    for (const part of splitTopCommas(t.slice(k + 3, close))) {
      const n = part.find((x) => x.t === "name");
      if (n) names.add(n.v);
    }
    const base = l.indent;
    let end = lastLine(l);
    const globals = new Set<string>();
    for (let j = idx + 1; j < lines.length && lines[j]!.indent > base; j++) {
      const b = lines[j]!.toks;
      end = lastLine(lines[j]!);
      if (isName(b[0], "global") || isName(b[0], "nonlocal")) for (const x of b.slice(1)) if (x.t === "name") globals.add(x.v);
      for (const n of boundNames(b)) names.add(n);
    }
    for (const g of globals) names.delete(g);
    scopes.push({ from: t[0]!.line, to: end, names });
  });
  // Review round 3 (R3-M1): a class body binds names for its own direct statements only (not inside its methods).
  interface ClassScope {
    lines: Set<number>;
    names: Set<string>;
  }
  const classScopes: ClassScope[] = [];
  lines.forEach((l, idx) => {
    const t = l.toks;
    if (!(isName(t[0], "class") && isName(t[1]))) return;
    const base = l.indent;
    let bodyIndent: number | null = null;
    const sc: ClassScope = { lines: new Set(), names: new Set() };
    for (let j = idx + 1; j < lines.length && lines[j]!.indent > base; j++) {
      const b = lines[j]!;
      if (bodyIndent === null) bodyIndent = b.indent;
      if (b.indent !== bodyIndent) continue;
      for (let n = b.toks[0]!.line; n <= lastLine(b); n++) sc.lines.add(n);
      for (const n of boundNames(b.toks)) sc.names.add(n);
    }
    classScopes.push(sc);
  });
  /** The innermost def scope holding a line (null = module level). */
  const scopeAt = (line: number): Scope | null => {
    let best: Scope | null = null;
    for (const sc of scopes) if (sc.from <= line && line <= sc.to && (!best || sc.from >= best.from)) best = sc;
    return best;
  };
  const importScope = out.imports.map((imp) => scopeAt(imp.line));
  /** Names the module defines at top level (def, class, assignment): an import of the same name is then unsure. */
  const topDefined = new Set(out.symbols.filter((s) => s.parent === undefined).map((s) => s.name));
  // Review round 3 (R3-M1): every name a module-level statement binds (tuple unpacking, for, with, := …) is unsure too.
  const topRebound = new Set<string>();
  for (const l of lines) if (scopeAt(l.toks[0]!.line) === null && !classScopes.some((c) => c.lines.has(l.toks[0]!.line)) && !isName(l.toks[0], "def") && !isName(l.toks[0], "class") && !isName(l.toks[1], "def")) for (const n of boundNames(l.toks)) topRebound.add(n);
  for (const n of topRebound) topDefined.add(n);
  const ownCallable = new Set(out.symbols.filter((s) => s.parent === undefined && (s.kind === "function" || s.kind === "class")).map((s) => s.name));

  /** The import (or own definition) a dotted name used at `line` refers to, or null (shadowed, unsure, unknown). */
  const resolveChain = (parts: string[], line: number, lineLocals: Set<string>): { imp: number; local: string; member: string } | { own: true; local: string; member: string } | null => {
    const first = parts[0]!;
    if (lineLocals.has(first)) return null; // a lambda parameter or comprehension variable on this line
    if (classScopes.some((c) => c.lines.has(line) && c.names.has(first))) return null; // a class-body name
    const findImport = (scope: Scope | null) => {
      for (let p = parts.length; p >= 1; p--) {
        const local = parts.slice(0, p).join(".");
        const i = out.imports.findIndex((imp, k) => importScope[k] === scope && imp.kind !== "dynamic" && imp.names.some((n) => n.local === local));
        if (i >= 0) return { imp: i, local, member: parts.slice(p).join(".") };
      }
      return null;
    };
    // From the innermost def outwards: a def's own import wins; a name the def binds itself hides the outer one.
    const enclosing = scopes.filter((sc) => sc.from <= line && line <= sc.to).sort((x, y) => y.from - x.from);
    for (const sc of enclosing) {
      const hit = findImport(sc);
      if (hit) return hit;
      if (sc.names.has(first)) return null;
    }
    const mod = findImport(null);
    if (mod) return topDefined.has(first) ? null : mod; // redefined at module level: plain code cannot tell which one runs
    // A module-level def/class whose name a module-level statement also rebinds (`for f in …`, `f = …`) is unsure.
    if (ownCallable.has(first) && !topRebound.has(first)) return { own: true, local: first, member: parts.slice(1).join(".") };
    return null;
  };

  /** Names a line binds for itself: lambda parameters and comprehension variables (`for x in` inside brackets). */
  const lineLocalsOf = (t: Tok[]): Set<string> => {
    const out = new Set<string>();
    let d = 0;
    for (let j = 0; j < t.length; j++) {
      const x = t[j]!;
      if (x.t === "op" && "([{".includes(x.v)) d++;
      if (x.t === "op" && ")]}".includes(x.v)) d--;
      if (isName(x, "lambda")) for (let q = j + 1; q < t.length && !isOp(t[q], ":"); q++) if (isName(t[q])) out.add(t[q]!.v);
      if (d > 0 && isName(x, "for")) for (let q = j + 1; q < t.length && !isName(t[q], "in"); q++) if (isName(t[q])) out.add(t[q]!.v);
    }
    return out;
  };

  // ---- every use of an imported name or a top-level def/class ----
  for (const l of lines) {
    const t = l.toks;
    if (isName(t[0], "import") || (isName(t[0], "from") && !isOp(t[1], "("))) continue;
    // An `import` keyword anywhere else is an import form plain code did not read (review round 3, R3-B1).
    const stray = t.findIndex((x, j) => j > 0 && isName(x, "import") && !isName(t[0], "from"));
    if (stray >= 0) out.notes.push(`line ${t[stray]!.line} holds an import plain code did not read`);
    const lineLocals = lineLocalsOf(t);
    const isClassLine = isName(t[0], "class") && isName(t[1]) && isOp(t[2], "(");
    let classClose = -1;
    if (isClassLine) {
      let d = 0;
      for (let j = 2; j < t.length; j++) {
        if (t[j]!.t === "op" && "([{".includes(t[j]!.v)) d++;
        if (t[j]!.t === "op" && ")]}".includes(t[j]!.v) && --d === 0) {
          classClose = j;
          break;
        }
      }
    }
    // Type annotations (`x: T = …`, `def f(a: T) -> R:`) are types, not uses: skipped, as TypeScript types are.
    const inAnn = new Array<boolean>(t.length).fill(false);
    {
      const k = isName(t[0], "async") && isName(t[1], "def") ? 1 : 0;
      if (isName(t[k], "def") && isOp(t[k + 2], "(")) {
        let d = 0;
        let ann = false;
        for (let j = k + 2; j < t.length; j++) {
          const x = t[j]!;
          if (x.t === "op" && "([{".includes(x.v)) d++;
          if (x.t === "op" && ")]}".includes(x.v)) d--;
          if (d === 1 && isOp(x, ":")) ann = true;
          else if (d === 1 && (isOp(x, ",") || isOp(x, "="))) ann = false;
          else if (d === 0 && isOp(x, "->")) ann = true;
          else if (d === 0 && isOp(x, ":")) ann = false;
          else if (d === 0 && isOp(x, ")")) ann = false;
          inAnn[j] = ann && x.t === "name";
        }
      } else if (isName(t[0]) && !KEYWORDS.has(t[0]!.v) && isOp(t[1], ":")) {
        let d = 0;
        for (let j = 2; j < t.length; j++) {
          const x = t[j]!;
          if (x.t === "op" && "([{".includes(x.v)) d++;
          if (x.t === "op" && ")]}".includes(x.v)) d--;
          if (d === 0 && isOp(x, "=")) break;
          inAnn[j] = true;
        }
      }
    }
    let depth = 0;
    for (let j = 0; j < t.length; j++) {
      const tok = t[j]!;
      if (tok.t === "op" && "([{".includes(tok.v)) depth++;
      if (tok.t === "op" && ")]}".includes(tok.v)) depth--;
      if (inAnn[j]) continue;
      if (tok.t !== "name" || KEYWORDS.has(tok.v) || isOp(t[j - 1], ".") || isName(t[j - 1], "def") || isName(t[j - 1], "class")) continue;
      const d = dotted(t, j);
      if (!d) continue;
      const next = t[d.next];
      // `name=` inside a call is a keyword argument; `name = …` at the start of a statement is a binding, not a use.
      if (isOp(next, "=") && (j === 0 || (depth > 0 && (isOp(t[j - 1], "(") || isOp(t[j - 1], ","))))) {
        j = d.next - 1;
        continue;
      }
      // Review round 3 (R3-B1): any module loader, however it was imported, is a dynamic import plain code does not follow.
      if (isOp(next, "(") && DYNAMIC_LOADERS.has(d.name.split(".").pop()!)) {
        const arg = t[d.next + 1];
        const lit = arg?.t === "str" && isOp(t[d.next + 2], ")") ? /^[rRuU]?(['"])(.*)\1$/.exec(arg.v)?.[2] : undefined;
        out.imports.push({ line: tok.line, specifier: lit ?? "<computed>", kind: "dynamic", names: [], ...(lit === undefined ? { computed: true } : {}) });
        importScope.push(scopeAt(tok.line));
        j = d.next - 1;
        continue;
      }
      const r = resolveChain(d.name.split("."), tok.line, lineLocals);
      if (r) {
        const form: RawCall["form"] = isClassLine && j > 2 && j < classClose ? "extends" : isOp(t[0], "@") && j === 1 ? "call" : isOp(next, "(") ? "call" : "ref";
        const use: RawCall = { line: tok.line, local: r.local, ...(r.member ? { member: r.member } : {}), form, ...("imp" in r ? { imp: r.imp } : { own: true as const }) };
        out.calls.push(use);
      }
      j = d.next - 1;
    }
  }
  out.symbols.sort((a, b) => a.lineStart - b.lineStart || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out as ParsedFile & { symbols: Omit<CodeSymbol, "id">[] };
}
