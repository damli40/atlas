// Pasted Python, read by plain code: the top-level functions a person can pick, and every import.
//
// Plain words:
// - `scanPySource` reads the text with a small tokenizer (no model, no Python, no evaluation). It understands
//   comments, every string form (quotes, triple quotes, r/b/u/f/t prefixes, f-strings with nested expressions),
//   brackets (a line continues while a bracket is open) and backslash line joins, so words inside strings and
//   comments are never mistaken for code.
// - Top-level functions: a logical line that starts at column 0 with `def NAME` or `async def NAME`. Methods,
//   functions nested in other blocks and lambdas are not listed.
// - Imports: `import a.b, c`, `from x import y`, relative imports (`from . import y`), `__import__("x")` and
//   `importlib.import_module("x")`. A module outside Python's standard library means "needs package X".
// - This scan gives an early, plain refusal and the function list. It is NOT the security boundary: the harness
//   refuses every import outside the standard library at run time (runners/py/harness.py), so a form this scan
//   misreads is still refused when the code runs. Text it cannot read is left to Python, which reports the
//   SyntaxError in its own words.
//
// No I/O, no clock, no model. Safe to load in the browser.

import type { FoundExport } from "./pasted-code";
import { PY_NAMED_AT_RUN_TIME, PY_RELATIVE_IMPORT, PY_STDLIB_MODULES, pyNeedsPackageReason } from "../runners/py/py-words.ts";

const STDLIB = new Set(PY_STDLIB_MODULES);

type PyTok =
  | { t: "name"; v: string; line: number; start: boolean; indent: number }
  | { t: "str"; v: string; line: number; start: boolean; indent: number }
  | { t: "op"; v: string; line: number; start: boolean; indent: number }
  | { t: "num"; line: number; start: boolean; indent: number };

export interface PyImport {
  /** The module as written ("a.b"), "a module next to this file (a relative import)", or "a module named at run time". */
  module: string;
  line: number;
  form: "import" | "from ... import" | "__import__()" | "import_module()";
}

export interface PyScanResult {
  exports: FoundExport[];
  imports: PyImport[];
  /** Set when the tokenizer could not read the text (an unclosed string or bracket). */
  problem?: string;
}

const isNameStart = (c: string) => /[A-Za-z_ª-￿]/.test(c);
const isNamePart = (c: string) => /[\wª-￿]/.test(c);
const STRING_PREFIX = /^(?:[rRbBuUfFtT]{1,2})$/;

function tokenizePy(src: string): { toks: PyTok[]; problem?: string } {
  const toks: PyTok[] = [];
  let i = 0;
  let line = 1;
  let depth = 0; // open brackets: newlines inside them do not end the logical line
  let atStart = true;
  let indent = 0;
  let problem: string | undefined;

  type Bare = { t: "name" | "str" | "op"; v: string; line: number } | { t: "num"; line: number };
  const push = (tok: Bare) => {
    toks.push({ ...tok, start: atStart, indent } as PyTok);
    atStart = false;
  };

  /** Skips a string literal whose opening quote is at i; returns its text (escapes left as written). */
  const readString = (prefix: string): string | null => {
    const q = src[i]!;
    const triple = src.startsWith(q.repeat(3), i);
    const close = triple ? q.repeat(3) : q;
    const fmt = /[fFtT]/.test(prefix);
    i += close.length;
    let out = "";
    while (i < src.length) {
      const c = src[i]!;
      if (src.startsWith(close, i)) {
        i += close.length;
        return out;
      }
      if (c === "\\") {
        if (src[i + 1] === "\n") line++;
        out += c + (src[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (c === "\n") {
        if (!triple) return null; // a one-line string cannot cross a line
        line++;
      }
      if (fmt && c === "{") {
        if (src[i + 1] === "{") {
          out += "{{";
          i += 2;
          continue;
        }
        // An f-string expression: skip to its matching "}", stepping over nested strings.
        let d = 1;
        i++;
        while (i < src.length && d > 0) {
          const e = src[i]!;
          if (e === "\n") line++;
          if (e === "'" || e === '"') {
            if (readString("f") === null) return null;
            continue;
          }
          if (e === "{" || e === "(" || e === "[") d++;
          else if (e === "}" || e === ")" || e === "]") d--;
          i++;
        }
        if (d > 0) return null;
        continue;
      }
      out += c;
      i++;
    }
    return null;
  };

  while (i < src.length && problem === undefined) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      if (depth === 0) {
        atStart = true;
        indent = 0;
      }
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      line++;
      i += 2;
      continue; // an explicit line join: the logical line goes on
    }
    if (c === " " || c === "\t" || c === "\f" || c === "\r") {
      if (atStart && depth === 0) indent += c === "\t" ? 8 - (indent % 8) : 1;
      i++;
      continue;
    }
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const startLine = line;
      const s = readString("");
      if (s === null) problem = `a string that starts on line ${startLine} is never closed`;
      else push({ t: "str", v: s, line: startLine });
      continue;
    }
    if (isNameStart(c)) {
      let j = i + 1;
      while (j < src.length && isNamePart(src[j]!)) j++;
      const word = src.slice(i, j);
      if ((src[j] === "'" || src[j] === '"') && STRING_PREFIX.test(word)) {
        const startLine = line;
        i = j;
        const s = readString(word);
        if (s === null) problem = `a string that starts on line ${startLine} is never closed`;
        else push({ t: "str", v: s, line: startLine });
        continue;
      }
      push({ t: "name", v: word, line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j]!)) {
        if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")) j++;
        j++;
      }
      push({ t: "num", line });
      i = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c === ";" && depth === 0) {
      push({ t: "op", v: c, line });
      atStart = true; // a new statement starts after ";" (same indentation)
      i++;
      continue;
    }
    push({ t: "op", v: c, line });
    i++;
  }
  if (problem === undefined && depth > 0) problem = "a bracket is never closed";
  return problem === undefined ? { toks } : { toks, problem };
}

