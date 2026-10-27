// The call timeline's world layout and paths, computed from the model (E3). Built with the Anatomy kit
// (web/machines/iso/, MIT). World units are about 1 px; x runs along the clock, y across the lanes, z is up.
//
// The bench, back to front:
// - one rail per stand-in the run recorded (back), each on two posts, with one peg per call;
// - the function's own rail (front) with a start block at 0 ms, an end stop at the far end, and the end token;
// - the ruler strip along the front edge (Atlas's virtual clock), with the cursor sled that runs along it;
// - the base plate on four feet, its groove, corner screws and a label plate.
// The number of rails and pegs comes from the model only, so the bench never has a part the run lacks.

import {
  circleRing,
  depthOf,
  extrude,
  fitProjection,
  insetPlan,
  iso,
  onTop,
  pathOf,
  planOutline,
  sideSeam,
  slabOf,
  translateAlong,
  type Flat,
  type Plan,
  type Point3,
  type Projection,
  type SolidPaths,
} from "../iso/iso-kit";
import type { TimelineModel } from "./model";

export const WIDTH = 640;
export const AZIMUTH = 74;
/** The clock runs from X0 (0 ms) to X1 (the span). */
export const X0 = -72;
export const X1 = 72;
export const LANE_GAP = 20;
export const RAIL_Z = 10;
export const RAIL_H = 3;
export const RAIL_TOP = RAIL_Z + RAIL_H;
/** The closest two pegs of one rail may stand (world units, centre to centre). */
export const PEG_GAP = 6.6;
/** At most this many stand-in rails, and this many pegs on one rail; a run with more is not drawn (the card says why). */
export const MAX_LANES = 6;
export const MAX_PEGS = Math.floor((X1 - X0) / PEG_GAP) + 1;
const PEG_R = 2.4;
const PEG_H = 10;
const END_STOP_X = X1 + 8;

export type PegMark = "returned" | "threw" | "never_answered" | "no_answer_seen";

export interface PegPart {
  lane: number;
  n: number;
  /** Virtual ms of the call (the cursor reveals it when it passes this time). */
  t: number;
  at: Point3;
  nudged: boolean;
  mark: PegMark;
  foot: SolidPaths;
  body: SolidPaths;
  cap: SolidPaths;
  capRing: string;
  /** The answer mark on the cap: a dot (returned), a slash rim to rim (threw); none for no answer. */
  dot?: Flat;
  slash?: string;
  /** A call that answered later: a bar along the rail from the peg to the moment it answered, with a stud there. */
  bar?: { paths: SolidPaths; stud: SolidPaths; t: number };
  key: number;
}

export interface LanePart {
  index: number;
  name: string;
  y: number;
  posts: SolidPaths[];
  rail: SolidPaths;
  railSeam: string;
  caps: SolidPaths[];
  pegs: PegPart[];
  key: number;
}

export interface TimelineGeometry {
  P: Projection;
  height: number;
  base: {
    halo: string;
    feet: [SolidPaths, SolidPaths][];
    slab: SolidPaths;
    groove: string;
    screws: Flat[];
    label: SolidPaths;
    labelLine: string;
    labelRule: string;
    labelScrews: Flat[];
  };
  lanes: LanePart[];
  front: {
    posts: SolidPaths[];
    rail: SolidPaths;
    railSeam: string;
    start: SolidPaths;
    startDot: Flat;
    stop: SolidPaths;
    stopScrew: Flat;
    /** The function's own end token; null when its end was not seen. */
    end: null | {
      kind: "returned" | "threw" | "never_settled" | "still_running";
      t: number;
      block: SolidPaths;
      dot?: Flat;
      slash?: string;
      ring?: string;
      bars?: string;
    };
  };
  ruler: { strip: SolidPaths; minor: string; major: string; zero: string };
  sled: { body: SolidPaths; index: string };
  /** World x of a virtual time. */
  xOf: (t: number) => number;
  /** The SVG transform that moves the sled to virtual time t. */
  sledAt: (t: number) => string;
  /** Why the run is not drawn (too many rails or pegs), or null. */
  tooMany: string | null;
}

