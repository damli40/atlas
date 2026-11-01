// D65 style proof: the code as a machine. Plain code picks every part from what Atlas already read: the outline's functions and joins, the
// masked source (comments and strings removed) for loops, throws and returns, the call facts for waits, the chosen test for what is faked.
// Nothing comes from a model. All housings are one size: size says nothing about the code. Pure.

import { networkCallSites } from "../../src/call-sites";
import { maskSource } from "../../src/failure-labels";
import type { FileOutline } from "../../src/file-outline";
import type { BenchModel } from "../../web/machines/bench/model";
import type { RenderSpec } from "../spec";
import { block, dial, drum, esc, flange, floorShadow, iso, pipe, ringAround, screws, sheetOf, wheel, type Plan, type Sheet, type W } from "./pencil";

export const MACHINE_PART_LIMIT = 12;

export interface Housing {
  id: string;
  name: string;
  lines: [number, number];
  exported: boolean;
  tested: boolean;
  selfCalls: number[];
  loops: number[];
  waits: number[];
  throws: number[];
  returns: number[];
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
  pipes: { from: string; to: string; kind: "calls" | "wraps" }[];
}

const linesMatching = (masked: readonly string[], a: number, b: number, re: RegExp) => {
  const out: number[] = [];
  for (let n = a; n <= b; n++) if (re.test(masked[n - 1] ?? "")) out.push(n);
  return out;
};

