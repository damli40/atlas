// Final push: the main path's looks, on real runs with models mocked ($0).
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R5/visual.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
// R7 (D69): the first screen is the example with its question; the paste box is behind "Try your own code".
const own = async (p) => {
  await p.waitForSelector('[data-testid="u1-own"], [data-testid="u1-code"]');
  if (!(await p.$('[data-testid="u1-code"]'))) await p.click('[data-testid="u1-own"]');
  await p.waitForSelector('[data-testid="u1-code"]');
};
// R7: the result's other controls are under "More"; the bet's extra questions under "More options for this bet".
const openMore = async (p) => {
  if (!(await p.$eval('[data-testid="u1-result-more"]', (d) => d.open).catch(() => true))) await p.click('[data-testid="u1-result-more"] > summary');
};
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
  // R7: the first screen is the example's real machine (the entry's drawing only shows while it is read).
  await p.waitForSelector('[data-testid="machine"] .m-sheet, [data-testid="e-drawing"] .m-sheet', { timeout: 3000 }).catch(() => {});
  const first = await p.evaluate(() => Boolean(document.querySelector('[data-testid="machine"] .m-sheet, [data-testid="e-drawing"] .m-sheet')));
  say(`${w}: the first screen shows the machine`, first);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/first-${w}-pencilling.png` });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/first-${w}.png` });
  await own(p);
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
  await openMore(p); // R7: the trace note is fine print under "More"
  await p.waitForTimeout(300);
  const m = await p.evaluate(() => {
    const parts = [...document.querySelectorAll('[data-testid="machine"] svg [data-part], [data-testid="machine"] svg text')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    const cap = document.querySelector('[data-testid="machine-captions"]').getBoundingClientRect();
    return { low: Math.max(...parts.map((r) => r.bottom)), top: cap.top, n: parts.length, capH: cap.height, words: document.querySelector('[data-testid="machine-captions"] summary').textContent };
  });
  say(`${w}x${h}: everything drawn sits above the small print`, m.n > 0 && m.low <= m.top + 1, JSON.stringify(m));
  say(`${w}x${h}: the small print is one line`, m.capH < 30, JSON.stringify(m));
  await p.screenshot({ path: `${OUT}/result-${w}.png` });
  // Every button in the left column can be clicked: scrolled into view, the point at its middle is that button, not the action bar.
  const blocked = await p.evaluate(async () => {
    const out = [];
    for (const el of document.querySelectorAll(".u1-marks button, .u1-marks summary")) {
      if (el.closest("[hidden]") || el.getBoundingClientRect().width === 0) continue;
      const fold = el.closest("details");
      if (fold && !fold.open && el.tagName !== "SUMMARY") continue; // folded: not on screen until opened
      el.scrollIntoView({ block: "nearest" });
      await new Promise((r) => requestAnimationFrame(r));
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) out.push(`${el.textContent.trim().slice(0, 30)} under ${hit ? `${hit.tagName}.${hit.className}`.slice(0, 50) : "nothing"} at ${Math.round(r.top)}`);
    }
    return out;
  });
  say(`${w}x${h}: every button in the left column can be clicked`, blocked.length === 0, JSON.stringify(blocked));
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
  await own(p);
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(1800);
  return { c, p };
};
// A typed value is never cut mid-token: whole in the list, cut only between items with a count where space is short.
{
  const { c, p } = await open(`// CASE_padded\nexport function report(name) {\n  return { count: 3, median: 10, p95: 100, slowest: 100, name };\n}\n`);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  // R7: one question by default; this check needs the typed-value question, so ask every question (fine print).
  await p.click('[data-testid="u1-bet-more"] > summary');
  await p.click('[data-testid="u1-more-questions"]');
  await p.waitForFunction(() => document.querySelectorAll(".u1-quiz > li").length > 1, null, { timeout: 60000 });
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    const li = await p.$(".u1-quiz > li[data-active]");
    if (!li) break;
    const box = await li.$(".u1-typed-in");
    if (box) {
      await box.fill('{"count":3,"median":10,"p95":100,"slowest":100,"name":"p50"}');
      await box.press("Enter");
    } else await p.keyboard.press(String(await li.$$eval(".u1-opt", (x) => x.length)));
    await p.waitForTimeout(210);
  }
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForTimeout(1500);
  // Each piece of text that ends a cut: what comes before "…" must end at a space, a comma or a bracket, never inside a token.
  const bad = await p.evaluate(() => [...document.querySelectorAll('.u1-pick, .m-pick, .m-you-v, [data-testid="machine"] text, [data-testid="bench-path"] text')].map((e) => e.textContent).filter((t) => /[^\s,\]}] ?…$/.test(t.trim()) && !/ …$/.test(t.trim())));
  say("no value is cut mid-token", bad.length === 0, JSON.stringify(bad));
  await p.screenshot({ path: `${OUT}/values-whole.png` });
  await c.close();
}
// Keys: what the hint shows is true.
{
  const { c, p } = await open(`// CASE_noarg\nexport function f() {\n  return 1;\n}\n`);
  await p.focus(".u1-mark");
  await p.keyboard.press("Tab");
  await p.keyboard.press("Shift+Tab");
  const before = await p.evaluate(() => document.activeElement?.className);
  await p.evaluate(() => document.activeElement?.blur());
  await p.click('[data-testid="u1-new"]').catch(() => {});
  await own(p);
  await p.fill('[data-testid="u1-code"]', `// CASE_noarg\nexport function f() {\n  return 2;\n}\n`);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(500);
  await p.keyboard.press("Enter");
  await p.waitForTimeout(400);
  say("Enter opens the bet the button's hint promises, after a new drawing", (await p.$('[data-testid="u1-pop"]')) !== null, String(before));
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await answerAll(p);
  // R7: "How sure" is under "More options for this bet".
  await p.click('[data-testid="u1-bet-more"] > summary');
  const sure = await p.$('.felt-opt');
  if (sure) {
    // Tab to "sure" without picking it, then Enter: it picks "sure" and seals.
    await sure.focus();
    let sentSure = null;
    p.on("request", (r) => { if (r.method() === "POST" && /\/bets$/.test(r.url())) sentSure = JSON.parse(r.postData() ?? "{}").confidence ?? null; });
    await p.keyboard.press("Enter");
    await p.waitForTimeout(600);
    say("Enter on a how-sure level picks it before sealing", sentSure === "sure", String(sentSure));
    await p.waitForSelector('[data-testid="mark-list"]', { timeout: 30000 }).catch(() => {});
    say("Enter after picking how sure seals, as ↵ says", (await p.$('[data-testid="mark-list"]')) !== null);
  } else say("the how-sure picker is there", false);
  await c.close();
}
// A language Atlas doesn't read: one message.
{
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();
  await p.goto(BASE);
  await own(p);
  await p.fill('[data-testid="u1-code"]', `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n`);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="u1-nothing-why"]', { timeout: 20000 });
  const msgs = await p.evaluate(() => ['[data-testid="u1-cant-run"]', '[data-testid="u1-cant-run-next"]', '[data-testid="u1-nothing-why"]'].filter((q) => document.querySelector(q)));
  say("a Go file shows one message", msgs.length === 1, JSON.stringify(msgs));
  await p.screenshot({ path: `${OUT}/go-file.png` });
  await c.close();
}
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
  await own(p);
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
