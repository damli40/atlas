// R11: outline → box → "Bet on <fn>" → the bet panel, driven in a real browser against a running Atlas page.
// Logs every API request and answer time, and screenshots each step, so a blank bet panel is caught with evidence.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R11/outline-bet.mjs <out dir> <files...>
// Options (env): BOX=<text on the box to pick> (default "score"), FN=<function> (default computeScore),
//   JOB=<an outline job id already done in this session> is not supported: each run starts its own outline job (paid).
import { mkdirSync, writeFileSync } from "node:fs";
const pw = await import(process.env.PW);
const chromium = pw.chromium ?? pw.default.chromium;
const OUT = process.argv[2];
const FILES = process.argv.slice(3);
const BOX = process.env.BOX ?? "score";
const FN = process.env.FN ?? "computeScore";
const WAIT_BET_MS = Number(process.env.WAIT_BET_MS ?? 180000);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
const t0 = Date.now();
const log = [];
const say = (s) => {
  const line = `${String(Date.now() - t0).padStart(7)} ms  ${s}`;
  log.push(line);
  console.log(line);
};
p.on("pageerror", (e) => say(`page error: ${e.message}`));
p.on("console", (m) => m.type() === "error" && say(`console error: ${m.text()}`));
p.on("request", (r) => r.url().includes("/api/") && say(`→ ${r.method()} ${r.url().replace(/^.*\/api/, "")}`));
p.on("response", async (r) => {
  if (!r.url().includes("/api/")) return;
  let body = "";
  try {
    const u = r.url();
    if (/\/paste$|\/paste\/proposals|\/experiments/.test(u)) body = (await r.text()).slice(0, 300);
  } catch {}
  say(`← ${r.status()} ${r.url().replace(/^.*\/api/, "")}${body ? `  ${body.replace(/\s+/g, " ")}` : ""}`);
});
const shot = async (name) => {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  say(`screenshot ${name}.png`);
};
const panel = async () =>
  p.evaluate(() => {
    const pop = document.querySelector('[data-testid="u1-pop"]');
    const toggle = document.querySelector('[data-testid="u1-bet-toggle"]');
    return { popOpen: pop !== null, popText: pop ? (pop.textContent ?? "").trim().slice(0, 240) : null, toggle: toggle !== null };
  });

await p.goto(process.env.BASE);
// The first screen: the example draws and its bet opens by itself (R7, D69).
await p.waitForSelector('[data-testid="u1-pop"]', { timeout: 60000 }).catch(() => say("the example's bet did not open"));
await p.waitForTimeout(1500);
say(`first screen: ${JSON.stringify(await panel())}`);
await shot("1-first-screen");
await p.click('[data-testid="mode-explore"]');
await p.setInputFiles('[data-testid="outline-files"]', FILES);
await p.click('[data-testid="outline-upload"]');
say("outline job started (paid: one Muse Wonder outline call)");
await p.waitForSelector('[data-testid="explorer-machine"]', { timeout: 600000 });
await p.waitForTimeout(3000);
await shot("2-outline");
// The boxes' names as the page lists them.
const names = await p.$$eval('[data-testid="explorer-stage"] text', (xs) => xs.map((x) => x.textContent));
say(`drawn text: ${JSON.stringify(names).slice(0, 1500)}`);
writeFileSync(`${OUT}/outline-text.json`, JSON.stringify(names, null, 1));
// Pick the box: walk the stage with the keyboard until the card offers "Bet on <FN>".
await p.focus('[data-testid="explorer-stage"]');
let found = false;
for (let i = 0; i < 60 && !found; i++) {
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(150);
  found = (await p.$(`[data-testid="bet-${FN}"]`)) !== null;
}
if (!found) {
  // Fallback: click the drawn text that holds BOX.
  const el = p.locator('[data-testid="explorer-stage"] text', { hasText: new RegExp(BOX, "i") }).first();
  await el.click({ force: true }).catch((e) => say(`could not click a box with "${BOX}": ${e.message}`));
  await p.waitForTimeout(500);
  found = (await p.$(`[data-testid="bet-${FN}"]`)) !== null;
}
say(`card offers Bet on ${FN}: ${found}`);
await shot("3-box-card");
writeFileSync(`${OUT}/card.txt`, (await p.$eval('[data-testid="part-card"]', (e) => e.textContent).catch(() => "(no card)")) ?? "");
if (!found) {
  writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
  await b.close();
  process.exit(1);
}
await p.click(`[data-testid="bet-${FN}"]`);
say(`clicked Bet on ${FN}`);
await p.waitForSelector('[data-testid="bench-stage"]', { timeout: 60000 }).catch(() => say("no machine drawn"));
await p.waitForSelector('[data-testid="file-summary"]', { timeout: 60000 }).catch(() => say("no summary shown"));
say(`after the hand-off: ${JSON.stringify(await panel())}`);
await shot("4-after-handoff");
// The tester's report: the panel stays blank. Watch it; a person who sees "Bet on what it does" presses it.
const until = Date.now() + WAIT_BET_MS;
let last = "";
let pressed = false;
while (Date.now() < until) {
  const s = await panel();
  const now = JSON.stringify(s);
  if (now !== last) say(`panel: ${now}`);
  last = now;
  if (!s.popOpen && s.toggle && !pressed) {
    pressed = true;
    await p.click('[data-testid="u1-bet-toggle"]');
    say("pressed Bet on what it does");
  }
  if (await p.$('[data-testid="u1-seal"], [data-testid="u1-tests"], [data-testid="u1-pop-idle"], [data-testid="u1-cant-run-edit"], .error-notice')) break;
  await p.waitForTimeout(2000);
}
await p.waitForTimeout(800);
const end = await panel();
say(`end: ${JSON.stringify(end)}`);
await shot("5-bet-panel");
// A second function, from a file that needs a sibling Atlas didn't load (FN2, default getWatchlistHealth in sentinel.ts,
// which imports ./lz-config.js and more): the same outline job, so no second outline call.
const FN2 = process.env.FN2;
if (FN2) {
  await p.click('[data-testid="mode-explore"]');
  await p.waitForSelector('[data-testid="explorer-stage"]');
  await p.focus('[data-testid="explorer-stage"]');
  let found2 = false;
  for (let i = 0; i < 60 && !found2; i++) {
    await p.keyboard.press("ArrowRight");
    await p.waitForTimeout(150);
    found2 = (await p.$(`[data-testid="bet-${FN2}"]`)) !== null;
  }
  say(`card offers Bet on ${FN2}: ${found2}`);
  await shot("6-import-box-card");
  if (found2) {
    await p.click(`[data-testid="bet-${FN2}"]`);
    say(`clicked Bet on ${FN2}`);
    await p.waitForSelector('[data-testid="u1-cant-run"], [data-testid="u1-bet-toggle"], [data-testid="u1-pop"]', { timeout: 60000 }).catch(() => say("nothing shown"));
    await p.waitForTimeout(3000);
    const sentence = await p.$eval('[data-testid="u1-cant-run"]', (e) => e.textContent).catch(() => null);
    say(`can't-check sentence: ${sentence}`);
    say(`panel: ${JSON.stringify(await panel())}`);
    await shot("7-import-cant-check");
  }
}
writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
await b.close();
