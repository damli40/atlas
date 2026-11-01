// D65 style proof: solid things in the 3D angle, drawn by the same hand as the rest of Atlas's drawings. A filled face so nearer things
// hide farther ones, pencil hatch for the sides, and each edge a separate ink stroke from renderer/hand.ts. Pure: same seed, same picture.

import { handLine, hatchPath, inkPoly, linePath, ribbon, rng, TAU, type Pt, type Rng } from "../hand";

export type W = [number, number, number];
const C = Math.cos(Math.PI / 6);
const S = 0.5;
/** World to page. x runs down to the right, y down to the left, z up. */
export const iso = (p: W): Pt => [(p[0] - p[1]) * C, (p[0] + p[1]) * S - p[2]];

export interface Plan {
  x: number;
  y: number;
  w: number;
  d: number;
}
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

export class Sheet {
  out: string[] = [];
  xs: number[] = [];
  ys: number[] = [];
  constructor(readonly R: Rng) {}
  seen(pts: readonly Pt[]) {
    for (const p of pts) {
      this.xs.push(p[0]);
      this.ys.push(p[1]);
    }
    return pts;
  }
  raw(s: string) {
    this.out.push(s);
  }
  fill(poly: readonly Pt[], cls = "m-card") {
    this.seen(poly);
    this.out.push(`<path class="${cls}" d="${linePath(poly)}Z"/>`);
  }
  hatch(poly: readonly Pt[], cls: string, angle: number, pitch: number, inset = 0.8) {
    const d = hatchPath(poly, this.R, { angle, pitch, inset });
    if (d) this.out.push(`<path class="${cls}" d="${d}"/>`);
  }
  /** Each side its own stroke, with a small overshoot at the corners. */
  edges(poly: readonly Pt[], o: { width?: number; closed?: boolean; cls?: string; over?: number } = {}) {
    this.out.push(`<path class="${o.cls ?? "m-ink"}" d="${inkPoly(poly, this.R, o.width ?? 1.15, { closed: o.closed ?? true, bow: 0.42, tremor: 0.62, over: o.over ?? 0.7 })}"/>`);
  }
  /** One curve in one stroke of the pen. */
  curve(pts: readonly Pt[], o: { width?: number; cls?: string } = {}) {
    this.seen(pts);
    const line = handLine(pts, this.R, { bow: 0.12, tremor: 0.42, step: 2.5, smooth: 0.8 });
    this.out.push(`<path class="${o.cls ?? "m-ink"}" d="${ribbon(line, o.width ?? 1.05, this.R)}"/>`);
  }
  dot(p: Pt, r = 1, cls = "m-ink") {
    this.out.push(`<circle class="${cls}" cx="${n1(p[0])}" cy="${n1(p[1])}" r="${r}"/>`);
  }
  /** Words lying flat on the top of a part, along x, as if engraved on its plate. */
  onTop(at: W, words: string, size: number, o: { cls?: string; italic?: boolean; anchor?: "start" | "middle" } = {}) {
    const p = iso(at);
    this.out.push(`<text class="m-t ${o.italic ? "m-i" : ""} ${o.cls ?? ""}" text-anchor="${o.anchor ?? "middle"}" font-size="${size}" transform="matrix(${C} ${S} ${-C} ${S} ${n1(p[0])} ${n1(p[1])})">${esc(words)}</text>`);
  }
  /** Words on the face that looks down-left (y+), running along x. */
  onYFace(at: W, words: string, size: number, o: { cls?: string; anchor?: "start" | "middle" } = {}) {
    const p = iso(at);
    this.out.push(`<text class="m-t ${o.cls ?? ""}" text-anchor="${o.anchor ?? "middle"}" font-size="${size}" transform="matrix(${C} ${S} 0 1 ${n1(p[0])} ${n1(p[1])})">${esc(words)}</text>`);
  }
  /** Upright words on the paper beside a part: the same italic as the other drawings. */
  note(at: Pt, words: string, size = 13, o: { cls?: string; anchor?: "start" | "middle" | "end" } = {}) {
    const w = words.length * size * 0.5;
    const a = o.anchor ?? "start";
    this.seen([[at[0] - (a === "start" ? 0 : a === "middle" ? w / 2 : w), at[1] - size], [at[0] + (a === "start" ? w : a === "middle" ? w / 2 : 0), at[1] + 4]]);
    this.out.push(`<text class="m-t m-i ${o.cls ?? ""}" text-anchor="${a}" font-size="${size}" x="${n1(at[0])}" y="${n1(at[1])}">${esc(words)}</text>`);
  }
}
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const sheetOf = (seed: string) => new Sheet(rng(seed));

