// The retry machine's world layout and every static path, computed once at module load.
// World units are about 1 px; x and y lie on the bench, z is up. Built with the Anatomy kit
// (web/machines/iso/, MIT). Nothing here reads run data: geometry is the same for every run, and
// live.tsx moves parts by the states model.ts computes.
//
// The bench, back to front:
// - a dispatch station (left) with a cradle on top; above the cradle hangs the open mouth of the tube,
// - the tube rises to the far-end head, which joins it to the return chute,
// - the chute drops capsules onto the return rack; each one slides along the back lane to its slot,
// - in front: the rack's ruler (where the bettors' ghost markers sit), the wait drum on its stand,
//   and the retry lever in its gate on the station top.

import {
  circleRing,
  extrude,
  fitProjection,
  insetPlan,
  iso,
  onTop,
  pathOf,
  planOutline,
  sideArc,
  sideSeam,
  slabOf,
  topMatrix,
  topTicks,
  translateAlong,
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type Projection,
} from "../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 380;
export const AZIMUTH = 57;

// ---- layout ----
export const BASE: Plan = { x: -152, y: -52, w: 266, d: 112, r: 9 };
export const BASE_H = 9;
export const FOOT_H = 5;

export const STATION: Plan = { x: -136, y: -42, w: 70, d: 68, r: 4 };
export const STATION_TOP = 30;

export const TUBE: Plane = [-100, -22];
export const TUBE_R = 7;
export const TUBE_MOUTH = 46;
export const HEAD_Z = 96;
export const HEAD_H = 12;
export const HEAD: Plan = { x: -112, y: -42, w: 88, d: 32, r: 4 };

export const CHUTE: Plane = [-35, -22];
export const CHUTE_R = 7;
export const CHUTE_END = 36;

export const CAPSULE_R = 4.4;
export const CAPSULE_H = 12;
export const CRADLE_Z = STATION_TOP + 1.5;
export const RISE = 40;
export const FALL_FROM = 40;

export const RACK: Plan = { x: -50, y: -34, w: 150, d: 30, r: 4 };
export const RACK_TOP = 7;
export const LANE_Y = -22;
export const SLOT_Y = -12;
export const SLOT_STEP = 13;
/** Slot k (0 = the landing under the chute, 1 … 8 = the call slots). */
export const slotX = (k: number) => CHUTE[0] + SLOT_STEP * k;
export const SLOTS = 8;

export const RULER: Plan = { x: -42, y: -2, w: 118, d: 9, r: 1 };
export const RULER_Z = 0.6;

export const DRUM: Plane = [-106, 43];
export const DRUM_R = 14;
export const DRUM_Z = 4;
export const DRUM_H = 12;
export const DRUM_TOP = DRUM_Z + DRUM_H;
export const DRUM_STAND: Plan = { x: -124, y: 28, w: 58, d: 30, r: 4 };

export const LEVER: Plane = [-80, 4];
export const LEVER_TRAVEL = 13;

// ---- camera ----
const corners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P: Projection = fitProjection([...corners(BASE, -BASE_H - FOOT_H, 0), ...corners(HEAD, HEAD_Z, HEAD_Z + HEAD_H)], WIDTH, HEIGHT, { pad: 30, azimuth: AZIMUTH });
export const at = (p: Point3): Flat => iso(p, P);
export const move = (by: Point3) => translateAlong(P, by);
const RAD = Math.PI / 180;
const VIEW = AZIMUTH * RAD;

// ---- helpers ----
const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) => extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const ring = (cx: number, cy: number, r: number, z: number, steps = 36) => onTop(circleRing(cx, cy, r, steps), z, P, true);
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const arc = (cx: number, cy: number, r: number, z: number) => sideArc(cx, cy, r, z, P, 24);

/** Vertical knurl lines on the visible half of a cylinder, turned by `turn` radians. */
export function knurlAt(cx: number, cy: number, r: number, z0: number, z1: number, count: number, turn = 0) {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2;
    const facing = Math.cos(a) * Math.cos(VIEW) + Math.sin(a) * Math.sin(VIEW);
    if (facing < 0.12) continue;
    lines.push(seg([cx + r * Math.cos(a), cy + r * Math.sin(a), z0], [cx + r * Math.cos(a), cy + r * Math.sin(a), z1]));
  }
  return join(lines);
}

