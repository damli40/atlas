// U1 (D47): the drawing of one pasted file, before any run. A pure function from plain code's file outline (and, once
// a test is chosen, the gate-checked test) to the figure model the explorer's drawing code draws (figure.mjs).
//
// The object, in one sentence: the file is a tray on a deck of an instrument skid; each function or class is an
// instrument box standing on it, as tall as its lines; a steel line runs between two boxes where plain code found one
// calling the other; once a test is chosen, a second deck holds Atlas's stand-ins as small devices, each with a signal
// lamp, wired to the code boxes whose OWN lines call it (U3: plain code's call sites, src/call-sites.ts; no cable when
// plain code finds no such line), and a clock housing whose dial is Atlas's virtual clock.
//
// Structure only (D47): this module takes no run, no bet and no model sentence. Its inputs are the file's outline and
// the test; the test is what Atlas WILL do (its stand-ins and their scripted answers), never what happened.

import type { FileOutline, FilePart } from "../../../src/file-outline";
import type { ExperimentShape, StandInStep } from "../../../src/types";
import type { ExplorerModel } from "../explorer/model";
import { visibleText } from "../../../src/gate";
import { literal } from "../../../src/literal";
import { networkStepWords, LIBRARY_WORDS } from "../../../src/network-fake";
import { networkCallSites, standInCallSites, type CallSite } from "../../../src/call-sites";

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
  /**
   * U3: the file's text and language, so each device is wired to the parts whose own lines call it. Without them no
   * device gets a cable (a cable is a claim about the code, never drawn on a guess).
   */
  source?: string;
  language?: "js" | "ts" | "py";
}

/** What a box is, for the hover card. */
export type BenchPart =
  | {
      kind: "code";
      part: FilePart;
      callsTo: string[];
      calledBy: string[];
      /** U3: lines where this part's own code calls itself. */
      selfCalls?: number[];
      /** U3: decorators that wrap this part (a call to it runs theirs first). */
      wrappedBy?: string[];
      /** U3: the parts this one wraps (it is their decorator). */
      wraps?: string[];
      /** U3 (after a test is chosen): the devices this part's own lines call, with the lines. */
      devices?: { name: string; network: boolean; lines: number[] }[];
    }
  | {
      kind: "device";
      name: string;
      async: boolean;
      steps: string[];
      then: string;
      network?: boolean;
      /** U3: the parts whose own lines call this device (plain code's call sites); empty = none found, no cable drawn. */
      calledBy?: CallSite[];
      /** U3: why no cable is drawn, in plain words, when calledBy is empty. */
      noCable?: string;
      /** U3: for a stand-in, which argument of the tested function it is (1-based). */
      argument?: number;
    }
  | { kind: "clock"; fullMs: number; marks: number[] };

export type BenchModel = ExplorerModel & {
  extraLabel?: string;
  /** Each box id → what it is (hover cards). */
  parts: Record<string, BenchPart>;
  /** The function under test (a box id), or null. */
  tested: string | null;
};

/** U3: what happens after the last scripted answer, in plain words ("any 4th call fails"). */
export const thenWords = (then: "repeat_last" | "throw_exhausted", steps: number): string =>
  then === "repeat_last" ? "every later call does the same as the last" : `any ${ordinal(steps + 1)} or later call fails (no answer is scripted for it)`;
