// R3: the checks that replace Anatomy's audit for this renderer. Pure; no DOM. Plain words for each:
// - every drawn thread maps to a spec edge, and every spec edge is drawn, once;
// - a line only Muse Wonder claims is never drawn as a thread;
// - every line ends on something: it starts at its source and arrives close to its target;
// - no text sits on other text or on a node that is not its own; no line runs through words;
// - no script, event handler, link or embedded object can be in the SVG, whatever the names were;
// - the same spec and seed give the same SVG (checkDeterministic).

import { layOut } from "./layout";
import { sceneToSvg } from "./live/svg";
import type { Box, Scene, TextBlock } from "./scene";
import type { RenderSpec } from "./spec";
import { idFromAttr } from "./words";

const unesc = (s: string) => idFromAttr(s);

/** How far from a box a line may begin or end and still be "on" it, in px. */
const START_SLACK = 16;
const END_SLACK = 28;

const hit = (a: Box, b: Box, g = 0) => a.x0 < b.x1 + g && a.x1 > b.x0 - g && a.y0 < b.y1 + g && a.y1 > b.y0 - g;

/** The ink of each line of a block: its advance width, ascender to descender. */
function lineBoxes(b: TextBlock): Box[] {
  return b.lines.map((l) => ({ x0: l.x, x1: l.x + l.w, y0: l.y - b.size * 0.76, y1: l.y + b.size * 0.24 }));
}

function allBlocks(scene: Scene): TextBlock[] {
  const out: TextBlock[] = [];
  for (const b of [scene.title, scene.kicker, scene.subtitle]) if (b) out.push(b);
  out.push(...scene.captions);
  for (const n of scene.nodes) {
    out.push(n.text);
    if (n.small) out.push(n.small);
  }
  for (const e of scene.edges) if (e.label) out.push(e.label);
  for (const r of scene.regions) out.push(r.label);
  for (const m of scene.marks) out.push(m.words);
  return out;
}

export function checkSvgSafety(svg: string): string[] {
  const out: string[] = [];
  const bad: [RegExp, string][] = [
    [/<script/i, "a script"],
    [/<foreignObject/i, "a foreign object"],
    [/<iframe|<embed|<object/i, "an embedded frame"],
    [/<image|<use\b|<a[\s>]/i, "a link or external image"],
    [/\son[a-z]+\s*=/i, "an event handler"],
    [/\b(xlink:)?href\s*=/i, "a link"],
    [/javascript:/i, "a javascript: address"],
  ];
  // Text content may mention these words safely once escaped: only tags and attributes count, so remove text and values of titles.
  const tagsOnly = svg.replace(/>[^<]*</g, "><").replace(/="[^"]*"/g, '=""');
  for (const [re, what] of bad) if (re.test(tagsOnly)) out.push(`the SVG holds ${what}`);
  return out;
}

