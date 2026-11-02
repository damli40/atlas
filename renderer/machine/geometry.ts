// D65: page geometry the machine's router and audit share. Pure.
import type { Pt } from "../hand";

export function hull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export interface Solid {
  poly: Pt[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export const solidOf = (points: readonly Pt[]): Solid => {
  const poly = hull(points);
  return { poly, x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), y1: Math.max(...poly.map((p) => p[1])) };
};

export function inside(s: Solid, p: Pt, margin = 0): boolean {
  if (p[0] < s.x0 - margin || p[0] > s.x1 + margin || p[1] < s.y0 - margin || p[1] > s.y1 + margin) return false;
  let hit = false;
  const q = s.poly;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i]![1] > p[1] !== q[j]![1] > p[1] && p[0] < ((q[j]![0] - q[i]![0]) * (p[1] - q[i]![1])) / (q[j]![1] - q[i]![1]) + q[i]![0]) hit = !hit;
  }
  if (hit || margin === 0) return hit;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) if (segDist(p, q[j]!, q[i]!) < margin) return true;
  return false;
}

export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const rectsOverlap = (a: Rect, b: Rect, m = 0) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;

/** A solid and a rectangle overlap: a corner of either inside the other, or an edge crossing. Sampled along the rectangle's edges. */
export function solidHitsRect(s: Solid, r: Rect, margin = 0): boolean {
  if (r.x1 < s.x0 - margin || r.x0 > s.x1 + margin || r.y1 < s.y0 - margin || r.y0 > s.y1 + margin) return false;
  const nx = Math.max(2, Math.ceil((r.x1 - r.x0) / 12));
  const ny = Math.max(2, Math.ceil((r.y1 - r.y0) / 8));
  for (let i = 0; i <= nx; i++) {
    const x = r.x0 + ((r.x1 - r.x0) * i) / nx;
    for (let j = 0; j <= ny; j++) if (inside(s, [x, r.y0 + ((r.y1 - r.y0) * j) / ny], margin)) return true;
  }
  return s.poly.some((p) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1);
}

/** Evenly spaced points along a page line. */
export function sample(line: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (line.length) out.push(line[line.length - 1]!);
  return out;
}

/** Whether two straight segments cross or touch. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const s1 = side(a, b, c);
  const s2 = side(a, b, d);
  const s3 = side(c, d, a);
  const s4 = side(c, d, b);
  return s1 * s2 < 0 && s3 * s4 < 0;
}
