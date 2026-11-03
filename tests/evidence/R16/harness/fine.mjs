import { readFileSync } from "node:fs";
const pwm = await import(process.env.PW); const { chromium } = pwm.default ?? pwm;
const CODE = readFileSync(process.env.CODE_FILE, "utf8").trim();
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
for (const [w, h] of [[1280, 800], [1440, 900], [390, 844]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 })).newPage();
  await p.goto(process.env.BASE); await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 }); await p.waitForTimeout(1500);
  const n = await p.$$eval('[data-testid="e-consent"]', (x) => x.length);
  const t = /Your code goes to Meta's AI/.test(await p.evaluate(() => document.body.innerText));
  out.push(`${n === 0 && !t ? "PASS" : "FAIL"} ${w}x${h} example first screen: consent lines ${n}, sentence on page ${t}`);
  await p.screenshot({ path: `${process.argv[2]}/${w}x${h}-fine-first-screen.png` });
  if (w === 1280) {
    await p.click('[data-testid="u1-own"]'); await p.waitForTimeout(400); await p.fill('[data-testid="e-invite-code"]', CODE); await p.click('[data-testid="e-invite-go"]');
    await p.waitForSelector('[data-testid="e-samples"]', { timeout: 20000 });
    const pb = await p.$$eval('[data-testid="e-consent"]', (x) => x.map((e) => e.textContent));
    out.push(`${pb.some((x) => /Your code goes to Meta's AI/.test(x)) ? "PASS" : "FAIL"} 1280x800 the paste box still says it: ${pb.length} line(s)`);
    await p.click('[data-testid="e-sample-rate-cache"]'); await p.waitForSelector('[data-testid="bench-stage"]', { timeout: 60000 }); await p.waitForTimeout(1500);
    const own = /Your code goes to Meta's AI/.test(await p.evaluate(() => document.body.innerText));
    out.push(`${own ? "PASS" : "FAIL"} 1280x800 a sample (real calls) still says it on its bet screen`);
  }
  await p.context().close();
}
await b.close();
console.log(out.join("\n"));
