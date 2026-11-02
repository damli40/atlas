// D66: the wow and the loop on the real page, on real data. Models mocked, $0. Frames are seeked, so what is shown is exactly what the animation draws at that moment.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R5/wow.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18942";
const here = new URL("../U3/inputs/", import.meta.url);
const ORDERS = readFileSync(new URL("orders.ts", here), "utf8");
const PLAN = readFileSync(new URL("plan_cache.py", here), "utf8");
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const ctxOf = async (w, h, opts = {}) => {
  const c = await b.newContext({ viewport: { width: w, height: h }, ...opts });
  await c.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  return c;
};
const pageIn = async (c, url = BASE) => {
  const p = await c.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(url);
  return p;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const paste = async (p, code) => {
  await p.waitForSelector('[data-testid="u1-code"]');
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="machine"] svg');
};
const round = async (p, code, pick = "1", settle = true) => {
  await paste(p, code);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press(pick);
    await p.waitForTimeout(190);
  }
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: 90000 });
  if (!settle) return;
  await p.keyboard.press("x");
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 20000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, null, { timeout: 15000 });
  await p.waitForTimeout(800);
};
const seek = async (p, T) => {
  await p.evaluate((T) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = T; }), T);
  await p.waitForTimeout(90);
};

// ---- the pencil-in: real frames
{
  const c = await ctxOf(1440, 900);
  const p = await pageIn(c);
  await p.fill('[data-testid="u1-code"]', ORDERS);
  const t = await p.evaluate(() => {
    const t0 = performance.now();
    document.querySelector('[data-testid="u1-draw"]').click();
    return new Promise((res) => {
      const look = () => {
        const seen = document.querySelector('[data-testid="machine"] svg');
        return seen ? requestAnimationFrame(() => res(Math.round(performance.now() - t0))) : requestAnimationFrame(look);
      };
      look();
    });
  });
  say("first marks about 100 ms after the click", t < 160, `${t} ms`);
  say("every part is there and can be clicked from frame one", await p.evaluate(() => [...document.querySelectorAll('[data-testid="machine"] [data-part]')].length > 4));
  const running = await p.evaluate(() => document.getAnimations().length);
  say("it pencils itself in", running > 100, `${running} strokes`);
  for (const T of [60, 300, 560, 860]) {
    await seek(p, T);
    await shot(p, `pen-${T}ms`);
  }
  await p.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await p.keyboard.press("Shift");
  await p.waitForTimeout(80);
  say("any key finishes it", (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)) < 10);
  // a later paste
  await p.click('[data-testid="u1-new"]');
  await p.fill('[data-testid="u1-code"]', PLAN);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="machine"] svg');
  const longest = await p.evaluate(() => Math.max(0, ...document.getAnimations().map((a) => a.effect.getComputedTiming().endTime)));
  say("a later paste is faster", longest < 420, `${Math.round(longest)} ms`);
  await c.close();
  const r = await ctxOf(1440, 900, { reducedMotion: "reduce" });
  const q = await pageIn(r);
  await paste(q, ORDERS);
  say("reduced motion: no pencilling", (await q.evaluate(() => document.querySelector('[data-testid="machine"] svg').getAnimations({ subtree: true }).length)) === 0);
  await r.close();
}
// ---- the run: the ink, the ring in one stroke
{
  const c = await ctxOf(1440, 900);
  const p = await pageIn(c);
  await round(p, ORDERS, "1", false);
  await p.waitForTimeout(1500);
  await shot(p, "run-ink-in-the-pipe");
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 30000 });
  await p.evaluate(() => {
    const d = document.querySelector(".m-ring-draw");
    d?.getAnimations().forEach((a) => { a.pause(); a.currentTime = 250; });
  });
  await p.waitForTimeout(100);
  await shot(p, "ring-being-drawn");
  await p.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await p.waitForTimeout(1500);
  await shot(p, "ring-landed");
  say("the ring sits on the chute of the function that threw", await p.evaluate(() => getComputedStyle(document.querySelector(".m-end")).visibility === "visible"));
  // ---- the proof picture
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]').disabled, null, { timeout: 15000 });
  await p.keyboard.press("p");
  await p.waitForSelector('[data-testid="pc-image"] svg');
  await p.waitForTimeout(500);
  await shot(p, "proof-panel");
  const href = await p.$eval(".u1-proof a.u1-link", (e) => e.href);
  // The same tab: the card's own page knows this session ran it.
  const own = p;
  await own.goto(href);
  await own.waitForSelector('[data-testid="pc-image"] svg[data-machine]', { timeout: 10000 });
  await own.waitForTimeout(400);
  await (await own.$('[data-testid="pc-image"] svg')).screenshot({ path: `${OUT}/picture-1280.png` });
  const words = await own.$eval('[data-testid="pc-image"] svg', (e) => e.textContent);
  say("the picture has the bet, the run, and the D21 caption", /YOU BET/.test(words) && /threw/.test(words) && /scoreboard|The code that draws|designed Oct 26/i.test(words));
  await own.click('[data-testid="pc-copy-image"]');
  await own.waitForSelector('[data-testid="pc-share-said"]');
  const png = await own.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType("image/png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  writeFileSync(`${OUT}/picture-copied.png`, Buffer.from(png, "base64"));
  say("Copy image gives the picture with the machine", png.length > 50000, `${Math.round((png.length * 3) / 4 / 1024)} KB`);
  // what a feed shows: the picture at a phone's width
  await own.setViewportSize({ width: 390, height: 300 });
  await own.waitForTimeout(250);
  await (await own.$('[data-testid="pc-image"] svg')).screenshot({ path: `${OUT}/picture-phone-width.png` });
  // a stranger, not kept: the marks, not the machine, and no code
  const s = await ctxOf(1280, 800);
  const st = await pageIn(s, href);
  await st.waitForSelector('[data-testid="pc-image"] svg');
  await st.waitForTimeout(400);
  say("a reader of a link not yet kept gets the marks", (await st.$('[data-testid="pc-image"] svg[data-machine]')) === null);
  await s.close();
  await c.close();
}
// ---- Moonwell's picture, from the saved run
{
  const c = await ctxOf(1440, 900);
  const p = await pageIn(c);
  const file = readFileSync(new URL("../R3/moonwell-real/mcmqYUk3lI.atlas.json", import.meta.url), "utf8");
  await p.route("**/proofs/mcmqYUk3lI", (r) => r.fulfill({ contentType: "application/json", body: file }));
  await p.route("**/proofs/mcmqYUk3lI/viewer", (r) => r.fulfill({ json: { yours: false, keepsCards: true, canKeep: false } }));
  await p.route("**/proofs/mcmqYUk3lI/machine", (r) => r.fulfill({ json: { parts: null } }));
  await p.goto(`${BASE}/?proof=mcmqYUk3lI`);
  await p.waitForSelector('[data-testid="pc-image"] svg[data-machine]', { timeout: 10000 });
  await p.waitForTimeout(400);
  await (await p.$('[data-testid="pc-image"] svg')).screenshot({ path: `${OUT}/picture-moonwell.png` });
  await c.close();
}
// ---- the remember loop: one person, several rounds, a restart of the page
{
  const c = await ctxOf(1440, 900);
  const p = await pageIn(c);
  say("a first visit says nothing about earlier rounds", (await p.$('[data-testid="remember-last"]')) === null);
  await shot(p, "loop-first-visit");
  await round(p, ORDERS, "1");
  say("one round: no count yet", (await p.$('[data-testid="m-loop"]')) === null);
  await p.click('[data-testid="u1-new"]');
  await p.waitForSelector('[data-testid="remember-last"]');
  const last = await p.textContent('[data-testid="remember-last"]');
  say("back on the first screen: last time", /^Last time: you bet .*\. It threw\.$/.test(last), last);
  await shot(p, "loop-return-first-screen");
  await p.reload();
  await p.waitForSelector('[data-testid="remember-last"]');
  say("still there after a reload", true);
  for (let i = 0; i < 2; i++) {
    await p.click('[data-testid="u1-new"]').catch(() => {});
    const x = `${ORDERS}\n// round ${i}\n`;
    await round(p, x, "2");
  }
  let line = "";
  if (await p.$('[data-testid="m-loop"]')) line = await p.textContent('[data-testid="m-loop"]');
  say("the count moves at the verdict", /^.+: \d+ of \d+ → \d+ of \d+$/.test(line), line);
  await shot(p, "loop-count-moved");
  await p.click('[data-testid="u1-new"]');
  await paste(p, `${ORDERS}\n// again\n`);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(300);
  await shot(p, "loop-bet-last-time");
  let found = "";
  for (let i = 0; i < 4 && !found; i++) {
    if (await p.locator('.u1-quiz li[data-active] [data-testid="remember-weakest"]').count()) found = await p.locator('.u1-quiz li[data-active] [data-testid="remember-weakest"]').textContent();
    else {
      await p.keyboard.press("1");
      await p.waitForTimeout(190);
    }
  }
  say("beside a question of the weakest kind: the count", /^Your weakest so far: .+, \d+ of \d+\.$/.test(found), found);
  await shot(p, "loop-bet-weakest");
  await c.close();
}
writeFileSync(`${OUT}/wow.json`, JSON.stringify({ checks: out }, null, 1));
await b.close();
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