const ys = (p: Plan, z: number, h: number): Pt[] => [iso([p.x, p.y + p.d, z + h]), iso([p.x + p.w, p.y + p.d, z + h]), iso([p.x + p.w, p.y + p.d, z]), iso([p.x, p.y + p.d, z])];
const xs = (p: Plan, z: number, h: number): Pt[] => [iso([p.x + p.w, p.y + p.d, z + h]), iso([p.x + p.w, p.y, z + h]), iso([p.x + p.w, p.y, z]), iso([p.x + p.w, p.y + p.d, z])];
export const topOf = (p: Plan, z: number): Pt[] => [iso([p.x, p.y, z]), iso([p.x + p.w, p.y, z]), iso([p.x + p.w, p.y + p.d, z]), iso([p.x, p.y + p.d, z])];

/** The pencil shadow a part leaves on the paper, on the side away from the light: short ticks, like the tickets' shadow. */
export function floorShadow(s: Sheet, p: Plan, reach = 16) {
  const poly: Pt[] = [iso([p.x + p.w, p.y, 0]), iso([p.x + p.w + reach, p.y + reach * 0.3, 0]), iso([p.x + p.w + reach, p.y + p.d + reach, 0]), iso([p.x + reach * 0.3, p.y + p.d + reach, 0]), iso([p.x, p.y + p.d, 0]), iso([p.x + p.w, p.y + p.d, 0])];
  s.hatch(poly, "m-shadow", 58, 3.2, 0);
  s.seen(poly);
}

/** A solid block. `tone` picks the pencil on its sides: cream for the code's own parts, blue for what Atlas fakes. */
export function block(s: Sheet, p: Plan, z: number, h: number, o: { tone?: "cream" | "blue" | "bare" | "shade"; width?: number; topHatch?: boolean } = {}) {
  const tone = o.tone ?? "cream";
  const a = ys(p, z, h);
  const b = xs(p, z, h);
  const t = topOf(p, z + h);
  s.fill(a);
  s.fill(b);
  s.fill(t);
  if (tone === "shade") {
    s.hatch(a, "m-shade", 72, 6.5);
    s.hatch(b, "m-shade", 58, 3.6);
  } else if (tone !== "bare") {
    const pencil = tone === "blue" ? "m-pencil-blue" : "m-pencil-cream";
    s.hatch(a, pencil, 72, 5.4);
    s.hatch(b, pencil, 72, 3.1);
    s.hatch(b, "m-shade", 58, 5.2);
    if (o.topHatch) s.hatch(t, pencil, 28, 5);
  }
  const w = o.width ?? 1.2;
  s.edges(t, { width: w });
  s.edges([a[3]!, a[2]!, b[2]!], { closed: false, width: w });
  s.edges([a[0]!, a[3]!], { closed: false, width: w });
  s.edges([a[1]!, a[2]!], { closed: false, width: w });
  s.edges([b[1]!, b[2]!], { closed: false, width: w });
}

const circle = (c: W, r: number, u: W, v: W, n = 28, from = 0, span = TAU): W[] => {
  const out: W[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (i / n) * span;
    out.push([c[0] + r * (Math.cos(t) * u[0] + Math.sin(t) * v[0]), c[1] + r * (Math.cos(t) * u[1] + Math.sin(t) * v[1]), c[2] + r * (Math.cos(t) * u[2] + Math.sin(t) * v[2])]);
  }
  return out;
};
const X: W = [1, 0, 0];
const Y: W = [0, 1, 0];
const Z: W = [0, 0, 1];

/** A short upright round part: a dial's body, a boss, a foot. */
export function drum(s: Sheet, cx: number, cy: number, r: number, z: number, h: number, o: { tone?: "cream" | "bare" } = {}) {
  // The screen's left and right edges of a round thing are at world directions (1,-1) and (-1,1).
  const k = Math.SQRT1_2;
  const lo = circle([cx, cy, z], r, [k, -k, 0], [k, k, 0], 18, 0, Math.PI).map(iso);
  const up = circle([cx, cy, z + h], r, X, Y).map(iso);
  const side: Pt[] = [...lo, iso([cx - r * k, cy + r * k, z + h]), iso([cx + r * k, cy - r * k, z + h])];
  s.fill(side);
  s.fill(up);
  if (o.tone !== "bare") {
    s.hatch(side, "m-pencil-cream", 88, 2.6);
    s.hatch(side.slice(0, 9).concat([iso([cx, cy + r, z + h]), iso([cx + r * k, cy - r * k, z + h])]), "m-shade", 88, 3.4);
  }
  s.curve(up, { width: 1.05 });
  s.curve(lo, { width: 1.1 });
  s.edges([iso([cx + r * k, cy - r * k, z + h]), iso([cx + r * k, cy - r * k, z])], { closed: false, width: 1, over: 0.2 });
  s.edges([iso([cx - r * k, cy + r * k, z + h]), iso([cx - r * k, cy + r * k, z])], { closed: false, width: 1, over: 0.2 });
}

