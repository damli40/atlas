// R12 (D73): what Atlas says about a pasted file it can't read, decided by plain code before any model is asked.
//
// Plain words: before this, a file with a typo went to Meta's AI three times (a summary, names for the parts, a test)
// and only the sandbox run said the code didn't parse. Now the server reads the file with a parser first:
// - JavaScript and TypeScript: the TypeScript 5.9 parser Atlas already uses for the drawing (src/outline/parse-js.ts).
//   Only its own syntax errors count (what a JavaScript engine would also refuse), never type errors.
// - Python: the hosted server has no Python, so a small local check on top of Atlas's Python scanner
//   (src/outline/parse-py.ts). It finds an unclosed string or bracket, a missing ":" at the end of a `def`, `class`,
//   `if`, `for`, `while`, `with`, `try`, `except`, `else`, `elif` or `finally` line, and a block header with nothing
//   indented under it. Any other Python syntax error is still found by Python itself when the code runs.
// A file that fails is then named for what it most likely is: another language (src/paste-language.ts), Markdown
// with code in a ``` fence (Atlas offers to use the code inside), or plain prose. Otherwise the parser's own line,
// column and message are shown. No model, no I/O. Safe to load in the browser and on the server.

import ts from "typescript-api";
import type { PastedLanguage } from "./pasted-code";
import { foreignLanguage, guessLanguage } from "./paste-language";
import { scan as scanPy } from "./outline/parse-py";

export interface SyntaxProblem {
  line: number;
  column: number;
  message: string;
}

export type PrecheckRefusal =
  | { kind: "foreign"; language: string; words: string }
  | { kind: "prose"; words: string }
  | { kind: "data"; words: string }
  | { kind: "jsx"; words: string; line: number }
  | { kind: "address"; words: string }
  | { kind: "markdown"; words: string; fenced?: { code: string; language: PastedLanguage } }
  | ({ kind: "syntax"; words: string } & SyntaxProblem);

const NAME: Record<PastedLanguage, string> = { js: "JavaScript", ts: "TypeScript", py: "Python" };

/** Placeholder wording (Dami's to finish). Every sentence says nothing was sent to Meta's AI, because nothing was. */
export const PRECHECK_WORDS = {
  foreign: (language: string) => `This looks like ${language}. Atlas reads JavaScript, TypeScript and Python, so it didn't draw this file, and nothing was sent to Meta's AI.`,
  data: "This looks like JSON data, not code. Paste a JavaScript, TypeScript or Python file. Nothing was sent to Meta's AI.",
  address: "This looks like a web address, not code. Paste the file's text itself; for a GitHub repo, use the GitHub box under the paste box. Nothing was sent to Meta's AI.",
  jsx: (line: number) => `This file has JSX (a tag like <div> in the code, line ${line}). Atlas runs plain JavaScript, TypeScript or Python with no packages, so it can't run a React component. Paste a function without JSX. Nothing was sent to Meta's AI.`,
  prose: "This looks like plain text, not code. Paste a JavaScript, TypeScript or Python file. Nothing was sent to Meta's AI.",
  markdownFenced: (language: PastedLanguage) => `This looks like Markdown with ${NAME[language]} code in a \`\`\` fence. Atlas can use just the code inside the fence. Nothing was sent to Meta's AI.`,
  markdownNoCode: "This looks like Markdown, not a code file. Paste just the code. Nothing was sent to Meta's AI.",
  syntax: (language: PastedLanguage, p: SyntaxProblem) => `Atlas's parser can't read this ${NAME[language]} file: line ${p.line}, column ${p.column}: ${p.message} Fix it and draw it again. Nothing was sent to Meta's AI.`,
};

const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** The first syntax error the TypeScript parser reports, or null. A TypeScript file that only fails as plain TS but reads as TSX is not refused here. */
export function jsSyntaxProblem(code: string, language: "js" | "ts"): SyntaxProblem | null {
  const first = (kind: ts.ScriptKind, name: string): SyntaxProblem | null => {
    const sf = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, kind);
    const d = ((sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [])[0];
    if (!d) return null;
    const at = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    return { line: at.line + 1, column: at.character + 1, message: sentence(ts.flattenDiagnosticMessageText(d.messageText, " ")).slice(0, 200) };
  };
  if (language === "js") return first(ts.ScriptKind.JS, "pasted.js");
  const asTs = first(ts.ScriptKind.TS, "pasted.ts");
  return asTs && first(ts.ScriptKind.TSX, "pasted.tsx") !== null ? asTs : null;
}

const BLOCK_HEADS = new Set(["if", "elif", "else", "while", "for", "try", "except", "finally", "with", "def", "class"]);

