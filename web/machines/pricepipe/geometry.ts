// The price pipe's world layout and every static path, computed once at module load.
// World units are about 1 px; x and y lie on the bench, z is up. Built with the Anatomy kit
// (web/machines/iso/, MIT). Nothing here reads run data: geometry is the same for every run, and
// live.tsx shows, hides and moves parts by the states model.ts computes.
//
// The bench, left to right:
// - two feed canisters (the inlets); each inlet duct's top is engraved with the feed it stands for;
//   a canister joins its flanged duct through a connector (an unused inlet is blanked);
// - the gear housing: both inlet ducts enter it; its top has a round slot where a multiply gear
//   sits when the run counted two price sources;
// - the outlet duct runs from the housing to the gauge;
// - the gauge on its pedestal: a log dial in USD, a price needle, a smaller reference needle,
//   and the bettors' ghost marks on the rim.

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
  type Flat,
  type Plan,
  type Plane,
  type Point3,
  type Projection,
} from "../iso/iso-kit";

export const WIDTH = 600;
export const HEIGHT = 360;
export const AZIMUTH = 57;

// ---- layout ----
export const BASE: Plan = { x: -150, y: -56, w: 282, d: 112, r: 9 };
export const BASE_H = 9;
export const FOOT_H = 5;

export const CANISTER_R = 9;
export const CANISTER_H = 40;
/** Inlet 0 (far) and inlet 1 (near). */
export const INLET_Y = [-33, 9] as const;
export const CANISTER_X = -120;
const DUCT_Z = 14;
const DUCT_H = 10;
const DUCT_D = 10;

export const HOUSING: Plan = { x: -62, y: -44, w: 48, d: 60, r: 4 };
export const HOUSING_TOP = 32;
export const SLOT: Plane = [-38, -14];
export const POCKET_R = 15;
export const GEAR_R = 11.5;
export const GEAR_TEETH = 14;
export const GEAR_Z = HOUSING_TOP;
export const GEAR_H = 5;

export const PEDESTAL: Plan = { x: 26, y: -46, w: 74, d: 72, r: 5 };
export const PEDESTAL_TOP = 12;
export const GAUGE: Plane = [63, -10];
export const CASE_R = 28;
export const CASE_TOP = PEDESTAL_TOP + 10;
export const BEZEL_R = 29.5;
export const FACE_Z = CASE_TOP + 3;
export const DIAL_R = 25;

// ---- camera ----
const corners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w]) for (const py of [y, y + d]) for (const z of [z0, z1]) out.push([px, py, z]);
  return out;
};

export const P: Projection = fitProjection(
  [...corners(BASE, -BASE_H - FOOT_H, 0), ...corners({ x: CANISTER_X - CANISTER_R, y: INLET_Y[0] - CANISTER_R, w: 2 * CANISTER_R, d: INLET_Y[1] - INLET_Y[0] + 2 * CANISTER_R, r: 0 }, 0, CANISTER_H + 6)],
  WIDTH,
  HEIGHT,
  { pad: 28, azimuth: AZIMUTH },
);
export const at = (p: Point3): Flat => iso(p, P);
const RAD = Math.PI / 180;
const VIEW = AZIMUTH * RAD;

// ---- helpers ----
const solid = (plan: Plan, z: number, h: number, steps = 4, bevel = 0) => slabOf(plan, z, h, P, steps, bevel);
const cyl = (cx: number, cy: number, r: number, z: number, h: number, steps = 32) => extrude(circleRing(cx, cy, r, steps), z, h, P, { convex: true });
const ring = (cx: number, cy: number, r: number, z: number, steps = 36) => onTop(circleRing(cx, cy, r, steps), z, P, true);
const seg = (a: Point3, b: Point3) => pathOf([at(a), at(b)]);
const join = (paths: string[]) => paths.filter(Boolean).join("");
const byDepth = (pts: Plane[]) => [...pts].sort((a, b) => a[0] * Math.cos(VIEW) + a[1] * Math.sin(VIEW) - (b[0] * Math.cos(VIEW) + b[1] * Math.sin(VIEW)));

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
const LABEL: Plan = { x: -40, y: 32, w: 34, d: 11, r: 2 };

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

