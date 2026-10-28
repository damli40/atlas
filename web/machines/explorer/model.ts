// X2: the code explorer machine's model. A pure function from one outline answer (GET /outline/jobs/:id/outline)
// to what the machine may draw and what the card may say. It imports types only, plus the pure wording helpers of src/words.ts (tests/unit/x2-explorer.test.ts).
//
// The machine, in one sentence: a skid of instrument boxes on a base plate, one box per part plain code confirmed,
// each box standing on the tray of the file(s) its lines come from, trays grouped on one deck per folder; a steel
// line between two boxes is a join plain code found in the code (an import, a call or a use).
//
// The trust rules it follows (X1 "Routes for X2"):
// - Only CONFIRMED parts become boxes. Confirmed means "these lines exist, on whole definitions"; it never means the
//   purpose is true. Every name and purpose stays the model's words ({ text, by }) and the page names the model.
// - A join becomes a steel line ONLY when plain code found it: "confirmed" (Wonder said it and the code shows it) or
//   "code-only" (the code shows it; Wonder did not say it). A type-only join is drawn as a braided line and called
//   type-only (no link at run time).
// - A "model-only" join is NEVER a line. It is a chalk tag beside the machine: "Wonder says this; plain code could
//   not check it", or, only when plain code proved it (noLinkFound), "Atlas found no import or call for this".
// - Can't map, can't check, or no outline from Wonder: nothing is drawn; `notShown` holds the reason.

import type { CodeMapFile, CodeSymbol, JoinKind, ModelText, OutlineLanguage, VerifiedJoin } from "../../../src/outline/types";
import type { OutlineView } from "./outline-data";
import { lineSpan } from "../../../src/words";

export interface Span {
  path: string;
  lineStart: number;
  lineEnd: number;
  wholeFile: boolean;
  lines: number;
}

export type JoinStatus = VerifiedJoin["status"];

/** A join as one box's card lists it. */
export interface BoxJoin {
  id: string;
  other: string;
  /** out: this part imports, calls or uses the other. in: the other one does it to this part. */
  dir: "out" | "in";
  kind: JoinKind;
  status: JoinStatus;
  /** Drawn as a steel line (confirmed or code-only, both ends boxes). */
  drawn: boolean;
  codeEdges: number;
  typeOnly: boolean;
  noLinkFound: boolean;
  /** Plain code's reason (model-only), or what it saw instead of Wonder's quote (confirmed). */
  note?: string;
}

/** A function a person may bet on: an exported function inside the part's confirmed lines (from the code map). */
export interface BetChoice {
  name: string;
  path: string;
  line: number;
  signature?: string;
  language: OutlineLanguage;
  /** Whether the paste flow can take this file. */
  ok: boolean;
  /** Why not (ok false), in plain words. */
  why?: string;
  /** A plain warning that does not stop the hand-off (the file imports other modules). */
  note?: string;
}

export interface Box {
  id: string;
  name: ModelText;
  purpose: ModelText;
  spans: Span[];
  lines: number;
  joins: BoxJoin[];
  bets: BetChoice[];
}

export interface Line {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  status: "confirmed" | "code-only";
  codeEdges: number;
  typeOnly: boolean;
}

export interface Chalk {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  /** "Wonder says this; plain code could not check it", or "Atlas found no import or call for this". */
  words: string;
  reason: string;
  noLinkFound: boolean;
}

export type Slot = { kind: "box"; id: string; slices: { path: string; lines: number }[] } | { kind: "empty"; path: string };

/** One deck per folder ("" is the codebase's top folder). */
export interface Deck {
  folder: string;
  slots: Slot[];
}

export interface ExplorerModel {
  notShown: string | null;
  model: string;
  boxes: Box[];
  lines: Line[];
  chalk: Chalk[];
  unconfirmed: { id: string; name: ModelText; reasons: string[] }[];
  notDrawn: { id: string; from: string; to: string; why: string }[];
  decks: Deck[];
  files: string[];
  notInAnyPart: string[];
  /** "damli40/atlas · server/meta" or "uploaded files". */
  source: string;
  /** The top folder's name on its deck plate ("server/meta/", or "./" for an upload). */
  rootFolder: string;
  /** The full commit for a GitHub source (the card shows it), else null. Never shown as "verified". */
  commit: string | null;
  codeSha256: string;
  skipped: { path: string; reason: string }[];
}

