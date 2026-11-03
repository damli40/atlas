// R16 browser checks on the gated $0 mock (U3 mock server with the real invite gate + Vite dev): M1, M2, M3, minors 1-3, and the
// shared-code case (two browsers, one code). Usage: PW=… CHROME=… BASE=… CODE_FILE=… node r16-browser.mjs <out>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const pwm = await import(process.env.PW);
const { chromium } = pwm.default ?? pwm;
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE;
const CODE = readFileSync(process.env.CODE_FILE, "utf8").trim();
const b = await chromium.launch({ executablePath: process.env.CHROME });
const log = [];
const results = [];
const say = (s) => { log.push(s); console.log(s); };
const check = (name, ok, detail = "") => { results.push({ name, ok }); say(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`); };
const txt = (p, sel) => p.$eval(sel, (e) => e.innerText ?? e.textContent ?? "").catch(() => null);
const shot = (p, name, full = false) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} (no exception)`, false, String(e && e.message).split("\n")[0].slice(0, 220)); } };
const VIEWS = (process.env.VIEWS ?? "1280x800,1440x900,390x844").split(",").map((v) => v.split("x").map(Number));

async function page(w, h, errors) {
  const c = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  p.on("response", (r) => { if (r.status() >= 400 && !/\/paste\/(pick|captions|ask)|\/invite|\/api\/invite/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return { c, p };
}
async function enterCode(p) {
  await p.click('[data-testid="u1-own"]');
  await p.waitForTimeout(400);
  await p.fill('[data-testid="e-invite-code"]', CODE);
  await p.click('[data-testid="e-invite-go"]');
  await p.waitForSelector('[data-testid="e-samples"]', { timeout: 20000 });
}
const stageView = (p) => p.$eval('[data-testid="bench-stage"]', (e) => e.dataset.view).catch(() => null);
async function lockFirst(p) {
  await p.waitForSelector(".u1-quiz .u1-opt", { timeout: 90000 }).catch(async () => { const bt = await p.$('[data-testid="u1-bet-toggle"]'); if (bt) { await bt.click(); await p.waitForSelector(".u1-quiz .u1-opt", { timeout: 60000 }); } });
  await p.click(".u1-quiz .u1-opt >> nth=0");
  await p.waitForTimeout(200);
  await p.click('[data-testid="u1-seal"]');
  return Date.now();
}
const inView = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1; }).catch(() => false);
async function clickPart(p) {
  const m = await p.$$('svg.m-sheet .m-part[data-part]');
  if (m.length) { await m[0].click(); return "machine"; }
  const n = await p.$$('[data-testid="bench-path"] [data-node]');
  for (const el of n) { await el.click({ force: true }).catch(() => {}); await p.waitForTimeout(300); if (await p.$('[data-testid="part-panel"]')) return "path"; }
  return null;
}

for (const [w, h] of VIEWS) {
  const tag = `${w}x${h}`;
  const errors = [];
  // ---- 1. the example, no code: first screen (phone legend), then the verdict (no consent line, bar label) ----
  await step(`${tag} example`, async () => {
    const { c, p } = await page(w, h, errors);
    await p.goto(BASE);
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await p.waitForTimeout(2500);
    await shot(p, `${tag}-01-open`);
    const bar = await p.evaluate(() => document.body.innerText.split("\n").find((l) => / · 25 lines/.test(l)) ?? "");
    if (w >= 760) check(`${tag} minor 3: the bar names the example, not pasted.ts`, /the example · 25 lines/.test(bar) && !/pasted\.ts/.test(bar), bar.replace(/\n/g, " ").slice(0, 120));
    const legend = await txt(p, '[data-testid="file-summary-legend"]');
    check(`${tag} minor 2: the example's summary legend says recorded Nov 2`, /recorded Nov 2/.test(legend ?? ""), legend ?? "none");
    const view = await stageView(p);
    if (view === "machine") {
      const ml = await txt(p, '[data-testid="machine-names-legend"]');
      check(`${tag} minor 2: the machine's names legend says recorded Nov 2`, /★ names.*recorded Nov 2/.test(ml ?? ""), ml ?? "none");
    } else {
      const fold = await p.$('[data-testid="file-summary-parts"] summary');
      if (fold) await fold.click();
      await p.waitForTimeout(300);
      await shot(p, `${tag}-01b-open-fold`);
      const nl = await txt(p, '[data-testid="file-summary-names-legend"]');
      const items = await txt(p, '[data-testid="file-summary-parts"] ul');
      check(`${tag} minor 1: chart view: the ★ names legend is in the fold beside the names (recorded Nov 2)`, /★ names: Muse Wonder's words.*recorded Nov 2/.test(nl ?? "") && /★ /.test(items ?? ""), `${nl} | ${(items ?? "").slice(0, 80)}`);
      if (fold) await fold.click();
    }
    const t0 = await lockFirst(p);
    await p.waitForSelector('[data-testid="mark-list"]', { timeout: 120000 });
    await p.waitForTimeout(2500);
    say(`${tag}: example lock→marked ${Date.now() - t0} ms`);
    await shot(p, `${tag}-02-example-verdict`);
    const consent = await p.$('.u1-consent-result');
    check(`${tag} minor 3: no "Your code goes to Meta's AI" line on the example's verdict`, consent === null);
    // M1: the example's part panel after the run, one line (no code here)
    const how = await clickPart(p);
    await p.waitForSelector('[data-testid="part-panel"]', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const line = await txt(p, '[data-testid="part-ask-example"]');
    const visible = await inView(p, '[data-testid="part-ask-example"]');
    await shot(p, `${tag}-03-example-panel-after-run`);
    check(`${tag} M1: example part panel after the run (no code, via ${how}) shows "Ask works on your own files." in view`, line === "Ask works on your own files." && visible, `${line} visible=${visible}`);
    await c.close();
  });

  // ---- 2. with a code: the Cached-lookup sample; machine stays after the run; live caption label; ask after the run ----
  await step(`${tag} sample`, async () => {
    const { c, p } = await page(w, h, errors);
    await p.goto(BASE);
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await enterCode(p);
    await p.click('[data-testid="e-sample-rate-cache"]');
    await p.waitForSelector('[data-testid="bench-stage"]', { timeout: 60000 });
    await p.waitForTimeout(2500);
    const before = await stageView(p);
    await shot(p, `${tag}-04-sample-drawn`);
    await p.click('[data-testid="u1-bet-toggle"]').catch(() => {});
    const t0 = await lockFirst(p);
    let label = null;
    let captionShot = false;
    for (let i = 0; i < 40 && !captionShot; i++) {
      await p.waitForTimeout(150);
      const ai = await p.$('[data-testid="machine-act-ai"]');
      if (ai) {
        label = await txt(p, '[data-testid="machine-act-ai-label"]');
        const vis = await p.$eval('[data-testid="machine-act-ai-label"]', (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && s.visibility !== "hidden" && s.clip !== "rect(0px, 0px, 0px, 0px)"; }).catch(() => false);
        await shot(p, `${tag}-05-live-caption`);
        captionShot = true;
        check(`${tag} M2: the live caption carries a visible "★ Muse Wonder:" label`, (label ?? "").trim() === "★ Muse Wonder:" && vis, `${label} visible=${vis} | caption: ${(await txt(p, '[data-testid="machine-act-step"]'))?.replace(/\n/g, " / ").slice(0, 140)}`);
      }
    }
    if (!captionShot) say(`${tag}: no live caption seen while the run played (view ${await stageView(p)})`);
    await p.waitForSelector('[data-testid="mark-list"]', { timeout: 120000 });
    await p.waitForTimeout(2500);
    const after = await stageView(p);
    say(`${tag}: sample lock→marked ${Date.now() - t0} ms; view before ${before}, after ${after}`);
    await shot(p, `${tag}-06-sample-verdict`);
    if (w >= 760) check(`${tag} M1: a machine that fit before the run stays the machine after it`, before !== "machine" || after === "machine", `${before} → ${after}`);
    const how = await clickPart(p);
    await p.waitForSelector('[data-testid="part-panel"]', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(600);
    const input = await p.$('[data-testid="part-ask-input"]');
    check(`${tag} M1: after the run a part opens its panel (via ${how}) with the ask box`, input !== null, `panel=${!!(await p.$('[data-testid="part-panel"]'))}`);
    if (input) {
      await input.fill("What does this part wait for?");
      await p.click('[data-testid="part-ask-go"]');
      await p.waitForSelector('[data-testid="part-ask-answer"], [data-testid="part-ask-note"]', { timeout: 30000 });
      await p.waitForTimeout(400);
      await shot(p, `${tag}-07-ask-after-run`);
      const ans = await txt(p, '[data-testid="part-ask-answer"]');
      check(`${tag} M1: the answer comes back, labelled`, /★ Muse Wonder/.test(ans ?? ""), (ans ?? (await txt(p, '[data-testid="part-ask-note"]')) ?? "").slice(0, 140));
    }
    // ---- 3. Moonwell ----
    await p.keyboard.press("Escape");
    const moon = await p.$("text=Demos: Moonwell");
    if (moon) {
      await moon.click();
      await p.waitForTimeout(4000);
      const rest = await p.evaluate(() => {
        const sheet = document.querySelector('[data-testid="moonwell-sheet"]');
        const foot = document.querySelector(".u1-foot").getBoundingClientRect();
        const el = [...sheet.querySelectorAll("p")].find((e) => /Moonwell took/.test(e.textContent));
        if (!el) return { bottom: 0, footTop: 0, none: true };
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, footTop: foot.top };
      });
      await shot(p, `${tag}-08a-moonwell-rest`);
      if (w >= 760) check(`${tag} M3: Moonwell's approved sentence ends above the foot links without scrolling`, rest.bottom <= rest.footTop, JSON.stringify(rest));
      const m = await p.evaluate(() => {
        const sheet = document.querySelector('[data-testid="moonwell-sheet"]');
        sheet.scrollTop = sheet.scrollHeight;
        const foot = document.querySelector(".u1-foot")?.getBoundingClientRect();
        // the last line of text in the sheet
        const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
        let last = null;
        while (walker.nextNode()) { const n = walker.currentNode; if (n.textContent.trim() && n.parentElement && n.parentElement.offsetParent !== null && !n.parentElement.closest("svg")) last = n; }
        const r = document.createRange();
        r.selectNodeContents(last);
        const rects = [...r.getClientRects()];
        const lb = rects.at(-1);
        return { scrollH: sheet.scrollHeight, clientH: sheet.clientHeight, overflowY: getComputedStyle(sheet).overflowY, footTop: foot ? foot.top : null, footLeft: foot ? foot.left : null, lastText: last.textContent.trim().slice(-60), lastBottom: lb ? lb.bottom : null, lastRight: lb ? lb.right : null };
      });
      await p.waitForTimeout(300);
      await shot(p, `${tag}-08-moonwell-scrolled`);
      const clear = m.footTop === null || m.lastBottom === null || m.lastBottom <= m.footTop || (m.lastRight !== null && m.footLeft !== null && m.lastRight <= m.footLeft);
      check(`${tag} M3: the sheet's last line clears the foot links once scrolled`, clear, JSON.stringify(m));
    } else say(`${tag}: no Moonwell link`);
    await c.close();
  });
  writeFileSync(`${OUT}/${tag}-errors.txt`, errors.join("\n"));
  check(`${tag}: no console or network errors`, errors.length === 0, errors.slice(0, 3).join(" ; "));
}

// ---- 4. the shared code: two browsers, one code ----
await step("shared code", async () => {
  const errors = [];
  const A = await page(1280, 800, errors);
  const B = await page(1280, 800, errors);
  for (const x of [A, B]) {
    await x.p.goto(BASE);
    await x.p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await enterCode(x.p);
    await x.p.click('[data-testid="e-sample-rate-cache"]');
    await x.p.waitForSelector('[data-testid="bench-stage"]', { timeout: 60000 });
    await x.p.waitForTimeout(1500);
    await x.p.click('[data-testid="u1-bet-toggle"]').catch(() => {});
    await x.p.waitForSelector(".u1-quiz .u1-opt", { timeout: 90000 });
  }
  const ids = await Promise.all([A, B].map((x) => x.p.evaluate(() => localStorage.getItem("atlas-browser-id"))));
  say(`shared: browser ids differ: ${ids[0] !== ids[1]} (${ids.map((i) => (i ?? "").slice(0, 6)).join(" / ")})`);
  // A locks and plays; after the run A asks about a part.
  await A.p.click(".u1-quiz .u1-opt >> nth=0");
  await A.p.click('[data-testid="u1-seal"]');
  await A.p.waitForSelector('[data-testid="mark-list"]', { timeout: 120000 });
  await A.p.waitForTimeout(1500);
  await clickPart(A.p);
  await A.p.waitForSelector('[data-testid="part-ask-input"]', { timeout: 10000 });
  await A.p.fill('[data-testid="part-ask-input"]', "What does this part wait for?");
  await A.p.click('[data-testid="part-ask-go"]');
  await A.p.waitForSelector('[data-testid="part-ask-answer"]', { timeout: 30000 });
  // B, whose round was written before A asked, locks now.
  const refused = [];
  B.p.on("response", async (r) => { if (/\/bets$/.test(r.url()) && r.status() === 409) refused.push(await r.text().catch(() => "")); });
  await B.p.click(".u1-quiz .u1-opt >> nth=0");
  await B.p.click('[data-testid="u1-seal"]');
  await B.p.waitForSelector('[data-testid="mark-list"]', { timeout: 120000 }).catch(() => {});
  await B.p.waitForTimeout(1000);
  await shot(B.p, "shared-B-verdict");
  const marked = !!(await B.p.$('[data-testid="mark-list"]'));
  check("shared code: judge B's lock is not refused after judge A asked, and B's run reaches a verdict", refused.length === 0 && marked, refused.join(" ; ").slice(0, 200));
  await shot(A.p, "shared-A-ask");
  check("shared code: no console or network errors", errors.length === 0, errors.slice(0, 3).join(" ; "));
  await A.c.close();
  await B.c.close();
});

await b.close();
const failed = results.filter((r) => !r.ok).length;
say(`${results.length - failed} of ${results.length} checks passed`);
writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
