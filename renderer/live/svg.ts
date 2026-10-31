// R3: Scene → SVG text, in the look of statechart-art's plates: warm paper, ink with a hand wobble, pencil hatching,
// pinned tickets, a red thread, arrows that stop short, words on clean paper. Technique ported from the fork's
// tools/lib/tagchart.js and tools/lib/draw.js (MIT, Kevin T. Ngo); no picture, character or font of theirs is used.
//
// Plain words: every colour is a CSS variable, so dark mode is a change of paper and not a redraw. Every part carries a
// data attribute the player and the checks read. All text passes through `esc`, and no script, link or foreign object is
// ever written, so a hostile name cannot run or navigate.
// Pure: no DOM, no clock. The same scene gives the same text.

import { handLine, hatchPath, inkPoly, linePath, ribbon, rng, TAU, type Pt, type Rng } from "../hand";
import type { Box, Scene, SceneEdge, SceneMark, SceneNode, SceneRegion, TextBlock } from "../scene";
import { CLOCK_R } from "../layout";
import { esc, idAttr } from "../words";

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

function textSvg(b: TextBlock, cls = ""): string {
  const face = b.face === "italic" ? "rr-i" : "rr-r";
  return b.lines.map((l) => `<text class="rr-t ${face} ${cls}" x="${n1(l.x)}" y="${n1(l.y)}" font-size="${b.size}">${esc(l.text)}</text>`).join("");
}

/** Short diagonal pen ticks along the right and bottom edges: the plate's hand-hatched drop shadow. */
function shadowTicks(b: Box, R: Rng, dx = 7, dy = 8, pitch = 3.1): string {
  let d = "";
  for (let x = b.x0 + 8; x < b.x1 + dx - 1; x += pitch * R.range(0.8, 1.2)) {
    const j = R.range(-0.8, 1);
    d += `M${n1(x)} ${n1(b.y1 + 0.5)}l${n1(dx * 0.8 + j)} ${n1(dy + j)}`;
  }
  for (let y = b.y0 + 9; y < b.y1; y += pitch * R.range(0.8, 1.2)) {
    const j = R.range(-0.8, 1);
    d += `M${n1(b.x1 + 0.5)} ${n1(y)}l${n1(dx + j)} ${n1(dy * 0.8 + j)}`;
  }
  return `<path class="rr-tick" d="${d}"/>`;
}

function ell(cx: number, cy: number, rx: number, ry = rx, n = 28): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return out;
}

function rrect(b: Box, r: number, n = 5): Pt[] {
  const rr = Math.min(r, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2);
  const out: Pt[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= n; i++) {
      const t = a0 + (i / n) * (Math.PI / 2);
      out.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]);
    }
  };
  corner(b.x1 - rr, b.y0 + rr, -Math.PI / 2);
  corner(b.x1 - rr, b.y1 - rr, 0);
  corner(b.x0 + rr, b.y1 - rr, Math.PI / 2);
  corner(b.x0 + rr, b.y0 + rr, Math.PI);
  return out;
}

const fillOf = (poly: readonly Pt[], cls: string) => `<path class="${cls}" d="${linePath(poly)}Z"/>`;

/** One round hand-inked ring: goes a little past where it started, as a pen does. */
function ringInk(cx: number, cy: number, r: number, R: Rng, width: number, ry = r): string {
  const start = R() * TAU;
  const turn = 1 + R.range(0.015, 0.07);
  const n = Math.max(14, Math.round(r * 1.4));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * turn * TAU;
    const k = 1 + 0.012 * Math.sin(t * 2 + start) + R.range(-0.004, 0.004);
    pts.push([cx + Math.cos(t) * r * k, cy + Math.sin(t) * ry * k]);
  }
  return `<path class="rr-ink" d="${ribbon(pts, width, R)}"/>`;
}

function pinSvg(cx: number, cy: number, colour: string, R: Rng): string {
  const r = 8.6;
  return (
    `<g class="rr-pin" data-pin="${colour}">` +
    `<path class="rr-tick" d="${hatchPath(ell(cx + 3.2, cy + 5, r * 0.95, r * 0.55, 14), R, { angle: 28, pitch: 1.9 })}"/>` +
    `<circle class="rr-pin-paper" cx="${n1(cx)}" cy="${n1(cy)}" r="${r}"/>` +
    `<circle class="rr-pin-${colour}" cx="${n1(cx)}" cy="${n1(cy)}" r="${r - 0.4}"/>` +
    `<path class="rr-pin-shade" d="${hatchPath(ell(cx + 1.2, cy + 1.6, r * 0.72, r * 0.72, 14), R, { angle: 40, pitch: 1.7 })}"/>` +
    ringInk(cx, cy, r, R, 1.1) +
    `<ellipse class="rr-pin-glint" cx="${n1(cx - 2.8)}" cy="${n1(cy - 3.1)}" rx="2.3" ry="1.5" transform="rotate(-32 ${n1(cx - 2.8)} ${n1(cy - 3.1)})"/>` +
    `</g>`
  );
}

