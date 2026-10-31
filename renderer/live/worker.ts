// R3: draws in a Web Worker, so a big chart cannot freeze the page.
import { drawSpec } from "./draw";
import type { RenderSpec } from "../spec";

const scope = self as unknown as { onmessage: ((e: MessageEvent<RenderSpec>) => void) | null; postMessage(m: unknown): void };
scope.onmessage = (e) => {
  try {
    scope.postMessage({ ok: true, drawn: drawSpec(e.data) });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
