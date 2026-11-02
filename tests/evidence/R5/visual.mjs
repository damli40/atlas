// Final push: the main path's looks, on real runs with models mocked ($0).
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R5/visual.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18942";
const b = await chromium.launch({ executablePath: process.env.CHROME });
let failed = 0;
const out = [];
const say = (name, ok, more = "") => { out.push({ name, ok, more }); if (!ok) failed++; console.log(`${ok ? "pass" : "FAIL"} ${name}${more && !ok ? `: ${more}` : ""}`); };
const pricing = `// CASE_pricing\n${readFileSync(new URL("flaw-aim/pricing.ts", import.meta.url), "utf8")}`;
const answerAll = async (p) => {
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    const li = await p.$(".u1-quiz > li[data-active]");
    await p.keyboard.press(String(await li.$$eval(".u1-opt", (x) => x.length)));
    await p.waitForTimeout(210);
  }
};
// The small print never sits on the drawing.
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.waitForSelector('[data-testid="e-drawing"] .m-sheet', { timeout: 3000 }).catch(() => {});
  const first = await p.evaluate(() => Boolean(document.querySelector('[data-testid="e-drawing"] .m-sheet')));
  say(`${w}: the first screen shows the machine`, first);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/first-${w}-pencilling.png` });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/first-${w}.png` });
  await p.fill('[data-testid="u1-code"]', pricing);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(350);
  await p.click('[data-testid="u1-bet-toggle"]');
  await answerAll(p);
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => { const r = document.querySelector('[data-testid="u1-replay"]'); return r && !r.disabled; }, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const parts = [...document.querySelectorAll('[data-testid="machine"] svg [data-part], [data-testid="machine"] svg text')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const cap = document.querySelector('[data-testid="machine-captions"]').getBoundingClientRect();
    return { low: Math.max(...parts.map((r) => r.bottom)), top: cap.top, n: parts.length, capH: cap.height, words: document.querySelector('[data-testid="machine-captions"] summary').textContent };
  });
  say(`${w}x${h}: everything drawn sits above the small print`, m.n > 0 && m.low <= m.top + 1, JSON.stringify(m));
  say(`${w}x${h}: the small print is one line`, m.capH < 30, JSON.stringify(m));
  await p.screenshot({ path: `${OUT}/result-${w}.png` });
  await p.click('[data-testid="machine-captions"] summary');
  await p.waitForTimeout(150);
  const open = await p.$eval('[data-testid="machine-captions"]', (e) => e.textContent);
  say(`${w}: the fold holds every sentence`, /Helper order comes from a separate traced run/.test(open) && /This code read the clock/.test(open), open.slice(0, 300));
  await p.screenshot({ path: `${OUT}/result-${w}-fold-open.png` });
  await c.close();
}
const open = async (code, w = 1440, h = 900) => {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(1800);
  return { c, p };
};
// A busy loop keeps the machine, with a plain stop line.
{
  const { c, p } = await open(`// CASE_spin\nfunction beat() { return 1; }\nexport function spin() {\n  while (true) { beat(); }\n}\n`);
  await p.click('[data-testid="u1-bet-toggle"]');
  await answerAll(p);
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"], [data-testid="moment"]', { timeout: 90000 });
  await p.waitForTimeout(2500);
  say("a busy loop keeps the machine on screen", (await p.$('[data-testid="machine"] svg')) !== null && (await p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.view)) === "machine");
  const stop = await p.$eval('[data-testid="machine-stop"]', (e) => e.textContent).catch(() => "");
  say("with the plain stop line, and no 'Nothing to draw'", /stopped it/.test(stop) && !(await p.evaluate(() => { const e = [...document.querySelectorAll("h2")].find((h) => /Nothing to draw/.test(h.textContent)); return e && getComputedStyle(e).visibility === "visible"; })), stop);
  await p.screenshot({ path: `${OUT}/busy-loop.png` });
  console.log("   busy:", (await p.evaluate(() => document.querySelector('[data-testid="mark-list"]')?.innerText ?? "")).slice(0, 200).replace(/\n/g, " | "));
  await c.close();
}
// Needs a package: a next step.
{
  const { c, p } = await open(`import OpenAI from "openai";\nexport function ask(q) {\n  return new OpenAI().chat(q);\n}\n`);
  say("a file that needs a package has a next step", (await p.$('[data-testid="u1-cant-run-edit"]')) !== null);
  await p.screenshot({ path: `${OUT}/needs-package.png` });
  await c.close();
}
// Sixty functions: a list.
{
  const many = Array.from({ length: 60 }, (_, i) => `export function handler${i}() { return ${i}; }`).join("\n");
  const { c, p } = await open(many);
  say("sixty functions: a plain list", (await p.$$('[data-testid="part-list"] li')).length === 40);
  say("the list's note gives the true count", /defines 60 functions/.test(await p.$eval('[data-testid="machine-too-many"]', (e) => e.textContent)));
  await p.screenshot({ path: `${OUT}/sixty.png` });
  await c.close();
}
// Too long at 1280x720.
{
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();
  await p.goto(BASE);
  await p.fill('[data-testid="u1-code"]', `export function f() { return 1; }\n${"x".repeat(200000)}`);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => { const e = [...document.querySelectorAll('[role="alert"]')].find((x) => /too long/.test(x.textContent)); if (!e) return null; const q = e.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, h: innerHeight, cut: e.scrollHeight > e.clientHeight + 1 }; });
  say("the too-long message is not clipped at 1280x720", r && r.bottom <= r.h && r.top >= 0 && !r.cut, JSON.stringify(r));
  await p.screenshot({ path: `${OUT}/too-long-1280.png` });
  await c.close();
}
await b.close();
writeFileSync(`${OUT}/visual.json`, JSON.stringify(out, null, 1));
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
