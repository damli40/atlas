// E3: builds the call timeline's evidence pages from REAL runs (tests/tools/timeline-cases.ts, played through the
// server in-process; no model is called) and renders the real component to static HTML: the end state of every
// case in dark and light, and two held moments of the first case. The Anatomy line-end check (scripts/lines.mjs)
// and screenshots are taken from these pages.
//
// Run: npx tsx tests/tools/timeline-pages.tsx [out dir]   (default tests/evidence/E3/timeline)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../../server/app.ts";
import { CallTimeline } from "../../web/machines/calltimeline/CallTimeline.tsx";
import { TIMELINE_CASES, playCase } from "./timeline-cases.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(process.argv[2] ?? join(ROOT, "tests/evidence/E3/timeline"));
mkdirSync(OUT, { recursive: true });

function css(): string {
  const dir = join(ROOT, "web/machines");
  return readFileSync(join(dir, "machines.css"), "utf8").replace(/@import "\.\/([^"]+)";/g, (_, p: string) => readFileSync(join(dir, p), "utf8"));
}
const page = (title: string, body: string, theme: "dark" | "light") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:24px;background:${theme === "dark" ? "#151514" : "#f7f7f5"};color:${theme === "dark" ? "#ececea" : "#1d1d1b"};font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto}.muted{opacity:.75}.small{font-size:13px}.card{border:1px solid #888;border-radius:10px;padding:14px}
${css()}</style></head><body><main>${body}</main></body></html>`;

const app = createApp();
const played = [];
for (const c of TIMELINE_CASES) played.push(await playCase(app, c));
writeFileSync(join(OUT, "runs.json"), JSON.stringify(played.map((p) => ({ id: p.id, what: p.what, runId: p.run.id, controlPassed: p.run.controlPassed, trace: p.run.trace, measured: p.run.result.measured, notMeasured: p.run.result.notMeasured })), null, 2) + "\n");
for (const theme of ["dark", "light"] as const) {
  const sfx = theme === "light" ? "-light" : "";
  for (const p of played) writeFileSync(join(OUT, `timeline-${p.id}${sfx}.html`), page(`Call timeline ${p.id}`, renderToStaticMarkup(<CallTimeline run={p.run} still theme={theme} />), theme));
  const first = played[0]!;
  for (const [name, at] of [["at-0ms", 0], ["at-50ms", 50]] as const) {
    writeFileSync(join(OUT, `timeline-${first.id}-${name}${sfx}.html`), page(`Call timeline ${first.id} ${name}`, renderToStaticMarkup(<CallTimeline run={first.run} theme={theme} at={at} />), theme));
  }
}
// A run whose known-case check did not match: nothing is drawn (the card prints the reason).
const broken = { ...played[0]!.run, controlPassed: false, result: { ...played[0]!.run.result, notMeasured: { ...played[0]!.run.result.notMeasured, control: "case C3: virtualMs 101, expected 100 (a test breaking the harness on purpose)" } } };
writeFileSync(join(OUT, "timeline-control-failed.html"), page("Call timeline, control failed", renderToStaticMarkup(<CallTimeline run={broken} still theme="dark" />), "dark"));
console.log(`wrote ${played.length} cases × 2 themes + held moments + control-failed to ${OUT}`);
for (const p of played) console.log(`${p.id}: control ${p.run.controlPassed ? "matched" : "did not match"}; outcome ${String(p.run.result.measured.outcome)}; virtualMs ${String(p.run.result.measured.virtualMs ?? "-")}`);
process.exit(0);