export const CHALK_WORDS = "Wonder says this; plain code could not check it";
export const NO_LINK_WORDS = "Atlas found no import or call for this";
export const LINES_CONFIRMED = "lines confirmed";
/** The paste flow's limits (src/pasted-code.ts PASTED_MAX_BYTES, server/paste.ts PASTED_MAX_LINES), restated here: model.ts imports types only. */
export const PASTE_MAX_BYTES = 64 * 1024;
export const PASTE_MAX_LINES = 2000;
export const BET_LANGUAGES: readonly OutlineLanguage[] = ["js", "ts", "py"];

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function betsOf(spans: Span[], view: OutlineView): BetChoice[] {
  const out: BetChoice[] = [];
  const mapFile = new Map<string, CodeMapFile>(view.codeMap.files.map((f) => [f.path, f]));
  const fileInfo = new Map(view.files.map((f) => [f.path, f]));
  for (const span of spans) {
    const f = mapFile.get(span.path);
    const info = fileInfo.get(span.path);
    if (!f || !info) continue;
    const inSpan = (s: CodeSymbol) => s.lineStart >= span.lineStart && s.lineEnd <= span.lineEnd;
    const fns = f.symbols.filter((s) => s.kind === "function" && s.exported && !s.parent && inSpan(s));
    let why: string | undefined;
    if (!BET_LANGUAGES.includes(info.language)) why = "Atlas runs only JavaScript, TypeScript and Python files";
    else if (info.bytes > PASTE_MAX_BYTES) why = `the file is ${Math.ceil(info.bytes / 1024)} KB; the paste flow reads one file of at most 64 KB`;
    else if (f.lines > PASTE_MAX_LINES) why = `the file has ${f.lines} lines; the paste flow reads one file of at most ${PASTE_MAX_LINES.toLocaleString("en-US")} lines`;
    const runtimeImports = f.imports.filter((i) => i.kind !== "type-only");
    const note = runtimeImports.length
      ? `${span.path} imports ${[...new Set(runtimeImports.map((i) => i.specifier))].slice(0, 3).join(", ")}${runtimeImports.length > 3 ? " and more" : ""}; Atlas runs one pasted file on its own, so a run of it may only say "can't check"`
      : undefined;
    for (const s of fns) {
      if (out.some((b) => b.name === s.name && b.path === span.path)) continue;
      out.push({ name: s.name, path: span.path, line: s.lineStart, ...(s.signature ? { signature: s.signature } : {}), language: info.language, ok: why === undefined, ...(why ? { why } : {}), ...(note && !why ? { note } : {}) });
    }
  }
  return out;
}

export function explorerModel(view: OutlineView): ExplorerModel {
  const source =
    view.source.kind === "github" ? `${view.source.repo}${view.source.subfolder ? ` · ${view.source.subfolder}` : ""}` : "uploaded files";
  const commit = view.source.kind === "github" ? view.source.commit : null;
  const v = view.verified;
  const base = {
    model: view.wonder.model,
    boxes: [],
    lines: [],
    chalk: [],
    notDrawn: [],
    decks: [],
    files: view.files.map((f) => f.path),
    notInAnyPart: v?.notInAnyPart ?? [],
    source,
    rootFolder: view.source.kind === "github" && view.source.subfolder ? `${view.source.subfolder.replace(/\/+$/, "")}/` : "./",
    commit,
    codeSha256: view.codeSha256,
    skipped: view.skipped,
  };
  const unconfirmedOf = () => (v ? v.parts.filter((p) => p.status !== "confirmed").map((p) => ({ id: p.id, name: p.name, reasons: p.reasons })) : []);
  if (view.codeMap.cantMap) return { ...base, notShown: `Can't check: plain code could not map this codebase (${view.codeMap.cantMap}), so nothing is drawn.`, unconfirmed: [] };
  if (!v) return { ...base, notShown: `Nothing is drawn: Muse Wonder (${view.wonder.model}) gave no usable outline${view.wonder.failure ? `: ${view.wonder.failure}` : "."}`, unconfirmed: [] };
  if (v.cantCheck) return { ...base, notShown: `Can't check: ${v.cantCheck}. No part is drawn.`, unconfirmed: unconfirmedOf() };

  const boxes: Box[] = [];
  for (const p of v.parts) {
    if (p.status !== "confirmed") continue;
    const spans: Span[] = p.spans.filter((s) => s.ok).map((s) => ({ path: s.path, lineStart: s.lineStart, lineEnd: s.lineEnd, wholeFile: s.wholeFile === true, lines: s.lineEnd - s.lineStart + 1 }));
    if (spans.length === 0) continue;
    boxes.push({ id: p.id, name: p.name, purpose: p.purpose, spans, lines: spans.reduce((a, s) => a + s.lines, 0), joins: [], bets: betsOf(spans, view) });
  }
  if (boxes.length === 0) return { ...base, notShown: "No part of this outline is confirmed by plain code, so nothing is drawn.", unconfirmed: unconfirmedOf() };

  const isBox = new Set(boxes.map((b) => b.id));
  const lines: Line[] = [];
  const chalk: Chalk[] = [];
  const notDrawn: ExplorerModel["notDrawn"] = [];
  for (const j of v.joins) {
    let drawn = false;
    const typeOnly = j.typeOnly === true;
    const noLinkFound = j.noLinkFound === true;
    if (j.status === "model-only") {
      chalk.push({ id: j.id, from: j.from, to: j.to, kind: j.kind, words: noLinkFound ? NO_LINK_WORDS : CHALK_WORDS, reason: j.reason ?? "", noLinkFound });
    } else if (isBox.has(j.from) && isBox.has(j.to) && j.from !== j.to) {
      lines.push({ id: j.id, from: j.from, to: j.to, kind: j.kind, status: j.status, codeEdges: j.codeEdges.length, typeOnly });
      drawn = true;
    } else {
      notDrawn.push({ id: j.id, from: j.from, to: j.to, why: j.from === j.to ? "it joins a part to itself" : "one of its parts is not confirmed, so it has no box to land on" });
    }
    const note = j.reason ? { note: j.reason } : {};
    for (const b of boxes) {
      const common = { id: j.id, kind: j.kind, status: j.status, drawn, codeEdges: j.codeEdges.length, typeOnly, noLinkFound, ...note };
      if (b.id === j.from) b.joins.push({ ...common, other: j.to, dir: "out" });
      if (b.id === j.to && j.from !== j.to) b.joins.push({ ...common, other: j.from, dir: "in" });
    }
  }
  return { ...base, notShown: null, boxes, lines, chalk, notDrawn, unconfirmed: unconfirmedOf(), decks: decksOf(view.files.map((f) => f.path), boxes) };
}

