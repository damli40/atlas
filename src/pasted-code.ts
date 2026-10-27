// Pasted code: the target a person pastes (one JavaScript or TypeScript file), read by plain code.
//
// Plain words:
// - A pasted target is named by its fingerprint: `pasted:<first 12 hex of its SHA-256>`. The source travels
//   with the target (it is needed to replay the run and to check a proof file), so its size is capped.
// - `scanJsSource` reads the text with a small tokenizer (no model, no evaluation). It finds:
//   - the functions the file exports, with their line numbers (the paste screen lists them);
//   - every place the file loads other code: `import ... from "x"`, `import("x")`, `require("x")`,
//     `export ... from "x"`. Atlas runs one file on its own, so any of these means "needs package X";
//   - CommonJS exports (`module.exports`, `exports.x`): Atlas runs the file as an ES module, where those
//     do not exist.
// - This scan is for an early, plain refusal and for the export list. It is NOT the security boundary: the
//   sandbox worker (runners/ts/call-worker.ts) refuses every import at run time through Node's module hooks,
//   so a form this tokenizer misreads is still refused when the code runs. When the tokenizer is unsure it
//   errs towards refusing (more "can't check"), never towards running.
//
// No I/O, no clock, no model. Safe to load in the browser.

import { sha256Hex } from "./seal";
import type { Target } from "./types";
import { COMMONJS_REASON, NAMED_AT_RUN_TIME, describeModule, needsPackageReason } from "../runners/ts/call-words.ts";

export { COMMONJS_REASON, describeModule, needsPackageReason };

/** One file, at most this many bytes (UTF-8). */
export const PASTED_MAX_BYTES = 64 * 1024;
export type PastedLanguage = "js" | "ts" | "py";
export const PASTED_LANGUAGES: readonly PastedLanguage[] = ["js", "ts", "py"];

/** UTF-8 length without TextEncoder allocation surprises (same answer as Buffer.byteLength). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** The ref a pasted target must carry: "pasted:" + the first 12 hex characters of its SHA-256. */
export const pastedRef = (codeSha256: string) => `pasted:${codeSha256.slice(0, 12)}`;

/**
 * A pasted target from source text. Throws with a plain reason when the text cannot be a target: empty,
 * over PASTED_MAX_BYTES, or an unknown language.
 */
export function makePastedTarget(source: string, language: PastedLanguage): Target {
  if (typeof source !== "string" || source.trim() === "") throw new Error("the pasted code is empty");
  if (!PASTED_LANGUAGES.includes(language)) throw new Error(`language must be one of ${PASTED_LANGUAGES.join(", ")}`);
  const bytes = utf8Bytes(source);
  if (bytes > PASTED_MAX_BYTES) throw new Error(`the pasted code is ${bytes} bytes; the limit is ${PASTED_MAX_BYTES} (one file)`);
  const codeSha256 = sha256Hex(source);
  return { kind: "pasted", ref: pastedRef(codeSha256), codeSha256, language, source };
}

/** Plain problems with a pasted target as stored (empty when it is consistent). Used by proof-file verify. */
export function pastedTargetProblems(t: Pick<Target, "kind" | "ref" | "codeSha256" | "language" | "source">): string[] {
  if (t.kind !== "pasted") return [];
  const out: string[] = [];
  if (typeof t.source !== "string") return ["a pasted target must carry its source"];
  if (t.language === undefined || !PASTED_LANGUAGES.includes(t.language)) out.push("a pasted target must name its language (js, ts or py)");
  if (utf8Bytes(t.source) > PASTED_MAX_BYTES) out.push(`the pasted source is over ${PASTED_MAX_BYTES} bytes`);
  const sha = sha256Hex(t.source);
  if (sha !== t.codeSha256) out.push(`the pasted source hashes to ${sha.slice(0, 12)}…, not the target's ${t.codeSha256.slice(0, 12)}…`);
  if (t.ref !== pastedRef(t.codeSha256)) out.push(`a pasted target's ref must be ${pastedRef(t.codeSha256)}`);
  return out;
}

// ---------- the tokenizer ----------

type Tok =
  | { t: "id"; v: string; line: number }
  | { t: "str"; v: string; line: number }
  | { t: "tpl"; line: number }
  | { t: "num"; line: number }
  | { t: "re"; line: number }
  | { t: "p"; v: string; line: number };

/** Keywords after which a "/" starts a regular expression, not a division. */
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "extends"]);
const isIdStart = (c: string) => /[A-Za-z_$\u00A0-\uFFFF]/.test(c);
const isIdPart = (c: string) => /[\w$\u00A0-\uFFFF]/.test(c);

