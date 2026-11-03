// R13: one pasted file's drawing as a picture file, for the Muse Code plugin's atlas_draw (POST /paste/drawing). Pure.
//
// Plain words: the same plain code the page uses draws it. The machine (D65) when the file has at most 8 parts and its pipes
// can be drawn clearly; otherwise the box chart, as on the page; otherwise words only. Nothing runs and no model draws: every
// box, pipe, loop, wait, throw and return comes from the file's syntax. The only words a model may add are the natural names
// (R6), and only names this session was already shown on the page's terms; the caption then carries the page's legend.

import { benchModel } from "../../web/machines/bench/model";
import { benchSpec } from "../authors/bet-view";
import { CANT_DRAW, MACHINE_PART_LIMIT, NOTHING_TO_DRAW, drawMachine, machineParts } from "../authors/machine";
import { drawSpec } from "../live/draw";
import { fileOutline } from "../../src/file-outline";
import { NAMER_WORDS } from "../../src/natural-names";
import { standaloneSvg } from "../standalone";

export const DRAWN_FROM_SYNTAX = "Drawn by Atlas's plain code from the file's syntax alone. Nothing ran, and no AI drew it.";

/** R13 review M1: past these the picture is not made, and the answer says why in words. The plugin reads answers of at most 2 MB. */
export const PICTURE_LIMITS = { maxNameChars: 200, maxSide: 4_000, maxSvgBytes: 1_500_000, maxChartNodes: 25, maxChartEdges: 40, maxMachinePipes: 16 } as const;

/** The drawing alone: depends only on the code, the function and the names (never the file's name), so it can be kept and reused. */
export type FileDrawing =
  | { kind: "machine" | "chart"; svg: string; width: number; height: number; parts: number; aiNames: number; why?: string }
  | { kind: "none"; words: string; parts: number };

export type FilePicture =
  | {
      kind: "machine" | "chart";
      svg: string;
      width: number;
      height: number;
      /** Functions and classes plain code found. */
      parts: number;
      /** Lids carrying a name Meta's AI wrote (machine only; the chart has no room for names). */
      aiNames: number;
      caption: string[];
    }
  | { kind: "none"; words: string; parts: number };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const partList = (names: string[]) => `${names.slice(0, 40).map((n) => cut(n, 60)).join(", ")}${names.length > 40 ? `, and ${names.length - 40} more` : ""}`;

