// R3 review round: the journey in the real app, with its speed measured. Against the real server, models mocked.
//   paste→drawing, tap→answer, seal→first motion; helper steps on the path; change the code and bet again; test this claim.
//   PORT=18961 U3_WONDER_DELAY_MS=800 pnpm exec tsx tests/evidence/U3/mock-server.ts &
//   ATLAS_API_PORT=18961 pnpm exec vite --port 18962 --strictPort &
//   PW=<playwright-core> CHROME=<headless shell> node tests/evidence/R3/journey-a.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18962";
const ORDERS = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
const PLAN = readFileSync(new URL("../U3/inputs/plan_cache.py", import.meta.url), "utf8");
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = { timings: {}, checks: [] };
let failed = 0;
const say = (name, ok, more = "") => {
  out.checks.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const ms = (a) => Math.round(performance.now() - a);
const page = async (vw = 1440, vh = 900) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(BASE);
  await p.waitForSelector('[data-testid="u1-code"]');
  return p;
};
/** A paint-accurate time: the next frame after the selector appears, measured in the page. */
const paintOf = (p, sel, timeout = 60000) => p.evaluate(({ sel, timeout }) => new Promise((res, rej) => {
  const t0 = performance.now();
  const look = () => {
    if (document.querySelector(sel)) return requestAnimationFrame(() => res(Math.round(performance.now() - t0)));
    if (performance.now() - t0 > timeout) return rej(new Error(`no ${sel}`));
    requestAnimationFrame(look);
  };
  look();
}), { sel, timeout });
const toSeal = async (p, name) => {
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
};
const answerAll = async (p) => {
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("1");
    await p.waitForTimeout(170);
  }
};
const flow = async (name, code, lang, mustHaveHelpers = false) => {
  const p = await page();
  // paste → drawing
  await p.evaluate(() => (window.__t = performance.now()));
  const waiter = paintOf(p, '[data-testid="bench-stage"] svg');
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  out.timings[`${name}: paste → drawing (ms)`] = await waiter;
  await p.waitForTimeout(600);
  // tap → response on a box
  const box = p.locator('[data-testid="bench-stage"] .r-chart [data-node]').first();
  const t = await p.evaluate(async () => {
    const el = document.querySelector('[data-testid="bench-stage"] .r-chart [data-node]');
    const t0 = performance.now();
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 300 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 300, clientY: 300 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 300, clientY: 300 }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
  void box;
  out.timings[`${name}: tap a box → next paint (ms)`] = t;
  await p.keyboard.press("Escape");
  await toSeal(p, name);
  await answerAll(p);
  await p.keyboard.press("ArrowLeft");
  const tap = await p.evaluate(async () => {
    const el = document.querySelector(".u1-quiz > li[data-active] .u1-opt");
    const t0 = performance.now();
    el.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  });
  out.timings[`${name}: tap an answer → next paint (ms)`] = tap;
  // seal → first motion
  const motion = p.evaluate(() => new Promise((res) => {
    const t0 = performance.now();
    window.__seal = t0;
    const look = () => {
      const st = document.querySelector('[data-testid="bench-stage"]');
      const path = document.querySelector('[data-testid="bench-path"] svg');
      if (st?.getAttribute("data-phase") === "playing" && path) return requestAnimationFrame(() => res(Math.round(performance.now() - t0)));
      requestAnimationFrame(look);
    };
    look();
  }));
  await p.waitForTimeout(200);
  await p.click('[data-testid="u1-seal"]');
  const m0 = await motion;
  out.timings[`${name}: seal → first motion (ms)`] = m0;
  const t0 = Date.now();
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  out.timings[`${name}: run length, first motion → verdict (ms)`] = Date.now() - t0;
  const words = await p.$$eval('[data-testid="bench-path"] [data-node]', (e) => e.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  const caps = await p.evaluate(() => document.querySelector('[data-testid="bench-path"]').textContent.replace(/\s+/g, " "));
  out[`${name} path`] = words;
  say(`${name}: reaches a verdict`, true, words.slice(0, 8).join(" | "));
  if (mustHaveHelpers) say(`${name}: the helper order is drawn, and its caption says where it came from`, /Helper order comes from a separate traced run/.test(caps) && words.some((w) => /your code/.test(w)), caps.slice(-160));
  await p.screenshot({ path: `${OUT}/${name}-result.png` });
  return p;
};
const ts = await flow("orders", ORDERS, "ts", true);
// Change the code and bet again
await ts.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 60000 });
await ts.click('[data-testid="u1-change"]');
await ts.waitForSelector('[data-testid="u1-change-panel"]');
say("change: the Go button waits for a change", await ts.isDisabled('[data-testid="u1-change-go"]'));
const edited = ORDERS.replace("maxPages = 5", "maxPages = 6").replace(/\bmaxPages = (\d+)/, (m, n) => `maxPages = ${Number(n) + 1}`);
await ts.fill('[data-testid="u1-change-code"]', edited === ORDERS ? `${ORDERS}\n// changed\n` : edited);
const paid = await ts.textContent('[data-testid="u1-paid-change"]');
say("change: a paid call is shown before the click", /paid/.test(paid), paid);
await ts.click('[data-testid="u1-change-go"]');
await ts.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
const body = await ts.evaluate(() => document.body.innerText);
say("change: same test again, on changed code", /same test, on your changed code/i.test(body));
say("change: no run data before sealing", !(await ts.$('[data-testid="bench-path"]')) && !(await ts.$('[data-testid="mark-list"]')));
await ts.screenshot({ path: `${OUT}/change-bet.png` });
await answerAll(ts);
await ts.click('[data-testid="u1-seal"]');
await ts.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
say("change: the changed run is judged", true);
// A to B and back to A: the person is told what the models are told (D19).
await ts.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 60000 });
await ts.click('[data-testid="u1-change"]');
await ts.fill('[data-testid="u1-change-code"]', ORDERS);
await ts.click('[data-testid="u1-change-go"]');
await ts.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
const back = await ts.evaluate(() => document.body.innerText);
say("change back: says this test already ran, never 'nothing has run yet'", /repeat of a test you've already seen/.test(back) && !/nothing about this code has run yet/.test(back));
await ts.screenshot({ path: `${OUT}/change-result.png` });
// Test this claim: a first result, then the claim's button.
const c = await flow("claim", ORDERS, "ts");
await c.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 60000 });
await c.waitForSelector('[data-testid="u1-test-claim"]', { timeout: 15000 });
say("claim: a paid call is shown", /paid/.test(await c.textContent('[data-testid="u1-paid-claim"]')));
const ran = await c.evaluate(() => document.querySelector('[data-testid="u1-actions"]') !== null);
await c.click('[data-testid="u1-test-claim"]');
await c.waitForSelector('[data-testid="u1-seal"], [data-testid="u1-claim-none"]', { timeout: 60000 });
const none = await c.$('[data-testid="u1-claim-none"]');
say("claim: a different test opens, or the button goes away and the result stays", ran && (none ? (await c.$('[data-testid="mark-list"]')) !== null && !(await c.$('[data-testid="u1-test-claim"]')) : !(await c.$('[data-testid="mark-list"]'))), none ? "nothing new" : "a new test");
await c.screenshot({ path: `${OUT}/claim.png` });
await flow("plan", PLAN, "py", true);
// The example, from the first screen, with a machine's keys: the floor under a first-timer's time.
{
  const p = await page();
  const t = performance.now();
  await p.click('[data-testid="u1-example"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  out.timings["example: click → drawing (ms)"] = ms(t);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  out.timings["example: click → first question (ms)"] = ms(t);
  await answerAll(p);
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="u1-sealed"]', { timeout: 30000 });
  out.timings["example: click → sealed, by keys (ms)"] = ms(t);
}
writeFileSync(`${OUT}/journey.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.timings, null, 1));
await b.close();
process.exit(failed ? 1 : 0);
