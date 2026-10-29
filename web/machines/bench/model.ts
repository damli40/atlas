// U1 (D47): the drawing of one pasted file, before any run. A pure function from plain code's file outline (and, once
// a test is chosen, the gate-checked test) to the figure model the explorer's drawing code draws (figure.mjs).
//
// The object, in one sentence: the file is a tray on a deck of an instrument skid; each function or class is an
// instrument box standing on it, as tall as its lines; a steel line runs between two boxes where plain code found one
// calling the other; once a test is chosen, a second deck holds Atlas's stand-ins as small devices, each with a signal
// lamp and wired to the function under test, and a clock housing whose dial is Atlas's virtual clock.
//
// Structure only (D47): this module takes no run, no bet and no model sentence. Its inputs are the file's outline and
// the test; the test is what Atlas WILL do (its stand-ins and their scripted answers), never what happened.

import type { FileOutline, FilePart } from "../../../src/file-outline";
import type { ExperimentShape, StandInStep } from "../../../src/types";
import type { ExplorerModel } from "../explorer/model";
import { visibleText } from "../../../src/gate";
import { canonicalJson } from "../../../src/seal";
import { networkStepWords } from "../../../src/network-fake";

export type CallTest = Extract<ExperimentShape, { shape: "call-function" }>;

/** The id of the clock housing's box (never a function name: it has a space). */
export const CLOCK_ID = "clock housing";
export const deviceId = (standIn: string) => `stand-in ${standIn}`;
/** U2: short enough for the deck plate (the longer "Atlas's stand-ins" was cut to "Atlas's st…"). */
export const STANDIN_FOLDER = "stand-ins";

export interface BenchInput {
  /** The file name shown on its deck plate ("pasted.ts"). */
  fileName: string;
  outline: FileOutline;
  /** The chosen test, or null before one is chosen. */
  test: CallTest | null;
  /** Times (ms) the dial marks with a longer tick, and the dial's full sweep (ms), both from the test. */
  dial?: { marks: number[]; fullMs: number };
}

/** What a box is, for the hover card. */
export type BenchPart =
  | { kind: "code"; part: FilePart; callsTo: string[]; calledBy: string[] }
  | { kind: "device"; name: string; async: boolean; steps: string[]; then: string; network?: boolean }
  | { kind: "clock"; fullMs: number; marks: number[] };

export type BenchModel = ExplorerModel & {
  extraLabel?: string;
  /** Each box id → what it is (hover cards). */
  parts: Record<string, BenchPart>;
  /** The function under test (a box id), or null. */
  tested: string | null;
};

const stepWords = (s: StandInStep): string =>
  s.do === "return" ? `returns ${short(canonicalJson(s.value))}${s.afterMs ? ` after ${s.afterMs.toLocaleString("en-US")} ms` : ""}` : s.do === "throw" ? `throws ${visibleText(s.errorName)}` : "never answers";
const short = (s: string) => {
  const v = visibleText(s);
  return v.length > 40 ? `${v.slice(0, 39)}…` : v;
};