// ---- the two inlets ----
export interface InletArt {
  /** Transform for the feed name engraved on the duct's top face. */
  labelAt: string;
  canisterFoot: ReturnType<typeof cyl>;
  canister: ReturnType<typeof cyl>;
  band: string;
  cap: ReturnType<typeof cyl>;
  capRing: string;
  knob: ReturnType<typeof cyl>;
  connector: ReturnType<typeof solid>;
  flange: ReturnType<typeof solid>;
  flangeBolts: Flat[];
  blank: ReturnType<typeof solid>;
  blankScrews: Flat[];
  duct: ReturnType<typeof solid>;
  ductSeam: string;
  /** Where the flow bead runs: canister top, along the connector and duct tops, into the housing. */
  route: Point3[];
}

function inletArt(y: number): InletArt {
  const connector: Plan = { x: CANISTER_X + CANISTER_R - 1.5, y: y - 3.5, w: -94 - (CANISTER_X + CANISTER_R - 1.5), d: 7, r: 1 };
  const flange: Plan = { x: -96, y: y - DUCT_D / 2 - 2, w: 3, d: DUCT_D + 4, r: 1 };
  const blank: Plan = { x: -100, y: y - DUCT_D / 2 - 1.5, w: 4, d: DUCT_D + 3, r: 1 };
  const duct: Plan = { x: -93, y: y - DUCT_D / 2, w: HOUSING.x - -93, d: DUCT_D, r: 1.5 };
  const top = DUCT_Z + DUCT_H;
  return {
    labelAt: topMatrix([duct.x + 12, y + 1], top, P, "x"),
    canisterFoot: cyl(CANISTER_X, y, CANISTER_R + 1.4, 0, 2, 40),
    canister: cyl(CANISTER_X, y, CANISTER_R, 2, CANISTER_H - 2, 40),
    band: sideArc(CANISTER_X, y, CANISTER_R, 12, P, 24) + sideArc(CANISTER_X, y, CANISTER_R, 30, P, 24),
    cap: cyl(CANISTER_X, y, CANISTER_R + 0.6, CANISTER_H, 2.4, 40),
    capRing: ring(CANISTER_X, y, CANISTER_R - 2.5, CANISTER_H + 2.4, 32),
    knob: cyl(CANISTER_X, y, 2.6, CANISTER_H + 2.4, 3, 20),
    connector: solid(connector, DUCT_Z + 1.5, DUCT_H - 3, 3),
    flange: solid(flange, DUCT_Z - 2, DUCT_H + 4, 3),
    flangeBolts: [at([flange.x + 1.5, flange.y + 1.6, top + 2]), at([flange.x + 1.5, flange.y + flange.d - 1.6, top + 2])],
    blank: solid(blank, DUCT_Z - 1.5, DUCT_H + 3, 3),
    blankScrews: [at([blank.x + 2, blank.y + 2, top + 1.5]), at([blank.x + 2, blank.y + blank.d - 2, top + 1.5])],
    duct: solid(duct, DUCT_Z, DUCT_H, 3),
    ductSeam: sideSeam(duct, DUCT_Z + 3, P, 3),
    route: [
      [CANISTER_X + CANISTER_R + 2, y, DUCT_Z + DUCT_H - 1.5],
      [-96, y, DUCT_Z + DUCT_H - 1.5],
      [-93, y, top],
      [HOUSING.x, y, top],
    ],
  };
}

export const INLET_ART = [inletArt(INLET_Y[0]), inletArt(INLET_Y[1])] as const;

// ---- the gear housing and its slot ----
const HOUSING_SCREWS: Plane[] = [
  [HOUSING.x + 5, HOUSING.y + 5],
  [HOUSING.x + HOUSING.w - 5, HOUSING.y + 5],
  [HOUSING.x + 5, HOUSING.y + HOUSING.d - 5],
  [HOUSING.x + HOUSING.w - 5, HOUSING.y + HOUSING.d - 5],
];