function ticket(n: SceneNode, R: Rng): string {
  const b = n.box;
  const teeth = Math.max(6, Math.round((b.x1 - b.x0) / 11));
  const zig: Pt[] = [];
  for (let i = 0; i <= teeth; i++) zig.push([b.x1 - ((b.x1 - b.x0) * i) / teeth, b.y1 - (i % 2 ? 0 : 6.4) + R.range(-0.7, 0.7)]);
  const shape: Pt[] = [[b.x0, b.y0], [b.x1, b.y0], ...zig];
  const inset = 6.5;
  const bands: Pt[][] = [
    [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y0 + inset], [b.x0, b.y0 + inset]],
    [[b.x0, b.y1 - inset - 6], [b.x1, b.y1 - inset - 6], [b.x1, b.y1 - 5], [b.x0, b.y1 - 5]],
    [[b.x0, b.y0], [b.x0 + inset, b.y0], [b.x0 + inset, b.y1 - 5], [b.x0, b.y1 - 5]],
    [[b.x1 - inset, b.y0], [b.x1, b.y0], [b.x1, b.y1 - 5], [b.x1 - inset, b.y1 - 5]],
  ];
  const band = bands.map((p, i) => hatchPath(p, R, { angle: i < 2 ? 62 : 28, pitch: 1.8 })).join("");
  const ruleY = b.y0 + 18.5;
  const rule = handLine([[b.x0 + 9, ruleY], [b.x1 - 9, ruleY + R.range(-0.5, 0.5)]], R, { bow: 0.3, tremor: 0.5, step: 7 });
  return (
    shadowTicks({ ...b, y1: b.y1 - 1 }, R) +
    fillOf(shape, "rr-card") +
    `<path class="rr-pencil rr-pencil-cream" d="${band}"/>` +
    `<path class="rr-rule" d="${ribbon(rule, 0.8, R)}"/>` +
    `<path class="rr-ink" d="${inkPoly([[b.x0, b.y1 - 5], [b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1 - 5]], R, 1.55, { closed: false, bow: 0.35, tremor: 0.75 })}"/>` +
    `<path class="rr-ink" d="${ribbon(handLine(zig.map((p) => p), R, { bow: 0.1, tremor: 0.3, smooth: 0.6, step: 2.6 }), 1.25, R)}"/>` +
    (n.small ? textSvg(n.small, "rr-small") : "") +
    textSvg(n.text) +
    pinSvg(n.pivot[0], n.pivot[1], n.pin, R)
  );
}

function device(n: SceneNode, R: Rng): string {
  const b = n.box;
  const shape = rrect(b, 7);
  const lampX = b.x1 - 21;
  const lampY = (b.y0 + b.y1) / 2;
  const screws = [[b.x0 + 8, b.y0 + 8], [b.x1 - 8, b.y0 + 8], [b.x0 + 8, b.y1 - 8], [b.x1 - 8, b.y1 - 8]] as const;
  return (
    shadowTicks(b, R) +
    fillOf(shape, "rr-card") +
    `<path class="rr-pencil rr-pencil-blue" d="${hatchPath(shape, R, { angle: 33, pitch: 3 })}"/>` +
    `<path class="rr-ink" d="${inkPoly(shape.filter((_, i) => i % 2 === 0), R, 1.45, { bow: 0.2, tremor: 0.5, over: 0.2 })}"/>` +
    screws.map(([x, y]) => `<circle class="rr-screw" cx="${n1(x)}" cy="${n1(y)}" r="1.2"/>`).join("") +
    `<circle class="rr-lamp-base" cx="${n1(lampX)}" cy="${n1(lampY)}" r="9.4"/>` +
    `<circle class="rr-lamp" cx="${n1(lampX)}" cy="${n1(lampY)}" r="6.8"/>` +
    ringInk(lampX, lampY, 9.4, R, 1.05) +
    ringInk(lampX, lampY, 6.8, R, 0.7) +
    textSvg(n.text)
  );
}