/** Radial ticks on a horizontal face, rooted on the ring of radius r, turned by `turn` radians. */
export function ticksAt(cx: number, cy: number, r: number, count: number, every: number, z: number, [minor, major]: [number, number], turn = 0) {
  const out = { minor: [] as string[], major: [] as string[] };
  for (let i = 0; i < count; i++) {
    const a = turn + (i / count) * Math.PI * 2;
    const big = i % every === 0;
    const len = big ? major : minor;
    const p0: Point3 = [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
    const p1: Point3 = [cx + (r - len) * Math.cos(a), cy + (r - len) * Math.sin(a), z];
    (big ? out.major : out.minor).push(seg(p0, p1));
  }
  return { minor: join(out.minor), major: join(out.major) };
}

// ---- base ----
const FEET: Plane[] = [
  [BASE.x + 18, BASE.y + 16],
  [BASE.x + BASE.w - 18, BASE.y + 16],
  [BASE.x + 18, BASE.y + BASE.d - 16],
  [BASE.x + BASE.w - 18, BASE.y + BASE.d - 16],
];
const SCREWS: Plane[] = [
  [BASE.x + 8, BASE.y + 8],
  [BASE.x + BASE.w - 8, BASE.y + 8],
  [BASE.x + 8, BASE.y + BASE.d - 8],
  [BASE.x + BASE.w - 8, BASE.y + BASE.d - 8],
];
const LABEL: Plan = { x: 40, y: 38, w: 34, d: 11, r: 2 };

const byDepth = (pts: Plane[]) => [...pts].sort((a, b) => a[0] * Math.cos(VIEW) + a[1] * Math.sin(VIEW) - (b[0] * Math.cos(VIEW) + b[1] * Math.sin(VIEW)));

export const BASE_ART = {
  halo: slabOf(BASE, -BASE_H - FOOT_H, BASE_H, P).fill,
  feet: byDepth(FEET).map(([x, y]) => [cyl(x, y, 7, -BASE_H - FOOT_H, 1.6, 28), cyl(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, 28)]),
  slab: slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6),
  groove: planOutline(insetPlan(BASE, 4.5), 0, P),
  screws: SCREWS.map(([x, y]) => at([x, y, 0])),
  screwRings: join(SCREWS.map(([x, y]) => ring(x, y, 2.2, 0, 16))),
  label: solid(LABEL, 0, 0.8, 4),
  labelLine: planOutline(insetPlan(LABEL, 1.6), 0.8, P),
  labelRule: join([0, 1, 2].map((row) => onTop([[LABEL.x + 6, LABEL.y + 3.2 + row * 1.8], [LABEL.x + (row === 1 ? 18 : 23), LABEL.y + 3.2 + row * 1.8]], 0.8, P))),
  labelScrews: [at([LABEL.x + 3, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d / 2, 0.8])],
};

// ---- masts (hold the tube, the chute and the head) ----
const CHUTE_MAST: Plan = { x: CHUTE[0] - 3, y: -41, w: 6, d: 6, r: 1 };
const CHUTE_MAST_FOOT: Plan = insetPlan(CHUTE_MAST, -3);
const TUBE_MAST: Plan = { x: TUBE[0] - 3, y: -41, w: 6, d: 6, r: 1 };
const TUBE_MAST_FOOT: Plan = insetPlan(TUBE_MAST, -2.5);

export const MAST_ART = {
  chuteFoot: solid(CHUTE_MAST_FOOT, 0, 2, 3),
  chuteFootScrews: [at([CHUTE_MAST_FOOT.x + 2, CHUTE_MAST_FOOT.y + CHUTE_MAST_FOOT.d - 2, 2]), at([CHUTE_MAST_FOOT.x + CHUTE_MAST_FOOT.w - 2, CHUTE_MAST_FOOT.y + CHUTE_MAST_FOOT.d - 2, 2])],
  chute: solid(CHUTE_MAST, 2, HEAD_Z - 2, 3),
  tubeFoot: solid(TUBE_MAST_FOOT, STATION_TOP, 1.6, 3),
  tube: solid(TUBE_MAST, STATION_TOP + 1.6, HEAD_Z - STATION_TOP - 1.6, 3),
};

