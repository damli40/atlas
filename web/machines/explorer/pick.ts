// X2: picking a part on the drawn machine. The picked box and its drawn lines get class "on" (lit), the boxes at
// the other ends of those lines "rel" (kept plain), and the root gets data-picked so explorer.css steps every other
// box and line back. Works on the SVG figure.mjs draws (items carry data-of / data-line). Types only besides DOM.

import type { Box } from "./model";

export function applyPick(root: Element, boxes: readonly Box[], id: string | null): void {
  const box = id ? boxes.find((b) => b.id === id) : undefined;
  const lit = new Set(box ? box.joins.filter((j) => j.drawn).map((j) => j.id) : []);
  const rel = new Set(box ? box.joins.filter((j) => j.drawn).map((j) => j.other) : []);
  for (const it of root.querySelectorAll(".ex-skid > .it")) {
    const of = it.getAttribute("data-of");
    const line = it.getAttribute("data-line");
    const on = Boolean(box) && ((of === id && line === null) || (line !== null && lit.has(line)));
    it.classList.toggle("on", on);
    it.classList.toggle("rel", Boolean(box) && !on && of !== null && line === null && rel.has(of));
  }
  if (box) root.setAttribute("data-picked", box.id);
  else root.removeAttribute("data-picked");
}
