// Which language a pasted file is in, decided by plain code (E3). The person can override it.
//
// Plain words: Atlas looks for a few unmistakable signs, in order, and says which sign it used:
// - Python: a line that starts with `def name(` or `async def name(`, or `from x import y`, with no `{` that
//   opens a block after a `function` or `=>`.
// - TypeScript: a type annotation on a parameter or variable (`x: number`), `interface`, `type X =`, `as const`,
//   `enum`, a generic call `<T>(`, or a `!` non-null mark before `.`.
// - Otherwise JavaScript.
// This is a guess about the LANGUAGE only, never about what the code does. A wrong guess fails loudly: the
// runner reports the runtime's own error as "can't check", and the person can pick the language by hand.
// Comments and strings are removed first, so a word inside them is never a sign. No I/O.

import type { PastedLanguage } from "./pasted-code";

export interface LanguageGuess {
  language: PastedLanguage;
  /** The sign Atlas used, in plain words, e.g. "a type annotation on line 3". */
  why: string;
}

/** The text with comments and string contents blanked (line numbers kept). Rough on purpose: only for the guess. */
function blankCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "#" && (i === 0 || src[i - 1] === "\n" || /\s/.test(src[i - 1]!))) {
      // A Python comment (and harmless for JS, where # is rare outside private fields #x).
      if (n !== undefined && /[A-Za-z_$]/.test(n) && i > 0 && src[i - 1] !== "\n" && src[i - 1] !== " ") {
        out += c;
        i++;
        continue;
      }
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += q;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        if (src[i] === "\n") out += "\n";
        i++;
      }
      out += q;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

export function guessLanguage(source: string): LanguageGuess {
  const s = blankCommentsAndStrings(source);
  const py = /^[ \t]*(?:async[ \t]+)?def[ \t]+[A-Za-z_]\w*[ \t]*\(|^[ \t]*from[ \t]+[\w.]+[ \t]+import[ \t]/m.exec(s);
  const jsBlock = /\bfunction\b|=>|\bexport\b|\bconst\b|\blet\b/.test(s);
  if (py && !jsBlock) return { language: "py", why: `a Python \`def\` or \`from … import\` on line ${lineOf(s, py.index)}` };
  const signs: [RegExp, string][] = [
    [/\binterface[ \t]+[A-Za-z_$][\w$]*[ \t]*(?:<[^>]*>)?[ \t]*\{/, "an `interface`"],
    [/(?:^|[;\n])[ \t]*(?:export[ \t]+)?type[ \t]+[A-Za-z_$][\w$]*[ \t]*(?:<[^>]*>)?[ \t]*=/, "a `type` alias"],
    [/\bas[ \t]+const\b/, "`as const`"],
    [/\benum[ \t]+[A-Za-z_$][\w$]*[ \t]*\{/, "an `enum`"],
    [/[(,][ \t]*[A-Za-z_$][\w$]*\??[ \t]*:[ \t]*(?:string|number|boolean|unknown|any|void|never|bigint|object|Record|Array|Promise|readonly|\(|\{|\[|[A-Z][\w$]*)/, "a type annotation on a parameter"],
    [/\)[ \t]*:[ \t]*(?:Promise|string|number|boolean|void|unknown|any|never|[A-Z][\w$]*)[^\n{]*\{/, "a return type"],
    [/\b(?:const|let|var)[ \t]+[A-Za-z_$][\w$]*[ \t]*:[ \t]*[A-Za-z_$({[]/, "a type annotation on a variable"],
    [/\b[A-Za-z_$][\w$]*[ \t]*<[A-Z][\w$]*(?:[ \t]*,[ \t]*[A-Z][\w$]*)*>[ \t]*\(/, "a generic call"],
    [/\bfunction[ \t]+[A-Za-z_$][\w$]*[ \t]*<[A-Za-z_$]/, "a generic function"],
  ];
  for (const [re, what] of signs) {
    const m = re.exec(s);
    if (m) return { language: "ts", why: `${what} on line ${lineOf(s, m.index)}` };
  }
  if (py) return { language: "py", why: `a Python \`def\` on line ${lineOf(s, py.index)}` };
  return { language: "js", why: "no TypeScript or Python sign was found" };
}

const FOREIGN: [RegExp, string][] = [
  // R12 (D73): Solidity, Kotlin, Swift's arrow functions, C++ and more Java signs, so a file in them is named before any model call.
  [/^\s*pragma\s+solidity\b|^\s*(?:abstract\s+)?contract\s+\w+\s*(?:is\s+[\w\s,]+)?\{|^\s*library\s+\w+\s*\{/m, "Solidity"],
  [/^\s*(?:pub\s+)?fn\s+\w+\s*[(<]|^\s*use\s+\w+(?:::\w+)+|\blet\s+mut\b|^\s*impl\s+\w+/m, "Rust"],
  [/^\s*(?:(?:private|internal|public|suspend|inline)\s+)*fun\s+(?:<[^>]*>\s*)?[\w.]+\s*\(|^\s*(?:data\s+)?class\s+\w+\s*\(\s*(?:val|var)\s/m, "Kotlin"],
  [/^\s*import\s+(?:Foundation|UIKit|SwiftUI)\s*$|^\s*func\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:async\s+)?(?:throws\s+)?->/m, "Swift"],
  [/^\s*package\s+\w+\s*$|^\s*func\s+(?:\(\w+\s+\*?\w+\)\s*)?\w+\s*\(/m, "Go"],
  [/^\s*(?:(?:public|private|protected)\s+)?(?:(?:abstract|final|static)\s+)*class\s+\w+(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?\s*\{[\s\S]*\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:void|int|long|double|float|boolean|char|String|[A-Z]\w*(?:<[^>]*>)?)\s+\w+\s*\(|^\s*public\s+(?:final\s+)?class\s+\w+|public\s+static\s+void\s+main|^\s*import\s+java\.|\bSystem\.out\.print/m, "Java"],
  [/\bstd::\w+|^\s*int\s+main\s*\(/m, "C or C++"],
  [/^\s*using\s+System\b|^\s*namespace\s+[\w.]+\s*[;{]/m, "C#"],
  [/^\s*(?:class|module)\s+[A-Z]\w*\s*$[\s\S]*^\s*end\s*$|^\s*def\s+\w+[^:\n]*$[\s\S]*^\s*end\s*$/m, "Ruby"],
  [/^\s*import\s+(?:Foundation|UIKit|SwiftUI)\s*$/m, "Swift"],
];

/** The language a file with nothing Atlas can read looks like, or null. A guess from a few unmistakable signs, only ever used to say why nothing was drawn. */
export function foreignLanguage(src: string): string | null {
  // These two start with characters the blanking takes for a comment or a string, and no JavaScript or Python file has them at the start of a line.
  if (/^\s*#include\s*[<"]/m.test(src)) return "C or C++";
  if (/^\s*<\?php/m.test(src)) return "PHP";
  // R12 (D73): a shell script: its #! line names a shell, or it has the shell's own block words on lines of their own.
  // The #! line is read as written (it is the file's first line, which the blanking would take for a comment); the block
  // words only outside strings and comments (R12 review: a JS template literal holding "then" and "fi" is not a shell script).
  const text = blankCommentsAndStrings(src);
  if (/^#!\s*\S*\/(?:env\s+)?(?:ba|z|k|da)?sh\b/.test(src) || (/^\s*(?:fi|done|esac)\s*$/m.test(text) && /;\s*(?:then|do)\s*$|^\s*(?:then|do)\s*$/m.test(text))) return "a shell script (Bash)";
  return FOREIGN.find(([re]) => re.test(text))?.[1] ?? null;
}