export function benchModel(input: BenchInput): BenchModel {
  const { outline, test } = input;
  const path = input.fileName;
  const parts: Record<string, BenchPart> = {};
  const box = (id: string, text: string, lines: number, slicePath: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: { text, by: "plain code" },
    purpose: { text: "", by: "plain code" },
    spans: [{ path: slicePath, lineStart: 1, lineEnd: Math.max(1, lines), wholeFile: false, lines }],
    lines,
    joins: [] as ExplorerModel["boxes"][number]["joins"],
    bets: [],
    ...extra,
  });
  const boxes: ExplorerModel["boxes"] = outline.parts.map((p) => {
    parts[p.name] = { kind: "code", part: p, callsTo: outline.joins.filter((j) => j.from === p.name).map((j) => j.to), calledBy: outline.joins.filter((j) => j.to === p.name).map((j) => j.from) };
    return box(p.name, p.name, p.lineEnd - p.lineStart + 1, path) as ExplorerModel["boxes"][number];
  });
  const lines: ExplorerModel["lines"] = outline.joins.map((j) => ({ id: j.id, from: j.from, to: j.to, kind: j.kind === "calls" ? "calls" : "data", status: "plain" as unknown as "confirmed", codeEdges: j.lines.length, typeOnly: false }));
  const decks: ExplorerModel["decks"] = [{ folder: path, slots: boxes.map((b) => ({ kind: "box" as const, id: b.id, slices: [{ path, lines: b.lines }] })) }];
  const tested = test && outline.parts.some((p) => p.name === test.exportName) ? test.exportName : null;
  let extraLabel: string | undefined;
  if (test) {
    const standIns = test.args.filter((a): a is Extract<CallTest["args"][number], { kind: "stand-in" }> => a.kind === "stand-in");
    const slots: ExplorerModel["decks"][number]["slots"] = [];
    for (const s of standIns) {
      const id = deviceId(s.name);
      if (parts[id]) continue;
      parts[id] = { kind: "device", name: s.name, async: s.async, steps: s.calls.map(stepWords), then: s.then === "repeat_last" ? "every later call does the same as the last" : "any later call throws AtlasStandInExhausted" };
      boxes.push(box(id, s.name, 0, STANDIN_FOLDER, { device: true }) as ExplorerModel["boxes"][number]);
      slots.push({ kind: "box", id, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
      if (tested) lines.push({ id: `${tested}=>${id}`, from: tested, to: id, kind: "calls", status: "plain" as unknown as "confirmed", codeEdges: 1, typeOnly: false });
    }
    // U2 (D53): the network fake is a device too, wired to the function, with its own lamp.
    if (test.network) {
      const nf = test.network;
      const id = deviceId(nf.replaces);
      if (!parts[id]) {
        parts[id] = { kind: "device", name: nf.replaces, async: true, network: true, steps: nf.calls.map((c) => networkStepWords(c, canonicalJson)), then: nf.then === "repeat_last" ? "every later call does the same as the last" : "any later call throws AtlasStandInExhausted" };
        boxes.push(box(id, nf.replaces, 0, STANDIN_FOLDER, { device: true }) as ExplorerModel["boxes"][number]);
        slots.push({ kind: "box", id, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
        if (tested) lines.push({ id: `${tested}=>${id}`, from: tested, to: id, kind: "calls", status: "plain" as unknown as "confirmed", codeEdges: 1, typeOnly: false });
      }
    }
    const dial = input.dial ?? { marks: [], fullMs: 1000 };
    parts[CLOCK_ID] = { kind: "clock", fullMs: dial.fullMs, marks: dial.marks };
    boxes.push(box(CLOCK_ID, "clock", 0, STANDIN_FOLDER, { dial: { marks: dial.marks.map((m) => m / dial.fullMs) } }) as ExplorerModel["boxes"][number]);
    slots.push({ kind: "box", id: CLOCK_ID, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
    decks.push({ folder: STANDIN_FOLDER, slots });
    const devs = [...standIns.map((s) => s.name), ...(test.network ? [`${test.network.replaces} (a fake network)`] : [])];
    extraLabel = `A second deck holds Atlas's stand-ins for this test: ${devs.length === 0 ? "none" : devs.join(", ")}${tested && devs.length ? `, each a small device with a signal lamp, wired to ${tested}` : ""}; and a clock housing whose dial is Atlas's virtual clock, from 0 to ${dial.fullMs.toLocaleString("en-US")} ms.`;
  }
  // Each box's joins, for the pick highlight (applyPick lights the picked box's drawn lines).
  for (const b of boxes) {
    b.joins = lines
      .filter((l) => l.from === b.id || l.to === b.id)
      .map((l) => ({ id: l.id, other: l.from === b.id ? l.to : l.from, dir: l.from === b.id ? ("out" as const) : ("in" as const), kind: l.kind, status: "confirmed" as const, drawn: true, codeEdges: l.codeEdges, typeOnly: false, noLinkFound: false }));
  }
  return {
    notShown: boxes.length === 0 ? "plain code found no function or class in this file to draw" : null,
    model: "plain code",
    boxes,
    lines,
    chalk: [],
    unconfirmed: [],
    notDrawn: [],
    decks,
    files: [path],
    notInAnyPart: [],
    source: path,
    rootFolder: path,
    partNames: Object.fromEntries(boxes.map((b) => [b.id, b.name.text])),
    commit: null,
    codeSha256: "",
    skipped: [],
    parts,
    tested,
    ...(extraLabel ? { extraLabel } : {}),
  } as unknown as BenchModel;
}

/** The dial's sweep for a test: a round number of ms at least twice the longest mark (at least 100 ms). */
export function dialFullMs(marks: readonly number[]): number {
  const top = Math.max(0, ...marks) * 2;
  if (top <= 100) return 100;
  const p = 10 ** Math.floor(Math.log10(top));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= top) return m * p;
  return 10 * p;
}
