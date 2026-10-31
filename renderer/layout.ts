// R3: spec → Mermaid → pele → Scene. Browser-safe, Worker-safe, Node-safe: no DOM anywhere.
//
// Plain words: pele (a Mermaid renderer, MIT) decides where the boxes and lines go. It is given Mermaid text and returns
// SVG, which is read back for its geometry only (the reading is ported from statechart-art's tools/lib/layout.js, MIT).
//
// The safety idea: a stranger's name NEVER enters the Mermaid text. Pele only ever sees short tokens like "N3A", and its
// measurer is told how wide each token really is, in the real font. So no name can break out of the Mermaid syntax,
// and the real words are written later by our own escaper.
//
// Words beside each line are placed with the search from statechart-art's tools/lib/tagchart.js (MIT): try close beside
// the line, then further along it, and never on another word, a node or another line. If no clean spot exists the words
// are not drawn (the check forbids overlaps) and stay in the tooltip and the list, counted in `hiddenLabels`.

import { register, render } from "pele/core";
import flowchart from "pele/diagrams/flowchart";
import { polyLen, resample, rng, trim, type Pt } from "./hand";
import type { Box, Scene, SceneEdge, SceneMark, SceneNode, SceneRegion, TextBlock } from "./scene";
import type { RenderSpec, SpecNode } from "./spec";
import { cleanWords, textWidth, wrapWords, type Face } from "./words";

register(flowchart);

export const TYPE = { node: 23, small: 11, edge: 18, region: 16, title: 66, kicker: 17, subtitle: 22, caption: 15, mark: 17, note: 17, tag: 14.5 } as const;
const LINE = { node: 29, note: 23, edge: 22, caption: 21, mark: 22, tag: 18 } as const;
const MARGIN = 48;
/** The radius of a clock's dial. */
export const CLOCK_R = 25;

/** Past this, Atlas shows the list instead of drawing (the budget that keeps a page from freezing). */
export const LAYOUT_LIMITS = { nodes: 150, edges: 420, work: 6_000_000 };

export class OverBudget extends Error {
  constructor(public why: string) {
    super(why);
    this.name = "OverBudget";
  }
}

interface Measured {
  node: SpecNode;
  w: number;
  h: number;
  face: Face;
  size: number;
  lines: string[];
}

/** How big a node wants to be, from its words in the real font. */
function measureNode(n: SpecNode): Measured {
  const clean = cleanWords(n.words);
  if (n.kind === "note") {
    const lines = wrapWords(clean, 300, TYPE.note, "italic", 4);
    const tw = Math.max(...lines.map((l) => textWidth(l, TYPE.note, "italic")));
    return { node: n, w: Math.max(120, tw + 44), h: lines.length * LINE.note + 34, face: "italic", size: TYPE.note, lines };
  }
  const lines = wrapWords(clean, 290, TYPE.node, "regular", 3);
  const tw = Math.max(...lines.map((l) => textWidth(l, TYPE.node, "regular")));
  // The dial sits at the middle of its box, so a thread lands on the dial; the words sit to its right on clean paper.
  if (n.kind === "clock") return { node: n, w: (tw + CLOCK_R + 16) * 2, h: Math.max(CLOCK_R * 2 + 8, lines.length * LINE.node + 8), face: "regular", size: TYPE.node, lines };
  if (n.kind === "device") return { node: n, w: tw + 84, h: lines.length * LINE.node + 44, face: "regular", size: TYPE.node, lines };
  if (n.kind === "deck") return { node: n, w: tw + 66, h: lines.length * LINE.node + 46, face: "regular", size: TYPE.node, lines };
  // The tiny red words sit left of the pin, so a ticket is wide enough for them to clear it.
  const smallW = n.small ? textWidth(cleanWords(n.small).slice(0, 40), TYPE.small, "regular") : 0;
  return { node: n, w: Math.max(150, tw + 64, Math.min(320, (smallW + 11 + 16) * 2)), h: lines.length * LINE.node + 54, face: "regular", size: TYPE.node, lines };
}