export function checkDrawing(spec: RenderSpec, scene: Scene, svg: string): string[] {
  const out: string[] = [...checkSvgSafety(svg)];

  // Threads ↔ edges, both ways.
  const drawn = new Map<string, { thread: boolean; start?: [number, number]; end?: [number, number] }>();
  for (const m of svg.matchAll(/<g class="rr-edge ([^"]*)" data-edge="([^"]*)"[^>]*?data-start="([-\d.]+),([-\d.]+)" data-end="([-\d.]+),([-\d.]+)"/g)) {
    const id = unesc(m[2]!);
    if (drawn.has(id)) out.push(`the line ${JSON.stringify(id)} is drawn twice`);
    drawn.set(id, { thread: m[1]!.includes("rr-thread"), start: [Number(m[3]), Number(m[4])], end: [Number(m[5]), Number(m[6])] });
  }
  const specEdges = new Map(spec.edges.map((e) => [e.id, e]));
  for (const id of drawn.keys()) if (!specEdges.has(id)) out.push(`the drawing has a line the spec does not: ${JSON.stringify(id)}`);
  for (const [id, e] of specEdges) {
    const d = drawn.get(id);
    if (!d) {
      out.push(`the spec has a line the drawing does not: ${JSON.stringify(id)}`);
      continue;
    }
    if (d.thread !== (e.kind === "thread")) out.push(`the line ${JSON.stringify(id)} is drawn as the wrong kind`);
    if (e.provenance === "wonder-words" && d.thread) out.push(`the line ${JSON.stringify(id)} is Wonder's word but drawn as a thread`);
  }
  // Nodes both ways.
  const specNodes = new Set(spec.nodes.map((n) => n.id));
  const drawnNodes = [...svg.matchAll(/<g class="rr-node[^"]*" data-node="([^"]*)"/g)].map((m) => unesc(m[1]!));
  for (const id of drawnNodes) if (!specNodes.has(id)) out.push(`the drawing has a part the spec does not: ${JSON.stringify(id)}`);
  if (new Set(drawnNodes).size !== specNodes.size) out.push("the drawing and the spec have different parts");

  // Every line ends on something.
  const boxOf = new Map(scene.nodes.map((n) => [n.id, n.box]));
  const within = (p: [number, number], b: Box, g: number) => p[0] >= b.x0 - g && p[0] <= b.x1 + g && p[1] >= b.y0 - g && p[1] <= b.y1 + g;
  for (const e of spec.edges) {
    const d = drawn.get(e.id);
    if (!d?.start || !d.end) continue;
    if (!within(d.start, boxOf.get(e.from)!, START_SLACK)) out.push(`the line ${JSON.stringify(e.id)} does not start on what it comes from`);
    if (!within(d.end, boxOf.get(e.to)!, END_SLACK)) out.push(`the line ${JSON.stringify(e.id)} does not end on what it points at`);
  }

  // Text against text, and against nodes.
  const blocks = allBlocks(scene);
  const boxes = blocks.flatMap((b) => lineBoxes(b).map((box) => ({ b, box })));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i]!.b === boxes[j]!.b) continue;
      if (hit(boxes[i]!.box, boxes[j]!.box)) out.push(`two words overlap: ${JSON.stringify(boxes[i]!.b.lines[0]?.text)} and ${JSON.stringify(boxes[j]!.b.lines[0]?.text)}`);
    }
  }
  for (const n of scene.nodes) {
    if (!n.small) continue;
    const pin = { x0: n.pivot[0] - 9, x1: n.pivot[0] + 9, y0: n.pivot[1] - 9, y1: n.pivot[1] + 9 };
    for (const box of lineBoxes(n.small)) if (hit(box, pin)) out.push(`the small words on ${JSON.stringify(n.id)} sit under its pin`);
  }
  for (const { b, box } of boxes) {
    for (const n of scene.nodes) {
      const own = (b.role === "node" || b.role === "small") && b.owner === n.id;
      if (own) {
        if (n.kind !== "clock" && (box.x0 < n.box.x0 - 0.5 || box.x1 > n.box.x1 + 0.5 || box.y0 < n.box.y0 - 0.5 || box.y1 > n.box.y1 + 0.5)) out.push(`the words ${JSON.stringify(b.lines[0]?.text)} do not fit their part`);
        continue;
      }
      if (b.role === "region") continue;
      if (hit(box, n.box)) out.push(`the words ${JSON.stringify(b.lines[0]?.text)} sit on the part ${JSON.stringify(n.id)}`);
    }
    // A line through words (node words have the card under them, so only words on open paper count).
    if (b.role === "edge" || b.role === "mark" || b.role === "title" || b.role === "subtitle" || b.role === "caption") {
      for (const e of scene.edges) {
        for (const p of e.pts) {
          if (p[0] > box.x0 && p[0] < box.x1 && p[1] > box.y0 && p[1] < box.y1) {
            out.push(`the line ${JSON.stringify(e.id)} runs through the words ${JSON.stringify(b.lines[0]?.text)}`);
            break;
          }
        }
      }
    }
  }
  return [...new Set(out)];
}

/** Layout + SVG twice from the same spec: the text must be identical. */
export function checkDeterministic(spec: RenderSpec): string[] {
  const a = sceneToSvg(layOut(spec), spec);
  const b = sceneToSvg(layOut(structuredClone(spec)), spec);
  return a === b ? [] : ["the same spec and seed drew two different pictures"];
}