export function fileDrawing(o: { source: string; language: "js" | "ts" | "py"; tested: string | null; names?: Readonly<Record<string, string>> | null; wontRun?: boolean }): FileDrawing {
  const L = PICTURE_LIMITS;
  const outline = fileOutline(o.source, o.language);
  const count = outline.parts.length;
  if (count === 0) return { kind: "none", words: NOTHING_TO_DRAW, parts: 0 };
  // Checked before anything is drawn: a very long name makes a very wide picture.
  const longest = outline.parts.reduce((m, p) => Math.max(m, p.name.length), 0);
  if (longest > L.maxNameChars) return { kind: "none", words: `A name in this file is ${longest.toLocaleString("en-US")} characters long, more than the ${L.maxNameChars} Atlas draws, so there is no picture. Its parts: ${partList(outline.parts.map((p) => p.name))}.`, parts: count };
  // The file's name is never drawn here (the caption carries it), so the same code always gives the same drawing.
  const model = { ...benchModel({ fileName: "pasted", outline, test: null, source: o.source, language: o.language }), tested: o.tested };
  const parts = machineParts(model, outline, o.source, o.language);
  const names = o.names ?? {};
  const named = { ...parts, housings: parts.housings.map((h) => (names[h.id] ? { ...h, natural: names[h.id]! } : h)) };
  // Many pipes make the machine's router try and fail for seconds; past this the box chart is tried straight away.
  const d = parts.pipes.length > L.maxMachinePipes && parts.housings.length + parts.ports.length <= MACHINE_PART_LIMIT ? { tooMany: CANT_DRAW, problems: [] as string[], svg: "", width: 0, height: 0, aiNames: 0 } : drawMachine(named, { seed: `machine:${outline.parts.map((p) => p.name).join(",")}`, nameLines: true, ...(o.wontRun ? { wontRun: true } : {}) });
  const tooBig = (kind: string, w: number, h: number, bytes: number) =>
    w > L.maxSide || h > L.maxSide ? `The ${kind} would be ${Math.round(w)} × ${Math.round(h)} px, more than the ${L.maxSide.toLocaleString("en-US")} × ${L.maxSide.toLocaleString("en-US")} Atlas sends, so there is no picture.` : bytes > L.maxSvgBytes ? `The ${kind} would be ${(bytes / 1e6).toFixed(1)} MB, more than the ${L.maxSvgBytes / 1e6} MB Atlas sends, so there is no picture.` : null;
  if (!d.tooMany && d.problems.length === 0) {
    const big = tooBig("machine", d.width, d.height, d.svg.length);
    if (big) return { kind: "none", words: `${big} Its parts: ${partList(outline.parts.map((p) => p.name))}.`, parts: count };
    return { kind: "machine", svg: d.svg, width: d.width, height: d.height, parts: count, aiNames: d.aiNames ?? 0 };
  }
  // As on the page: past what the machine can show, the box chart. It has no room for names, so it carries none.
  const why = d.tooMany ?? CANT_DRAW;
  const whyNoMachine = why.replace(/,? so here is the box chart\.$/, ".");
  const list = () => `Its parts: ${partList(outline.parts.map((p) => p.name))}.`;
  // Past what the box chart can show, the page lists the parts in words; so does this.
  if (!why.endsWith("box chart.")) return { kind: "none", words: `${why} Atlas draws no picture of a file this size. ${list()}`, parts: count };
  const spec = benchSpec(model, { fileName: "pasted", outline, source: o.source, language: o.language, seed: "chart:pasted" });
  // The page draws a chart this big in a worker with a time limit; the server does not draw it at all.
  if (spec.nodes.length > L.maxChartNodes || spec.edges.length > L.maxChartEdges) return { kind: "none", words: `${whyNoMachine} Its box chart would have ${spec.nodes.length} boxes and ${spec.edges.length} joins, more than the ${L.maxChartNodes} boxes and ${L.maxChartEdges} joins Atlas draws here, so there is no picture. ${list()}`, parts: count };
  const chart = drawSpec({ ...spec, title: undefined, kicker: undefined, subtitle: undefined, captions: [] });
  if (chart.kind !== "drawing") return { kind: "none", words: `${why} ${chart.kind === "list" ? `The box chart is too big to draw too (${chart.reason}).` : chart.words}`, parts: count };
  const size = /<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(chart.svg);
  const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(chart.svg);
  const width = Number(size?.[1] ?? vb?.[1] ?? 800);
  const height = Number(size?.[2] ?? vb?.[2] ?? 600);
  const big = tooBig("box chart", width, height, chart.svg.length);
  if (big) return { kind: "none", words: `${whyNoMachine} ${big} ${list()}`, parts: count };
  return { kind: "chart", svg: chart.svg, width, height, parts: count, aiNames: 0, why };
}

/** The picture file: the drawing, the fonts and a caption with the file's name. Cheap; the drawing is the work. */
export function filePictureOf(d: FileDrawing, o: { fileName: string; tested: string | null; namesModel?: string | null; fontCss?: string }): FilePicture {
  if (d.kind === "none") return d;
  const count = d.parts;
  const head = `${cut(o.fileName, 120)}: Atlas's ${d.kind === "machine" ? "machine" : "box chart"} of ${count} part${count === 1 ? "" : "s"}${o.tested ? `, entered at ${cut(o.tested, 80)}` : ""}`;
  const caption = [head, DRAWN_FROM_SYNTAX, ...(d.aiNames > 0 ? [`${NAMER_WORDS.legend}${o.namesModel ? ` (${cut(o.namesModel, 60)})` : ""}.`] : []), ...(d.why ? [d.why] : [])];
  const file = standaloneSvg({ drawing: d.svg, width: d.width, height: d.height, title: caption[0]!, caption, ...(o.fontCss ? { fontCss: o.fontCss } : {}) });
  if (file.svg.length > PICTURE_LIMITS.maxSvgBytes) return { kind: "none", words: `The picture would be ${(file.svg.length / 1e6).toFixed(1)} MB with its fonts, more than the ${PICTURE_LIMITS.maxSvgBytes / 1e6} MB Atlas sends, so there is no picture.`, parts: count };
  return { kind: d.kind, svg: file.svg, width: file.width, height: file.height, parts: count, aiNames: d.aiNames, caption };
}

/** Both steps at once (tests and tools). */
export function filePicture(o: { source: string; language: "js" | "ts" | "py"; fileName: string; tested: string | null; names?: Readonly<Record<string, string>> | null; namesModel?: string | null; wontRun?: boolean; fontCss?: string }): FilePicture {
  return filePictureOf(fileDrawing(o), o);
}