export const ordinal = (n: number): string => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n.toLocaleString("en-US")}${s}`;
};

const stepWords = (s: StandInStep, language?: "js" | "ts" | "py"): string =>
  s.do === "return" ? `returns ${short(literal(s.value, language))}${s.afterMs ? ` after ${s.afterMs.toLocaleString("en-US")} ms` : ""}` : s.do === "throw" ? `throws ${visibleText(s.errorName)}` : "never answers";
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
    const self = outline.selfCalls?.find((x) => x.name === p.name)?.lines;
    const wrappedBy = outline.joins.filter((j) => j.from === p.name && j.kind === "wraps").map((j) => j.to);
    const wraps = outline.joins.filter((j) => j.to === p.name && j.kind === "wraps").map((j) => j.from);
    parts[p.name] = {
      kind: "code",
      part: p,
      callsTo: outline.joins.filter((j) => j.from === p.name && j.kind !== "wraps").map((j) => j.to),
      calledBy: outline.joins.filter((j) => j.to === p.name && j.kind !== "wraps").map((j) => j.from),
      ...(self?.length ? { selfCalls: self } : {}),
      ...(wrappedBy.length ? { wrappedBy } : {}),
      ...(wraps.length ? { wraps } : {}),
    };
    return box(p.name, p.name, p.lineEnd - p.lineStart + 1, path) as ExplorerModel["boxes"][number];
  });
  const lines: ExplorerModel["lines"] = outline.joins.map((j) => ({ id: j.id, from: j.from, to: j.to, kind: j.kind === "calls" ? "calls" : "data", status: "plain" as unknown as "confirmed", codeEdges: j.lines.length, typeOnly: false }));
  const decks: ExplorerModel["decks"] = [{ folder: path, slots: boxes.map((b) => ({ kind: "box" as const, id: b.id, slices: [{ path, lines: b.lines }] })) }];
  const tested = test && outline.parts.some((p) => p.name === test.exportName) ? test.exportName : null;
  let extraLabel: string | undefined;
  if (test) {
    const slots: ExplorerModel["decks"][number]["slots"] = [];
    // U3: a device is wired only to the parts whose own lines call it (src/call-sites.ts). A cable is a claim about the
    // code, so with no call site found (or no file text given) there is no cable, and the card says why.
    const wire = (id: string, name: string, network: boolean, sites: CallSite[]) => {
      for (const site of sites) {
        if (!parts[site.part]) continue;
        lines.push({ id: `${site.part}=>${id}`, from: site.part, to: id, kind: "calls", status: "plain" as unknown as "confirmed", codeEdges: site.lines.length, typeOnly: false });
        const code = parts[site.part] as Extract<BenchPart, { kind: "code" }>;
        code.devices = [...(code.devices ?? []), { name, network, lines: site.lines }];
      }
    };
    test.args.forEach((s, index) => {
      if (s.kind !== "stand-in") return;
      const id = deviceId(s.name);
      if (parts[id]) return;
      const sites = tested && input.source !== undefined && input.language ? standInCallSites(input.source, input.language, outline, tested, index) : [];
      parts[id] = {
        kind: "device",
        name: s.name,
        async: s.async,
        steps: s.calls.map((c) => stepWords(c, input.language)),
        then: thenWords(s.then, s.calls.length),
        calledBy: sites,
        argument: index + 1,
        ...(sites.length === 0 ? { noCable: tested ? `Atlas passes it to ${tested} as argument ${index + 1}. Plain code found no line in this file that calls it directly, so no cable is drawn.` : "Plain code did not find the function under test in this file, so no cable is drawn." } : {}),
      };
      boxes.push(box(id, s.name, 0, STANDIN_FOLDER, { device: true }) as ExplorerModel["boxes"][number]);
      slots.push({ kind: "box", id, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
      wire(id, s.name, false, sites);
    });
    // U2 (D53): the network fake is a device too, with its own lamp; U3: wired to the parts that call the library.
    if (test.network) {
      const nf = test.network;
      const id = deviceId(nf.replaces);
      if (!parts[id]) {
        const sites = input.source !== undefined && input.language ? networkCallSites(input.source, input.language, outline, nf.replaces) : [];
        parts[id] = {
          kind: "device",
          name: nf.replaces,
          async: true,
          network: true,
          steps: nf.calls.map((c) => networkStepWords(c, (v) => literal(v, input.language))),
          then: thenWords(nf.then, nf.calls.length),
          calledBy: sites,
          ...(sites.length === 0 ? { noCable: `Plain code found no function in this file whose own lines call ${LIBRARY_WORDS[nf.replaces]}, so no cable is drawn.` } : {}),
        };
        boxes.push(box(id, nf.replaces, 0, STANDIN_FOLDER, { device: true }) as ExplorerModel["boxes"][number]);
        slots.push({ kind: "box", id, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
        wire(id, nf.replaces, true, sites);
      }
    }
    const dial = input.dial ?? { marks: [], fullMs: 1000 };
    parts[CLOCK_ID] = { kind: "clock", fullMs: dial.fullMs, marks: dial.marks };
    boxes.push(box(CLOCK_ID, "clock", 0, STANDIN_FOLDER, { dial: { marks: dial.marks.map((m) => m / dial.fullMs) } }) as ExplorerModel["boxes"][number]);
    slots.push({ kind: "box", id: CLOCK_ID, slices: [{ path: STANDIN_FOLDER, lines: 0 }] });
    decks.push({ folder: STANDIN_FOLDER, slots });
    const devs = [...test.args.flatMap((a) => (a.kind === "stand-in" ? [a.name] : [])), ...(test.network ? [`${test.network.replaces} (a fake network)`] : [])];
    const wiredTo = (name: string) => {
      const d = parts[deviceId(name)];
      const by = d?.kind === "device" ? (d.calledBy ?? []).map((c) => c.part) : [];
      return by.length ? `wired to ${by.join(" and ")}` : "not wired (no line found that calls it)";
    };
    const devWords = [...test.args.flatMap((a) => (a.kind === "stand-in" ? [`${a.name}, ${wiredTo(a.name)}`] : [])), ...(test.network ? [`${test.network.replaces} (a fake network), ${wiredTo(test.network.replaces)}`] : [])];
    extraLabel = `A second deck holds Atlas's stand-ins for this test: ${devs.length === 0 ? "none" : `${devWords.join("; ")}, each a small device with a signal lamp`}; and a clock whose dial is Atlas's simulated clock, from 0 to ${dial.fullMs.toLocaleString("en-US")} ms.`;
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
