// R8 review MAJOR-1 repro on the real page: a retry loop with withTimeout(fetchIt(), 1000) and sleep(100 * 2 ** i), fetchIt never
// answers. The test the round uses is set to that one by rewriting the page's own proposals answer and POST /api/experiments body (the
// mock investigator has no case for this file); the run itself is the real sandbox. Records every caption and every "N ms" label beside a dial during the act, and frames of the 1,000 ms gaps.
//   PW=<playwright-core> CHROME=<headless shell> BASE=<page> node tests/evidence/R8/repro-timeout.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const fx = JSON.parse(readFileSync(new URL("../../unit/fixtures/r8-review/retry-timeout-backoff.json", import.meta.url), "utf8"));
const b = await chromium.launch({ executablePath: process.env.CHROME });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await c.newPage();
await p.route("**/api/experiments", async (route) => {
  const body = JSON.parse(route.request().postData() ?? "{}");
  delete body.proposalId;
  await route.continue({ postData: JSON.stringify({ ...body, params: fx.params }) });
});
// The page asks Muse Wonder's mock for tests; it has none for this file, so its answer is replaced by one proposal with this test.
await p.route("**/api/paste/proposals", async (route) => {
  const r = await route.fetch();
  const body = await r.json();
  await route.fulfill({ response: r, json: { ...body, ok: true, proposals: [{ id: "r8review1", attempt: 1, params: fx.params, gate: { allowed: true }, says: "fetchIt never answers." }] } });
});
await p.goto(process.env.BASE);
await p.waitForSelector('[data-testid="u1-own"], [data-testid="u1-code"]');
if (!(await p.$('[data-testid="u1-code"]'))) await p.click('[data-testid="u1-own"]');
await p.fill('[data-testid="u1-code"]', fx.source);
await p.click('[data-testid="u1-draw"]');
await p.waitForSelector('[data-testid="bench-stage"]');
await p.waitForTimeout(400);
await p.click('[data-testid="u1-bet-toggle"]');
p.on("response", async (r) => { if (/\/api\/experiments$/.test(r.url())) console.log("experiments", r.status(), (await r.text().catch(() => "")).slice(0, 200)); });
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 20000 }).catch(async (e) => { await p.screenshot({ path: `${OUT}/stuck.png` }); throw e; });
await p.waitForTimeout(400);
const n = (await p.$$(".u1-quiz > li")).length;
for (let i = 0; i < n; i++) {
  await p.keyboard.press("1");
  await p.waitForTimeout(210);
}
await p.evaluate(() => {
  window.__log = [];
  const tick = () => {
    const s = document.querySelector('[data-testid="machine-act-step"]')?.textContent ?? "";
    const labels = [...document.querySelectorAll('[data-testid="machine"] .m-act-ms')].map((l) => l.textContent).join(",");
    const needle = [...document.querySelectorAll('[data-testid="machine"] .m-needle')].map((n) => `${n.dataset.dial}:${n.getAnimations().length}`).join(",");
    const key = `${s}|${labels}|${needle}`;
    if (s && window.__log[window.__log.length - 1]?.key !== key) window.__log.push({ key, caption: s, labels, needleMoving: needle });
    if (document.querySelector('[data-testid="bench-stage"]')?.dataset.phase !== "marked") requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await p.click('[data-testid="u1-seal"]');
let k = 0;
for (let i = 0; i < 80; i++) {
  const s = await p.$eval('[data-testid="machine-act-step"]', (e) => e.textContent).catch(() => "");
  if (/1,000 ms pass/.test(s ?? "") && k < 2) {
    await p.screenshot({ path: `${OUT}/timeout-gap-${++k}.png` });
    await p.waitForTimeout(500);
  }
  if (/waits 100 ms/.test(s ?? "") && !(await p.$(`#done-100`))) {
    await p.screenshot({ path: `${OUT}/sleep-100.png` });
    await p.evaluate(() => { const d = document.createElement("i"); d.id = "done-100"; d.hidden = true; document.body.append(d); });
  }
  if ((await p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.phase)) === "marked") break;
  await p.waitForTimeout(60);
}
const log = await p.evaluate(() => window.__log.map(({ key, ...r }) => r));
writeFileSync(`${OUT}/timeout-log.json`, JSON.stringify(log, null, 1));
const wrong = log.filter((r) => /1,000 ms/.test(r.caption) && (r.labels !== "" || /:1/.test(r.needleMoving)));
const any1000 = log.some((r) => /1,000/.test(r.labels));
console.log(`${wrong.length === 0 && !any1000 ? "pass" : "FAIL"} no dial moves and no "1,000 ms" label during the timeouts (${log.length} states, labels seen: ${[...new Set(log.map((r) => r.labels).filter(Boolean))].join(" ")})`);
console.log(log.map((r) => r.caption + (r.labels ? ` [${r.labels}]` : "")).filter((x, i, a) => i === 0 || a[i - 1] !== x).join(" / "));
await b.close();
