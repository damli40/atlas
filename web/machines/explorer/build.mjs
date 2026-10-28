// X2 prototype: the code explorer machine, built with the Anatomy kit (web/machines/iso/, MIT).
//
// The object: an instrument skid. A base plate on feet carries one tray per source file; on the trays stand
// instrument boxes, one per part plain code confirmed, each as wide as the lines it covers. A box that covers
// two files stands across the joint of their two trays. Where plain code found that one part imports or calls
// another, a bent steel line runs from a fitting on one box's lid to a fitting on the other's. A line plain
// code found on its own (Wonder never named it) wears two tag collars. A join only Wonder states is not a line:
// it is a chalk tag in the list under the card.
//
// The ONLY input is the outline record (tests/fixtures/outline/*.json) through model.ts. Nothing is drawn that
// the model does not return.
//
// Run (tsx, because model.ts is TypeScript):
//   pnpm tsx web/machines/explorer/build.mjs            writes explorer.html (dark) and explorer-light.html
//   pnpm tsx web/machines/explorer/build.mjs --audit    also proves the geometry (Anatomy kit/audit.mjs)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../iso/iso-kit.mjs";
import * as G from "../iso/lathe.mjs";
import { tubePieces, tubeSvg } from "../iso/tube.mjs";
import * as A from "../iso/audit.mjs";
import { explorerModel, authorOf, CHALK_WORDS } from "./model.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = resolve(HERE, "../../../tests/fixtures/outline/atlas-server-meta.r2.json");

// ---- sizes (world units, about 1 px) ----
const W = 640;
const H = 400;
const AZIMUTH = 57;
const ELEVATION = 33;
const BOX_D = 22;
const BOX_H = 12;
const TRAY_H = 2.4;
const TRAY_PAD = 3;
const GAP_IN = 4;
const GAP_OUT = 10;
const ROW_PITCH = 44;
const EMPTY_W = 12;
const widthOf = (lines) => 10 + lines * 0.065;
const BASE_H = 8;
const FOOT_H = 5;
const TOP = TRAY_H + BOX_H;
const FIT = { base: 1.0, body: 2.2 }; // fitting: hex base height, body height
const R_OF = { calls: 1.0, imports: 0.72, data: 0.86 };
const NUT = 1.4;
const TIER0 = TOP + FIT.base + FIT.body + 11;
const TIER_STEP = 3.6;

const f2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Split slots into rows only between files, minimising the widest row. */
function rowsOf(segs, nRows) {
  const n = segs.length;
  const widthOfRange = (a, b) => {
    let w = 0;
    for (let i = a; i < b; i++) w += segs[i].w + (i > a ? segs[i].gapBefore : 0);
    return w;
  };
  const canBreak = (i) => i > 0 && i < n && segs[i].gapBefore === GAP_OUT;
  let best = null;
  const walk = (start, left, acc) => {
    if (left === 1) {
      const rows = [...acc, [start, n]];
      const worst = Math.max(...rows.map(([a, b]) => widthOfRange(a, b)));
      if (!best || worst < best.worst) best = { worst, rows };
      return;
    }
    for (let i = start + 1; i < n; i++) if (canBreak(i)) walk(i, left - 1, [...acc, [start, i]]);
  };
  walk(0, Math.min(nRows, n), []);
  return best ? best.rows : [[0, n]];
}

