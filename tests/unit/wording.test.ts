// Wording lint. Atlas never says code is right or wrong; it says whether a bet matched.
// This test scans every .ts/.tsx file under src/, server/, web/ and runners/ for string
// literals (and, in .tsx, JSX text) that contain a banned word, and fails listing file:line.
// Comments are allowed to use these words. A line can opt out with the comment
// `wording-lint: allow` (for strings that never render as a verdict, e.g. a CSS value).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SCAN_DIRS = ["src", "server", "web", "runners"];
const BANNED = /\b(wrong|correct|bug|right answer|fixed|broken)\b/i;
const ALLOW_MARK = "wording-lint: allow";

export interface Literal {
  text: string;
  line: number;
}

const REGEX_PRECEDERS = new Set("(,=:[!&|?{};+-*%<>~^".split(""));
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);

/**
 * Pull string literals and template-literal text out of TypeScript source, skipping comments
 * and regex literals. Also returns the source with strings and comments blanked (same length,
 * newlines kept) so JSX text can be found in it.
 */
export function extractLiterals(src: string): { literals: Literal[]; code: string } {
  const literals: Literal[] = [];
  const code = src.split("");
  let i = 0;
  let line = 1;
  let lastSig = ""; // last significant code character or word, for the regex-vs-divide guess
  // Stack of brace depths for template-literal `${ }` nesting.
  const templateStack: number[] = [];
  let braceDepth = 0;

  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (code[k] !== "\n") code[k] = " ";
  };
  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (src[k] === "\n") line++;
  };

  const readTemplateText = (start: number): number => {
    // start is just after ` or after the } that closes ${ }. Returns index after the closing ` or the ${.
    let j = start;
    let text = "";
    const startLine = line;
    while (j < src.length) {
      const c = src[j]!;
      if (c === "\\") { text += src[j + 1] ?? ""; j += 2; continue; }
      if (c === "`") { literals.push({ text, line: startLine }); blank(start, j); countLines(start, j + 1); return j + 1; }
      if (c === "$" && src[j + 1] === "{") {
        literals.push({ text, line: startLine });
        blank(start, j);
        countLines(start, j + 2);
        templateStack.push(braceDepth);
        braceDepth++;
        return j + 2;
      }
      text += c;
      j++;
    }
    literals.push({ text, line: startLine });
    countLines(start, j);
    return j;
  };

  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      countLines(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let text = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") { text += src[j + 1] ?? ""; j += 2; continue; }
        text += src[j];
        j++;
      }
      literals.push({ text, line });
      blank(i, j + 1);
      i = j + 1;
      lastSig = "a";
      continue;
    }
    if (c === "`") {
      i = readTemplateText(i + 1);
      lastSig = "a";
      continue;
    }
    if (c === "{") { braceDepth++; i++; lastSig = c; continue; }
    if (c === "}") {
      braceDepth--;
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        i = readTemplateText(i + 1);
        lastSig = "a";
        continue;
      }
      i++;
      lastSig = c;
      continue;
    }
    if (c === "/") {
      const prevIsJsxOpen = lastSig === "<";
      const isRegex = !prevIsJsxOpen && (lastSig === "" || REGEX_PRECEDERS.has(lastSig) || REGEX_KEYWORDS.has(lastSig));
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < src.length && src[j] !== "\n") {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
          j++;
        }
        j++;
        while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
        blank(i, j);
        i = j;
        lastSig = "a";
        continue;
      }
      i++;
      lastSig = c;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j]!)) j++;
      lastSig = src.slice(i, j);
      i = j;
      continue;
    }
    lastSig = c;
    i++;
  }
  return { literals, code: code.join("") };
}

/** Text between JSX tags in already-blanked code: `>Some text<`. */
function jsxText(code: string): Literal[] {
  const out: Literal[] = [];
  const re = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (!/[A-Za-z]/.test(m[1]!)) continue;
    const line = code.slice(0, m.index).split("\n").length;
    out.push({ text: m[1]!, line });
  }
  return out;
}

export function findBannedWording(file: string, src: string): string[] {
  const { literals, code } = extractLiterals(src);
  const all = file.endsWith(".tsx") ? [...literals, ...jsxText(code)] : literals;
  const lines = src.split("\n");
  const hits: string[] = [];
  for (const lit of all) {
    const m = BANNED.exec(lit.text);
    if (!m) continue;
    if (lines[lit.line - 1]?.includes(ALLOW_MARK)) continue;
    hits.push(`${file}:${lit.line}: "${m[0]}" in ${JSON.stringify(lit.text.trim().slice(0, 80))}`);
  }
  return hits;
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("wording lint: the extractor", () => {
  it("flags string literals but not comments", () => {
    const src = [
      "// this comment says wrong and that is allowed",
      "/* a bug in a block comment is allowed */",
      "const a = \"the answer was wrong\";",
      "const b = 'Fixed it';",
      "const c = `all ${x ? \"broken\" : 'ok'} done`;",
      "const d = `this is correct`;",
      "const e = \"wrongly\"; // not a whole word",
      "const f = \"debug\"; // not a whole word",
      "const g = x / 2 / 3; const h = \"matched\";",
      "const r = /wrong/i;",
      "const s = \"position: fixed\"; // wording-lint: allow",
    ].join("\n");
    const hits = findBannedWording("x.ts", src);
    expect(hits.map((h) => h.split(":")[1])).toEqual(["3", "4", "5", "6"]);
  });

  it("flags JSX text in .tsx", () => {
    const src = "export const A = () => <p className=\"v\">That was wrong</p>;\nexport const B = () => <p>matched</p>;";
    expect(findBannedWording("x.tsx", src)).toHaveLength(1);
  });
});

describe("wording lint: the codebase", () => {
  it("no string in src/, server/, web/, runners/ uses verdict words other than matched / didn't match / can't check", () => {
    const files = SCAN_DIRS.flatMap((d) => listSourceFiles(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((f) => findBannedWording(relative(ROOT, f), readFileSync(f, "utf8")));
    expect(hits, `banned wording found:\n${hits.join("\n")}`).toEqual([]);
  });
});
