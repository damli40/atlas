// R10 (D72): the hosted set-up with no invite code (tests/evidence/R10/server.mts). Checks made on the page itself, then
// screenshots: the example plays to a verdict and a proof card with no code; "Try another question" and "Try your own code"
// show the one line with "Join the waitlist" and "I have a code"; and the server's own count of model calls stays 0.
//   PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:18970 node tests/evidence/R10/shots.mjs tests/evidence/R10/shots
import { mkdirSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
const BASE = process.env.BASE;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const text = (p, sel) => p.$eval(sel, (e) => e.textContent ?? "").catch(() => null);
for (const [w, h] of [[1280, 800]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await c.newPage();
  p.on("pageerror", (e) => say(`${w}: no page error`, false, e.message));
  const statuses = [];
  p.on("response", (r) => { if (r.url().includes("/api/")) statuses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  await p.goto(BASE);
  // 1. The first screen, no code: the example draws and its question is ready.
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForFunction(() => /recorded answer/.test(document.querySelector('[data-testid="u1-ais"]')?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/1-no-code-first-screen-${w}x${h}.png` });
  say("no code: the example is drawn and its question is ready", await p.isVisible('[data-testid="u1-seal"]'));
  say("no code: no invite form on the first screen", !(await p.isVisible('[data-testid="e-invite"]')));
  say("no code: the AIs' answers are the recorded ones, labelled", /recorded answer \(Nov 2\)/.test((await text(p, '[data-testid="u1-ais"]')) ?? ""), (await text(p, '[data-testid="u1-ais"]')) ?? "");
  // 2. Bet and run, no code.
  await p.click(".u1-quiz .u1-opt >> nth=0");
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]')?.dataset.phase === "marked", null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/2-no-code-result-${w}x${h}.png` });
  const verdict = (await text(p, '[data-testid="moment-verdict"]')) ?? "";
  say("no code: the sandbox ran and the verdict is shown", /matched|didn't match/.test(verdict), verdict);
  // 3. The proof card.
  await p.click('[data-testid="u1-proof"]');
  await p.waitForSelector('[data-testid="pc-credit"]', { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/3-no-code-proof-card-${w}x${h}.png` });
  say("no code: the proof card opens", /recorded Nov 2/.test((await text(p, '[data-testid="pc-credit"]')) ?? ""));
  await p.keyboard.press("p");
  await p.waitForTimeout(400);
  // 4. "Try another question" asks the AIs live: the one line, with the waitlist and "I have a code".
  await p.click('[data-testid="u1-try-another"]');
  await p.waitForSelector('[data-testid="waitlist-link"]', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(400);
  const line = (await p.$eval('[data-testid="waitlist-link"]', (e) => e.closest('[role="alert"]')?.textContent ?? "").catch(() => "")) ?? "";
  say("Try another question: the one line, Join the waitlist and I have a code", /needs an invite code/.test(line) && /Join the waitlist/.test(line) && /I have a code/.test(line), line);
  say("the waitlist link opens the form named by the server, in a new tab", (await p.$eval('[data-testid="waitlist-link"]', (e) => `${e.getAttribute("href")} ${e.getAttribute("target")}`).catch(() => "")) === "https://example.com/atlas-waitlist-placeholder _blank");
  await p.$eval('[data-testid="waitlist-link"]', (e) => e.closest('[role="alert"]')?.scrollIntoView({ block: "center" })).catch(() => {});
  await p.screenshot({ path: `${OUT}/4-waitlist-prompt-try-another-${w}x${h}.png` });
  // 5. "Try your own code": the paste box with the line, the waitlist and the code box.
  await p.click('[data-testid="u1-own"]');
  await p.waitForSelector('[data-testid="e-needs-code"]', { timeout: 10000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/5-waitlist-prompt-own-code-${w}x${h}.png` });
  const own = (await text(p, '[data-testid="e-needs-code"]')) ?? "";
  say("Try your own code: the line with Join the waitlist and I have a code, and the code box", /needs an invite code/.test(own) && /Join the waitlist/.test(own) && /I have a code/.test(own) && (await p.isVisible('[data-testid="e-invite"]')), own);
  say("Try your own code: Draw my code and the samples are off without a code", (await p.isDisabled('[data-testid="u1-draw"]')) && (await p.$$eval('[data-testid^="e-sample-"]', (x) => x.every((y) => y.disabled))));
  say("Try your own code: the way back to the example is there", await p.isVisible('[data-testid="u1-example"]'));
  const ev = await (await fetch(`${BASE}/__evidence`)).json();
  say("the server asked no model at all", ev.modelCalls === 0, JSON.stringify(ev.calls));
  writeFileSync(`${OUT}/api-statuses.txt`, statuses.join("\n") + "\n");
  await c.close();
}
await b.close();
writeFileSync(`${OUT}/../shots.txt`, out.map((o) => `${o.ok ? "pass" : "FAIL"} ${o.name}${o.more ? `: ${o.more}` : ""}`).join("\n") + "\n");
process.exit(failed ? 1 : 0);
