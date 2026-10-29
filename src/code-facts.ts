// U3 item 2: two plain-code facts about a pasted file's TEXT that pick a test worth betting on (no run, no model).
//
// - `keptState`: does the file keep something between calls (a cache, a counter, a module-level dict, a decorator that
//   caches)? Then a single call cannot show what the code is for, and a test should call twice.
// - `smallLimits`: the small whole numbers the code compares against or uses as defaults (`attempt < 3`, `maxPages = 5`,
//   `range(4)`): the edges a test can aim at (the Nth failure, the last page).
//
// Comments and strings are removed first (network-fake.ts codeOnly), so a word in a comment does not count.
// Pure, no I/O.

import { codeOnly } from "./network-fake";

export type Lang = "js" | "ts" | "py";

export interface KeptState {
  line: number;
  /** Plain words: "a module-level dict (_cache)", "a top-level let (count)", "a caching decorator (@lru_cache)". */
  what: string;
}

/** Where the file keeps state between calls, by plain code; empty when it finds none. */
export function keptState(source: string, language: Lang): KeptState[] {
  const lines = codeOnly(source, language).split(/\r\n|\r|\n|\u2028|\u2029/);
  const out: KeptState[] = [];
  lines.forEach((raw, i) => {
    const line = i + 1;
    if (language === "py") {
      let m = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*(\{|\[|dict\(|list\(|set\(|(?:collections\.)?(?:defaultdict|OrderedDict|deque|Counter)\()/.exec(raw);
      if (m) out.push({ line, what: `a module-level ${m[2]!.startsWith("[") || m[2]!.startsWith("list") ? "list" : m[2]!.startsWith("{") || m[2]!.startsWith("dict") ? "dict" : "container"} (${m[1]})` });
      m = /^\s+(?:global|nonlocal)\s+([\w, ]+)/.exec(raw);
      if (m) out.push({ line, what: `a function that changes ${raw.includes("nonlocal") ? "an outer" : "a module-level"} name (${m[1]!.trim()})` });
      m = /^\s*@\s*((?:functools\.)?(?:lru_cache|cache|cached_property|cached\w*|memoize\w*)\b)/.exec(raw);
      if (m) out.push({ line, what: `a caching decorator (@${m[1]})` });
      return;
    }
    // JavaScript/TypeScript: only top-level declarations (no indent) count.
    let m = /^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/.exec(raw);
    if (m) out.push({ line, what: `a top-level ${raw.includes("var ") ? "var" : "let"} (${m[1]})` });
    m = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(new\s+(?:Map|Set|WeakMap|WeakSet|Array)\b|\{|\[)/.exec(raw);
    if (m) out.push({ line, what: `a top-level ${m[2]!.startsWith("new") ? m[2]!.replace(/^new\s+/, "") : m[2] === "{" ? "object" : "array"} (${m[1]})` });
  });
  return out;
}

/** The small whole numbers (1 to 20) the code compares against, loops up to, or uses as a default value. */
export function smallLimits(source: string, language: Lang): number[] {
  const code = codeOnly(source, language);
  const found = new Set<number>();
  const re = /(?:<=?|>=?|===?|!==?|range\(\s*)\s*(\d{1,2})\b|\b[A-Za-z_$][\w$]*\s*(?::\s*[A-Za-z]+\s*)?=\s*(\d{1,2})\s*[,)]/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const n = Number(m[1] ?? m[2]);
    if (n >= 1 && n <= 20) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}
