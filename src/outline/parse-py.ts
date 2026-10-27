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
      return [{ line, specifier: d.name, kind: "static" as const, names: [{ imported: "*", local: alias ?? d.name }] }];
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

export function parsePyFile(text: string): ParsedFile {
  const out: ParsedFile = { symbols: [], imports: [], calls: [], exportedLocals: [], notes: [] };
  const { lines, problem } = scan(text);
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

  // Review minor 1: names each function declares for itself (parameters, `x = ...`, `for x in`, `with ... as x`,
  // `except E as x`, inner def/class). A call of such a name inside that function is not a call of the import.
  const scopes: { from: number; to: number; names: Set<string> }[] = [];
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
    for (let j = idx + 1; j < lines.length && lines[j]!.indent > base; j++) {
      const b = lines[j]!.toks;
      end = lastLine(lines[j]!);
      if (isName(b[0]) && !KEYWORDS.has(b[0]!.v) && (isOp(b[1], "=") || isOp(b[1], ":") || isOp(b[1], ","))) names.add(b[0]!.v);
      if ((isName(b[0], "def") || isName(b[0], "class")) && isName(b[1])) names.add(b[1]!.v);
      if (isName(b[0], "for")) for (let q = 1; q < b.length && !isName(b[q], "in"); q++) if (isName(b[q])) names.add(b[q]!.v);
      for (let q = 0; q + 1 < b.length; q++) if (isName(b[q], "as") && isName(b[q + 1]) && !(isName(b[0], "import") || isName(b[0], "from"))) names.add(b[q + 1]!.v);
    }
    scopes.push({ from: t[0]!.line, to: end, names });
  });
  const shadowed = (local: string, line: number) => scopes.some((sc) => sc.from <= line && line <= sc.to && sc.names.has(local.split(".")[0]!));

  // Calls of imported names: `f(` where f was imported by name, or `m.f(` / `pkg.mod.f(` through a module import.
  const bound = new Map<string, true>();
  for (const i of out.imports) for (const n of i.names) if (n.local !== "*") bound.set(n.local, true);
  // importlib.import_module("x") / __import__("x"): dynamic imports, never followed.
  for (const l of lines) {
    const t = l.toks;
    for (let j = 0; j < t.length; j++) {
      const tok = t[j]!;
      if (tok.t !== "name" || isOp(t[j - 1], ".") || isName(t[j - 1], "def") || isName(t[j - 1], "class")) continue;
      const d = dotted(t, j);
      if (!d) continue;
      if (isOp(t[d.next], "(")) {
        if (d.name === "importlib.import_module" || d.name === "__import__") {
          const arg = t[d.next + 1];
          const lit = arg?.t === "str" && isOp(t[d.next + 2], ")") ? /^[rRuU]?(['"])(.*)\1$/.exec(arg.v)?.[2] : undefined;
          out.imports.push({ line: tok.line, specifier: lit ?? "<computed>", kind: "dynamic", names: [], ...(lit === undefined ? { computed: true } : {}) });
        } else {
          // Longest bound prefix: "pkg.mod.f" with "pkg.mod" bound → local "pkg.mod", member "f".
          const parts = d.name.split(".");
          for (let p = parts.length; p >= 1; p--) {
            const local = parts.slice(0, p).join(".");
            if (!bound.has(local)) continue;
            if (shadowed(local, tok.line)) break;
            const member = parts.slice(p).join(".");
            const call: RawCall = { line: tok.line, local, ...(member ? { member } : {}), form: "call" };
            out.calls.push(call);
            break;
          }
        }
      }
      j = d.next - 1;
    }
  }
  out.symbols.sort((a, b) => a.lineStart - b.lineStart || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out as ParsedFile & { symbols: Omit<CodeSymbol, "id">[] };
}
