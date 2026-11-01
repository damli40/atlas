// U3, resolved by scope in R3: which part of a pasted file makes a call.
//
// Why this exists: the drawing wires each device (a stand-in, the fake network) to a code box. A cable says "this box's own
// lines call that one", so it must be true of the code. R3's review found the first version, which searched text, drew cables
// for names the function had rebound for itself (`const fetch = …`, a parameter called `requests`). So this module no longer
// reads text: it reads the facts the parsers wrote with real scope (src/outline, FileOutline.callFacts):
// - the fake network: calls of a global `fetch` nothing in the file binds; calls through an import of the library;
// - a stand-in: Atlas passes it to the tested function as argument i. The parts that call it are the tested function, if
//   its own lines call that parameter and never rebind it, and, followed through plain hand-offs (`helper(x, param)` to one
//   of the file's own functions), the helper whose own lines call its matching parameter. Up to 4 hand-offs.
// When plain code finds no such line it says so and draws no cable: never a guess. It may miss a real call (`map(fetch)`,
// `const g = cb`); the path then shows the real calls, and the card says no line was found.
// Pure, no I/O. Safe in the browser: the parsers run on the server, and the outline carries the facts.

import type { FileOutline, FilePart } from "./file-outline";
import type { NetworkLibrary } from "./types";

export type Lang = "js" | "ts" | "py";

/** The parts whose own lines call something, with those lines (1-based, sorted). */
export interface CallSite {
  part: string;
  lines: number[];
}

type Outline = Pick<FileOutline, "parts" | "callFacts">;

const partAt = (outline: Outline, line: number): FilePart | undefined => outline.parts.find((p) => p.lineStart <= line && line <= p.lineEnd);

function sitesOf(outline: Outline, lines: readonly number[]): CallSite[] {
  const by = new Map<string, Set<number>>();
  for (const n of lines) {
    const p = partAt(outline, n);
    if (!p) continue;
    const s = by.get(p.name) ?? new Set<number>();
    s.add(n);
    by.set(p.name, s);
  }
  return [...by.entries()].map(([part, s]) => ({ part, lines: [...s].sort((a, b) => a - b) })).sort((a, b) => (a.part < b.part ? -1 : 1));
}

/** Does an import of this module (and this name from it) reach the library? */
function isLibrary(c: { module: string; imported: string }, library: Exclude<NetworkLibrary, "fetch">): boolean {
  if (library === "urllib") return c.module === "urllib.request" || c.module.startsWith("urllib.request.") || (c.module === "urllib" && (c.imported === "request" || c.imported === ""));
  return c.module === library || c.module.startsWith(`${library}.`);
}

/**
 * The parts whose own lines call the network library. Empty when the library is used only outside every part (at the
 * top of the file) or not found: then no cable is drawn and the card says why.
 */
export function networkCallSites(_source: string, language: Lang, outline: Outline, library: NetworkLibrary): CallSite[] {
  const facts = outline.callFacts;
  if (!facts) return [];
  if (library === "fetch") return language === "py" ? [] : sitesOf(outline, facts.freeCalls.filter((c) => c.name === "fetch").map((c) => c.line));
  if (language !== "py") return [];
  return sitesOf(outline, facts.importCalls.filter((c) => isLibrary(c, library)).map((c) => c.line));
}

/**
 * The parts whose own lines call the stand-in Atlas passes to `tested` as argument `index` (0-based). Follows plain
 * hand-offs to the file's own functions, up to 4 deep. Empty when plain code finds no such call (no cable is drawn).
 */
export function standInCallSites(_source: string, _language: Lang, outline: Outline, tested: string, index: number): CallSite[] {
  const facts = outline.callFacts;
  if (!facts) return [];
  const lines: number[] = [];
  const seen = new Set<string>();
  const walk = (fn: string, i: number, depth: number) => {
    const key = `${fn}|${i}`;
    if (seen.has(key) || depth > 4) return;
    seen.add(key);
    for (const c of facts.paramCalls) if (c.fn === fn && c.index === i) lines.push(c.line);
    for (const h of facts.handoffs) if (h.fn === fn && h.index === i) walk(h.to, h.toIndex, depth + 1);
  };
  walk(tested, index, 0);
  return sitesOf(outline, lines);
}

/** The parts whose own lines plainly wait (FileOutline.callFacts.waits). */
export function waitingPartsOf(outline: Outline): string[] {
  return sitesOf(outline, (outline.callFacts?.waits ?? []).map((w) => w.line)).map((s) => s.part);
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
