// D65 style proof: the code as a machine. Plain code picks every part from what Atlas already read: the outline's functions and joins, the
// masked source (comments and strings removed) for loops, throws and returns, the call facts for waits, the chosen test for what is faked.
// Nothing comes from a model. All housings are one size: size says nothing about the code. Pure.

import { cutValue } from "../../src/cut-value";
import { networkCallSites } from "../../src/call-sites";
import type { FileOutline } from "../../src/file-outline";
import { benchModel, type BenchModel, type CallTest } from "../../web/machines/bench/model";
import type { ThrowSite } from "../../src/outline/types";
import type { Pt } from "../hand";
import { nameWords, roleOf } from "./part-name";
import type { RenderSpec } from "../spec";
import { auditMachine, type MachineFacts } from "../machine/audit";
import { rectsOverlap, sample, solidHitsRect, solidOf, segDist, type Rect, type Solid, segmentsCross } from "../machine/geometry";
import { K, codeWidth, textWidth, block, chevrons, dial, drum, esc, flange, floorShadow, hopper, iso, pipe, ringAround, screws, sheetOf, stemDial, threadPath, ticket, topOf, wheel, type Plan, type Sheet, type W } from "../machine/pencil";
import { PIPE_R, PIPE_Z, routeAll, type Job, type Owner } from "../machine/route";

/** Past this the machine can't be drawn large enough to read: the page says so in words and shows the chart. */
export const MACHINE_PART_LIMIT = 8;
/** The smallest any word may be on screen: below this the page shows the chart. */
export const MACHINE_MIN_WORD_PX = 11;
export const CANT_DRAW = "The machine can't show this file's pipes clearly, so here is the box chart.";
/** Past this many parts the box chart is a tower of tiny boxes: the page lists them instead. */
export const LIST_FROM_PARTS = 16;
export const NOTHING_TO_DRAW = "Nothing here to draw.";
export const TOO_SMALL = "In a window this size the machine's words would be under 11 px, so here is the box chart. A wider window shows the machine.";

/** The machine's parts from a proof file's own code and test: what a shared picture needs, with no code text in it. */
export function machinePartsOfFile(source: string, language: "js" | "ts" | "py", test: CallTest, outline: FileOutline): MachineParts {
  const model = benchModel({ fileName: "pasted", outline, test, source, language });
  return machineParts({ ...model, tested: test.exportName }, outline, source, language);
}

export interface Housing {
  id: string;
  name: string;
  kind: "function" | "class";
  lines: [number, number];
  exported: boolean;
  tested: boolean;
  selfCalls: number[];
  loops: number[];
  waits: number[];
  throws: number[];
  returns: number[];
  throwSites: ThrowSite[];
  /** A word for a part with no name of its own (an unnamed default export), from syntax alone. */
  role?: string;
}
export interface Port {
  id: string;
  name: string;
  faked: boolean;
  from: string[];
}
export interface MachineParts {
  housings: Housing[];
  ports: Port[];
  pipes: { from: string; to: string; kind: "calls" | "uses" | "wraps" }[];
  /** Every place in the file that could produce an error. Only for working out a run's end: never sent to a reader (publicParts). */
  fileThrows?: ThrowSite[];
  /** How many functions and classes the file really defines, when the outline kept fewer. */
  partsInFile?: number;
}

/** What the machine is made of. Every field comes from the syntax of the code, or the test the person is looking at. When unsure, the part is left off. */
export function machineParts(model: BenchModel, outline: FileOutline, source: string, language: "js" | "ts" | "py"): MachineParts {
  const waits = (outline as { callFacts?: { waits: { line: number }[] } }).callFacts?.waits ?? [];
  const housings: Housing[] = [];
  for (const b of model.boxes) {
    const p = model.parts[b.id];
    if (!p || p.kind !== "code") continue;
    const a = p.part.lineStart;
    const z = p.part.lineEnd;
    const body = outline.bodies?.[p.part.name];
    const own = (line: number) => !(body?.nested ?? []).some(([from, to]) => from <= line && line <= to);
    const isFn = p.part.kind === "function";
    housings.push({
      id: b.id,
      name: p.part.name,
      kind: isFn ? "function" : "class",
      lines: [a, z],
      exported: p.part.exported,
      tested: model.tested === b.id,
      selfCalls: isFn && body ? (p.selfCalls ?? []).filter(own) : [],
      loops: isFn ? (body?.loops ?? []) : [],
      waits: isFn ? waits.filter((w) => w.line >= a && w.line <= z).map((w) => w.line) : [],
      throws: isFn ? (body?.throws ?? []).map((t) => t.line) : [],
      throwSites: isFn ? (body?.throws ?? []) : [],
      returns: isFn ? (body?.returns ?? []) : [],
      ...(roleOf(p.part.name, language) ? { role: roleOf(p.part.name, language)! } : {}),
    });
  }
  const ids = new Set(housings.map((h) => h.id));
  const ports: Port[] = [];
  for (const [id, p] of Object.entries(model.parts)) {
    if (p.kind !== "device") continue;
    const from = (p.calledBy ?? []).map((c) => c.part).filter((c) => ids.has(c));
    if (from.length > 0) ports.push({ id, name: p.name, faked: true, from });
  }
  // No test yet: the outside calls the code's own lines make, not faked by anything yet.
  if (ports.length === 0) {
    for (const lib of language === "py" ? (["requests", "urllib", "httpx"] as const) : (["fetch"] as const)) {
      const sites = networkCallSites(source, language, outline as never, lib).filter((c) => ids.has(c.part));
      if (sites.length > 0) ports.push({ id: `outside ${lib}`, name: lib, faked: false, from: sites.map((c) => c.part) });
    }
  }
  // The outline's own word for each join: "wraps" only for a real decorator, "uses" for a function merely named.
  const pipes = outline.joins.filter((j) => j.from !== j.to && ids.has(j.from) && ids.has(j.to)).map((j) => ({ from: j.from, to: j.to, kind: j.kind }));
  return { housings, ports, pipes, ...(outline.partsInFile ? { partsInFile: outline.partsInFile } : {}), ...(outline.throwsInFile ? { fileThrows: outline.throwsInFile } : {}) };
}


const WIDE = 190;
const DEEP = 124;
const BODY = 46;
const STEP_X = WIDE + 124;
/** Each column also steps toward the viewer, so the machine runs down the page as well as across it, and fills the space. */
const DRIFT_Y = 0.24;
const STEP_Y = DEEP + 118;
const LABEL = 13.5;
export const span = (a: number, b: number) => (a === b ? `line ${a}` : `lines ${a}–${b}`);
const at = (l: readonly number[]) => (l.length === 1 ? `line ${l[0]}` : `lines ${l.slice(0, 3).join(", ")}${l.length > 3 ? "…" : ""}`);

function open(s: Sheet, id: string, title: string) {
  s.raw(`<g class="m-part" data-part="${esc(id)}" tabindex="0" role="button" aria-label="${esc(title)}"><title>${esc(title)}</title>`);
}
const close = (s: Sheet) => s.raw("</g>");

