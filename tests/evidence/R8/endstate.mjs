// R8: the machine's end state on the page, as markup, after the run lands: hashed so it can be compared with another build of the page
// (main before R8). The act must leave exactly the drawing that was there before. Models mocked, $0.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R8/endstate.mjs <label>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const b = await chromium.launch({ executablePath: process.env.CHROME });
const orders = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
const py = readFileSync(new URL("../U3/inputs/plan_cache.py", import.meta.url), "utf8");
for (const [name, code] of [["example", null], ["orders", orders], ["py", py]]) {
  for (const reduced of [false, true]) {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 }, ...(reduced ? { reducedMotion: "reduce" } : {}) });
    const p = await c.newPage();
    await p.goto(process.env.BASE);
    if (code) {
      await p.waitForSelector('[data-testid="u1-own"], [data-testid="u1-code"]');
      if (!(await p.$('[data-testid="u1-code"]'))) await p.click('[data-testid="u1-own"]');
      await p.fill('[data-testid="u1-code"]', code);
      await p.click('[data-testid="u1-draw"]');
      await p.waitForSelector('[data-testid="bench-stage"]');
      await p.waitForTimeout(400);
      await p.click('[data-testid="u1-bet-toggle"]');
    }
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await p.waitForTimeout(1500);
    await p.click(".u1-quiz > li .u1-opt >> nth=0");
    await p.click('[data-testid="u1-seal"]');
    await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 60000 });
    await p.waitForTimeout(2000);
    const svg = await p.$eval('[data-testid="machine"] svg', (e) => e.outerHTML).catch(() => "no machine");
    console.log(`${process.argv[2]} ${name}${reduced ? " reduced" : ""} ${createHash("sha256").update(svg).digest("hex").slice(0, 16)} ${svg.length}`);
    await c.close();
  }
}
await b.close();
