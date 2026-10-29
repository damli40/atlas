// U2 browser click-through of the drawing-first screen with the cold walkthrough's two files (inputs/code1.ts,
// inputs/code2.py), against the RUNNING app (tests/evidence/U2/mock-server.ts + Vite: every model mocked, $0; or with
// U2_LIVE=1 a server with real models). Runs in headless Chromium, and with HEADED=1 in a headed (windowed) Chromium too,
// recording a video of each headed round.
//
// For each file: a real paste keystroke → the drawing → "Bet on your understanding" → the plain-code rule's default test
// → tap the first option of every question BY ITS ACCESSIBLE NAME (checks no invisible layer covers the answers) →
// "Seal my answers" → the run plays (timed: it must take at least 4 s and visibly change lamps, lit parts and the dial)
// → every question marked, with a headline → "Play the run again" (must play again, visibly) → "Proof card" (must open
// a panel that shows the card).
// Checks on every state: axe-core (WCAG 2 A/AA + best practice), the D07-04 text-overlap check (HTML text) and an
// HTML-over-drawing-text check (pins and chips must not cover the drawing's engraved labels), the before-bet rule, 390 px
// (no page scroll), reduced motion. Exits 1 on a failure.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> [HEADED=1 HEADED_EXE=<chrome>] \
//          node tests/evidence/U2/drive.mjs <chromium headless shell> <out dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:18852/";
const LIVE = process.env.U2_LIVE === "1";
const ONLY = process.env.U2_ONLY ?? "all";
const T = LIVE ? 600_000 : 120_000;
const FILES = [
  { key: "ts", lang: "ts", code: readFileSync(new URL("./inputs/code1.ts", import.meta.url), "utf8") },
  { key: "py", lang: "py", code: readFileSync(new URL("./inputs/code2.py", import.meta.url), "utf8") },
];
const out = [];
const failures = [];
const say = (...a) => {
  const line = a.join(" ");
  out.push(line);
  console.log(line);
};
const check = (ok, what) => {
  say(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const results = { rounds: {}, errors: [] };

async function newPage(browser, { width = 1920, height = 1080, theme = "light", reduced = false, video = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme, ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 720 } } } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && results.errors.push(`console: ${m.text()}`));
  return page;
}

async function axe(page, name) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return { violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })), passes: res.passes.length };
  });
  check(r.violations.length === 0, `axe ${name}: ${r.violations.length} violations ${r.violations.map((v) => `${v.id}/${v.impact}×${v.nodes} [${v.targets.join(" | ")}]`).join(", ")} (${r.passes} rules passed)`);
}

async function overflow(page, name) {
  const r = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(r.scrollWidth <= r.clientWidth, `390px ${name}: scrollWidth ${r.scrollWidth} vs ${r.clientWidth}`);
}

/** D07-04: inside `root`, no two visible HTML text boxes of different elements overlap, and no text sticks out. */
async function overlap(page, name, root) {
  const r = await page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return { error: `no ${sel}` };
    const cb = card.getBoundingClientRect();
    const clipOf = (el) => {
      let box = null;
      for (let a = el; a && a !== card; a = a.parentElement) {
        const st = getComputedStyle(a);
        if (/(auto|scroll|hidden)/.test(st.overflowX + st.overflowY)) {
          const b = a.getBoundingClientRect();
          box = box ? { left: Math.max(box.left, b.left), right: Math.min(box.right, b.right), top: Math.max(box.top, b.top), bottom: Math.min(box.bottom, b.bottom) } : { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        }
      }
      return box;
    };
    const items = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest("svg")) continue;
      if (el.closest("details:not([open])") && !el.closest("summary")) continue;
      const st = getComputedStyle(el);
      if (st.visibility === "hidden" || st.display === "none") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const clip = clipOf(el);
      for (const q of range.getClientRects()) {
        let b = { left: q.left, right: q.right, top: q.top, bottom: q.bottom };
        if (clip) b = { left: Math.max(b.left, clip.left), right: Math.min(b.right, clip.right), top: Math.max(b.top, clip.top), bottom: Math.min(b.bottom, clip.bottom) };
        if (b.right - b.left < 1 || b.bottom - b.top < 1) continue;
        items.push({ el, b, text: n.textContent.trim().slice(0, 40) });
      }
    }
    const hits = [];
    const outside = [];
    for (const it of items) if (it.b.left < cb.left - 1 || it.b.right > cb.right + 1) outside.push(it.text);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], c = items[j];
        if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (w > 1 && h > 1) hits.push(`"${a.text}" × "${c.text}"`);
      }
    return { textBoxes: items.length, overlaps: hits.slice(0, 10), overlapCount: hits.length, outside: outside.slice(0, 10), outsideCount: outside.length };
  }, root);
  check(!r.error && r.overlapCount === 0 && r.outsideCount === 0, `overlap ${name}: ${r.error ?? `${r.textBoxes} text boxes, ${r.overlapCount} overlapping pairs${r.overlaps.length ? ` (${r.overlaps.join("; ")})` : ""}, ${r.outsideCount} outside${r.outside.length ? ` (${r.outside.join("; ")})` : ""}`}`);
}

