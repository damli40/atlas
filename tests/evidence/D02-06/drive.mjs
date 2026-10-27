// D02-06 browser round: headless Chromium against `pnpm dev:all` (real server, real Muse Spark call).
// One S3 round: the person bets 5 / 12000 / throws; Spark bets live on the same questions.
// Usage: node drive.mjs <chrome-headless-shell path> <out dir>
import { chromium } from "playwright-core";
const [exe, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 900, height: 1300 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const prerun = [];
page.on("response", async (r) => {
  if (!r.url().includes("/api/") || r.url().endsWith("/runs")) return;
  try { prerun.push({ url: r.url().replace(/^.*\/api/, ""), body: await r.text() }); } catch {}
});
await page.goto("http://localhost:5173/");
await page.getByTestId("pre-existing").waitFor();
console.log("default scenario:", await page.locator('input[name="scenario"]:checked').getAttribute("value"));
await page.getByRole("button", { name: "Show the questions" }).click();
await page.getByTestId("bet-calls").fill("5");
await page.getByTestId("bet-totalWaitMs").fill("12000");
await page.getByTestId("bet-outcome").selectOption("throws");
await page.getByRole("button", { name: "Seal my bets" }).click();
await page.getByTestId("hash-outcome").waitFor();
const t0 = Date.now();
await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 300000 });
const status = await page.getByTestId("model-slot").getAttribute("data-status");
console.log(`model slot: ${status} (waited ${Date.now() - t0} ms after the person sealed)`);
console.log("model slot text:", (await page.getByTestId("model-slot").innerText()).replace(/\s+/g, " "));
const mine = {}, theirs = {};
for (const m of ["calls", "totalWaitMs", "outcome"]) {
  mine[m] = await page.getByTestId(`hash-${m}`).getAttribute("data-hash");
  if (status === "sealed") theirs[m] = await page.getByTestId(`model-hash-${m}`).getAttribute("data-hash");
}
console.log("your hashes before Break it:", JSON.stringify(mine));
console.log("Muse Spark hashes before Break it:", JSON.stringify(theirs));
// Spark's answers must be nowhere in what the browser received before the run.
const leaked = prerun.filter((r) => r.body.includes('"model:muse-spark-1.3","question"') && /"answer"|"rationale"|"nonce"/.test(r.body));
console.log(`pre-run responses: ${prerun.length}; any holding a model answer, rationale or nonce: ${leaked.length}`);
console.log("model panel shows a revealed answer before the run:", (await page.getByTestId("model-panel").count()) > 0);
await page.screenshot({ path: `${outDir}/s3-before-run.png`, fullPage: true });
await page.getByRole("button", { name: "Break it" }).click();
await page.getByTestId("seal-check-outcome").waitFor({ timeout: 30000 });
console.log("table columns:", JSON.stringify(await page.locator(".verdicts th").allInnerTexts()));
for (const m of ["calls", "totalWaitMs", "outcome"]) {
  console.log(`row ${m}:`, (await page.getByTestId(`verdict-${m}`).innerText()).replace(/\s+/g, " "));
}
for (const li of await page.locator(".seals li[data-match]").all()) {
  console.log("seal check:", await li.getAttribute("data-match"), "|", (await li.innerText()).replace(/\s+/g, " "));
}
if (status === "sealed") console.log("model panel:", (await page.getByTestId("model-panel").innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: `${outDir}/s3-after-run.png`, fullPage: true });
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
