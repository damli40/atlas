// R3: spec → drawing, or the list when the drawing is over budget, or the one sentence when nothing may be shown.
// Browser-safe. Never throws for a big or strange spec: only a spec that breaks an honesty rule is refused (SpecRefused).

import { LAYOUT_LIMITS, layOut, OverBudget } from "../layout";
import { assertSpec, type RenderSpec } from "../spec";
import type { Scene } from "../scene";
import { cleanWords, esc } from "../words";
import { sceneToSvg } from "./svg";

export type Drawn =
  | { kind: "drawing"; svg: string; scene: Scene; ms: number }
  | { kind: "list"; reason: string; html: string; ms: number }
  | { kind: "not-shown"; words: string; html: string; ms: number };

/** The plain list: every part and join in words, for when the drawing would take too long. */
export function listHtml(spec: RenderSpec, reason: string): string {
  const words = new Map(spec.nodes.map((n) => [n.id, cleanWords(n.words)]));
  const nodes = spec.nodes.map((n) => `<li>${esc(cleanWords(n.words))}</li>`).join("");
  const edges = spec.edges.map((e) => `<li>${esc(words.get(e.from) ?? "?")} → ${esc(words.get(e.to) ?? "?")}${e.words ? `: ${esc(cleanWords(e.words))}` : ""}${e.kind === "dashed-note" ? " (a note, not checked by plain code)" : ""}</li>`).join("");
  return `<div class="rr-list"><h2>${esc(cleanWords(spec.title ?? "The list"))}</h2><p>Showing the list: ${esc(reason)}.</p><ul>${nodes}</ul>${edges ? `<ul>${edges}</ul>` : ""}</div>`;
}

export function drawSpec(spec: RenderSpec, o: { now?: () => number } = {}): Drawn {
  const now = o.now ?? (() => (typeof performance !== "undefined" ? performance.now() : 0));
  const t0 = now();
  assertSpec(spec);
  if (spec.notShown !== undefined) {
    const words = cleanWords(spec.notShown);
    return { kind: "not-shown", words, html: `<div class="rr-list"><h2>${esc(cleanWords(spec.title ?? "Nothing to draw"))}</h2><p>${esc(words)}</p></div>`, ms: now() - t0 };
  }
  try {
    const scene = layOut(spec);
    const svg = sceneToSvg(scene, spec);
    return { kind: "drawing", svg, scene, ms: now() - t0 };
  } catch (e) {
    if (e instanceof OverBudget) return { kind: "list", reason: e.why, html: listHtml(spec, e.why), ms: now() - t0 };
    throw e;
  }
}

export { LAYOUT_LIMITS };
