// R3: the hand. Turns "the points a hand aimed at" into the line a hand actually draws, as SVG geometry.
//
// Ported from statechart-art's tools/kit/hand.js and util.js (MIT, Kevin T. Ngo; see renderer/export/kit/LICENSE and
// PRE-EXISTING.md): the damped-spring follower (the pen lags and rounds corners), the band-limited wander (a slow bow plus
// a small tremor), the seeded generator. The port draws SVG paths instead of depositing pixels: an ink line is a thin
// filled ribbon whose width breathes along its length, so it reads as a pen rather than a stroke-width.
// Same seed, same picture. Pure; no DOM, no clock.

export type Pt = [number, number];
export const TAU = Math.PI * 2;
/** The port keeps the kit's millimetres inside; the drawing is this many px per mm. */
const PX = 5;

function hashStr(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export type Rng = (() => number) & { range(a: number, b: number): number; gauss(m?: number, sd?: number): number };

/** mulberry32, seeded from text. Every part of the drawing forks its own, so changing one part never re-wobbles another. */
export function rng(seed: string): Rng {
  let a = hashStr(seed);
  const R = (() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  for (let i = 0; i < 8; i++) R();
  R.range = (lo, hi) => lo + R() * (hi - lo);
  R.gauss = (m = 0, sd = 1) => {
    let u = 0;
    let v = 0;
    while (!u) u = R();
    while (!v) v = R();
    return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  return R;
}

/** Band-limited wander: a few incommensurate sines. f(s) is roughly in [-1, 1]. */
export function wander(R: Rng, lamMin: number, lamMax: number, n = 3): (s: number) => number {
  const A: number[] = [];
  const L: number[] = [];
  const P: number[] = [];
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const lam = lamMin * Math.pow(lamMax / lamMin, (i + R() * 0.8) / n);
    const amp = Math.pow(lam / lamMax, 0.35) * (0.6 + 0.8 * R());
    A.push(amp);
    L.push(TAU / lam);
    P.push(R() * TAU);
    norm += amp * amp;
  }
  const k = 0.5 / Math.sqrt(norm / 2);
  return (s) => {
    let v = 0;
    for (let i = 0; i < n; i++) v += A[i]! * Math.sin(s * L[i]! + P[i]!);
    return v * k;
  };
}

/** Evenly spaced points along a polyline. */
export function resample(pts: readonly Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out: Pt[] = [[pts[0]![0], pts[0]![1]]];
  let need = step;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = need;
    while (t <= d) {
      const u = t / d;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      t += step;
    }
    need = t - d;
  }
  const l = pts[pts.length - 1]!;
  const e = out[out.length - 1]!;
  if (Math.hypot(l[0] - e[0], l[1] - e[1]) > step * 0.25) out.push([l[0], l[1]]);
  return out;
}

export function polyLen(p: readonly Pt[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
  return L;
}

/** Cuts `d0` from the start and `d1` from the end of a polyline. */
export function trim(p: readonly Pt[], d0: number, d1: number): Pt[] {
  const L = polyLen(p);
  if (L <= d0 + d1 + 1) {
    const k0 = L > 2 ? 0.35 : 0;
    return trim2(p, L * k0, L * k0);
  }
  return trim2(p, d0, d1);
}
function trim2(p: readonly Pt[], d0: number, d1: number): Pt[] {
  const L = polyLen(p);
  const at = (dist: number): [number, Pt] => {
    let acc = 0;
    for (let i = 1; i < p.length; i++) {
      const seg = Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]);
      if (acc + seg >= dist) {
        const u = (dist - acc) / (seg || 1);
        return [i, [p[i - 1]![0] + (p[i]![0] - p[i - 1]![0]) * u, p[i - 1]![1] + (p[i]![1] - p[i - 1]![1]) * u]];
      }
      acc += seg;
    }
    return [p.length - 1, p[p.length - 1]!];
  };
  const [i0, a] = at(d0);
  const [i1, b] = at(Math.max(d0, L - d1));
  return [a, ...p.slice(i0, i1), b];
}

/** The damped-spring follower (hand.js `follow`): the pen lags its target, so corners round and the end overshoots a hair. */
function follow(tgt: Pt[], L: number, ds: number, zeta: number): Pt[] {
  const m = tgt.length;
  if (m < 3 || L <= 0) return tgt;
  const w = Math.min(0.5, ds / L);
  const k = w * w;
  const c = 2 * zeta * w;
  const lag = Math.max(0, Math.round((2 * zeta) / w));
  let x = tgt[0]![0];
  let y = tgt[0]![1];
  let vx = tgt[1]![0] - x;
  let vy = tgt[1]![1] - y;
  const out: Pt[] = [[x, y]];
  const total = m - 1 + lag + Math.round(0.35 / w);
  for (let i = 1; i <= total; i++) {
    const tar = tgt[Math.min(m - 1, i + lag - 1)]!;
    vx += k * (tar[0] - x) - c * vx;
    vy += k * (tar[1] - y) - c * vy;
    x += vx;
    y += vy;
    out.push([x, y]);
  }
  return out;
}

export interface HandOpts {
  /** Multiplies the slow bow (1 = a free-hand line, near 0 = against a ruler). */
  bow?: number;
  /** Multiplies the small tremor. */
  tremor?: number;
  /** How much the pen lags, in px: bigger rounds corners more. */
  smooth?: number;
  /** Spacing of the result, in px. */
  step?: number;
}

