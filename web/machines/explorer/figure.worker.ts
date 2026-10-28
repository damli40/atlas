// X2 review B4: the figure is built here, off the page's main thread, so a large outline never freezes the tab.
// Input: an explorer model (plain data). Output: the SVG string and counts, or why it was not drawn.
import { buildFigure, TooManyToDraw } from "./figure.mjs";
import type { ExplorerModel } from "./model";

export type FigureRequest = { id: number; model: ExplorerModel };
export type FigureReply = { id: number; ok: true; svg: string; ms: number } | { id: number; ok: false; tooMany: boolean; message: string };

self.onmessage = (e: MessageEvent<FigureRequest>) => {
  const t = performance.now();
  try {
    const fig = buildFigure(e.data.model);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, svg: fig.svg, ms: Math.round(performance.now() - t) } satisfies FigureReply);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, tooMany: err instanceof TooManyToDraw, message: err instanceof Error ? err.message : String(err) } satisfies FigureReply);
  }
};
