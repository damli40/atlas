// Builds the evidence pages for the price pipe (D05-03) from the four data cases in pipe-cases.ts
// (two real runs, two fixtures built from real data), rendered with the real React component to
// static HTML. No model is called and no RPC is used: every case is read from committed evidence.
//
// Run: npx tsx tests/tools/pipe-pages.tsx
// Writes: tests/evidence/D05-03/pipe-<case>{,-light}.html, held moments of the count-2 story, and
// cases.json (what each page was drawn from).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { PricePipe } from "../../web/machines/pricepipe/PricePipe.tsx";
import { pipeModel } from "../../web/machines/pricepipe/model.ts";
import { pipeCases } from "./pipe-cases.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "tests/evidence/D05-03");

function machinesCss(): string {
  const dir = join(ROOT, "web/machines");
  return readFileSync(join(dir, "machines.css"), "utf8").replace(/@import "\.\/([^"]+)";/g, (_, p: string) => readFileSync(join(dir, p), "utf8"));
}

function page(title: string, body: string, theme: "light" | "dark"): string {
  const bg = theme === "light" ? "#f2f2ef" : "#0b0b0b";
  const ink = theme === "light" ? "#1d1d1b" : "#ececea";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;background:${bg};color:${ink};font:15px/1.5 system-ui,sans-serif;--ink:${ink}}main{max-width:720px;margin:0 auto;padding:24px 16px}
${machinesCss()}</style></head><body><main>${body}</main></body></html>`;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const cases = pipeCases();
  writeFileSync(
    join(OUT, "cases.json"),
    JSON.stringify(
      cases.map((c) => {
        const m = pipeModel(c);
        return { id: c.id, real: c.real, runId: c.run.id, controlPassed: c.run.controlPassed, measured: c.run.result.measured, notMeasured: c.run.result.notMeasured, references: c.run.result.references, callTrace: c.run.trace.filter((e) => e.event === "call_trace"), bets: c.bets.map((b) => ({ who: b.who, measures: b.measures, answer: b.answer })), verdicts: c.verdicts.map((v) => ({ betId: v.betId, outcome: v.outcome, reason: v.reason })), drawn: { slot: m.slot, inlets: m.inlets, readout: m.readout, price: m.price?.text ?? null, reference: m.reference?.text ?? null, ghosts: m.ghosts.map((g) => ({ who: g.who, usd: g.usd })), declined: m.declined } };
      }),
      null,
      2,
    ) + "\n",
  );
  for (const theme of ["dark", "light"] as const) {
    const sfx = theme === "light" ? "-light" : "";
    for (const c of cases) {
      const html = renderToStaticMarkup(<PricePipe run={c.run} bets={c.bets} verdicts={c.verdicts} still theme={theme} {...(c.captionOverride ? { captionOverride: c.captionOverride } : {})} />);
      writeFileSync(join(OUT, `pipe-${c.id}${sfx}.html`), page(`Price pipe ${c.id}`, html, theme));
    }
    // Held moments of the count-2 story (gear turning, outlet flow, needles mid-swing).
    const c2 = cases.find((c) => c.id === "pre-apply-count2")!;
    for (const [name, at] of [["mid-inlets", 0.5], ["mid-gear", 2.0], ["mid-needles", 3.9]] as const) {
      const html = renderToStaticMarkup(<PricePipe run={c2.run} bets={c2.bets} verdicts={c2.verdicts} still theme={theme} at={at} captionOverride={c2.captionOverride!} />);
      writeFileSync(join(OUT, `pipe-pre-apply-count2-${name}${sfx}.html`), page(`Price pipe count 2 ${name}`, html, theme));
    }
  }
  console.log(`wrote pages for ${cases.length} cases: ${cases.map((c) => `${c.id} (${pipeModel(c).readout})`).join("; ")}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