/** U2: pins and chips (HTML over the drawing) must not cover the drawing's engraved text (box names, deck plates). */
async function overDrawing(page, name) {
  const r = await page.evaluate(() => {
    const st = document.querySelector('[data-testid="bench-stage"]');
    const labels = [...st.querySelectorAll(".u1-svg svg text")].map((t) => ({ b: t.getBoundingClientRect(), text: t.textContent.trim() })).filter((x) => x.text && x.b.width > 1);
    const html = [...st.querySelectorAll(".u1-pin, .u1-chip")].filter((e) => getComputedStyle(e).display !== "none").map((e) => ({ b: e.getBoundingClientRect(), text: e.textContent.trim().slice(0, 40) }));
    const hits = [];
    for (const h of html)
      for (const l of labels) {
        const w = Math.min(h.b.right, l.b.right) - Math.max(h.b.left, l.b.left);
        const v = Math.min(h.b.bottom, l.b.bottom) - Math.max(h.b.top, l.b.top);
        if (w > 2 && v > 2) hits.push(`"${h.text}" over "${l.text}"`);
      }
    return { labels: labels.length, html: html.length, hits };
  });
  check(r.hits.length === 0, `over the drawing ${name}: ${r.html} pins/chips vs ${r.labels} engraved labels, ${r.hits.length} covering${r.hits.length ? ` (${r.hits.slice(0, 6).join("; ")})` : ""}`);
}

/** Before the bets are sealed, nothing on the stage may carry a run result. */
async function beforeBet(page, name) {
  const r = await page.evaluate(() => {
    const st = document.querySelector('[data-testid="bench-stage"]');
    return { phase: st.getAttribute("data-phase"), runEls: st.querySelectorAll("[data-run]").length, litLamps: st.querySelectorAll("[data-lamp][data-on]").length, liveParts: st.querySelectorAll(".u1-live").length, marks: st.querySelectorAll(".u1-pin, [data-testid=mark-list]").length };
  });
  check(r.phase === "rest" && r.runEls === 0 && r.litLamps === 0 && r.liveParts === 0 && r.marks === 0, `before-bet rule ${name}: ${JSON.stringify(r)}`);
}

/** U2: no layer covers an answer: the element at the centre of every answer button is that button (or inside it). */
async function answersReachable(page, name) {
  const r = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('.u1-opt[role="radio"]')) {
      b.scrollIntoView({ block: "center" });
      const q = b.getBoundingClientRect();
      const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (!at || !(at === b || b.contains(at))) out.push(`${b.textContent.trim().slice(0, 30)} → covered by ${at ? `${at.tagName.toLowerCase()}.${[...at.classList].join(".")}` : "nothing"}`);
    }
    return { buttons: document.querySelectorAll('.u1-opt[role="radio"]').length, covered: out };
  });
  check(r.covered.length === 0 && r.buttons > 0, `answers reachable ${name}: ${r.buttons} answer buttons, ${r.covered.length} covered${r.covered.length ? ` (${r.covered.join("; ")})` : ""}`);
}

const pasteKey = async (page, text) => {
  await page.locator('[data-testid="u1-code"]').focus();
  await page.evaluate((t) => {
    const ta = document.querySelector('[data-testid="u1-code"]');
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
};

/** Samples the stage while the run plays: how long it plays and what visibly changes. */
async function watchPlay(page, name, shotPrefix) {
  await page.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: T });
  const t0 = Date.now();
  const seen = { lamps: 0, parts: 0, needles: new Set(), chips: new Set(), frames: 0 };
  let shots = 0;
  for (;;) {
    const s = await page.evaluate(() => {
      const st = document.querySelector('[data-testid="bench-stage"]');
      return { phase: st.getAttribute("data-phase"), lamps: st.querySelectorAll("[data-lamp][data-on]").length, parts: st.querySelectorAll(".u1-live").length, needle: st.querySelector("[data-needle] path")?.getAttribute("d") ?? "", chips: [...st.querySelectorAll(".u1-chip[data-run]")].map((c) => c.textContent).join(" | ") };
    });
    if (s.phase !== "playing") break;
    seen.frames++;
    seen.lamps = Math.max(seen.lamps, s.lamps);
    seen.parts = Math.max(seen.parts, s.parts);
    seen.needles.add(s.needle);
    if (s.chips) seen.chips.add(s.chips);
    const el = Date.now() - t0;
    if (shotPrefix && shots < 4 && el > [600, 2000, 3500, 5000][shots]) await page.screenshot({ path: `${outDir}/${shotPrefix}-play-${[600, 2000, 3500, 5000][shots++]}ms.png` });
    if (el > 60_000) break;
    await page.waitForTimeout(120);
  }
  const ms = Date.now() - t0;
  const r = { ms, frames: seen.frames, maxLampsLit: seen.lamps, maxPartsLit: seen.parts, needlePositions: seen.needles.size, chipStates: seen.chips.size };
  check(ms >= 4000 && r.needlePositions >= 3 && r.chipStates >= 2 && (r.maxLampsLit > 0 || r.maxPartsLit > 0), `the run plays visibly ${name}: ${JSON.stringify(r)}`);
  return r;
}

