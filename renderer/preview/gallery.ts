// R3: one plate per page, from saved specs: ?view=path|bet|chart|meta|retry|moonwell|always500 &theme=dark &play=1
import data from "../../tests/fixtures/r3/specs.json";
import { drawInWorker } from "../live/client";
import { drawSpec } from "../live/draw";
import { mountDrawing } from "../live/mount";
import type { RenderSpec } from "../spec";
import { textWidth } from "../words";
import { fontsReady, installStyle } from "./assets";

const q = new URLSearchParams(location.search);
installStyle();
await fontsReady();
// ?view=stress draws the budget case the brief names, 40 parts and 90 joins, from a seeded generator.
function stress(): RenderSpec {
  let a = 12345;
  const R = () => ((a = (a * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, kind: "ticket" as const, words: `part${i}`, small: `lines ${i * 7 + 1}-${i * 7 + 6}`, provenance: "plain-code" as const }));
  const edges = Array.from({ length: 90 }, (_, i) => {
    const f = Math.floor(R() * 40);
    return { id: `e${i}`, from: `n${f}`, to: `n${Math.min(39, f + 1 + Math.floor(R() * 6))}`, words: R() < 0.3 ? "calls" : undefined, kind: "thread" as const, provenance: "plain-code" as const };
  });
  return { version: 1, stage: "pre-bet", seed: "stress", title: "40 parts, 90 joins", nodes, edges, regions: [], marks: [], captions: [], steps: [] } as unknown as RenderSpec;
}
const view = q.get("view") ?? "path";
const spec = view === "stress" ? stress() : (data.specs as unknown as Record<string, RenderSpec>)[view]!;
const host = document.getElementById("plate")!;
const drawn = q.get("worker") ? await drawInWorker(spec) : drawSpec(spec, { narrow: innerWidth < 600 });
const t0 = performance.now();
const m = mountDrawing(host, drawn, spec, { theme: q.get("theme") === "dark" ? "dark" : "light" });
// Until the browser has really put it on screen: two animation frames after the SVG goes in.
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
Object.assign(window, { __drawn: { kind: drawn.kind, ms: drawn.ms, onScreenMs: performance.now() - t0, hidden: drawn.kind === "drawing" ? drawn.scene.hiddenLabels : 0 }, __mount: m });
if (q.get("play") && m.player) {
  await (spec.steps.length ? m.player.playSteps() : m.player.entrance());
  for (const mark of spec.marks) await m.player.landMark(mark);
  m.player.showCaptions();
}
// What the browser really measures, for the evidence: how far each word's drawn width is from the font table's.
Object.assign(window, {
  __measure() {
    if (drawn.kind !== "drawing") return null;
    const texts = [...host.querySelectorAll<SVGTextElement>("text")];
    let worst = 0;
    for (const t of texts) {
      const want = textWidth(t.textContent ?? "", Number(t.getAttribute("font-size")), t.classList.contains("rr-i") ? "italic" : "regular");
      worst = Math.max(worst, Math.abs(t.getComputedTextLength() - want));
    }
    return { texts: texts.length, worstPx: worst };
  },
});
document.body.dataset.ready = "1";
