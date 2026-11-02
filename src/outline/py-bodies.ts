// D65 review R5: what a Python function's own body holds, from its structure, not from words anywhere in its lines. Comments and strings are masked; a line inside
// brackets is not a statement, so a comprehension's `for` draws nothing; a nested def or class is someone else's body. A statement this reader isn't sure of is left off:
// a plain housing is true, an extra part is not. Pure.
import type { BodyFacts, ThrowSite } from "./types";

/** The message a `raise Name("text")` carries, read from the raw line. Anything else has no message to compare. */
function raiseSite(raw: string, line: number): ThrowSite {
  const m = /^\s*raise\s+([A-Za-z_][\w.]*)\s*\(\s*(f?)("|')((?:[^"'\\{]|\\.)*)(\{?)/.exec(raw);
  if (!m) return { line };
  const fstring = m[2] === "f" || m[5] === "{";
  const closes = raw.slice(raw.indexOf(m[3]!, raw.indexOf("(")) + 1 + m[4]!.length).startsWith(m[3]!);
  if (!fstring && !closes) return { line };
  return { line, name: m[1]!, message: m[4]!, exact: !fstring };
}

export function pyBodies(masked: string, raw: string, parts: readonly { name: string; kind: string; lineStart: number; lineEnd: number }[]): Record<string, BodyFacts> {
  const lines = masked.split(/\r\n|\r|\n/);
  const rawLines = raw.split(/\r\n|\r|\n/);
  const indent = (s: string) => /^[ \t]*/.exec(s)![0].length;
  const out: Record<string, BodyFacts> = {};
  for (const p of parts) {
    if (p.kind !== "function") continue;
    const facts: BodyFacts = { loops: [], throws: [], returns: [], nested: [] };
    // past the decorators and the signature, which may run over lines
    let depth = 0;
    let n = p.lineStart;
    let found = false;
    for (; n <= p.lineEnd; n++) {
      const t = lines[n - 1] ?? "";
      if (!found && /^\s*(async\s+)?def\b/.test(t)) found = true;
      for (const ch of t) depth += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
      if (found && depth === 0 && /:\s*$/.test(t)) break;
      if (found && depth === 0 && /:\s*\S/.test(t)) {
        // a one-line def: not read as a body
        n = p.lineEnd + 1;
        break;
      }
    }
    depth = 0;
    let skipOver: number | null = null;
    let from = 0;
    for (let i = n + 1; i <= p.lineEnd; i++) {
      const t = lines[i - 1] ?? "";
      if (t.trim() === "") continue;
      const at = indent(t);
      if (skipOver !== null) {
        if (depth === 0 && at > skipOver) {
          for (const ch of t) depth += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
          continue;
        }
        if (depth > 0) {
          for (const ch of t) depth += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
          continue;
        }
        facts.nested.push([from, i - 1]);
        skipOver = null;
      }
      const startDepth = depth;
      for (const ch of t) depth += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
      if (startDepth > 0) continue;
      const s = t.trimStart();
      if (/^(async\s+def|def|class)\b/.test(s)) {
        skipOver = at;
        from = i;
        continue;
      }
      if (/^(for|while|async\s+for)\b/.test(s)) facts.loops.push(i);
      else if (/^raise\b/.test(s)) (facts.throws as ThrowSite[]).push(raiseSite(rawLines[i - 1] ?? "", i));
      else if (/^return\b/.test(s)) facts.returns.push(i);
    }
    if (skipOver !== null) facts.nested.push([from, p.lineEnd]);
    out[p.name] = facts;
  }
  return out;
}

/** Every place in a Python file that could raise, nested and class bodies too: each `raise`, each `assert`, and each `SomethingError(...)` built without raising it there. See throwsInFileJs. */
export function pyThrowsInFile(masked: string, raw: string): ThrowSite[] {
  const lines = masked.split(/\r\n|\r|\n/);
  const rawLines = raw.split(/\r\n|\r|\n/);
  const out: ThrowSite[] = [];
  lines.forEach((t, i) => {
    const line = i + 1;
    const r = /\braise\b/.exec(t);
    if (r) {
      out.push(raiseSite((rawLines[i] ?? "").slice(r.index), line));
      return;
    }
    if (/^\s*assert\b/.test(t)) out.push({ line, name: "AssertionError" });
    for (const m of t.matchAll(/\b([A-Za-z_]\w*(?:Error|Exception))\s*\(/g)) if (!/^\s*class\b/.test(t)) out.push({ line, name: m[1]! });
  });
  return out;
}
