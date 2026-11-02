// D65: the machine, in the real page, at the sizes people use. Models mocked, $0. Checks with measured boxes on top of the unit tests' audit.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> AXE=<axe.min.js> node tests/evidence/R4/machine.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18972";
const AXE = process.env.AXE ? readFileSync(process.env.AXE, "utf8") : null;
const here = new URL("../U3/inputs/", import.meta.url);
const ORDERS = readFileSync(new URL("../../R5/film-orders.ts", here), "utf8");
const PLAN = readFileSync(new URL("plan_cache.py", here), "utf8");
const BRANCHING = `const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoffMs(attempt: number) {
  return 200 * 2 ** attempt;
}
export function parse(text: string) {
  if (!text) throw new Error("empty");
  return JSON.parse(text);
}
export async function fetchWithRetry(fetchIt: () => Promise<string>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return parse(await fetchIt());
    } catch (e) {
      await sleep(backoffMs(i));
    }
  }
  throw new Error("gave up");
}
export async function getPrice(fetchIt: () => Promise<string>) {
  const body = await fetchWithRetry(fetchIt);
  return body.price;
}
`;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
const times = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const page = async (w, h, opts = {}) => {
  const c = await b.newContext({ viewport: { width: w, height: h }, ...opts });
  const p = await c.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(BASE);
  return p;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const draw = async (p, code) => {
  await p.waitForSelector('[data-testid="u1-code"]');
  await p.fill('[data-testid="u1-code"]', code);
  const t = await p.evaluate(() => {
    window.__t0 = performance.now();
    document.querySelector('[data-testid="u1-draw"]').click();
    return new Promise((res) => {
      const look = () => (document.querySelector('[data-testid="machine"] svg') ? requestAnimationFrame(() => res(Math.round(performance.now() - window.__t0))) : requestAnimationFrame(look));
      look();
    });
  });
  await p.waitForTimeout(300);
  return t;
};
/** Measured: words overlapping words, words outside the window, in the real fonts. */
const words = (p, where) =>
  p
    .evaluate(() => {
      const flat = [...document.querySelectorAll('[data-testid="machine"] text:not([transform])')].filter((t) => getComputedStyle(t).visibility !== "hidden" && t.textContent.trim());
      const boxes = flat.map((t) => ({ t: t.textContent, r: t.getBoundingClientRect() }));
      const hits = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r;
          const c = boxes[j].r;
          if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) hits.push(`${boxes[i].t} / ${boxes[j].t}`);
        }
      const off = boxes.filter((x) => x.r.left < 0 || x.r.right > innerWidth || x.r.top < 0 || x.r.bottom > innerHeight).map((x) => x.t);
      const small = boxes.filter((x) => x.r.height < 11).map((x) => `${x.t} (${x.r.height.toFixed(0)}px)`);
      return { hits, off, small };
    })
    .then((r) => {
      say(`no words on words: ${where}`, r.hits.length === 0, r.hits.join("; "));
      say(`no words off the window: ${where}`, r.off.length === 0, r.off.join("; "));
      say(`flat words large enough to read: ${where}`, r.small.length === 0, r.small.join("; "));
    });
