// The example and orders results, at both sizes, betting that each returns: the ring should land where the run ended. Models mocked, $0.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R5/ring-shots.mjs <out dir>
import { mkdirSync, readFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18942";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const orders = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  for (const name of ["example", "orders"]) {
    const c = await b.newContext({ viewport: { width: w, height: h } });
    const p = await c.newPage();
    await p.goto(BASE);
    if (name === "example") await p.click('[data-testid="u1-example"]');
    else {
      await p.fill('[data-testid="u1-code"]', orders);
      await p.click('[data-testid="u1-draw"]');
    }
    await p.waitForSelector('[data-testid="bench-stage"]');
    await p.waitForTimeout(400);
    await p.click('[data-testid="u1-bet-toggle"]');
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await p.waitForTimeout(250);
    const n = (await p.$$(".u1-quiz > li")).length;
    for (let i = 0; i < n; i++) {
      const li = await p.$(".u1-quiz > li[data-active]");
      const q = await li.$eval(".u1-q", (e) => e.textContent);
      const opts = await li.$$eval(".u1-opt", (x) => x.map((y) => y.textContent));
      const k = opts.findIndex((t) => /returns a value/.test(t));
      await p.keyboard.press(String((k < 0 ? opts.length - 1 : k) + 1));
      await p.waitForTimeout(210);
    }
    await p.click('[data-testid="u1-seal"]');
    await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
    await p.waitForFunction(() => { const r = document.querySelector('[data-testid="u1-replay"]'); return r && !r.disabled; }, null, { timeout: 30000 });
    await p.waitForTimeout(1200);
    const s = await p.evaluate(() => { const e = document.querySelector('[data-testid="machine"] svg .m-end[data-ring]'); return { ring: e && getComputedStyle(e).visibility === "visible" ? [e.dataset.ring, e.dataset.ringOn] : null, run: document.querySelector('[data-testid="moment-run"]')?.textContent }; });
    console.log(name, w, JSON.stringify(s));
    await p.screenshot({ path: `${OUT}/${name}-result-${w}x${h}.png` });
    await c.close();
  }
}
await b.close();