const ATTR = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The points along an SVG path (M, L, H, V, C, Z), Bezier curves sampled. Ported from tools/lib/layout.js. */
function pathPoints(d: string): Pt[] {
  const out: Pt[] = [];
  const tok = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Z]/i.test(tok[i]!)) cmd = tok[i++]!;
    if (cmd === "M" || cmd === "L") {
      x = n();
      y = n();
      out.push([x, y]);
    } else if (cmd === "H") {
      x = n();
      out.push([x, y]);
    } else if (cmd === "V") {
      y = n();
      out.push([x, y]);
    } else if (cmd === "C") {
      const x1 = n();
      const y1 = n();
      const x2 = n();
      const y2 = n();
      const x3 = n();
      const y3 = n();
      for (let k = 1; k <= 14; k++) {
        const t = k / 14;
        const u = 1 - t;
        out.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
      }
      x = x3;
      y = y3;
    } else if (cmd === "Z") {
      if (out.length) out.push([out[0]![0], out[0]![1]]);
    } else i++;
  }
  return out;
}

const overlap = (a: Box, b: Box, g = 0) => a.x0 < b.x1 + g && a.x1 > b.x0 - g && a.y0 < b.y1 + g && a.y1 > b.y0 - g;

/** Where lines already are, by grid cell, so "does this box hit a line?" does not walk every line. */
class PointGrid {
  private cells = new Map<number, Pt[]>();
  constructor(private cell = 24) {}
  private key(cx: number, cy: number) {
    return cx * 100003 + cy;
  }
  add(p: Pt) {
    const k = this.key(Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell));
    const l = this.cells.get(k);
    if (l) l.push(p);
    else this.cells.set(k, [p]);
  }
  hits(b: Box, gap = 3): boolean {
    const x0 = Math.floor((b.x0 - gap) / this.cell);
    const x1 = Math.floor((b.x1 + gap) / this.cell);
    const y0 = Math.floor((b.y0 - gap) / this.cell);
    const y1 = Math.floor((b.y1 + gap) / this.cell);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const l = this.cells.get(this.key(x, y));
        if (l) for (const p of l) if (p[0] > b.x0 - gap && p[0] < b.x1 + gap && p[1] > b.y0 - gap && p[1] < b.y1 + gap) return true;
      }
    return false;
  }
}

function block(role: TextBlock["role"], face: Face, size: number, rawLines: string[], x: number, top: number, lh: number, owner?: string, align: "left" | "center" | "right" = "left"): TextBlock {
  const lines = rawLines.map((text, i) => {
    const w = textWidth(text, size, face);
    const lx = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
    return { text, x: lx, y: top + (i + 0.78) * lh, w };
  });
  const x0 = Math.min(...lines.map((l) => l.x));
  const x1 = Math.max(...lines.map((l) => l.x + l.w));
  return { role, owner, face, size, lines, box: { x0, x1, y0: top, y1: top + lines.length * lh } };
}

function shiftBlock(b: TextBlock, dx: number, dy: number) {
  for (const l of b.lines) {
    l.x += dx;
    l.y += dy;
  }
  b.box = { x0: b.box.x0 + dx, x1: b.box.x1 + dx, y0: b.box.y0 + dy, y1: b.box.y1 + dy };
}

export interface LayoutOptions {
  /** A phone: the title sits above the chart, smaller, and words beside things wrap sooner. */
  narrow?: boolean;
}