/** A round disc square to a direction: a pipe's flange, with its bolts. */
export function flange(s: Sheet, at: W, axis: "x" | "y" | "z", r: number, t = 3, bolts = 4) {
  const [u, v]: [W, W] = axis === "x" ? [Y, Z] : axis === "y" ? [X, Z] : [X, Y];
  const a: W = axis === "x" ? X : axis === "y" ? Y : Z;
  const near: W = [at[0] + a[0] * t, at[1] + a[1] * t, at[2] + a[2] * t];
  const back = circle(at, r, u, v, 20).map(iso);
  const front = circle(near, r, u, v, 20).map(iso);
  s.fill(back);
  s.curve(back, { width: 0.9 });
  // the rim between them
  s.fill(front);
  s.hatch(front, "m-pencil-cream", 40, 3.2, 0.4);
  s.curve(front, { width: 1 });
  for (let i = 0; i < bolts; i++) {
    const th = (i / bolts) * TAU + Math.PI / 4;
    s.dot(iso([near[0] + (r - 1.5) * (Math.cos(th) * u[0] + Math.sin(th) * v[0]), near[1] + (r - 1.5) * (Math.cos(th) * u[1] + Math.sin(th) * v[1]), near[2] + (r - 1.5) * (Math.cos(th) * u[2] + Math.sin(th) * v[2])]), 0.65);
  }
}

/** Rounds a route's corners, so a pipe bends rather than folds. */
function rounded(pts: readonly Pt[], r: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const la = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const lc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const q = Math.min(r, la / 2, lc / 2);
    const p0: Pt = [b[0] + ((a[0] - b[0]) / la) * q, b[1] + ((a[1] - b[1]) / la) * q];
    const p1: Pt = [b[0] + ((c[0] - b[0]) / lc) * q, b[1] + ((c[1] - b[1]) / lc) * q];
    for (let t = 0; t <= 8; t++) {
      const u = t / 8;
      out.push([(1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * b[0] + u * u * p1[0], (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * b[1] + u * u * p1[1]]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** A pipe along a route: a filled band, two pencil edges, and shading ticks along its underside. */
export function pipe(s: Sheet, route: readonly W[], r = 6.5, o: { cls?: string; bend?: number; dashed?: boolean } = {}) {
  const page = route.map(iso);
  const line = rounded(page, o.bend ?? r * 2.4);
  // resample evenly so the band and the ticks stay even round a bend
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  pts.push(line[line.length - 1]!);
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 2)]!;
    const b = pts[Math.min(pts.length - 1, i + 2)]!;
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / dl;
    const ny = (b[0] - a[0]) / dl;
    left.push([pts[i]![0] + nx * r, pts[i]![1] + ny * r]);
    right.push([pts[i]![0] - nx * r, pts[i]![1] - ny * r]);
  }
  s.fill([...left, ...[...right].reverse()]);
  // The side of the band nearer the bottom of the page is in shade.
  const lower = (i: number): [Pt, Pt] => (left[i]![1] >= right[i]![1] ? [left[i]!, right[i]!] : [right[i]!, left[i]!]);
  let d = "";
  for (let i = 1; i < pts.length; i += 1) {
    const [lo, hi] = lower(i);
    const j = s.R.range(0.34, 0.56);
    d += `M${n1(lo[0])} ${n1(lo[1])}L${n1(lo[0] + (hi[0] - lo[0]) * j)} ${n1(lo[1] + (hi[1] - lo[1]) * j)}`;
  }
  s.raw(`<path class="m-pencil-cream" d="${d}"/>`);
  s.curve(left, { width: 1.05, cls: o.cls ?? "m-ink" });
  s.curve(right, { width: 1.05, cls: o.cls ?? "m-ink" });
}

/** Screws at the corners of a plate on top. */
export function screws(s: Sheet, p: Plan, z: number, inset = 6) {
  for (const [x, y] of [[p.x + inset, p.y + inset], [p.x + p.w - inset, p.y + inset], [p.x + p.w - inset, p.y + p.d - inset], [p.x + inset, p.y + p.d - inset]] as const) {
    s.dot(iso([x, y, z]), 1.15, "m-ink");
    s.dot(iso([x, y, z]), 0.45, "m-paper");
  }
}

/** A round dial lying on top: body, face, ticks, needle. The needle stays at rest: it reads nothing until a run moves it. */
export function dial(s: Sheet, cx: number, cy: number, r: number, z: number) {
  drum(s, cx, cy, r, z, 6);
  drum(s, cx, cy, r - 2.2, z + 6, 1.4, { tone: "bare" });
  const top = z + 7.4;
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * TAU;
    const a = r - 3.6;
    const b = i % 3 === 0 ? r - 7.6 : r - 5.8;
    s.edges([iso([cx + Math.cos(t) * a, cy + Math.sin(t) * a, top]), iso([cx + Math.cos(t) * b, cy + Math.sin(t) * b, top])], { closed: false, width: 0.7, over: 0 });
  }
  s.edges([iso([cx, cy, top]), iso([cx - (r - 8), cy - (r - 8) * 0.25, top])], { closed: false, width: 1.1, over: 0 });
  s.dot(iso([cx, cy, top]), 1.4);
}

/** A hand wheel on a stem: round, spoked, set on a return pipe. */
export function wheel(s: Sheet, cx: number, cy: number, r: number, z: number) {
  const rim = circle([cx, cy, z], r, X, Y).map(iso);
  const inner = circle([cx, cy, z], r - 2.6, X, Y).map(iso);
  // stem and hub first; the spokes pass over them
  s.fill([...rim]);
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * TAU + Math.PI / 4;
    s.edges([iso([cx, cy, z]), iso([cx + Math.cos(t) * (r - 2), cy + Math.sin(t) * (r - 2), z])], { closed: false, width: 1.4, over: 0 });
  }
  s.curve(rim, { width: 1.25 });
  s.curve(inner, { width: 0.8 });
  let d = "";
  for (let i = 0; i < 26; i++) {
    const t = (i / 26) * TAU;
    const a = iso([cx + Math.cos(t) * (r - 0.5), cy + Math.sin(t) * (r - 0.5), z]);
    const b = iso([cx + Math.cos(t) * (r - 2.2), cy + Math.sin(t) * (r - 2.2), z]);
    d += `M${n1(a[0])} ${n1(a[1])}L${n1(b[0])} ${n1(b[1])}`;
  }
  s.raw(`<path class="m-knurl" d="${d}"/>`);
  drum(s, cx, cy, 3.4, z - 1, 3, { tone: "bare" });
}

