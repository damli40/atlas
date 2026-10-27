// D07-01 screenshots of the static pages (pages.tsx), headless Chromium.
// Usage: PLAYWRIGHT_CORE=<path to playwright-core> node shoot.mjs <chromium-headless-shell> <dir>
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const [exe, dir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 2, reducedMotion: "reduce", colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const [html, sel, png] of [
  ["proof-card-fixture.html", '[data-testid="proof-card"]', "proof-card-fixture.png"],
  ["proof-card-moonwell.html", '[data-testid="proof-card"]', "proof-card-moonwell.png"],
  ["verdict-fixture.html", 'section[aria-label="verdicts"]', "verdict-fixture.png"],
]) {
  await page.goto(pathToFileURL(`${dir}/${html}`).href);
  await page.locator(sel).first().screenshot({ path: `${dir}/${png}` });
  console.log(`${png}: ${(await page.locator('[data-testid="bettor-counts"]').first().innerText()).replace(/\s+/g, " ")}`);
}
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
