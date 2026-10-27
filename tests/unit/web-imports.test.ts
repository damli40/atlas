// The page must not load a Node built-in (node:fs, node:path, ...): Vite replaces them with a stub that
// throws on first use, and the whole page goes blank in development. Found on Oct 27 (D06): since D19,
// src/bet-context.ts imported src/atlasfile.ts, which imports node:fs, so `vite` dev showed nothing.
// This walks every value import reachable from web/main.tsx and fails on any Node built-in.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const IMPORT = /^\s*(import|export)\s+(?!type\b)([^'";]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveLocal(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  return [`${base}.ts`, `${base}.tsx`, base, join(base, "index.ts")].find((c) => existsSync(c) && /\.(tsx?|css|json)$/.test(c));
}

describe("web import graph", () => {
  it("no module the page loads imports a Node built-in", () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const stack = [join(ROOT, "web/main.tsx")];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (/\.(css|json)$/.test(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(IMPORT)) {
        const spec = m[3]!;
        if (spec.startsWith("node:")) bad.push(`${f.slice(ROOT.length + 1)} imports ${spec}`);
        else if (spec.startsWith(".")) {
          const r = resolveLocal(f, spec);
          if (r) stack.push(r);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