/** Reads the file's top-level functions and imports by plain code (see the top of this file for what this is not). */
export function scanPySource(source: string): PyScanResult {
  const { toks, problem } = tokenizePy(source);
  const exports: FoundExport[] = [];
  const imports: PyImport[] = [];
  const at = (k: number) => toks[k];
  const isOp = (k: number, v: string) => at(k)?.t === "op" && (at(k) as { v: string }).v === v;
  const isName = (k: number, v?: string) => at(k)?.t === "name" && (v === undefined || (at(k) as { v: string }).v === v);
  const nameOf = (k: number) => (at(k)?.t === "name" ? (at(k) as { v: string }).v : undefined);
  /** A dotted name starting at k: ["a.b.c", index after it]. */
  const dotted = (k: number): [string | undefined, number] => {
    let name = nameOf(k);
    if (name === undefined) return [undefined, k];
    let j = k + 1;
    while (isOp(j, ".") && nameOf(j + 1) !== undefined) {
      name += `.${nameOf(j + 1)!}`;
      j += 2;
    }
    return [name, j];
  };

  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t !== "name") continue;
    const prevDot = isOp(k - 1, ".");
    if (tok.start && tok.indent === 0) {
      if (tok.v === "def" && nameOf(k + 1)) {
        if (!exports.some((e) => e.name === nameOf(k + 1))) exports.push({ name: nameOf(k + 1)!, line: tok.line, declaredAs: "function" });
      } else if (tok.v === "async" && isName(k + 1, "def") && nameOf(k + 2)) {
        if (!exports.some((e) => e.name === nameOf(k + 2))) exports.push({ name: nameOf(k + 2)!, line: tok.line, declaredAs: "function" });
      }
    }
    if (tok.start && tok.v === "import") {
      let j = k + 1;
      for (;;) {
        const [mod, after] = dotted(j);
        imports.push({ module: mod ?? PY_NAMED_AT_RUN_TIME, line: tok.line, form: "import" });
        j = after;
        if (isName(j, "as")) j += 2;
        if (!isOp(j, ",")) break;
        j++;
      }
      continue;
    }
    if (tok.start && tok.v === "from") {
      let j = k + 1;
      let dots = 0;
      while (isOp(j, ".")) {
        dots++;
        j++;
      }
      const [mod] = dotted(j);
      if (dots > 0) imports.push({ module: PY_RELATIVE_IMPORT, line: tok.line, form: "from ... import" });
      else imports.push({ module: mod ?? PY_NAMED_AT_RUN_TIME, line: tok.line, form: "from ... import" });
      continue;
    }
    if (!prevDot && tok.v === "__import__" && isOp(k + 1, "(")) {
      const s = at(k + 2);
      imports.push({ module: s?.t === "str" && (isOp(k + 3, ")") || isOp(k + 3, ",")) ? s.v : PY_NAMED_AT_RUN_TIME, line: tok.line, form: "__import__()" });
      continue;
    }
    if (tok.v === "import_module" && isOp(k + 1, "(")) {
      const s = at(k + 2);
      imports.push({ module: s?.t === "str" && (isOp(k + 3, ")") || isOp(k + 3, ",")) ? s.v : PY_NAMED_AT_RUN_TIME, line: tok.line, form: "import_module()" });
    }
  }
  return problem === undefined ? { exports, imports } : { exports, imports, problem };
}

/** True when `module` (or its top-level package) is in Python's standard library. */
export function isPyStdlib(module: string): boolean {
  if (module === PY_RELATIVE_IMPORT || module === PY_NAMED_AT_RUN_TIME) return false;
  return STDLIB.has(module.split(".")[0]!);
}

/** The top-level functions a person can pick, in file order, with their lines. */
export function pyTopLevelFunctions(source: string): FoundExport[] {
  return scanPySource(source).exports;
}

/**
 * Why plain code refuses to run this Python file at all, before any sandbox starts (null when nothing was
 * found). The harness refuses the same things again at run time, whatever this scan missed.
 */
export function staticRefusalPy(source: string): string | null {
  const scan = scanPySource(source);
  // Text this scan cannot read (an unclosed string or bracket) is NOT refused here: Python itself then reports
  // the exact SyntaxError in its own words (the spec's rule), and every import is refused at run time anyway.
  const outside = scan.imports.find((imp) => !isPyStdlib(imp.module));
  if (outside) return pyNeedsPackageReason(outside.module);
  return null;
}
