// D65 style proof: the machine in the real page. Models mocked, $0. Against a mock server and vite with ?machine=1.
//   PW=<playwright-core> CHROME=<headless shell> BASE=http://localhost:18972 node tests/evidence/R4/style/shots.mjs [out dir]
import { readFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2] ?? new URL(".", import.meta.url).pathname;
const BASE = process.env.BASE ?? "http://localhost:18972";
const here = new URL("../../U3/inputs/", import.meta.url);
const ORDERS = readFileSync(new URL("orders.ts", here), "utf8");
const PLAN = readFileSync(new URL("plan_cache.py", here), "utf8");
// A file that fans out, to see the layout's weak case. Not one of the three asked for.
const EXAMPLE = `const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoffMs(attempt: number) {
  return 200 * 2 ** attempt;
}
export function parse(text: string) {
  if (!text) throw new Error("empty");
  return JSON.parse(text);
}
export async function fetchWithRetry(fetchIt: () => Promise<string>, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return parse(await fetchIt());
    } catch (e) {
      await sleep(backoffMs(i));
    }
  }
  throw new Error("gave up");
}
export async function getPrice(fetchIt: () => Promise<string>) {
  const body = await fetchWithRetry(fetchIt);
  return body.price;
}
`;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const page = async (w, h, q = "") => {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  await p.goto(`${BASE}/?machine=1${q}`);
  return p;
};
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  for (const [name, code] of [["orders", ORDERS], ["python", PLAN], ["branching", EXAMPLE]]) {
    const p = await page(w, h);
    await p.fill('[data-testid="u1-code"]', code);
    await p.click('[data-testid="u1-draw"]');
    await p.waitForSelector('[data-testid="machine"] svg');
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${name}-rest-${w}x${h}.png` });
    if (name === "orders") {
      await p.click('[data-testid="u1-bet-toggle"]');
      await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
      await p.waitForTimeout(400);
      await p.keyboard.press("c");
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/${name}-bet-faked-${w}x${h}.png` });
      const n = (await p.$$(".u1-quiz > li")).length;
      for (let i = 0; i < n; i++) {
        await p.keyboard.press("1");
        await p.waitForTimeout(190);
      }
      await p.click('[data-testid="u1-seal"]');
      await p.waitForSelector('[data-testid="u1-actions"]', { timeout: 90000 });
      await p.keyboard.press("Space");
      await p.waitForSelector('[data-testid="machine-result"] svg', { timeout: 30000 });
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${OUT}/${name}-ring-${w}x${h}.png` });
    }
    await p.context().close();
  }
  for (const [name, q] of [["moonwell-rest", "&ring=0"], ["moonwell-ring", ""]]) {
    const p = await page(w, h, q);
    await p.click('[data-testid="u1-demos"]');
    await p.click('[data-testid="mode-pr"]');
    await p.waitForSelector('[data-testid="machine"] svg');
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/${name}-${w}x${h}.png` });
    await p.context().close();
  }
}
await b.close();