function clock(n: SceneNode, R: Rng): string {
  const b = n.box;
  const r = CLOCK_R;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * TAU;
    const r0 = r - (i % 3 === 0 ? 6.2 : 3.6);
    ticks += `M${n1(cx + Math.sin(t) * r0)} ${n1(cy - Math.cos(t) * r0)}L${n1(cx + Math.sin(t) * (r - 1.2))} ${n1(cy - Math.cos(t) * (r - 1.2))}`;
  }
  const sweep = Math.max(0.03, Math.min(0.97, n.sweep));
  const wedge: Pt[] = [[cx, cy]];
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * sweep * TAU;
    wedge.push([cx + Math.sin(t) * (r - 2.5), cy - Math.cos(t) * (r - 2.5)]);
  }
  const a = sweep * TAU;
  return (
    `<path class="rr-tick" d="${hatchPath(ell(cx + 4, cy + 5, r, r, 22), R, { angle: 45, pitch: 3 })}"/>` +
    `<circle class="rr-card" cx="${n1(cx)}" cy="${n1(cy)}" r="${r}"/>` +
    `<path class="rr-pencil rr-pencil-ochre rr-wedge" d="${hatchPath(wedge, R, { angle: 25, pitch: 2.1 })}"/>` +
    `<path class="rr-dial" d="${ticks}"/>` +
    ringInk(cx, cy, r, R, 1.5) +
    `<g class="rr-hand" data-cx="${n1(cx)}" data-cy="${n1(cy)}" data-sweep="${n1(sweep * 360)}"><path class="rr-hand-line" d="M${n1(cx)} ${n1(cy)}L${n1(cx + Math.sin(a) * (r - 6))} ${n1(cy - Math.cos(a) * (r - 6))}"/></g>` +
    `<circle class="rr-ink-fill" cx="${n1(cx)}" cy="${n1(cy)}" r="2"/>` +
    textSvg(n.text)
  );
}

function deck(n: SceneNode, R: Rng): string {
  const b = n.box;
  const sheet = (dx: number, dy: number) => rrect({ x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy }, 3, 2);
  const front = sheet(0, 0);
  return (
    shadowTicks(b, R) +
    fillOf(sheet(8, -8), "rr-card") +
    `<path class="rr-ink" d="${inkPoly(sheet(8, -8).filter((_, i) => i % 3 === 0), R, 1.05, { bow: 0.25, over: 0.4 })}"/>` +
    fillOf(sheet(4, -4), "rr-card") +
    `<path class="rr-ink" d="${inkPoly(sheet(4, -4).filter((_, i) => i % 3 === 0), R, 1.05, { bow: 0.25, over: 0.4 })}"/>` +
    fillOf(front, "rr-card") +
    `<path class="rr-pencil rr-pencil-ochre" d="${hatchPath(front, R, { angle: 28, pitch: 3.4 })}"/>` +
    `<path class="rr-ink" d="${inkPoly(front.filter((_, i) => i % 3 === 0), R, 1.45, { bow: 0.35, over: 0.5 })}"/>` +
    textSvg(n.text)
  );
}

function note(n: SceneNode, R: Rng): string {
  const b = n.box;
  const shape: Pt[] = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  if (n.missing) {
    const mp = handLine([...shape, shape[0]!], R, { bow: 0.5, tremor: 0.8, step: 4, smooth: 2 });
    return `<path class="rr-missing" d="${linePath(mp)}"/>` + textSvg(n.text);
  }
  const tape = (x: number, y: number, rot: number) => `<rect class="rr-tape" x="${n1(x - 13)}" y="${n1(y - 5)}" width="26" height="10" transform="rotate(${n1(rot)} ${n1(x)} ${n1(y)})"/>`;
  return (
    shadowTicks(b, R, 6, 7) +
    fillOf(shape, "rr-card") +
    `<path class="rr-ink" d="${inkPoly(shape, R, 1.05, { bow: 0.4, tremor: 0.7 })}"/>` +
    tape(b.x0 + 10, b.y0 + 1.5, -32) +
    tape(b.x1 - 10, b.y0 + 1.5, 31) +
    textSvg(n.text)
  );
}

function nodeSvg(n: SceneNode, seed: string, interactive: boolean): string {
  const R = rng(`${seed}:node:${n.id}`);
  const body = n.kind === "ticket" ? ticket(n, R) : n.kind === "device" ? device(n, R) : n.kind === "clock" ? clock(n, R) : n.kind === "deck" ? deck(n, R) : note(n, R);
  const label = `${n.full}${n.sourceWords ? `, ${n.sourceWords}` : ""}`;
  const a11y = interactive ? ` tabindex="0" role="button" aria-label="${esc(label)}"` : "";
  const rot = n.tilt ? ` transform="rotate(${n.tilt.toFixed(2)} ${n1(n.pivot[0])} ${n1(n.pivot[1])})"` : "";
  return `<g class="rr-node rr-${n.kind}${n.missing ? " rr-node-missing" : ""}" data-node="${idAttr(n.id)}" data-provenance="${n.provenance}" data-px="${n1(n.pivot[0])}" data-py="${n1(n.pivot[1])}"${a11y}${rot}><title>${esc(label)}</title><g class="rr-settle">${body}</g></g>`;
}