// ---- dispatch station ----
const GATE: Plan = { x: LEVER[0] - 6, y: LEVER[1] - 5, w: 12, d: LEVER_TRAVEL + 10, r: 2 };
const GATE_SLOT: Plan = { x: LEVER[0] - 1.8, y: LEVER[1] - 2, w: 3.6, d: LEVER_TRAVEL + 4, r: 1.8 };
const COUNTER: Plan = { x: STATION.x + 8, y: 10, w: 40, d: 10, r: 2 };
export const COUNTER_Z = STATION_TOP + 0.8;
export const counterHole = (k: number): Point3 => [COUNTER.x + 5.5 + k * 4.1, COUNTER.y + COUNTER.d / 2, COUNTER_Z];
const STATION_SCREWS: Plane[] = [
  [STATION.x + 5, STATION.y + 5],
  [STATION.x + STATION.w - 5, STATION.y + 5],
  [STATION.x + 5, STATION.y + STATION.d - 5],
  [STATION.x + STATION.w - 5, STATION.y + STATION.d - 5],
];

export const STATION_ART = {
  cabinet: solid(STATION, 0, STATION_TOP, 6, 1),
  lidSeam: sideSeam(STATION, STATION_TOP - 5, P, 6),
  topGroove: planOutline(insetPlan(STATION, 3), STATION_TOP, P, 6),
  screws: STATION_SCREWS.map(([x, y]) => at([x, y, STATION_TOP])),
  cradle: cyl(TUBE[0], TUBE[1], 6.4, STATION_TOP, 1.5, 32),
  cradleSeat: ring(TUBE[0], TUBE[1], CAPSULE_R + 0.5, CRADLE_Z, 32),
  gate: solid(GATE, STATION_TOP, 1.2, 3),
  gateSlot: planOutline(GATE_SLOT, STATION_TOP + 1.2, P, 4),
  gateScrews: [at([GATE.x + GATE.w / 2, GATE.y + 2.2, STATION_TOP + 1.2]), at([GATE.x + GATE.w / 2, GATE.y + GATE.d - 2.2, STATION_TOP + 1.2])],
  counter: solid(COUNTER, STATION_TOP, 0.8, 4),
  counterHoles: join(Array.from({ length: SLOTS }, (_, k) => ring(counterHole(k)[0], counterHole(k)[1], 1.25, COUNTER_Z, 14))),
  counterHolePoints: Array.from({ length: SLOTS }, (_, k) => at(counterHole(k))),
};

/** The retry lever, built at rest; live.tsx slides it along +y by LEVER_TRAVEL × pull. */
export const LEVER_ART = {
  stem: cyl(LEVER[0], LEVER[1], 1.3, STATION_TOP + 1.2, 13, 16),
  collar: cyl(LEVER[0], LEVER[1], 2.1, STATION_TOP + 1.2, 1.4, 18),
  knob: cyl(LEVER[0], LEVER[1], 3.6, STATION_TOP + 14, 5, 28),
  knurl: knurlAt(LEVER[0], LEVER[1], 3.6, STATION_TOP + 14.5, STATION_TOP + 18.5, 22),
  cap: ring(LEVER[0], LEVER[1], 2.2, STATION_TOP + 19, 20),
};
export const leverAt = (pull: number) => move([0, LEVER_TRAVEL * pull, 0]);

// ---- tube, head and chute ----
const TUBE_CLAMPS = [62, 84];
const CHUTE_CLAMPS = [58, 80];
const clampBlock = (c: Plane, z: number): Plan => ({ x: c[0] - 2, y: -35, w: 4, d: 35 + c[1] - 6.6, r: 0.8 });

export const TUBE_ART = {
  collar: cyl(TUBE[0], TUBE[1], TUBE_R + 1.6, TUBE_MOUTH, 3, 40),
  body: cyl(TUBE[0], TUBE[1], TUBE_R, TUBE_MOUTH + 3, HEAD_Z - TUBE_MOUTH - 3, 40),
  seams: join([56, 74, 90].map((z) => arc(TUBE[0], TUBE[1], TUBE_R, z))),
  clampBlocks: TUBE_CLAMPS.map((z) => solid(clampBlock(TUBE, z), z - 2, 4, 2)),
  bands: TUBE_CLAMPS.map((z) => cyl(TUBE[0], TUBE[1], TUBE_R + 0.45, z - 1.1, 2.2, 40)),
  bandDots: TUBE_CLAMPS.map((z) => at([TUBE[0] + (TUBE_R + 0.45) * Math.cos(VIEW), TUBE[1] + (TUBE_R + 0.45) * Math.sin(VIEW), z])),
};

