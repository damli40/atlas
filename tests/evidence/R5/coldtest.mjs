// Cold test items, on real runs through the real page. Models mocked, $0.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> BASE_LIMIT=<page whose server allows one model round an hour> node tests/evidence/R5/coldtest.mjs <out dir>
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18942";
const b = await chromium.launch({ executablePath: process.env.CHROME });
let failed = 0;
const out = [];
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more && !ok ? `: ${more}` : ""}`);
};
const open = async (code, { base = BASE, width = 1440, height = 900 } = {}) => {
  const c = await b.newContext({ viewport: { width, height } });
  const p = await c.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(base);
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(350);
  return { c, p };
};
const answerAll = async (p, typed = null) => {
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    const li = await p.$(".u1-quiz > li[data-active]");
    const box = li && (await li.$(".u1-typed-in"));
    if (typed !== null && box) {
      await box.fill(typed);
      await box.press("Enter");
    } else await p.keyboard.press(String(await li.$$eval(".u1-opt", (x) => x.length)));
    await p.waitForTimeout(210);
  }
};
const toResult = async (p) => {
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(600);
};
const notes = (p) => p.$$eval('[data-testid="result-note"]', (x) => x.map((e) => e.textContent));
const J = (k, src) => `// CASE_${k}\n${src}`;