/** Reasons the tokenizer could not read the text as code (an unclosed string or comment). */
export interface TokenizeResult {
  toks: Tok[];
  problem?: string;
}

function tokenize(src: string): TokenizeResult {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  // Each open template literal records the brace depth at which its `${` was opened.
  const tplStack: number[] = [];
  let braceDepth = 0;
  const prevSignificant = (): Tok | undefined => toks[toks.length - 1];
  const regexAllowed = (): boolean => {
    const p = prevSignificant();
    if (!p) return true;
    if (p.t === "num" || p.t === "str" || p.t === "tpl" || p.t === "re") return false;
    if (p.t === "id") return REGEX_AFTER_WORDS.has(p.v);
    // After ")" "]" "}" a "/" is most often a division. "}" can also end a block; reading it as a
    // division is the safer error: a regex read as code can only make the scan see MORE tokens.
    return !(p.v === ")" || p.v === "]" || p.v === "}");
  };
  const readString = (q: string): string | null => {
    let out = "";
    i++;
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        const n = src[i + 1];
        if (n === "\n") line++;
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === q) {
        i++;
        return out;
      }
      if (c === "\n") return null; // a plain string cannot cross a line
      out += c;
      i++;
    }
    return null;
  };
  /** Reads template text up to the closing backtick (returns "end") or a "${" (returns "expr"). */
  const readTemplateChunk = (): "end" | "expr" | null => {
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        if (src[i + 1] === "\n") line++;
        i += 2;
        continue;
      }
      if (c === "`") {
        i++;
        return "end";
      }
      if (c === "$" && src[i + 1] === "{") {
        i += 2;
        return "expr";
      }
      if (c === "\n") line++;
      i++;
    }
    return null;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "\u00A0" || c === "\uFEFF") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return { toks, problem: `a /* comment that starts on line ${line} is never closed` };
      for (let k = i; k < end; k++) if (src[k] === "\n") line++;
      i = end + 2;
      continue;
    }
    if (c === "#" && i === 0 && src[1] === "!") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const startLine = line;
      const s = readString(c);
      if (s === null) return { toks, problem: `a string that starts on line ${startLine} is never closed` };
      toks.push({ t: "str", v: s, line: startLine });
      continue;
    }
    if (c === "`") {
      const startLine = line;
      i++;
      const r = readTemplateChunk();
      if (r === null) return { toks, problem: `a template string that starts on line ${startLine} is never closed` };
      toks.push({ t: "tpl", line: startLine });
      if (r === "expr") {
        tplStack.push(braceDepth);
        braceDepth++;
      }
      continue;
    }
    if (c === "}" && tplStack.length > 0 && tplStack[tplStack.length - 1] === braceDepth - 1) {
      // The end of a "${ ... }" inside a template: continue reading the template text.
      tplStack.pop();
      braceDepth--;
      i++;
      const startLine = line;
      const r = readTemplateChunk();
      if (r === null) return { toks, problem: `a template string around line ${startLine} is never closed` };
      toks.push({ t: "tpl", line: startLine });
      if (r === "expr") {
        tplStack.push(braceDepth);
        braceDepth++;
      }
      continue;
    }
    if (c === "/" && regexAllowed()) {
      const startLine = line;
      let k = i + 1;
      let inClass = false;
      let closed = false;
      while (k < src.length) {
        const d = src[k]!;
        if (d === "\n") break;
        if (d === "\\") {
          k += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        }
        k++;
      }
      if (!closed) return { toks, problem: `a regular expression on line ${startLine} is never closed` };
      k++;
      while (k < src.length && isIdPart(src[k]!)) k++;
      i = k;
      toks.push({ t: "re", line: startLine });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      i++;
      while (i < src.length && /[\w.]/.test(src[i]!)) {
        // exponent signs: 1e-7
        if ((src[i] === "e" || src[i] === "E") && (src[i + 1] === "+" || src[i + 1] === "-")) i++;
        i++;
      }
      toks.push({ t: "num", line });
      continue;
    }
    if (isIdStart(c) || c === "\\" || c === "#") {
      let k = i + 1;
      while (k < src.length && (isIdPart(src[k]!) || src[k] === "\\")) k++;
      toks.push({ t: "id", v: src.slice(i, k), line });
      i = k;
      continue;
    }
    // Punctuators: the multi-character ones that matter here are "...", "=>", "?." and the rest are single.
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    let v = c;
    if (three === "..." || three === "===" || three === "!==" || three === "**=" || three === "<<=" || three === ">>=" || three === "&&=" || three === "||=" || three === "??=") v = three;
    else if (["=>", "?.", "==", "!=", "<=", ">=", "&&", "||", "??", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"].includes(two)) v = two;
    if (v === "{") braceDepth++;
    if (v === "}") braceDepth--;
    toks.push({ t: "p", v, line });
    i += v.length;
  }
  if (tplStack.length > 0) return { toks, problem: "a template string is never closed" };
  return { toks };
}