export const CHUTE_ART = {
  collar: cyl(CHUTE[0], CHUTE[1], CHUTE_R + 1.6, CHUTE_END - 3, 3, 40),
  body: cyl(CHUTE[0], CHUTE[1], CHUTE_R, CHUTE_END, HEAD_Z - CHUTE_END, 40),
  seams: join([50, 70, 88].map((z) => arc(CHUTE[0], CHUTE[1], CHUTE_R, z))),
  clampBlocks: CHUTE_CLAMPS.map((z) => solid(clampBlock(CHUTE, z), z - 2, 4, 2)),
  bands: CHUTE_CLAMPS.map((z) => cyl(CHUTE[0], CHUTE[1], CHUTE_R + 0.45, z - 1.1, 2.2, 40)),
  bandDots: CHUTE_CLAMPS.map((z) => at([CHUTE[0] + (CHUTE_R + 0.45) * Math.cos(VIEW), CHUTE[1] + (CHUTE_R + 0.45) * Math.sin(VIEW), z])),
};

const HEAD_SCREWS: Plane[] = [
  [HEAD.x + 5, HEAD.y + 5],
  [HEAD.x + HEAD.w - 5, HEAD.y + 5],
  [HEAD.x + 5, HEAD.y + HEAD.d - 5],
  [HEAD.x + HEAD.w - 5, HEAD.y + HEAD.d - 5],
];
const HEAD_LID: Plan = insetPlan(HEAD, 4);

export const HEAD_ART = {
  box: solid(HEAD, HEAD_Z, HEAD_H, 6, 1),
  seam: sideSeam(HEAD, HEAD_Z + 4, P, 6),
  lid: planOutline(HEAD_LID, HEAD_Z + HEAD_H, P, 6),
  screws: HEAD_SCREWS.map(([x, y]) => at([x, y, HEAD_Z + HEAD_H])),
};

// ---- return rack and ruler ----
const LANE: Plan = { x: CHUTE[0] - 7, y: LANE_Y - 5, w: slotX(SLOTS) - CHUTE[0] + 14, d: 10, r: 5 };
const STOPS: Plan[] = [
  { x: RACK.x + 3, y: RACK.y + 4, w: 4, d: RACK.d - 8, r: 1 },
  { x: RACK.x + RACK.w - 7, y: RACK.y + 4, w: 4, d: RACK.d - 8, r: 1 },
];

export const RACK_ART = {
  body: solid(RACK, 0, RACK_TOP, 6, 0.8),
  seam: sideSeam(RACK, 2.4, P, 6),
  lane: planOutline(LANE, RACK_TOP, P, 6),
  slots: join(Array.from({ length: SLOTS }, (_, k) => ring(slotX(k + 1), SLOT_Y, CAPSULE_R + 1.2, RACK_TOP, 28))),
  slotSteps: join(Array.from({ length: SLOTS }, (_, k) => planOutline({ x: slotX(k + 1) - 3, y: LANE_Y + 5, w: 6, d: SLOT_Y - LANE_Y - 5 - CAPSULE_R - 1.2 + 0.6, r: 0.8 }, RACK_TOP, P, 2))),
  stops: STOPS.map((s) => solid(s, RACK_TOP, 2.2, 3)),
  stopScrews: STOPS.map((s) => at([s.x + s.w / 2, s.y + s.d / 2, RACK_TOP + 2.2])),
};

const RULE_TICKS = topTicks(slotX(0), slotX(SLOTS), SLOT_STEP / 2, 2, RULER.y + 0.01, RULER_Z, [1.6, 3.2], P);

