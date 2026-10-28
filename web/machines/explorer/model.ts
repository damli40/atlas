// X2 prototype: the code explorer machine's model. A pure function from one outline record to what the
// machine may draw. It imports types only (tests/unit/x2-explorer.test.ts checks that).
//
// The machine, in one sentence: a skid of instrument boxes on a base plate, one box per part plain code
// confirmed, each box standing on the tray of the file(s) its lines come from; a steel line between two
// boxes is a join plain code found in the code (an import or a call), and a box is as wide as its lines.
//
// The trust rules it follows:
// - Only CONFIRMED parts become boxes. "Confirmed" means the line ranges exist in the files as Wonder said;
//   it does not mean Wonder's purpose sentence is true. Every name and purpose is kept as the model's words
//   ({ text, by }), and the page always shows who wrote it.
// - A join becomes a steel line ONLY when plain code found it: status "confirmed" (Wonder said it and the
//   code shows it) or "code-only" (the code shows it; Wonder did not say it). Both its ends must be boxes.
// - A "model-only" join (Wonder said it; plain code could not check it) is NEVER a line. It goes to the
//   chalk list beside the machine, with the words "Wonder says this; plain code could not check it".
// - When the outline could not be checked at all, or no part is confirmed, nothing is drawn: `notShown`
//   holds the reason the card prints instead.

import type { JoinKind, OutlineRecord, OutlineRecordJoin } from "./outline-data";

/** A sentence a model wrote, kept with its author. */
export interface ModelWords {
  text: string;
  by: `model:${string}`;
}

export interface Span {
  path: string;
  lineStart: number;
  lineEnd: number;
  wholeFile: boolean;
  lines: number;
}

export type JoinStatus = OutlineRecordJoin["status"];

/** A join as one box's card lists it. */
export interface BoxJoin {
  id: string;
  /** The other part's id. */
  other: string;
  /** out: this part imports or calls the other. in: the other imports or calls this part. */
  dir: "out" | "in";
  kind: JoinKind;
  status: JoinStatus;
  /** Drawn as a steel line (confirmed or code-only, both ends boxes). */
  drawn: boolean;
  codeEdges: number;
  /** Plain code's note when Wonder's quoted evidence line did not match (the code map's own links are used). */
  note?: string;
}

export interface Box {
  id: string;
  name: ModelWords;
  purpose: ModelWords;
  spans: Span[];
  /** Lines this part covers, summed over its spans. Sets the box's width. */
  lines: number;
  joins: BoxJoin[];
}

/** A join plain code found: drawn as a steel line between two boxes. */
export interface Line {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  status: "confirmed" | "code-only";
  codeEdges: number;
}

/** A join only Wonder states: never drawn as a connection; a chalk tag in the list beside the machine. */
export interface Chalk {
  id: string;
  from: string;
  to: string;
  kind: JoinKind;
  words: string;
  reason: string;
}

/** One place on the skid, left to right: a box (with one slice per file it covers) or an empty file tray. */
export type Slot =
  | { kind: "box"; id: string; slices: { path: string; lines: number }[] }
  | { kind: "empty"; path: string };

export interface ExplorerModel {
  notShown: string | null;
  model: string;
  boxes: Box[];
  lines: Line[];
  chalk: Chalk[];
  /** Parts Wonder proposed that plain code did not confirm: listed, never drawn. */
  unconfirmed: { id: string; name: ModelWords; reasons: string[] }[];
  /** Joins plain code found whose ends are not both boxes: listed, never drawn. */
  notDrawn: { id: string; from: string; to: string; why: string }[];
  /** Left-to-right order of boxes and file trays. */
  slots: Slot[];
  files: string[];
  splitFiles: string[];
  notInAnyPart: string[];
  source: string;
}

export const CHALK_WORDS = "Wonder says this; plain code could not check it";

const RANGE = /^(.+):(\d+)-(\d+)( \(whole file\))?$/;

export function spanOf(range: string): Span | null {
  const m = RANGE.exec(range);
  if (!m) return null;
  const lineStart = Number(m[2]);
  const lineEnd = Number(m[3]);
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineEnd < lineStart) return null;
  return { path: m[1]!, lineStart, lineEnd, wholeFile: Boolean(m[4]), lines: lineEnd - lineStart + 1 };
}