/**
 * One deck per folder, top folder first, then folders in path order. On a deck, files go in path order; within a
 * file, boxes that cover only that file come first (by first line), then boxes that also cover other files, whose
 * other files' trays follow at once (so a box that spans two files stands across the joint of their trays, on the
 * deck of its first file). A file no box covers gets an empty tray.
 */
export function decksOf(files: string[], boxes: Box[]): Deck[] {
  const folders = [...new Set(files.map(folderOf))].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const done = new Set<string>();
  const placed = new Set<string>();
  const covering = (path: string) => boxes.filter((b) => b.spans.some((s) => s.path === path));
  const firstLine = (b: Box, path: string) => Math.min(...b.spans.filter((s) => s.path === path).map((s) => s.lineStart));
  const linesIn = (b: Box, p: string) => b.spans.filter((s) => s.path === p).reduce((a, s) => a + s.lines, 0);
  const decks: Deck[] = [];
  for (const folder of folders) {
    const slots: Slot[] = [];
    const emit = (path: string): void => {
      if (done.has(path)) return;
      done.add(path);
      const all = covering(path);
      if (all.length === 0) {
        slots.push({ kind: "empty", path });
        return;
      }
      const mine = all.filter((b) => !placed.has(b.id));
      const single = mine.filter((b) => b.spans.every((s) => s.path === path)).sort((a, b) => firstLine(a, path) - firstLine(b, path));
      const multi = mine.filter((b) => b.spans.some((s) => s.path !== path)).sort((a, b) => firstLine(a, path) - firstLine(b, path));
      for (const b of [...single, ...multi]) {
        placed.add(b.id);
        const others = [...new Set(b.spans.map((s) => s.path).filter((p) => p !== path))].sort();
        slots.push({ kind: "box", id: b.id, slices: [path, ...others].map((p) => ({ path: p, lines: linesIn(b, p) })) });
        for (const p of others) emit(p);
      }
    };
    for (const f of [...files].filter((f) => folderOf(f) === folder).sort()) emit(f);
    if (slots.length) decks.push({ folder, slots });
  }
  // Never drop a box: one still unplaced stands on a last deck on its own trays.
  const rest: Slot[] = [];
  for (const b of boxes) {
    if (placed.has(b.id)) continue;
    placed.add(b.id);
    const paths = [...new Set(b.spans.map((s) => s.path))];
    rest.push({ kind: "box", id: b.id, slices: paths.map((p) => ({ path: p, lines: linesIn(b, p) })) });
  }
  if (rest.length) decks.push({ folder: "(other)", slots: rest });
  return decks;
}

export function authorOf(by: `model:${string}`): string {
  return by.replace(/^model:/, "");
}

/** "client.ts · whole file (lines 1–364)" or "client.ts · lines 223–363". */
export function spanText(s: Span): string {
  return s.wholeFile ? `${s.path} · whole file (${lineSpan(s.lineStart, s.lineEnd)})` : `${s.path} · ${lineSpan(s.lineStart, s.lineEnd)}`;
}

/** The status of a join in words, as the card and the list show it. */
export function joinWords(j: Pick<BoxJoin, "status" | "typeOnly" | "noLinkFound">): string {
  if (j.status === "model-only") return j.noLinkFound ? NO_LINK_WORDS : CHALK_WORDS;
  const t = j.typeOnly ? " (type-only: no link at run time)" : "";
  return j.status === "code-only" ? `found by plain code; Wonder did not name it${t}` : `confirmed: Wonder named it and plain code found it${t}`;
}

/** A chalk tag's sentence: the words, then plain code's reason (once: X1's reason already starts with the words). */
export function chalkText(c: Pick<Chalk, "words" | "reason">): string {
  const r = c.reason.trim();
  if (!r) return `${c.words}.`;
  return r.startsWith(c.words) ? (/[.!?]$/.test(r) ? r : `${r}.`) : `${c.words}. ${r}${/[.!?]$/.test(r) ? "" : "."}`;
}