export function buildExplorer(record, { theme = "dark" } = {}) {
  const M = explorerModel(record);
  if (M.notShown !== null) return { M, html: notShownPage(M, theme), R: null, P: null, stats: { solids: 0, items: 0, lines: 0 } };
  const boxOf = new Map(M.boxes.map((b) => [b.id, b]));

  // ---- layout: slots left to right, broken into rows between files ----
  const segs = M.slots.map((slot, i) => {
    const prev = M.slots[i - 1];
    const lastPath = (s) => (s.kind === "box" ? s.slices[s.slices.length - 1].path : s.path);
    const firstPath = (s) => (s.kind === "box" ? s.slices[0].path : s.path);
    const gapBefore = prev ? (lastPath(prev) === firstPath(slot) ? GAP_IN : GAP_OUT) : 0;
    const w = slot.kind === "box" ? widthOf(boxOf.get(slot.id).lines) : EMPTY_W;
    return { slot, w, gapBefore };
  });
  const total = segs.reduce((a, s) => a + s.w + s.gapBefore, 0);
  const nRows = Math.max(1, Math.min(4, Math.round(total / 125)));
  const rows = rowsOf(segs, nRows);
  const place = new Map(); // box id -> { plan, slices: [{ path, x0, x1 }] }
  const trays = []; // { path, plan, row }
  let minX = Infinity;
  let maxX = -Infinity;
  rows.forEach(([a, b], r) => {
    const rowW = segs.slice(a, b).reduce((acc, s, i) => acc + s.w + (i ? s.gapBefore : 0), 0);
    const y = (r - (rows.length - 1) / 2) * ROW_PITCH;
    let x = -rowW / 2;
    const runs = []; // contiguous slices of one file: { path, x0, x1 }
    for (let i = a; i < b; i++) {
      const s = segs[i];
      if (i > a) x += s.gapBefore;
      if (s.slot.kind === "box") {
        const box = boxOf.get(s.slot.id);
        const slices = [];
        let sx = x;
        for (const sl of s.slot.slices) {
          const sw = (s.w * sl.lines) / box.lines;
          slices.push({ path: sl.path, x0: sx, x1: sx + sw });
          sx += sw;
        }
        place.set(box.id, { plan: { x, y: y - BOX_D / 2, w: s.w, d: BOX_D, r: 1.6 }, slices, row: r });
        for (const sl of slices) {
          const last = runs[runs.length - 1];
          if (last && last.path === sl.path) last.x1 = sl.x1;
          else runs.push({ ...sl, joinedLeft: Boolean(last && Math.abs(last.x1 - sl.x0) < 1e-6) });
        }
      } else {
        runs.push({ path: s.slot.path, x0: x, x1: x + s.w, empty: true });
      }
      x += s.w;
    }
    runs.forEach((run, i) => {
      const next = runs[i + 1];
      const joinedRight = Boolean(next && next.joinedLeft);
      const x0 = run.joinedLeft ? run.x0 : run.x0 - TRAY_PAD;
      const x1 = joinedRight ? run.x1 : run.x1 + TRAY_PAD;
      trays.push({ path: run.path, empty: Boolean(run.empty), row: r, plan: { x: x0, y: y - BOX_D / 2 - TRAY_PAD, w: x1 - x0, d: BOX_D + 2 * TRAY_PAD, r: 1.2 }, joinedLeft: run.joinedLeft, joinedRight });
      minX = Math.min(minX, x0);
      maxX = Math.max(maxX, x1);
    });
  });
  const yBack = (-(rows.length - 1) / 2) * ROW_PITCH - BOX_D / 2 - TRAY_PAD;
  const yFront = ((rows.length - 1) / 2) * ROW_PITCH + BOX_D / 2 + TRAY_PAD;
  const BASE = { x: minX - 12, y: yBack - 10, w: maxX - minX + 24, d: yFront - yBack + 26, r: 8 };

  // ---- jacks: one fitting on a box lid per line end, on the side that faces the other box ----
  const INSET = 3.6;
  const lidRect = (plan) => ({ x0: plan.x + INSET, y0: plan.y + INSET, x1: plan.x + plan.w - INSET, y1: plan.y + plan.d - INSET });
  const perim = (q) => 2 * (q.x1 - q.x0 + (q.y1 - q.y0));
  const atT = (q, t) => {
    const L = perim(q);
    let u = ((t % L) + L) % L;
    const wq = q.x1 - q.x0;
    const dq = q.y1 - q.y0;
    if (u < wq) return [q.x0 + u, q.y0];
    u -= wq;
    if (u < dq) return [q.x1, q.y0 + u];
    u -= dq;
    if (u < wq) return [q.x1 - u, q.y1];
    u -= wq;
    return [q.x0, q.y1 - u];
  };
  const tOfRay = (q, theta) => {
    const cx = (q.x0 + q.x1) / 2;
    const cy = (q.y0 + q.y1) / 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const hw = (q.x1 - q.x0) / 2;
    const hd = (q.y1 - q.y0) / 2;
    const s = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hd / Math.abs(dy) : Infinity);
    const px = cx + dx * s;
    const py = cy + dy * s;
    const wq = q.x1 - q.x0;
    const dq = q.y1 - q.y0;
    if (Math.abs(py - q.y0) < 1e-6) return px - q.x0;
    if (Math.abs(px - q.x1) < 1e-6) return wq + (py - q.y0);
    if (Math.abs(py - q.y1) < 1e-6) return wq + dq + (q.x1 - px);
    return 2 * wq + dq + (q.y1 - py);
  };
  const centreOf = (plan) => [plan.x + plan.w / 2, plan.y + plan.d / 2];
  const jacks = new Map(); // `${lineId}:${boxId}` -> [x, y]
  const SPACE = 5.2;
  for (const box of M.boxes) {
    const { plan } = place.get(box.id);
    const q = lidRect(plan);
    const L = perim(q);
    const [cx, cy] = centreOf(plan);
    const ends = M.lines
      .filter((l) => l.from === box.id || l.to === box.id)
      .map((l) => {
        const other = place.get(l.from === box.id ? l.to : l.from).plan;
        const [ox, oy] = centreOf(other);
        return { key: `${l.id}:${box.id}`, t: tOfRay(q, Math.atan2(oy - cy, ox - cx)) };
      })
      .sort((a, b) => a.t - b.t);
    // relax so neighbours along the lid's edge stay SPACE apart (circular)
    for (let pass = 0; pass < 200; pass++) {
      let moved = false;
      for (let i = 0; i < ends.length; i++) {
        const a = ends[i];
        const b = ends[(i + 1) % ends.length];
        if (ends.length < 2) break;
        let gap = b.t - a.t;
        if (i === ends.length - 1) gap += L;
        if (gap < SPACE) {
          const push = (SPACE - gap) / 2 + 0.01;
          a.t -= push;
          b.t += push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const e of ends) jacks.set(e.key, atT(q, e.t));
  }

  // uncross: two lines at one box whose plan paths cross swap their fittings on that box
  const LL = () => M.lines.map((l) => ({ l, a: jacks.get(`${l.id}:${l.from}`), b: jacks.get(`${l.id}:${l.to}`) }));
  const segsCross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let pass = 0; pass < 30; pass++) {
    let swapped = false;
    for (const box of M.boxes) {
      const mine = LL().filter((x) => x.l.from === box.id || x.l.to === box.id);
      for (let i = 0; i < mine.length; i++)
        for (let j = i + 1; j < mine.length; j++) {
          const x = mine[i];
          const y = mine[j];
          if (!segsCross(x.a, x.b, y.a, y.b)) continue;
          const kx = `${x.l.id}:${box.id}`;
          const ky = `${y.l.id}:${box.id}`;
          const px = jacks.get(kx);
          jacks.set(kx, jacks.get(ky));
          jacks.set(ky, px);
          const after = LL();
          const nx = after.find((z) => z.l.id === x.l.id);
          const ny = after.find((z) => z.l.id === y.l.id);
          if (segsCross(nx.a, nx.b, ny.a, ny.b)) {
            jacks.set(ky, jacks.get(kx));
            jacks.set(kx, px);
          } else swapped = true;
        }
    }
    if (!swapped) break;
  }

  // ---- tiers: a line passing over another line's fitting runs above that line's top ----
  const segDist = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
    return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]);
  };
  const cross2 = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  const segSeg = (a, b, c, d) => (cross2(a, b, c, d) ? 0 : Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b)));
  const L = M.lines.map((l) => ({ ...l, r: R_OF[l.kind] ?? 0.86, a: jacks.get(`${l.id}:${l.from}`), b: jacks.get(`${l.id}:${l.to}`) }));
  // An arch whose plane is seen nearly edge-on would pinch to a V on screen: it takes a side jog instead
  // (rise, step sideways, cross, step back, drop), so every bend faces the viewer.
  const TV = [Math.cos((AZIMUTH * Math.PI) / 180), Math.sin((AZIMUTH * Math.PI) / 180)];
  const allEnds = L.flatMap((l) => [l.a, l.b]);
  const JOG = 14;
  for (const l of L) {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) || 1;
    const d = [(l.b[0] - l.a[0]) / len, (l.b[1] - l.a[1]) / len];
    const n = [-d[1], d[0]];
    const facing = Math.cos((ELEVATION * Math.PI) / 180) * Math.abs(n[0] * TV[0] + n[1] * TV[1]);
    l.facing = facing;
    if (facing >= 0.34) {
      l.plan = [l.a, l.b];
      continue;
    }
    const options = [1, -1].map((sg) => {
      const plan = [l.a, [l.a[0] + n[0] * JOG * sg, l.a[1] + n[1] * JOG * sg], [l.b[0] + n[0] * JOG * sg, l.b[1] + n[1] * JOG * sg], l.b];
      const near = allEnds.filter((e) => e !== l.a && e !== l.b && polyDist(e, plan) < 5).length;
      return { plan, near };
    });
    options.sort((x, y) => x.near - y.near);
    l.plan = options[0].plan;
  }
  function polyDist(e, plan) {
    let m = Infinity;
    for (let q = 1; q < plan.length; q++) m = Math.min(m, segDist(e, plan[q - 1], plan[q]));
    return m;
  }
  const polyPoly = (p1, p2) => {
    let m = Infinity;
    for (let x = 1; x < p1.length; x++) for (let y = 1; y < p2.length; y++) m = Math.min(m, segSeg(p1[x - 1], p1[x], p2[y - 1], p2[y]));
    return m;
  };
  const NEAR = 4.4;
  const above = L.map(() => new Set()); // above[i] has j: line i must run higher than line j
  L.forEach((li, i) =>
    L.forEach((lj, j) => {
      if (i === j) return;
      for (const e of [lj.a, lj.b]) if (polyDist(e, li.plan) < li.r + lj.r + 1.4 && Math.hypot(e[0] - li.a[0], e[1] - li.a[1]) > 0.1 && Math.hypot(e[0] - li.b[0], e[1] - li.b[1]) > 0.1) above[i].add(j);
    }),
  );
  const level = L.map(() => null);
  const lenOf = (l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
  const order = [];
  {
    const indeg = L.map((_, i) => above[i].size);
    const ready = L.map((_, i) => i).filter((i) => indeg[i] === 0);
    const below = L.map(() => []);
    L.forEach((_, i) => above[i].forEach((j) => below[j].push(i)));
    while (ready.length) {
      ready.sort((x, y) => lenOf(L[x]) - lenOf(L[y]));
      const i = ready.shift();
      order.push(i);
      for (const up of below[i]) if (--indeg[up] === 0) ready.push(up);
    }
    if (process.env.EX_DEBUG) L.forEach((l, i) => { if (!order.includes(i)) console.log(l.id, l.from, '->', l.to, 'above', [...above[i]].map((j) => L[j].id + '@' + [L[j].a, L[j].b].map((e) => segDist(e, l.a, l.b).toFixed(1)).join('/')).join(' ')); });
    if (order.length !== L.length) throw new Error(`tier cycle among lines: ${L.filter((_, i) => !order.includes(i)).map((l) => l.id).join(", ")}`);
  }
  for (const i of order) {
    let lv = Math.max(0, ...[...above[i]].map((j) => level[j] + 1));
    const clash = (v) => order.some((j) => level[j] === v && j !== i && polyPoly(L[i].plan, L[j].plan) < NEAR);
    while (clash(lv)) lv++;
    level[i] = lv;
  }
  const maxLevel = Math.max(0, ...level);

  // ---- camera ----
  const tops = L.flatMap((l, i) => [l.a, l.b].map((e) => [e[0], e[1], TIER0 + level[i] * TIER_STEP + l.r + 1]));
  const P = k.fitProjection([...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), ...tops], W, H, { pad: 22, azimuth: AZIMUTH, elevation: ELEVATION });
  const V = G.viewOf(P);
  const KS = G.scaleOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const Dots = (points, style) => k.dotsSvg(points, style);
  const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

  const R = A.recorder(P);
  const put = (name, ref, svg, shapes = [], { bias = 0, attrs = "" } = {}) => R.put({ name, at: ref, bias, svg, shapes, piece: "skid", attrs });

  // ---- base plate on feet (static, ground) ----
  const back = [];
  back.push(`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
  const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of byDepth(k.corners(BASE, 16))) {
    back.push(S(k.cylinder(x, y, 7, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    back.push(S(k.cylinder(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  back.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(BASE, -3, P, 8), { tone: "faint" }) }));
  back.push(Ln(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }));
  const baseScrews = k.corners(BASE, 9);
  back.push(Ln(baseScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  back.push(Dots(baseScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  R.solid(A.slab(BASE, -BASE_H, BASE_H, { name: "stand.plate", ground: true }, 8));
  // ruler strip along the front edge, at the boxes' scale: a minor tick every 50 lines, a major every 250
  const STRIP = { x: BASE.x + 16, y: BASE.y + BASE.d - 12, w: BASE.w - 60, d: 6, r: 1 };
  back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  {
    const perTick = 0.065 * 50; // 50 lines of code at the boxes' scale (widthOf)
    const t = k.topTicks(STRIP.x + 3, STRIP.x + STRIP.w - 3, perTick, 5, STRIP.y, 0.6, [1.8, 3.4], P);
    back.push(Ln(t.minor, { tone: "lo" }), Ln(t.major, { tone: "mid" }));
  }
  const LABEL = { x: BASE.x + BASE.w - 38, y: BASE.y + BASE.d - 17, w: 28, d: 12, r: 1.2 };
  back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
  back.push(Ln([18, 12, 15].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.2 + i * 2.8], [LABEL.x + 4 + w, LABEL.y + 3.2 + i * 2.8], 0.8, P)).join(""), { tone: "lo", free: true }));
  back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));

  // ---- trays: one per file (a file split across rows or boxes may have more than one) ----
  for (const tray of trays) {
    const p = tray.plan;
    const shape = R.solid(A.slab(p, 0, TRAY_H, { name: `tray.${tray.path}` }, 3));
    const screws = [];
    if (!tray.joinedLeft) screws.push([p.x + 1.6, p.y + 1.6], [p.x + 1.6, p.y + p.d - 1.6]);
    if (!tray.joinedRight) screws.push([p.x + p.w - 1.6, p.y + 1.6], [p.x + p.w - 1.6, p.y + p.d - 1.6]);
    const extra = Dots(screws.map(([x, y]) => at([x, y, TRAY_H])), { size: 0.45, tone: "mid" });
    // a file tag on the tray's front edge: two rule lines stand for the file's path
    const fy = p.y + p.d;
    const tw = Math.min(10, p.w - 6);
    const tx = p.x + 3;
    const tag = path3([[tx, fy, 0.5], [tx + tw, fy, 0.5], [tx + tw, fy, 1.9], [tx, fy, 1.9]], true);
    const tagRule = path3([[tx + 1, fy, 1.2], [tx + tw * 0.75, fy, 1.2]]);
    const tagSvg = `<path class="iso-fill ex-plate" d="${tag}"/>` + Ln(tag, { tone: "lo" }) + Ln(tagRule, { tone: "lo", free: true });
    const groove = tray.empty ? Ln(k.planOutline(k.insetPlan(p, 2.6), TRAY_H, P, 3), { tone: "faint" }) : "";
    put(`tray.${tray.path}`, [p.x + p.w / 2, p.y + p.d / 2, TRAY_H / 2], S(k.slabOf(p, 0, TRAY_H, P, 3, 0.4), { tone: tray.empty ? "lo" : "mid", inner: Ln(k.sideSeam(p, TRAY_H / 2, P, 3), { tone: "faint" }) }) + groove + extra + tagSvg, [shape], { attrs: ` data-file="${esc(tray.path)}"` });
  }

  // ---- boxes ----
  for (const box of M.boxes) {
    const { plan, slices } = place.get(box.id);
    const z0 = TRAY_H;
    const shape = R.solid(A.slab(plan, z0, BOX_H, { name: `box.${box.id}` }, 4));
    const lid = k.insetPlan(plan, 1.6);
    const screws = k.corners(plan, 2.2);
    const front = plan.y + plan.d;
    // one range plate per span on the front face, under its slice: two rule lines stand for "file:lines"
    const plates = slices
      .map((sl) => {
        const w = Math.min(sl.x1 - sl.x0 - 3, 16);
        const cx = (sl.x0 + sl.x1) / 2;
        const x0 = cx - w / 2;
        const zt = z0 + 8.6;
        const zb = z0 + 3.4;
        const face = front + 0.5;
        const plate = path3([[x0, face, zb], [x0 + w, face, zb], [x0 + w, face, zt], [x0, face, zt]], true);
        const rules = [0.62, 0.36].map((f, i) => path3([[x0 + 1.4, face, zb + (zt - zb) * f], [x0 + 1.4 + (w - 2.8) * (i ? 0.6 : 0.9), face, zb + (zt - zb) * f]])).join("");
        return `<path class="iso-fill ex-plate" d="${plate}"/>` + Ln(plate, { tone: "lo" }) + Ln(rules, { tone: "lo", free: true });
      })
      .join("");
    // the seam where a box's two files meet (it stands across two trays)
    const seams = slices
      .slice(1)
      .map((sl) => path3([[sl.x0, front, z0], [sl.x0, front, z0 + BOX_H]]))
      .join("");
    const lamp = at([plan.x + 3.2, plan.y + plan.d - 3.2, z0 + BOX_H]);
    const svg =
      S(k.slabOf(plan, z0, BOX_H, P, 4, 0.6), { tone: "hi", inner: Ln(k.sideSeam(plan, z0 + 1.6, P, 4), { tone: "faint" }) + (seams ? Ln(seams, { tone: "faint" }) : "") }) +
      Ln(k.planOutline(lid, z0 + BOX_H, P, 4), { tone: "faint" }) +
      Dots(screws.map(([x, y]) => at([x, y, z0 + BOX_H])), { size: 0.45, tone: "mid" }) +
      plates +
      `<g class="ex-lamp">${Dots([lamp], { size: 0.8, tone: "hi" })}</g>`;
    // vents: closed slots on the right face, near the back
    const xr = plan.x + plan.w;
    const vents = [0, 1, 2]
      .map((v) => {
        const y0 = plan.y + 3 + v * 2.4;
        return path3([[xr, y0, z0 + 3], [xr, y0 + 1.1, z0 + 3], [xr, y0 + 1.1, z0 + 9], [xr, y0, z0 + 9]], true);
      })
      .join("");
    put(`box.${box.id}`, [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + BOX_H / 2], svg + Ln(vents, { tone: "lo" }), [shape], { attrs: ` data-of="${esc(box.id)}"` });
    // carrying handle on the right face: two feet and a bar
    {
      const yc = plan.y + plan.d / 2 + 3;
      const parts = [
        { name: "handle.foot", plan: { x: xr, y: yc - 5.5, w: 1.6, d: 1.6, r: 0.4 }, z: z0 + 5, h: 2.4 },
        { name: "handle.foot", plan: { x: xr, y: yc + 3.9, w: 1.6, d: 1.6, r: 0.4 }, z: z0 + 5, h: 2.4 },
        { name: "handle.bar", plan: { x: xr + 1.6, y: yc - 5.5, w: 1.2, d: 11, r: 0.5 }, z: z0 + 5, h: 2.4 },
      ];
      const shapes = parts.map((q) => R.solid(A.slab(q.plan, q.z, q.h, { name: `box.${box.id}.${q.name}` }, 2)));
      const hsvg = parts.map((q) => S(k.slabOf(q.plan, q.z, q.h, P, 2), { tone: "mid" })).join("");
      put(`box.${box.id}.handle`, [xr + 1.4, yc, z0 + 6.2], hsvg, shapes, { attrs: ` data-of="${esc(box.id)}"` });
    }
  }

  // ---- fittings and steel lines ----
  const LINES = [];
  L.forEach((l, i) => {
    const r = l.r;
    const bodyR = r * 1.75;
    const baseR = r * 2.3;
    const nutR = bodyR;
    const h = TIER0 + level[i] * TIER_STEP;
    const zFit = TOP + FIT.base + FIT.body;
    for (const [end, boxId] of [[l.a, l.from], [l.b, l.to]]) {
      const F = G.frameAlong([end[0], end[1], TOP], [0, 0, 1]);
      const shapes = [R.solid(A.disc(F, 0, FIT.base, baseR, { name: `fit.${l.id}.base` })), R.solid(A.disc(F, FIT.base, FIT.base + FIT.body, bodyR, { name: `fit.${l.id}.body` }))];
      const svg = S(G.disc(0, FIT.base, baseR, F, P, { steps: 6 }), { tone: "mid" }) + S(G.disc(FIT.base, FIT.base + FIT.body, bodyR, F, P, { steps: 24 }), { tone: "mid" });
      put(`fit.${l.id}.${boxId}`, [end[0], end[1], TOP + 1.5], svg, shapes, { attrs: ` data-of="${esc(boxId)}" data-line="${esc(l.id)}"` });
    }
    const pts = [[l.a[0], l.a[1], zFit], ...l.plan.map(([x, y]) => [x, y, h]), [l.b[0], l.b[1], zFit]];
    const route = G.fillet(pts, l.plan.length > 2 ? 6.5 : Math.max(4.5, r * 4), 12, { P, tube: r });
    const total = G.pathLength(route);
    const collars = [];
    collars.push({ s0: 0, s1: NUT, r: nutR, kind: "nut" }, { s0: total - NUT, s1: total, r: nutR, kind: "nut" });
    if (l.status === "code-only") for (const s of [total / 2 - 7, total / 2 + 7]) collars.push({ s0: s - 0.9, s1: s + 0.9, r: r * 2.1, kind: "tag" });
    const gaps = collars.map((c) => [c.s0, c.s1]);
    R.route(`line.${l.id}`, route, r, { gaps, rims: [nutR, nutR], piece: "skid" });
    LINES.push(l.id);
    const attrs = ` data-line="${esc(l.id)}" data-ends="${esc(l.from)} ${esc(l.to)}"`;
    const tone = l.status === "code-only" ? "mid" : "hi";
    tubePieces(route, r, P, { maxLength: 14, spacing: Math.max(0.6, Math.min(1.6, r)), gaps }).forEach((piece, index) =>
      put(`line.${l.id}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)], { bias: 0.05, attrs }),
    );
    for (const c of collars) {
      const sm = (c.s0 + c.s1) / 2;
      const tangent = G.tangentAlong(route, sm);
      const centre = pointAlong(route, sm);
      const F = G.frameAlong(centre, tangent);
      const half = (c.s1 - c.s0) / 2;
      const shape = R.solid(A.disc(F, -half, half, c.r, { name: `line.${l.id}.${c.kind}`, owner: `line.${l.id}` }));
      const svg = S(G.disc(-half, half, c.r, F, P, { steps: c.kind === "nut" ? 6 : 24, bevel: 0.15 }), { tone: c.kind === "tag" ? "hi" : "mid" });
      put(`line.${l.id}.${c.kind}`, centre, c.kind === "tag" ? `<g class="ex-tag">${svg}</g>` : svg, [shape], { bias: 0.1, attrs });
    }
  });

  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const groups = R.items.map((item) => `<g class="it" data-name="${esc(item.name)}"${item.attrs ?? ""}>${item.svg}</g>`);

  // hit targets over everything: each box's silhouette (and its lid fittings)
  // painted back to front, so where two silhouettes overlap on screen the nearer box takes the pointer
  const hits = [...M.boxes]
    .sort((a, b) => {
      const ca = place.get(a.id).plan;
      const cb = place.get(b.id).plan;
      return k.depthOf([ca.x + ca.w / 2, ca.y + ca.d / 2, 0], P) - k.depthOf([cb.x + cb.w / 2, cb.y + cb.d / 2, 0], P);
    })
    .map((box) => {
      const { plan } = place.get(box.id);
      const paths = k.slabOf(plan, TRAY_H, BOX_H + FIT.base + FIT.body, P, 4);
      return `<path class="ex-hit" data-hit="${esc(box.id)}" d="${paths.fill}" tabindex="-1" role="button" aria-label="${esc(`${box.name.text} (part name by ${authorOf(box.name.by)})`)}"/>`;
    })
    .join("");

  const label = `An instrument skid on a base plate: ${trays.length} file trays and ${M.boxes.length} instrument boxes, one per part plain code confirmed, each as wide as the lines it covers. ${M.lines.length} bent steel lines join box lids where plain code found an import or call between two parts; ${M.lines.filter((l) => l.status === "code-only").length} of them carry two tag collars because plain code found them and Wonder did not name them.`;
  const svg = k.figureSvg({ width: W, height: H, label, body: [...back, `<g class="ex-skid">${groups.join("")}</g>`, `<g class="ex-hits">${hits}</g>`] });

  const html = page(M, svg, theme);
  return { M, html, R, P, stats: { solids: R.solids.length, items: R.items.length, lines: LINES.length, trays: trays.length, levels: maxLevel + 1, scale: KS } };
}

