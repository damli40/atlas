// D60 design captures: one round in the real app at a given size. Mock models, real server, real runs.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R3/design/shot.mjs <out dir> [w] [h] [input] [pick]
import { mkdirSync, readFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const [OUT, W = "1440", H = "900", input = "orders.ts", pick = "0"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const code = readFileSync(new URL(`../../U3/inputs/${input}`, import.meta.url), "utf8");
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: +W, height: +H } })).newPage();
p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await p.goto(process.env.BASE ?? "http://localhost:18962");
await p.waitForSelector('[data-testid="u1-code"]');
await p.fill('[data-testid="u1-code"]', code);
await p.click('[data-testid="u1-draw"]');
await p.waitForSelector('[data-testid="bench-stage"] svg');
await p.waitForTimeout(1200);
const tag = `${W}-${input.split(".")[0]}`;
await p.screenshot({ path: `${OUT}/chart-${tag}.png` });
await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.waitForTimeout(250);
await p.screenshot({ path: `${OUT}/bet-${tag}.png` });
for (const q of await p.$$(".u1-quiz > li")) {
  const o = await q.$$(".u1-opt");
  if (o[+pick]) await o[+pick].click();
}
await p.click('[data-testid="u1-seal"]');
await p.waitForSelector('[data-testid="bench-path"]', { timeout: 60000 });
await p.waitForTimeout(1800);
await p.screenshot({ path: `${OUT}/run-${tag}.png` });
await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 60000 });
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/verdict-${tag}.png` });
await b.close();
