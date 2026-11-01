// D60: the first screen at a size, then the example round by keys, with the example-to-sealed time.
import { mkdirSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const [OUT, W = "1440", H = "900"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await (await b.newContext({ viewport: { width: +W, height: +H } })).newPage();
p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
await p.goto(process.env.BASE ?? "http://localhost:18962");
await p.waitForSelector('[data-testid="u1-example"]');
await p.waitForTimeout(1600);
await p.screenshot({ path: `${OUT}/first-${W}.png` });
const t0 = Date.now();
await p.click('[data-testid="u1-example"]');
await p.waitForSelector('[data-testid="bench-stage"] svg');
console.log("example -> drawing", Date.now() - t0);
await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
console.log("example -> first question", Date.now() - t0);
const n = (await p.$$(".u1-quiz > li")).length;
for (let i = 0; i < n; i++) {
  await p.keyboard.press("1");
  await p.waitForTimeout(170);
}
await p.keyboard.press("Enter");
await p.waitForSelector('[data-testid="u1-sealed"]', { timeout: 30000 });
console.log("example -> sealed (a machine's keys)", Date.now() - t0);
await p.screenshot({ path: `${OUT}/sealed-${W}.png` });
await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/example-verdict-${W}.png` });
await b.close();
