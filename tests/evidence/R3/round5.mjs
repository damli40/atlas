// R3 fix round 5: the review's two blockers and two majors, on the real page. Models mocked, $0.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> BASE_G=<gated page> GATE_FILE=<file> node tests/evidence/R3/round5.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18962";
const ORDERS = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const page = async (w = 1280, h = 800, url = BASE) => {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  await c.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const p = await c.newPage();
  await p.goto(url);
  return p;
};
const draw = async (p, code) => {
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  await p.waitForTimeout(400);
};
const quiz = async (p) => {
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
};
const answer = async (p) => {
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("1");
    await p.waitForTimeout(190);
  }
};
const finish = async (p) => {
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="u1-actions"]', { timeout: 90000 });
  await p.keyboard.press("Space");
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 30000 });
  await p.waitForTimeout(400);
};
// ---- S1: typed null, through the page, sealed and judged
{
  const p = await page(1440, 900);
  await draw(p, "export function f(n) {\n  return null;\n}\n");
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-tests"], [data-testid="u1-own-now"]', { timeout: 60000 });
  if (await p.$('[data-testid="u1-own-now"]')) await p.click('[data-testid="u1-own-now"]');
  else await p.click('[data-testid="u1-own"]');
  await p.waitForSelector('[data-testid="test-form"]');
  await p.click('[data-testid="test-form"] .row button');
  await p.fill('[data-testid="arg-0"] input', "1");
  await p.click('[data-testid="form-submit"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 30000 });
  await p.waitForTimeout(200);
  await p.click(".u1-quiz li[data-active] .u1-typed-in");
  await p.keyboard.type("null");
  await finish(p);
  say("S1 a typed null matches a function returning null", (await p.getAttribute('[data-testid="moment"]', "data-kind")) === "matched", await p.textContent('[data-testid="moment-you"]'));
  await p.screenshot({ path: `${OUT}/s1-null-matched.png` });
  await p.context().close();
}
// ---- J2: keys on a hidden bet
{
  const p = await page();
  const posts = [];
  p.on("request", (r) => r.method() === "POST" && /\/bets/.test(r.url()) && posts.push(1));
  await draw(p, ORDERS);
  await quiz(p);
  const before = await p.textContent('[data-testid="b-progress"]');
  await p.click('[data-testid="mode-record"]');
  await p.waitForSelector('[data-testid="track-record"]');
  await p.keyboard.press("1");
  await p.keyboard.press("2");
  await p.waitForTimeout(300);
  await p.click('[data-testid="u1-demos"]');
  await p.click('[data-testid="mode-pr"]');
  await p.waitForSelector('[data-testid="moonwell-saved"]');
  await p.mouse.click(900, 500);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(300);
  say("J2 no bet is sealed from another screen", posts.length === 0);
  await p.click('.u1-mark');
  await p.waitForTimeout(200);
  say("J2 digits on another screen answered nothing", (await p.textContent('[data-testid="b-progress"]')) === before, before);
  await answer(p);
  await finish(p);
  // ---- J1: the code panel over a result says so
  if (!(await p.$(".c-drawer"))) await p.keyboard.press("c");
  await p.waitForSelector(".c-drawer");
  await p.waitForTimeout(300);
  const note = await p.textContent('[data-testid="c-covers"]');
  say("J1 the code panel says the result is under it", /under this panel/.test(note), note);
  await p.screenshot({ path: `${OUT}/j1-panel-note-1280.png` });
  await p.context().close();
}
// ---- S2: someone else, signed in, on a card they did not run
if (process.env.BASE_G) {
  const code = readFileSync(process.env.GATE_FILE, "utf8").trim();
  const a = await page(1280, 800, `${process.env.BASE_G}/`);
  await a.fill('[data-testid="e-invite-code"]', code);
  await a.click('[data-testid="e-invite-go"]');
  await a.waitForTimeout(500);
  await draw(a, ORDERS);
  await quiz(a);
  await answer(a);
  await finish(a);
  await a.keyboard.press("p");
  await a.waitForSelector('[data-testid="pc-copy-link"]');
  const url = await a.$eval(".u1-proof a.u1-link", (e) => e.href);
  const r = await page(1280, 800, `${process.env.BASE_G}/`);
  await r.fill('[data-testid="e-invite-code"]', code);
  await r.click('[data-testid="e-invite-go"]');
  await r.waitForTimeout(500);
  await r.goto(url);
  await r.waitForSelector('[data-testid="proof-card"]');
  await r.waitForTimeout(400);
  await r.click('[data-testid="pc-copy-link"]');
  await r.waitForSelector('[data-testid="pc-share-said"]');
  say("S2 a signed-in reader is offered no public link", (await r.$('[data-testid="pc-link-ask"]')) === null, await r.textContent('[data-testid="pc-share-said"]'));
  const img = await r.$eval('[data-testid="pc-image"] svg', (e) => e.textContent);
  say("S2 they are not told 'you'", !/YOU BET/.test(img) && /THE BET/.test(img));
  say("S2 no Delete for them", (await r.$('[data-testid="pc-delete-link"]')) === null);
  await r.screenshot({ path: `${OUT}/s2-reader-1280.png` });
  await r.context().close();
  await a.context().close();
}
writeFileSync(`${OUT}/round5.json`, JSON.stringify({ checks: out }, null, 1));
await b.close();
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