/** Plain order: a function sits one column past everything that calls it. A loop in the calls is left where it lands. */
function columns(p: MachineParts): Map<string, number> {
  const col = new Map(p.housings.map((h) => [h.id, 0]));
  for (let i = 0; i < p.housings.length; i++) {
    let moved = false;
    for (const e of p.pipes) {
      if (col.get(e.to)! < col.get(e.from)! + 1 && col.get(e.from)! + 1 < p.housings.length) {
        col.set(e.to, col.get(e.from)! + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return col;
}

function feet(s: Sheet, p: Plan) {
  for (const [x, y] of [[p.x + 13, p.y + 13], [p.x + p.w - 13, p.y + 13], [p.x + 13, p.y + p.d - 13], [p.x + p.w - 13, p.y + p.d - 13]] as const) drum(s, x, y, 6, 0, 4);
}

/** The chute a throw leaves by. The red pencil is there from the start and only shows once a run has ended through it. */
function chute(s: Sheet, x: number, face: number, zTop: number, hit: boolean) {
  const w = 34;
  const len = 50;
  const mouth = [iso([x, face, zTop]), iso([x + w, face, zTop]), iso([x + w, face, zTop + 14]), iso([x, face, zTop + 14])];
  s.fill(mouth, "m-ink");
  const floor = [iso([x + 1, face, zTop]), iso([x + w - 1, face, zTop]), iso([x + w - 1, face + len, 2]), iso([x + 1, face + len, 2])];
  const near = [iso([x + w, face, zTop]), iso([x + w, face, zTop + 7]), iso([x + w, face + len, 9]), iso([x + w, face + len, 2])];
  const far = [iso([x, face, zTop]), iso([x, face, zTop + 7]), iso([x, face + len, 9]), iso([x, face + len, 2])];
  s.fill(far);
  s.edges(far, { width: 0.9 });
  s.fill(floor);
  s.hatch(floor, "m-pencil-cream", 8, 2.6);
  // Red only on the chute plain code placed the run's end in.
  if (hit) {
    s.raw(`<g class="m-hit-only" data-red="chute">`);
    s.hatch(floor, "m-pencil-red", 8, 2);
    s.raw(`</g>`);
  }
  s.edges(floor, { width: 0.9 });
  s.fill(near);
  s.hatch(near, "m-pencil-cream", 72, 2.6);
  s.edges(near, { width: 1.05 });
}

/** The outlet a return leaves by: a spout from the front face, turned down, ending in a collar on the paper. */
function outlet(s: Sheet, x: number, face: number) {
  flange(s, [x, face, 24], "y", 11, 2.5);
  pipe(s, [[x, face + 2, 24], [x, face + 28, 24], [x, face + 28, 6]], 6.4, { bend: 15 });
  flange(s, [x, face + 28, 3], "z", 9.5, 2.5, 4);
}

function lamp(s: Sheet, id: string, p: W) {
  const q = iso(p);
  s.raw(`<circle class="m-lamp-base" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="4.6"/><circle class="m-lamp" data-lamp="${esc(id)}" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3"/>`);
}

export interface MachineDrawn {
  svg: string;
  width: number;
  height: number;
  /** Set instead of a picture: in words, why the chart is shown. */
  tooMany?: string;
  label: string;
  facts?: MachineFacts;
  problems: string[];
  /** The smallest words on the sheet, in its own units. The page checks this against the scale it can give. */
  minWords: number;
}

function finish(s: Sheet, seed: string, label: string, facts: MachineFacts, ended: boolean): MachineDrawn {
  const pad = 14;
  const x0 = Math.min(...s.xs) - pad;
  const y0 = Math.min(...s.ys) - pad;
  const w = Math.max(...s.xs) + pad - x0;
  const h = Math.max(...s.ys) + pad - y0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="m-sheet" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" data-seed="${esc(seed)}"${ended ? " data-ended=\"\"" : ""} role="group" aria-label="${esc(label)}">${s.out.join("")}</svg>`;
  return { svg, width: w, height: h, label, facts, problems: auditMachine(facts), minWords: s.smallest };
}

/** What the run measured about how it threw. */
export interface ThrownFact {
  name: string | null;
  message: string | null;
}

/** The fakes' scripted throws, from the test: a fake is known to have ended the run only if what got out is what it was scripted to throw. */
const fakeThrows = (test: unknown): { port: string; name: string; message: string }[] => {
  const t = test as { args?: { kind?: string; name?: string; calls?: { do?: string; errorName?: string; message?: string }[] }[]; network?: { replaces?: string; calls?: { do?: string; errorName?: string; message?: string }[] } } | null | undefined;
  const out: { port: string; name: string; message: string }[] = [];
  for (const a of t?.args ?? []) if (a.kind === "stand-in") for (const c of a.calls ?? []) if (c.do === "throw") out.push({ port: `stand-in ${a.name}`, name: c.errorName ?? "", message: c.message ?? "" });
  for (const c of t?.network?.calls ?? []) if (c.do === "throw") out.push({ port: `stand-in ${t?.network?.replaces}`, name: c.errorName ?? "", message: c.message ?? "" });
  return out;
};

/**
 * Which part ended the run, only when plain code can place it. A throw: the line the traced run threw from, when it is a throw drawn on a part known to have run; else the only site in the whole file that could produce that class and exact text, in a function known to have run, or the
 * one fake scripted to throw exactly that. Anything else (two candidates, a template's opening words, a throw plain code can't read, a function not known to have run) is not placed. It returned:
 * the function under test ended it.
 */
export function endOfRun(o: { outcome: unknown; thrown: ThrownFact; parts: MachineParts; tested: string | null; test?: unknown; ran: ReadonlySet<string>; called?: (port: string) => boolean; /** The line the traced run says the ending error came from. */ thrownAt?: number | null }): MachineEnd | null {
  if (!o.tested) return null;
  if (o.outcome === "returned") return o.parts.housings.find((h) => h.id === o.tested)?.returns.length ? { part: o.tested, on: "outlet" } : { part: o.tested, on: "housing" };
  if (o.outcome !== "threw") return o.outcome === "never_settled" || o.outcome === "still_running_at_watch_limit" ? { part: o.tested, on: "housing" } : null;
  // The direct evidence: the line the run threw from, when it is a throw drawn on a part known to have run. Nothing else makes a chute red by this route.
  const atLine = o.thrownAt ?? null;
  // Two throws on that one line (a one-line function and a callback in it): the line can't say which, so it places nothing.
  const onLine = (o.parts.fileThrows ?? []).filter((t) => t.line === atLine).length;
  if (atLine !== null && onLine <= 1) {
    const hit = o.parts.housings.find((h) => o.ran.has(h.id) && h.throws.includes(atLine));
    if (hit) return { part: hit.id, on: "chute", line: atLine };
  }
  const { name, message } = o.thrown;
  if (name === null || message === null) return null;
  // Everything in the whole file that could have produced this class and text, whether drawn or not. A throw that reads as something else can't; one that can't be read can.
  const could = (o.parts.fileThrows ?? []).filter((t) => {
    if (t.name === undefined) return true;
    if (t.name !== name) return false;
    if (t.message === undefined) return true;
    return t.exact ? t.message === message : message.startsWith(t.message);
  });
  const named = could.filter((t) => t.name !== undefined);
  const fakes = fakeThrows(o.test).filter((f) => f.name === name && f.message === message && (o.called?.(f.port) ?? true) && o.parts.ports.some((p) => p.id === f.port));
  const fakeIds = [...new Set(fakes.map((f) => f.port))];
  // A fake scripted to throw exactly this, and nothing in the file that reads as the same: it came from the fake, whether or not the code rethrew it.
  // Passed on by more than one throw plain code can't read, it can't be told which: no ring. (A stack shows where an error was made, not where it was thrown again.)
  if (fakeIds.length === 1 && named.length === 0 && could.length <= 1) return { part: fakeIds[0]!, on: "port" };
  // A chute only for the one site in the whole file that could have done it, exact text, in a function known to have run. Prefer no ring to a wrong ring.
  if (fakeIds.length > 0 || could.length !== 1 || !could[0]!.exact) return null;
  const line = could[0]!.line;
  // The traced run named another line: the words matched, the evidence didn't.
  if (atLine !== null && (atLine !== line || onLine > 1)) return null;
  const h = o.parts.housings.find((x) => o.ran.has(x.id) && x.throws.includes(line));
  return h ? { part: h.id, on: "chute", line } : null;
}

/** The parts as a reader of a shared card may have them: names and line numbers, no words from the code. Text of a throw that never ran stays on the server. */
export function publicParts(p: MachineParts): MachineParts {
  const { fileThrows: _left, ...rest } = p;
  return { ...rest, housings: p.housings.map((h) => ({ ...h, throwSites: [] })) };
}

/** Where a finished run ended, for a card: worked out once where the code is known, and only the answer stored. */
export function endOfFile(o: { measured: Record<string, unknown>; parts: MachineParts; tested: string | null; test: unknown; steps: readonly { name: string; within?: readonly string[] }[]; thrownAt?: number | null }): MachineEnd | null {
  const called = (port: string) => {
    const v = o.measured[`calls:${port.replace(/^stand-in /, "")}`];
    return typeof v === "number" && v > 0;
  };
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return endOfRun({ outcome: o.measured.outcome, thrown: { name: text(o.measured.thrownName), message: text(o.measured.thrownMessage) }, parts: o.parts, tested: o.tested, test: o.test, ran: ranParts({ tested: o.tested, steps: o.steps, parts: o.parts, called }), called, thrownAt: o.thrownAt ?? null });
}

/** Plain code's facts about which functions ran: the one under test, those the traced steps name, and the only caller of a fake that was called. */
export function ranParts(o: { tested: string | null; steps: readonly { name: string; within?: readonly string[] }[]; parts: MachineParts; called: (port: string) => boolean }): Set<string> {
  const ran = new Set<string>(o.tested ? [o.tested] : []);
  for (const s of o.steps) {
    ran.add(s.name);
    for (const n of s.within ?? []) ran.add(n);
  }
  for (const p of o.parts.ports) if (p.from.length === 1 && o.called(p.id)) ran.add(p.from[0]!);
  return ran;
}

/** The miss, placed: the ring on the part that ended the run, or, when that can't be placed, the words alone beside where the call came in. */
export function ringFor(o: { kind: "not_matched" | "matched" | "ending"; you: string | null; end: MachineEnd | null; tested: string | null; stranger?: boolean }): MachineRing | null {
  if (o.kind !== "not_matched" || !o.tested) return null;
  const words = `${o.stranger ? "the bet said" : "you said"} ${/^(typed|answered) /.test(o.you ?? "") ? cutValue((o.you ?? "").replace(/^(typed|answered) /, ""), 48) : (o.you ?? "")}`;
  return o.end ? { part: o.end.part, on: o.end.on, words } : { part: o.tested, on: "words", words };
}

export interface MachineEnd {
  part: string;
  on: "chute" | "outlet" | "housing" | "port";
  /** The chute's own throw, for the audit. */
  line?: number;
}

export interface MachineRing {
  part: string;
  /** Which of the part's fittings the run ended at. "words": it can't be placed, so no part is ringed. */
  on: "chute" | "outlet" | "housing" | "port" | "words";
  words: string;
}

interface Callout {
  part: string;
  text: string;
  /** The place on the part this callout is about: its leader line ends here. */
  anchor: Pt;
  size?: number;
  cls?: string;
  /** Said again in the part's own card: left off the sheet when it has no clean place near what it names. */
  optional?: boolean;
}

/** Flat words on clean paper, each as close to what it names as it can be, with a thin line back to it. */
function placeCallouts(s: Sheet, list: readonly Callout[], solids: readonly Solid[], pipes: readonly Pt[][], keepOut: readonly Rect[], leadersBefore: readonly (MachineFacts["labels"][number])[] = []): MachineFacts["labels"] {
  const placed: MachineFacts["labels"] = [];
  const taken: Rect[] = [...keepOut];
  const words: Rect[] = [];
  const pipePoints = pipes.flatMap((l) => sample(l, 8));
  const pipeSegs: [Pt, Pt][] = pipes.flatMap((l) => l.slice(1).map((q, i): [Pt, Pt] => [l[i]!, q]));
  const leaders: [Pt, Pt][] = leadersBefore.flatMap((l) => (l.leader ? [l.leader] : []));
  /** A leader that crosses a pipe or another leader can't be followed. The last few px at its own end don't count: a label on a pipe ends on that pipe. */
  const tangled = (a: Pt, end: Pt) => {
    const len = Math.hypot(end[0] - a[0], end[1] - a[1]) || 1;
    const stop: Pt = [end[0] - ((end[0] - a[0]) / len) * 8, end[1] - ((end[1] - a[1]) / len) * 8];
    return pipeSegs.some(([u, v]) => segmentsCross(a, stop, u, v)) || leaders.some(([u, v]) => segmentsCross(a, stop, u, v));
  };
  const free = (r: Rect) => !taken.some((t) => rectsOverlap(t, r, 3)) && !solids.some((o) => solidHitsRect(o, r, 3)) && !pipePoints.some((q) => q[0] > r.x0 - PIPE_R - 2 && q[0] < r.x1 + PIPE_R + 2 && q[1] > r.y0 - PIPE_R - 2 && q[1] < r.y1 + PIPE_R + 2);
  for (const c of list) {
    const size = c.size ?? LABEL;
    const w = textWidth(c.text, size, true) + 8;
    const h = size * 1.45 + 2;
    let best: { r: Rect; score: number; x: number; y: number; anchor: "start" | "end" } | null = null;
    for (const strict of c.optional ? [true] : [true, false]) for (const dist of c.optional ? [22, 34, 48, 64, 84, 108] : [22, 34, 48, 64, 84, 108, 136, 170, 210, 260, 320]) {
      if (best) break;
      for (let k = 0; k < 16; k++) {
        const t = (k / 16) * Math.PI * 2;
        const ax = c.anchor[0] + Math.cos(t) * dist;
        const ay = c.anchor[1] + Math.sin(t) * dist * 0.8;
        const right = Math.cos(t) >= 0;
        const r: Rect = right ? { x0: ax, x1: ax + w, y0: ay - h / 2, y1: ay + h / 2 } : { x0: ax - w, x1: ax, y0: ay - h / 2, y1: ay + h / 2 };
        if (!free(r)) continue;
        // A leader that crosses another callout is no use.
        if (words.some((u) => segDist([(u.x0 + u.x1) / 2, (u.y0 + u.y1) / 2], c.anchor, [ax, ay]) < (u.y1 - u.y0) / 2 + 2)) continue;
        if (strict && tangled([ax, ay], c.anchor)) continue;
        const score = dist + (Math.sin(t) < -0.4 ? 12 : 0);
        if (!best || score < best.score) best = { r, score, x: ax, y: ay, anchor: right ? "start" : "end" };
      }
    }
    if (!best && c.optional) continue;
    if (!best) {
      placed.push({ part: c.part, text: c.text, rect: { x0: 0, x1: 0, y0: 0, y1: 0 }, unplaced: true });
      continue;
    }
    taken.push(best.r);
    words.push(best.r);
    leaders.push([[best.x, best.y], c.anchor]);
    placed.push({ part: c.part, text: c.text, rect: best.r, leader: [[best.x, best.y], c.anchor] });
    s.raw(`<path class="m-leader" d="M${best.x.toFixed(1)} ${best.y.toFixed(1)}L${c.anchor[0].toFixed(1)} ${c.anchor[1].toFixed(1)}"/>`);
    s.dot(c.anchor, 1.5);
    s.note([best.x + (best.anchor === "start" ? 3 : -3), best.y + size * 0.34], c.text, size, { cls: c.cls ?? "", anchor: best.anchor });
  }
  return placed;
}

/** What a part's body is made of: known from its facts, never from how much code it holds. Every footprint is the same. */
const hasWheel = (h: Housing) => h.selfCalls.length > 0 || h.loops.length > 0;
const bodyHeight = (h: Housing) => (hasWheel(h) ? 34 : BODY);
const topOfBody = (h: Housing) => bodyHeight(h) + 10;
const heightWithFittings = (h: Housing) => topOfBody(h) + (hasWheel(h) ? 86 : h.waits.length > 0 ? 34 : 0);

function solidsOf(h: Housing, pl: Plan): Solid[] {
  const top = topOfBody(h);
  const corners = (p: Plan, z0: number, z1: number): Pt[] => [z0, z1].flatMap((z) => [iso([p.x, p.y, z]), iso([p.x + p.w, p.y, z]), iso([p.x + p.w, p.y + p.d, z]), iso([p.x, p.y + p.d, z])]);
  const out = [solidOf(corners(pl, 0, top))];
  const back: Plan = { x: pl.x + 6, y: pl.y, w: pl.w - 12, d: 58 };
  if (heightWithFittings(h) > top) out.push(solidOf(corners(back, top, heightWithFittings(h))));
  if (h.tested) out.push(solidOf(corners({ x: pl.x + 6, y: pl.y + 4, w: 50, d: 50 }, top, top + 72)));
  if (h.returns.length > 0 || h.throws.length > 0) out.push(solidOf(corners({ x: pl.x, y: pl.y + pl.d, w: pl.w, d: 56 }, 0, 26)));
  return out;
}

/** The plate a name is engraved on. The deeper one, for two lines, also reaches the lid's edges. */
const PLATE_ONE = { dx: 12, dy: 62, w: WIDE - 24, d: 50 };
const PLATE_TWO = { dx: 8, dy: 58, w: WIDE - 16, d: 60 };
/** The lamp's place on the plate's right end, in world units from the part's corner, and how far round it the words keep clear. */
const LAMP = { dx: WIDE - 17, dy: 70, clear: 6.5 };

/**
 * How a part's name sits on its lid: the plain words over the exact name in code type, or the exact name alone. Sizes are in world units.
 * Both lines stay at or above the size a name alone may be (13 px on the sheet), so the page's 11 px floor is met exactly as before. Null: no room.
 * `top` is how far into the plate the first line's tallest letters reach: below the lamp when the words are wide enough to meet it.
 */
export function lidLines(h: Pick<Housing, "name" | "role">, twoLines: boolean): { big: string; bigSize: number; small?: string; smallSize?: number; top?: number; plate: typeof PLATE_ONE } | null {
  const shortName = h.name.length > 22 ? `${h.name.slice(0, 21)}…` : h.name;
  // The plate's width and the words are in different units here: world and page.
  const fit = (room: number, w: number, max: number) => Math.min(max, ((room * K) / w) * 100) / K;
  const one = fit(PLATE_ONE.w - 10 / K, textWidth(shortName, 100, false), 30);
  const alone = one * K >= 13 ? { big: shortName, bigSize: one, plate: PLATE_ONE } : null;
  if (!twoLines) return alone;
  // No name of its own: the role word, alone. The lid never shows "default" as if it were a name.
  if (h.role) {
    const r = fit(PLATE_ONE.w - 10 / K, textWidth(h.role, 100, false), 26);
    return r * K >= 13 ? { big: h.role, bigSize: r, plate: PLATE_ONE } : null;
  }
  const words = nameWords(h.name);
  if (!words) return alone;
  const wide = PLATE_TWO.w - 8;
  // Centred words narrower than this stop short of the lamp, so they may start at the plate's back edge.
  const clearOfLamp = 2 * (LAMP.dx - LAMP.clear - (PLATE_TWO.dx + PLATE_TWO.w / 2));
  const small = Math.min(fit(wide, codeWidth(shortName, 100), 13.5 / K), 13.5 / K);
  let best: { big: number; top: number } | null = null;
  for (const [room, top] of [[clearOfLamp, 3], [wide, LAMP.dy + LAMP.clear - PLATE_TWO.dy]] as const) {
    // A letter's height above and below its line: about 0.72 and 0.22 of its size. Then a small gap, then the code line.
    const deep = (PLATE_TWO.d - top - 3 - 2 - small * 0.94) / 0.94;
    const big = Math.min(fit(room, textWidth(words, 100, false), 26), deep);
    if (!best || big > best.big) best = { big, top };
  }
  if (!best || best.big * K < 13 || small * K < 13 || small > best.big) return alone;
  return { big: words, bigSize: best.big, small: shortName, smallSize: small, top: best.top, plate: PLATE_TWO };
}

/** Draws at the tightest spacing that comes out clean: more room is tried only when the pipes can't be routed or the audit finds a fault. */
export function drawMachine(p: MachineParts, o: { seed: string; ring?: MachineRing | null; ended?: boolean; end?: MachineEnd | null; /** Atlas won't run this file (it needs a package): the entry says where a call would start, not that Atlas calls it. */ wontRun?: boolean; /** The person's own screen: each lid carries the name in plain words over the exact name. The shared picture leaves this off. */ nameLines?: boolean }): MachineDrawn {
  let last: MachineDrawn | null = null;
  for (const roomy of [1, 1.3, 1.7, 2.2]) {
    last = drawAt(p, o, roomy);
    if (last.tooMany === undefined && last.problems.length === 0) return last;
    if (last.tooMany && last.tooMany !== CANT_DRAW) return last;
  }
  return last!;
}

export function drawAt(p: MachineParts, o: { seed: string; ring?: MachineRing | null; ended?: boolean; end?: MachineEnd | null; /** Atlas won't run this file (it needs a package): the entry says where a call would start, not that Atlas calls it. */ wontRun?: boolean; nameLines?: boolean }, roomy: number): MachineDrawn {
  const count = p.housings.length + p.ports.length;
  const chart = (why: string): MachineDrawn => ({ svg: "", width: 0, height: 0, label: "", tooMany: why, problems: [], minWords: 0 });
  if (p.partsInFile) return chart(`This file defines ${p.partsInFile.toLocaleString("en-US")} functions and classes, more than the ${MACHINE_PART_LIMIT} parts the machine can draw and still be read. Here are the first ${p.housings.length}.`);
  if (p.housings.length > LIST_FROM_PARTS) return chart(`This file has ${count} parts, more than the ${MACHINE_PART_LIMIT} the machine can draw and still be read, so here they are as a list.`);
  if (count > MACHINE_PART_LIMIT) return chart(`This file has ${count} parts, more than the ${MACHINE_PART_LIMIT} the machine can draw and still be read, so here is the box chart.`);
  if (count === 0) return chart(NOTHING_TO_DRAW);
  const s = sheetOf(o.seed);
  const col = columns(p);
  // Each column's order follows its callers', so pipes cross as little as they can.
  const cols = new Map<number, string[]>();
  const put = (c: number, id: string) => cols.set(c, [...(cols.get(c) ?? []), id]);
  for (const h of p.housings) put(col.get(h.id)!, h.id);
  for (const q of p.ports) {
    const c = Math.max(...q.from.map((f) => col.get(f)!)) + 1;
    col.set(q.id, c);
    put(c, q.id);
  }
  const orderOf = new Map<string, number>();
  const place = new Map<string, Plan>();
  // A column with many pipes leaving it gets a wider gap, so each has a lane of its own.
  const colX = new Map<number, number>();
  {
    let x = 0;
    for (const c of [...cols.keys()].sort((a, b) => a - b)) {
      colX.set(c, x);
      const leaving = cols.get(c)!.reduce((n, id) => n + p.pipes.filter((e) => e.from === id).length + p.ports.filter((q) => q.from.includes(id)).length, 0);
      x += (STEP_X + Math.max(0, leaving - 2) * 28) * roomy;
    }
  }
  // A deep chain of calls would run off as one long diagonal, too small to read: past four columns it carries on in a second row, like a line of text.
  const ordered = [...cols.keys()].sort((a, b) => a - b);
  const wrapAt = ordered.length > 4 ? Math.ceil(ordered.length / 2) : Infinity;
  const rowOf = new Map(ordered.map((c, i) => [c, Math.floor(i / wrapAt)]));
  if (wrapAt !== Infinity) {
    const firstX = colX.get(ordered[wrapAt]!)!;
    for (const c of ordered.slice(wrapAt)) colX.set(c, colX.get(c)! - firstX);
  }
  const tallest = Math.max(...ordered.map((c) => cols.get(c)!.length));
  for (const c of ordered) {
    const parentsOf = (id: string) => [...p.pipes.filter((e) => e.to === id).map((e) => e.from), ...(p.ports.find((x) => x.id === id)?.from ?? [])];
    const score = (id: string) => {
      const ps = parentsOf(id).map((f) => orderOf.get(f)).filter((v): v is number => v !== undefined);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    const list = [...cols.get(c)!].sort((a, b) => score(a) - score(b));
    list.forEach((id, i) => {
      const off = i - (list.length - 1) / 2;
      orderOf.set(id, off);
      const port = p.ports.some((x) => x.id === id);
      place.set(id, { x: colX.get(c)!, y: colX.get(c)! * DRIFT_Y + off * STEP_Y * roomy + (port ? 14 : 0) + rowOf.get(c)! * (tallest * STEP_Y * roomy + 170), w: port ? 150 : WIDE, d: port ? 96 : DEEP });
    });
  }
  const house = new Map(p.housings.map((h) => [h.id, h]));
  const owners: Owner[] = [];
  for (const [id, pl] of place) {
    const h = house.get(id);
    const list = h ? solidsOf(h, pl) : [solidOf([0, 40].flatMap((z) => [iso([pl.x, pl.y, z]), iso([pl.x + pl.w, pl.y, z]), iso([pl.x + pl.w, pl.y + pl.d, z]), iso([pl.x, pl.y + pl.d, z])]))];
    for (const solid of list) owners.push({ part: id, solid });
  }
  // The jobs for the router: out by a part's right-hand face, in by the far side of the next, or by a face you can see if it runs backwards.
  const edges = [...p.pipes.map((e) => ({ from: e.from, to: e.to, kind: e.kind })), ...p.ports.flatMap((q) => q.from.map((f) => ({ from: f, to: q.id, kind: "calls" as const })))];
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  const jobs: (Job & { back: boolean })[] = edges.map((e) => {
    const a = place.get(e.from)!;
    const b = place.get(e.to)!;
    const nOut = edges.filter((x) => x.from === e.from);
    const nIn = edges.filter((x) => x.to === e.to);
    const oi = outCount.get(e.from) ?? 0;
    const ii = inCount.get(e.to) ?? 0;
    outCount.set(e.from, oi + 1);
    inCount.set(e.to, ii + 1);
    const back = col.get(e.to)! <= col.get(e.from)!;
    const yOut = a.y + (a.d * (oi + 1)) / (nOut.length + 1);
    const yIn = b.y + (b.d * (ii + 1)) / (nIn.length + 1);
    return {
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      back,
      start: [a.x + a.w + 16, yOut],
      goal: back ? [b.x + b.w + 16, yIn] : [b.x - 16, yIn],
      near: [{ x: a.x + a.w, y: a.y - 6, w: 70, d: a.d + 12 }, back ? { x: b.x + b.w, y: b.y - 6, w: 70, d: b.d + 12 } : { x: b.x - 76, y: b.y - 6, w: 76, d: b.d + 12 }],
    };
  });
  const xs = [...place.values()];
  const bounds: Plan = { x: Math.min(...xs.map((q) => q.x)) - 208, y: Math.min(...xs.map((q) => q.y)) - 208, w: Math.max(...xs.map((q) => q.x + q.w)) - Math.min(...xs.map((q) => q.x)) + 416, d: Math.max(...xs.map((q) => q.y + q.d)) - Math.min(...xs.map((q) => q.y)) + 416 };
  const routes = routeAll(jobs, owners, bounds);
  if ("failed" in routes) return { ...chart(CANT_DRAW), problems: [routes.failed] };

  const reds: MachineFacts["reds"] = [];
  const callouts: Callout[] = [];
  const pipesDrawn: MachineFacts["routes"] = [];
  let ringAt: { c: Pt; rx: number; ry: number; words: string[] } | null = null;
  let wordsOnly: { anchor: Pt; words: string } | null = null;
  const paintRoutes = (list: typeof jobs) => {
    for (const job of list) {
      const route = routes.get(job.id)!;
      const a = place.get(job.from)!;
      const b = place.get(job.to)!;
      const yOut = route[0]![1];
      const yIn = route[route.length - 1]![1];
      const full: W[] = [[a.x + a.w + 3, yOut, PIPE_Z], ...route.slice(1, -1), job.back ? [b.x + b.w + 3, yIn, PIPE_Z] : [b.x - 6, yIn, PIPE_Z]];
      const kind = edges.find((e) => `${e.from}->${e.to}` === job.id)!.kind;
      open(s, job.id, kind === "wraps" ? `${job.to} wraps ${job.from}` : kind === "uses" ? `${job.from} uses ${job.to}` : `${job.from} calls ${job.to.replace(/^stand-in |^outside /, "")}`);
      const line = pipe(s, full, PIPE_R);
      const marks = chevrons(s, full.map(iso));
      threadPath(s, job.id, line);
      // Flanges fit the spacing on a crowded face.
      const fr = (n: number, d: number) => Math.min(10, (d / (n + 1)) * 0.46);
      flange(s, [a.x + a.w, yOut, PIPE_Z], "x", fr(edges.filter((x) => x.from === job.from).length, a.d), 3);
      if (job.back) flange(s, [b.x + b.w, yIn, PIPE_Z], "x", fr(edges.filter((x) => x.to === job.to).length, b.d), 3);
      else flange(s, [b.x - 7, yIn, PIPE_Z], "x", fr(edges.filter((x) => x.to === job.to).length, b.d), 3);
      close(s);
      pipesDrawn.push({ id: job.id, from: job.from, to: job.to, page: full.map(iso), chevrons: marks, ends: [{ part: job.from, at: full[0]! }, { part: job.to, at: full[full.length - 1]! }], plans: { [job.from]: a, [job.to]: b }, nearEnds: [iso([a.x + a.w, yOut, PIPE_Z]), iso(job.back ? [b.x + b.w, yIn, PIPE_Z] : [b.x, yIn, PIPE_Z])] });
      if (kind !== "calls") callouts.push({ part: job.id, text: kind === "wraps" ? `${job.to} wraps ${job.from}` : `${job.from} uses ${job.to}`, anchor: iso(full[Math.floor(full.length / 2)]!) });
    }
  };

  for (const c of [...cols.keys()].sort((u, v) => u - v)) {
    const here = cols.get(c)!.slice().sort((u, v) => place.get(u)!.y - place.get(v)!.y);
    for (const id of here) {
      const q = p.ports.find((x) => x.id === id);
      const pl = place.get(id)!;
      if (q) {
        open(s, q.id, q.faked ? `${q.name}: Atlas fakes this outside call, so the real one never runs. Scripted by the test.` : `${q.name}: an outside call this code makes. Nothing has run.`);
        floorShadow(s, pl, 12);
        feet(s, pl);
        block(s, pl, 4, 30, { tone: q.faked ? "blue" : "shade", topHatch: q.faked });
        const plate = { x: pl.x + 10, y: pl.y + 24, w: pl.w - 20, d: pl.d - 40 };
        block(s, plate, 34, 1.5, { tone: "bare", width: 0.9 });
        screws(s, plate, 35.5, 4);
        s.onTop([pl.x + pl.w / 2, pl.y + pl.d / 2 + 6, 35.5], q.name, Math.min(26, ((plate.w * K - 10) / textWidth(q.name, 100, false)) * 100) / K);
        lamp(s, q.id, [pl.x + pl.w - 16, pl.y + 13, 34]);
        close(s);
        if (o.ring?.part === q.id && o.ring.on === "port") {
          const c = iso([pl.x + pl.w / 2, pl.y + pl.d / 2, 34]);
          ringAt = { c, rx: 112 * K, ry: 66 * K, words: [o.ring.words] };
        }
        callouts.push({ part: q.id, text: q.faked ? "faked by the test" : "outside this file: not run", anchor: iso([pl.x + pl.w - 2, pl.y + pl.d, 18]), cls: q.faked ? "m-bluew" : "m-soft" });
        continue;
      }
      const h = house.get(id)!;
      const top = topOfBody(h);
      const wheelhouse = hasWheel(h);
      const lid = { x: pl.x + 5, y: pl.y + 5, w: pl.w - 10, d: pl.d - 10 };
      open(s, h.id, `${h.name}: a ${h.kind}, ${span(h.lines[0], h.lines[1])}${h.exported ? ", can be called from outside the file" : ""}${h.tested ? ", the one Atlas calls" : ""}`);
      floorShadow(s, pl, 18);
      feet(s, pl);
      block(s, pl, 4, bodyHeight(h));
      block(s, lid, bodyHeight(h) + 4, 6, { tone: "bare", width: 1 });
      screws(s, lid, top, 5);
      const onLid = lidLines(h, o.nameLines === true);
      const pp = onLid?.plate ?? PLATE_ONE;
      const plate = { x: pl.x + pp.dx, y: pl.y + pp.dy, w: pp.w, d: pp.d };
      block(s, plate, top, 1.6, { tone: "bare", width: 0.9 });
      if (onLid?.small !== undefined) {
        // Two lines: the plain words, then the exact name in code type, centred together on the plate.
        const first = plate.y + onLid.top! + onLid.bigSize * 0.72;
        s.onTop([pl.x + pl.w / 2, first, top + 1.6], onLid.big, onLid.bigSize);
        s.onTop([pl.x + pl.w / 2, first + onLid.bigSize * 0.22 + 2 + onLid.smallSize! * 0.72, top + 1.6], onLid.small, onLid.smallSize!, { cls: "m-code" });
      } else if (onLid) s.onTop([pl.x + pl.w / 2, pl.y + 87 + onLid.bigSize * 0.3, top + 1.6], onLid.big, onLid.bigSize);
      lamp(s, h.id, [pl.x + LAMP.dx, pl.y + LAMP.dy, top + 1.6]);
      close(s);
      // Too small to read on the lid: the name goes beside the part instead.
      const nameBeside = !onLid || (onLid.small === undefined && onLid.bigSize * K < 15);
      callouts.push({ part: h.id, text: nameBeside ? `${(o.nameLines ? h.role : undefined) ?? h.name}, ${span(h.lines[0], h.lines[1])}` : span(h.lines[0], h.lines[1]), anchor: iso([pl.x + 8, pl.y + pl.d - 8, top]), cls: "m-soft", ...(nameBeside ? {} : { optional: true }) });
      // what stands on top, in a row behind the plate
      if (h.tested) {
        open(s, `${h.id}#inlet`, o.wontRun ? `${h.name}: a call would start here. Atlas can't run this file.` : `${h.name}: the call starts here. Atlas calls this function.`);
        hopper(s, pl.x + 30, pl.y + 30, top);
        close(s);
        callouts.push({ part: h.id, text: o.wontRun ? "a call would start here" : "starts here: Atlas calls this", anchor: iso([pl.x + 30, pl.y + 30, top + 66]), size: 14.5 });
      } else if (h.exported) {
        open(s, `${h.id}#inlet`, `${h.name}: can be called from outside the file`);
        drum(s, pl.x + 30, pl.y + 30, 10, top, 7);
        drum(s, pl.x + 30, pl.y + 30, 6, top + 7, 2.4, { tone: "bare" });
        close(s);
      }
      if (h.waits.length > 0) {
        const dx = pl.x + (wheelhouse ? 72 : 84);
        open(s, `${h.id}#dial`, `${h.name}: waits, ${at(h.waits)}`);
        stemDial(s, dx, pl.y + 28, 17, top, h.id);
        close(s);
        callouts.push({ part: h.id, text: `waits, ${at(h.waits)}`, anchor: iso([dx, pl.y + 28, top + 24]) });
      }
      if (wheelhouse) {
        const self = h.selfCalls.length > 0;
        const words = self ? `calls itself, ${at(h.selfCalls)}` : `loop, ${at(h.loops)}`;
        open(s, `${h.id}#return`, `${h.name}: ${words}`);
        const cx = pl.x + pl.w - 44;
        const cy = pl.y + 30;
        drum(s, cx, cy, 26, top, 34);
        const hi = top + 60;
        flange(s, [cx - 15, cy, top + 34], "z", 6.5, 1.6, 3);
        flange(s, [cx + 15, cy, top + 34], "z", 6.5, 1.6, 3);
        pipe(s, [[cx - 15, cy, top + 36], [cx - 15, cy, hi], [cx + 15, cy, hi], [cx + 15, cy, top + 36]], 3.8, { bend: 8 });
        wheel(s, cx, cy, 14, hi + 9);
        close(s);
        callouts.push({ part: h.id, text: words, anchor: iso([cx + 14, cy - 14, hi + 9]) });
      }
      const face = pl.y + DEEP;
      if (h.returns.length > 0) {
        open(s, `${h.id}#return-outlet`, `${h.name}: returns, ${at(h.returns)}`);
        outlet(s, pl.x + 34, face);
        close(s);
        callouts.push({ part: h.id, text: `returns, ${at(h.returns)}`, anchor: iso([pl.x + 26, face + 28, 2]), optional: true });
        if (o.ring?.part === h.id && o.ring.on === "outlet") ringAt = { c: iso([pl.x + 34, face + 16, 14]), rx: 46 * K, ry: 40 * K, words: [o.ring.words] };
      }
      if (h.throws.length > 0) {
        const cx = pl.x + WIDE - 70;
        open(s, `${h.id}#chute`, `${h.name}: throws, ${at(h.throws)}`);
        const hit = o.end?.part === h.id && o.end.on === "chute";
        chute(s, cx, face, Math.min(26, bodyHeight(h) - 14), hit);
        if (hit) reds.push({ kind: "chute", part: h.id, line: o.end?.line ?? -1 });
        close(s);
        callouts.push({ part: h.id, text: `throws, ${at(h.throws)}`, anchor: iso([cx + 17, face + 46, 3]) });
        if (o.ring?.part === h.id && o.ring.on === "chute") ringAt = { c: iso([cx + 17, face + 22, 14]), rx: 60 * K, ry: 52 * K, words: [o.ring.words] };
      }
      if (o.ring?.part === h.id && o.ring.on === "housing") ringAt = { c: iso([pl.x + pl.w / 2, pl.y + 87, top]), rx: 118 * K, ry: 72 * K, words: [o.ring.words] };
      if (o.ring?.part === h.id && o.ring.on === "words") wordsOnly = { anchor: iso([pl.x + 30, pl.y + 30, top + 40]), words: o.ring.words };
    }
    paintRoutes(jobs.filter((j) => !j.back && col.get(j.from) === c));
  }
  paintRoutes(jobs.filter((j) => j.back));

  const solids = owners.map((q) => q.solid);
  const pipeLines = pipesDrawn.map((r) => r.page);
  const keepOut: Rect[] = [];
  const ring = ringAt as { c: Pt; rx: number; ry: number; words: string[] } | null;
  if (ring) keepOut.push({ x0: ring.c[0] - ring.rx - 4, x1: ring.c[0] + ring.rx + 4, y0: ring.c[1] - ring.ry - 4, y1: ring.c[1] + ring.ry + 4 });
  // The ring's words come first: they are the point of the picture. The parts' own labels go where they still can.
  const endLabels: MachineFacts["labels"] = [];
  const flat = wordsOnly as { anchor: Pt; words: string } | null;
  if (flat) {
    s.raw(`<g class="m-end m-end-words">`);
    endLabels.push(...placeCallouts(s, [{ part: "words", text: flat.words, anchor: flat.anchor, size: 17, cls: "m-redw" }], solids, pipeLines, keepOut));
    s.raw(`</g>`);
  }
  if (ring) {
    s.raw(`<g class="m-end" data-ring="${esc(o.ring?.part ?? "")}" data-ring-on="${o.ring?.on ?? ""}">`);
    ringAround(s, ring.c, ring.rx, ring.ry);
    s.raw(`</g><g class="m-end m-end-words">`);
    endLabels.push(...placeCallouts(s, ring.words.map((text) => ({ part: "ring", text, anchor: [ring.c[0] - ring.rx * 0.7, ring.c[1] + ring.ry * 0.7] as Pt, size: 17, cls: "m-redw" })), solids, pipeLines, keepOut));
    s.raw(`</g>`);
  }
  const labels = placeCallouts(s, callouts, solids, pipeLines, [...keepOut, ...endLabels.map((l) => l.rect)], endLabels);
  const facts: MachineFacts = { owners: owners.map((q) => ({ part: q.part, solid: q.solid })), routes: pipesDrawn, labels: [...labels, ...endLabels], reds, housings: p.housings };
  return finish(s, o.seed, `A machine of the code: ${p.housings.map((h) => h.name).join(", ")}. Each part is a button that says what it stands for.`, facts, o.ended === true);
}

