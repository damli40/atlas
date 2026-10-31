// R3: one plate per page, from saved specs: ?view=path|bet|chart|meta|retry|moonwell|always500 &theme=dark &play=1
import data from "../../tests/fixtures/r3/specs.json";
import { drawSpec } from "../live/draw";
import { mountDrawing } from "../live/mount";
import type { RenderSpec } from "../spec";
import { fontsReady, installStyle } from "./assets";

const q = new URLSearchParams(location.search);
installStyle();
await fontsReady();
const spec = (data.specs as unknown as Record<string, RenderSpec>)[q.get("view") ?? "path"]!;
const host = document.getElementById("plate")!;
const drawn = drawSpec(spec);
const m = mountDrawing(host, drawn, spec, { theme: q.get("theme") === "dark" ? "dark" : "light" });
Object.assign(window, { __drawn: { kind: drawn.kind, ms: drawn.ms, hidden: drawn.kind === "drawing" ? drawn.scene.hiddenLabels : 0 }, __mount: m });
if (q.get("play") && m.player) {
  await (spec.steps.length ? m.player.playSteps() : m.player.entrance());
  for (const mark of spec.marks) await m.player.landMark(mark);
  m.player.showCaptions();
}
document.body.dataset.ready = "1";