function arrowHead(tip: Pt, ang: number, len: number): string {
  const wing = len * 0.42;
  const notch = len * 0.62;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const pt = (u: number, v: number) => `${n1(tip[0] - u * c - v * s)} ${n1(tip[1] - u * s + v * c)}`;
  return `M${pt(0, 0)}L${pt(len, wing)}L${pt(notch, 0)}L${pt(len, -wing)}Z`;
}

function edgeSvg(e: SceneEdge, seed: string): string {
  const R = rng(`${seed}:edge:${e.id}`);
  const hand = handLine(e.pts, R, { bow: 0.85, tremor: 0.85, smooth: 3.5 });
  const attrs = `data-edge="${idAttr(e.id)}" data-from="${idAttr(e.from)}" data-to="${idAttr(e.to)}" data-provenance="${e.provenance}"`;
  const tooltip = e.full ? `<title>${esc(e.full)}</title>` : "";
  const start = n1Pair(hand[0]!);
  const end = n1Pair(hand[hand.length - 1]!);
  if (e.kind === "dashed-note") {
    return `<g class="rr-edge rr-note-line" ${attrs} data-start="${start}" data-end="${end}">${tooltip}<path class="rr-dash" d="${linePath(hand)}"/></g>`;
  }
  const last = hand[hand.length - 1]!;
  const prev = hand[Math.max(0, hand.length - 5)]!;
  const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
  const w = e.onPath ? 2.25 : 1.3;
  const head = arrowHead(last, ang, e.onPath ? 15 : 11.5);
  // The line stops at the head's notch, so the head's point is the only thing that arrives.
  const stem = hand.slice(0, Math.max(2, hand.length - 1));
  return (
    `<g class="rr-edge rr-thread${e.onPath ? " rr-on-path" : ""}" ${attrs} data-start="${start}" data-end="${end}">${tooltip}` +
    `<path class="rr-line" d="${ribbon(stem, w, R)}"/><path class="rr-head" d="${head}"/>` +
    `<path class="rr-spine" d="${linePath(hand)}"/></g>`
  );
}
const n1Pair = (p: Pt) => `${n1(p[0])},${n1(p[1])}`;

function regionSvg(r: SceneRegion, seed: string): string {
  const R = rng(`${seed}:region:${r.id}`);
  const shape = rrect(r.box, 12, 4);
  const line = handLine([...shape, shape[0]!], R, { bow: 0.4, tremor: 0.6, smooth: 2, step: 7 });
  return `<g class="rr-region" data-region="${idAttr(r.id)}"><path class="rr-region-line" d="${ribbon(line, 1, R)}"/>${textSvg(r.label, "rr-soft")}</g>`;
}

/** The mark on a node: a tick for matched, a red ring for didn't match, a dashed ring and "?" for can't check. */
function markSvg(m: SceneMark, node: SceneNode, seed: string): string {
  const R = rng(`${seed}:mark:${m.on}:${m.kind}`);
  const b = node.box;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const rx = (b.x1 - b.x0) / 2 + 17;
  const ry = (b.y1 - b.y0) / 2 + 17;
  const words = textSvg(m.words, "rr-mark-words");
  let art = "";
  if (m.kind === "matched") {
    const x = b.x1 + 6;
    const y = b.y0 + 6;
    const tick = handLine([[x - 14, y + 1], [x - 5, y + 12], [x + 17, y - 18]], R, { bow: 0.2, tremor: 0.4, smooth: 1.2, step: 2 });
    art =
      `<path class="rr-mark-tick" d="${ribbon(tick, 4.2, R, { taper: true })}"/><path class="rr-mark-spine" d="${linePath(tick)}"/>` +
      [[x + 27, y - 21, 5.4], [x + 33, y + 3, 3.8], [x + 5, y - 32, 4.2]].map(([sx, sy, r]) => `<path class="rr-spark" d="M${n1(sx! - r!)} ${n1(sy!)}H${n1(sx! + r!)}M${n1(sx!)} ${n1(sy! - r!)}V${n1(sy! + r!)}"/>`).join("");
  } else if (m.kind === "didnt-match") {
    // A rounded ring (a superellipse), so it clears the ticket's corners without growing huge; a little past where it began.
    const pts: Pt[] = [];
    const start = -2.2;
    const sg = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
    for (let i = 0; i <= 56; i++) {
      const t = start + (i / 56) * 1.045 * TAU;
      pts.push([cx + sg(Math.cos(t), 0.66) * rx, cy + sg(Math.sin(t), 0.66) * ry]);
    }
    const ring = handLine(pts, R, { bow: 0.25, tremor: 0.7, smooth: 2.5, step: 5 });
    art = `<path class="rr-mark-ring" d="${ribbon(ring, 2.5, R, { taper: true })}"/><path class="rr-mark-spine" d="${linePath(ring)}"/>`;
  } else {
    // Outside any red ring on the same node, and rounded the same way so it clears the corners.
    const pts: Pt[] = [];
    const sg = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
    for (let i = 0; i <= 56; i++) {
      const t = (i / 56) * TAU;
      pts.push([cx + sg(Math.cos(t), 0.66) * (rx + 9), cy + sg(Math.sin(t), 0.66) * (ry + 9)]);
    }
    art = `<path class="rr-mark-cant" d="${linePath(handLine(pts, R, { bow: 0.25, tremor: 0.6, step: 5 }))}"/>`;
  }
  return `<g class="rr-mark rr-mark-${m.kind}" data-mark="${idAttr(m.on)}">${art}${words}</g>`;
}

