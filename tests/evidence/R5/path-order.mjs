// The box chart's run path for a function that calls three helpers one after another: the thread between helpers says "then", never a call.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R5/path-order.mjs <out dir>
import { mkdirSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
await c.addInitScript(() => sessionStorage.setItem("atlas-view", "chart"));
const p = await c.newPage();
await p.goto(process.env.BASE ?? "http://localhost:18942");
await p.fill('[data-testid="u1-code"]', `# CASE_pynested\ndef count(xs):\n    a = parse(xs)\n    b = middle(a)\n    return top(b)\n\ndef parse(xs):\n    return list(xs)\n\ndef middle(a):\n    return a\n\ndef top(b):\n    return len(b)\n`);
await p.click('[data-testid="u1-draw"]');
await p.waitForSelector('[data-testid="bench-stage"]');
await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.click('[data-testid="u1-seal"]');
await p.waitForSelector('[data-testid="mark-list"]', { timeout: 60000 });
await p.waitForTimeout(3000);
const words = await p.$$eval('[data-testid="bench-path"] text', (x) => x.map((t) => t.textContent));
console.log(JSON.stringify(words));
await p.screenshot({ path: `${OUT}/helpers-in-order.png` });
await b.close();
const then = words.filter((w) => w === "then").length;
console.log(then >= 2 && !words.some((w) => /calls/.test(w)) ? "pass the threads between helpers say then" : "FAIL the threads between helpers");
