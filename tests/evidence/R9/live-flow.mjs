// R9: one full LIVE flow on the real server with real Meta calls (paid): open the page, "Try your own code", press a sample file, wait for
// Muse Wonder's summary, open the bet (Muse Wonder writes the test), answer the one question, "Lock in my bet" (Muse Spark and Muse Spark
// Open bet), and read the verdict after the sandbox run. Screens at 1280×800 in <out>. Also saves the round's bettor text (the page's own
// copy of it, from POST /experiments) so the summary's place in it can be checked.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R9/live-flow.mjs <out dir> [sample id]
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
const SAMPLE = process.argv[3] ?? "fetch-retry";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};
p.on("pageerror", (e) => say(`page error: ${e.message}`));
let seen = null;
let summaryAnswer = null;
p.on("response", async (r) => {
  try {
    if (r.url().endsWith("/paste/summary")) summaryAnswer = await r.json();
    if (/\/experiments$/.test(r.url()) && r.request().method() === "POST") seen = (await r.json()).seenContext ?? null;
  } catch {}
});
await p.goto(process.env.BASE);
await p.waitForSelector('[data-testid="u1-own"]', { timeout: 60000 });
await p.click('[data-testid="u1-own"]');
await p.waitForSelector(`[data-testid="e-sample-${SAMPLE}"]`);
await p.screenshot({ path: `${OUT}/1-samples.png` });
const t0 = Date.now();
await p.click(`[data-testid="e-sample-${SAMPLE}"]`);
await p.waitForSelector('[data-testid="bench-stage"]', { timeout: 60000 });
await p.waitForSelector('[data-testid="file-summary"]', { timeout: 60000 }).catch(() => say("no summary was shown"));
say(`summary shown after ${Date.now() - t0} ms: ${JSON.stringify(summaryAnswer)}`);
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/2-drawn-with-summary.png` });
await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 120000 });
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/3-bet-question.png` });
const q = await p.$eval(".u1-quiz .u1-q", (e) => e.textContent).catch(() => null);
const opts = await p.$$eval(".u1-quiz .u1-opt", (x) => x.map((y) => y.textContent));
say(`question: ${q}; options: ${JSON.stringify(opts)}`);
// The person's bet in this driver: the first option (the build agent answers, not a real person).
await p.keyboard.press("1");
await p.waitForTimeout(300);
await p.click('[data-testid="u1-seal"]');
await p.waitForSelector('[data-testid="mark-list"]', { timeout: 180000 });
await p.waitForSelector('[data-testid="moment-verdict"]', { timeout: 60000 }).catch(() => {});
await p.keyboard.press("Escape");
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/4-verdict.png` });
const verdict = await p.$eval('[data-testid="moment-verdict"]', (e) => e.textContent).catch(() => null);
const marks = await p.$eval('[data-testid="mark-list"]', (e) => e.textContent).catch(() => null);
say(`verdict: ${verdict}`);
say(`marks: ${marks}`);
writeFileSync(`${OUT}/bettor-text.txt`, seen ?? "(not captured)");
writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
say(`the bettors' text holds the summary: ${Boolean(seen && summaryAnswer?.ok && seen.includes(summaryAnswer.summary.purpose))}`);
await b.close();
