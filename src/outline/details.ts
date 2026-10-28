// X1: what the explorer shows when a person clicks one part, read from the code by plain code.
//
// Plain words: for one part of the verified outline this returns
// - its spans, and for each span that plain code confirmed, the real lines (numbered), with invisible
//   direction-changing and zero-width characters made visible (a "Trojan Source" line cannot hide what it does);
// - the definitions inside those lines (functions, classes, methods) with their written parameters and return
//   type: the part's inputs and outputs as the CODE states them, labelled "read from the code";
// - what the part's files import, and every code-map edge into or out of the part;
// - the joins of the verified outline that touch it, and the model's purpose/name/patterns, still labelled as the
//   model's.
// Pure; no I/O, no model. Unconfirmed spans show no lines: plain code could not tie them to the bytes.

import type { CodeEdge, CodeImport, CodeMap, CodeSymbol, OutlineFile, VerifiedJoin, VerifiedOutline, VerifiedPart } from "./types";

/** Direction controls, zero-width characters and line/paragraph separators, written as \uXXXX. Tabs stay tabs. */
const HIDDEN_IN_CODE = /[\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
export const codeLineShown = (s: string) => s.replace(HIDDEN_IN_CODE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export interface PartDetails {
  part: VerifiedPart;
  spans: { path: string; lineStart: number; lineEnd: number; ok: boolean; reason?: string; lines?: { n: number; text: string }[] }[];
  /** Definitions inside the confirmed spans: their signatures, parameters and written return types, read from the code. */
  definitions: (CodeSymbol & { path: string; readFrom: "the code" })[];
  imports: (CodeImport & { path: string })[];
  edgesOut: CodeEdge[];
  edgesIn: CodeEdge[];
  joins: VerifiedJoin[];
}

/** The details of one part, or null when the outline has no part with that id. */
export function partDetails(files: readonly Pick<OutlineFile, "path" | "text">[], map: CodeMap, verified: VerifiedOutline, partId: string): PartDetails | null {
  const part = verified.parts.find((p) => p.id === partId);
  if (!part) return null;
  const text = new Map(files.map((f) => [f.path, f.text] as const));
  const spans = part.spans.map((s) => {
    const t = s.ok ? text.get(s.path) : undefined;
    const lines = t === undefined ? undefined : t.split("\n").slice(s.lineStart - 1, s.lineEnd).map((l, i) => ({ n: s.lineStart + i, text: codeLineShown(l) }));
    return { ...s, ...(lines ? { lines } : {}) };
  });
  const okSpans = part.spans.filter((s) => s.ok);
  const definitions = map.files.flatMap((f) =>
    f.symbols.filter((sym) => okSpans.some((s) => s.path === f.path && sym.lineStart <= s.lineEnd && s.lineStart <= sym.lineEnd)).map((sym) => ({ ...sym, path: f.path, readFrom: "the code" as const })),
  );
  const mine = new Set(part.files);
  const imports = map.files.filter((f) => mine.has(f.path)).flatMap((f) => f.imports.map((i) => ({ ...i, path: f.path })));
  return {
    part,
    spans,
    definitions,
    imports,
    edgesOut: map.edges.filter((e) => mine.has(e.from) && !mine.has(e.to)),
    edgesIn: map.edges.filter((e) => mine.has(e.to) && !mine.has(e.from)),
    joins: verified.joins.filter((j) => j.from === partId || j.to === partId),
  };
}