async function round(browser, file, theme, { headed = false } = {}) {
  const name = `${file.key} ${theme}${headed ? " headed" : ""}`;
  const pre = `${headed ? "headed" : "film"}-${file.key}-${theme}`;
  const page = await newPage(browser, { theme, ...(headed ? { video: `${outDir}/video-${file.key}` } : {}) });
  const R = (results.rounds[name] = {});
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteKey(page, file.code);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(800);
  await beforeBet(page, `rest ${name}`);
  await page.screenshot({ path: `${outDir}/${pre}-1-rest.png` });
  if (!headed) {
    await axe(page, `rest ${name}`);
    await overlap(page, `rest ${name}`, '[data-testid="bench-stage"]');
  }
  // the hover card before any test exists
  const fnBox = await page.locator(`[data-hit="${file.key === "ts" ? "fetchWithRetry" : "run_all"}"]`).first().boundingBox();
  if (fnBox) {
    await page.mouse.move(fnBox.x + fnBox.width / 2, fnBox.y + fnBox.height / 2);
    await page.waitForTimeout(300);
    R.cardBeforeTest = await page.locator('[data-testid="part-card"]').innerText().catch(() => "");
    check(!/the function the test calls/.test(R.cardBeforeTest) && (file.key !== "py" || !/exported/.test(R.cardBeforeTest)), `hover card before a test ${name}: ${R.cardBeforeTest.replace(/\n/g, " / ")}`);
    await page.screenshot({ path: `${outDir}/${pre}-2-hover.png` });
    await page.mouse.move(5, 500);
  }
  await page.getByRole("button", { name: "Bet on your understanding" }).click();
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.waitForTimeout(900);
  await beforeBet(page, `bet open ${name}`);
  R.test = await page.textContent('[data-testid="u1-test"]');
  R.explain = await page.textContent('[data-testid="u1-explain"]');
  R.models = await page.textContent('[data-testid="u1-models"]');
  say(`test (${name}): ${R.test}`);
  await answersReachable(page, name);
  const groups = page.locator(".u1-opts");
  const n = await groups.count();
  R.picked = [];
  for (let i = 0; i < n; i++) {
    const label = (await groups.nth(i).getByRole("radio").first().innerText()).trim();
    await groups.nth(i).getByRole("radio", { name: label, exact: true }).click({ timeout: 5000 });
    R.picked.push(label);
  }
  const order = await page.evaluate(() => {
    const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1;
    return { models: y('[data-testid="u1-models"]'), seal: y('[data-testid="u1-seal"]'), seen: y(".u1-seen") };
  });
  check(order.models >= 0 && order.models < order.seal && order.seal < order.seen, `the AIs line and who-bets picker sit above "Seal my answers" ${name}: ${JSON.stringify(order)}`);
  await page.locator(".u1-seen summary").click();
  const wrap = await page.evaluate(() => {
    const p = document.querySelector(".u1-seen pre");
    return { scrollWidth: p.scrollWidth, clientWidth: p.clientWidth, ws: getComputedStyle(p).whiteSpace };
  });
  check(wrap.scrollWidth <= wrap.clientWidth + 1, `"What every bettor sees" wraps ${name}: ${JSON.stringify(wrap)}`);
  await page.locator(".u1-pop").evaluate((el) => (el.scrollTop = 0));
  await page.screenshot({ path: `${outDir}/${pre}-3-bet.png` });
  if (!headed) {
    await axe(page, `bet open ${name}`);
    await overlap(page, `bet open ${name}`, '[data-testid="u1-pop"]');
  }
  await page.locator(".u1-seen summary").click();
  await page.getByRole("button", { name: "Seal my answers" }).click();
  R.play = await watchPlay(page, name, pre);
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/${pre}-5-marked.png` });
  R.headline = await page.textContent('[data-testid="u1-headline"]');
  check(/^(You matched \d+ of \d+ checkable answers?( \(\d+ left as “can't tell”\))?\.|None of your answers could be checked\.|You answered “can't tell” to every question\.)/.test(R.headline), `headline ${name}: ${R.headline}`);
  R.marks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="mark-"]')].filter((e) => e.getAttribute("data-testid") !== "mark-list").map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  say(`marks (${name}): ${R.marks.join(" | ")}`);
  if (!headed) {
    await axe(page, `marked ${name}`);
    await overlap(page, `marked stage ${name}`, '[data-testid="bench-stage"]');
    await overlap(page, `marked list ${name}`, '[data-testid="mark-list"]');
    await overDrawing(page, `marked ${name}`);
  }
  // play again: it must play visibly again
  await page.getByRole("button", { name: "Play the run again" }).click();
  R.replay = await watchPlay(page, `again ${name}`, null);
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  // proof card: a panel opens in place
  await page.getByRole("button", { name: "Proof card" }).click();
  await page.waitForSelector('[data-testid="u1-proof-panel"] .proof, [data-testid="u1-proof-panel"] h1', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(800);
  const proof = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="u1-proof-panel"]');
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), text: p.innerText.slice(0, 120).replace(/\n/g, " / ") };
  });
  check(Boolean(proof && proof.w > 300 && proof.h > 300 && /PROOF CARD/i.test(proof.text)), `proof card opens visibly ${name}: ${JSON.stringify(proof)}`);
  await page.screenshot({ path: `${outDir}/${pre}-6-proof.png` });
  if (!headed) await axe(page, `proof panel ${name}`);
  await page.getByRole("button", { name: "Close the proof card" }).click();
  R.testClaim = await page.locator('[data-testid="u1-test-claim"]').count();
  check(R.testClaim === 1, `"Test this claim" offered after the run ${name}`);
  const video = page.video();
  await page.context().close();
  if (video) R.video = (await video.path()).split("/").pop();
}

async function phone(browser, theme) {
  const page = await newPage(browser, { width: 390, height: 844, theme });
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await overflow(page, `entry ${theme}`);
  await pasteKey(page, FILES[0].code);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(600);
  await overflow(page, `rest ${theme}`);
  await page.getByRole("button", { name: "Bet on your understanding" }).click();
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.waitForTimeout(700);
  await overflow(page, `bet open ${theme}`);
  await overlap(page, `bet open 390 ${theme}`, '[data-testid="u1-pop"]');
  await page.screenshot({ path: `${outDir}/phone-bet-390-${theme}.png` });
  await page.getByRole("button", { name: "Seal my answers" }).click();
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  await page.waitForTimeout(500);
  await overflow(page, `marked ${theme}`);
  await overlap(page, `marked 390 ${theme}`, '[data-testid="mark-list"]');
  await page.screenshot({ path: `${outDir}/phone-marked-390-${theme}.png` });
  await page.context().close();
}

async function reduced(browser) {
  const page = await newPage(browser, { reduced: true });
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteKey(page, FILES[0].code);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.getByRole("button", { name: "Bet on your understanding" }).click();
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.evaluate(() => {
    window.__lit = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.target.hasAttribute?.("data-on")) window.__lit++; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-on"] });
  });
  await page.getByRole("button", { name: "Seal my answers" }).click();
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  const lit = await page.evaluate(() => window.__lit);
  check(lit === 0, `reduced motion: the end state shows at once, no lamp ever lit (${lit})`);
  await page.context().close();
}

const browser = await chromium.launch({ executablePath: exe });
try {
  const files = ONLY === "ts" ? [FILES[0]] : ONLY === "py" ? [FILES[1]] : FILES;
  for (const f of files) for (const theme of LIVE ? ["light"] : ["light", "dark"]) await round(browser, f, theme);
  if (!LIVE && ONLY === "all") {
    for (const theme of ["light", "dark"]) await phone(browser, theme);
    await reduced(browser);
  }
} catch (e) {
  check(false, `the headless click-through stopped: ${e.message.split("\n")[0]}`);
}
await browser.close();
if (process.env.HEADED === "1") {
  try {
    const headedBrowser = await chromium.launch({ headless: false, executablePath: process.env.HEADED_EXE });
    for (const f of FILES) await round(headedBrowser, f, "light", { headed: true });
    await headedBrowser.close();
  } catch (e) {
    check(false, `the headed click-through stopped: ${e.message.split("\n")[0]}`);
  }
}
check(results.errors.length === 0, `page errors: ${results.errors.length}${results.errors.length ? ` (${results.errors.slice(0, 3).join(" | ")})` : ""}`);
say(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECKS FAILED`);
writeFileSync(`${outDir}/checks${LIVE ? "-live" : ""}.json`, JSON.stringify(results, null, 2));
writeFileSync(`${outDir}/browser-output${LIVE ? "-live" : ""}.txt`, out.join("\n") + "\n");
process.exit(failures.length === 0 ? 0 : 1);