export const HOUSING_ART = {
  box: solid(HOUSING, 0, HOUSING_TOP, 6, 1),
  seam: sideSeam(HOUSING, HOUSING_TOP - 6, P, 6),
  screws: HOUSING_SCREWS.map(([x, y]) => at([x, y, HOUSING_TOP])),
  pocketFace: onTop(circleRing(SLOT[0], SLOT[1], POCKET_R, 48), HOUSING_TOP, P, true) + "",
  pocketRing: ring(SLOT[0], SLOT[1], POCKET_R, HOUSING_TOP, 48),
  pocketSeat: ring(SLOT[0], SLOT[1], POCKET_R - 2, HOUSING_TOP, 48),
};

/** A gear's outline in plan: GEAR_TEETH teeth around radius GEAR_R, turned by `turn` turns. */
export function gearRing(turn = 0, r = GEAR_R): Plane[] {
  const out: Plane[] = [];
  const n = GEAR_TEETH;
  const root = r - 2.2;
  for (let i = 0; i < n; i++) {
    const a0 = turn * Math.PI * 2 + (i / n) * Math.PI * 2;
    const step = (Math.PI * 2) / n;
    const pts: [number, number][] = [
      [a0, root],
      [a0 + step * 0.18, r],
      [a0 + step * 0.5, r],
      [a0 + step * 0.68, root],
    ];
    for (const [a, rr] of pts) out.push([SLOT[0] + rr * Math.cos(a), SLOT[1] + rr * Math.sin(a)]);
  }
  return out;
}

/** One tooth's plan (a convex quad standing on the root circle), tooth `i` at `turn` turns. */
function toothRing(i: number, turn: number): Plane[] {
  const step = (Math.PI * 2) / GEAR_TEETH;
  const a0 = turn * Math.PI * 2 + i * step;
  const root = GEAR_R - 2.2;
  const pts: [number, number][] = [
    [a0 - step * 0.02, root - 0.6],
    [a0 + step * 0.18, GEAR_R],
    [a0 + step * 0.5, GEAR_R],
    [a0 + step * 0.7, root - 0.6],
  ];
  return pts.map(([a, rr]) => [SLOT[0] + rr * Math.cos(a), SLOT[1] + rr * Math.sin(a)] as Plane);
}

/**
 * The gear at `turn` turns (rebuilt per frame while it turns): a disc at the root circle and 14
 * teeth, each a small convex prism. A tooth on the far side of the disc is painted before it, a
 * tooth on the near side after it (`near`).
 */
export function gearAt(turn: number) {
  const step = (Math.PI * 2) / GEAR_TEETH;
  const teeth = Array.from({ length: GEAR_TEETH }, (_, i) => {
    const mid = turn * Math.PI * 2 + (i + 0.34) * step;
    const near = Math.cos(mid) * Math.cos(VIEW) + Math.sin(mid) * Math.sin(VIEW) > 0;
    return { i, near, paths: extrude(toothRing(i, turn), GEAR_Z, GEAR_H, P, { convex: true }) };
  });
  return {
    body: cyl(SLOT[0], SLOT[1], GEAR_R - 2.2, GEAR_Z, GEAR_H, 48),
    teeth,
    hub: cyl(SLOT[0], SLOT[1], 3.4, GEAR_Z + GEAR_H, 1.6, 24),
    hubRing: ring(SLOT[0], SLOT[1], 1.4, GEAR_Z + GEAR_H + 1.6, 16),
    spokes: join([0, 1, 2].map((k) => {
      const a = turn * Math.PI * 2 + (k / 3) * Math.PI * 2;
      return seg([SLOT[0] + 3.4 * Math.cos(a), SLOT[1] + 3.4 * Math.sin(a), GEAR_Z + GEAR_H], [SLOT[0] + (GEAR_R - 4.6) * Math.cos(a), SLOT[1] + (GEAR_R - 4.6) * Math.sin(a), GEAR_Z + GEAR_H]);
    })),
    rim: ring(SLOT[0], SLOT[1], GEAR_R - 4.6, GEAR_Z + GEAR_H, 40),
  };
}

/** The dashed ghost: the outline a gear would have, lying in the empty slot. Not a part of the code. */
export const GHOST_OUTLINE = onTop(gearRing(0), HOUSING_TOP, P, true);

