// D06-02 browser capture: the waves screen at 1920×1080 and 390 px, against the running server + Vite.
// Usage: PW=<path to playwright-core> node drive.mjs <chrome-headless-shell path> <out dir>
import { writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW ?? "playwright-core");
const [exe, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const lines = [];
const say = (s) => (lines.push(s), console.log(s));
for (const [name, viewport] of [["1080p", { width: 1920, height: 1080 }], ["390", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: name === "390" ? 2 : 1, reducedMotion: "reduce", colorScheme: "light" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:5173/");
  await page.getByTestId("mode-scale").click();
  await page.getByTestId("waves").waitFor({ timeout: 20000 });
  say(`${name}: callers ${await page.getByTestId("scale-callers").innerText()} · ${await page.getByTestId("waves-summary").innerText()}`);
  say(`${name}: caption in DOM: "${await page.getByTestId("waves-caption").innerText()}"`);
  const bars = await page.locator('[data-testid="wave-bar"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-from")}:${e.getAttribute("data-count")}`));
  say(`${name}: bars (bucket start ms : calls) ${bars.join(", ")}`);
  await page.getByTestId("scale").screenshot({ path: `${outDir}/waves-200-fail3-${name}.png` });
  if (name === "1080p") {
    await page.getByRole("combobox").selectOption("always");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="wave-bar"]').length === 5, null, { timeout: 20000 });
    say(`${name} every call fails: ${await page.getByTestId("waves-summary").innerText()}`);
    await page.getByTestId("scale").screenshot({ path: `${outDir}/waves-200-always-${name}.png` });
    // Slider to 20 callers (keyboard; the sweep runs when the key is released).
    const slider = page.getByRole("slider", { name: "callers" });
    await slider.focus();
    for (let i = 0; i < 180; i++) await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => /^20 callers/.test(document.querySelector('[data-testid="waves-summary"]')?.textContent ?? ""), null, { timeout: 20000 });
    say(`${name} slider at 20: ${await page.getByTestId("waves-summary").innerText()}`);
    await page.getByTestId("scale").screenshot({ path: `${outDir}/waves-20-always-${name}.png` });
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  say(`${name}: horizontal scroll: ${overflow ? "yes" : "no"} · page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await page.close();
}
await browser.close();
writeFileSync(`${outDir}/browser-output.txt`, lines.join("\n") + "\n");