/**
 * Moonwell's machine, from the same spec as its drawing (renderer/authors/moonwell.ts), so it says nothing that drawing does not. The feed,
 * one pipe, the oracle, the empty mount where a second source would be, the reference. The numbers are flat, on tickets, and the largest things here.
 */
export function drawMoonwell(spec: RenderSpec, o: { ended: boolean }): MachineDrawn | null {
  const node = (id: string) => spec.nodes.find((n) => n.id === id);
  const feedName = node("feed")?.words;
  const price = node("price")?.words;
  if (!feedName || !price) return null;
  const s = sheetOf(spec.seed ?? "moonwell");
  const feed: Plan = { x: 0, y: 0, w: 176, d: 116 };
  const oracle: Plan = { x: 372, y: -8, w: 196, d: 132 };
  const ref: Plan = { x: 372, y: 300, w: 176, d: 100 };
  const mount: Plan = { x: 60, y: 208, w: 136, d: 100 };
  const pipeWords = spec.edges.find((e) => e.id === "e-price")?.words ?? "";
  const money = (w: string) => /^(.*?)(\$[\d,.]+)$/.exec(w);
  const owners: { part: string; solid: Solid }[] = [];
  const solid = (part: string, p: Plan, h: number) => owners.push({ part, solid: solidOf([0, h].flatMap((z) => [iso([p.x, p.y, z]), iso([p.x + p.w, p.y, z]), iso([p.x + p.w, p.y + p.d, z]), iso([p.x, p.y + p.d, z])])) });
  const callouts: Callout[] = [];
  const hasMount = spec.nodes.some((n) => n.id === "gear");

  // feed
  open(s, "feed", `${feedName}: the feed the price read went through`);
  floorShadow(s, feed, 14);
  feet(s, feed);
  block(s, feed, 4, 46);
  const fl = { x: feed.x + 5, y: feed.y + 5, w: feed.w - 10, d: feed.d - 10 };
  block(s, fl, 50, 5, { tone: "bare", width: 1 });
  screws(s, fl, 55, 5);
  const fp = { x: feed.x + 12, y: feed.y + 34, w: feed.w - 24, d: 52 };
  block(s, fp, 55, 1.6, { tone: "bare", width: 0.9 });
  s.onTop([feed.x + feed.w / 2, feed.y + 66, 56.6], feedName, Math.max(13, Math.min(24, ((fp.w * K - 10) / textWidth(feedName, 100, false)) * 100)) / K);
  lamp(s, "feed", [feed.x + feed.w - 18, feed.y + 22, 55]);
  close(s);
  solid("feed", feed, 60);
  // the one pipe
  const y = feed.y + feed.d / 2;
  const toY = oracle.y + oracle.d / 2;
  const route: W[] = [[feed.x + feed.w + 3, y, PIPE_Z], [(feed.x + feed.w + oracle.x) / 2, y, PIPE_Z], [(feed.x + feed.w + oracle.x) / 2, toY, PIPE_Z], [oracle.x - 6, toY, PIPE_Z]];
  open(s, "e-price", pipeWords);
  const line = pipe(s, route, 7.4);
  const marks = chevrons(s, route.map(iso));
  threadPath(s, "e-price", line);
  flange(s, [feed.x + feed.w, y, PIPE_Z], "x", 11, 3);
  flange(s, [oracle.x - 7, toY, PIPE_Z], "x", 11, 3);
  close(s);
  callouts.push({ part: "e-price", text: pipeWords, anchor: iso(route[1]!), size: 16 });
  // oracle
  open(s, "price", `${price}, ${node("price")?.small ?? ""}`);
  floorShadow(s, oracle, 18);
  feet(s, oracle);
  block(s, oracle, 4, 56);
  const lid = { x: oracle.x + 5, y: oracle.y + 5, w: oracle.w - 10, d: oracle.d - 10 };
  block(s, lid, 60, 6, { tone: "bare", width: 1 });
  screws(s, lid, 66, 5);
  const wp = { x: oracle.x + 12, y: oracle.y + 38, w: oracle.w - 24, d: 58 };
  block(s, wp, 66, 1.6, { tone: "bare", width: 0.9 });
  s.onTop([oracle.x + oracle.w / 2, oracle.y + 74, 67.6], "oracle", 30);
  lamp(s, "price", [oracle.x + oracle.w - 18, oracle.y + 24, 66]);
  close(s);
  solid("price", oracle, 68);
  // the empty mount
  if (hasMount) {
    open(s, "gear", `${node("gear")?.words}: the run counted one price source`);
    floorShadow(s, mount, 8);
    block(s, mount, 0, 6);
    screws(s, mount, 6, 8);
    const c: W = [mount.x + mount.w / 2, mount.y + mount.d / 2, 6];
    const cog: Pt[] = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = 26 + (Math.floor((i / n) * 24) % 2 === 0 ? 6 : 0);
      cog.push(iso([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, 6]));
    }
    s.raw(`<path class="m-missing" d="M${cog.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("L")}Z"/>`);
    close(s);
    solid("gear", mount, 8);
    callouts.push({ part: "gear", text: node("gear")?.words ?? "", anchor: iso([mount.x + 20, mount.y + mount.d - 6, 6]), size: 16, cls: "m-redw" });
  }
  // the reference, with a dotted line that ends on both parts, because nothing flows along it
  const refWords = node("ref")?.words;
  if (refWords) {
    const a = iso([ref.x + ref.w / 2, ref.y, 20]);
    const b = iso([oracle.x + oracle.w / 2, oracle.y + oracle.d, 20]);
    open(s, "ref", `${refWords}, ${node("ref")?.small ?? ""}`);
    floorShadow(s, ref, 12);
    feet(s, ref);
    block(s, ref, 4, 28);
    const pl = { x: ref.x + 10, y: ref.y + 22, w: ref.w - 20, d: ref.d - 38 };
    block(s, pl, 32, 1.5, { tone: "bare", width: 0.9 });
    screws(s, pl, 33.5, 4);
    s.onTop([ref.x + ref.w / 2, ref.y + 56, 33.5], "reference", 26);
    close(s);
    solid("ref", ref, 34);
    s.raw(`<path class="m-dash" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}"/>`);
    s.dot(a, 2.4);
    s.dot(b, 2.4);
  }
  const rightOf = Math.max(...s.xs) + 34;
  // Tickets: flat, on clean paper, the same size, side by side in reading order.
  const pm = money(price);
  const rm = refWords ? money(refWords) : null;
  const marksHere = spec.marks.filter((k) => k.on === "price");
  const oracleAt = iso([oracle.x + oracle.w, oracle.y + oracle.d / 2, 40]);
  const refAt = iso([ref.x + ref.w, ref.y + ref.d / 2, 20]);
  const t1 = ticket(s, rightOf, oracleAt[1] - 120, 300, { small: (pm?.[1] ?? "").trim(), big: pm?.[2] ?? price, foot: node("price")?.small ?? "", lines: marksHere.map((k) => ({ text: `${k.who} ${k.words}`, red: k.kind === "didnt-match" })) });
  s.raw(`<path class="m-leader" d="M${rightOf} ${(t1.y0 + 60).toFixed(1)}L${oracleAt[0].toFixed(1)} ${oracleAt[1].toFixed(1)}"/>`);
  s.dot(oracleAt, 2);
  const labelsT: MachineFacts["labels"] = [{ part: "price", text: pm?.[2] ?? price, rect: t1 }];
  if (rm) {
    const t2 = ticket(s, rightOf, t1.y1 + 26, 300, { small: (rm[1] ?? "").trim(), big: rm[2]!, foot: node("ref")?.small ?? "", lines: [] });
    s.raw(`<path class="m-leader" d="M${rightOf} ${(t2.y0 + 60).toFixed(1)}L${refAt[0].toFixed(1)} ${refAt[1].toFixed(1)}"/>`);
    s.dot(refAt, 2);
    labelsT.push({ part: "ref", text: rm[2]!, rect: t2 });
  }
  const solids = owners.map((q) => q.solid);
  const placed = placeCallouts(s, callouts, solids, [route.map(iso)], labelsT.map((l) => l.rect));
  const facts: MachineFacts = { reds: [], housings: [], owners, routes: [{ id: "e-price", from: "feed", to: "price", page: route.map(iso), chevrons: marks, ends: [{ part: "feed", at: route[0]! }, { part: "price", at: route[route.length - 1]! }], plans: { feed, price: oracle }, nearEnds: [iso([feed.x + feed.w, y, PIPE_Z]), iso([oracle.x, toY, PIPE_Z])] }], labels: [...labelsT, ...placed] };
  if (spec.path?.partsWaysAt) {
    s.raw(`<g class="m-end">`);
    ringAround(s, [t1.x0 + 150, t1.y0 + 70], 104, 37);
    s.raw(`</g>`);
  }
  return finish(s, spec.seed ?? "moonwell", `A machine of the Moonwell read: ${feedName}, ${pipeWords}, ${price}.`, facts, o.ended);
}