export const RULER_ART = {
  strip: solid(RULER, 0, RULER_Z, 3),
  minor: RULE_TICKS.minor,
  major: RULE_TICKS.major,
};
/** Where a ghost marker sits on the ruler: under call slot k; the person in the near row, models behind. */
export const ghostAt = (k: number, row: number): Flat => at([slotX(k), RULER.y + 4.2 + row * 3.4 - 1.2, RULER_Z]);

// ---- wait drum ----
const DRUM_INDEX: Plan = { x: DRUM[0] + DRUM_R + 1.2, y: DRUM[1] - 1.4, w: 4, d: 2.8, r: 0.6 };
const TURN_COUNTER: Plan = { x: DRUM_STAND.x + DRUM_STAND.w - 9, y: DRUM_STAND.y + 2.5, w: 5, d: DRUM_STAND.d - 5, r: 1.2 };
export const TURN_Z = DRUM_Z + 0.6;
export const turnHole = (k: number): Point3 => [TURN_COUNTER.x + TURN_COUNTER.w / 2, TURN_COUNTER.y + 2.6 + k * 3.2, TURN_Z];
const STAND_SCREWS: Plane[] = [
  [DRUM_STAND.x + 4, DRUM_STAND.y + 4],
  [DRUM_STAND.x + 4, DRUM_STAND.y + DRUM_STAND.d - 4],
];

export const DRUM_ART = {
  stand: solid(DRUM_STAND, 0, DRUM_Z, 6, 0.8),
  standScrews: STAND_SCREWS.map(([x, y]) => at([x, y, DRUM_Z])),
  hub: cyl(DRUM[0], DRUM[1], DRUM_R + 1.2, DRUM_Z, 1.6, 56),
  body: cyl(DRUM[0], DRUM[1], DRUM_R, DRUM_Z + 1.6, DRUM_H - 1.6, 64),
  band: arc(DRUM[0], DRUM[1], DRUM_R, DRUM_TOP - 4),
  rim: ring(DRUM[0], DRUM[1], DRUM_R - 1.6, DRUM_TOP, 64),
  centre: ring(DRUM[0], DRUM[1], 1.6, DRUM_TOP, 18),
  index: solid(DRUM_INDEX, DRUM_Z, 2.4, 2),
  counter: solid(TURN_COUNTER, DRUM_Z, 0.6, 3),
  counterHoles: join(Array.from({ length: SLOTS }, (_, k) => ring(turnHole(k)[0], turnHole(k)[1], 1.2, TURN_Z, 14))),
  counterHolePoints: Array.from({ length: SLOTS }, (_, k) => at(turnHole(k))),
};

/** The parts of the drum that turn, at `turns` turns (rebuilt per frame while it turns). */
export function drumAt(turns: number) {
  const a = turns * Math.PI * 2;
  const ticks = ticksAt(DRUM[0], DRUM[1], DRUM_R - 1.6, 30, 5, DRUM_TOP, [1.2, 2.4], a);
  const tip: Point3 = [DRUM[0] + (DRUM_R - 1.6) * Math.cos(a + Math.PI / 2), DRUM[1] + (DRUM_R - 1.6) * Math.sin(a + Math.PI / 2), DRUM_TOP];
  const root: Point3 = [DRUM[0] + 1.6 * Math.cos(a + Math.PI / 2), DRUM[1] + 1.6 * Math.sin(a + Math.PI / 2), DRUM_TOP];
  return {
    knurl: knurlAt(DRUM[0], DRUM[1], DRUM_R, DRUM_TOP - 3.6, DRUM_TOP - 0.4, 48, a),
    minor: ticks.minor,
    major: ticks.major,
    pointer: seg(root, tip),
    engraving: `${topMatrix(DRUM, DRUM_TOP, P, "x")} rotate(${((turns * 360) % 360).toFixed(2)}) translate(0 -4.6)`,
  };
}

