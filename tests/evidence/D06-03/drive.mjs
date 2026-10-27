// D06-03 browser capture: both proof cards (?proof=<runId>) at 1920×1080 and 390 px, then "Re-run it"
// on each (GET /replay/:runId with the page's session header). Server + Vite must be running, with the
// two example .atlas.json files in the server's proofs folder.
// Usage: PW=<path to playwright-core> node drive.mjs <chrome-headless-shell path> <out dir>
import { writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW ?? "playwright-core");
const [exe, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const lines = [];
const say = (s) => (lines.push(s), console.log(s));
const flat = (s) => s.replace(/\s+/g, " ").trim();
const BANNED = /\b(wrong|correct|bug|fixed|broken)\b/i;
for (const [label, runId] of [["fixture", "eRopGsrp2a"], ["moonwell-level2", "mwTaxvHFzB"]]) {
  for (const [vp, viewport] of [["390", { width: 390, height: 844 }], ["1080p", { width: 1920, height: 1080 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: vp === "390" ? 2 : 1, reducedMotion: "reduce", colorScheme: "light" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const replays = [];
    page.on("request", (r) => r.url().includes("/replay/") && replays.push({ url: r.url().replace(/^.*\/api/, ""), session: r.headers()["x-atlas-session"] ? "sent" : "absent" }));
    await page.goto(`http://localhost:5173/?proof=${runId}`);
    await page.getByTestId("proof-card").waitFor({ timeout: 20000 });
    const text = flat(await page.getByTestId("proof-card").innerText());
    if (vp === "1080p") {
      say(`=== ${label} (${runId})`);
      say(`card text: ${text}`);
      say(`captions: ${JSON.stringify(await page.locator('[data-testid="pc-captions"] li').allInnerTexts())}`);
      say(`banned verdict words on the card: ${BANNED.test(text) ? text.match(BANNED)[0] : "none"}`);
      const t0 = Date.now();
      await page.getByTestId("pc-rerun").click();
      await page.locator('[data-testid="pc-replay"], [data-testid="pc-replay-failed"]').first().waitFor({ timeout: 240000 });
      say(`re-run (${Date.now() - t0} ms real): ${flat(await page.locator('[data-testid="pc-replay"], [data-testid="pc-replay-failed"]').first().innerText())}`);
      say(`replay requests: ${JSON.stringify(replays)}`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
    await page.screenshot({ path: `${outDir}/card-${label}-${vp}.png`, fullPage: vp === "390" });
    say(`${label} ${vp}: horizontal scroll ${overflow ? "yes" : "no"}; whole card inside one screen ${fits ? "yes" : "no"}; page errors: ${errors.length ? errors.join(" | ") : "none"}`);
    await page.close();
  }
}
await browser.close();
writeFileSync(`${outDir}/browser-output.txt`, lines.join("\n") + "\n");
