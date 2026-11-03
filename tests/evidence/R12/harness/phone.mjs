// R12: on a phone (390x844, 2x) with no code: the example's question (its "Not live." line), the verdict, and the proof card.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
// Playwright is not a dependency of this repo: point PLAYWRIGHT_FROM at a folder whose node_modules has it (default: the current folder).
const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? process.cwd()}/node_modules/`);
const { chromium } = require("playwright");
const S = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const out = [];
await page.goto("http://localhost:8796/", { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
if (!(await page.$('[data-testid^="opt-"]'))) { const t = await page.$('[data-testid="u1-bet-toggle"]'); if (t) await t.click(); }
await page.waitForSelector('[data-testid^="opt-"]', { timeout: 60000 });
await page.waitForTimeout(1500);
// scroll the bet panel to its end: the last line must clear the fixed foot
await page.evaluate(() => { for (const el of document.querySelectorAll(".u1-pop, .u1-bet")) el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(400);
await page.screenshot({ path: `${S}/shots/phone-1-question-end.png` });
const cover = await page.evaluate(() => {
  const foot = document.querySelector(".u1-foot")?.getBoundingClientRect();
  const lines = [...document.querySelectorAll("p, span")].filter((e) => /Not live\./.test(e.textContent ?? "") && e.children.length === 0);
  return lines.map((e) => { const r = e.getBoundingClientRect(); return { bottom: Math.round(r.bottom), footTop: Math.round(foot?.top ?? 0) }; });
});
out.push("Not live line vs foot (question, scrolled to end): " + JSON.stringify(cover));
await page.locator('[data-testid^="opt-"]').first().click();
await page.click('[data-testid="u1-seal"]');
await page.waitForFunction(() => /Share proof card/.test(document.body.innerText), null, { timeout: 120000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${S}/shots/phone-2-verdict.png` });
await page.getByText("Share proof card").first().click();
await page.waitForSelector('[data-testid="proof-card"]', { timeout: 30000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${S}/shots/phone-3-proof-card.png` });
await page.evaluate(() => { const p = document.querySelector(".u1-proof"); if (p) p.scrollTop = p.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
await page.waitForTimeout(500);
await page.screenshot({ path: `${S}/shots/phone-4-proof-card-end.png` });
const end = await page.evaluate(() => {
  const foot = document.querySelector(".u1-foot")?.getBoundingClientRect();
  const p = document.querySelector(".u1-proof");
  const last = p ? [...p.querySelectorAll("*")].filter((e) => e.children.length === 0 && (e.textContent ?? "").trim() !== "").pop() : null;
  const r = last?.getBoundingClientRect();
  return { lastText: (last?.textContent ?? "").slice(0, 60), lastBottom: Math.round(r?.bottom ?? 0), footTop: Math.round(foot?.top ?? 0), ask: !!document.querySelector('[data-testid="pc-link-ask"]') };
});
out.push("proof card end vs foot: " + JSON.stringify(end));
writeFileSync(`${S}/notes/phone.txt`, out.join("\n"));
console.log(out.join("\n"));
await browser.close();