// ---- outlet duct and the gauge ----
const OUTLET: Plan = { x: HOUSING.x + HOUSING.w, y: -15, w: GAUGE[0] - CASE_R + 4 - (HOUSING.x + HOUSING.w), d: 9, r: 1.5 };
const OUTLET_Z = 13;
const OUTLET_H = 9;
const COLLAR: Plan = { x: HOUSING.x + HOUSING.w, y: OUTLET.y - 2, w: 3, d: OUTLET.d + 4, r: 1 };
const PEDESTAL_SCREWS: Plane[] = [
  [PEDESTAL.x + 5, PEDESTAL.y + 5],
  [PEDESTAL.x + PEDESTAL.w - 5, PEDESTAL.y + 5],
  [PEDESTAL.x + 5, PEDESTAL.y + PEDESTAL.d - 5],
  [PEDESTAL.x + PEDESTAL.w - 5, PEDESTAL.y + PEDESTAL.d - 5],
];

export const OUTLET_ART = {
  duct: solid(OUTLET, OUTLET_Z, OUTLET_H, 3),
  seam: sideSeam(OUTLET, OUTLET_Z + 3, P, 3),
  collar: solid(COLLAR, OUTLET_Z - 2, OUTLET_H + 4, 3),
  collarBolts: [at([COLLAR.x + 1.5, COLLAR.y + 1.6, OUTLET_Z + OUTLET_H + 2]), at([COLLAR.x + 1.5, COLLAR.y + COLLAR.d - 1.6, OUTLET_Z + OUTLET_H + 2])],
  route: [
    [OUTLET.x + 3, OUTLET.y + OUTLET.d / 2, OUTLET_Z + OUTLET_H],
    [GAUGE[0] - CASE_R - 1, OUTLET.y + OUTLET.d / 2, OUTLET_Z + OUTLET_H],
  ] as Point3[],
};

export const PEDESTAL_ART = {
  box: solid(PEDESTAL, 0, PEDESTAL_TOP, 6, 1),
  seam: sideSeam(PEDESTAL, 4, P, 6),
  screws: PEDESTAL_SCREWS.map(([x, y]) => at([x, y, PEDESTAL_TOP])),
};

// Dial: a log scale swept clockwise (as seen) through 270°, from the lower left to the lower right.
// Screen "up" is the world direction away from the viewer; on this camera a larger world angle turns clockwise on screen.
const UP = Math.atan2(-Math.sin(VIEW), -Math.cos(VIEW));
const SWEEP = 270 * RAD;
/** World angle of dial position `p` (0 … 1). */
export const dialAngle = (p: number) => UP - SWEEP / 2 + p * SWEEP;
const polar = (r: number, a: number, z: number): Point3 => [GAUGE[0] + r * Math.cos(a), GAUGE[1] + r * Math.sin(a), z];

function dialTicks() {
  const minor: string[] = [];
  const major: string[] = [];
  const decades = 6;
  for (let d = 0; d <= decades; d++) {
    const a = dialAngle(d / decades);
    major.push(seg(polar(DIAL_R - 3.6, a, FACE_Z), polar(DIAL_R, a, FACE_Z)));
    if (d === decades) break;
    for (const k of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const p = (d + Math.log10(k)) / decades;
      const len = k === 5 ? 2.8 : 1.6;
      minor.push(seg(polar(DIAL_R - len, dialAngle(p), FACE_Z), polar(DIAL_R, dialAngle(p), FACE_Z)));
    }
  }
  return { minor: join(minor), major: join(major) };
}
const TICKS = dialTicks();

/** The decade numerals on the dial face: where each sits and what it says. */
export const DIAL_NUMERALS = ["0.01", "0.1", "1", "10", "100", "1k", "10k"].map((text, d) => {
  const [x, y] = [GAUGE[0] + (DIAL_R - 6.6) * Math.cos(dialAngle(d / 6)), GAUGE[1] + (DIAL_R - 6.6) * Math.sin(dialAngle(d / 6))];
  return { text, transform: `${topMatrix([x, y], FACE_Z, P, "x")} translate(0 0.7)` };
});

