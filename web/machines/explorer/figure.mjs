// X2: the code explorer machine's drawing, built with the Anatomy kit (web/machines/iso/, MIT). Pure and
// browser-safe: the same function draws the saved demo page (build.mjs, in Node) and the live explorer screen (in
// the browser, from a job's verified outline). Nothing here reads anything but the model (model.ts).
//
// The object: an instrument skid. A base plate on feet carries one deck per folder; on each deck lie the trays of
// that folder's files; on the trays stand instrument boxes, one per part plain code confirmed, each as wide as the
// lines it covers, each with one small engraved name plate (Wonder's name for the part). A box that covers two
// files stands across the joint of their two trays. Where plain code found that one part imports, calls or uses
// another, a bent steel line runs from a fitting on one box's lid to a fitting on the other's:
// - thick: calls; thin: imports or uses; braided and thinner: type-only (no link at run time);
// - two tag collars: found by plain code only (Wonder did not name it).
// A join only Wonder states is never a line (model.ts puts it on the chalk list).
//
// Line heights are a drawing choice, not data: each line runs at its own height so that it never passes through
// another line's fitting or another line; a line whose arch would be seen edge-on takes a side jog so no bend
// pinches on screen. When no such order exists, buildFigure throws (the page then shows the lists, no drawing).

import * as k from "../iso/iso-kit.mjs";
import * as G from "../iso/lathe.mjs";
import { tubePieces, tubeSvg } from "../iso/tube.mjs";
import * as A from "../iso/audit.mjs";

export const W = 760;
export const H = 440;
const AZIMUTH = 57;
const ELEVATION = 33;
const BOX_D = 22;
const BOX_H = 12;
const TRAY_H = 2.4;
const DECK_H = 1.6;
const TRAY_PAD = 3;
const DECK_PAD = 5;
const GAP_IN = 4;
const GAP_OUT = 10;
const ROW_PITCH = 44;
const DECK_GAP = 14;
const EMPTY_W = 12;
const ROW_TARGET = 150;
const NAME_SIZE = 4.4;
const FOLDER_SIZE = 3.6;
/** Review B4: counted router steps before the figure gives up and the page shows the lists only. */
export const ROUTER_BUDGET = 2_000_000;
export const MAX_DRAWN_LINES = 90;
export const MAX_DRAWN_PARTS = 40;
/** More stacked heights than this and the lines tower over the boxes: listed instead. */
export const MAX_LEVELS = 24;
/** The figure would take too long or be too dense to read: the page lists the parts and joins instead. */
export class TooManyToDraw extends Error {}
/** A box is as wide as its name plate needs (24–64 units); its HEIGHT is the lines it covers. */
export const widthOf = (name) => Math.min(64, Math.max(24, Math.ceil(String(name).length * NAME_SIZE * 0.64) + 8));
/** 7 units plus 1 per 45 lines: a 36-line part stands 7.8 tall, a 571-line part 19.7. */
export const heightOf = (lines) => 7 + lines / 45;
const BASE_H = 8;
const FOOT_H = 5;
const Z_TRAY = DECK_H;
const Z_BOX = DECK_H + TRAY_H;
const FIT = { base: 1.0, body: 2.2 };
const R_OF = { calls: 1.0, imports: 0.72, data: 0.86 };
const R_TYPE = 0.62;
const NUT = 1.4;
const TIER_STEP = 3.6;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Splits a deck's slots into rows only between files, minimising the widest row. */
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

