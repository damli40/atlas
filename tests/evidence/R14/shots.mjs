// R14: the four features on the real page, with every model mocked ($0) by tests/evidence/U3/mock-server.ts (its R14 mocks say they
// are mocks). Checks are made on the page itself; screenshots go to <out>.
//   PW=<playwright-core index.mjs> CHROME=<headless shell> BASE=<page> [GATED=1] node tests/evidence/R14/shots.mjs <out dir>
// GATED=1: the server has the invite gate on and this browser has no code (the open example): none of the paid features is offered,
// and the page sends no request to /paste/pick, /paste/captions or /paste/ask.
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
const GATED = process.env.GATED === "1";
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
const clickPart = async (p, id) => {
  // The machine when it is shown, else the box chart (a click on either opens the part's panel).
  const machine = `[data-testid="machine-region"]:not([style*="hidden"]) [data-testid="machine"] .m-part[data-part^="${id}"]`;
  const chart = `[data-testid="bench-viewport"] [data-node="${id}"]`;
  await p.waitForSelector(`${machine}, ${chart}`, { timeout: 15000, state: "attached" });
  const sel = (await p.$(machine)) ? machine : chart;
  await p.$eval(sel, (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForSelector(`[data-testid="part-panel"][data-part="${id}"]`, { timeout: 5000 });
};
const waitVerdict = (p) => p.waitForSelector('[data-testid="moment-verdict"]', { timeout: 90000 });
const lockFirst = async (p, k = 0) => {
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  const opts = await p.$$('.u1-opt');
  await opts[Math.min(k, opts.length - 1)].click();
  await p.click('[data-testid="u1-seal"]');
};

// ---- the seal stays above the fold, at three sizes (the first screen: the example, with the R14 lines in place) ----
for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
  const p = await c.newPage();
  p.on("pageerror", (e) => say(`${w}: no page error`, false, e.message));
  await p.goto(process.env.BASE);
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/0-first-screen-${w}x${h}${GATED ? "-nocode" : ""}.png` });
  const seal = await onScreen(p, '[data-testid="u1-seal"]');
  say(`${w}x${h}: "Lock in my bet" is fully on screen and not covered`, seal.inView && seal.uncovered, JSON.stringify(seal));
  if (GATED && w >= 1280) say(`${w}x${h}: no code: the pick says only "play a few rounds…"`, /Play a few rounds/.test((await text(p, '[data-testid="pick-example"]')) ?? ""));
  await c.close();
}

const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
p.on("pageerror", (e) => say("no page error", false, e.message));
const paid = [];
p.on("request", (r) => {
  if (/\/paste\/(pick|captions|ask)$/.test(new URL(r.url()).pathname)) paid.push(new URL(r.url()).pathname);
});
await p.goto(process.env.BASE);
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.waitForTimeout(1500);

if (GATED) {
  // No code: a part that isn't the example's function offers the waitlist line; asking needs a code; nothing paid is requested.
  await clickPart(p, "getPrice");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/G1-panel-getPrice-nocode.png` });
  say("no code: Bet on getPrice says the invite line", /needs an invite code/.test((await text(p, '[data-testid="part-bet-code"]')) ?? ""));
  say("no code: the ask box says the invite line", /needs an invite code/.test((await text(p, '[data-testid="part-ask-code"]')) ?? ""));
  await p.keyboard.press("Escape");
  await lockFirst(p, 0);
  await waitVerdict(p);
  await p.waitForTimeout(5000);
  await p.screenshot({ path: `${OUT}/G2-verdict-nocode.png` });
  say("no code: no request to /paste/pick, /paste/captions or /paste/ask", paid.length === 0, JSON.stringify(paid));
  say("no code: no Muse captions on the act or the list", (await p.$('[data-testid^="machine-act-ai"]')) === null);
} else {
  // ---- before the lock: the panel offers "Bet on this part"; asking waits for the lock ----
  await clickPart(p, "getPrice");
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/1-panel-getPrice-before.png` });
  say("1: the part panel offers Bet on this part", await p.isVisible('[data-testid="part-bet"]'));
  say("3: before a bet is locked, the ask box says to lock first", /Ask after you lock your bet/.test((await text(p, '[data-testid="part-ask-locked"]')) ?? ""));
  say("3: …and has no question box", (await p.$('[data-testid="part-ask-input"]')) === null);
  await clickPart(p, "backoffMs");
  say("1: a part Atlas can't call says so", /called from outside/.test((await text(p, '[data-testid="part-bet-not-callable"]')) ?? ""));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  // ---- 2. the example's round: captions join the act while it plays ----
  await lockFirst(p, 0);
  const cap = await p.waitForSelector('[data-testid="machine-act-ai"]', { timeout: 30000 }).then(() => true, () => false);
  if (cap) await p.screenshot({ path: `${OUT}/2-act-with-caption.png` });
  say("2: Muse's caption shows under the act while it plays", cap, (await text(p, '[data-testid="machine-act-ai"]')) ?? "");
  say("2: …in its own line, labelled for screen readers as Muse Wonder's words", /Muse Wonder's words/.test((await p.$eval('[data-testid="machine-act-ai"]', (e) => e.innerHTML).catch(() => "")) ?? ""));
  await waitVerdict(p);
  await p.waitForTimeout(1500);
  await p.click('[data-testid="machine-act-list"] > summary');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/3-verdict-step-list.png` });
  const list = (await text(p, '[data-testid="machine-act-list"]')) ?? "";
  say("2: after the run, the step list holds the captions, labelled", /Muse Wonder's words/.test(list) && /Mock caption/.test(list), list.slice(0, 160));
  // ---- 3. Ask about this part, after the lock (the panel under the verdict) ----
  await p.click('[data-testid="machine-act-list"] > summary');
  await clickPart(p, "getPrice");
  await p.fill('[data-testid="part-ask-input"]', "What does this part do?");
  await p.click('[data-testid="part-ask-go"]');
  await p.waitForSelector('[data-testid="part-ask-answer"]', { timeout: 15000 });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/4-ask-answer.png` });
  say("3: after the lock the answer shows, labelled as Muse Wonder's words, not a check", /Muse Wonder's answer \(Meta's AI\), not a check/.test((await text(p, '[data-testid="part-ask-answer"]')) ?? ""));
  // ---- 1. Bet on this part, from the panel under the verdict ----
  await p.click('[data-testid="part-bet"]');
  await p.waitForFunction(() => /getPrice/.test(document.querySelector('[data-testid="u1-test"]')?.textContent ?? ""), null, { timeout: 30000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/5-bet-on-getPrice.png` });
  say("1: the new round is on getPrice (Muse Wonder's test of that function)", /getPrice/.test((await text(p, '[data-testid="u1-test"]')) ?? ""));
  const seal = await onScreen(p, '[data-testid="u1-seal"]');
  say("1: Lock in my bet is on screen", seal.inView && seal.uncovered, JSON.stringify(seal));
  await lockFirst(p, 1);
  await waitVerdict(p);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/6-getPrice-verdict.png` });
  // ---- 4. the pick, on a sample file ----
  await p.click('[data-testid="u1-own"]');
  await p.click('[data-testid="e-sample-rate-cache"]');
  const picked = await p.waitForSelector('[data-testid="pick"], [data-testid="pick-note"]', { timeout: 20000 }).then(() => true, () => false);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/7-pick.png` });
  const pickText = (await text(p, '[data-testid="pick"]')) ?? (await text(p, '[data-testid="pick-note"]')) ?? "";
  say("4: Muse Wonder's pick (or why there is none) shows before the bet", picked, pickText);
  const aimed = await p.$('[data-testid="machine"] [data-aimed]');
  say("4: the picked box is marked on the machine", aimed !== null);
  if (await p.$('[data-testid="pick-accept"]')) {
    await p.click('[data-testid="pick-accept"]');
    const ok = await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 30000 }).then(() => true, () => false);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/8-pick-accepted.png` });
    say("4: accepting the pick opens a bet on that part", ok);
    const sealP = await onScreen(p, '[data-testid="u1-seal"]');
    say("4: Lock in my bet is on screen with the pick above the drawing", sealP.inView && sealP.uncovered, JSON.stringify(sealP));
    // ---- 5. the third bet on how a call ends: the verdict says the record line ----
    await lockFirst(p, 1);
    await waitVerdict(p);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/9-third-verdict-record-line.png` });
    say("5: the verdict has a record line once there are three bets of a kind", await p.isVisible('[data-testid="m-record"]'), (await text(p, '[data-testid="m-record"]')) ?? "(none)");
  }
  // ---- 5. the record page ----
  await p.click('[data-testid="mode-record"]');
  await p.waitForSelector('[data-testid="track-remember"]', { timeout: 10000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/10-record.png`, fullPage: true });
  say("5: the record page says what Atlas remembers, where, and how Wonder uses it", /never your code/i.test((await text(p, '[data-testid="track-remember"]')) ?? "") && /memory only|on disk/.test((await text(p, '[data-testid="track-remember-where"]')) ?? ""), (await text(p, '[data-testid="track-remember-where"]')) ?? "");
}
writeFileSync(`${OUT}/checks.json`, JSON.stringify(out, null, 1));
console.log(`${out.length - failed} of ${out.length} pass`);
await b.close();
process.exit(failed ? 1 : 0);
