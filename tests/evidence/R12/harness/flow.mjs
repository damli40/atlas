// usage: node flow.mjs <label> <codefile|-> [mode: draw|paste|sample:<id>] [pick: index|none]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
// Playwright is not a dependency of this repo: point PLAYWRIGHT_FROM at a folder whose node_modules has it (default: the current folder).
const require = createRequire(`${process.env.PLAYWRIGHT_FROM ?? process.cwd()}/node_modules/`);
const { chromium } = require("playwright");
const S = process.env.R12_SCRATCH; // a scratch folder with store/code.txt, notes/ and shots/ (never the repo)
const [label, file, mode = "draw", pick = "0"] = process.argv.slice(2);
const CODE = readFileSync(S + "/store/code.txt", "utf8").trim().split("\n").pop().trim();
const src = file === "-" ? "" : readFileSync(file, "utf8");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const logs = []; const net = [];
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text().slice(0,300)}`); });
page.on("pageerror", e => logs.push(`[pageerror] ${e.message}`));
page.on("response", r => { if (r.status() >= 400) net.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
const out = [];
const t0 = Date.now();
const snap = async (stage) => {
  const txt = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
  await page.screenshot({ path: `${S}/shots/${label}-${stage}.png`, fullPage: true });
  out.push(`\n##### ${stage} (t=${((Date.now()-t0)/1000).toFixed(1)}s) shot=${S}/shots/${label}-${stage}.png\n${txt}`);
};
const si = await ctx.request.post("http://localhost:8796/api/invite", { data: { code: CODE }, headers: { origin: "http://localhost:8796" } });
if (!si.ok()) { console.log("SIGNIN FAILED", si.status(), await si.text()); process.exit(1); }
await page.goto("http://localhost:8796/", { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
await page.click('[data-testid="u1-own"]');
await page.waitForTimeout(800);
await snap("0-after-invite");
if (mode.startsWith("sample:")) {
  await page.click(`[data-testid="e-sample-${mode.slice(7)}"]`, { timeout: 5000 }).catch(async (e) => { out.push("SAMPLE CLICK FAILED " + e.message.split("\n")[0]); });
} else if (mode === "paste") {
  await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData("text/plain", t); document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); }, src);
} else {
  await page.fill('[data-testid="u1-code"]', src);
  await page.waitForTimeout(300);
  const dis = await page.locator('[data-testid="u1-draw"]').isDisabled();
  if (dis) { out.push("DRAW BUTTON DISABLED"); await snap("1-disabled"); writeFileSync(`${S}/notes/${label}.txt`, out.join("\n")); console.log(`${label}: draw=disabled`); await browser.close(); process.exit(0); }
  else await page.click('[data-testid="u1-draw"]');
}
// wait for drawing / question / terminal state
let state = "timeout"; let clickedBet = false;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    if (document.querySelector('[data-testid="u1-seal"]') && document.querySelectorAll('[data-testid^="opt-"]').length) return document.querySelector('[data-testid="u1-seal"]').disabled ? "q-disabled" : "question";
    if (document.querySelector('[data-testid="e-precheck"]')) return "precheck";
    if (document.querySelector('[data-testid="u1-cant-run"]')) return "cant-run";
    if (document.querySelector('[data-testid="u1-dead-end"]')) return "dead-end";
    const t = document.querySelector('[data-testid="u1-bet-toggle"]');
    if (t && !t.disabled) return "bet-toggle";
    if (document.querySelector('[role="alert"]')) return "alert";
    return "wait";
  });
  if (s === "bet-toggle" && !clickedBet) {
    await page.waitForTimeout(4000); // give summary + names a moment
    await snap("1-drawn");
    await page.click('[data-testid="u1-bet-toggle"]'); clickedBet = true; continue;
  }
  if (s === "question" || s === "precheck" || s === "cant-run" || s === "dead-end" || (s === "alert" && i > 8)) { state = s; break; }
  if (i === 12 && !clickedBet) await snap("1a-early");
}
out.push(`clickedBet=${clickedBet}`);
await page.waitForTimeout(3000); // let summary/names fill in
await snap("2-question");
out.push(`STATE after draw: ${state}`);
if (state === "question" && pick !== "none") {
  const opts = page.locator('[data-testid^="opt-"]');
  const n = await opts.count();
  await opts.nth(Math.min(+pick, n - 1)).click();
  await page.click('[data-testid="u1-seal"]');
  let v = "timeout";
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(1000);
    v = await page.evaluate(() => {
      const b = document.body.innerText;
      if (/Share proof card/i.test(b)) return "verdict";
      if (/can.t check/i.test(b) && /(reason|because|why)/i.test(b) && !document.querySelector('[data-testid="u1-seal"]')) return "maybe-cant-check";
      return "wait";
    });
    if (v === "verdict") break;
    if (i === 8) await snap("3a-running");
  }
  await page.waitForTimeout(2500);
  await snap("4-after-bet");
  out.push(`STATE after bet: ${v}`);
}
out.push("\n#### CONSOLE\n" + logs.join("\n") + "\n#### HTTP>=400\n" + net.join("\n"));
writeFileSync(`${S}/notes/${label}.txt`, out.join("\n"));
console.log(`${label}: draw=${state} total=${((Date.now()-t0)/1000).toFixed(0)}s`);
await browser.close();