const axe = async (p, where) => {
  if (!AXE) return;
  if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE);
  const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((x) => `${x.id} x${x.nodes.length}: ${x.nodes[0]?.target}`));
  say(`axe 0: ${where}`, v.length === 0, v.join("; "));
};
const quiz = async (p) => {
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(300);
};
const answers = async (p) => {
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("1");
    await p.waitForTimeout(190);
  }
};
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  for (const [name, code] of [["orders", ORDERS], ["python", PLAN], ["branching", BRANCHING]]) {
    const p = await page(w, h);
    const t = await draw(p, code);
    times.push(t);
    say(`paste to picture: ${name} at ${w}`, t < 400, `${t} ms`);
    await shot(p, `${name}-rest-${w}x${h}`);
    await words(p, `${name} at rest, ${w}`);
    if (w === 1440 && name === "orders") await axe(p, "machine at rest");
    if (name !== "branching") {
      await quiz(p);
      if (await p.$(".c-drawer")) await p.keyboard.press("c");
      await p.waitForTimeout(250);
      if (name === "orders") await shot(p, `${name}-bet-${w}x${h}`);
      await words(p, `${name} during the bet, ${w}`);
      await answers(p);
      await p.click('[data-testid="u1-seal"]');
      await p.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: 90000 });
      await p.waitForTimeout(1800);
      if (name === "orders") {
        await shot(p, `${name}-running-${w}x${h}`);
        const ran = await p.evaluate(() => [...document.querySelectorAll(".m-thread")].filter((t) => parseFloat(getComputedStyle(t).strokeDashoffset) < 1).length);
        say(`the thread is running in a pipe: ${w}`, ran > 0, `${ran} pipes`);
      }
      await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 30000 });
      await p.waitForTimeout(700);
      await shot(p, `${name}-result-${w}x${h}`);
      await words(p, `${name} result, ${w}`);
      if (name === "orders") {
        say(`the ring landed: ${w}`, await p.evaluate(() => getComputedStyle(document.querySelector(".m-end")).visibility === "visible"));
        say(`D61's caption stays with the run: ${w}`, /Helper order comes from a separate traced run/.test(await p.textContent('[data-testid="machine-captions"]').catch(() => "")));
        if (w === 1440) await axe(p, "machine on a result");
      }
    }
    await p.context().close();
  }
}
// ---- M, click, keys, Escape
{
  const p = await page(1440, 900);
  await draw(p, ORDERS);
  const view = () => p.getAttribute('[data-testid="bench-stage"]', "data-view");
  say("the machine is the first view", (await view()) === "machine");
  await p.keyboard.press("m");
  await p.waitForTimeout(600);
  say("M swaps to the chart", (await view()) === "chart");
  await shot(p, "m-swaps-to-chart");
  await p.keyboard.press("m");
  await p.waitForTimeout(200);
  say("M swaps back", (await view()) === "machine");
  await p.click('[data-part="fetchPage"]');
  await p.waitForSelector('[data-testid="machine-card"]');
  const card = await p.textContent('[data-testid="machine-card"]');
  say("clicking a part gives its name and lines", /fetchPage/.test(card) && /lines 3.11/.test(card), card);
  await shot(p, "click-shows-name-and-lines");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(100);
  say("Escape closes that first", (await p.$('[data-testid="machine-card"]')) === null);
  await p.focus('[data-part="fetchAllOrders"]');
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="machine-card"]');
  say("the keyboard reaches a part", /fetchAllOrders/.test(await p.textContent('[data-testid="machine-card"]')));
  await p.context().close();
}
// ---- reduced motion: no motion, the end shows
{
  const p = await page(1440, 900, { reducedMotion: "reduce" });
  await draw(p, ORDERS);
  await quiz(p);
  await answers(p);
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 60000 });
  await p.waitForTimeout(300);
  say("reduced motion: the ring is there, nothing is animating", await p.evaluate(() => getComputedStyle(document.querySelector(".m-end")).visibility === "visible" && document.querySelector('[data-testid="machine"] svg').getAnimations({ subtree: true }).filter((a) => a.playState === "running").length === 0));
  await shot(p, "reduced-motion-result");
  await p.context().close();
}
// ---- skip
{
  const p = await page(1440, 900);
  await draw(p, ORDERS);
  await quiz(p);
  await answers(p);
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: 90000 });
  await p.waitForTimeout(400);
  await p.keyboard.press("x");
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 5000 });
  await p.waitForTimeout(150);
  say("any key skips to the ring", await p.evaluate(() => getComputedStyle(document.querySelector(".m-end")).visibility === "visible"));
  await p.context().close();
}
// ---- over the limit: words and the chart
{
  const p = await page(1280, 720);
  await p.fill('[data-testid="u1-code"]', Array.from({ length: 10 }, (_, i) => `export function f${i}() { return ${i}; }`).join("\n"));
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="machine-too-many"]');
  await p.waitForTimeout(400);
  say("past the limit: words and the chart", (await p.getAttribute('[data-testid="bench-stage"]', "data-view")) === "chart", await p.textContent('[data-testid="machine-too-many"]'));
  await shot(p, "over-the-limit");
  await p.context().close();
}
// ---- phone: the chart
{
  const p = await page(390, 780);
  await p.fill('[data-testid="u1-code"]', ORDERS);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  say("a phone gets the chart", (await p.getAttribute('[data-testid="bench-stage"]', "data-view")) === "chart");
  await p.context().close();
}
// ---- Moonwell
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const p = await page(w, h);
  await p.click('[data-testid="u1-demos"]');
  await p.click('[data-testid="mode-pr"]');
  await p.waitForSelector('[data-testid="machine"] svg');
  await p.waitForTimeout(500);
  await shot(p, `moonwell-${w}x${h}`);
  await words(p, `Moonwell, ${w}`);
  const big = await p.evaluate(() => [...document.querySelectorAll('[data-testid="machine"] text[data-big]')].map((t) => ({ t: t.textContent, h: Math.round(t.getBoundingClientRect().height) })));
  const others = await p.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid="machine"] text:not([data-big])')].map((t) => Number(t.getAttribute("font-size")))));
  say(`$1.12 and the reference are flat and the largest words: ${w}`, big.length === 2 && big.some((x) => x.t === "$1.12") && big.some((x) => x.t === "$2,206.68") && others < 46, JSON.stringify(big));
  await p.context().close();
}
const med = [...times].sort((x, y) => x - y)[Math.floor(times.length / 2)];
writeFileSync(`${OUT}/machine.json`, JSON.stringify({ checks: out, pasteToPictureMs: times, median: med }, null, 1));
await b.close();
console.log(failed ? `${failed} FAILED` : "all pass", "paste to picture", times.join(", "), "ms");
process.exit(failed ? 1 : 0);