/** The line a hand draws aiming at these points. In and out in px. */
export function handLine(pts: readonly Pt[], R: Rng, o: HandOpts = {}): Pt[] {
  const stepMm = (o.step ?? 4) / PX;
  const mm: Pt[] = pts.map((p) => [p[0] / PX, p[1] / PX]);
  let tgt = resample(mm, stepMm);
  if (tgt.length < 2) return pts.map((p) => [p[0], p[1]]);
  tgt = follow(tgt, (o.smooth ?? 3) / PX, stepMm, 0.72);
  const Lmm = polyLen(tgt);
  const trem = o.tremor ?? 1;
  const wBow = wander(R, Math.max(6, Lmm * 0.9), Math.max(20, Lmm * 3.5), 2);
  const wMid = wander(R, 2.5, 14, 3);
  const wHi = wander(R, 0.7, 2.6, 2);
  const bowAmp = Math.min(1.6, Lmm * 0.0052) * (o.bow ?? 1);
  const midAmp = 0.085 * trem;
  const hiAmp = 0.026 * trem;
  const out: Pt[] = [];
  let s = 0;
  for (let i = 0; i < tgt.length; i++) {
    if (i > 0) s += Math.hypot(tgt[i]![0] - tgt[i - 1]![0], tgt[i]![1] - tgt[i - 1]![1]);
    const a = tgt[Math.max(0, i - 1)]!;
    const b = tgt[Math.min(tgt.length - 1, i + 1)]!;
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // The ends stay where they were aimed: a line must still end on what it ends on.
    const pin = Math.min(1, Math.min(s, Lmm - s) / 1.2);
    const off = (bowAmp * wBow(s) + midAmp * wMid(s) + hiAmp * wHi(s)) * pin;
    out.push([(tgt[i]![0] - ((b[1] - a[1]) / dl) * off) * PX, (tgt[i]![1] + ((b[0] - a[0]) / dl) * off) * PX]);
  }
  return out;
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** A plain polyline as a path. */
export function linePath(pts: readonly Pt[]): string {
  if (pts.length === 0) return "";
  let d = `M${n1(pts[0]![0])} ${n1(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${n1(pts[i]![0])} ${n1(pts[i]![1])}`;
  return d;
}

/** A thin filled ribbon along the line: the pen's width breathes with pressure, with a small blob where the pen lands. */
export function ribbon(pts: readonly Pt[], width: number, R: Rng, o: { taper?: boolean } = {}): string {
  const n = pts.length;
  if (n < 2) return "";
  const wP = wander(R, 24, 120, 3);
  const wR = wander(R, 6, 26, 2);
  const left: string[] = [];
  const right: string[] = [];
  let s = 0;
  const total = polyLen(pts);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    if (i > 0) s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dl = Math.hypot(dx, dy) || 1;
    const land = 1 + 0.26 * Math.exp(-s / 3);
    const lift = o.taper ? 0.45 + 0.55 * Math.min(1, (total - s) / 10) : 1;
    const w = (width / 2) * land * lift * (1 + 0.22 * wP(s) + 0.1 * wR(s));
    const nx = (-dy / dl) * w;
    const ny = (dx / dl) * w;
    left.push(`${n1(pts[i]![0] + nx)} ${n1(pts[i]![1] + ny)}`);
    right.push(`${n1(pts[i]![0] - nx)} ${n1(pts[i]![1] - ny)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

/**
 * One closed shape's outline as a person inks it: each side its own stroke, with small overshoots at the corners (the
 * kit's `poly`). Returns a single path of ribbons.
 */
export function inkPoly(poly: readonly Pt[], R: Rng, width: number, o: { closed?: boolean; bow?: number; tremor?: number; over?: number } = {}): string {
  const closed = o.closed ?? true;
  const n = poly.length;
  const m = closed ? n : n - 1;
  let d = "";
  for (let i = 0; i < m; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const k = o.over ?? 1;
    const e0 = Math.max(-0.4, R.gauss(0.5, 0.7)) * k;
    const e1 = Math.max(-0.4, R.gauss(0.9, 0.9)) * k;
    const line = handLine([[a[0] - ux * e0, a[1] - uy * e0], [b[0] + ux * e1, b[1] + uy * e1]], R, { bow: o.bow ?? 0.5, tremor: o.tremor ?? 0.8, step: Math.min(6, Math.max(2, len / 8)), smooth: 1 });
    d += ribbon(line, width, R);
  }
  return d;
}

/** Scanline hatch across a polygon, at an angle: coloured pencil laid down in strokes, with a small sag and uneven spacing. */
export function hatchPath(poly: readonly Pt[], R: Rng, o: { angle: number; pitch: number; inset?: number }): string {
  const a = (o.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot: Pt[] = poly.map((p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c]);
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const p of rot) {
    if (p[1] < ymin) ymin = p[1];
    if (p[1] > ymax) ymax = p[1];
  }
  const un = (x: number, y: number) => `${n1(x * c - y * s)} ${n1(x * s + y * c)}`;
  let d = "";
  let y = ymin + R() * o.pitch * 0.6;
  let w = 0;
  const inset = o.inset ?? 0;
  while (y < ymax) {
    const xs: number[] = [];
    for (let i = 0; i < rot.length; i++) {
      const p = rot[i]!;
      const q = rot[(i + 1) % rot.length]!;
      if (p[1] <= y !== q[1] <= y) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = xs[i]! + inset + R.range(-1.2, 2);
      const x1 = xs[i + 1]! - inset + R.range(-2, 1.2);
      if (x1 - x0 < 2) continue;
      const sag = R.gauss(0, 0.012) * (x1 - x0);
      const tilt = R.gauss(0, 0.008) * (x1 - x0);
      d += `M${un(x0, y)}Q${un((x0 + x1) / 2, y - sag)} ${un(x1, y + tilt)}`;
    }
    w = Math.max(-0.4, Math.min(0.4, 0.8 * w + R.gauss(0, 0.13)));
    y += o.pitch * (1 + w);
  }
  return d;
}
