// R9: the first screen with the file summary, at 1280×800 and 1440×900 (and 390×844 for the phone), with checks made on the page itself:
// the summary is visible before the bet and labelled as Meta's AI's words, "Lock in my bet" is fully on screen and not covered (with the
// part lines folded and unfolded), the example's AI answers are still labelled recorded, a part line opens that part's panel with its line
// marked as the AI's words, and the sample files sit under the paste box with the consent line visible. Models mocked ($0); the example's
// summary and answers are the kept recordings, replayed by the server.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R9/shots.mjs <out dir>
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const text = (p, sel) => p.$eval(sel, (e) => e.textContent ?? "").catch(() => null);
const onScreen = (p, sel) =>
  p.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const inView = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
    return { inView, uncovered: !!hit && (hit === el || el.contains(hit)), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  const p = await c.newPage();
  p.on("pageerror", (e) => say(`${w}: no page error`, false, e.message));
  await p.goto(process.env.BASE);
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForSelector('[data-testid="file-summary"]', { timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => /recorded answer/.test(document.querySelector('[data-testid="u1-ais"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/1-first-screen-${w}x${h}.png` });
  const legend = (await text(p, '[data-testid="file-summary-legend"]')) ?? "";
  say(`${w}x${h}: the summary is shown before the bet`, (await p.isVisible('[data-testid="file-summary-text"]')) && /flaky source/.test((await text(p, '[data-testid="file-summary-text"]')) ?? ""));
  say(`${w}x${h}: it is labelled as Muse Wonder's words (Meta's AI), not a check`, legend === "Summary: Muse Wonder's words (Meta's AI), not a check", legend);
  const seal = await onScreen(p, '[data-testid="u1-seal"]');
  say(`${w}x${h}: "Lock in my bet" is fully on screen and not covered`, seal.inView && seal.uncovered, JSON.stringify(seal));
  const ais = (await text(p, '[data-testid="u1-ais"]')) ?? "";
  say(`${w}x${h}: the AIs' answers are still the recorded ones, labelled with their day`, /recorded answer \(Nov 2\)/.test(ais) && /Not live/.test(ais), ais);
  if (w >= 1280) {
    const sum = await p.$eval('[data-testid="file-summary"]', (e) => e.getBoundingClientRect().toJSON());
    const svg = await p.$eval('[data-testid="machine"] svg', (e) => e.getBoundingClientRect().toJSON()).catch(() => null);
    say(`${w}x${h}: the summary strip does not sit on the drawing`, svg !== null && sum.bottom <= svg.top + 1, JSON.stringify({ sumBottom: Math.round(sum.bottom), svgTop: svg && Math.round(svg.top) }));
    await p.click('[data-testid="file-summary-parts"] > summary');
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/2-part-lines-open-${w}x${h}.png` });
    const lines = await p.$$eval('[data-testid="file-summary-parts"] li', (x) => x.map((y) => y.textContent));
    say(`${w}x${h}: one line per drawn part, keyed by its name`, lines.length === 4, JSON.stringify(lines));
    const seal2 = await onScreen(p, '[data-testid="u1-seal"]');
    say(`${w}x${h}: with the part lines open, "Lock in my bet" is still on screen`, seal2.inView && seal2.uncovered, JSON.stringify(seal2));
    await p.click('[data-testid="file-summary-part-fetchWithRetry"]');
    await p.waitForSelector('[data-testid="part-summary"]', { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/3-part-panel-${w}x${h}.png` });
    const panel = (await text(p, '[data-testid="part-summary"]')) ?? "";
    say(`${w}x${h}: a part line opens that part's panel, with its line marked as the AI's words`, /^Meta's AI says this part: .+ \(its words, not a check\)$/.test(panel), panel);
  }
  if (w === 1280) {
    // Task 2: the sample files under the paste box, with the consent line on screen.
    await p.goto(process.env.BASE);
    await p.waitForSelector('[data-testid="u1-own"]', { timeout: 60000 });
    await p.click('[data-testid="u1-own"]');
    await p.waitForSelector('[data-testid="e-samples"]', { timeout: 10000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/4-samples-${w}x${h}.png` });
    say(`${w}x${h}: "No file handy? Try one of these" is under the paste box`, /No file handy\? Try one of these/.test((await text(p, '[data-testid="e-samples"]')) ?? ""));
    say(`${w}x${h}: the consent line is shown on the page`, await p.isVisible('[data-testid="e-consent"]'));
    const near = await onScreen(p, '[data-testid="e-samples-consent"]');
    say(`${w}x${h}: the samples' own consent line is on screen beside them`, near.inView && near.uncovered, JSON.stringify(near));
    const bodies = [];
    p.on("request", (r) => r.url().endsWith("/paste") && bodies.push(r.postData()));
    await p.click('[data-testid="e-sample-price-parser"]');
    await p.waitForSelector('[data-testid="file-summary"]', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/5-sample-drawn-${w}x${h}.png` });
    say(`${w}x${h}: a sample goes through the normal paste (POST /paste)`, bodies.length === 1 && /parse_prices/.test(bodies[0] ?? ""));
    say(`${w}x${h}: the sample's summary (mocked here) is shown, labelled`, /Muse Wonder's words/.test((await text(p, '[data-testid="file-summary-legend"]')) ?? ""));
  }
  await c.close();
}
await b.close();
writeFileSync(`${OUT}/checks.json`, JSON.stringify(out, null, 2));
console.log(failed ? `${failed} FAILED` : `all ${out.length} passed`);
process.exit(failed ? 1 : 0);
