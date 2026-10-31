// R3 evidence: drives the built preview in headless Chromium. Screenshots, the hero film, click to skip, reduced motion,
// the keyboard, timings, and the browser's own text measure. No server of Atlas's; no model; $0.
//
//   npx vite build --config renderer/preview/vite.config.ts && npx vite preview --config renderer/preview/vite.config.ts --port 18941 --strictPort &
//   PW=<playwright-core index.mjs> CHROME=<headless shell> AXE=<axe.min.js> node tests/evidence/R3/drive.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const out = process.argv[2];
const shots = `${out}/screens`;
mkdirSync(shots, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18941";
const AXE = process.env.AXE ? readFileSync(process.env.AXE, "utf8") : null;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const log = {};
const problems = [];
const watch = (p) => {
  p.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
};

// ---- plates ----
for (const [vw, vh] of [[1920, 1080], [390, 844]]) {
  for (const theme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width: vw, height: vh } });
    watch(p);
    for (const v of ["path", "always500", "bet", "chart", "meta", "retry", "moonwell", "stress"]) {
      if (vw === 390 && theme === "dark" && v !== "path") continue;
      await p.goto(`${BASE}/index.html?view=${v}&theme=${theme}`);
      await p.waitForSelector('body[data-ready="1"]');
      await p.waitForTimeout(150);
      const info = await p.evaluate(() => ({ ...window.__drawn, measure: window.__measure() }));
      log[`${v}-${vw}-${theme}`] = info;
      await p.screenshot({ path: `${shots}/${v}-${vw}-${theme}.png` });
      if (vw === 390 && (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))) problems.push(`${v} scrolls sideways at 390 px`);
    }
    await p.close();
  }
}

// ---- 40 parts + 90 joins: time to draw, in the page and in the Worker; pan and zoom keep working ----
{
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(p);
  const runs = [];
  for (let i = 0; i < 5; i++) {
    await p.goto(`${BASE}/index.html?view=stress`);
    await p.waitForSelector('body[data-ready="1"]');
    runs.push(await p.evaluate(() => window.__drawn));
  }
  log.stress = { layoutAndSvgMsEach: runs.map((r) => Math.round(r.ms)), thenOnScreenMsEach: runs.map((r) => Math.round(r.onScreenMs)), hiddenWords: runs[0].hidden };
  await p.goto(`${BASE}/index.html?view=stress&worker=1`);
  await p.waitForSelector('body[data-ready="1"]');
  log.stressWorker = await p.evaluate(() => window.__drawn);
  const before = await p.evaluate(() => document.querySelector("svg").getAttribute("viewBox"));
  await p.mouse.move(900, 500);
  await p.mouse.down();
  await p.mouse.move(700, 400, { steps: 4 });
  await p.mouse.up();
  const panned = await p.evaluate(() => document.querySelector("svg").getAttribute("viewBox"));
  await p.keyboard.press("Tab");
  await p.keyboard.press("0");
  log.pan = { before, panned, moved: before !== panned };
  if (before === panned) problems.push("dragging did not pan");
  await p.close();
}