/** A square of paper fibres, repeated across the sheet: the tooth you only notice when it is missing. */
export function paperTile(seed: string, id: string): string {
  const R = rng(`${seed}:paper`);
  const size = 256;
  let fibres = "";
  let specks = "";
  for (let i = 0; i < 90; i++) {
    const x = R() * size;
    const y = R() * size;
    const a = R.gauss(0.2, 0.6);
    const l = R.range(3, 13);
    fibres += `M${n1(x)} ${n1(y)}q${n1(Math.cos(a) * l * 0.5 + R.range(-1, 1))} ${n1(Math.sin(a) * l * 0.5 + R.range(-1, 1))} ${n1(Math.cos(a) * l)} ${n1(Math.sin(a) * l)}`;
  }
  for (let i = 0; i < 70; i++) specks += `M${n1(R() * size)} ${n1(R() * size)}h.7`;
  return `<defs><pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><path class="rr-fibre" d="${fibres}"/><path class="rr-speck" d="${specks}"/></pattern></defs>`;
}

export interface SvgOptions {
  interactive?: boolean;
}

export function sceneToSvg(scene: Scene, spec: { seed: string }, o: SvgOptions = {}): string {
  const interactive = o.interactive ?? true;
  const pid = `rr-paper-${Math.abs(hash(`${spec.seed}:${scene.width}x${scene.height}`)).toString(36)}`;
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const head = [scene.kicker && textSvg(scene.kicker, "rr-kicker"), scene.title && textSvg(scene.title, "rr-title"), scene.subtitle && textSvg(scene.subtitle, "rr-sub")].filter(Boolean).join("");
  const sorted = [...scene.edges].sort((a, b) => Number(a.onPath) - Number(b.onPath));
  const m = 2400;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="rr" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" data-seed="${esc(scene.seed)}" role="group" aria-label="${esc(scene.title?.lines.map((l) => l.text).join(" ") ?? "drawing")}">` +
    paperTile(spec.seed, pid) +
    `<rect class="rr-sheet" x="${-m}" y="${-m}" width="${scene.width + m * 2}" height="${scene.height + m * 2}"/>` +
    `<rect x="${-m}" y="${-m}" width="${scene.width + m * 2}" height="${scene.height + m * 2}" fill="url(#${pid})"/>` +
    `<g class="rr-world">` +
    `<g class="rr-head-block">${head}</g>` +
    `<g class="rr-regions">${scene.regions.map((r) => regionSvg(r, scene.seed)).join("")}</g>` +
    `<g class="rr-edges">${sorted.map((e) => edgeSvg(e, scene.seed)).join("")}</g>` +
    `<g class="rr-nodes">${scene.nodes.map((n) => nodeSvg(n, scene.seed, interactive)).join("")}</g>` +
    `<g class="rr-labels">${scene.edges
      .filter((e) => e.label)
      .map((e) => `<g class="rr-label" data-label-of="${idAttr(e.id)}">${textSvg(e.label!)}</g>`)
      .join("")}</g>` +
    `<g class="rr-marks">${scene.marks.map((mk) => markSvg(mk, byId.get(mk.on)!, scene.seed)).join("")}</g>` +
    `<g class="rr-captions">${scene.captions.map((c) => textSvg(c, "rr-caption")).join("")}</g>` +
    `</g></svg>`
  );
}

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
