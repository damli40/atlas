// D20 screenshots, headless Chromium.
// 1. change.html and pipe-replay.html (static pages from the real components, pages.tsx).
// 2. The real proof card, from the running app (server with ATLAS_PUBLISH_PROOFS=1 and the D20 file in its
//    proofs folder), then "Re-run it" (S2: both the original run and the change replay re-run on fresh forks).
// Usage: PLAYWRIGHT_CORE=<path> node shoot.mjs <chromium-headless-shell> <out dir> <app url> <run id>
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const [exe, outDir, appUrl, runId] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const lines = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(pathToFileURL(`${outDir}/change.html`).href);
await page.getByTestId("change").screenshot({ path: `${outDir}/change-screen.png` });
lines.push(`change screen theory caption: ${flat(await page.getByTestId("change-theory").innerText())}`);
lines.push(`change screen table: ${flat(await page.getByTestId("change-table").innerText())}`);
await page.goto(pathToFileURL(`${outDir}/pipe-replay.html`).href);
await page.getByTestId("price-pipe").screenshot({ path: `${outDir}/price-pipe-replay.png` });
lines.push(`price pipe: multiply gear drawn = ${(await page.locator('[data-part="multiply-gear"]').count()) > 0}; theory caption: ${flat(await page.getByTestId("pipe-theory-caption").innerText())}`);

await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(`${appUrl}/?proof=${encodeURIComponent(runId)}`);
await page.getByTestId("proof-card").waitFor({ timeout: 30000 });
await page.getByTestId("proof-card").screenshot({ path: `${outDir}/proof-card.png` });
lines.push(`proof card theory caption: ${flat(await page.getByTestId("pc-change-theory").innerText())}`);
lines.push(`proof card pass-rule note: ${flat(await page.getByTestId("pc-change-pass-rule-theory").innerText())}`);
lines.push(`proof card captions: ${flat(await page.getByTestId("pc-captions").innerText())}`);
const t0 = Date.now();
await page.getByTestId("pc-rerun").click();
await page.locator('[data-testid="pc-replay"], [data-testid="pc-replay-failed"]').first().waitFor({ timeout: 300000 });
lines.push(`re-run it (both runs, ${Math.round((Date.now() - t0) / 1000)} s): ${flat(await page.locator('[data-testid="pc-replay"], [data-testid="pc-replay-failed"]').first().innerText())}`);
await page.getByTestId("proof-card").screenshot({ path: `${outDir}/proof-card-after-rerun.png` });
lines.push(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
writeFileSync(`${outDir}/browser-output.txt`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
await browser.close();
