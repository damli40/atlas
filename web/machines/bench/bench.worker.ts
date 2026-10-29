// U1: the bench drawing is built here, off the page's main thread (the explorer's drawing code, figure.mjs, takes a
// few seconds on a dense file). Input: the bench model (plain data). Output: the SVG, the dials and the projection.
import { buildFigure, TooManyToDraw } from "../explorer/figure.mjs";
import type { ExplorerModel } from "../explorer/model";

export type BenchRequest = { id: number; model: ExplorerModel };
export type BenchReply =
  | { id: number; ok: true; svg: string; P: unknown; dials: Record<string, { x: number; y: number; top: number; r: number }> }
  | { id: number; ok: false; tooMany: boolean; message: string };

self.onmessage = (e: MessageEvent<BenchRequest>) => {
  try {
    const fig = buildFigure(e.data.model);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, svg: fig.svg, P: fig.P, dials: fig.dials } satisfies BenchReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, tooMany: err instanceof TooManyToDraw, message: err instanceof Error ? err.message : String(err) } satisfies BenchReply);
  }
};