/** The pen's ring, the same one as the Moonwell drawing's, round a place on the page. */
export function ringAround(s: Sheet, c: Pt, rx: number, ry: number, o: { dashed?: boolean } = {}) {
  const n = Math.max(30, Math.round(rx));
  const start = s.R() * TAU;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * 1.05 * TAU;
    const k = 1 + 0.018 * Math.sin(t * 2 + start);
    pts.push([c[0] + Math.cos(t) * rx * k, c[1] + Math.sin(t) * ry * k]);
  }
  s.seen(pts);
  const line = handLine(pts, s.R, { bow: 0.1, tremor: 0.5, step: 3, smooth: 1 });
  s.raw(`<path class="m-ring" d="${ribbon(line, 2.5, s.R)}"/>`);
  if (!o.dashed) return;
  const dash: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * TAU;
    dash.push([c[0] + Math.cos(t) * (rx + 11), c[1] + Math.sin(t) * (ry + 10)]);
  }
  s.seen(dash);
  s.raw(`<path class="m-ring-dash" d="${linePath(dash)}Z"/>`);
}

export const MACHINE_CSS = `
.m-card{fill:var(--rr-card)}
.m-paper{fill:var(--rr-paper)}
.m-ink{fill:var(--rr-ink)}
.m-red{fill:var(--rr-red-pen)}
.m-pencil-cream{fill:none;stroke:var(--rr-pencil-cream);stroke-width:1.1;stroke-linecap:round;opacity:.85}
.m-pencil-blue{fill:none;stroke:var(--rr-pencil-blue);stroke-width:1.15;stroke-linecap:round;opacity:.72}
.m-pencil-red{fill:none;stroke:var(--rr-red-pen);stroke-width:1.1;stroke-linecap:round;opacity:.7}
.m-shade{fill:none;stroke:var(--rr-tick);stroke-width:.55;stroke-linecap:round;opacity:.42}
.m-shadow{fill:none;stroke:var(--rr-tick);stroke-width:.6;stroke-linecap:round;opacity:.5}
.m-knurl{fill:none;stroke:var(--rr-ink);stroke-width:.55}
.m-ring{fill:var(--rr-red-pen)}
.m-ring-dash{fill:none;stroke:var(--rr-soft);stroke-width:1.1;stroke-dasharray:5 6;stroke-linecap:round}
.m-missing{fill:none;stroke:var(--rr-red);stroke-width:1.4;stroke-dasharray:6 5;stroke-linecap:round}
.m-t{fill:var(--rr-ink);font-family:"Atlas Besley",Georgia,serif;font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision}
.m-i{font-style:italic}
.m-soft{fill:var(--rr-soft)}
.m-redw{fill:var(--rr-red)}
.m-part{cursor:pointer;outline:none}
`;