export const GAUGE_ART = {
  case: cyl(GAUGE[0], GAUGE[1], CASE_R, PEDESTAL_TOP, CASE_TOP - PEDESTAL_TOP, 64),
  caseSeam: sideArc(GAUGE[0], GAUGE[1], CASE_R, PEDESTAL_TOP + 4, P, 40),
  bezel: cyl(GAUGE[0], GAUGE[1], BEZEL_R, CASE_TOP, FACE_Z - CASE_TOP, 64),
  faceRing: ring(GAUGE[0], GAUGE[1], DIAL_R + 2.2, FACE_Z, 64),
  dialRing: ring(GAUGE[0], GAUGE[1], DIAL_R, FACE_Z, 72),
  minor: TICKS.minor,
  major: TICKS.major,
  engraving: `${topMatrix([GAUGE[0] + 9, GAUGE[1] + 7], FACE_Z, P, "x")}`,
  hub: cyl(GAUGE[0], GAUGE[1], 2.4, FACE_Z, 1.8, 24),
  hubDot: [at([GAUGE[0], GAUGE[1], FACE_Z + 1.8])] as Flat[],
};

/** A needle from the hub to radius `len` at dial position `p` (0 … 1). */
export const needleAt = (p: number, len: number) => seg(polar(0, dialAngle(p), FACE_Z + 0.9), polar(len, dialAngle(p), FACE_Z + 0.9));
export const PRICE_NEEDLE_LEN = DIAL_R - 2;
export const REF_NEEDLE_LEN = DIAL_R - 9;
/** Where a ghost bet mark sits: on the face ring, just outside the ticks (row 0 person, 1 model). */
export const ghostAt = (p: number, row: number): Flat => at(polar(DIAL_R + 1.1 + row * 0.01, dialAngle(p), FACE_Z));

/** A point along a route at progress `p` (0 … 1), by length. */
export function along(route: Point3[], p: number): Flat {
  const lens = route.slice(1).map((b, i) => Math.hypot(b[0] - route[i]![0], b[1] - route[i]![1], b[2] - route[i]![2]));
  const total = lens.reduce((a, l) => a + l, 0);
  let left = Math.max(0, Math.min(1, p)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i]! || i === lens.length - 1) {
      const t = lens[i]! ? Math.min(1, left / lens[i]!) : 0;
      const a = route[i]!;
      const b = route[i + 1]!;
      return at([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    left -= lens[i]!;
  }
  return at(route[route.length - 1]!);
}

/**
 * Every part the figure can draw, by name. The manifest test checks this list against the drawings
 * (every data-part drawn is listed; across the gear, dashed and blank cases every listed part is
 * drawn) and that no part is named after a judgement of the code.
 */
export const PARTS = [
  // base
  "base-halo", "base-plate", "base-groove", "foot-1", "foot-2", "foot-3", "foot-4", "corner-screws", "label-plate",
  // inlet 1 (far) and inlet 2 (near)
  "inlet-1-label", "feed-1-canister-foot", "feed-1-canister", "feed-1-bands", "feed-1-cap", "feed-1-knob", "feed-1-connector", "inlet-1-flange", "inlet-1-duct",
  "inlet-2-label", "feed-2-canister-foot", "feed-2-canister", "feed-2-bands", "feed-2-cap", "feed-2-knob", "feed-2-connector", "inlet-2-flange", "inlet-2-duct", "inlet-2-blank-plate",
  // gear housing and slot
  "gear-housing", "housing-seam", "housing-screws", "slot-pocket", "slot-seat", "slot-ghost-outline", "multiply-gear", "gear-spokes", "gear-hub",
  // outlet
  "outlet-collar", "outlet-duct", "flow-bead",
  // gauge
  "gauge-pedestal", "pedestal-seam", "pedestal-screws", "gauge-case", "gauge-bezel", "dial-face", "dial-ticks", "dial-numerals", "dial-engraving", "ghost-bet-marks", "reference-needle", "price-needle", "needle-hub",
] as const;
export type PartName = (typeof PARTS)[number];
