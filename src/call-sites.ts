// U3: which part of a pasted file makes a call, read from the file's TEXT by plain code (no run, no model).
//
// Why this exists: the drawing wires each device (a stand-in, the fake network) to a code box. Before U3 every device
// was wired to the function under test, even when that function's own lines never call it (a fake fetch drawn into
// fetchAllOrders when only fetchPage calls fetch). A cable on the drawing says "this box's own lines call that one", so
// it must be true of the code. This module finds, for each device, the parts whose own lines call it:
// - the fake network: the parts whose own lines call the library (global `fetch(`; `requests.…`, `httpx.…`,
//   `urlopen(`, or a name imported from them);
// - a stand-in: Atlas passes it to the tested function as argument i. The parts that call it are the tested function
//   if its own lines call that parameter, and, followed through plain hand-offs (`helper(x, param)` where `helper` is
//   one of the file's own functions), the helper whose own lines call its matching parameter. Up to 4 hand-offs.
// When plain code finds no such line, it says so and draws no cable: never a guess.
//
// Comments and string contents are removed first (network-fake.ts codeOnly), so a word in a string is not a call.
// Pure, no I/O. Safe in the browser.

import type { FileOutline, FilePart } from "./file-outline";
import type { NetworkLibrary } from "./types";
import { codeOnly } from "./network-fake";

export type Lang = "js" | "ts" | "py";

/** The parts whose own lines call something, with those lines (1-based, sorted). */
export interface CallSite {
  part: string;
  lines: number[];
}

const IDENT = /^[A-Za-z_$][\w$]*/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function splitLines(code: string): string[] {
  return code.split(/\r\n|\r|\n|\u2028|\u2029/);
}

/** The code-only lines of the file (comments and strings blanked, line count kept). */
export function codeLines(source: string, language: Lang): string[] {
  return splitLines(codeOnly(source, language));
}

/** The text of one part's own lines (code only), with each line's number. */
function partLines(lines: readonly string[], part: Pick<FilePart, "lineStart" | "lineEnd">): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  for (let n = part.lineStart; n <= part.lineEnd && n <= lines.length; n++) out.push({ n, text: lines[n - 1] ?? "" });
  return out;
}

/** Lines of a part that match a pattern, as a call site (null when none). */
function siteOf(lines: readonly string[], part: FilePart, re: RegExp): CallSite | null {
  const hit = partLines(lines, part)
    .filter((l) => {
      re.lastIndex = 0;
      return re.test(l.text);
    })
    .map((l) => l.n);
  return hit.length ? { part: part.name, lines: hit } : null;
}

// ---------- the fake network ----------

/** The patterns that mark a use of a Python network library, from the file's own import lines. */
function pyLibraryPatterns(lines: readonly string[], library: Exclude<NetworkLibrary, "fetch">): RegExp[] {
  const out: RegExp[] = [];
  const mod = library === "urllib" ? "urllib.request" : library;
  for (const raw of lines) {
    const imp = /^[ \t]*import[ \t]+(.+)$/.exec(raw);
    if (imp) {
      for (const piece of imp[1]!.split(",")) {
        const [name, alias] = piece.trim().split(/\s+as\s+/).map((x) => x.trim());
        if (!name) continue;
        if (name === mod || (library !== "urllib" && name.split(".")[0] === library)) out.push(new RegExp(`(?<![.\\w])${esc(alias ?? name)}\\s*\\.`));
        // `import urllib.request` is used as urllib.request.urlopen(…)
        if (library === "urllib" && name === "urllib.request" && !alias) out.push(/(?<![.\w])urllib\s*\.\s*request\s*\./);
      }
      continue;
    }
    const from = /^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+\(?([^)]+)\)?/.exec(raw);
    if (!from) continue;
    const src = from[1]!;
    const names = from[2]!.split(",").map((x) => x.trim()).filter(Boolean);
    for (const piece of names) {
      const [name, alias] = piece.split(/\s+as\s+/).map((x) => x.trim());
      if (!name || name === "*") continue;
      const local = alias ?? name;
      if (library === "urllib" && src === "urllib" && name === "request") out.push(new RegExp(`(?<![.\\w])${esc(local)}\\s*\\.`));
      else if (src === mod || src.split(".")[0] === (library === "urllib" ? "urllib.request" : library) || (library !== "urllib" && src.startsWith(`${library}.`))) {
        // A class or function imported from the library: its call (or attribute use) inside a part is a use of the network.
        out.push(new RegExp(`(?<![.\\w])${esc(local)}\\s*[.(]`));
      }
    }
  }
  return out;
}