function pointAlong(route, s) {
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const seg = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1], route[i][2] - route[i - 1][2]);
    if (acc + seg >= s) {
      const t = seg ? (s - acc) / seg : 0;
      return [0, 1, 2].map((c) => route[i - 1][c] + (route[i][c] - route[i - 1][c]) * t);
    }
    acc += seg;
  }
  return [...route[route.length - 1]];
}

// ---- page ----
function cardData(M) {
  return {
    model: M.model,
    chalkWords: CHALK_WORDS,
    boxes: M.boxes.map((b) => ({ id: b.id, name: b.name.text, by: authorOf(b.name.by), purpose: b.purpose.text, spans: b.spans, lines: b.lines, joins: b.joins })),
    names: Object.fromEntries(M.boxes.map((b) => [b.id, b.name.text])),
  };
}

function page(M, svg, theme) {
  const css = readFileSync(join(HERE, "explorer.css"), "utf8");
  const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(cardData(M)).replace(/</g, "\\u003c"));
  const names = new Map(M.boxes.map((b) => [b.id, b.name.text]));
  const nameOf = (id) => names.get(id) ?? id;
  const codeOnly = M.lines.filter((l) => l.status === "code-only").length;
  const confirmed = M.lines.length - codeOnly;
  const chalk = M.chalk
    .map((c) => `<li class="ex-chalk" data-chalk="${esc(c.id)}"><span class="ex-chalk-tag">${esc(nameOf(c.from))} → ${esc(nameOf(c.to))} · ${esc(c.kind)}</span> <span class="ex-chalk-words">${esc(c.words)}.</span></li>`)
    .join("");
  const unconf = M.unconfirmed.map((u) => `<li>${esc(u.name.text)} <span class="ex-by">(name by ${esc(authorOf(u.name.by))})</span>: ${esc(u.reasons.join("; "))}</li>`).join("");
  const plate = k.plateHtml({
    fig: "Fig X2",
    title: "server/meta, opened up",
    hint: "hover a box · Tab, then ← → · Esc",
    readout: `${M.boxes.length} parts · ${M.lines.length} lines`,
    keys: [
      { mark: "raised", label: "A box: a part plain code confirmed (its lines exist). Wider box = more lines" },
      { mark: "edge", label: `A steel line: plain code found an import or call between two parts (${confirmed} confirmed, Wonder named them too)` },
      { mark: "dotted", label: `Two tag collars on a line: found by plain code only, Wonder did not name it (${codeOnly})` },
      { mark: "lit", label: "The box you picked and its lines" },
    ],
    caption: `Drawn only from Atlas's checked outline of ${M.source} (${M.files.length} files). Muse Wonder (${M.model}) proposed the parts and joins; plain code checked them against the files. A box stands on the tray of each file its lines come from, so a part that spans two files stands across two trays, and two parts from one file share a tray. Thick lines are calls, thin lines are imports. A box is 10 units wide plus 0.65 per 10 lines it covers; the ruler on the base reads at that scale, a tick per 50 lines. "Confirmed" means the lines exist where Wonder said; it does not mean Wonder's sentence about a part is true.`,
    body: `<div class="iso-stage ex-stage" tabindex="0" role="group" aria-label="Code explorer skid. Use left and right arrows to pick a part; Escape clears.">${svg}</div>`,
  });
  const body =
    `<style>${css}</style><div class="ex">` +
    plate +
    `<section class="ex-card" aria-live="polite" data-card><p class="ex-card-label">Pick a box</p><p class="ex-muted">Hover, click or Tab to a box to see its part: the name and purpose sentence Muse Wonder (${esc(M.model)}) wrote, the real file lines plain code confirmed, and every join with its status.</p></section>` +
    `<section class="ex-side"><h2>Not drawn as lines</h2><p class="ex-muted">Joins only Muse Wonder (${esc(M.model)}) states, with the parts named in its words. Plain code could not check them, so the machine has no line for them.</p><ul class="ex-chalks">${chalk || "<li>None.</li>"}</ul>` +
    (unconf ? `<h2>Parts not confirmed (not drawn)</h2><ul>${unconf}</ul>` : "") +
    (M.notInAnyPart.length ? `<h2>Files in no part</h2><p class="ex-muted">${M.notInAnyPart.map(esc).join(", ")}: an empty tray each.</p>` : "") +
    `</section></div>`;
  return k.pageHtml({ title: "Code explorer", theme, body, script: live, width: 760 });
}

function notShownPage(M, theme) {
  const body = `<div class="ex"><div class="iso-plate ex-notice" role="note"><p>Fig X2 · not drawn</p><p>${esc(M.notShown)}</p></div></div>`;
  return k.pageHtml({ title: "Code explorer", theme, body, width: 760 });
}

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const record = JSON.parse(readFileSync(FIXTURE, "utf8"));
  let last = null;
  for (const theme of ["dark", "light"]) {
    const out = buildExplorer(record, { theme });
    const name = theme === "light" ? "explorer-light.html" : "explorer.html";
    writeFileSync(join(HERE, name), out.html);
    console.log("wrote", name, `${(out.html.length / 1024).toFixed(0)} KB`, JSON.stringify(out.stats));
    last = out;
  }
  if (last && last.R) A.auditOrExit(last.R, last.P, {});
}
