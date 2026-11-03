// R14: one live session with REAL Meta calls, on a local server with invite codes on (ATLAS_REQUIRE_INVITE=1) and a throwaway code made
// for this run only. It covers all four features on the example file and on one sample file. Every answer from /paste/pick,
// /paste/captions and /paste/ask is saved word for word (live/answers.json); the code itself is read from a file and never written out.
//   PW=<playwright-core index.mjs> CHROME=<headless shell> BASE=<page> CODE_FILE=<file holding the code> node tests/evidence/R14/live.mjs <out>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const CODE = readFileSync(process.env.CODE_FILE, "utf8").trim();
const b = await chromium.launch({ executablePath: process.env.CHROME });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
const log = [];
const answers = [];
const t0 = Date.now();
const note = (s) => {
  const line = `${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`;
  log.push(line);
  console.log(line);
};
p.on("pageerror", (e) => note(`PAGE ERROR ${e.message}`));
p.on("response", async (r) => {
  const path = new URL(r.url()).pathname;
  if (!/\/paste\/(pick|captions|ask)$/.test(path)) return;
  let body = null;
  try {
    body = await r.json();
  } catch {}
  answers.push({ path, status: r.status(), body });
  note(`← ${r.status()} ${path} ${JSON.stringify(body).slice(0, 220)}`);
});
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png` });
const text = (sel) => p.$eval(sel, (e) => e.textContent ?? "").catch(() => null);
const clickPart = async (id) => {
  const machine = `[data-testid="machine-region"]:not([style*="hidden"]) [data-testid="machine"] .m-part[data-part^="${id}"]`;
  const chart = `[data-testid="bench-viewport"] [data-node="${id}"]`;
  await p.waitForSelector(`${machine}, ${chart}`, { timeout: 20000, state: "attached" });
  const sel = (await p.$(machine)) ? machine : chart;
  await p.$eval(sel, (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForSelector(`[data-testid="part-panel"][data-part="${id}"]`, { timeout: 8000 });
};
const lock = async (label) => {
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 120000 });
  const opts = await p.$$(".u1-opt");
  const texts = await Promise.all(opts.map((o) => o.textContent()));
  const k = Math.max(0, texts.findIndex((t) => /returns a value/.test(t ?? "")));
  note(`${label}: question "${await text('[data-testid="u1-test"]')}"; locking "${texts[k]?.trim()}"`);
  await opts[k].click();
  await p.click('[data-testid="u1-seal"]');
};
const verdict = async (label) => {
  await p.waitForSelector('[data-testid="moment-verdict"]', { timeout: 180000 });
  await p.waitForTimeout(6000);
  note(`${label}: verdict ${await text('[data-testid="moment-verdict"]')} · run ${await text('[data-testid="moment-run"]')} · record line ${await text('[data-testid="m-record"]')}`);
};

// ---- sign in with the throwaway code (the R12 path: Try your own code → code → the paste box), then back to the example ----
await p.goto(process.env.BASE);
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.click('[data-testid="u1-own"]');
await p.fill('[data-testid="e-invite-code"]', CODE);
await p.click('[data-testid="e-invite-go"]');
await p.waitForSelector('[data-testid="u1-code"]', { timeout: 20000 });
await p.click('[data-testid="u1-example"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.waitForTimeout(3000);
await shot("1-example-signed-in");
note(`example: pick strip says ${await text('[data-testid="pick-note"]')}`);

// ---- example: panel before the lock, then the round, the captions, the ask, and "Bet on this part" on getPrice ----
await clickPart("getPrice");
await shot("2-example-panel-before-lock");
note(`panel before lock: ask says "${await text('[data-testid="part-ask-locked"]')}"`);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
await lock("example fetchWithRetry");
await p.waitForSelector('[data-testid="machine-act-ai"]', { timeout: 60000 }).then(() => shot("3-example-act-caption"), () => note("no caption during the act"));
await verdict("example fetchWithRetry");
await p.click('[data-testid="machine-act-list"] > summary').catch(() => note("no step list"));
await p.waitForTimeout(300);
await shot("4-example-verdict-steps");
await p.click('[data-testid="machine-act-list"] > summary').catch(() => {});
await clickPart("getPrice");
await p.fill('[data-testid="part-ask-input"]', "What does this part do with the fetchQuote it is given?");
await p.click('[data-testid="part-ask-go"]');
await p.waitForSelector('[data-testid="part-ask-answer"], [data-testid="part-ask-note"]', { timeout: 90000 });
await p.waitForTimeout(500);
await shot("5-example-ask");
note(`ask: ${await text('[data-testid="part-ask-answer"]') ?? await text('[data-testid="part-ask-note"]')}`);
await p.click('[data-testid="part-bet"]');
await p.waitForFunction(() => /getPrice/.test(document.querySelector('[data-testid="u1-test"]')?.textContent ?? ""), null, { timeout: 180000 });
await p.waitForTimeout(1500);
await shot("6-example-bet-on-getPrice");
await lock("example getPrice");
await verdict("example getPrice");
await shot("7-example-getPrice-verdict");

// ---- a sample file: the pick from the record, accepted; its round; captions; an ask ----
await p.click('[data-testid="u1-own"]');
await p.click('[data-testid="e-sample-fetch-retry"]');
await p.waitForSelector('[data-testid="pick"], [data-testid="pick-note"]', { timeout: 120000 }).catch(() => note("no pick shown"));
await p.waitForTimeout(2500);
await shot("8-sample-pick");
note(`pick: ${await text('[data-testid="pick"]') ?? await text('[data-testid="pick-note"]')}`);
if (await p.$('[data-testid="pick-accept"]')) await p.click('[data-testid="pick-accept"]');
else await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 180000 });
await p.waitForTimeout(1000);
await shot("9-sample-bet");
await lock("sample");
await p.waitForSelector('[data-testid="machine-act-ai"]', { timeout: 60000 }).then(() => shot("10-sample-act-caption"), () => note("no caption during the act"));
await verdict("sample");
await p.click('[data-testid="machine-act-list"] > summary').catch(() => note("no step list"));
await p.waitForTimeout(300);
await shot("11-sample-verdict-steps");
await p.click('[data-testid="machine-act-list"] > summary').catch(() => {});
await clickPart("getJson");
await p.fill('[data-testid="part-ask-input"]', "Why does it wait after a failed try?");
await p.click('[data-testid="part-ask-go"]');
await p.waitForSelector('[data-testid="part-ask-answer"], [data-testid="part-ask-note"]', { timeout: 90000 });
await p.waitForTimeout(500);
await shot("12-sample-ask");
note(`ask: ${await text('[data-testid="part-ask-answer"]') ?? await text('[data-testid="part-ask-note"]')}`);
await p.click('[data-testid="mode-record"]');
await p.waitForSelector('[data-testid="track-remember"]', { timeout: 10000 });
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/13-record.png`, fullPage: true });
note(`record: ${await text('[data-testid="track-record-lines"]')} | ${await text('[data-testid="track-remember-where"]')}`);
writeFileSync(`${OUT}/answers.json`, JSON.stringify(answers, null, 1));
writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
await b.close();
