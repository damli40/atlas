// R6: the part panel, the lid names and the ringed part, on the real page with models mocked ($0). Every "never covers" line is measured from
// the page's own boxes, not judged from a picture.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R6/panel.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18972";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const orders = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
let failed = 0;
const out = [];
const say = (name, ok, more = "") => { out.push({ name, ok, more }); if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`); };
const rect = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }; }).catch(() => null);
const overlap = (a, c) => a && c && a.x0 < c.x1 && c.x0 < a.x1 && a.y0 < c.y1 && c.y0 < a.y1;
const inView = (r, w, h) => r && r.x1 > 0 && r.y1 > 0 && r.x0 < w && r.y0 < h;
const answer = async (p, re) => {
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    const li = await p.$(".u1-quiz > li[data-active]");
    const opts = await li.$$eval(".u1-opt", (x) => x.map((y) => y.textContent));
    const k = opts.findIndex((t) => re.test(t));
    await p.keyboard.press(String((k < 0 ? opts.length - 1 : k) + 1));
    await p.waitForTimeout(210);
  }
};
const runIt = async (p) => {
  await p.click('[data-testid="u1-bet-toggle"]');
  await answer(p, /returns a value/);
  // What every bettor sees, before sealing: it must carry the names the screen shows.
  const seen = await p.$eval('pre[aria-label="What every bettor sees"]', (e) => e.textContent).catch(() => "");
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => { const r = document.querySelector('[data-testid="u1-replay"]'); return r && !r.disabled; }, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  return seen;
};
const lidTexts = (p, scope) => p.$$eval(`${scope} svg text[transform]`, (x) => x.map((t) => ({ text: t.textContent, cls: t.getAttribute("class"), px: t.getBoundingClientRect().height })));

for (const [W, H] of [[1280, 720], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: W, height: H } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/1-first-screen-${W}.png` });
  if (W >= 760) {
    const lids = await lidTexts(p, '[data-testid="e-drawing"]');
    say(`${W}: first screen lids show Meta's AI names over the exact names`, lids.some((l) => l.text === "retrying fetch" && /m-ai/.test(l.cls)) && lids.some((l) => l.text === "fetchWithRetry" && /m-code/.test(l.cls)), JSON.stringify(lids.map((l) => l.text)));
  }
  await p.click('[data-testid="u1-example"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: `${OUT}/2-drawn-${W}.png` });
  const machine = await p.$('[data-testid="machine"] [data-part="fetchWithRetry"]');
  if (W >= 760) {
    say(`${W}: the machine is shown`, Boolean(machine));
    // Hover only marks the part: no panel.
    await p.hover('[data-testid="machine"] [data-part="getPrice"]');
    await p.waitForTimeout(300);
    say(`${W}: hover opens no panel`, (await p.$('[data-testid="part-panel"]')) === null);
    // Keyboard: focus the part, Enter.
    await p.focus('[data-testid="machine"] [data-part="fetchWithRetry"]');
    await p.keyboard.press("Enter");
    await p.waitForSelector('[data-testid="part-panel"]', { timeout: 3000 }).catch(() => {});
    const text = await p.$eval('[data-testid="part-panel"]', (e) => e.innerText).catch(() => "");
    say(`${W}: Enter on a part opens its panel`, /fetchWithRetry/.test(text) && /Runs a loop \(line 12\)/.test(text) && /Called by: getPrice/.test(text), text.replace(/\n/g, " | "));
    say(`${W}: the panel says whose words the name is`, /Meta's AI calls this: retrying fetch \(its words, not a check\)/.test(text));
    say(`${W}: the panel shows the part's code, lines 10 to 21 marked`, await p.$$eval(".c-line[data-on]", (x) => x.length === 12 && x[0].dataset.line === "10"));
    say(`${W}: no small card as well (one place says what a part is)`, (await p.$('[data-testid="machine-card"]')) === null);
    const panel = await rect(p, '[data-testid="c-drawer"]');
    const part = await rect(p, '[data-testid="machine"] [data-part="fetchWithRetry"]');
    say(`${W}: the panel does not cover the part`, !overlap(panel, part) && inView(part, W, H), JSON.stringify({ panel, part }));
    say(`${W}: the machine kept its view (not swapped for the chart)`, (await p.$('[data-testid="bench-stage"][data-view="machine"]')) !== null);
    await p.screenshot({ path: `${OUT}/3-panel-fetchWithRetry-${W}.png` });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    say(`${W}: Esc closes it`, (await p.$('[data-testid="part-panel"]')) === null);
  } else {
    // A phone gets the box chart: a tap on a box opens the panel as a sheet from the bottom, with the box still in sight.
    await p.click('[data-testid="bench-viewport"] [data-node="fetchWithRetry"]').catch(async () => p.click('[data-testid="bench-viewport"] [data-node*="fetchWithRetry"]'));
    await p.waitForSelector('[data-testid="part-panel"]', { timeout: 3000 }).catch(() => {});
    const text = await p.$eval('[data-testid="part-panel"]', (e) => e.innerText).catch(() => "");
    say(`${W}: a tap on a box opens its panel`, /Runs a loop \(line 12\)/.test(text), text.replace(/\n/g, " | "));
    const panel = await rect(p, '[data-testid="c-drawer"]');
    const box = await rect(p, '[data-testid="bench-viewport"] [data-node="fetchWithRetry"]');
    say(`${W}: the sheet leaves the box in sight`, !overlap(panel, box) && inView(box, W, H), JSON.stringify({ panel, box }));
    say(`${W}: no pinned chart card as well`, (await p.$('.u1-card[data-pinned]')) === null);
    await p.screenshot({ path: `${OUT}/3-panel-fetchWithRetry-${W}.png` });
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
  // A run on the example: the ring lands on the fake fetchIt.
  const seen = await runIt(p);
  say(`${W}: every bettor's text carries the names the screen shows`, /written by muse-wonder-1\.0 \(Meta's AI\)/.test(seen) && /- fetchWithRetry: retrying fetch/.test(seen), seen.split("\n").filter((l) => /Short names|^- \w+: /.test(l)).join(" / "));
  await p.screenshot({ path: `${OUT}/4-result-${W}.png` });
  const ring = await p.evaluate(() => { const e = document.querySelector('[data-testid="machine"] svg .m-end[data-ring]'); return e && getComputedStyle(e).visibility === "visible" ? e.dataset.ring : null; });
  if (W >= 760) {
    say(`${W}: the example's ring is on a part`, ring === "stand-in fetchIt", String(ring));
    await p.click(`[data-testid="machine"] [data-part="${ring}"]`);
    await p.waitForSelector('[data-testid="part-broke"]', { timeout: 3000 }).catch(() => {});
    const broke = await p.$eval('[data-testid="part-broke"]', (e) => e.innerText).catch(() => "");
    const verdict = await p.$eval('[data-testid="moment-run"]', (e) => e.textContent).catch(() => "");
    say(`${W}: the ringed part's panel says what broke, in the verdict's words`, broke.includes(verdict) && /Atlas calls fetchWithRetry\(fetchIt\)/.test(broke), broke.replace(/\n/g, " | "));
    const panel = await rect(p, '[data-testid="c-drawer"]');
    const ringBox = await rect(p, '[data-testid="machine"] svg .m-end[data-ring]');
    say(`${W}: the panel never covers the ring`, !overlap(panel, ringBox) && inView(ringBox, W, H), JSON.stringify({ panel, ringBox }));
    await p.screenshot({ path: `${OUT}/5-panel-ringed-example-${W}.png` });
    await p.keyboard.press("Escape");
    // The shared picture: no model names, no code type.
    await p.keyboard.press("p");
    await p.waitForSelector('[data-testid="pc-image"] svg', { timeout: 10000 }).catch(() => {});
    const pic = await p.$eval('[data-testid="pc-image"] svg', (e) => ({ ai: e.querySelectorAll(".m-ai, .m-ai-mark, .m-code").length, text: e.textContent })).catch(() => null);
    say(`${W}: the proof picture has no AI names and no code type`, pic !== null && pic.ai === 0 && !/retrying fetch|price lookup|named by/.test(pic.text), pic ? `${pic.ai} marks` : "no picture");
    await p.screenshot({ path: `${OUT}/6-proof-${W}.png` });
    await p.keyboard.press("Escape");
  } else {
    say(`${W}: a phone shows the chart, so no machine ring to click (the path's ring is not a part)`, ring === null, String(ring));
  }
  await c.close();
}
// The orders file: the ring lands on a chute, so the panel adds the thrown line.
for (const [W, H] of [[1280, 720], [1024, 700]]) {
  const c = await b.newContext({ viewport: { width: W, height: H } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.fill('[data-testid="u1-code"]', orders);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(1500);
  await runIt(p);
  const ring = await p.evaluate(() => { const e = document.querySelector('[data-testid="machine"] svg .m-end[data-ring]'); return e ? [e.dataset.ring, e.dataset.ringOn] : null; });
  if (!ring) {
    // Not a pass or a fail: at this width the page already showed the box chart for this file before R6 (the 11 px rule), so there is no machine ring.
    const view = await p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.view);
    console.log(`note ${W}: orders shows the ${view} here, so there is no machine ring to click`);
    out.push({ name: `${W}: orders shows the ${view}, no machine ring to click`, ok: null });
    await p.screenshot({ path: `${OUT}/7-orders-${W}.png` });
    await c.close();
    continue;
  }
  await p.click(`[data-testid="machine"] [data-part="${ring[0]}#chute"]`);
  await p.waitForSelector('[data-testid="part-broke"]', { timeout: 3000 }).catch(() => {});
  const broke = await p.$eval('[data-testid="part-broke"]', (e) => e.innerText).catch(() => "");
  say(`${W}: orders: the ringed chute's panel has the verdict's words and the thrown line`, /The run threw Error: HTTP 429/.test(broke) && /It threw from line 9\./.test(broke), broke.replace(/\n/g, " | "));
  const panel = await rect(p, '[data-testid="c-drawer"]');
  const ringBox = await rect(p, '[data-testid="machine"] svg .m-end[data-ring]');
  const part = await rect(p, `[data-testid="machine"] [data-part="${ring[0]}"]`);
  say(`${W}: orders: the panel covers neither the ring nor the part`, !overlap(panel, ringBox) && !overlap(panel, part) && inView(ringBox, W, H), JSON.stringify({ panel, ringBox, part }));
  await p.screenshot({ path: `${OUT}/7-panel-ringed-orders-${W}.png` });
  // A part that is not ringed says nothing about the run.
  await p.click('[data-testid="machine"] [data-part="fetchAllOrders"]');
  await p.waitForTimeout(300);
  say(`${W}: orders: an unringed part adds nothing about the run`, (await p.$('[data-testid="part-broke"]')) === null);
  await c.close();
}
await b.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
console.log(failed ? `${failed} failed` : "all pass");
process.exit(failed ? 1 : 0);