/** What the machine is made of. Every field comes from the code's text, or the test the person is looking at. */
export function machineParts(model: BenchModel, outline: FileOutline, source: string, language: "js" | "ts" | "py"): MachineParts {
  const masked = maskSource(source, language === "py" ? "py" : "js").split("\n");
  const waits = (outline as { callFacts?: { waits: { line: number }[] } }).callFacts?.waits ?? [];
  const housings: Housing[] = [];
  for (const b of model.boxes) {
    const p = model.parts[b.id];
    if (!p || p.kind !== "code") continue;
    const a = p.part.lineStart;
    const z = p.part.lineEnd;
    housings.push({
      id: b.id,
      name: p.part.name,
      lines: [a, z],
      exported: p.part.exported,
      tested: model.tested === b.id,
      selfCalls: p.selfCalls ?? [],
      loops: linesMatching(masked, a, z, language === "py" ? /^\s*(for|while)\b/ : /\b(for|while)\s*\(/),
      waits: waits.filter((w) => w.line >= a && w.line <= z).map((w) => w.line),
      throws: linesMatching(masked, a, z, language === "py" ? /^\s*raise\b/ : /\bthrow\b/),
      returns: linesMatching(masked, a, z, /\breturn\b/),
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
  const pipes = model.lines
    .filter((l) => l.from !== l.to && ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ from: l.from, to: l.to, kind: (l.kind === "calls" ? "calls" : "wraps") as "calls" | "wraps" }));
  return { housings, ports, pipes };
}

const WIDE = 176;
const DEEP = 120;
const BODY = 46;
const STEP_X = 276;
const STEP_Y = 206;
const span = (a: number, b: number) => (a === b ? `line ${a}` : `lines ${a}–${b}`);
const at = (l: readonly number[]) => (l.length === 1 ? `line ${l[0]}` : `lines ${l.slice(0, 3).join(", ")}${l.length > 3 ? "…" : ""}`);

function open(s: Sheet, id: string, title: string) {
  s.raw(`<g class="m-part" data-part="${esc(id)}" tabindex="0" aria-label="${esc(title)}"><title>${esc(title)}</title>`);
}
const close = (s: Sheet) => s.raw("</g>");

/** Plain order: a function sits one column past everything that calls it. */
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

/** The chute a throw leaves by: a trough sloping from the housing's front face down to the paper. */
function chute(s: Sheet, x: number, face: number, red: boolean) {
  const w = 30;
  const zTop = 26;
  const len = 46;
  const mouth = [iso([x, face, zTop]), iso([x + w, face, zTop]), iso([x + w, face, zTop + 14]), iso([x, face, zTop + 14])];
  s.fill(mouth, "m-ink");
  const floor = [iso([x + 1, face, zTop]), iso([x + w - 1, face, zTop]), iso([x + w - 1, face + len, 2]), iso([x + 1, face + len, 2])];
  const near = [iso([x + w, face, zTop]), iso([x + w, face, zTop + 7]), iso([x + w, face + len, 9]), iso([x + w, face + len, 2])];
  const far = [iso([x, face, zTop]), iso([x, face, zTop + 7]), iso([x, face + len, 9]), iso([x, face + len, 2])];
  s.fill(far);
  s.edges(far, { width: 0.9 });
  s.fill(floor);
  s.hatch(floor, red ? "m-pencil-red" : "m-pencil-cream", 8, 2.6);
  s.edges(floor, { width: 0.9, cls: red ? "m-red" : "m-ink" });
  s.fill(near);
  s.hatch(near, "m-pencil-cream", 72, 2.6);
  s.edges(near, { width: 1.05, cls: red ? "m-red" : "m-ink" });
}

/** The outlet a return leaves by: a short spout out of the front face, turned down, with a flange at the wall. */
function outlet(s: Sheet, x: number, face: number) {
  flange(s, [x, face, 22], "y", 11, 2.5);
  pipe(s, [[x, face + 2, 22], [x, face + 26, 22], [x, face + 26, 6]], 6.4, { bend: 15 });
  flange(s, [x, face + 26, 4], "z", 9.5, 2.5, 4);
}

export interface MachineDrawn {
  svg: string;
  width: number;
  height: number;
  /** Set instead of a picture: too many parts, in words. */
  tooMany?: string;
  /** What is on the sheet, in words, for a screen reader. */
  label: string;
}

function finish(s: Sheet, seed: string, label: string): MachineDrawn {
  const pad = 18;
  const x0 = Math.min(...s.xs) - pad;
  const y0 = Math.min(...s.ys) - pad;
  const w = Math.max(...s.xs) + pad - x0;
  const h = Math.max(...s.ys) + pad - y0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="m-sheet" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" data-seed="${esc(seed)}" role="img" aria-label="${esc(label)}">${s.out.join("")}</svg>`;
  return { svg, width: w, height: h, label };
}

export interface MachineRing {
  part: string;
  /** Which of the part's fittings the run ended at. */
  on: "chute" | "housing";
  words: string;
}

export function drawMachine(p: MachineParts, o: { seed: string; ring?: MachineRing | null }): MachineDrawn {
  if (p.housings.length + p.ports.length > MACHINE_PART_LIMIT) {
    return { svg: "", width: 0, height: 0, label: "", tooMany: `This file has ${p.housings.length + p.ports.length} parts, more than the ${MACHINE_PART_LIMIT} the machine can draw and still be read, so here is the chart.` };
  }
  const s = sheetOf(o.seed);
  const col = columns(p);
  const byCol = new Map<number, Housing[]>();
  for (const h of p.housings) byCol.set(col.get(h.id)!, [...(byCol.get(col.get(h.id)!) ?? []), h]);
  const lastCol = Math.max(0, ...col.values());
  const place = new Map<string, Plan>();
  for (const [c, list] of byCol) list.forEach((h, i) => place.set(h.id, { x: c * STEP_X, y: (i - (list.length - 1) / 2) * STEP_Y, w: WIDE, d: DEEP }));
  p.ports.forEach((q, i) => {
    const portCol = Math.max(...q.from.map((f) => col.get(f)!)) + 1;
    place.set(q.id, { x: portCol * STEP_X, y: (i - (p.ports.length - 1) / 2) * STEP_Y + 16, w: 136, d: 88 });
  });
  const portsOf = (id: string) => [...p.pipes.filter((e) => e.from === id).map((e) => ({ to: e.to, kind: e.kind })), ...p.ports.filter((q) => q.from.includes(id)).map((q) => ({ to: q.id, kind: "calls" as const }))];
  const columnsDrawn = Math.max(lastCol, ...p.ports.map((q) => Math.round(place.get(q.id)!.x / STEP_X)));
  let ringAt: { c: [number, number]; rx: number; ry: number; words?: string[] } | null = null;

  for (let c = 0; c <= columnsDrawn; c++) {
    // Ports in this column, then housings, back to front.
    for (const q of p.ports.filter((x) => Math.round(place.get(x.id)!.x / STEP_X) === c)) {
      const pl = place.get(q.id)!;
      open(s, q.id, q.faked ? `${q.name}: a stand-in Atlas passes in place of the real thing. Faked by the test.` : `${q.name}: an outside call this code makes. Not run yet.`);
      floorShadow(s, pl, 12);
      feet(s, pl);
      block(s, pl, 4, 30, { tone: q.faked ? "blue" : "shade", topHatch: q.faked });
      const plate = { x: pl.x + 10, y: pl.y + 18, w: pl.w - 20, d: pl.d - 34 };
      block(s, plate, 34, 1.5, { tone: "bare", width: 0.9 });
      screws(s, plate, 35.5, 4);
      const nameSize = Math.min(16, (plate.w - 16) / (q.name.length * 0.58));
      s.onTop([pl.x + pl.w / 2, pl.y + 42, 35.5], q.name, nameSize);
      s.onTop([pl.x + pl.w / 2, pl.y + 58, 35.5], q.faked ? "faked by the test" : "outside this file", 9.5, { italic: true, cls: "m-soft" });
      close(s);
    }
    const here = (byCol.get(c) ?? []).sort((a, b) => place.get(a.id)!.y - place.get(b.id)!.y);
    for (const h of here) {
      const pl = place.get(h.id)!;
      const top = BODY + 10;
      open(s, h.id, `${h.name}: a function, ${span(h.lines[0], h.lines[1])}${h.exported ? ", exported" : ""}${h.tested ? ", the one Atlas calls" : ""}`);
      floorShadow(s, pl, 18);
      feet(s, pl);
      block(s, pl, 4, BODY);
      // the seam under the lid, and the lid
      block(s, { x: pl.x + 5, y: pl.y + 5, w: pl.w - 10, d: pl.d - 10 }, BODY + 4, 6, { tone: "bare", width: 1 });
      screws(s, { x: pl.x + 5, y: pl.y + 5, w: pl.w - 10, d: pl.d - 10 }, top, 5);
      // the name plate along the front of the lid
      const plate = { x: pl.x + 16, y: pl.y + 58, w: pl.w - 32, d: 44 };
      block(s, plate, top, 1.6, { tone: "bare", width: 0.9 });
      const nameSize = Math.min(18, (plate.w - 12) / (Math.min(h.name.length, 24) * 0.57));
      s.onTop([pl.x + pl.w / 2, pl.y + 80 + nameSize * 0.2, top + 1.6], h.name.length > 24 ? `${h.name.slice(0, 23)}…` : h.name, nameSize);
      s.onTop([pl.x + pl.w / 2, pl.y + 95, top + 1.6], span(h.lines[0], h.lines[1]), 9.5, { cls: "m-soft" });
      close(s);
      // what sits on top, in a row behind the plate
      let slot = pl.x + 28;
      if (h.tested || h.exported) {
        open(s, `${h.id}#inlet`, h.tested ? `${h.name}: Atlas calls this one` : `${h.name}: exported, so it can be called from outside the file`);
        drum(s, slot, pl.y + 30, 11, top, 8);
        drum(s, slot, pl.y + 30, h.tested ? 8.5 : 7, top + 8, 3, { tone: "bare" });
        if (h.tested) s.dot(iso([slot, pl.y + 30, top + 11]), 4.6);
        s.onTop([slot, pl.y + 50, top], h.tested ? "called here" : "inlet", 8.8, { italic: true, cls: "m-soft" });
        close(s);
        slot += 44;
      }
      if (h.waits.length > 0) {
        open(s, `${h.id}#dial`, `${h.name}: waits, ${at(h.waits)}`);
        dial(s, slot + 4, pl.y + 28, 17, top);
        s.onTop([slot + 4, pl.y + 53, top], "waits", 8.8, { italic: true, cls: "m-soft" });
        close(s);
        slot += 48;
      }
      if (h.selfCalls.length > 0 || h.loops.length > 0) {
        const self = h.selfCalls.length > 0;
        open(s, `${h.id}#return`, self ? `${h.name}: calls itself, ${at(h.selfCalls)}` : `${h.name}: a loop, ${at(h.loops)}`);
        const y = pl.y + 26;
        const a = slot - 6;
        const b = slot + 24;
        const hi = top + 32;
        flange(s, [a, y, top], "z", 7, 1.6, 3);
        flange(s, [b, y, top], "z", 7, 1.6, 3);
        pipe(s, [[a, y, top + 2], [a, y, hi], [b, y, hi], [b, y, top + 2]], 4, { bend: 9 });
        wheel(s, (a + b) / 2, y, 14, hi + 9);
        s.onTop([(a + b) / 2, pl.y + 53, top], self ? "calls itself" : "loop", 8.8, { italic: true, cls: "m-soft" });
        close(s);
      }
      // what leaves by the front
      const face = pl.y + DEEP;
      if (h.returns.length > 0) {
        open(s, `${h.id}#return-outlet`, `${h.name}: returns, ${at(h.returns)}`);
        outlet(s, pl.x + 34, face);
        close(s);
        s.note([iso([pl.x + 34, face + 36, 0])[0] - 40, iso([pl.x + 34, face + 36, 0])[1] + 14], "returns", 11.5, { cls: "m-soft" });
      }
      if (h.throws.length > 0) {
        const red = o.ring?.part === h.id && o.ring.on === "chute";
        open(s, `${h.id}#chute`, `${h.name}: throws, ${at(h.throws)}`);
        chute(s, pl.x + WIDE - 62, face, red);
        close(s);
        const end = iso([pl.x + WIDE - 47, face + 46, 2]);
        if (!red) s.note([end[0] - 8, end[1] + 18], `throws, ${at(h.throws)}`, 11.5, { cls: "m-soft", anchor: "end" });
        if (red) ringAt = { c: [iso([pl.x + WIDE - 47, face + 20, 16])[0], iso([pl.x + WIDE - 47, face + 20, 16])[1]], rx: 58, ry: 50, words: [`throws, ${at(h.throws)}`] };
      }
      if (o.ring?.part === h.id && o.ring.on === "housing") {
        const c = iso([pl.x + WIDE / 2, pl.y + DEEP / 2, 44]);
        ringAt = { c: [c[0], c[1]], rx: 148, ry: 112 };
      }
    }
    // The pipes leaving this column run in the gap in front of it, and behind the next one.
    let lane = 0;
    for (const h of here) {
      const pl = place.get(h.id)!;
      const out = portsOf(h.id);
      out.forEach((e, i) => {
        const to = place.get(e.to)!;
        const yFrom = pl.y + (DEEP * (i + 1)) / (out.length + 1);
        const yTo = to.y + to.d / 2;
        const xc = pl.x + WIDE + 42 + lane * 15;
        lane++;
        const z = 24;
        open(s, `${h.id}->${e.to}`, e.kind === "wraps" ? `${e.to} wraps ${h.name}` : `${h.name} calls ${e.to.replace(/^stand-in |^outside /, "")}`);
        pipe(s, [[pl.x + WIDE + 3, yFrom, z], [xc, yFrom, z], [xc, yTo, z], [to.x - 6, yTo, z]], 6.2);
        flange(s, [pl.x + WIDE, yFrom, z], "x", 10, 3);
        flange(s, [to.x - 7, yTo, z], "x", 10, 3);
        if (e.kind === "wraps") {
          const mid = iso([pl.x + WIDE + 30, yFrom, z]);
          s.note([mid[0] + 30, mid[1] - 12], `${to.x === pl.x ? "" : ""}${e.to} wraps ${h.name}`, 11.5, { cls: "m-soft" });
        }
        close(s);
      });
    }
  }
  if (ringAt && o.ring) {
    const r = ringAt as { c: [number, number]; rx: number; ry: number; words?: string[] };
    ringAround(s, r.c, r.rx, r.ry);
    // Under the ring, on clean paper: pipes and shadows run off to the right of it.
    const base = r.c[1] + r.ry + 22;
    [...(r.words ?? []), o.ring.words].forEach((w, i) => s.note([r.c[0] - r.rx * 0.6, base + i * 20], w, i === (r.words?.length ?? 0) ? 15 : 12.5, { cls: "m-redw", anchor: "middle" }));
  }
  return finish(s, o.seed, `A machine of the code: ${p.housings.map((h) => h.name).join(", ")}.`);
}

/**
 * Moonwell's machine, from the same spec as its drawing (renderer/authors/moonwell.ts), so it says nothing that drawing does not. The feed,
 * a pipe, the oracle with its reading in a window, the empty mount where the bettors expected a second source, and the reference beside it.
 */
export function drawMoonwell(spec: RenderSpec, o: { ring: boolean }): MachineDrawn | null {
  const words = (id: string) => spec.nodes.find((n) => n.id === id)?.words;
  const small = (id: string) => spec.nodes.find((n) => n.id === id)?.small;
  const feedName = words("feed");
  const price = words("price");
  if (!feedName || !price) return null;
  const s = sheetOf(spec.seed ?? "moonwell");
  const feed: Plan = { x: 0, y: 8, w: 150, d: 100 };
  const oracle: Plan = { x: 330, y: -6, w: 196, d: 128 };
  const ref: Plan = { x: 410, y: 246, w: 176, d: 96 };
  const mount: Plan = { x: 92, y: 196, w: 128, d: 96 };
  const pipeWords = spec.edges.find((e) => e.id === "e-price")?.words ?? "";

  // the empty mount, furthest back: four holes where a part is not
  if (spec.nodes.some((n) => n.id === "gear")) {
    open(s, "gear", "no multiply step here: the run counted one price source");
    floorShadow(s, mount, 8);
    block(s, mount, 0, 6, { tone: "cream" });
    screws(s, mount, 6, 8);
    const c: W = [mount.x + mount.w / 2, mount.y + mount.d / 2, 6];
    const cog: [number, number][] = [];
    const n = 44;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const r = 24 + (Math.floor((i / n) * 12 * 2) % 2 === 0 ? 5 : 0);
      cog.push(iso([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r, 6]));
    }
    s.raw(`<path class="m-missing" d="M${cog.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("L")}Z"/>`);
    s.seen(cog);
    const w = iso([mount.x, mount.y + mount.d, 0]);
    s.note([w[0] + 40, w[1] + 34], words("gear") ?? "", 14, { cls: "m-redw", anchor: "middle" });
    close(s);
  }
  // the feed
  open(s, "feed", `${feedName}: the feed the price read went through`);
  floorShadow(s, feed, 14);
  feet(s, feed);
  block(s, feed, 4, 46);
  block(s, { x: feed.x + 5, y: feed.y + 5, w: feed.w - 10, d: feed.d - 10 }, 50, 5, { tone: "bare", width: 1 });
  s.onTop([feed.x + feed.w / 2, feed.y + 56, 55], feedName, Math.min(15, 122 / (feedName.length * 0.58)));
  screws(s, { x: feed.x + 5, y: feed.y + 5, w: feed.w - 10, d: feed.d - 10 }, 55, 5);
  close(s);
  // the one pipe
  open(s, "e-price", pipeWords);
  const yy = oracle.y + oracle.d / 2;
  pipe(s, [[feed.x + feed.w + 3, feed.y + 50, 26], [240, feed.y + 50, 26], [240, yy, 26], [oracle.x - 6, yy, 26]], 7.2);
  flange(s, [feed.x + feed.w, feed.y + 50, 26], "x", 11, 3);
  flange(s, [oracle.x - 7, yy, 26], "x", 11, 3);
  close(s);
  s.note([iso([240, feed.y + 62, 0])[0] - 20, iso([240, feed.y + 62, 0])[1] + 16], pipeWords, 14, { anchor: "end" });
  // the oracle, with its reading in a window
  open(s, "price", `${price}, ${small("price") ?? ""}`);
  floorShadow(s, oracle, 18);
  feet(s, oracle);
  block(s, oracle, 4, 56);
  const lid = { x: oracle.x + 5, y: oracle.y + 5, w: oracle.w - 10, d: oracle.d - 10 };
  block(s, lid, 60, 6, { tone: "bare", width: 1 });
  screws(s, lid, 66, 5);
  const win = { x: oracle.x + 18, y: oracle.y + 32, w: oracle.w - 36, d: 64 };
  block(s, win, 66, 1.6, { tone: "bare", width: 0.9 });
  const m = /^(.*?)(\$[\d,.]+)$/.exec(price);
  s.onTop([oracle.x + oracle.w / 2, oracle.y + 49, 67.6], (m?.[1] ?? "").trim(), 11, { italic: true, cls: "m-soft" });
  s.onTop([oracle.x + oracle.w / 2, oracle.y + 76, 67.6], m?.[2] ?? price, 24);
  s.onTop([oracle.x + oracle.w / 2, oracle.y + 92, 67.6], small("price") ?? "", 9.5, { cls: "m-soft" });
  close(s);
  // the reference, set apart: plain code's sum, joined by a dotted line because nothing flows along it
  const refWords = words("ref");
  if (refWords) {
    const a = iso([ref.x + 20, ref.y, 30]);
    const b = iso([oracle.x + oracle.w - 30, oracle.y + oracle.d, 20]);
    s.raw(`<path class="m-ring-dash" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}"/>`);
    open(s, "ref", `${refWords}, ${small("ref") ?? ""}`);
    floorShadow(s, ref, 12);
    feet(s, ref);
    block(s, ref, 4, 26);
    const pl = { x: ref.x + 10, y: ref.y + 14, w: ref.w - 20, d: ref.d - 28 };
    block(s, pl, 30, 1.5, { tone: "bare", width: 0.9 });
    screws(s, pl, 31.5, 4);
    const mm = /^(.*?)(\$[\d,.]+)$/.exec(refWords);
    s.onTop([ref.x + ref.w / 2, ref.y + 37, 31.5], (mm?.[1] ?? "").trim(), 9.5, { italic: true, cls: "m-soft" });
    s.onTop([ref.x + ref.w / 2, ref.y + 56, 31.5], mm?.[2] ?? refWords, 18);
    close(s);
    s.onTop([ref.x + ref.w / 2, ref.y + 70, 31.5], small("ref") ?? "", 9, { cls: "m-soft", italic: true });
  }
  // the ring, and what each bettor said
  const c = iso([oracle.x + oracle.w / 2, oracle.y + oracle.d / 2 + 2, 67]);
  if (o.ring) ringAround(s, [c[0], c[1]], 112, 66, { dashed: spec.marks.some((k) => k.kind === "cant-check") });
  const marks = spec.marks.filter((k) => k.on === "price");
  marks.forEach((k, i) => {
    const off = c[0] + 138;
    const y = c[1] - 58 + i * 22;
    s.note([off, y], `${k.who} ${k.words}`, 14.5, { cls: k.kind === "didnt-match" ? "m-redw" : "" });
  });
  return finish(s, spec.seed ?? "moonwell", `A machine of the Moonwell read: ${feedName}, ${pipeWords}, ${price}.`);
}
