// R8: the run acted out on the machine, at 1280, on the real page (models mocked, $0). Takes frames during the act, measures frame
// times with requestAnimationFrame and the running animations, then checks the end state is the drawing R7 left (threads, lamps,
// needle, red, ring), and that a key skips to it.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R8/act.mjs <out dir> [example|orders|py]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
const WHICH = process.argv[3] ?? "example";
mkdirSync(OUT, { recursive: true });
const FILES = { orders: ["../U3/inputs/orders.ts"], py: ["../U3/inputs/plan_cache.py"] };
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
/** The machine's drawing state: what R5's truth driver reads, plus the SVG's own markup with nothing the act adds. */
const state = (p) =>
  p.evaluate(() => {
    const svg = document.querySelector('[data-testid="machine"] svg');
    if (!svg) return null;
    const vis = (e) => getComputedStyle(e).visibility === "visible";
    const end = svg.querySelector(".m-end[data-ring]");
    return {
      ended: svg.hasAttribute("data-ended"),
      red: [...svg.querySelectorAll(".m-hit-only")].filter(vis).length,
      ran: [...svg.querySelectorAll(".m-thread[data-ran]")].map((t) => t.dataset.route).sort(),
      lamps: [...svg.querySelectorAll(".m-lamp[data-on]")].map((l) => l.dataset.lamp).sort(),
      needles: [...svg.querySelectorAll(".m-needle")].map((n) => n.style.transform),
      ring: end && vis(end) ? [end.dataset.ring, end.dataset.ringOn] : null,
      overlays: svg.querySelectorAll("[data-act], .m-head").length,
      animations: svg.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
      markup: svg.outerHTML.length,
    };
  });
async function reach(p) {
  await p.goto(process.env.BASE);
  if (WHICH !== "example") {
    await p.waitForSelector('[data-testid="u1-own"], [data-testid="u1-code"]');
    if (!(await p.$('[data-testid="u1-code"]'))) await p.click('[data-testid="u1-own"]');
    await p.fill('[data-testid="u1-code"]', readFileSync(new URL(FILES[WHICH][0], import.meta.url), "utf8"));
    await p.click('[data-testid="u1-draw"]');
    await p.waitForSelector('[data-testid="bench-stage"]');
    await p.waitForTimeout(400);
    await p.click('[data-testid="u1-bet-toggle"]');
  }
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.click(".u1-quiz > li .u1-opt >> nth=0");
  await p.waitForTimeout(200);
}
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
p.on("pageerror", (e) => say("no page error", false, e.message));
await reach(p);
// Frame times: every rAF delta from Lock in until the verdict is up.
await p.evaluate(() => {
  window.__frames = [];
  window.__anims = 0;
  window.__steps = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    if (document.querySelector('[data-testid="machine-act-step"]')?.textContent) (window.__actFrames ??= []).push(t - last);
    if (t - last > 25) (window.__slow ??= []).push({ at: Math.round(t), ms: Math.round((t - last) * 10) / 10, phase: document.querySelector('[data-testid="bench-stage"]')?.dataset.phase, caption: document.querySelector('[data-testid="machine-act-step"]')?.textContent ?? "" });
    last = t;
    const knurl = document.querySelector('[data-testid="machine"] .m-knurl');
    const turning = knurl ? knurl.getAnimations().length > 0 : false;
    if (turning && !window.__wasTurning) window.__turns = (window.__turns ?? 0) + 1;
    window.__wasTurning = turning;
    const burst = document.querySelectorAll('[data-testid="machine"] .m-act-flash').length > 0;
    if (burst && !window.__wasBurst) window.__flashes = (window.__flashes ?? 0) + 1;
    window.__wasBurst = burst;
    const label = document.querySelector('[data-testid="machine"] .m-act-ms')?.textContent;
    if (label && !(window.__labels ??= []).includes(label)) window.__labels.push(label);
    window.__anims = Math.max(window.__anims, document.getAnimations().length);
    const s = document.querySelector('[data-testid="machine-act-step"]')?.textContent ?? "";
    if (s && window.__steps[window.__steps.length - 1]?.words !== s) window.__steps.push({ at: Math.round(t), words: s });
    if (document.querySelector('[data-testid="bench-stage"]')?.dataset.phase !== "marked" || window.__frames.length < 5) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await p.click('[data-testid="u1-seal"]');
const t0 = Date.now();
await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "playing", null, { timeout: 60000 });
const tPlay = Date.now();
// No screenshots while measuring: a screenshot stalls the page's frames.
await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 30000 });
const tMarked = Date.now();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/${WHICH}-end.png` });
const end = await state(p);
const perf = await p.evaluate(() => {
  const f = window.__frames.slice(1);
  const s = [...f].sort((a, b) => a - b);
  return { frames: f.length, worst: Math.round(Math.max(...f) * 10) / 10, p95: Math.round(s[Math.floor(s.length * 0.95)] * 10) / 10, median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, over50: f.filter((x) => x > 50).length, over34: f.filter((x) => x > 34).length, maxAnimations: window.__anims, act: (() => { const a = (window.__actFrames ?? []).slice(1); const s = [...a].sort((x, y) => x - y); return { frames: a.length, worst: Math.round(Math.max(...a) * 10) / 10, p95: Math.round(s[Math.floor(s.length * 0.95)] * 10) / 10, over34: a.filter((x) => x > 34).length }; })(), seen: { wheelTurns: window.__turns ?? 0, flashes: window.__flashes ?? 0, dialLabels: window.__labels ?? [] }, steps: window.__steps, slow: window.__slow ?? [] };
});
say("the act's captions came from the run, in order", perf.steps.length >= 3, perf.steps.map((s) => s.words).join(" / "));
say("the act ran 3 to 6 s (Lock in to verdict, including the server's run)", tMarked - tPlay >= 2500 && tMarked - tPlay <= 9000, `${tMarked - tPlay} ms from playing to marked; ${tMarked - t0} ms from Lock in`);
say("no overlay left after the act", end.overlays === 0, JSON.stringify(end));
say("no animation still running on the machine 1.5 s after the verdict", end.animations === 0);
writeFileSync(`${OUT}/${WHICH}-act.json`, JSON.stringify({ perf, end, ms: { lockToPlaying: tPlay - t0, playingToMarked: tMarked - tPlay } }, null, 1));
await c.close();

// The film: the same act recorded as video at 1280 (frames are cut from it with ffmpeg; see the README).
{
  const cf = await b.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video-${WHICH}`, size: { width: 1280, height: 800 } } });
  const pf = await cf.newPage();
  await reach(pf);
  const t = Date.now();
  await pf.click('[data-testid="u1-seal"]');
  await pf.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 60000 });
  await pf.waitForTimeout(1800);
  writeFileSync(`${OUT}/video-${WHICH}/lock-at.txt`, `Lock in clicked; marked ${Date.now() - t - 1800} ms later\n`);
  await cf.close();
}

