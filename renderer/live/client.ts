// R3: asks the Worker for a drawing, and gives up to the plain list if it takes too long: a page never freezes on a chart.
import { assertSpec, type RenderSpec } from "../spec";
import { drawSpec, listHtml, type Drawn } from "./draw";

/** Past this the Worker is stopped and the list is shown. */
export const DRAW_TIMEOUT_MS = 4000;

export function drawInWorker(spec: RenderSpec, o: { timeoutMs?: number; makeWorker?: () => Worker; narrow?: boolean } = {}): Promise<Drawn> {
  assertSpec(spec);
  const make = o.makeWorker ?? (() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  let worker: Worker;
  try {
    worker = make();
  } catch {
    return Promise.resolve(drawSpec(spec, { narrow: o.narrow === true }));
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const timer = setTimeout(() => {
      worker.terminate();
      const reason = `the drawing took more than ${(o.timeoutMs ?? DRAW_TIMEOUT_MS) / 1000} seconds`;
      resolve({ kind: "list", reason, html: listHtml(spec, reason), ms: performance.now() - t0 });
    }, o.timeoutMs ?? DRAW_TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; drawn?: Drawn; error?: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      if (e.data.ok && e.data.drawn) resolve(e.data.drawn);
      else {
        const reason = e.data.error ?? "the drawing failed";
        resolve({ kind: "list", reason, html: listHtml(spec, reason), ms: performance.now() - t0 });
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(drawSpec(spec, { narrow: o.narrow === true }));
    };
    worker.postMessage({ spec, narrow: o.narrow === true });
  });
}
