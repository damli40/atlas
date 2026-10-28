// X2: hand-made outline answers (the shape of GET /outline/jobs/:id/outline) for the explorer's tests: odd folders,
// data joins, duplicated joins, unconfirmed parts and outlines at X1's maximum sizes. Plain data; adapted from the X2
// reviewer's fixtures (round 1). Every join gets its own code-link id unless the fixture names one.
import type { VerifiedJoin } from "../../src/outline/types";
import type { OutlineView } from "../../web/machines/explorer/outline-data";

const by = "model:muse-wonder-1.0" as const;
type FileIn = { path: string; lines: number; language?: "js" | "ts" | "py"; bytes?: number; fns?: { name: string; lineStart: number; lineEnd: number }[] };
type PartIn = { id: string; name?: string; status?: "confirmed" | "unconfirmed"; reasons?: string[]; spans: { path: string; lineStart: number; lineEnd: number; wholeFile?: boolean; ok?: boolean }[] };
type JoinIn = Partial<VerifiedJoin> & Pick<VerifiedJoin, "from" | "to" | "kind" | "status">;

export function mkView({ files, parts, joins }: { files: FileIn[]; parts: PartIn[]; joins: JoinIn[] }): OutlineView {
  return {
    jobId: "ol_fixture",
    source: { kind: "upload" },
    codeSha256: "f".repeat(64),
    files: files.map((f) => ({ path: f.path, language: f.language ?? "ts", bytes: f.bytes ?? f.lines * 30, sha256: "a".repeat(64) })),
    skipped: [],
    codeMap: {
      version: 1,
      files: files.map((f) => ({ path: f.path, language: f.language ?? "ts", lines: f.lines, symbols: (f.fns ?? []).map((s) => ({ id: `${f.path}#${s.name}`, name: s.name, kind: "function" as const, exported: true, lineStart: s.lineStart, lineEnd: s.lineEnd })), imports: [], parseNotes: [] })),
      edges: [],
      externals: [],
      notes: [],
    },
    verified: {
      version: 1,
      model: "muse-wonder-1.0",
      notInAnyPart: [],
      parts: parts.map((p) => ({
        id: p.id,
        name: { text: p.name ?? p.id, by },
        purpose: { text: `purpose of ${p.id}`, by },
        status: p.status ?? "confirmed",
        reasons: p.reasons ?? [],
        spans: p.spans.map((s) => ({ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd, ok: s.ok ?? true, ...(s.wholeFile ? { wholeFile: true as const } : {}) })),
        files: [...new Set(p.spans.map((s) => s.path))],
        patterns: [],
      })),
      joins: joins.map((j, i) => ({ id: j.id ?? `wonder:${i}`, codeEdges: j.status === "model-only" ? [] : [`e:${j.from}->${j.to}:${j.kind}:${i}`], ...j })) as VerifiedJoin[],
      counts: { confirmedParts: 0, unconfirmedParts: 0, confirmedJoins: 0, modelOnlyJoins: 0, codeOnlyJoins: 0 },
    },
    wonder: { model: "muse-wonder-1.0", attempts: [] },
    usage: null,
    labels: { parts: "", joins: "" },
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** One part spanning 12 files in 6 folders, plus a small part per file, each joined to it (review B3). */
export const spanFolders = () => {
  const files = range(12).map((i) => ({ path: `pkg${i % 6}/m${i}.ts`, lines: 120 }));
  const parts: PartIn[] = [
    { id: "wide", name: "Spans many folders", spans: files.map((f) => ({ path: f.path, lineStart: 1, lineEnd: 40 })) },
    ...files.map((f, i) => ({ id: `s${i}`, name: `Small ${i}`, spans: [{ path: f.path, lineStart: 41, lineEnd: 120 }] })),
  ];
  return mkView({ files, parts, joins: range(12).map((i) => ({ from: `s${i}`, to: "wide", kind: "calls" as const, status: "confirmed" as const })) });
};

/** A data join (X1 confirms "data" either way) next to an imports join over the SAME code link (review B2). */
export const dataSameLink = () =>
  mkView({
    files: [{ path: "a.ts", lines: 50 }, { path: "b.ts", lines: 50 }],
    parts: [
      { id: "store", name: "Store", spans: [{ path: "a.ts", lineStart: 1, lineEnd: 50, wholeFile: true }] },
      { id: "reader", name: "Reader", spans: [{ path: "b.ts", lineStart: 1, lineEnd: 50, wholeFile: true }] },
    ],
    joins: [
      { from: "reader", to: "store", kind: "imports", status: "confirmed", codeEdges: ["imports:b.ts->a.ts:./a@1"] },
      { from: "store", to: "reader", kind: "data", status: "confirmed", codeEdges: ["imports:b.ts->a.ts:./a@1"] },
    ],
  });

/** The same Wonder join twice, plus a real cycle (review minor 2). */
export const duplicated = () =>
  mkView({
    files: range(3).map((i) => ({ path: `c${i}.ts`, lines: 80 })),
    parts: range(3).map((i) => ({ id: `c${i}`, name: `Cycle ${i}`, spans: [{ path: `c${i}.ts`, lineStart: 1, lineEnd: 80, wholeFile: true }] })),
    joins: [
      { from: "c0", to: "c1", kind: "calls", status: "confirmed" },
      { from: "c1", to: "c2", kind: "calls", status: "confirmed" },
      { from: "c2", to: "c0", kind: "calls", status: "confirmed" },
      { from: "c1", to: "c2", kind: "calls", status: "confirmed" },
    ],
  });

/** X1's maximum sizes: 40 parts over 50 files in 10 folders, about `density` of all pairs joined (review B4). */
export const big = (nParts = 40, density = 0.1) => {
  const files = range(50).map((i) => ({ path: `d${i % 10}/f${i}.ts`, lines: 60 }));
  const parts = range(nParts).map((i) => ({ id: `p${i}`, name: `Part number ${i}`, spans: [{ path: files[i % 50]!.path, lineStart: 1, lineEnd: 60, wholeFile: true }] }));
  const joins: JoinIn[] = [];
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const a of parts) for (const b of parts) if (a !== b && rnd() < density) joins.push({ id: `code:${a.id}->${b.id}`, from: a.id, to: b.id, kind: "calls", status: "code-only" });
  return mkView({ files, parts, joins });
};
