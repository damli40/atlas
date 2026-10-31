// R3: the export backend, Node only. Draws the same Scene in the fork's pencil engine (per-pixel ink and coloured pencil on
// simulated paper) to a PNG, for proof cards, the README and the film. Slow on purpose: not for the live page.
//
// Optional: @napi-rs/canvas is a dev dependency and is loaded only when this runs, so the server and the production image
// never need it. If it is missing, `drawPlate` says so plainly.

import { createRequire } from "node:module";
import { layOut } from "../layout";
import { resample, trim, type Pt } from "../hand";
import type { Scene, SceneNode, TextBlock } from "../scene";
import { assertSpec, type RenderSpec } from "../spec";

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const K = 5; // Scene px per mm of paper
const INK = "#1f1b1d";
const RED = "#a8443b";

export class ExportUnavailable extends Error {}

/** The engine's three modules, or a plain refusal when the optional dependency is not installed. */
function engine(): { plate: Any; D: Any; Lt: Any } {
  try {
    return { plate: require("./engine/lib/storybook").plate, D: require("./engine/lib/draw"), Lt: require("./engine/lib/letter") };
  } catch (e) {
    throw new ExportUnavailable(`the pencil export needs the optional package @napi-rs/canvas: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const mm = (v: number) => v / K;
const pinColour = { red: "#b93a30", ochre: "#d9a441", blue: "#5f8fb0" } as const;

export interface PlateOptions {
  out: string;
  /** Pixels per mm: 10 is full quality (about 2× the Scene's px), 5 a quick look. */
  ppm?: number;
}

function words(P: Any, Lt: Any, b: TextBlock | null, colour = INK): void {
  if (!b) return;
  for (const l of b.lines) Lt.write(P.S, l.text, mm(l.x), mm(l.y), { face: b.face === "italic" ? "italic" : "serif", size: mm(b.size), color: colour, spacing: b.face === "italic" ? 0.012 : 0.022 });
}

function ticket(P: Any, D: Any, Lt: Any, n: SceneNode): void {
  const x0 = mm(n.box.x0);
  const x1 = mm(n.box.x1);
  const y0 = mm(n.box.y0);
  const y1 = mm(n.box.y1);
  const R = P.R;
  const zig: Pt[] = [];
  const teeth = Math.max(6, Math.round((x1 - x0) / 2.2));
  for (let i = 0; i <= teeth; i++) zig.push([x1 - ((x1 - x0) * i) / teeth, y1 - (i % 2 ? 0 : 1.1) + R.range(-0.15, 0.15)]);
  const shape = [[x0, y0], [x1, y0], ...zig];
  P.hatch([D.tf(shape, { x: 1.1, y: 1.3 })], { cut: [shape], angle: 45, pitch: 0.45, nib: 0.1, color: "#4d4448" });
  P.paper([shape]);
  P.colour([shape], "#fdfaf2", { pressure: 0.45, passes: 1 });
  P.colour([shape], "#efe3c8", { pressure: 0.4, passes: 1, cut: [D.rrect(x0 + 1.3, y0 + 1.3, x1 - 1.3, y1 - 2.2, 0.6)] });
  P.outline([shape], { nib: 0.32 });
  P.ink([[x0 + 1.6, y0 + 3.7], [x1 - 1.6, y0 + 3.7]], { nib: 0.09, color: RED });
  words(P, Lt, n.small, RED);
  const pin: Pt = [mm(n.pivot[0]), mm(n.pivot[1])];
  P.hatch([D.ell(pin[0] + 0.9, pin[1] + 1.2, 1.7, 1.0)], { angle: 30, pitch: 0.4, nib: 0.09, color: "#4d4448" });
  P.paper([D.ell(pin[0], pin[1], 1.7, 1.7)]);
  P.colour([D.ell(pin[0], pin[1], 1.7, 1.7)], pinColour[n.pin], { pressure: 0.9, passes: 2 });
  P.outline([D.ell(pin[0], pin[1], 1.7, 1.7)], { nib: 0.2 });
  P.paper([D.ell(pin[0] - 0.55, pin[1] - 0.6, 0.45, 0.32, -0.6)]);
  words(P, Lt, n.text);
}

function box(P: Any, D: Any, Lt: Any, n: SceneNode, tone: string): void {
  const x0 = mm(n.box.x0);
  const x1 = mm(n.box.x1);
  const y0 = mm(n.box.y0);
  const y1 = mm(n.box.y1);
  const shape = D.rrect(x0, y0, x1, y1, 1.4);
  if (n.missing) {
    const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]] as Pt[];
    const pts = resample(p, 1.6);
    for (let i = 0; i + 1 < pts.length; i += 2) P.ink([pts[i], pts[i + 1]], { nib: 0.22, color: RED });
    words(P, Lt, n.text);
    return;
  }
  P.hatch([D.tf(shape, { x: 1.1, y: 1.3 })], { cut: [shape], angle: 45, pitch: 0.45, nib: 0.1, color: "#4d4448" });
  P.paper([shape]);
  P.colour([shape], tone, { pressure: 0.55, angle: 33, passes: 1 });
  P.outline([shape], { nib: 0.3 });
  if (n.kind === "device") {
    const lx = x1 - 4.2;
    const ly = (y0 + y1) / 2;
    P.paper([D.ell(lx, ly, 1.9, 1.9)]);
    P.outline([D.ell(lx, ly, 1.9, 1.9)], { nib: 0.2 });
    P.outline([D.ell(lx, ly, 1.3, 1.3)], { nib: 0.12 });
  }
  words(P, Lt, n.text);
}

function clock(P: Any, D: Any, Lt: Any, n: SceneNode): void {
  const cx = mm((n.box.x0 + n.box.x1) / 2);
  const cy = mm((n.box.y0 + n.box.y1) / 2);
  const r = 5;
  P.hatch([D.ell(cx + 0.8, cy + 1, r, r)], { cut: [D.ell(cx, cy, r, r)], angle: 45, pitch: 0.45, nib: 0.1, color: "#4d4448" });
  P.paper([D.ell(cx, cy, r, r)]);
  P.outline([D.ell(cx, cy, r, r)], { nib: 0.3 });
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const r0 = r - (i % 3 === 0 ? 1.2 : 0.7);
    P.ink([[cx + Math.sin(t) * r0, cy - Math.cos(t) * r0], [cx + Math.sin(t) * (r - 0.2), cy - Math.cos(t) * (r - 0.2)]], { nib: 0.09 });
  }
  const a = n.sweep * Math.PI * 2;
  P.ink([[cx, cy], [cx + Math.sin(a) * (r - 1.2), cy - Math.cos(a) * (r - 1.2)]], { nib: 0.26 });
  P.dot(cx, cy, 0.4);
  words(P, Lt, n.text);
}

function arrowHead(P: Any, tip: Pt, ang: number, len: number, color: string): void {
  const wing = len * 0.42;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const pt = (u: number, v: number): Pt => [tip[0] - u * c - v * s, tip[1] - u * s + v * c];
  const head = [pt(0, 0), pt(len, wing), pt(len * 0.62, 0), pt(len, -wing)];
  P.colour([head], color, { passes: 2, pressure: 0.95 });
  P.outline([head], { nib: 0.2, color });
}

/** Draws the spec to `o.out` and returns the Scene it drew. */
export async function drawPlate(spec: RenderSpec, o: PlateOptions): Promise<Scene> {
  assertSpec(spec);
  if (spec.notShown !== undefined) throw new Error(`nothing may be drawn: ${spec.notShown}`);
  const { plate, D, Lt } = engine();
  const scene = layOut(spec);
  const w = Math.ceil(scene.width / K);
  const h = Math.ceil(scene.height / K);
  const ppm = Math.min(o.ppm ?? 10, Math.sqrt(18e6 / (w * h)));
  const P = plate({ id: "atlas", w, h, ppm, seed: spec.seed, paper: "hotpress" });
  words(P, Lt, scene.kicker, "#5d5650");
  words(P, Lt, scene.title);
  words(P, Lt, scene.subtitle);
  for (const r of scene.regions) {
    P.outline([D.rrect(mm(r.box.x0), mm(r.box.y0), mm(r.box.x1), mm(r.box.y1), 2.4)], { nib: 0.14, color: "#5d5650" });
    words(P, Lt, r.label, "#5d5650");
  }
  const sorted = [...scene.edges].sort((a, b) => Number(a.onPath) - Number(b.onPath));
  for (const e of sorted) {
    const pts = e.pts.map((p) => [mm(p[0]), mm(p[1])] as Pt);
    const thread = e.kind === "thread";
    if (!thread) {
      const d = resample(pts, 0.9);
      for (let i = 0; i + 1 < d.length; i += 2) P.ink([d[i], d[i + 1]], { nib: 0.14, color: "#5d5650" });
      continue;
    }
    const color = e.onPath ? RED : "#2c2628";
    const nib = e.onPath ? 0.46 : Math.min(0.72, 0.24 + 0.08 * Math.sqrt(Math.max(0, e.weight - 1)));
    const stem = trim(pts, 0, 1.2);
    P.ink(stem, { nib, tremor: 0.7, color });
    const end = pts[pts.length - 1]!;
    const prev = pts[Math.max(0, pts.length - 3)]!;
    arrowHead(P, end, Math.atan2(end[1] - prev[1], end[0] - prev[0]), e.onPath ? 3 : 2.3, color);
  }
  for (const n of scene.nodes) {
    if (n.kind === "ticket") ticket(P, D, Lt, n);
    else if (n.kind === "clock") clock(P, D, Lt, n);
    else if (n.kind === "device") box(P, D, Lt, n, "#b9d0de");
    else if (n.kind === "deck") box(P, D, Lt, n, "#e3c98e");
    else box(P, D, Lt, n, "#fbf3dc");
  }
  for (const e of scene.edges) words(P, Lt, e.label);
  for (const m of scene.marks) {
    const n = scene.nodes.find((x) => x.id === m.on)!;
    const b = n.box;
    const cx = mm((b.x0 + b.x1) / 2);
    const cy = mm((b.y0 + b.y1) / 2);
    const ring = (extra: number): Pt[] => {
      const rx = mm((b.x1 - b.x0) / 2 + 17 + extra);
      const ry = mm((b.y1 - b.y0) / 2 + 17 + extra);
      const sg = (v: number) => Math.sign(v) * Math.abs(v) ** 0.66;
      return Array.from({ length: 72 }, (_, i) => [cx + sg(Math.cos((i / 72) * Math.PI * 2)) * rx, cy + sg(Math.sin((i / 72) * Math.PI * 2)) * ry] as Pt);
    };
    if (m.kind === "didnt-match") P.outline([ring(0)], { nib: 0.44, color: "#b93a30" });
    if (m.kind === "cant-check") {
      const d = resample([...ring(9), ring(9)[0]!], 1.5);
      for (let i = 0; i + 1 < d.length; i += 2) P.ink([d[i], d[i + 1]], { nib: 0.16, color: "#5d5650" });
    }
    if (m.kind === "matched") P.ink([[mm(b.x1) - 1.6, mm(b.y0) + 0.4], [mm(b.x1) - 0.6, mm(b.y0) + 1.8], [mm(b.x1) + 2.2, mm(b.y0) - 2.2]], { nib: 0.5, color: "#5f8fb0" });
    words(P, Lt, m.words, m.kind === "didnt-match" ? RED : INK);
  }
  for (const t of scene.tags) words(P, Lt, t, "#8a6420");
  for (const c of scene.captions) words(P, Lt, c, "#5d5650");
  await P.finish(o.out);
  return scene;
}