export function laneY(i: number): number {
  return -(i + 1) * LANE_GAP;
}

/** Each peg's x: its virtual moment, nudged right in call order when it would touch the previous peg. */
export function pegXs(ts: readonly number[], xOf: (t: number) => number): { x: number; nudged: boolean }[] {
  const out: { x: number; nudged: boolean }[] = [];
  let prev = -Infinity;
  for (const t of ts) {
    const want = xOf(t);
    const x = Math.max(want, prev + PEG_GAP);
    out.push({ x, nudged: x > want + 1e-9 });
    prev = x;
  }
  return out;
}

export function timelineGeometry(model: TimelineModel): TimelineGeometry {
  const lanesN = model.lanes.length;
  const back = laneY(Math.max(0, lanesN - 1)) - 14;
  const BASE: Plan = { x: X0 - 26, y: back, w: X1 - X0 + 58 + 26, d: 34 - back, r: 7 };
  const height = 236 + Math.min(lanesN, MAX_LANES) * 34;
  const corners: Point3[] = [];
  for (const px of [BASE.x, BASE.x + BASE.w]) for (const py of [BASE.y, BASE.y + BASE.d]) for (const z of [-14, RAIL_TOP + PEG_H + 2]) corners.push([px, py, z]);
  const P = fitProjection(corners, WIDTH, height, { pad: 26, azimuth: AZIMUTH });
  const at = (p: Point3): Flat => iso(p, P);
  const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
  const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
  const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 24) => extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
  const ring = (cx: number, cy: number, r: number, z: number, steps = 24) => onTop(circleRing(cx, cy, r, steps), z, P, true);
  const key = (p: Point3) => depthOf(p, P);
  const xOf = (t: number) => X0 + (Math.max(0, Math.min(model.span, t)) / model.span) * (X1 - X0);

  // ---- base ----
  const FEET: [number, number][] = [
    [BASE.x + 16, BASE.y + 12],
    [BASE.x + BASE.w - 16, BASE.y + 12],
    [BASE.x + 16, BASE.y + BASE.d - 12],
    [BASE.x + BASE.w - 16, BASE.y + BASE.d - 12],
  ].sort((a, b) => key([a[0]!, a[1]!, 0]) - key([b[0]!, b[1]!, 0])) as [number, number][];
  const SCREWS: Flat[] = [
    [BASE.x + 7, BASE.y + 7],
    [BASE.x + BASE.w - 7, BASE.y + 7],
    [BASE.x + 7, BASE.y + BASE.d - 7],
    [BASE.x + BASE.w - 7, BASE.y + BASE.d - 7],
  ];
  const LABEL: Plan = { x: X1 + 14, y: 15, w: 24, d: 10, r: 2 };
  const base = {
    halo: slabOf(BASE, -14, 8, P).fill,
    feet: FEET.map(([x, y]) => [cyl(x, y, 6.4, -14, 1.6, 24), cyl(x, y, 4.8, -12.4, 4.4, 24)] as [SolidPaths, SolidPaths]),
    slab: solid(BASE, -8, 8, 8, 1.4),
    groove: planOutline(insetPlan(BASE, 4), 0, P),
    screws: SCREWS.map(([x, y]) => at([x, y, 0])),
    label: solid(LABEL, 0, 0.8, 4),
    labelLine: planOutline(insetPlan(LABEL, 1.4), 0.8, P),
    labelRule: [0, 1, 2].map((row) => onTop([[LABEL.x + 4.5, LABEL.y + 3 + row * 2.4], [LABEL.x + (row === 1 ? 15 : 21), LABEL.y + 3 + row * 2.4]], 0.8, P)).join(""),
    labelScrews: [at([LABEL.x + 2.4, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 2.4, LABEL.y + LABEL.d / 2, 0.8])],
  };

  // ---- one rail on two posts ----
  const railOf = (y: number, from: number, to: number) => {
    const plan: Plan = { x: from, y: y - 2.6, w: to - from, d: 5.2, r: 1.2 };
    const post = (x: number): Plan => ({ x: x - 2.6, y: y - 2.6, w: 5.2, d: 5.2, r: 0.8 });
    return {
      posts: [post(from + 5), post(to - 5)].map((p) => solid(p, 0, RAIL_Z, 3)),
      rail: solid(plan, RAIL_Z, RAIL_H, 4, 0.5),
      railSeam: sideSeam(plan, RAIL_Z + 1.2, P, 4),
    };
  };

  // ---- one peg (a stand-in call) ----
  const peg = (lane: number, n: number, t: number, x: number, y: number, nudged: boolean, mark: PegMark, answeredAt?: number): PegPart => {
    const z = RAIL_TOP;
    const capZ = z + PEG_H;
    const a = -0.55;
    const part: PegPart = {
      lane,
      n,
      t,
      at: [x, y, z],
      nudged,
      mark,
      foot: cyl(x, y, PEG_R + 0.6, z, 0.9),
      body: cyl(x, y, PEG_R, z + 0.9, PEG_H - 2),
      cap: cyl(x, y, PEG_R + 0.4, capZ - 1.1, 1.1),
      capRing: ring(x, y, PEG_R - 0.6, capZ),
      key: key([x, y, z]),
    };
    if (mark === "returned") part.dot = at([x, y, capZ]);
    if (mark === "threw") part.slash = seg([x + (PEG_R - 0.6) * Math.cos(a), y + (PEG_R - 0.6) * Math.sin(a), capZ], [x + (PEG_R - 0.6) * Math.cos(a + Math.PI), y + (PEG_R - 0.6) * Math.sin(a + Math.PI), capZ]);
    if (answeredAt !== undefined) {
      // A rib along the rail's front face, below its top (so no peg standing on the rail touches it), from the
      // call's moment to the answer's, ending on a stud.
      const x2 = Math.max(xOf(answeredAt), x + 3);
      part.bar = {
        paths: solid({ x, y: y + 2.6, w: x2 - x, d: 0.9, r: 0.3 }, RAIL_Z + 0.5, 1.8, 2),
        stud: solid({ x: x2 - 1.1, y: y + 2.6, w: 2.2, d: 1.6, r: 0.4 }, RAIL_Z + 0.2, 2.4, 2),
        t: answeredAt,
      };
    }
    return part;
  };

  // ---- the stand-in lanes ----
  let tooMany: string | null = null;
  if (lanesN > MAX_LANES) tooMany = `the run recorded ${lanesN} stand-ins; the bench has ${MAX_LANES} rails`;
  const lanes: LanePart[] = [];
  model.lanes.slice(0, MAX_LANES).forEach((l, i) => {
    const y = laneY(i);
    const xs = pegXs(
      l.calls.map((c) => c.t),
      xOf,
    );
    if (l.calls.length > MAX_PEGS || xs.some((p) => p.x > X1 + 1e-9)) {
      tooMany ??= `${l.name} was called ${l.calls.length} times at moments too close to stand apart on its rail`;
      return;
    }
    const r = railOf(y, X0 - 8, X1 + 8);
    lanes.push({
      index: i,
      name: l.name,
      y,
      ...r,
      caps: [X0 - 8, X1 + 8].map((x) => solid({ x: x - 1.2, y: y - 3.2, w: 2.4, d: 6.4, r: 0.6 }, RAIL_Z - 0.4, RAIL_H + 0.8, 3)),
      pegs: l.calls.map((c, k) => peg(i, c.n, c.t, xs[k]!.x, y, xs[k]!.nudged, c.answer, c.answer === "returned" ? c.answeredAt : undefined)),
      key: key([0, y, 0]),
    });
  });

  // ---- the function's own rail ----
  const fr = railOf(0, X0 - 16, END_STOP_X + 4);
  const START: Plan = { x: X0 - 13, y: -4, w: 9, d: 8, r: 1.2 };
  const STOP: Plan = { x: END_STOP_X - 2, y: -4.2, w: 4, d: 8.4, r: 0.8 };
  let end: TimelineGeometry["front"]["end"] = null;
  const e = model.end;
  if (e && e.kind !== "not_seen") {
    const x = e.kind === "still_running" ? END_STOP_X - 2 - 4.5 : Math.max(X0 + 4.5, xOf(e.t));
    const blockPlan: Plan = { x: x - 4.5, y: -3.6, w: 9, d: 7.2, r: 1 };
    const topZ = RAIL_TOP + 6;
    end = { kind: e.kind, t: e.t, block: solid(blockPlan, RAIL_TOP, 6, 4, 0.6) };
    if (e.kind === "returned") end.dot = at([x, 0, topZ]);
    if (e.kind === "threw") end.slash = seg([x - 4.5, -1.8, topZ], [x + 4.5, 1.8, topZ]); // edge to edge of the top face
    if (e.kind === "never_settled") end.ring = ring(x, 0, 2.2, topZ);
    if (e.kind === "still_running") end.bars = [-1.6, 1.6].map((dx) => seg([x + dx, -3.6, topZ], [x + dx, 3.6, topZ])).join("");
  }
  const front = {
    ...fr,
    start: solid(START, RAIL_TOP, 4, 4, 0.5),
    startDot: at([START.x + START.w / 2, 0, RAIL_TOP + 4]),
    stop: solid(STOP, RAIL_TOP, 7, 3),
    stopScrew: at([END_STOP_X, 0, RAIL_TOP + 7]),
    end,
  };

  // ---- the ruler (Atlas's virtual clock) and the sled ----
  const RULER: Plan = { x: X0 - 4, y: 12, w: X1 - X0 + 8, d: 7, r: 1 };
  const RZ = 0.7;
  const tick = (t: number, len: number) => seg([xOf(t), RULER.y + 0.01, RZ], [xOf(t), RULER.y + len, RZ]);
  const minor: string[] = [];
  const major: string[] = [];
  if (!model.allAtZero) {
    const step = model.ticks.minor;
    for (let k = 1; k * step <= model.span + 1e-9; k++) {
      const t = k * step;
      if (Math.abs(t / model.ticks.major - Math.round(t / model.ticks.major)) < 1e-9) major.push(tick(t, 3.6));
      else minor.push(tick(t, 1.8));
    }
  }
  const SLED: Plan = { x: -3.2, y: RULER.y - 1.2, w: 6.4, d: RULER.d + 2.4, r: 1 };
  const ruler = { strip: solid(RULER, 0, RZ, 3), minor: minor.join(""), major: major.join(""), zero: tick(0, 4.6) };
  const sled = {
    body: solid({ ...SLED, x: X0 + SLED.x }, RZ, 1.6, 3, 0.4),
    index: seg([X0, SLED.y, RZ + 1.6], [X0, SLED.y + SLED.d, RZ + 1.6]),
  };
  const sledAt = (t: number) => translateAlong(P, [xOf(t) - X0, 0, 0]);

  return { P, height, base, lanes, front, ruler, sled, xOf, sledAt, tooMany };
}

/** Every part the figure may draw, by name. The test checks the drawing against this list. */
export const PARTS = [
  "base-halo", "foot", "base-plate", "base-groove", "corner-screws", "label-plate",
  "lane-post", "lane-rail", "lane-cap", "peg", "answer-bar",
  "function-post", "function-rail", "start-block", "end-stop", "end-token",
  "ruler-strip", "ruler-ticks", "cursor-sled",
] as const;
export type PartName = (typeof PARTS)[number];