/** Lays a valid spec out. Throws OverBudget past the limits, or if pele's output cannot be read completely. */
export function layOut(spec: RenderSpec, o: LayoutOptions = {}): Scene {
  const narrow = o.narrow === true;
  if (spec.nodes.length > LAYOUT_LIMITS.nodes) throw new OverBudget(`${spec.nodes.length} parts is more than the drawing's limit of ${LAYOUT_LIMITS.nodes}`);
  if (spec.edges.length > LAYOUT_LIMITS.edges) throw new OverBudget(`${spec.edges.length} lines is more than the drawing's limit of ${LAYOUT_LIMITS.edges}`);
  let work = 0;
  const spend = (n: number) => {
    work += n;
    if (work > LAYOUT_LIMITS.work) throw new OverBudget("placing the words took more work than the drawing's budget");
  };

  const R = rng(`layout:${spec.seed}`);
  const direction = spec.direction ?? "TD";
  const measured = spec.nodes.map(measureNode);
  const nodeToken = new Map(spec.nodes.map((n, i) => [n.id, `n${i}`]));
  const regionToken = new Map(spec.regions.map((r, i) => [r.id, `r${i}`]));
  const widths = new Map<string, number>();
  const tok = (name: string, w: number) => {
    widths.set(name, w);
    return name;
  };

  // ---- the Mermaid text: tokens only ----
  const nodeLine = (m: Measured, i: number) => {
    const count = Math.max(1, Math.ceil((m.h - 48) / 18) + 1);
    const parts = [tok(`N${i}A`, Math.max(40, m.w - 36))];
    for (let k = 1; k < count; k++) parts.push(tok(`N${i}B${k}`, 1));
    return `n${i}["${parts.join("<br/>")}"]`;
  };
  const edgeLines = new Map<string, string[]>();
  const body: string[] = [];
  const childrenOf = new Map<string | undefined, string[]>();
  const usedRegions = new Set<string>();
  for (const n of spec.nodes) {
    let r = n.region;
    while (r !== undefined && !usedRegions.has(r)) {
      usedRegions.add(r);
      r = spec.regions.find((x) => x.id === r)?.parent;
    }
  }
  for (const r of spec.regions) {
    if (!usedRegions.has(r.id)) continue;
    const l = childrenOf.get(r.parent) ?? [];
    l.push(r.id);
    childrenOf.set(r.parent, l);
  }
  const emitRegion = (id: string, depth: number) => {
    const t = regionToken.get(id)!;
    const reg = spec.regions.find((r) => r.id === id)!;
    const name = tok(`R${t.slice(1)}A`, textWidth(cleanWords(reg.words).slice(0, 80), TYPE.region, "italic") + 20);
    body.push(`${" ".repeat(depth * 2)}subgraph ${t}["${name}"]`);
    for (const c of childrenOf.get(id) ?? []) emitRegion(c, depth + 1);
    spec.nodes.forEach((n, i) => {
      if (n.region === id) body.push(`${" ".repeat(depth * 2 + 2)}${nodeLine(measured[i]!, i)}`);
    });
    body.push(`${" ".repeat(depth * 2)}end`);
  };
  for (const c of childrenOf.get(undefined) ?? []) emitRegion(c, 1);
  spec.nodes.forEach((n, i) => {
    if (n.region === undefined) body.push(`  ${nodeLine(measured[i]!, i)}`);
  });
  spec.edges.forEach((e, i) => {
    const from = nodeToken.get(e.from)!;
    const to = nodeToken.get(e.to)!;
    const clean = e.words ? cleanWords(e.words) : "";
    let label = "";
    if (clean) {
      const lines = wrapWords(clean, 230, TYPE.edge, "italic", 3);
      edgeLines.set(e.id, lines);
      label = `|"${lines.map((l, j) => tok(`E${i}L${j}`, textWidth(l, TYPE.edge, "italic"))).join("<br/>")}"|`;
    }
    body.push(`  ${from} ${e.kind === "thread" ? "-->" : "-.->"}${label} ${to}`);
  });
  const dense = spec.edges.length > 24;
  const source = `---\nconfig:\n  flowchart:\n    rankSpacing: ${dense ? 56 : spec.marks.length ? 60 : 44}\n    nodeSpacing: ${dense ? 46 : 72}\n---\nflowchart ${direction}\n${body.join("\n")}\n`;

  // ---- pele ----
  let svg = "";
  if (spec.nodes.length > 0) {
    const measurer = { width: (text: string, size: number) => ((widths.get(text.trim()) ?? 40) * (widths.has(text.trim()) && /^[NR]/.test(text.trim()) ? size / 16 : 1)) };
    svg = render(source, { measurer, fontFamily: "Besley", fontSize: 16, padding: 12, responsive: false, limit: 1_000_000, outputLimit: 12_000_000, maxEdges: 10_000, links: false, images: false }).svg;
  }

  // ---- read the geometry back ----
  const rawNodes = new Map<string, Box>();
  for (const m of svg.matchAll(/<g class="pele-node[^"]*" data-id="([^"]+)" transform="translate\(([-\d.]+),([-\d.]+)\)">\s*<rect([^>]*)>/g)) {
    const cx = Number(m[2]);
    const cy = Number(m[3]);
    const w = Number(ATTR(m[4]!, "width"));
    const h = Number(ATTR(m[4]!, "height"));
    rawNodes.set(m[1]!, { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
  }
  const rawClusters = new Map<string, Box>();
  for (const m of svg.matchAll(/<g class="pele-cluster[^"]*" data-id="([^"]+)">\s*<rect([^>]*)>/g)) {
    const x = Number(ATTR(m[2]!, "x"));
    const y = Number(ATTR(m[2]!, "y"));
    rawClusters.set(m[1]!, { x0: x, y0: y, x1: x + Number(ATTR(m[2]!, "width")), y1: y + Number(ATTR(m[2]!, "height")) });
  }
  // Pele writes the edges in the order they were given, with ids like L_n0_n1_2: the order maps them, the id double-checks it.
  const rawEdges = new Map<string, { pts: Pt[]; tip: Pt | null }>();
  let edgeIndex = 0;
  for (const m of svg.matchAll(/<g class="pele-edge(?: [^"]*)?" data-id="([^"]+)">([\s\S]*?)<\/g>/g)) {
    const spe = spec.edges[edgeIndex++];
    if (!spe) throw new OverBudget("the layout drew more lines than the chart has");
    const expected = `L_${nodeToken.get(spe.from)}_${nodeToken.get(spe.to)}_`;
    if (!m[1]!.startsWith(expected)) throw new OverBudget(`the layout's line ${JSON.stringify(m[1])} is not the chart's line ${JSON.stringify(spe.id)}`);
    const paths = [...m[2]!.matchAll(/<path( class="pele-marker")?[^>]*? d="([^"]+)"/g)];
    const line = paths.find((p) => !p[1]);
    const marker = paths.find((p) => p[1]);
    if (line) rawEdges.set(spe.id, { pts: pathPoints(line[2]!), tip: marker ? pathPoints(marker[2]!)[0]! : null });
  }
  spec.nodes.forEach((n, i) => {
    if (!rawNodes.has(`n${i}`)) throw new OverBudget(`the layout did not place the part ${JSON.stringify(cleanWords(n.words))}`);
  });
  for (const e of spec.edges) if (!rawEdges.has(e.id)) throw new OverBudget(`the layout did not route the line ${JSON.stringify(e.id)}`);

  // ---- nodes ----
  const pins: SceneNode["pin"][] = ["red", "blue", "ochre"];
  const nodes: SceneNode[] = spec.nodes.map((n, i) => {
    const m = measured[i]!;
    const box = rawNodes.get(`n${i}`)!;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const lh = n.kind === "note" ? LINE.note : LINE.node;
    const blockH = m.lines.length * lh;
    let textX = cx;
    let align: "center" | "left" = "center";
    let top = cy - blockH / 2 + (n.kind === "ticket" ? 7 : 0);
    if (n.kind === "clock") {
      textX = cx + CLOCK_R + 13;
      align = "left";
      top = cy - blockH / 2;
    } else if (n.kind === "device") {
      textX = cx - 11;
    }
    const text = block("node", m.face, m.size, m.lines, textX, top, lh, n.id, align);
    const small = n.small && n.kind === "ticket" ? block("small", "regular", TYPE.small, [wrapWords(cleanWords(n.small), (box.x1 - box.x0) / 2 - 11 - 13, TYPE.small, "regular", 1)[0]!], box.x0 + 11, box.y0 + 3, 14, n.id) : null;
    const sourceWords = (n.sourceLines ?? []).map((s) => `${s.path ? `${cleanWords(s.path)} ` : ""}line${s.lineEnd > s.lineStart ? "s" : ""} ${s.lineStart}${s.lineEnd > s.lineStart ? `-${s.lineEnd}` : ""}`).join(", ");
    return {
      id: n.id,
      kind: n.kind,
      provenance: n.provenance,
      box,
      tilt: n.kind === "ticket" ? R.range(-0.8, 0.8) : n.kind === "note" ? R.range(-1.4, 1.4) : 0,
      pin: n.pin ?? pins[i % 3]!,
      pivot: [cx, box.y0],
      missing: n.missing === true,
      sweep: n.sweep ?? 0.2,
      text,
      small,
      full: cleanWords(n.words),
      sourceWords,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // A node with a mark has a ring or a tick round it, so words keep clear of that too.
  const ringed = new Map<string, number>();
  for (const m of spec.marks) ringed.set(m.on, Math.max(ringed.get(m.on) ?? 0, m.kind === "cant-check" ? 30 : 20));
  const blockers: Box[] = nodes.map((n) => {
    const r = ringed.get(n.id) ?? 0;
    return { x0: n.box.x0 - 3 - r, x1: n.box.x1 + 9 + r, y0: n.box.y0 - 10 - r, y1: n.box.y1 + 11 + r };
  });

  // ---- regions ----
  const regionDepth = (id: string): number => {
    let d = 0;
    let p = spec.regions.find((r) => r.id === id)?.parent;
    while (p !== undefined) {
      d++;
      p = spec.regions.find((r) => r.id === p)?.parent;
    }
    return d;
  };
  const regions: SceneRegion[] = [];
  spec.regions.forEach((r) => {
    const t = regionToken.get(r.id)!;
    const box = rawClusters.get(t);
    if (!box) return;
    const words = wrapWords(cleanWords(r.words), box.x1 - box.x0 - 24, TYPE.region, "italic", 1)[0]!;
    const label = block("region", "italic", TYPE.region, [words], box.x0 + 14, box.y0 + 5, 20, r.id);
    regions.push({ id: r.id, kind: r.kind, box, label, depth: regionDepth(r.id) });
  });

  // ---- edges: trimmed so they stop short of what they point at ----
  const pathEdges = new Set(spec.path?.edges ?? []);
  const grid = new PointGrid();
  const edges: SceneEdge[] = [];
  const pelePts = new Map<string, Pt[]>();
  for (const e of spec.edges) {
    const id = e.id;
    const raw = rawEdges.get(id)!;
    const route = raw.tip ? [...raw.pts, raw.tip] : raw.pts;
    const target = nodeById.get(e.to)!;
    const tip = route[route.length - 1]!;
    const nearPin = target.kind === "ticket" && Math.hypot(tip[0] - target.pivot[0], tip[1] - target.pivot[1]) < 26;
    let pts = trim(route, 5, nearPin ? 15 : 8);
    // A thread to a clock aims at the dial, wherever the layout landed it on the clock's wider box.
    if (target.kind === "clock") {
      const cx = (target.box.x0 + target.box.x1) / 2;
      const cy = (target.box.y0 + target.box.y1) / 2;
      const end = pts[pts.length - 1]!;
      const back = pts[Math.max(0, pts.length - 2)]!;
      const dir = Math.atan2(end[1] - cy, end[0] - cx) || Math.atan2(back[1] - cy, back[0] - cx);
      const aim: Pt = [cx + Math.cos(dir) * (CLOCK_R + 9), cy + Math.sin(dir) * (CLOCK_R + 9)];
      const total = polyLen(pts);
      let at = 0;
      pts = pts.map((p, i) => {
        if (i > 0) at += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
        const u = Math.max(0, (at / (total || 1) - 0.25) / 0.75);
        const w = u * u * (3 - 2 * u);
        return [p[0] + (aim[0] - end[0]) * w, p[1] + (aim[1] - end[1]) * w];
      });
    }
    pelePts.set(id, pts);
  }

  // A dense chart: lines into one part gather into a bundle just above it, so many arrows read as one river, not a fan.
  if (spec.quiet) {
    const inbound = new Map<string, string[]>();
    for (const e of spec.edges) {
      if (e.kind !== "thread" || e.from === e.to) continue;
      inbound.set(e.to, [...(inbound.get(e.to) ?? []), e.id]);
    }
    for (const [to, ids] of inbound) {
      if (ids.length < 3) continue;
      const target = nodeById.get(to)!;
      const aim: Pt = [target.pivot[0], target.pivot[1] - 15];
      const trunk: Pt = [aim[0], aim[1] - 26];
      for (const id of ids) {
        const pts = pelePts.get(id)!;
        if (pts[pts.length - 1]![1] > target.box.y0 + 4) continue; // it comes in from the side or below: leave it
        const total = polyLen(pts);
        const end = pts[pts.length - 1]!;
        let at = 0;
        const bent = pts.map((p, i) => {
          if (i > 0) at += Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]);
          const u = Math.max(0, Math.min(1, (at - (total - Math.min(total, 120))) / Math.min(total, 120)));
          const w = u * u * (3 - 2 * u);
          return [p[0] + (trunk[0] - end[0]) * w, p[1] + (trunk[1] - end[1]) * w] as Pt;
        });
        pelePts.set(id, [...bent, aim]);
      }
    }
  }
  for (const pts of pelePts.values()) for (const p of resample(pts, 5)) grid.add(p);

  // A region's label moves along its top edge to where no line runs; a region's outline counts as a line for all words.
  for (const r of regions) {
    const b = r.box;
    const perimeter = resample([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]], 5);
    const w = r.label.box.x1 - r.label.box.x0;
    for (let dx = 0; dx + w < b.x1 - b.x0 - 20; dx += 26) {
      const try0 = { x0: r.label.box.x0 + dx - 3, x1: r.label.box.x1 + dx + 3, y0: r.label.box.y0, y1: r.label.box.y1 };
      if (!grid.hits(try0, 2) && !blockers.some((t) => overlap(try0, t))) {
        shiftBlock(r.label, dx, 0);
        break;
      }
    }
    for (const p of perimeter) grid.add(p);
    blockers.push({ x0: r.label.box.x0 - 3, x1: r.label.box.x1 + 3, y0: r.label.box.y0, y1: r.label.box.y1 });
  }

  // ---- words beside the lines ----
  const taken: Box[] = [...blockers];
  const clash = (b: Box) => {
    spend(taken.length + 4);
    return taken.some((t) => overlap(b, t)) || grid.hits(b);
  };
  const steps = (step: number, last: number) => {
    const ts = [0.5];
    for (let d = step; d <= last; d += step) ts.push(0.5 - d, 0.5 + d);
    return ts;
  };
  const PASSES: [number[], number[]][] = [
    [[10, 14], steps(0.05, 0.42)],
    [[9, 13, 18, 26], steps(0.025, 0.45)],
  ];
  let hiddenLabels = 0;
  // Path words first: they matter most. Then in spec order.
  const order = [...spec.edges].sort((a, b) => Number(pathEdges.has(b.id)) - Number(pathEdges.has(a.id)));
  const labelOf = new Map<string, TextBlock | null>();
  for (const e of order) {
    const lines = edgeLines.get(e.id);
    if (!lines) continue;
    const route = resample(pelePts.get(e.id)!, 6);
    const w = Math.max(...lines.map((l) => textWidth(l, TYPE.edge, "italic")));
    const h = lines.length * LINE.edge;
    let best: { x0: number; y0: number; side: 1 | -1 | 0 } | null = null;
    const at = (t: number): [Pt, Pt, Pt] => {
      const i = Math.round(t * (route.length - 1));
      return [route[i]!, route[Math.max(0, i - 2)]!, route[Math.min(route.length - 1, i + 2)]!];
    };
    search: for (const [offs, ts] of PASSES)
      for (const off of offs)
        for (const t of ts) {
          const [mid, a, c] = at(t);
          const vertical = Math.abs(c[1] - a[1]) >= Math.abs(c[0] - a[0]);
          for (const [sx, sy] of vertical ? ([[1, 0], [-1, 0]] as const) : ([[0, -1], [0, 1]] as const)) {
            const x0 = sx > 0 ? mid[0] + off : sx < 0 ? mid[0] - off - w : mid[0] - w / 2;
            const y0 = sy < 0 ? mid[1] - off - h : sy > 0 ? mid[1] + off : mid[1] - h / 2;
            const b = { x0: x0 - 2, x1: x0 + w + 2, y0, y1: y0 + h };
            if (!clash(b)) {
              best = { x0, y0, side: sx };
              break search;
            }
          }
        }
    if (!best) {
      labelOf.set(e.id, null);
      hiddenLabels++;
      continue;
    }
    const blockLabel = best.side < 0 ? block("edge", "italic", TYPE.edge, lines, best.x0 + w, best.y0, LINE.edge, e.id, "right") : block("edge", "italic", TYPE.edge, lines, best.x0, best.y0, LINE.edge, e.id);
    taken.push({ x0: blockLabel.box.x0 - 4, x1: blockLabel.box.x1 + 4, y0: blockLabel.box.y0 - 1, y1: blockLabel.box.y1 + 1 });
    labelOf.set(e.id, blockLabel);
  }
  for (const e of spec.edges) {
    const pts = pelePts.get(e.id)!;
    edges.push({
      id: e.id,
      from: e.from,
      to: e.to,
      kind: e.kind,
      provenance: e.provenance,
      onPath: pathEdges.has(e.id),
      pts,
      label: labelOf.get(e.id) ?? null,
      full: e.words ? cleanWords(e.words) : "",
      labelHidden: !!edgeLines.get(e.id) && !labelOf.get(e.id),
      weight: e.weight ?? 1,
    });
  }

  // ---- marks: their words on clean paper beside the node, pushed out until they are ----
  const marks: SceneMark[] = spec.marks.map((m) => {
    const node = nodeById.get(m.on)!;
    const text = cleanWords(`${m.who}${m.words ? `${m.kind === "cant-check" ? ": " : " "}${m.words}` : ""}`);
    const lines = wrapWords(text, narrow ? 150 : 300, TYPE.mark, "italic", narrow ? 8 : 6);
    const w = Math.max(...lines.map((l) => textWidth(l, TYPE.mark, "italic")));
    const h = lines.length * LINE.mark;
    const cy = (node.box.y0 + node.box.y1) / 2 - h / 2;
    let placed: TextBlock | null = null;
    for (let push = 0; push < 60 && !placed; push++) {
      for (const side of [1, -1]) {
        const x = side > 0 ? node.box.x1 + 34 + push * 16 : node.box.x0 - 34 - w - push * 16;
        const b = { x0: x - 3, x1: x + w + 3, y0: cy - 3, y1: cy + h + 3 };
        if (side < 0 && x < -2000) continue;
        if (!clash(b)) {
          placed = block("mark", "italic", TYPE.mark, lines, x, cy, LINE.mark, m.on);
          taken.push(b);
          break;
        }
      }
    }
    if (!placed) {
      const b0 = Math.max(...taken.map((t) => t.y1)) + 10;
      placed = block("mark", "italic", TYPE.mark, lines, node.box.x0, b0, LINE.mark, m.on);
      taken.push(placed.box);
    }
    return { on: m.on, kind: m.kind, words: placed };
  });

  // ---- tags: a part's notes (failure labels), on clean paper beside it ----
  const tags: TextBlock[] = (spec.tags ?? []).map((t) => {
    const node = nodeById.get(t.on)!;
    const lines = wrapWords(cleanWords(t.words), narrow ? 150 : 260, TYPE.tag, "italic", 3);
    const w = Math.max(...lines.map((l) => textWidth(l, TYPE.tag, "italic")));
    const h = lines.length * LINE.tag;
    for (let push = 0; push < 80; push++) {
      for (const side of [1, -1]) {
        const x = side > 0 ? node.box.x1 + 14 + push * 14 : node.box.x0 - 14 - w - push * 14;
        const y = node.box.y0 + 8;
        const b = { x0: x - 3, x1: x + w + 3, y0: y - 2, y1: y + h + 2 };
        if (!clash(b)) {
          taken.push(b);
          return block("tag", "italic", TYPE.tag, lines, x, y, LINE.tag, t.on);
        }
      }
    }
    const y = Math.max(...taken.map((b) => b.y1)) + 8;
    const placed = block("tag", "italic", TYPE.tag, lines, node.box.x0, y, LINE.tag, t.on);
    taken.push(placed.box);
    return placed;
  });

  // ---- the plate: bounds, then the title where the paper is clean, then captions below ----
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (b: Box) => {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  };
  for (const b of taken) grow(b);
  for (const r of regions) grow(r.box);
  for (const e of edges) for (const p of e.pts) grow({ x0: p[0], x1: p[0], y0: p[1], y1: p[1] });
  if (x0 === Infinity) {
    x0 = 0;
    y0 = 0;
    x1 = 480;
    y1 = 120;
  }
  const chartW = x1 - x0;
  const kicker = spec.kicker ? block("kicker", "regular", TYPE.kicker, [wrapWords(cleanWords(spec.kicker), 520, TYPE.kicker, "regular", 1)[0]!], 0, 0, 24) : null;
  const titleSize = narrow ? 44 : TYPE.title;
  const titleLines = spec.title ? wrapWords(cleanWords(spec.title), narrow ? Math.max(340, chartW) : 640, titleSize, "regular", 2) : [];
  const title = titleLines.length ? block("title", "regular", titleSize, titleLines, 0, 0, titleSize * 1.18) : null;
  const subtitle = spec.subtitle ? block("subtitle", "italic", TYPE.subtitle, wrapWords(cleanWords(spec.subtitle), narrow ? Math.max(340, chartW) : 620, TYPE.subtitle, "italic", 3), 0, 0, 30) : null;
  const stack = [kicker, title, subtitle].filter((b): b is TextBlock => b !== null);
  let stackH = 0;
  let stackW = 0;
  for (const b of stack) {
    shiftBlock(b, 0, stackH);
    stackH += b.box.y1 - b.box.y0 + (b.role === "kicker" ? 6 : 8);
    stackW = Math.max(stackW, b.box.x1 - b.box.x0);
  }
  const allPts = edges.flatMap((e) => e.pts);
  const free = (b: Box) => !taken.some((t) => overlap(b, t, 18)) && !regions.some((r) => overlap(b, r.box, 18)) && !allPts.some((p) => p[0] > b.x0 - 18 && p[0] < b.x1 + 18 && p[1] > b.y0 - 18 && p[1] < b.y1 + 18);
  // The plate's habit: title top left, beside the chart, when the paper there is clean.
  let originX = x0 - Math.max(0, stackW + 60 - (chartW > stackW * 2 ? chartW * 0.3 : 0));
  let originY = y0;
  if (stack.length > 0) {
    const tryAt = { x0: x0, y0: y0, x1: x0 + stackW, y1: y0 + stackH };
    if (narrow) {
      originX = x0;
      originY = y0 - stackH - 26;
    } else if (free(tryAt)) {
      originX = x0;
    } else {
      const beside = { x0: x0 - stackW - 56, y0, x1: x0 - 56, y1: y0 + stackH };
      if (chartW + stackW + 56 < 1500 && free(beside)) originX = beside.x0;
      else {
        originX = x0;
        originY = y0 - stackH - 34;
      }
    }
    for (const b of stack) {
      shiftBlock(b, originX, originY);
      grow(b.box);
    }
  }
  const captions: TextBlock[] = [];
  let capY = y1 + 26;
  const capW = narrow ? Math.max(340, x1 - x0) : Math.max(460, Math.min(x1 - x0, 880));
  const hiddenWords = hiddenLabels > 0 ? [`${hiddenLabels} line${hiddenLabels === 1 ? "'s" : "s'"} words had no clean spot on the paper, so ${hiddenLabels === 1 ? "they are" : "they are"} not drawn: hover the line to read them.`] : [];
  for (const words of [...(spec.legend ? [spec.legend] : []), ...spec.captions.map((c) => c.words), ...hiddenWords]) {
    const lines = wrapWords(cleanWords(words), capW, TYPE.caption, "italic", 5);
    const b = block("caption", "italic", TYPE.caption, lines, x0, capY, LINE.caption);
    captions.push(b);
    capY = b.box.y1 + 6;
    grow(b.box);
  }

  // ---- move everything so the plate starts at the margin ----
  const dx = MARGIN - x0;
  const dy = MARGIN - y0;
  const moveBox = (b: Box) => {
    b.x0 += dx;
    b.x1 += dx;
    b.y0 += dy;
    b.y1 += dy;
  };
  for (const n of nodes) {
    moveBox(n.box);
    n.pivot = [n.pivot[0] + dx, n.pivot[1] + dy];
    shiftBlock(n.text, dx, dy);
    if (n.small) shiftBlock(n.small, dx, dy);
  }
  for (const e of edges) {
    e.pts = e.pts.map((p) => [p[0] + dx, p[1] + dy]);
    if (e.label) shiftBlock(e.label, dx, dy);
  }
  for (const r of regions) {
    moveBox(r.box);
    shiftBlock(r.label, dx, dy);
  }
  for (const m of marks) shiftBlock(m.words, dx, dy);
  for (const t of tags) shiftBlock(t, dx, dy);
  for (const b of [...stack, ...captions]) shiftBlock(b, dx, dy);
  regions.sort((a, b) => a.depth - b.depth);
  return {
    width: Math.ceil(x1 - x0 + MARGIN * 2),
    height: Math.ceil(y1 - y0 + MARGIN * 2),
    seed: spec.seed,
    nodes,
    edges,
    regions,
    marks,
    tags,
    quiet: spec.quiet === true,
    title,
    kicker,
    subtitle,
    captions,
    hiddenLabels,
    direction,
  };
}
