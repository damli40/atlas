// R7: counts the visible clickable controls on the three screens a new person meets (first screen, the bet, the result),
// measured on the page itself. Models mocked ($0).
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R7/count.mjs <out dir> <before|after>
// "before" walks the R6 page (main 1314c62): Draw the example, Bet on what it does, answer every question, Seal.
// "after" walks the R7 page: the example and its question are already there; answer it, Lock in my bet.
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const [OUT, MODE] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const controls = (p) =>
  p.evaluate(() => {
    const seen = [];
    const sel = 'button, a[href], summary, input:not([type="hidden"]):not([type="file"]), textarea, select, label:has(> input[type="file"]), [role="radio"], [role="button"]';
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (r.width < 1 || r.height < 1 || cs.visibility !== "visible" || e.closest("[inert], [aria-hidden='true']")) continue;
      // Inside a closed fold: not on screen, whatever its box says.
      let folded = false;
      for (let d = e.closest("details"); d; d = d.parentElement?.closest("details") ?? null) if (!d.open && !(e.matches("summary") && e.parentElement === d)) folded = true;
      if (folded) continue;
      // The machine's own parts are the drawing, not controls around it: counted apart.
      if (e.closest("svg [data-part], svg")) {
        seen.push({ el: e, words: "(a part of the drawing)" });
        continue;
      }
      if (e.matches("button, input, textarea, select") && e.disabled) continue;
      if (seen.some((s) => s.el.contains(e) && s.el !== e && s.el.matches("button, a"))) continue;
      seen.push({ el: e, words: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.tagName).trim().replace(/\s+/g, " ").slice(0, 60) });
    }
    return seen.map((s) => s.words);
  });
const result = {};
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  await p.goto(process.env.BASE);
  if (MODE === "before") {
    await p.waitForSelector('[data-testid="u1-example"]');
    await p.waitForTimeout(800);
    result[`first-${w}`] = await controls(p);
    await p.screenshot({ path: `${OUT}/${MODE}-first-${w}.png` });
    await p.click('[data-testid="u1-example"]');
    await p.waitForSelector('[data-testid="u1-bet-toggle"]');
    await p.waitForTimeout(500);
    result[`drawn-${w}`] = await controls(p);
    await p.click('[data-testid="u1-bet-toggle"]');
  }
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(800);
  result[`bet-${w}`] = await controls(p);
  // R7: the first screen IS the bet (the example, drawn, with its one question): the same controls.
  if (MODE === "after") result[`first-${w}`] = result[`bet-${w}`];
  await p.screenshot({ path: `${OUT}/${MODE}-bet-${w}.png` });
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("1");
    await p.waitForTimeout(220);
  }
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);
  result[`result-${w}`] = await controls(p);
  await p.screenshot({ path: `${OUT}/${MODE}-result-${w}.png` });
  await c.close();
}
await b.close();
const summary = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { controls: v.filter((x) => x !== "(a part of the drawing)").length, drawingParts: v.filter((x) => x === "(a part of the drawing)").length }]));
writeFileSync(`${OUT}/count-${MODE}.json`, JSON.stringify({ summary, controls: result }, null, 2));
console.log(JSON.stringify(summary));