// 1. Two values that differ only in spaces.
{
  const { c, p } = await open(J("padded", `export function report(name) {\n  return ["/a".padEnd(5) + name];\n}\n`));
  await p.click('[data-testid="u1-bet-toggle"]');
  await answerAll(p, '["/a p50"]');
  await toResult(p);
  const run = await p.$eval('[data-testid="moment-run"]', (e) => ({ text: e.textContent, ws: getComputedStyle(e).whiteSpace, w: e.getBoundingClientRect().width }));
  say("the run's value keeps its spaces in the page", /\/a {3}p50/.test(run.text) && run.ws === "pre-wrap", JSON.stringify(run));
  const n = await notes(p);
  say("a plain sentence says they differ only in spaces", n.some((x) => /differ only in their spaces/.test(x)), JSON.stringify(n));
  await p.screenshot({ path: `${OUT}/1-spaces.png` });
  await c.close();
}
// 4. A nested call in a Python comprehension is lit, with its thread; the sentence is true of what is drawn.
{
  const { c, p } = await open(`# CASE_pynested\ndef count(xs):\n    return len(dedupe(xs))\n\ndef dedupe(xs):\n    return [norm(x) for x in xs]\n\ndef norm(s):\n    return s.strip()\n`);
  await p.click('[data-testid="u1-bet-toggle"]');
  await answerAll(p);
  await toResult(p);
  await p.waitForTimeout(1500);
  const s = await p.evaluate(() => ({
    lamps: [...document.querySelectorAll('[data-testid="machine"] .m-lamp[data-on]')].map((l) => l.dataset.lamp),
    ran: [...document.querySelectorAll('[data-testid="machine"] .m-thread[data-ran]')].map((t) => t.dataset.route),
    caption: document.querySelector('[data-testid="machine-captions"]')?.textContent ?? "",
    labels: [...document.querySelectorAll('[data-testid="machine"] [data-part]')].map((x) => x.getAttribute("aria-label")).join(" | "),
  }));
  say("the function called inside a comprehension keeps its lit lamp at rest", s.lamps.includes("norm"), JSON.stringify(s));
  say("its thread is drawn, the caller being certain", s.ran.includes("dedupe->norm"), JSON.stringify(s));
  say("the sentence speaks of what is lit, not of every step", /What is lit comes from run/.test(s.caption) && !/Every step/.test(s.caption), s.caption);
  say("no Python part says exported", !/exported/.test(s.labels), s.labels);
  await p.screenshot({ path: `${OUT}/4-python-nested.png` });
  await c.close();
}
// 6. A scripted fake the code never called.
{
  const { c, p } = await open(J("unusedfake", `export function summarize(fetchIt) {\n  if (!process.env.NOPE_KEY) throw new Error("NOPE_KEY is not set");\n  return fetchIt();\n}\n`));
  await p.click('[data-testid="u1-bet-toggle"]');
  await answerAll(p);
  await toResult(p);
  const n = await notes(p);
  say("the page says the scripted answer was never used", n.some((x) => x === "The scripted answer was never used: fetchIt was called 0 times."), JSON.stringify(n));
  await p.screenshot({ path: `${OUT}/6-scripted-never-used.png` });
  await c.close();
}
// 5. More parts than the outline keeps; nothing to draw.
{
  const many = Array.from({ length: 301 }, (_, i) => `export function step${i}() { return ${i}; }`).join("\n");
  const { c, p } = await open(many);
  const w = await p.$eval('[data-testid="machine-too-many"]', (e) => e.textContent);
  say("the note gives the file's true count", /301 functions and classes/.test(w) && /first 40/.test(w), w);
  const overlap = await p.evaluate(() => {
    const n = document.querySelector('[data-testid="machine-too-many"]').getBoundingClientRect();
    const box = document.querySelector(".r-chart").getBoundingClientRect();
    return box.top < n.bottom - 1;
  });
  say("the note does not sit on the chart", !overlap);
  await p.screenshot({ path: `${OUT}/5-long-file.png` });
  await c.close();
  const j = await open(`const a = 1;\nconst b = 2;\n`);
  say("nothing to draw promises no chart", (await j.p.$('[data-testid="machine-too-many"]')) === null);
  await j.p.screenshot({ path: `${OUT}/5-junk.png` });
  await j.c.close();
}
// The code panel closes at the result, once, at every width; C opens it again. Enter opens the bet. Ligatures off. Long lines wrap.
for (const width of [1280, 1600]) {
  const code = `// CASE_panel\nexport function pad(a) {\n  // a long line ${"x".repeat(300)}\n  return a === 1 ? "one" : "other";\n}\n`;
  const { c, p } = await open(code, { width, height: 800 });
  say(`${width}: the bet's key is shown`, (await p.$eval('[data-testid="u1-bet-toggle"]', (e) => e.textContent)).includes("Enter"));
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="u1-seal"], .u1-quiz', { timeout: 60000 });
  say(`${width}: Enter on the first screen opens the bet`, (await p.$('[data-testid="u1-pop"]')) !== null);
  await p.keyboard.press("c");
  await p.waitForSelector(".c-drawer");
  const f = await p.$eval(".c-line", (e) => ({ lig: getComputedStyle(e).fontVariantLigatures, fs: getComputedStyle(e).fontFeatureSettings, ws: getComputedStyle(e).whiteSpace }));
  say(`${width}: ligatures are off in code`, f.lig === "none", JSON.stringify(f));
  const wrap = await p.evaluate(() => { const d = document.querySelector(".c-drawer"); const l = [...d.querySelectorAll(".c-line")].find((x) => x.textContent.includes("xxxx")); return l.getBoundingClientRect().right <= d.getBoundingClientRect().right + 1 && l.getBoundingClientRect().height > 30; });
  say(`${width}: a long line wraps inside the panel`, wrap);
  await answerAll(p);
  await toResult(p);
  say(`${width}: the code panel has closed at the result`, (await p.$(".c-drawer")) === null || !(await p.$eval(".c-drawer", (e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility === "visible")));
  await p.screenshot({ path: `${OUT}/panel-closed-${width}.png` });
  await p.keyboard.press("c");
  await p.waitForTimeout(200);
  say(`${width}: C opens it again`, (await p.$(".c-drawer")) !== null);
  await c.close();
}
// The agent log's button keeps its width, so the header does not overlap.
{
  const { c, p } = await open("export function f() { return 1; }\n");
  await p.click('[data-testid="u1-log-toggle"]');
  await p.waitForTimeout(200);
  const hit = await p.evaluate(() => {
    const r = [...document.querySelectorAll("header nav > button, header nav > a, header nav > details > summary, .u1-code-toggle")].map((e) => e.getBoundingClientRect()).filter((x) => x.width > 0);
    return r.some((a, i) => r.some((z, j) => j > i && a.left < z.right - 1 && z.left < a.right - 1));
  });
  say("nothing in the header overlaps with the log open", !hit);
  await c.close();
}
// 2. A bettor that was asked for and not asked is named, with why, before and after the run.
if (process.env.BASE_LIMIT) {
  const code = "// CASE_fone\nexport function f(a) { return a; }\n";
  // Each paste's early Muse Wonder call takes one of the address's model rounds, so with a limit of one the bettors are refused on this very round.
  const first = await open(code, { base: process.env.BASE_LIMIT });
  const p = first.p;
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  const before = await p.$$eval('[data-testid^="u1-model-off-"]', (x) => x.map((e) => e.textContent));
  say("before the run: the page says who is not betting, and why", before.length > 0 && before.every((t) => /is not betting on this round: .*limit/.test(t)), JSON.stringify(before));
  say("the reason is not cut off", await p.$$eval('[data-testid^="u1-model-off-"]', (x) => x.every((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis")));
  await p.screenshot({ path: `${OUT}/2-bettors-not-asked-bet.png` });
  await answerAll(p);
  await toResult(p);
  const n = await notes(p);
  say("after the run: the page says who did not bet, and why", n.some((x) => /did not bet on this round: .*limit/.test(x)), JSON.stringify(n));
  await p.screenshot({ path: `${OUT}/2-bettors-not-asked-result.png` });
  await first.c.close();
} else say("the bettors case needs BASE_LIMIT", false);
await b.close();
writeFileSync(`${OUT}/coldtest.json`, JSON.stringify(out, null, 1));
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