export function explorerModel(record: OutlineRecord): ExplorerModel {
  const by = `model:${record.wonder.model}` as const;
  const words = (text: string): ModelWords => ({ text, by });
  const source =
    record.source.kind === "github"
      ? `${record.source.repo}${record.source.subfolder ? `/${record.source.subfolder}` : ""} at ${record.source.commit.slice(0, 7)}`
      : "an uploaded codebase";
  const empty = (notShown: string): ExplorerModel => ({
    notShown,
    model: record.wonder.model,
    boxes: [],
    lines: [],
    chalk: [],
    unconfirmed: record.parts.map((p) => ({ id: p.id, name: words(p.name), reasons: p.reasons })),
    notDrawn: [],
    slots: [],
    files: record.files.map((f) => f.path),
    splitFiles: record.splitFiles,
    notInAnyPart: record.notInAnyPart,
    source,
  });
  if (record.cantCheck) return empty(`Plain code could not check this outline, so no part is drawn: ${record.cantCheck}`);

  const confirmed = record.parts.filter((p) => p.status === "confirmed");
  const boxes: Box[] = [];
  const unconfirmed: ExplorerModel["unconfirmed"] = record.parts
    .filter((p) => p.status !== "confirmed")
    .map((p) => ({ id: p.id, name: words(p.name), reasons: p.reasons }));
  for (const p of confirmed) {
    const spans = p.ranges.map(spanOf);
    if (spans.length === 0 || spans.some((s) => s === null)) {
      // A confirmed part whose ranges this page cannot read is not drawn: it is listed with the reason.
      unconfirmed.push({ id: p.id, name: words(p.name), reasons: ["its line ranges could not be read by this page"] });
      continue;
    }
    const ok = spans as Span[];
    boxes.push({ id: p.id, name: words(p.name), purpose: words(p.purposeByModel), spans: ok, lines: ok.reduce((a, s) => a + s.lines, 0), joins: [] });
  }
  if (boxes.length === 0) return { ...empty("No part of this outline is confirmed by plain code, so nothing is drawn."), unconfirmed };

  const isBox = new Set(boxes.map((b) => b.id));
  const lines: Line[] = [];
  const chalk: Chalk[] = [];
  const notDrawn: ExplorerModel["notDrawn"] = [];
  for (const j of record.joins) {
    let drawn = false;
    if (j.status === "model-only") {
      chalk.push({ id: j.id, from: j.from, to: j.to, kind: j.kind, words: CHALK_WORDS, reason: j.reason ?? CHALK_WORDS });
    } else if (j.status === "confirmed" || j.status === "code-only") {
      if (isBox.has(j.from) && isBox.has(j.to) && j.from !== j.to) {
        lines.push({ id: j.id, from: j.from, to: j.to, kind: j.kind, status: j.status, codeEdges: j.codeEdges });
        drawn = true;
      } else {
        notDrawn.push({ id: j.id, from: j.from, to: j.to, why: j.from === j.to ? "it joins a part to itself" : "one of its parts is not confirmed, so it has no box to land on" });
      }
    }
    const note = j.status === "confirmed" && j.wonderEvidenceMatches === false && j.reason ? { note: j.reason } : {};
    for (const b of boxes) {
      if (b.id === j.from) b.joins.push({ id: j.id, other: j.to, dir: "out", kind: j.kind, status: j.status, drawn, codeEdges: j.codeEdges, ...note });
      if (b.id === j.to && j.from !== j.to) b.joins.push({ id: j.id, other: j.from, dir: "in", kind: j.kind, status: j.status, drawn, codeEdges: j.codeEdges, ...note });
    }
  }

  return {
    notShown: null,
    model: record.wonder.model,
    boxes,
    lines,
    chalk,
    unconfirmed,
    notDrawn,
    slots: slotsOf(record.files.map((f) => f.path), boxes),
    files: record.files.map((f) => f.path),
    splitFiles: record.splitFiles,
    notInAnyPart: record.notInAnyPart,
    source,
  };
}

/**
 * Left-to-right order: files in path order; within a file, boxes that cover only that file first (by first
 * line), then boxes that also cover other files, whose other files' trays follow at once, so a box that
 * spans two files stands across the joint of their two trays. A file no box covers gets an empty tray.
 */
export function slotsOf(files: string[], boxes: Box[]): Slot[] {
  const slots: Slot[] = [];
  const done = new Set<string>();
  const placed = new Set<string>();
  const covering = (path: string) => boxes.filter((b) => b.spans.some((s) => s.path === path));
  const firstLine = (b: Box, path: string) => Math.min(...b.spans.filter((s) => s.path === path).map((s) => s.lineStart));
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
      const linesIn = (p: string) => b.spans.filter((s) => s.path === p).reduce((a, s) => a + s.lines, 0);
      slots.push({ kind: "box", id: b.id, slices: [path, ...others].map((p) => ({ path: p, lines: linesIn(p) })) });
      for (const p of others) emit(p);
    }
  };
  for (const f of files) emit(f);
  // A box whose files are not in the record's file list still gets a place (its spans name the files).
  for (const b of boxes) if (!placed.has(b.id)) for (const s of b.spans) emit(s.path);
  // Never drop a box: one still unplaced stands at the end on its own trays.
  for (const b of boxes) {
    if (placed.has(b.id)) continue;
    placed.add(b.id);
    const paths = [...new Set(b.spans.map((s) => s.path))];
    slots.push({ kind: "box", id: b.id, slices: paths.map((p) => ({ path: p, lines: b.spans.filter((s) => s.path === p).reduce((a, s) => a + s.lines, 0) })) });
  }
  return slots;
}

/** The model's name as the page prints it next to its words (D10: Meta model names stay visible). */
export function authorOf(by: `model:${string}`): string {
  return by.replace(/^model:/, "");
}