/** The global-fetch call pattern (not a method named fetch, not a definition). Same reading as network-fake networkUse. */
const FETCH_CALL = /(?:\b(?:globalThis|window|self)\s*\.\s*fetch\b)|(?:(?<![.\w$])fetch\s*\()/g;

/**
 * The parts whose own lines call the network library. Empty when the library is used only outside every part (at
 * the top of the file) or not found: then no cable is drawn and the card says why.
 */
export function networkCallSites(source: string, language: Lang, outline: Pick<FileOutline, "parts">, library: NetworkLibrary): CallSite[] {
  const lines = codeLines(source, language);
  const out: CallSite[] = [];
  if (library === "fetch") {
    if (language === "py") return [];
    for (const p of outline.parts) {
      const hit: number[] = [];
      for (const l of partLines(lines, p)) {
        FETCH_CALL.lastIndex = 0;
        for (let m = FETCH_CALL.exec(l.text); m; m = FETCH_CALL.exec(l.text)) {
          const before = l.text.slice(Math.max(0, m.index - 12), m.index);
          const after = l.text.slice(m.index);
          const isDefinition = /(?:async|static|get|set)\s+$/.test(before) || (/^fetch\s*\([^()]*\)\s*(?::\s*[^{;=]+)?\{/.test(after) && !/[=(,:?]\s*$|return\s*$|await\s*$/.test(before));
          if (!isDefinition) {
            hit.push(l.n);
            break;
          }
        }
      }
      if (hit.length) out.push({ part: p.name, lines: hit });
    }
    return out;
  }
  if (language !== "py") return [];
  const pats = pyLibraryPatterns(lines, library);
  if (pats.length === 0) return [];
  const re = new RegExp(pats.map((r) => r.source).join("|"));
  for (const p of outline.parts) {
    const s = siteOf(lines, p, re);
    if (s) out.push(s);
  }
  return out;
}

// ---------- parameters and stand-ins ----------

/** Splits a parameter or argument list at its top-level commas (brackets, braces, generics and `=>` respected). */
export function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c === "=" && list[i + 1] === ">") {
      cur += "=>";
      i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** The text between the bracket at `open` and its match (exclusive), or null when it never closes. */
function inside(text: string, open: number, o = "(", c = ")"): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * A part's positional parameter names, in order (null for one plain code cannot name: a destructured parameter).
 * `self`/`cls` stay in for methods; a TypeScript `this:` parameter is left out (it is not passed). Null when the list
 * cannot be found.
 */
export function paramNames(source: string, language: Lang, part: Pick<FilePart, "name" | "lineStart" | "lineEnd">): (string | null)[] | null {
  const text = partLines(codeLines(source, language), part)
    .map((l) => l.text)
    .join("\n");
  let at: number;
  if (language === "py") {
    const m = new RegExp(`\\bdef\\s+${esc(part.name)}\\s*\\(`).exec(text);
    if (!m) return null;
    at = m.index + m[0].length - 1;
  } else {
    const m = new RegExp(`\\b(?:function\\s*\\*?\\s*${esc(part.name)}\\s*(?:<[^(]*>)?\\s*\\(|${esc(part.name)}\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*[\\w$]*\\s*)?(?:<[^(]*>)?\\s*\\()`).exec(text);
    if (m) at = m.index + m[0].length - 1;
    else {
      // `const f = async x => …` (one bare parameter)
      const one = new RegExp(`\\b${esc(part.name)}\\s*=\\s*(?:async\\s+)?([A-Za-z_$][\\w$]*)\\s*=>`).exec(text);
      return one ? [one[1]!] : null;
    }
  }
  const list = inside(text, at);
  if (list === null) return null;
  const out: (string | null)[] = [];
  for (const raw of splitTopLevel(list)) {
    let p = raw.trim();
    if (p === "" || p === "*" || p === "/") continue; // Python's bare * and / markers
    if (language !== "py" && /^this\s*:/.test(p)) continue;
    p = p.replace(/^\*\*?|^\.\.\./, "").trim();
    const m = IDENT.exec(p);
    out.push(m ? m[0] : null);
  }
  return out;
}

/** The lines of a part whose own code calls `name` (`name(`, `name?.(`, `name.call(`, `name.apply(`). */
function callLinesOf(lines: readonly string[], part: FilePart, name: string): number[] {
  const re = new RegExp(`(?<![.\\w$])${esc(name)}\\s*(?:\\?\\.\\s*)?(?:\\(|\\.\\s*(?:call|apply)\\s*\\()`);
  return partLines(lines, part)
    .filter((l) => re.test(l.text))
    .map((l) => l.n);
}

/**
 * Where an argument handed to one of the file's own functions goes: for each call `g(…)` in `part`'s own lines whose
 * argument at top level is exactly `name` (or `kw=name` in Python), the function g and the index of its parameter.
 */
function handOffs(lines: readonly string[], part: FilePart, name: string, own: ReadonlyMap<string, FilePart>, language: Lang, source: string): { to: FilePart; param: string }[] {
  const text = partLines(lines, part)
    .map((l) => l.text)
    .join("\n");
  const out: { to: FilePart; param: string }[] = [];
  for (const [g, target] of own) {
    if (g === part.name) continue;
    const re = new RegExp(`(?<![.\\w$])${esc(g)}\\s*(?:<[^()]*>)?\\(`, "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const list = inside(text, m.index + m[0].length - 1);
      if (list === null) continue;
      const args = splitTopLevel(list).map((a) => a.trim());
      const params = paramNames(source, language, target);
      if (!params) continue;
      args.forEach((a, k) => {
        const kw = language === "py" ? /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(a) : null;
        if (kw && kw[2]!.trim() === name && params.includes(kw[1]!)) out.push({ to: target, param: kw[1]! });
        else if (!kw && a === name && params[k]) out.push({ to: target, param: params[k]! });
      });
    }
  }
  return out;
}

/**
 * The parts whose own lines call the stand-in Atlas passes to `tested` as argument `index` (0-based). Follows plain
 * hand-offs to the file's own functions, up to 4 deep. Empty when plain code finds no such call (no cable is drawn).
 */
export function standInCallSites(source: string, language: Lang, outline: Pick<FileOutline, "parts">, tested: string, index: number): CallSite[] {
  const own = new Map(outline.parts.filter((p) => p.kind === "function").map((p) => [p.name, p] as const));
  const start = outline.parts.find((p) => p.name === tested);
  if (!start) return [];
  const params = paramNames(source, language, start);
  const name = params?.[index];
  if (!name) return [];
  const lines = codeLines(source, language);
  const found = new Map<string, Set<number>>();
  const seen = new Set<string>();
  const walk = (part: FilePart, param: string, depth: number) => {
    const key = `${part.name}\u0000${param}`;
    if (seen.has(key) || depth > 4) return;
    seen.add(key);
    const hit = callLinesOf(lines, part, param);
    if (hit.length) {
      const s = found.get(part.name) ?? new Set<number>();
      for (const n of hit) s.add(n);
      found.set(part.name, s);
    }
    for (const h of handOffs(lines, part, param, own, language, source)) walk(h.to, h.param, depth + 1);
  };
  walk(start, name, 0);
  return [...found.entries()].map(([part, s]) => ({ part, lines: [...s].sort((a, b) => a - b) })).sort((a, b) => (a.part < b.part ? -1 : 1));
}

// ---------- the path a call takes ----------

/**
 * The parts that are CERTAINLY running when `to` runs during a call of `from`: the parts on every path from `from` to
 * `to` along the file's call joins ("calls" and "wraps"), in path order, and the joins between them when the path is
 * unique. Null when plain code finds no path at all.
 */
export function certainPath(outline: Pick<FileOutline, "joins">, from: string, to: string): { parts: string[]; joins: string[] } | null {
  if (from === to) return { parts: [from], joins: [] };
  const next = new Map<string, { to: string; id: string }[]>();
  for (const j of outline.joins) {
    if (j.kind !== "calls" && j.kind !== "wraps") continue;
    // A wrap runs the wrapper when the wrapped function is called: the edge goes from the wrapped part to its decorator.
    next.set(j.from, [...(next.get(j.from) ?? []), { to: j.to, id: j.id }]);
  }
  // Every simple path (the file has at most 40 parts; the search stops at 200 paths).
  const paths: { parts: string[]; joins: string[] }[] = [];
  const go = (at: string, parts: string[], joins: string[]) => {
    if (paths.length >= 200) return;
    if (at === to) {
      paths.push({ parts, joins });
      return;
    }
    for (const e of next.get(at) ?? []) if (!parts.includes(e.to)) go(e.to, [...parts, e.to], [...joins, e.id]);
  };
  go(from, [from], []);
  if (paths.length === 0) return null;
  const common = paths[0]!.parts.filter((p) => paths.every((q) => q.parts.includes(p)));
  return { parts: common, joins: paths.length === 1 ? paths[0]!.joins : [] };
}