// ---- the hero: every stage, light and dark, 1920 and 390; a video of the whole journey ----
const heroStages = async (vw, vh, theme, pick, tag) => {
  const p = await b.newPage({ viewport: { width: vw, height: vh } });
  watch(p);
  await p.goto(`${BASE}/hero.html?theme=${theme}`);
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${shots}/hero-1-drawing-${tag}.png` });
  await p.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${shots}/hero-2-bet-${tag}.png` });
  if (AXE) {
    await p.evaluate(AXE);
    const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((x) => `${x.id}: ${x.nodes.length}`));
    log[`axe-${tag}`] = v;
  }
  await p.click(`[data-option="${pick}"]`);
  await p.waitForTimeout(4200);
  await p.screenshot({ path: `${shots}/hero-3-run-${tag}.png` });
  await p.waitForSelector('body[data-done="1"]', { timeout: 60000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${shots}/hero-4-verdict-${tag}.png` });
  if (vw === 390 && (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth))) problems.push(`hero scrolls sideways at 390 px`);
  await p.close();
};
await heroStages(1920, 1080, "light", "b", "1920-light-didnt-match");
await heroStages(1920, 1080, "light", "c", "1920-light-matched");
await heroStages(1920, 1080, "dark", "b", "1920-dark-didnt-match");
await heroStages(390, 844, "light", "c", "390-light-matched");

// The film, two ways. Playwright's own recorder (asked for) has a low fixed bitrate that tints flat paper in its first seconds, so
// the same journey is also captured frame by frame through Chromium's screencast and encoded cleanly by ffmpeg.
const journey = async (p) => {
  await p.goto(`${BASE}/hero.html`);
  await p.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await p.waitForTimeout(1800);
  for (const [i, opt] of ["b", "c"].entries()) {
    await p.hover(`[data-option="${opt}"]`);
    await p.waitForTimeout(400);
    await p.click(`[data-option="${opt}"]`);
    await p.waitForSelector('body[data-done="1"]', { timeout: 60000 });
    await p.waitForTimeout(3000);
    if (i === 0) {
      await p.click("#again");
      await p.waitForTimeout(1200);
    }
  }
};
{
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: `${out}/video`, size: { width: 1920, height: 1080 } } });
  const p = await ctx.newPage();
  watch(p);
  await journey(p);
  await ctx.close();
}
{
  const frames = `${out}/frames`;
  mkdirSync(frames, { recursive: true });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  watch(p);
  const cdp = await ctx.newCDPSession(p);
  const list = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `f${String(list.length).padStart(5, "0")}.jpg`;
    writeFileSync(`${frames}/${file}`, Buffer.from(f.data, "base64"));
    list.push({ file, t: f.metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  await journey(p);
  await cdp.send("Page.stopScreencast");
  await ctx.close();
  // ffmpeg's concat list: each frame held until the next one.
  const lines = list.map((f, i) => `file '${f.file}'\nduration ${(((list[i + 1]?.t ?? f.t + 0.04) - f.t)).toFixed(4)}`);
  writeFileSync(`${frames}/list.txt`, `${lines.join("\n")}\n`);
  log.filmFrames = list.length;
}

// ---- click to skip: never slower than the person wants ----
{
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(p);
  await p.goto(`${BASE}/hero.html`);
  await p.waitForTimeout(500);
  const t0 = Date.now();
  await p.mouse.click(1400, 500);
  await p.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
  log.skipEntranceMs = Date.now() - t0;
  await p.click('[data-option="b"]');
  await p.waitForTimeout(1600);
  const t1 = Date.now();
  await p.mouse.click(1000, 900);
  await p.waitForSelector('body[data-done="1"]', { timeout: 5000 });
  log.skipRunMs = Date.now() - t1;
  await p.waitForTimeout(200);
  const pending = await p.evaluate(() => document.querySelectorAll("#path .rr-pending").length);
  log.pendingAfterSkip = pending;
  if (pending) problems.push("after a skip, parts were still hidden");
  await p.screenshot({ path: `${shots}/hero-5-after-skip-1920.png` });
  await p.close();
}

// ---- reduced motion: arrives finished, the same picture ----
{
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  watch(p);
  const t0 = Date.now();
  await p.goto(`${BASE}/hero.html`);
  await p.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
  log.reducedReadyMs = Date.now() - t0;
  const anims = await p.evaluate(() => document.getAnimations().length);
  await p.click('[data-option="c"]');
  await p.waitForSelector('body[data-done="1"]', { timeout: 5000 });
  log.reducedDoneMs = Date.now() - t0;
  log.reducedAnimationsRunning = anims;
  await p.screenshot({ path: `${shots}/hero-6-reduced-motion-1920.png` });
  await ctx.close();
}

// ---- keyboard: tab to a part, Enter selects, arrows walk the joins; hover quiets the rest ----
{
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  watch(p);
  await p.goto(`${BASE}/index.html?view=path`);
  await p.waitForSelector('body[data-ready="1"]');
  await p.keyboard.press("Tab");
  const first = await p.evaluate(() => document.activeElement?.getAttribute("data-node"));
  await p.keyboard.press("ArrowDown");
  const second = await p.evaluate(() => document.activeElement?.getAttribute("data-node"));
  log.keyboard = { first, second };
  if (!first || first === second) problems.push("arrow keys did not walk to the next part");
  await p.mouse.move(900, 300);
  await p.close();
}

await b.close();
log.problems = problems;
writeFileSync(`${out}/drive-log.json`, JSON.stringify(log, null, 1) + "\n");
console.log(JSON.stringify({ problems, stress: log.stress, stressWorker: log.stressWorker, skipEntranceMs: log.skipEntranceMs, skipRunMs: log.skipRunMs, reducedReadyMs: log.reducedReadyMs, reducedDoneMs: log.reducedDoneMs, keyboard: log.keyboard, measure: log["path-1920-light"]?.measure, measureMeta: log["meta-1920-light"]?.measure, axe: log["axe-1920-light-didnt-match"] }, null, 0));
