// R16 review Major 1: paste anywhere on the example's first screen (and its verdict), with and without a code.
import { readFileSync } from "node:fs";
const pwm = await import(process.env.PW); const { chromium } = pwm.default ?? pwm;
const CODE = readFileSync(process.env.CODE_FILE, "utf8").trim();
const OUT = process.argv[2];
const SRC = "export async function pasteProbeFn(x: number) {\n  return x + 1;\n}\n";
const b = await chromium.launch({ executablePath: process.env.CHROME });
const lines = [];
const check = (name, ok, d = "") => lines.push(`${ok ? "PASS" : "FAIL"} ${name}${d ? ` | ${d}` : ""}`);
const paste = (p) => p.evaluate((src) => { const dt = new DataTransfer(); dt.setData("text/plain", src); document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, SRC);
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const tag = `${w}x${h}`;
  for (const withCode of [true, false]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 })).newPage();
    const sent = [];
    p.on("request", (r) => { if (/\/paste$/.test(r.url()) && r.method() === "POST" && (r.postData() ?? "").includes("pasteProbeFn")) sent.push(r.url()); });
    await p.goto(process.env.BASE); await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 }); await p.waitForTimeout(1200);
    if (withCode) {
      // Sign in through the invite page's API in this browser (its cookie), then reload: the example's first screen, with a code.
      await p.click('[data-testid="u1-own"]'); await p.waitForTimeout(300); await p.fill('[data-testid="e-invite-code"]', CODE); await p.click('[data-testid="e-invite-go"]');
      await p.waitForSelector('[data-testid="e-samples"]', { timeout: 20000 });
      await p.goto(process.env.BASE); await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 }); await p.waitForTimeout(1200);
    }
    const consent = await p.$$eval('[data-testid="e-consent"]', (x) => x.filter((e) => e.offsetParent !== null).length);
    await paste(p);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}/${tag}-paste-${withCode ? "code" : "nocode"}.png` });
    if (withCode) {
      const drawn = /pasteProbeFn/.test(await p.evaluate(() => document.body.innerText));
      check(`${tag} with a code: a paste on the example's first screen starts POST /paste and draws it`, sent.length === 1 && drawn, `consent lines visible ${consent}, POSTs ${sent.length}, drawn ${drawn}`);
    } else {
      const box = await p.$('[data-testid="e-needs-code"]');
      const val = await p.$eval('[data-testid="u1-code"]', (e) => e.value).catch(() => "");
      check(`${tag} without a code: a paste opens the paste box with the text, sends nothing`, box !== null && /pasteProbeFn/.test(val) && sent.length === 0, `consent lines visible ${consent}, POSTs ${sent.length}`);
    }
    await p.context().close();
  }
}
// The example's verdict, with a code: paste there too.
{
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const sent = [];
  p.on("request", (r) => { if (/\/paste$/.test(r.url()) && r.method() === "POST" && (r.postData() ?? "").includes("pasteProbeFn")) sent.push(r.url()); });
  await p.goto(process.env.BASE); await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.click('[data-testid="u1-own"]'); await p.waitForTimeout(300); await p.fill('[data-testid="e-invite-code"]', CODE); await p.click('[data-testid="e-invite-go"]');
  await p.waitForSelector('[data-testid="e-samples"]', { timeout: 20000 });
  await p.goto(process.env.BASE); await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 }); await p.waitForTimeout(800);
  await p.click(".u1-quiz .u1-opt >> nth=0"); await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 120000 }); await p.waitForTimeout(1500);
  await paste(p); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/1280x800-paste-on-verdict.png` });
  check("1280x800 with a code: a paste on the example's verdict starts POST /paste", sent.length === 1, `POSTs ${sent.length}`);
  await p.context().close();
}
await b.close();
console.log(lines.join("\n"));