// ---------- what the scan reports ----------

/** One export the file declares. `declaredAs` says how; only plain code wrote it. */
export interface FoundExport {
  name: string;
  /** 1-based line of the declaration (or of the `export { ... }` list). */
  line: number;
  /** "function": `export function` / `export async function` / `export default function`; "const"/"let"/"var": a variable
   *  (it may or may not hold a function; the run checks); "class": a class (calling it without `new` throws);
   *  "list": named in an `export { ... }` list. */
  declaredAs: "function" | "const" | "let" | "var" | "class" | "list";
}

/** One place the file loads other code. */
export interface FoundImport {
  /** The module name as written, or "a module named at run time" when it is not a plain string. */
  specifier: string;
  line: number;
  form: "import" | "dynamic import()" | "require()" | "export ... from";
}

export interface ScanResult {
  exports: FoundExport[];
  imports: FoundImport[];
  /** Line of the first CommonJS export (`module.exports` / `exports.x`), when there is one. */
  commonJsLine?: number;
  /** Set when the tokenizer could not read the text (an unclosed string or comment). */
  problem?: string;
}


/** Reads the file's exports and imports by plain code (see the top of this file for what this is not). */
export function scanJsSource(source: string): ScanResult {
  const { toks, problem } = tokenize(source);
  const exports: FoundExport[] = [];
  const imports: FoundImport[] = [];
  let commonJsLine: number | undefined;
  const at = (k: number): Tok | undefined => toks[k];
  const isP = (k: number, v: string) => at(k)?.t === "p" && (at(k) as { v: string }).v === v;
  const isId = (k: number, v?: string) => at(k)?.t === "id" && (v === undefined || (at(k) as { v: string }).v === v);
  const idOf = (k: number) => (at(k)?.t === "id" ? (at(k) as { v: string }).v : undefined);
  const propertyAccess = (k: number) => isP(k - 1, ".") || isP(k - 1, "?.");
  const addExport = (name: string, line: number, declaredAs: FoundExport["declaredAs"]) => {
    if (!exports.some((e) => e.name === name)) exports.push({ name, line, declaredAs });
  };
  /** The string after `from` at or after k (within the statement), for `import x from "y"`. */
  const fromSpecifier = (k: number): string => {
    for (let j = k; j < toks.length && j < k + 400; j++) {
      if (isP(j, ";")) break;
      if (isId(j, "from") && at(j + 1)?.t === "str") return (at(j + 1) as { v: string }).v;
    }
    return NAMED_AT_RUN_TIME;
  };

  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]!;
    if (tok.t !== "id" || propertyAccess(k)) continue;
    // An object key (`{ import: 1 }`) or a label is not a use of the word.
    if (isP(k + 1, ":") && (isP(k - 1, "{") || isP(k - 1, ","))) continue;

    if (tok.v === "import") {
      if (isP(k + 1, ".")) continue; // import.meta: the file's own URL, loads nothing
      if (isP(k + 1, "(")) {
        imports.push({ specifier: at(k + 2)?.t === "str" && isP(k + 3, ")") ? (at(k + 2) as { v: string }).v : NAMED_AT_RUN_TIME, line: tok.line, form: "dynamic import()" });
        continue;
      }
      // TypeScript `import type ... from "x"` is removed before the code runs: it loads nothing.
      if (isId(k + 1, "type") && !isP(k + 2, ",") && !isId(k + 2, "from") && !isP(k + 2, "=")) continue;
      if (at(k + 1)?.t === "str") {
        imports.push({ specifier: (at(k + 1) as { v: string }).v, line: tok.line, form: "import" });
        continue;
      }
      imports.push({ specifier: fromSpecifier(k + 1), line: tok.line, form: "import" });
      continue;
    }
    if (tok.v === "require" && isP(k + 1, "(")) {
      imports.push({ specifier: at(k + 2)?.t === "str" ? (at(k + 2) as { v: string }).v : NAMED_AT_RUN_TIME, line: tok.line, form: "require()" });
      continue;
    }
    if (tok.v === "module" && isP(k + 1, ".") && isId(k + 2, "exports")) {
      commonJsLine ??= tok.line;
      continue;
    }
    if (tok.v === "exports" && (isP(k + 1, ".") || isP(k + 1, "[") || isP(k + 1, "="))) {
      commonJsLine ??= tok.line;
      continue;
    }
    if (tok.v !== "export") continue;

    // ---- export forms ----
    let j = k + 1;
    if (isP(j, "*")) {
      imports.push({ specifier: fromSpecifier(j), line: tok.line, form: "export ... from" });
      continue;
    }
    if (isP(j, "{")) {
      // export { a, b as c } [from "x"]
      let end = j + 1;
      while (end < toks.length && !isP(end, "}")) end++;
      if (isId(end + 1, "from")) {
        imports.push({ specifier: at(end + 2)?.t === "str" ? (at(end + 2) as { v: string }).v : NAMED_AT_RUN_TIME, line: tok.line, form: "export ... from" });
        continue;
      }
      let m = j + 1;
      while (m < end) {
        if (isId(m, "type") && at(m + 1)?.t === "id" && !isP(m + 1, ",")) {
          // `export { type T }`: a type, nothing at run time
          m += 2;
          if (isId(m, "as")) m += 2;
          if (isP(m, ",")) m++;
          continue;
        }
        const local = idOf(m);
        if (local === undefined) {
          m++;
          continue;
        }
        let exported = local;
        if (isId(m + 1, "as")) {
          exported = idOf(m + 2) ?? (at(m + 2)?.t === "str" ? (at(m + 2) as { v: string }).v : local);
          m += 3;
        } else m += 1;
        if (isP(m, ",")) m++;
        addExport(exported, tok.line, "list");
      }
      k = end;
      continue;
    }
    if (isId(j, "type") || isId(j, "interface") || isId(j, "declare")) continue; // types: nothing at run time
    if (isId(j, "default")) {
      j++;
      if (isId(j, "async")) j++;
      if (isId(j, "function")) addExport("default", tok.line, "function");
      else if (isId(j, "class")) addExport("default", tok.line, "class");
      else addExport("default", tok.line, "const");
      continue;
    }
    if (isId(j, "async") && isId(j + 1, "function")) j++;
    if (isId(j, "function")) {
      if (isP(j + 1, "*")) j++;
      const name = idOf(j + 1);
      if (name) addExport(name, at(j + 1)!.line, "function");
      continue;
    }
    if (isId(j, "abstract") && isId(j + 1, "class")) j++;
    if (isId(j, "class")) {
      const name = idOf(j + 1);
      if (name) addExport(name, at(j + 1)!.line, "class");
      continue;
    }
    const kw = idOf(j);
    if (kw === "const" || kw === "let" || kw === "var") {
      // export const a = ..., b = ...;  Only simple names (no destructuring) are listed.
      let m = j + 1;
      let depth = 0;
      let expectName = true;
      // A TypeScript type annotation (`: Map<string, number>`) may hold commas; they do not start a new name.
      let inType = false;
      while (m < toks.length) {
        const tm = toks[m]!;
        if (tm.t === "p" && (tm.v === "(" || tm.v === "[" || tm.v === "{")) depth++;
        else if (tm.t === "p" && (tm.v === ")" || tm.v === "]" || tm.v === "}")) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && tm.t === "p" && tm.v === ";") break;
        else if (depth === 0 && tm.t === "p" && tm.v === ":" && !expectName) inType = true;
        else if (depth === 0 && tm.t === "p" && tm.v === "=") inType = false;
        else if (depth === 0 && tm.t === "p" && tm.v === "," && !inType) {
          expectName = true;
          m++;
          continue;
        } else if (depth === 0 && tm.t === "id" && (tm.v === "export" || tm.v === "function" || tm.v === "class") && m > j + 1 && toks[m - 1]!.line < tm.line && !isP(m - 1, "=")) break;
        if (expectName && depth === 0 && tm.t === "id") addExport(tm.v, tm.line, kw);
        expectName = false;
        m++;
      }
      continue;
    }
    // export enum / export namespace / anything else: not a function Atlas can call; the run reports it.
  }
  return { exports, imports, ...(commonJsLine !== undefined ? { commonJsLine } : {}), ...(problem ? { problem } : {}) };
}

/** The names a person can pick: every export the scan found, in file order, with its line. */
export function exportedFunctions(source: string): FoundExport[] {
  return scanJsSource(source).exports;
}

/**
 * Why plain code refuses to run this JS/TS file at all, before any sandbox starts (null when nothing was
 * found). The run-time hooks in the sandbox refuse the same things again, whatever this scan missed.
 */
export function staticRefusal(source: string): string | null {
  const scan = scanJsSource(source);
  if (scan.problem) return `Atlas could not read the code: ${scan.problem}`;
  const first = scan.imports[0];
  if (first) return needsPackageReason(first.specifier);
  if (scan.commonJsLine !== undefined) return COMMONJS_REASON(scan.commonJsLine);
  return null;
}
