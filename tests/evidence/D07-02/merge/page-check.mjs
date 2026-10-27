// Merge check (D07-01 + D07-02): the page loads, the claimant toggle renders, and after one fixture round
// (no model asked: server started with ATLAS_MODEL_BETS=off ATLAS_ADVERSARY=off) the "What else?" panel renders.
// Usage: PLAYWRIGHT_CORE=<path> node page-check.mjs <chrome-headless-shell> <out dir> <page url>
import { writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir, url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = [];
await page.goto(url);
await page.getByTestId("pre-existing").waitFor();
const toggle = page.locator('[data-testid^="claimant"]').first();
out.push(`claimant toggle rendered: ${(await toggle.count()) > 0}; text: ${(await toggle.innerText()).replace(/\s+/g, " ").slice(0, 200)}`);
await page.locator('input[name="scenario"][value="S3"]').check();
await page.getByRole("button", { name: "Show the questions" }).click();
await page.getByTestId("bet-calls").fill("5");
await page.getByTestId("bet-totalWaitMs").fill("12000");
await page.getByTestId("bet-outcome").selectOption("throws");
await page.getByRole("button", { name: "Seal my bets" }).click();
await page.getByTestId("hash-outcome").waitFor();
await page.getByRole("button", { name: "Break it" }).click();
await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
out.push(`What else? panel rendered: ${(await page.getByTestId("adversary").count()) > 0}; button: ${(await page.getByTestId("adversary-ask").count()) > 0}`);
await page.getByTestId("adversary-ask").click();
await page.getByTestId("adversary-result").waitFor({ timeout: 30000 });
out.push(`What else? answer (no Adversary configured): ${(await page.getByTestId("adversary-result").innerText()).replace(/\s+/g, " ")}`);
await page.screenshot({ path: `${outDir}/page-check.png`, fullPage: true });
out.push(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
writeFileSync(`${outDir}/page-check.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));
await browser.close();
