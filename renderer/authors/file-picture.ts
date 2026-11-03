// R13: one pasted file's drawing as a picture file, for the Muse Code plugin's atlas_draw (POST /paste/drawing). Pure.
//
// Plain words: the same plain code the page uses draws it. The machine (D65) when the file has at most 8 parts and its pipes
// can be drawn clearly; otherwise the box chart, as on the page; otherwise words only. Nothing runs and no model draws: every
// box, pipe, loop, wait, throw and return comes from the file's syntax. The only words a model may add are the natural names
// (R6), and only names this session was already shown on the page's terms; the caption then carries the page's legend.

import { benchModel } from "../../web/machines/bench/model";
import { benchSpec } from "../authors/bet-view";
import { CANT_DRAW, NOTHING_TO_DRAW, drawMachine, machineParts } from "../authors/machine";
import { drawSpec } from "../live/draw";
import { fileOutline } from "../../src/file-outline";
import { NAMER_WORDS } from "../../src/natural-names";
import { standaloneSvg } from "../standalone";

export const DRAWN_FROM_SYNTAX = "Drawn by Atlas's plain code from the file's syntax alone. Nothing ran, and no AI drew it.";

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

export function filePicture(o: { source: string; language: "js" | "ts" | "py"; fileName: string; tested: string | null; names?: Readonly<Record<string, string>> | null; namesModel?: string | null; wontRun?: boolean; fontCss?: string }): FilePicture {
  const outline = fileOutline(o.source, o.language);
  if (outline.parts.length === 0) return { kind: "none", words: NOTHING_TO_DRAW, parts: 0 };
  const model = { ...benchModel({ fileName: o.fileName, outline, test: null, source: o.source, language: o.language }), tested: o.tested };
  const parts = machineParts(model, outline, o.source, o.language);
  const names = o.names ?? {};
  const named = { ...parts, housings: parts.housings.map((h) => (names[h.id] ? { ...h, natural: names[h.id]! } : h)) };
  const d = drawMachine(named, { seed: `machine:${outline.parts.map((p) => p.name).join(",")}`, nameLines: true, ...(o.wontRun ? { wontRun: true } : {}) });
  const count = outline.parts.length;
  const head = (what: string) => `${o.fileName}: Atlas's ${what} of ${count} part${count === 1 ? "" : "s"}${o.tested ? `, entered at ${o.tested}` : ""}`;
  const finish = (kind: "machine" | "chart", drawing: string, width: number, height: number, caption: string[], aiNames: number): FilePicture => {
    const file = standaloneSvg({ drawing, width, height, title: caption[0]!, caption, ...(o.fontCss ? { fontCss: o.fontCss } : {}) });
    return { kind, svg: file.svg, width: file.width, height: file.height, parts: count, aiNames, caption };
  };
  if (!d.tooMany && d.problems.length === 0) {
    const ai = d.aiNames ?? 0;
    return finish("machine", d.svg, d.width, d.height, [head("machine"), DRAWN_FROM_SYNTAX, ...(ai > 0 ? [`${NAMER_WORDS.legend}${o.namesModel ? ` (${o.namesModel})` : ""}.`] : [])], ai);
  }
  // As on the page: past what the machine can show, the box chart. It has no room for names, so it carries none.
  const why = d.tooMany ?? CANT_DRAW;
  // Past what the box chart can show, the page lists the parts in words; so does this.
  if (!why.endsWith("box chart.")) return { kind: "none", words: `${why} Atlas draws no picture of a file this size. Its parts: ${outline.parts.map((p) => p.name).join(", ")}.`, parts: count };
  const spec = benchSpec(model, { fileName: o.fileName, outline, source: o.source, language: o.language, seed: `chart:${o.fileName}` });
  const chart = drawSpec({ ...spec, captions: [] });
  if (chart.kind !== "drawing") return { kind: "none", words: `${why} ${chart.kind === "list" ? `The box chart is too big to draw too (${chart.reason}).` : chart.words}`, parts: count };
  const size = /<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(chart.svg);
  const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(chart.svg);
  const width = Number(size?.[1] ?? vb?.[1] ?? 800);
  const height = Number(size?.[2] ?? vb?.[2] ?? 600);
  return finish("chart", chart.svg, width, height, [head("box chart"), DRAWN_FROM_SYNTAX, why], 0);
}