// ---- the capsule, built at the origin; live.tsx places it with move() ----
export const CAPSULE_ART = {
  foot: cyl(0, 0, CAPSULE_R + 0.3, 0, 1.4, 28),
  body: cyl(0, 0, CAPSULE_R, 1.4, CAPSULE_H - 2.8, 28),
  cap: cyl(0, 0, CAPSULE_R + 0.3, CAPSULE_H - 1.4, 1.4, 28),
  seam: sideArc(0, 0, CAPSULE_R, CAPSULE_H / 2, P, 16),
  capRing: ring(0, 0, CAPSULE_R - 1.2, CAPSULE_H, 24),
  latch: [at([CAPSULE_R * Math.cos(VIEW), CAPSULE_R * Math.sin(VIEW), CAPSULE_H / 2 + 1.6])] as Flat[],
  /** A slash across the cap, rim to rim: the call threw. */
  threw: seg([(CAPSULE_R - 1.2) * Math.cos(-0.6), (CAPSULE_R - 1.2) * Math.sin(-0.6), CAPSULE_H], [(CAPSULE_R - 1.2) * Math.cos(Math.PI - 0.6), (CAPSULE_R - 1.2) * Math.sin(Math.PI - 0.6), CAPSULE_H]),
  /** A filled centre: the call returned a value. */
  returned: [at([0, 0, CAPSULE_H])] as Flat[],
};

/** World position of a capsule's foot for each place model.ts can put it in. */
export function capsuleWorld(where: { at: string; p?: number; appear?: number }, n: number): Point3 {
  const slot = Math.min(n, SLOTS);
  const p = where.p ?? 0;
  switch (where.at) {
    case "cradle":
      return [TUBE[0], TUBE[1], CRADLE_Z];
    case "rising":
      return [TUBE[0], TUBE[1], CRADLE_Z + RISE * p];
    case "falling":
      return [CHUTE[0], CHUTE[1], FALL_FROM + (RACK_TOP - FALL_FROM) * p];
    case "lane":
      return [slotX(0) + (slotX(slot) - slotX(0)) * p, LANE_Y, RACK_TOP];
    case "slot":
      return [slotX(slot), LANE_Y + (SLOT_Y - LANE_Y) * p, RACK_TOP];
    default:
      return [TUBE[0], TUBE[1], CRADLE_Z + RISE];
  }
}

/** Painter's key for a capsule at a world point: larger is nearer. */
export const depthKey = ([x, y, z]: Point3) => x * Math.cos(VIEW) + y * Math.sin(VIEW) + z * 0.001;

/**
 * Every part the figure draws, by name. The manifest test checks this list against the drawing
 * (every data-part in the art is listed here and every name here is drawn) and that no part is
 * named after something the code under test does not have.
 */
export const PARTS = [
  // base
  "base-halo", "base-plate", "base-groove", "foot-1", "foot-2", "foot-3", "foot-4", "corner-screws", "label-plate",
  // masts
  "chute-mast-foot", "chute-mast", "tube-mast-foot", "tube-mast",
  // dispatch station
  "station-cabinet", "station-lid-seam", "station-top-groove", "station-screws", "cradle", "cradle-seat",
  "lever-gate", "lever-gate-slot", "lever-gate-screws", "pull-counter", "pull-counter-holes", "pull-counter-marks",
  // return rack and ruler
  "return-rack", "rack-seam", "rack-lane", "rack-slots", "rack-slot-steps", "rack-stop-left", "rack-stop-right", "rack-stop-screws",
  "ruler-strip", "ruler-ticks", "ghost-markers",
  // capsules (one per call in the trace)
  "capsule",
  // tube
  "tube-collar", "tube", "tube-seams", "tube-clamp-low", "tube-clamp-high", "tube-band-low", "tube-band-high",
  // return chute
  "chute-collar", "return-chute", "chute-seams", "chute-clamp-low", "chute-clamp-high", "chute-band-low", "chute-band-high",
  // far-end head
  "far-end-head", "head-seam", "head-lid", "head-screws",
  // wait drum
  "drum-stand", "drum-stand-screws", "drum-hub", "wait-drum", "drum-knurl", "drum-band", "drum-rim", "drum-ticks", "drum-pointer", "drum-centre",
  "drum-engraving", "drum-index", "turn-counter", "turn-counter-holes", "turn-counter-marks",
  // retry lever
  "lever-collar", "lever-stem", "lever-knob", "lever-knurl", "lever-cap",
] as const;
export type PartName = (typeof PARTS)[number];

/** Names a part may never have: the code under test has none of these, so the machine draws none. */
export const FORBIDDEN_PART_WORDS = ["timer", "timeout", "clock", "abort", "backoff"] as const;