// The same run with a key pressed at once: the end state must be the same drawing.
const c2 = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p2 = await c2.newPage();
await reach(p2);
await p2.click('[data-testid="u1-seal"]');
await p2.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "playing", null, { timeout: 60000 });
await p2.waitForTimeout(1200);
await p2.keyboard.press("x");
const tk = Date.now();
await p2.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 30000 });
const skipMs = Date.now() - tk;
await p2.waitForTimeout(1500);
const skipped = await state(p2);
say("a key skips to the end state", skipMs < 1500, `${skipMs} ms after the key`);
const same = (a, b) => JSON.stringify({ ...a, animations: 0 }) === JSON.stringify({ ...b, animations: 0 });
say("skipped and played end states are the same drawing", same(end, skipped), JSON.stringify({ end, skipped }));
await p2.screenshot({ path: `${OUT}/${WHICH}-skipped-end.png` });
await c2.close();

// Reduced motion: nothing moves; the end state plus the step list as text.
const c3 = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const p3 = await c3.newPage();
await reach(p3);
await p3.click('[data-testid="u1-seal"]');
await p3.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 60000 });
await p3.waitForTimeout(800);
const reduced = await state(p3);
const list = await p3.$$eval('[data-testid="machine-act-list"] li', (x) => x.map((y) => y.textContent)).catch(() => []);
say("reduced motion: the step list is shown as text", list.length >= 3, list.join(" / "));
say("reduced motion: the same end drawing", same(end, { ...reduced, animations: 0 }) || JSON.stringify({ ...end, animations: 0, ended: 0 }) === JSON.stringify({ ...reduced, animations: 0, ended: 0 }), JSON.stringify(reduced));
await p3.screenshot({ path: `${OUT}/${WHICH}-reduced.png` });
await c3.close();
writeFileSync(`${OUT}/${WHICH}-checks.json`, JSON.stringify(out, null, 1));
await b.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
