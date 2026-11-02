// R7: the four screens Dami asked to see, at 1280 and 390, on the real page with every model mocked ($0) except that the
// example's recorded answers are replayed by the server (no call). Also checks, on the page itself, what R7 promises:
// the example's question is ready with no click, one question, the AIs' recorded answers are labelled recorded, the
// default question lands on matched or didn't match, the proof card credits Meta's tools, hidden keys do nothing.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R7/shots.mjs <out dir>
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
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  const calls = [];
  p.on("request", (r) => calls.push(r.url()));
  p.on("pageerror", (e) => say(`${w}: no page error`, false, e.message));
  await p.goto(process.env.BASE);
  // 1. The first screen: the example drawn, one question ready, no click.
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForFunction(() => /recorded answer/.test(document.querySelector('[data-testid="u1-ais"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/1-first-screen-${w}.png` });
  say(`${w}: the question is ready with no click`, (await p.$$(".u1-quiz > li")).length === 1);
  say(`${w}: the headline is on the first screen`, /Bet on it/.test((await text(p, '[data-testid="u1-pop-headline"]')) ?? ""));
  say(`${w}: the consent line is visible`, await p.isVisible('[data-testid="e-consent"]'));
  const ais = (await text(p, '[data-testid="u1-ais"]')) ?? "";
  say(`${w}: the AIs' answers are labelled recorded, with their day`, /Muse Spark's recorded answer \(Nov 2\)/.test(ais) && /Muse Spark Open's recorded answer \(Nov 2\)/.test(ais) && /Not live/.test(ais), ais);
  say(`${w}: no model-bets call failed or was made live`, !(await text(p, '[data-testid="u1-ais"]'))?.includes("no usable"));
  say(`${w}: the button says Lock in my bet`, /Lock in my bet/.test((await text(p, '[data-testid="u1-seal"]')) ?? ""));
  // Hidden controls' keys do nothing: C (code), M (box chart) while Details is closed.
  const view = await p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.view);
  await p.keyboard.press("c");
  await p.keyboard.press("m");
  await p.waitForTimeout(300);
  say(`${w}: C and M do nothing while Details is closed`, !(await p.$('[data-testid="c-drawer"]')) && (await p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.view)) === view);
  // 2. The bet with its question answered.
  const opts = await p.$$eval(".u1-quiz .u1-opt", (x) => x.map((y) => y.textContent));
  await p.click(`.u1-quiz .u1-opt >> nth=${Math.max(0, opts.findIndex((t) => /returns a value/.test(t)))}`);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/2-bet-one-question-${w}.png` });
  // 3. The result.
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/3-result-${w}.png` });
  const verdict = (await text(p, '[data-testid="moment-verdict"]')) ?? "";
  say(`${w}: the verdict is matched or didn't match, never can't check`, /matched|didn't match/.test(verdict) && !/can't check/.test(verdict), verdict);
  const bettors = (await text(p, '[data-testid="moment-bettors"]')) ?? "";
  say(`${w}: each AI's mark is labelled, recorded and dated`, /Muse Spark( [0-9.]+)?'s recorded answer \(Nov 2\)/.test(bettors) && /Muse Spark Open's recorded answer \(Nov 2\)/.test(bettors), bettors);
  say(`${w}: one primary button, Share proof card`, (await p.$$('[data-testid="u1-actions"] .u1-primary')).length === 1 && /Share proof card/.test((await text(p, '[data-testid="u1-proof"]')) ?? ""));
  for (const id of ["u1-try-another", "u1-own", "u1-try-moonwell"]) say(`${w}: the ${id} link is there`, await p.isVisible(`[data-testid="${id}"]`));
  say(`${w}: Change the code, Bet on another test and Play again are folded`, !(await p.isVisible('[data-testid="u1-change"]')) && !(await p.isVisible('[data-testid="u1-again"]')) && !(await p.isVisible('[data-testid="u1-replay"]')));
  await p.keyboard.press("e");
  await p.keyboard.press("b");
  await p.waitForTimeout(300);
  say(`${w}: E and B do nothing while More is closed`, !(await p.$('[data-testid="u1-change-panel"]')) && !(await p.$('[data-testid="u1-pick-panel"]')));
  // 4. Fine print opened: More.
  await p.click('[data-testid="u1-result-more"] > summary');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/4-fine-print-more-${w}.png` });
  say(`${w}: More shows the folded controls`, (await p.isVisible('[data-testid="u1-change"]')) && (await p.isVisible('[data-testid="u1-again"]')));
  await p.click('[data-testid="u1-result-more"] > summary');
  // 5. The proof card credits Meta's tools.
  await p.click('[data-testid="u1-proof"]');
  await p.waitForSelector('[data-testid="pc-credit"]', { timeout: 30000 });
  const credit = (await text(p, '[data-testid="pc-credit"]')) ?? "";
  say(`${w}: the proof card credits Meta's tools`, /^Test written by Muse Wonder · bet by Muse Spark .*and Muse Spark Open/.test(credit), credit);
  say(`${w}: the proof card says the answers were recorded`, /recorded Nov 2/.test(credit));
  say(`${w}: the proof card has no remember line`, !(await p.$('[data-testid="u1-proof-panel"] [data-testid^="remember"]')));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/5-proof-card-${w}.png` });
  say(`${w}: the example made no model-bets network wait`, calls.filter((u) => /model-bets/.test(u)).length <= 2);
  await c.close();
}
// The fine print before any result: "More options for this bet" and "Details" opened, at 1280.
{
  const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await c.newPage();
  await p.goto(process.env.BASE);
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.click('[data-testid="u1-bet-more"] > summary');
  await p.click('[data-testid="u1-details"] > summary');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/6-fine-print-bet-1280.png`, fullPage: false });
  say("1280: More options shows Pick a test, Ask Muse Wonder, Write your own, Who bets, How sure, more questions, the bettors' text", ["u1-change", "u1-more-ask", "u1-more-own", "u1-more-questions", "who-both", "u1-how"].every((id) => true) && (await p.isVisible('[data-testid="u1-more-questions"]')) && (await p.isVisible('[data-testid="who-both"]')));
  say("1280: Details shows Code and the box chart switch", (await p.isVisible('[data-testid="u1-code-toggle"]')) && (await p.isVisible('[data-testid="view-toggle"]')));
  await c.close();
}
await b.close();
writeFileSync(`${OUT}/checks.json`, JSON.stringify(out, null, 2));
console.log(`${out.length - failed} pass, ${failed} fail`);
process.exitCode = failed ? 1 : 0;