/** Fits a name to a plate: the widest string that fits, with "…" when cut. */
export function fitName(text, width, size = NAME_SIZE) {
  const per = size * 0.64;
  const max = Math.max(1, Math.floor(width / per));
  const t = String(text);
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * Builds the figure from an explorer model (model.ts). Returns the SVG string, the recorder and projection (for the
 * audit), the ids drawn, and counts. Throws when the model has nothing to draw or the lines cannot be ordered.
 */
export function buildFigure(M) {
  if (M.notShown !== null) throw new Error(M.notShown);
  // Review B4: past these sizes the drawing is neither readable nor quick; the page lists everything instead.
  if (M.lines.length > MAX_DRAWN_LINES || M.boxes.length > MAX_DRAWN_PARTS)
    throw new TooManyToDraw(`${M.lines.length} joins between ${M.boxes.length} parts are too many to draw clearly (the machine draws at most ${MAX_DRAWN_LINES} joins and ${MAX_DRAWN_PARTS} parts)`);
  const boxOf = new Map(M.boxes.map((b) => [b.id, b]));

  // ---- layout: decks side by side (wrapping), rows inside a deck, slots left to right ----
  const deckLayouts = M.decks.map((deck) => {
    const segs = deck.slots.map((slot, i) => {
      const prev = deck.slots[i - 1];
      const lastPath = (s) => (s.kind === "box" ? s.slices[s.slices.length - 1].path : s.path);
      const firstPath = (s) => (s.kind === "box" ? s.slices[0].path : s.path);
      const gapBefore = prev ? (lastPath(prev) === firstPath(slot) ? GAP_IN : GAP_OUT) : 0;
      const w = slot.kind === "box" ? widthOf(boxOf.get(slot.id).name.text) : EMPTY_W;
      return { slot, w, gapBefore };
    });
    const total = segs.reduce((a, s) => a + s.w + s.gapBefore, 0);
    const rows = rowsOf(segs, Math.max(1, Math.min(5, Math.ceil(total / ROW_TARGET))));
    const rowW = rows.map(([a, b]) => segs.slice(a, b).reduce((acc, s, i) => acc + s.w + (i ? s.gapBefore : 0), 0));
    const w = Math.max(...rowW) + 2 * (TRAY_PAD + DECK_PAD);
    const d = rows.length * ROW_PITCH - (ROW_PITCH - BOX_D) + 2 * (TRAY_PAD + DECK_PAD) + 6;
    return { deck, segs, rows, rowW, w, d };
  });
  // wrap decks into lines of at most ~2.6 deck-widths of the widest
  const maxLine = Math.max(260, ...deckLayouts.map((l) => l.w));
  const lines2 = [];
  for (const l of deckLayouts) {
    const cur = lines2[lines2.length - 1];
    if (cur && cur.w + DECK_GAP + l.w <= maxLine) {
      cur.items.push(l);
      cur.w += DECK_GAP + l.w;
      cur.d = Math.max(cur.d, l.d);
    } else lines2.push({ items: [l], w: l.w, d: l.d });
  }
  const totalD = lines2.reduce((a, ln) => a + ln.d, 0) + DECK_GAP * (lines2.length - 1);
  const place = new Map(); // box id -> its primary segment (the one its lines land on)
  const segments = []; // every drawn box: one per part, or one per folder for a part spanning folders (review B3)
  const trays = [];
  const decks = [];
  let yCursor = -totalD / 2;
  for (const ln of lines2) {
    let xCursor = -ln.w / 2;
    for (const l of ln.items) {
      const deckPlan = { x: xCursor, y: yCursor + (ln.d - l.d), w: l.w, d: l.d, r: 3 };
      decks.push({ folder: l.deck.folder, plan: deckPlan });
      l.rows.forEach(([a, b], r) => {
        const y = deckPlan.y + DECK_PAD + TRAY_PAD + BOX_D / 2 + r * ROW_PITCH;
        let x = deckPlan.x + DECK_PAD + TRAY_PAD + (l.w - 2 * (TRAY_PAD + DECK_PAD) - l.rowW[r]) / 2;
        const runs = [];
        for (let i = a; i < b; i++) {
          const s = l.segs[i];
          if (i > a) x += s.gapBefore;
          if (s.slot.kind === "box") {
            const box = boxOf.get(s.slot.id);
            const segLines = s.slot.slices.reduce((n, sl) => n + sl.lines, 0) || 1;
            const slices = [];
            let sx = x;
            for (const sl of s.slot.slices) {
              const sw = (s.w * sl.lines) / segLines;
              slices.push({ path: sl.path, x0: sx, x1: sx + sw });
              sx += sw;
            }
            segments.push({ boxId: box.id, plan: { x, y: y - BOX_D / 2, w: s.w, d: BOX_D, r: 1.6 }, slices, lines: segLines, segment: s.slot.segment ?? null });
            for (const sl of slices) {
              const last = runs[runs.length - 1];
              if (last && last.path === sl.path) last.x1 = sl.x1;
              else runs.push({ ...sl, joinedLeft: Boolean(last && Math.abs(last.x1 - sl.x0) < 1e-6) });
            }
          } else runs.push({ path: s.slot.path, x0: x, x1: x + s.w, empty: true });
          x += s.w;
        }
        runs.forEach((run, i) => {
          const next = runs[i + 1];
          const joinedRight = Boolean(next && next.joinedLeft);
          const x0 = run.joinedLeft ? run.x0 : run.x0 - TRAY_PAD;
          const x1 = joinedRight ? run.x1 : run.x1 + TRAY_PAD;
          trays.push({ path: run.path, empty: Boolean(run.empty), plan: { x: x0, y: y - BOX_D / 2 - TRAY_PAD, w: x1 - x0, d: BOX_D + 2 * TRAY_PAD, r: 1.2 }, joinedLeft: run.joinedLeft, joinedRight });
        });
      });
      xCursor += l.w + DECK_GAP;
    }
    yCursor += ln.d + DECK_GAP;
  }
  for (const box of M.boxes) {
    const mine = segments.filter((g) => g.boxId === box.id);
    const primary = mine.reduce((a, g) => (g.lines > a.lines ? g : a), mine[0]);
    for (const g of mine) g.primary = g === primary;
    place.set(box.id, primary);
  }
  for (const g of segments) g.h = heightOf(g.lines);
  const hOf = new Map(M.boxes.map((b) => [b.id, place.get(b.id).h]));
  const TOP = Z_BOX + Math.max(...segments.map((g) => g.h));
  const TIER0 = TOP + FIT.base + FIT.body + 11;
  const minX = Math.min(...decks.map((d) => d.plan.x));
  const maxX = Math.max(...decks.map((d) => d.plan.x + d.plan.w));
  const minY = Math.min(...decks.map((d) => d.plan.y));
  const maxY = Math.max(...decks.map((d) => d.plan.y + d.plan.d));
  const BASE = { x: minX - 10, y: minY - 10, w: maxX - minX + 20, d: maxY - minY + 26, r: 8 };

  // ---- fittings: one per line end on a box lid, on the side that faces the other box ----
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
  const jacks = new Map();
  const SPACE = 5.2;
  for (const box of M.boxes) {
    const { plan } = place.get(box.id);
    const q = lidRect(plan);
    const L = perim(q);
    const [cx, cy] = centreOf(plan);
    const ends = M.lines
      .filter((l) => l.from === box.id || l.to === box.id)
      .map((l) => {
        const [ox, oy] = centreOf(place.get(l.from === box.id ? l.to : l.from).plan);
        return { key: `${l.id}:${box.id}`, t: tOfRay(q, Math.atan2(oy - cy, ox - cx)) };
      })
      .sort((a, b) => a.t - b.t);
    if (ends.length * SPACE > L) throw new Error(`the part ${box.id} has more lines than its lid has room for`);
    for (let pass = 0; pass < 400 && ends.length > 1; pass++) {
      let moved = false;
      for (let i = 0; i < ends.length; i++) {
        const a = ends[i];
        const b = ends[(i + 1) % ends.length];
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
  const LL = () => M.lines.map((l) => ({ l, a: jacks.get(`${l.id}:${l.from}`), b: jacks.get(`${l.id}:${l.to}`) }));
  const segsCross = (a, b, c, d) => {
    const o = (p, q2, r) => (q2[0] - p[0]) * (r[1] - p[1]) - (q2[1] - p[1]) * (r[0] - p[0]);
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

  // ---- tiers ----
  const segDist = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
    return Math.hypot(a[0] + t * vx - p[0], a[1] + t * vy - p[1]);
  };
  const segSeg = (a, b, c, d) => (segsCross(a, b, c, d) ? 0 : Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b)));
  const polyDist = (e, plan) => {
    let m = Infinity;
    for (let q = 1; q < plan.length; q++) m = Math.min(m, segDist(e, plan[q - 1], plan[q]));
    return m;
  };
  const polyPoly = (p1, p2) => {
    let m = Infinity;
    for (let x = 1; x < p1.length; x++) for (let y = 1; y < p2.length; y++) m = Math.min(m, segSeg(p1[x - 1], p1[x], p2[y - 1], p2[y]));
    return m;
  };
  const L = M.lines.map((l) => ({ ...l, r: l.typeOnly ? R_TYPE : (R_OF[l.kind] ?? 0.86), a: jacks.get(`${l.id}:${l.from}`), b: jacks.get(`${l.id}:${l.to}`) }));
  const TV = [Math.cos((AZIMUTH * Math.PI) / 180), Math.sin((AZIMUTH * Math.PI) / 180)];
  const COS_E = Math.cos((ELEVATION * Math.PI) / 180);
  // A leg's vertical bend faces the viewer enough when the leg runs across the view (else the bend pinches to a V).
  const facingOf = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return COS_E * Math.abs((-(b[1] - a[1]) / len) * TV[0] + ((b[0] - a[0]) / len) * TV[1]);
  };
  const legOk = (plan) => plan.length === 2 || plan.every((q, i) => i === 0 || Math.hypot(q[0] - plan[i - 1][0], q[1] - plan[i - 1][1]) >= 7);
  const FACE_MIN = 0.34;
  // Candidate plans for each line, most direct first: straight; a side jog either way at three widths; an L either way.
  const candidatesOf = (l) => {
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]) || 1;
    const n = [-(l.b[1] - l.a[1]) / len, (l.b[0] - l.a[0]) / len];
    const out = [[l.a, l.b]];
    for (const d of [14, 20, 27]) for (const sg of [1, -1]) out.push([l.a, [l.a[0] + n[0] * d * sg, l.a[1] + n[1] * d * sg], [l.b[0] + n[0] * d * sg, l.b[1] + n[1] * d * sg], l.b]);
    out.push([l.a, [l.b[0], l.a[1]], l.b], [l.a, [l.a[0], l.b[1]], l.b]);
    return out.filter((plan) => legOk(plan) && facingOf(plan[0], plan[1]) >= FACE_MIN && facingOf(plan[plan.length - 2], plan[plan.length - 1]) >= FACE_MIN);
  };
  const ownEnd = (l, e) => Math.hypot(e[0] - l.a[0], e[1] - l.a[1]) < 0.1 || Math.hypot(e[0] - l.b[0], e[1] - l.b[1]) < 0.1;
  const planLength = (plan) => plan.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - plan[i - 1][0], q[1] - plan[i - 1][1]) : 0), 0);
  // Review B4: the router's work is counted, so a huge outline ends as "too many joins to draw" instead of a frozen tab.
  let work = 0;
  const spend = (n) => {
    work += n;
    if (work > ROUTER_BUDGET) throw new TooManyToDraw(`${M.lines.length} joins between ${M.boxes.length} parts are too many to draw clearly`);
  };
  // For every line and every candidate route: the lines whose fittings that route passes over (computed once).
  for (const l of L) {
    const plans = candidatesOf(l);
    if (plans.length === 0) throw new Error(`no route for ${l.id} keeps its bends facing the viewer`);
    l.options = plans
      .map((plan) => {
        spend(L.length);
        const over = new Set();
        let crowd = 0;
        L.forEach((o, j) => {
          if (o === l) return;
          for (const e of [o.a, o.b]) if (!ownEnd(l, e) && polyDist(e, plan) < l.r + o.r + 1.4) {
            over.add(j);
            crowd++;
          }
        });
        return { plan, over, crowd, length: planLength(plan) };
      })
      .sort((x, y) => x.crowd - y.crowd || x.length - y.length);
    l.choice = 0;
    l.plan = l.options[0].plan;
  }
  const NEAR = 4.4;
  // above[i] has j: line i passes over line j's fitting, so it must run higher than line j.
  const aboveOf = () => L.map((l) => l.options[l.choice].over);
  const lengths = L.map((l) => 0);
  const topo = (above) => {
    spend(L.length * 4);
    const indeg = L.map((_, i) => above[i].size);
    const below = L.map(() => []);
    L.forEach((_, i) => above[i].forEach((j) => below[j].push(i)));
    L.forEach((l, i) => (lengths[i] = l.options[l.choice].length));
    const ready = L.map((_, i) => i).filter((i) => indeg[i] === 0);
    const order = [];
    while (ready.length) {
      let bi = 0;
      for (let q = 1; q < ready.length; q++) if (lengths[ready[q]] < lengths[ready[bi]]) bi = q;
      const i = ready.splice(bi, 1)[0];
      order.push(i);
      for (const up of below[i]) if (--indeg[up] === 0) ready.push(up);
    }
    return order;
  };
  // Break every cycle by moving one of its lines to another candidate route; give up only when none helps.
  let above = aboveOf();
  let order = topo(above);
  for (let guard = 0; order.length !== L.length && guard < 4 * L.length; guard++) {
    const placed = new Set(order);
    const stuck = L.map((_, i) => i).filter((i) => !placed.has(i));
    let best = null;
    for (const i of stuck) {
      const l = L[i];
      const keep = l.choice;
      for (let c = 0; c < l.options.length; c++) {
        if (c === keep) continue;
        l.choice = c;
        const left = L.length - topo(aboveOf()).length;
        if (!best || left < best.left || (left === best.left && l.options[c].length < best.length)) best = { i, c, left, length: l.options[c].length };
      }
      l.choice = keep;
    }
    if (!best || best.left >= stuck.length) break;
    L[best.i].choice = best.c;
    L[best.i].plan = L[best.i].options[best.c].plan;
    above = aboveOf();
    order = topo(above);
  }
  if (order.length !== L.length) throw new Error(`the lines cannot be stacked without one passing through another (${L.filter((_, i) => !order.includes(i)).map((l) => l.id).join(", ")})`);
  // Lines whose plans come close in plan view may not share a height: one crossing table, computed once.
  const crossing = L.map(() => []);
  for (let i = 0; i < L.length; i++) {
    spend(L.length);
    for (let j = i + 1; j < L.length; j++) if (polyPoly(L[i].plan, L[j].plan) < NEAR) {
      crossing[i].push(j);
      crossing[j].push(i);
    }
  }
  // Each line's height: above every line whose fitting it passes over, and apart from every line it comes close to.
  // `floor` lifts a line (review minor 6: a line whose bend lands on another line on screen is lifted and drawn again).
  const floor = L.map(() => 0);
  const level = L.map(() => -1);
  const assignLevels = () => {
    level.fill(-1);
    for (const i of order) {
      let lv = Math.max(floor[i], ...[...above[i]].map((j) => level[j] + 1));
      const taken = new Set(crossing[i].map((j) => level[j]).filter((v) => v >= 0));
      while (taken.has(lv)) lv++;
      level[i] = lv;
    }
    if (Math.max(0, ...level) + 1 > MAX_LEVELS) throw new TooManyToDraw(`${M.lines.length} joins would need ${Math.max(...level) + 1} stacked heights to draw without one passing through another; that is too many to read`);
  };
  if (typeof process !== "undefined" && process.env?.X2_WORK) console.log(`router work ${work}`);

  const drawOnce = () => {

    // ---- camera ----
    const tops = L.flatMap((l, i) => l.plan.map((e) => [e[0], e[1], TIER0 + level[i] * TIER_STEP + l.r + 1]));
    const P = k.fitProjection([...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), ...tops], W, H, { pad: 10, azimuth: AZIMUTH, elevation: ELEVATION });
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
    // Review minor 1: the ruler strip is gone. Box width no longer measures lines (height does), so a ruler would claim
    // a scale the drawing does not use, and its long ticks floated on large figures.
    const LABEL = { x: BASE.x + BASE.w - 40, y: BASE.y + BASE.d - 16, w: 28, d: 11, r: 1.2 };
    back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
    back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
    back.push(Ln([18, 12, 15].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 2.8 + i * 2.7], [LABEL.x + 4 + w, LABEL.y + 2.8 + i * 2.7], 0.8, P)).join(""), { tone: "lo", free: true }));
    back.push(Dots([at([LABEL.x + LABEL.w - 2.6, LABEL.y + 2.4, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d - 2.4, 0.8])], { size: 0.45 }));

    // ---- decks: one per folder, a folder plate engraved with its name on the front edge ----
    for (const deck of decks) {
      const p = deck.plan;
      const shape = R.solid(A.slab(p, 0, DECK_H, { name: `deck.${deck.folder}` }, 4));
      const screws = k.corners(p, 2.4);
      const fy = p.y + p.d;
      const label = deck.folder === "" ? (M.rootFolder ?? "./") : deck.folder;
      const tw = Math.min(p.w - 10, label.length * FOLDER_SIZE * 0.64 + 4);
      const tag = { x: p.x + 5, y: fy - 6.2, w: tw, d: 5.4, r: 0.8 };
      const text = k.faceTextSvg(k.topMatrix([tag.x + 2, tag.y + 4.0], DECK_H + 0.4, P, "x"), fitName(label, tw - 3, FOLDER_SIZE), { size: FOLDER_SIZE, tone: "hi" });
      put(
        `deck.${deck.folder}`,
        [p.x + p.w / 2, p.y + p.d / 2, DECK_H / 2],
        S(k.slabOf(p, 0, DECK_H, P, 4, 0.4), { tone: "lo", inner: Ln(k.sideSeam(p, DECK_H / 2, P, 4), { tone: "faint" }) }) +
          Dots(screws.map(([x, y]) => at([x, y, DECK_H])), { size: 0.45, tone: "mid" }) +
          S(k.slabOf(tag, DECK_H, 0.4, P, 2), { tone: "mid", crease: "none" }) +
          text,
        [shape],
        { attrs: ` data-folder="${esc(deck.folder)}"` },
      );
    }

    // ---- trays: one per file ----
    for (const tray of trays) {
      const p = tray.plan;
      const shape = R.solid(A.slab(p, Z_TRAY, TRAY_H, { name: `tray.${tray.path}` }, 3));
      const screws = [];
      if (!tray.joinedLeft) screws.push([p.x + 1.6, p.y + 1.6], [p.x + 1.6, p.y + p.d - 1.6]);
      if (!tray.joinedRight) screws.push([p.x + p.w - 1.6, p.y + 1.6], [p.x + p.w - 1.6, p.y + p.d - 1.6]);
      const fy = p.y + p.d;
      const tw = Math.min(10, p.w - 6);
      const tx = p.x + 3;
      const tag = path3([[tx, fy, Z_TRAY + 0.5], [tx + tw, fy, Z_TRAY + 0.5], [tx + tw, fy, Z_TRAY + 1.9], [tx, fy, Z_TRAY + 1.9]], true);
      const tagRule = path3([[tx + 1, fy, Z_TRAY + 1.2], [tx + tw * 0.75, fy, Z_TRAY + 1.2]]);
      const tagSvg = `<path class="iso-fill ex-plate" d="${tag}"/>` + Ln(tag, { tone: "lo" }) + Ln(tagRule, { tone: "lo", free: true });
      const groove = tray.empty ? Ln(k.planOutline(k.insetPlan(p, 2.6), Z_TRAY + TRAY_H, P, 3), { tone: "faint" }) : "";
      put(
        `tray.${tray.path}`,
        [p.x + p.w / 2, p.y + p.d / 2, Z_TRAY + TRAY_H / 2],
        S(k.slabOf(p, Z_TRAY, TRAY_H, P, 3, 0.4), { tone: tray.empty ? "lo" : "mid", inner: Ln(k.sideSeam(p, Z_TRAY + TRAY_H / 2, P, 3), { tone: "faint" }) }) +
          groove +
          Dots(screws.map(([x, y]) => at([x, y, Z_TRAY + TRAY_H])), { size: 0.45, tone: "mid" }) +
          tagSvg,
        [shape],
        { attrs: ` data-file="${esc(tray.path)}"` },
      );
    }

    // ---- boxes, each with one engraved name plate on its front face ----
    const names = {};
    const dials = {};
    for (const seg of segments) {
      const box = boxOf.get(seg.boxId);
      const { plan, slices } = seg;
      const z0 = Z_BOX;
      const BH = seg.h;
      const solidName = seg.primary ? `box.${box.id}` : `seg.${box.id}.${seg.segment.index}`;
      const shape = R.solid(A.slab(plan, z0, BH, { name: solidName }, 4));
      const lid = k.insetPlan(plan, 1.6);
      const screws = k.corners(plan, 2.2);
      const front = plan.y + plan.d;
      const seams = slices
        .slice(1)
        .map((sl) => path3([[sl.x0, front, z0], [sl.x0, front, z0 + BH]]))
        .join("");
      // the name plate: a recessed outline on the front face, the name engraved in it, fitted to its width
      const px0 = plan.x + 2.2;
      const pw = plan.w - 4.4;
      const pz1 = z0 + BH - 1.3;
      const pz0 = pz1 - 5.3;
      const plate = path3([[px0, front, pz0], [px0 + pw, front, pz0], [px0 + pw, front, pz1], [px0, front, pz1]], true);
      const shown = fitName(seg.segment ? `${seg.segment.index}/${seg.segment.of} ${box.name.text}` : box.name.text, pw - 2.4);
      if (seg.primary) names[box.id] = shown;
      const nameText = k.faceTextSvg(k.sideMatrix([px0 + 1.2, front], pz1 - 1.0 - NAME_SIZE * 0.72, P, "left"), shown, { size: NAME_SIZE, tone: "hi" });
      const lamp = at([plan.x + 3.2, plan.y + plan.d - 3.2, z0 + BH]);
      const xr = plan.x + plan.w;
      const vents = [0, 1, 2].map((v) => {
        const y0 = plan.y + 3 + v * 2.4;
        return path3([[xr, y0, z0 + 2], [xr, y0 + 1.1, z0 + 2], [xr, y0 + 1.1, z0 + BH - 2], [xr, y0, z0 + BH - 2]], true);
      });
      // U1: a stand-in "device" or the clock housing is a plainer box (mid tone); a part of the code stays "hi".
      const bodyTone = box.device || box.dial ? "mid" : "hi";
      const svg =
        S(k.slabOf(plan, z0, BH, P, 4, 0.6), { tone: bodyTone, inner: Ln(k.sideSeam(plan, z0 + 1.6, P, 4), { tone: "faint" }) + (seams ? Ln(seams, { tone: "faint" }) : "") }) +
        Ln(k.planOutline(lid, z0 + BH, P, 4), { tone: "faint" }) +
        Dots(screws.map(([x, y]) => at([x, y, z0 + BH])), { size: 0.45, tone: "mid" }) +
        `<path class="iso-fill ex-plate" d="${plate}"/>` +
        Ln(plate, { tone: "lo" }) +
        `<g class="ex-name">${nameText}</g>` +
        Ln(vents.join(""), { tone: "lo" }) +
        `<g class="ex-lamp">${Dots([lamp], { size: 0.8, tone: "hi" })}</g>`;
      put(solidName, [plan.x + plan.w / 2, plan.y + plan.d / 2, z0 + BH / 2], svg, [shape], { attrs: ` data-of="${esc(box.id)}"` });
      const yc = plan.y + plan.d / 2 + 3;
      const parts = [
        { name: "handle.foot", plan: { x: xr, y: yc - 5.5, w: 1.6, d: 1.6, r: 0.4 } },
        { name: "handle.foot", plan: { x: xr, y: yc + 3.9, w: 1.6, d: 1.6, r: 0.4 } },
        { name: "handle.bar", plan: { x: xr + 1.6, y: yc - 5.5, w: 1.2, d: 11, r: 0.5 } },
      ];
      const hz = z0 + BH / 2 - 1.2;
      const shapes = parts.map((q) => R.solid(A.slab(q.plan, hz, 2.4, { name: `${solidName}.${q.name}` }, 2)));
      put(`${solidName}.handle`, [xr + 1.4, yc, hz + 1.2], parts.map((q) => S(k.slabOf(q.plan, hz, 2.4, P, 2), { tone: "mid" })).join(""), shapes, { attrs: ` data-of="${esc(box.id)}"` });
      const lidZ0 = z0 + BH;
      const [mx, my] = [plan.x + plan.w / 2, plan.y + plan.d / 2];
      if (box.device && seg.primary) {
        // U1: the stand-in's signal lamp, a lens on a bezel in the middle of the lid. It lights once per call in the run.
        const F = G.frameAlong([mx, my, lidZ0], [0, 0, 1]);
        const shapes2 = [R.solid(A.disc(F, 0, LAMP.bezelH, LAMP.bezelR, { name: `lamp.${box.id}.bezel` })), R.solid(A.disc(F, LAMP.bezelH, LAMP.bezelH + LAMP.lensH, LAMP.lensR, { name: `lamp.${box.id}.lens` }))];
        const lamp2 =
          S(G.disc(0, LAMP.bezelH, LAMP.bezelR, F, P, { steps: 28, bevel: 0.2 }), { tone: "mid" }) +
          `<g class="u1-lamp" data-lamp="${esc(box.id)}">${S(G.disc(LAMP.bezelH, LAMP.bezelH + LAMP.lensH, LAMP.lensR, F, P, { steps: 28, bevel: 0.3 }), { tone: "lo" })}</g>`;
        put(`lamp.${box.id}`, [mx, my, lidZ0 + 1], lamp2, shapes2, { attrs: ` data-of="${esc(box.id)}"` });
      }
      if (box.dial && seg.primary) {
        // U1: the clock dial, Atlas's virtual clock. A turned bezel with a knurled rim, a face with one tick per tenth and
        // a longer tick at each time the test's own waits mark (box.dial.marks, fractions of the dial); the needle is
        // drawn by the live page (needle path from dialNeedle).
        const DR = Math.min(plan.w, plan.d) / 2 - 2.2;
        const F = G.frameAlong([mx, my, lidZ0], [0, 0, 1]);
        const top = lidZ0 + DIAL.h;
        const shapes2 = [R.solid(A.disc(F, 0, DIAL.h, DR, { name: `dial.${box.id}` }))];
        const ticks = k.radialTicks(mx, my, DR - 1.6, 20, 2, top, [0.9, 1.6], P, DIAL.from, DIAL.span);
        const marks = (box.dial.marks ?? []).map((f) => {
          const a = DIAL.from + Math.max(0, Math.min(1, f)) * DIAL.span;
          return k.lineOnTop([mx + Math.sin(a) * (DR - 4.4), my - Math.cos(a) * (DR - 4.4)], [mx + Math.sin(a) * (DR - 1.6), my - Math.cos(a) * (DR - 1.6)], top, P);
        });
        const dialSvg =
          S(G.disc(0, DIAL.h, DR, F, P, { steps: 48, bevel: 0.4 }), { tone: "hi" }) +
          Ln(k.knurl(mx, my, DR, lidZ0 + 0.3, top - 0.3, 56, P, 0.2), { tone: "lo" }) +
          Ln(k.ring(mx, my, DR - 1.6, top, P, 56), { tone: "lo" }) +
          Ln(ticks.minor, { tone: "lo" }) +
          Ln(ticks.major, { tone: "mid" }) +
          (marks.length ? `<g class="u1-dial-marks">${Ln(marks.join(""), { tone: "hi" })}</g>` : "") +
          Ln(k.ring(mx, my, 1.1, top, P, 16), { tone: "mid" });
        put(`dial.${box.id}`, [mx, my, lidZ0 + DIAL.h / 2], dialSvg, shapes2, { attrs: ` data-of="${esc(box.id)}"` });
        dials[box.id] = { x: mx, y: my, top, r: DR };
      }
    }

    // ---- fittings and steel lines ----
    L.forEach((l, i) => {
      const r = l.r;
      const bodyR = Math.max(r * 1.75, 1.2);
      const baseR = bodyR * 1.32;
      const h = TIER0 + level[i] * TIER_STEP;
      const lidZ = (boxId) => Z_BOX + hOf.get(boxId);
      for (const [end, boxId] of [[l.a, l.from], [l.b, l.to]]) {
        const F = G.frameAlong([end[0], end[1], lidZ(boxId)], [0, 0, 1]);
        const shapes = [R.solid(A.disc(F, 0, FIT.base, baseR, { name: `fit.${l.id}.base` })), R.solid(A.disc(F, FIT.base, FIT.base + FIT.body, bodyR, { name: `fit.${l.id}.body` }))];
        const svg = S(G.disc(0, FIT.base, baseR, F, P, { steps: 6 }), { tone: "mid" }) + S(G.disc(FIT.base, FIT.base + FIT.body, bodyR, F, P, { steps: 24 }), { tone: "mid" });
        put(`fit.${l.id}.${boxId}`, [end[0], end[1], lidZ(boxId) + 1.5], svg, shapes, { attrs: ` data-of="${esc(boxId)}" data-line="${esc(l.id)}"` });
      }
      const pts = [[l.a[0], l.a[1], lidZ(l.from) + FIT.base + FIT.body], ...l.plan.map(([x, y]) => [x, y, h]), [l.b[0], l.b[1], lidZ(l.to) + FIT.base + FIT.body]];
      const route = G.fillet(pts, l.plan.length > 2 ? 6.5 : Math.max(4.5, r * 4), 12, { P, tube: r });
      const total = G.pathLength(route);
      const collars = [
        { s0: 0, s1: NUT, r: bodyR, kind: "nut" },
        { s0: total - NUT, s1: total, r: bodyR, kind: "nut" },
      ];
      if (l.status === "code-only") for (const s of [total / 2 - 7, total / 2 + 7]) collars.push({ s0: s - 0.9, s1: s + 0.9, r: Math.max(r * 2.1, 1.4), kind: "tag" });
      const gaps = collars.map((c) => [c.s0, c.s1]);
      R.route(`line.${l.id}`, route, r, { gaps, rims: [bodyR, bodyR], piece: "skid" });
      const attrs = ` data-line="${esc(l.id)}" data-ends="${esc(l.from)} ${esc(l.to)}"`;
      const rings = l.typeOnly ? { rings: { pitch: 1.6, twist: 0.8, cross: true, fade: [0.1, 0.55] } } : {};
      tubePieces(route, r, P, { maxLength: 14, spacing: Math.max(0.6, Math.min(1.6, r)), gaps, ...rings }).forEach((piece, index) =>
        put(`line.${l.id}:${index}`, piece.mid, tubeSvg(piece, { tone: "mid" }), [A.tube(piece.points, piece.radii)], { bias: 0.05, attrs }),
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

    return { R, P, back, names, dials };
  };
  let drawn;
  for (let attempt = 0; ; attempt++) {
    assignLevels();
    drawn = drawOnce();
    if (attempt >= 3) break;
    const crowd = A.crowding(drawn.R.routes, drawn.P, { links: A.linksOf(drawn.R.tubes, A.mountsOf(drawn.R.tubes, drawn.R.solids)), items: drawn.R.items, rods: A.slenderOf(drawn.R.solids) });
    const lift = new Set(crowd.map((c) => String(c.a)).filter((n) => n.startsWith("line.")).map((n) => n.slice(5).replace(/\.(nut|tag)$/, "")));
    const idx = L.map((l, i) => (lift.has(l.id) ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) break;
    for (const i of idx) floor[i] = level[i] + 1;
  }
  const { R, P, back, names, dials } = drawn;

  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const groups = R.items.map((item) => `<g class="it" data-name="${esc(item.name)}"${item.attrs ?? ""}>${item.svg}</g>`);
  // hit targets over everything, back to front, so the nearer box takes the pointer where silhouettes overlap
  // One hit target per part: a part spanning folders is one path with a piece over each of its boxes.
  const depthOfSeg = (g) => k.depthOf([g.plan.x + g.plan.w / 2, g.plan.y + g.plan.d / 2, 0], P);
  const hits = [...M.boxes]
    .sort((a, b) => depthOfSeg(place.get(a.id)) - depthOfSeg(place.get(b.id)))
    .map((box) => `<path class="ex-hit" data-hit="${esc(box.id)}" d="${segments.filter((g) => g.boxId === box.id).map((g) => k.slabOf(g.plan, Z_BOX, g.h + FIT.base + FIT.body, P, 4).fill).join("")}"/>`)
    .join("");
  const codeOnly = M.lines.filter((l) => l.status === "code-only").length;
  const fileCount = new Set(trays.map((t) => t.path)).size;
  const spanning = M.boxes.filter((b) => segments.filter((g) => g.boxId === b.id).length > 1).length;
  const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const label = `An instrument skid on a base plate: ${n(decks.length, "folder deck")}, trays for ${n(fileCount, "file")}, and ${n(M.boxes.length, "part")} whose lines plain code confirmed, drawn as ${n(segments.length, "instrument box", "instrument boxes")}${spanning ? ` (${n(spanning, "part")} spanning folders get one box per folder)` : ""}; a box grows taller with the lines it covers and carries its name on a plate. ${n(M.lines.length, "bent steel line")} join box lids where plain code found an import, call or use between two parts; ${codeOnly} of them carry two tag collars because plain code found them and Wonder did not name them.`;
  // U1: the needle of each dial, drawn above the skid so the page can turn it (dialNeedle).
  const needles = Object.entries(dials).map(([id, d]) => `<g class="u1-needle" data-needle="${esc(id)}">${k.lineSvg(dialNeedle(d, P, 0), { tone: "hi", free: "start" })}${k.dotsSvg([k.iso([d.x, d.y, d.top], P)], { size: 0.6, tone: "hi" })}</g>`).join("");
  const svg = k.figureSvg({ width: W, height: H, label: M.extraLabel ? `${label} ${M.extraLabel}` : label, body: [...back, `<g class="ex-skid">${groups.join("")}</g>`, needles, `<g class="ex-hits">${hits}</g>`] });
  return {
    svg,
    R,
    P,
    names,
    dials,
    stats: { solids: R.solids.length, items: R.items.length, lines: M.lines.length, runs: R.tubes.length, trays: trays.length, files: fileCount, decks: decks.length, boxes: segments.length, levels: Math.max(0, ...level) + 1 },
  };
}

/** U1: the lamp on a stand-in device and the dial on the clock housing (world units). */
const LAMP = { bezelR: 3.6, bezelH: 0.8, lensR: 2.6, lensH: 1.2 };
/** The dial sweeps 300°, from 210° (0 ms) clockwise; `marks` and the needle are fractions of that sweep. */
export const DIAL = { h: 2.2, from: (210 * Math.PI) / 180, span: (300 * Math.PI) / 180 };

/** The needle of a dial at a fraction (0–1) of its sweep, as an SVG path (a short tail past the pivot, like a gauge). */
export function dialNeedle(d, P, frac) {
  const a = DIAL.from + Math.max(0, Math.min(1, frac)) * DIAL.span;
  return k.lineOnTop([d.x - Math.sin(a) * 2.2, d.y + Math.cos(a) * 2.2], [d.x + Math.sin(a) * (d.r - 2.4), d.y - Math.cos(a) * (d.r - 2.4)], d.top + 0.15, P);
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

/** The Anatomy audit on a built figure: { passed, problems, report }. */
export function auditFigure(fig) {
  const result = A.audit(fig.R, fig.P, {});
  const problems = A.failures(result);
  return { passed: problems === 0, problems, report: A.report(result) };
}
