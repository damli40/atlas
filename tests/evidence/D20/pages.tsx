// D20: static pages of the Change screen and of the price pipe for the theoretical replay, drawn by the
// real React components (web/screens/Change.tsx ChangeResult, web/machines/pricepipe/PricePipe.tsx) from
// change-answer.json (written by live-replay.ts). No model, no RPC. The proof card is captured from the
// real running app instead (shoot.mjs).
//
// Run: pnpm exec tsx tests/evidence/D20/pages.tsx
// Writes tests/evidence/D20/change.html and pipe-replay.html.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeResult } from "../../../web/screens/Change.tsx";
import { PricePipe } from "../../../web/machines/pricepipe/PricePipe.tsx";
import { theoryCaptions } from "../../../src/change.ts";
import { formatUsd1e18 } from "../../../src/units.ts";
import type { FormatValue } from "../../../web/screens/Verdict.tsx";
import type { ChangeAnswer } from "../../../server/changes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const answer = JSON.parse(readFileSync(join(HERE, "change-answer.json"), "utf8")) as Extract<ChangeAnswer, { ok: true }>;
const usd: FormatValue = (m, v) => (/^(priceUsd1e18|preApplyPriceUsd1e18|refUsd1e18):/.test(m) && typeof v === "string" && /^-?\d+$/.test(v) ? formatUsd1e18(BigInt(v)) : String(v));

const css = () => {
  const dir = join(ROOT, "web/machines");
  const machines = readFileSync(join(dir, "machines.css"), "utf8").replace(/@import "\.\/([^"]+)";/g, (_, p: string) => readFileSync(join(dir, p), "utf8"));
  return readFileSync(join(ROOT, "web/styles.css"), "utf8") + "\n" + machines;
};
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css()}\nbody{margin:0}main{max-width:980px;margin:0 auto;padding:24px 16px}</style></head><body><main>${body}</main></body></html>`;

const change = renderToStaticMarkup(
  <section className="card" aria-label="change and re-run" data-testid="change">
    <h2>5. Change it toward what you expected</h2>
    <ChangeResult answer={answer} format={usd} />
  </section>,
);
writeFileSync(join(HERE, "change.html"), page("D20 change and theoretical replay", change));
const pipe = renderToStaticMarkup(<PricePipe run={answer.replay} bets={answer.bets} verdicts={answer.after.verdicts} still theme="dark" theory={theoryCaptions(answer.change)} />);
writeFileSync(join(HERE, "pipe-replay.html"), page("D20 price pipe, theoretical replay", pipe));
console.log("wrote change.html and pipe-replay.html");