/** The small local Python check described at the top of this file. Null when it finds nothing (Python may still refuse the file). */
export function pySyntaxProblem(code: string): SyntaxProblem | null {
  const colOf = (offset: number) => offset - code.lastIndexOf("\n", offset - 1);
  const { lines, problem } = scanPy(code);
  if (problem) {
    const line = Number(/line (\d+)/.exec(problem)?.[1] ?? code.split("\n").length);
    return { line, column: 1, message: sentence(problem) };
  }
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k]!;
    const t0 = l.toks[0];
    const head = t0?.t === "name" && t0.v === "async" ? l.toks[1] : t0;
    if (!head || head.t !== "name" || !BLOCK_HEADS.has(head.v)) continue;
    // The header's own ":" is the first one outside brackets that does not belong to a lambda.
    let depth = 0;
    let lambdas = 0;
    let colon = -1;
    for (let j = 0; j < l.toks.length; j++) {
      const t = l.toks[j]!;
      if (t.t === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
      else if (t.t === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) depth--;
      else if (t.t === "name" && t.v === "lambda" && depth === 0) lambdas++;
      else if (t.t === "op" && t.v === ":" && depth === 0) {
        if (lambdas > 0) lambdas--;
        else {
          colon = j;
          break;
        }
      }
    }
    if (colon < 0) {
      const last = l.toks[l.toks.length - 1]!;
      return { line: last.line, column: colOf(last.end), message: `expected ":" at the end of this \`${head.v}\` line.` };
    }
    if (colon === l.toks.length - 1) {
      const next = lines[k + 1];
      if (!next || next.indent <= l.indent) return { line: l.toks[colon]!.line, column: colOf(l.toks[colon]!.end), message: `expected an indented block after this \`${head.v}\` line.` };
    }
  }
  return null;
}

/** The first ``` fenced block whose code Atlas can read, with its language, or null. */
function fencedCode(text: string): { code: string; language: PastedLanguage } | null {
  const re = /^[ \t]*```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  for (const m of text.matchAll(re)) {
    const tag = (m[1] ?? "").toLowerCase();
    const code = m[2] ?? "";
    if (code.trim() === "") continue;
    const language: PastedLanguage | null = /^(?:js|javascript|jsx|mjs|cjs|node)$/.test(tag) ? "js" : /^(?:ts|typescript|tsx)$/.test(tag) ? "ts" : /^(?:py|python|python3)$/.test(tag) ? "py" : tag === "" ? guessLanguage(code).language : null;
    if (!language) continue;
    if ((language === "py" ? pySyntaxProblem(code) : jsSyntaxProblem(code, language)) === null) return { code, language };
  }
  return null;
}

/** Most non-empty lines read as sentences: five or more words, no code punctuation. */
function looksLikeProse(text: string): boolean {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter((r) => r !== "");
  if (rows.length === 0) return false;
  const prose = rows.filter((r) => r.split(/\s+/).length >= 5 && !/[{}()[\];=<>]|=>|:\s*$/.test(r));
  return prose.length / rows.length >= 0.6;
}

/** The line of the first JSX tag in a file that parses, or null. (The TypeScript parser reads JSX in .js files.) */
export function jsxLine(code: string, language: "js" | "ts"): number | null {
  if (!/<\/?[A-Za-z>]/.test(code)) return null;
  const sf = ts.createSourceFile(language === "ts" ? "pasted.tsx" : "pasted.jsx", code, ts.ScriptTarget.Latest, true, language === "ts" ? ts.ScriptKind.TSX : ts.ScriptKind.JSX);
  if (((sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []).length > 0) return null;
  let at: number | null = null;
  const visit = (n: ts.Node) => {
    if (at !== null) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      at = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return at;
}

/**
 * Why Atlas won't draw this pasted file, or null when the parser reads it. Only a file the parser refuses is named as
 * another language, Markdown or prose, so a file that reads as code is never turned away for how it looks.
 */
export function precheckPaste(code: string, language: PastedLanguage): PrecheckRefusal | null {
  const problem = language === "py" ? pySyntaxProblem(code) : jsSyntaxProblem(code, language);
  if (!problem) {
    // R12 (D73): JSX parses, but no runner here can run it (the runner's own scanner then misread a closing tag as a regular expression).
    const jsx = language === "py" ? null : jsxLine(code, language);
    return jsx !== null ? { kind: "jsx", line: jsx, words: PRECHECK_WORDS.jsx(jsx) } : null;
  }
  const trimmed = code.trim();
  if (/^https?:\/\/\S+$/.test(trimmed)) return { kind: "address", words: PRECHECK_WORDS.address };
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return { kind: "data", words: PRECHECK_WORDS.data };
    } catch {
      // not JSON: read on
    }
  }
  const foreign = foreignLanguage(code);
  if (foreign) return { kind: "foreign", language: foreign, words: PRECHECK_WORDS.foreign(foreign) };
  if (/^[ \t]*```/m.test(code)) {
    const fenced = fencedCode(code);
    return fenced ? { kind: "markdown", words: PRECHECK_WORDS.markdownFenced(fenced.language), fenced } : { kind: "markdown", words: PRECHECK_WORDS.markdownNoCode };
  }
  if (looksLikeProse(code)) return { kind: "prose", words: PRECHECK_WORDS.prose };
  return { kind: "syntax", ...problem, words: PRECHECK_WORDS.syntax(language, problem) };
}
