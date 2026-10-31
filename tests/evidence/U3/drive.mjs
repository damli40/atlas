// U3 click-through: the walkthrough's two kinds of file (reconstructed: tests/evidence/U3/inputs), every U3 fix checked in
// a real browser against the real server with mocked models (mock-server.ts, $0).
//
// Checks, by item:
// 1 the drawing's cables are exactly the code's (DOM data-line ids); a mouse click pins a part's card; the card lists
//   self-calls and calls to fakes; the replay lights the call path (fetchAllOrders, then fetchPage, then fetch)
// 2 the default test hits an edge (TS: the 429 that reaches the retry limit; Python: two calls on the cache)
// 3 Python values read as Python in the test list (get_user_plan(True), never (true))
// 4 questions before the folded "How Atlas runs it"; every answer button visible without scrolling at 1920x1080 and
//   1366x768; plain words (no AtlasStandInExhausted); a typed value is sealed and judged
// 5 "Test this claim": the sentence is shown while the test is written; afterwards the sentence sits beside the facts
//   under "you decide"; the button is not offered again
// 6 Wonder's wait: elapsed seconds and the step on screen at once; "Write my own test instead" works before Wonder
//   answers, and Wonder's answer does not replace it
// 7 replay label; labels clear cables and boxes (an independent geometric check); no 404; plain screen-reader text;
//   proof card plain words first, details folded; code font in the paste box; "bet" on the landing page
// Plus: axe (WCAG 2 A/AA + best practice) 0, HTML text overlap 0, 390 px no page scroll, reduced motion.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> node tests/evidence/U3/drive.mjs <chromium> <outDir>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const [exe, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:18952/";
const T = 120_000;
const FILES = [
  { key: "ts", lang: "ts", fn: "fetchAllOrders", code: readFileSync(new URL("./inputs/orders.ts", import.meta.url), "utf8"), cables: ["fetchAllOrders->fetchPage", "fetchPage=>stand-in fetch"] },
  { key: "py", lang: "py", fn: "get_user_plan", code: readFileSync(new URL("./inputs/plan_cache.py", import.meta.url), "utf8"), cables: ["get_user_plan->cached"] },
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
const results = { rounds: {}, errors: [], bad: [] };

async function newPage(browser, { width = 1920, height = 1080, theme = "light", reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && results.errors.push(`console: ${m.text()}`));
  // 404 and other failed responses (a 401/409 the page expects is listed too, so the reader can see them all).
  page.on("response", (r) => r.status() >= 400 && results.bad.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`));
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
        // a sticky bar may scroll over text below it; that text is not visible, so it is not an overlap
        if (a.el.closest(".u1-sealbar") !== c.el.closest(".u1-sealbar")) continue;
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (w > 1 && h > 1) hits.push(`"${a.text}" × "${c.text}"`);
      }
    return { textBoxes: items.length, overlaps: hits.slice(0, 10), overlapCount: hits.length, outside: outside.slice(0, 10), outsideCount: outside.length };
  }, root);
  check(!r.error && r.overlapCount === 0 && r.outsideCount === 0, `overlap ${name}: ${r.error ?? `${r.textBoxes} text boxes, ${r.overlapCount} overlapping pairs${r.overlaps.length ? ` (${r.overlaps.join("; ")})` : ""}, ${r.outsideCount} outside${r.outside.length ? ` (${r.outside.join("; ")})` : ""}`}`);
}

/**
 * U3 item 7, checked independently of the page's own placement code: no result label (run chip, pinned answers, failure
 * label) touches a cable (points every 2 px along every cable path), a box (its hit outline, tested on a 4 px grid), the
 * drawing's engraved text, or another label.
 */
async function labelsClear(page, name) {
  const r = await page.evaluate(() => {
    const st = document.querySelector('[data-testid="bench-stage"]');
    const svg = st.querySelector(".u1-svg svg");
    const pts = [];
    for (const p of svg.querySelectorAll("[data-line] path, path[data-line]")) {
      const len = p.getTotalLength();
      const m = p.getScreenCTM();
      for (let d = 0; d <= len; d += 2) {
        const q = p.getPointAtLength(d);
        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
        pts.push([s.x, s.y, p.closest("[data-line]")?.getAttribute("data-line")]);
      }
    }
    const hits = [...svg.querySelectorAll("[data-hit]")].map((h) => ({ h, inv: h.getScreenCTM().inverse(), id: h.getAttribute("data-hit") }));
    const texts = [...svg.querySelectorAll("text")].map((t) => ({ b: t.getBoundingClientRect(), t: t.textContent.trim() })).filter((x) => x.b.width > 1);
    const labels = [...st.querySelectorAll(".u1-chip[data-run], .u1-pin, .u1-chip-label")].filter((e) => getComputedStyle(e).display !== "none" && e.offsetParent !== null).map((e) => ({ b: e.getBoundingClientRect(), t: e.textContent.trim().slice(0, 36) }));
    const problems = [];
    labels.forEach((l, i) => {
      const r = l.b;
      const p = pts.find(([x, y]) => x > r.left && x < r.right && y > r.top && y < r.bottom);
      if (p) problems.push(`"${l.t}" on cable ${p[2]}`);
      outer: for (let y = r.top + 1; y < r.bottom; y += 4)
        for (let x = r.left + 1; x < r.right; x += 4)
          for (const { h, inv, id } of hits)
            if (h.isPointInFill(new DOMPoint(x, y).matrixTransform(inv))) {
              problems.push(`"${l.t}" on box ${id}`);
              break outer;
            }
      for (const t of texts) if (Math.min(r.right, t.b.right) - Math.max(r.left, t.b.left) > 1 && Math.min(r.bottom, t.b.bottom) - Math.max(r.top, t.b.top) > 1) problems.push(`"${l.t}" on text "${t.t}"`);
      for (const o of labels.slice(i + 1)) if (Math.min(r.right, o.b.right) - Math.max(r.left, o.b.left) > 1 && Math.min(r.bottom, o.b.bottom) - Math.max(r.top, o.b.top) > 1 && !st.querySelector(".u1-pins")?.contains(document.elementFromPoint(r.left + 2, r.top + 2))) problems.push(`"${l.t}" on "${o.t}"`);
    });
    return { labels: labels.length, cablePoints: pts.length, boxes: hits.length, problems, stuck: st.getAttribute("data-labels-stuck") };
  });
  check(r.problems.length === 0, `labels clear of cables, boxes and text ${name}: ${r.labels} labels, ${r.cablePoints} cable points, ${r.boxes} boxes, ${r.problems.length} touching${r.problems.length ? ` (${r.problems.slice(0, 6).join("; ")})` : ""}; no free spot for ${r.stuck ?? "?"}`);
}

/** Before the bets are sealed, nothing on the stage may carry a run result. */
async function beforeBet(page, name) {
  const r = await page.evaluate(() => {
    const st = document.querySelector('[data-testid="bench-stage"]');
    return { phase: st.getAttribute("data-phase"), runEls: st.querySelectorAll("[data-run]").length, litLamps: st.querySelectorAll("[data-lamp][data-on]").length, liveParts: st.querySelectorAll(".u1-live").length, marks: st.querySelectorAll(".u1-pin, [data-testid=mark-list]").length };
  });
  check(r.phase === "rest" && r.runEls === 0 && r.litLamps === 0 && r.liveParts === 0 && r.marks === 0, `before-bet rule ${name}: ${JSON.stringify(r)}`);
}

/** U3 item 4: every answer (each option and the typed field) is inside the pop-up's visible area, above the seal bar. */
async function answersFit(page, name) {
  const r = await page.evaluate(() => {
    const pop = document.querySelector(".u1-pop");
    pop.scrollTop = 0;
    const pb = pop.getBoundingClientRect();
    const bar = document.querySelector(".u1-sealbar")?.getBoundingClientRect();
    const limit = Math.min(window.innerHeight, bar ? bar.top : pb.bottom);
    const items = [...pop.querySelectorAll('.u1-opt[role="radio"], .u1-typed-in')];
    const hidden = items.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.bottom > limit + 0.5 || b.top < pb.top - 0.5;
    });
    const covered = items.filter((b) => {
      const q = b.getBoundingClientRect();
      const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return !at || !(at === b || b.contains(at));
    });
    return { answers: items.length, hidden: hidden.map((e) => (e.textContent || e.id).trim().slice(0, 30)), covered: covered.map((e) => (e.textContent || e.id).trim().slice(0, 30)), popTop: Math.round(pb.top), sealBarTop: bar ? Math.round(bar.top) : null, viewport: `${window.innerWidth}x${window.innerHeight}` };
  });
  check(r.answers > 0 && r.hidden.length === 0 && r.covered.length === 0, `every answer visible without scrolling ${name}: ${JSON.stringify(r)}`);
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

/** Samples the stage while the run plays: how long, what visibly changes, which parts and cables light together. */
async function watchPlay(page, name, shotPrefix) {
  await page.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: T });
  const t0 = Date.now();
  const seen = { lamps: 0, parts: 0, needles: new Set(), chips: new Set(), frames: 0, litSets: new Set(), replayLabel: new Set(), firstChipAt: null };
  let shots = 0;
  for (;;) {
    const s = await page.evaluate(() => {
      const st = document.querySelector('[data-testid="bench-stage"]');
      const lit = [...new Set([...st.querySelectorAll(".u1-live")].map((e) => e.getAttribute("data-line") ?? e.getAttribute("data-of")).filter(Boolean))].sort().join(" + ");
      return { phase: st.getAttribute("data-phase"), lamps: st.querySelectorAll("[data-lamp][data-on]").length, parts: st.querySelectorAll(".u1-live").length, lit, needle: st.querySelector("[data-needle] path")?.getAttribute("d") ?? "", chips: [...st.querySelectorAll(".u1-chip[data-run]")].map((c) => c.textContent).join(" | "), replay: document.querySelector('[data-testid="u1-replay"]')?.textContent ?? "", pop: Boolean(document.querySelector(".u1-pop")) };
    });
    if (s.phase !== "playing") break;
    seen.frames++;
    seen.lamps = Math.max(seen.lamps, s.lamps);
    seen.parts = Math.max(seen.parts, s.parts);
    seen.needles.add(s.needle);
    if (s.lit) seen.litSets.add(s.lit);
    if (s.chips) seen.chips.add(s.chips);
    if (s.chips && seen.firstChipAt === null) seen.firstChipAt = { ms: Date.now() - t0, popOpen: s.pop };
    seen.replayLabel.add(s.replay);
    const el = Date.now() - t0;
    if (shotPrefix && shots < 4 && el > [900, 2200, 3700, 5200][shots]) await page.screenshot({ path: `${outDir}/${shotPrefix}-play-${[900, 2200, 3700, 5200][shots++]}ms.png` });
    if (el > 60_000) break;
    await page.waitForTimeout(100);
  }
  const ms = Date.now() - t0;
  const r = { ms, frames: seen.frames, maxLampsLit: seen.lamps, maxPartsLit: seen.parts, needlePositions: seen.needles.size, chipStates: seen.chips.size, litTogether: [...seen.litSets].slice(0, 12), replayLabelsWhilePlaying: [...seen.replayLabel], firstChip: seen.firstChipAt };
  check(ms >= 4000 && r.needlePositions >= 3 && r.chipStates >= 2 && (r.maxLampsLit > 0 || r.maxPartsLit > 0), `the run plays visibly ${name}: ms ${ms}, frames ${r.frames}, needle positions ${r.needlePositions}, chip states ${r.chipStates}`);
  return r;
}

async function cables(page, file, name, atRest = false) {
  const lines = await page.$$eval("[data-line]", (els) => [...new Set(els.map((e) => e.getAttribute("data-line")))].sort());
  // At rest there is no test, so no stand-in device and no cable to one.
  const want = file.cables.filter((c) => !atRest || !c.includes("stand-in")).sort();
  check(JSON.stringify(lines) === JSON.stringify(want), `the drawing's cables are exactly the code's ${name}: ${lines.join(", ")}`);
}

async function round(browser, file, theme, { width = 1920, height = 1080, claim = true, typed = false } = {}) {
  const name = `${file.key} ${theme} ${width}x${height}`;
  const pre = `${file.key}-${theme}-${width}`;
  const page = await newPage(browser, { theme, width, height });
  const R = (results.rounds[name] = {});
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  if (file.key === "ts" && theme === "light" && width === 1920) {
    R.landing = await page.textContent(".u1-lede");
    check(/\bbet\b/.test(R.landing), `the landing page says "bet": ${R.landing}`);
    const font = await page.$eval('[data-testid="u1-code"]', (e) => getComputedStyle(e).fontFamily);
    check(/mono|Menlo|SF Mono|Consolas/i.test(font), `the paste box is set in a code font: ${font}`);
    await page.screenshot({ path: `${outDir}/${pre}-0-landing.png` });
    await axe(page, `landing ${name}`);
  }
  await pasteKey(page, file.code);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(800);
  await beforeBet(page, `rest ${name}`);
  await cables(page, file, `at rest ${name}`, true);
  const label = await page.$eval(".u1-svg svg", (s) => s.getAttribute("aria-label") ?? s.querySelector("title")?.textContent ?? "");
  check(label.length > 20 && !/skid|collar|instrument box|bent steel/i.test(label), `screen-reader text in plain words ${name}: ${label.slice(0, 160)}`);
  await page.screenshot({ path: `${outDir}/${pre}-1-rest.png` });
  await axe(page, `rest ${name}`);
  // item 7: a mouse click on a box pins its card (the helper box, not the tested one)
  const helper = file.key === "ts" ? "fetchPage" : "cached";
  const hb = await page.locator(`[data-hit="${helper}"]`).first().boundingBox();
  await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.waitForTimeout(300);
  R.card = (await page.locator('[data-testid="part-card"]').innerText().catch(() => "")).replace(/\n+/g, " / ");
  const pinned = await page.locator('[data-testid="part-card"][data-pinned]').count();
  check(pinned === 1 && R.card.startsWith(helper), `a mouse click pins ${helper}'s card ${name}: ${R.card.slice(0, 220)}`);
  if (file.key === "ts") check(/Calls itself \(line 7\)/.test(R.card) && /not exported/.test(R.card), `fetchPage's card says it calls itself, and why it cannot be the tested function ${name}`);
  await page.screenshot({ path: `${outDir}/${pre}-2-card.png` });
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="part-card"] .u1-close').click().catch(() => null);
  // item 6: the wait
  await page.getByRole("button", { name: "Bet on your understanding" }).click();
  const tOpen = Date.now();
  await page.waitForSelector('[data-testid="u1-wait"]', { timeout: 3000 });
  await page.waitForTimeout(1600);
  R.wait = (await page.textContent('[data-testid="u1-wait"]')).replace(/\s+/g, " ");
  check(/\d+ s so far/.test(R.wait) && /Step 1 of 3/.test(R.wait) && (await page.locator('[data-testid="u1-own-now"]').count()) === 1, `Wonder's wait shows seconds, the step and "Write my own test instead" at once ${name}: ${R.wait}`);
  // the drawing stays live during the wait: hovering a part shows its card
  const tb = await page.locator(`[data-hit="${file.fn}"]`).first().boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.waitForTimeout(250);
  R.cardDuringWait = (await page.locator('[data-testid="part-card"]').innerText().catch(() => "")).split("\n")[0];
  check(R.cardDuringWait === file.fn, `the drawing stays explorable while Wonder writes ${name}: ${R.cardDuringWait}`);
  await page.mouse.move(5, 500);
  await page.screenshot({ path: `${outDir}/${pre}-3-wait.png` });
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  R.firstTestMs = Date.now() - tOpen;
  await page.waitForTimeout(900);
  await beforeBet(page, `bet open ${name}`);
  await cables(page, file, `with the test ${name}`);
  R.test = await page.textContent('[data-testid="u1-test"]');
  say(`test (${name}): ${R.test}`);
  if (file.key === "ts") check(/answers 429 with \{\} on call 1; every later call answers 429 with \{\} too/.test(R.test), `the default test hits the retry limit (429 on every call) ${name}`);
  else check(/then calls get_user_plan\(1\): 2 calls in a row/.test(R.test), `the default test calls the cache twice ${name}`);
  check(!/AtlasStandInExhausted/.test(await page.textContent('[data-testid="u1-pop"]')), `no internal error names in the pop-up ${name}`);
  const how = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="u1-how"]');
    const q = document.querySelector(".u1-quiz");
    return { open: d?.open ?? null, summary: d?.querySelector("summary")?.textContent, after: q && d ? Boolean(q.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) : false, inText: document.querySelector(".u1-seen pre")?.textContent.includes("Atlas runs it on a simulated clock") };
  });
  check(how.open === false && how.summary === "How Atlas runs it" && how.after && how.inText, `questions first; the conditions fold into a closed "How Atlas runs it" and stay in the bettor text ${name}: ${JSON.stringify(how)}`);
  await answersFit(page, name);
  await page.screenshot({ path: `${outDir}/${pre}-4-bet.png` });
  await axe(page, `bet open ${name}`);
  await overlap(page, `bet open ${name}`, '[data-testid="u1-pop"]');
  // item 3: the test list writes Python values as Python
  if (file.key === "py") {
    await page.getByTestId("u1-change").click();
    await page.waitForTimeout(300);
    R.list = (await page.textContent('[data-testid="u1-tests"]')).replace(/\s+/g, " ");
    check(/get_user_plan\(True\)/.test(R.list) && !/get_user_plan\(true\)/.test(R.list), `Python values read as Python in the test list ${name}: ${R.list.slice(0, 200)}`);
    const gap = await page.evaluate(() => {
      const row = document.querySelector(".u1-linkrow");
      const [a, b] = row ? [...row.querySelectorAll("button")] : [];
      return a && b ? Math.round(b.getBoundingClientRect().left - a.getBoundingClientRect().right) : null;
    });
    check(gap !== null && gap >= 12, `"Write your own test" and "Back to the quiz" have space between them ${name}: ${gap}px`);
    await page.screenshot({ path: `${outDir}/${pre}-4b-list.png` });
    await page.getByText("Back to the quiz").click();
  }
  // answers: the first option of each question; on the Python round, a typed value for what it returns
  const groups = page.locator(".u1-opts");
  for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByRole("radio").first().click({ timeout: 5000 });
  if (typed) {
    await page.getByTestId("typed-returnedJson").fill("'pro'");
    R.typedHint = await page.textContent("#typed-returnedJson-hint");
    check(R.typedHint === 'Atlas reads it as "pro".', `a typed value is read back in the code's spelling ${name}: ${R.typedHint}`);
  }
  await page.getByRole("button", { name: "Seal my answers" }).click();
  R.play = await watchPlay(page, name, pre);
  check(R.play.replayLabelsWhilePlaying.every((l) => l === "" || l === "Playing the run…"), `no "Play the run again" before the first play ends ${name}: ${R.play.replayLabelsWhilePlaying.join(" | ")}`);
  check(R.play.firstChip && R.play.firstChip.popOpen === false, `the play starts after the pop-up has closed ${name}: ${JSON.stringify(R.play.firstChip)}`);
  if (file.key === "ts") check(R.play.litTogether.some((s) => s.includes("fetchAllOrders->fetchPage") && s.includes("fetchPage=>stand-in fetch") && s.includes("fetchPage")), `a fetch call lights fetchAllOrders, fetchPage and both cables ${name}: ${R.play.litTogether.join(" || ")}`);
  else check(R.play.litTogether.some((s) => s.includes("get_user_plan") && s.includes("cached")), `calling the decorated function lights its decorator too ${name}: ${R.play.litTogether.join(" || ")}`);
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  await page.waitForTimeout(700);
  R.replayAfter = await page.textContent('[data-testid="u1-replay"]');
  check(R.replayAfter === "Play the run again", `"Play the run again" after the first play ${name}`);
  await page.screenshot({ path: `${outDir}/${pre}-5-marked.png` });
  R.headline = await page.textContent('[data-testid="u1-headline"]');
  R.marks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="mark-"]')].filter((e) => e.getAttribute("data-testid") !== "mark-list").map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  say(`marks (${name}): ${R.marks.join(" | ")}`);
  if (typed) check(R.marks.some((m) => /You\s*typed "pro"\s*matched/.test(m)), `the typed value is sealed and judged ${name}`);
  await labelsClear(page, `marked ${name}`);
  await axe(page, `marked ${name}`);
  await overlap(page, `marked list ${name}`, '[data-testid="mark-list"]');
  // proof card
  await page.getByRole("button", { name: "Proof card" }).click();
  await page.waitForSelector('[data-testid="pc-plain"]', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(600);
  const proof = await page.evaluate(() => {
    const plain = document.querySelector('[data-testid="pc-plain"]');
    const tech = document.querySelector('[data-testid="pc-tech"]');
    const bets = document.querySelector('[data-testid="pc-bets"]');
    return { plain: plain?.textContent.slice(0, 80), techOpen: tech?.open ?? null, plainBeforeTech: plain && tech ? Boolean(plain.compareDocumentPosition(tech) & Node.DOCUMENT_POSITION_FOLLOWING) : false, sha256Folded: Boolean(tech?.textContent.includes("sha256")), firstQuestion: bets?.querySelector("tbody td:nth-child(2)")?.textContent };
  });
  check(proof.techOpen === false && proof.plainBeforeTech && proof.sha256Folded && /^(how it ends|what it returns|how long it takes|calls to )/.test(proof.firstQuestion ?? ""), `proof card: plain words first, judge file / sha256 / seed folded ${name}: ${JSON.stringify(proof)}`);
  await page.screenshot({ path: `${outDir}/${pre}-6-proof.png` });
  await axe(page, `proof panel ${name}`);
  await page.getByRole("button", { name: "Close the proof card" }).click();
  if (claim) {
    // item 5
    R.claim = await page.textContent('[data-testid="u1-claim"] q');
    await page.getByTestId("u1-test-claim").click();
    await page.waitForSelector('[data-testid="u1-wait"]', { timeout: 3000 });
    R.claimWait = (await page.textContent('[data-testid="u1-wait"]')).replace(/\s+/g, " ");
    check(R.claimWait.includes(R.claim.slice(0, 40)), `the sentence being tested is shown while the test is written ${name}`);
    await page.screenshot({ path: `${outDir}/${pre}-7-claim-wait.png` });
    await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
    check((await page.locator('[data-testid="u1-claim-tested"]').count()) === 1, `the quiz says which sentence its test checks ${name}`);
    await page.screenshot({ path: `${outDir}/${pre}-8-claim-bet.png` });
    for (let i = 0; i < (await groups.count()); i++) await groups.nth(i).getByRole("radio").nth(1).click({ timeout: 5000 });
    await page.getByRole("button", { name: "Seal my answers" }).click();
    await page.waitForSelector('[data-phase="marked"]', { timeout: T });
    await page.waitForTimeout(800);
    R.claimFacts = (await page.textContent('[data-testid="u1-claim-facts"]')).replace(/\s+/g, " ");
    check(/What the run shows about this claim: you decide/.test(R.claimFacts) && R.claimFacts.includes(R.claim.slice(0, 40)) && /How it ends:/.test(R.claimFacts) && /Atlas does not say whether the sentence holds/.test(R.claimFacts), `after the claim's test: the sentence beside the measured facts, "you decide" ${name}: ${R.claimFacts.slice(0, 300)}`);
    check((await page.locator('[data-testid="u1-test-claim"]').count()) === 0, `the same "Test this claim" button is not offered again ${name}`);
    await labelsClear(page, `claim marked ${name}`);
    await page.screenshot({ path: `${outDir}/${pre}-9-claim-facts.png` });
    await axe(page, `claim facts ${name}`);
    await overlap(page, `claim facts list ${name}`, '[data-testid="mark-list"]');
  }
  await page.context().close();
}

/** Item 6: "Write my own test instead" during the wait: the form opens at once, and Wonder's answer does not replace it. */
async function ownDuringWait(browser) {
  const page = await newPage(browser, {});
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteKey(page, FILES[0].code);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.getByRole("button", { name: "Bet on your understanding" }).click();
  await page.waitForSelector('[data-testid="u1-own-now"]', { timeout: 3000 });
  const t0 = Date.now();
  await page.getByTestId("u1-own-now").click();
  await page.waitForSelector('[data-testid="test-form"]', { timeout: 3000 });
  const formMs = Date.now() - t0;
  const stillWaiting = await page.locator('[data-testid="u1-wait"]').count();
  await page.waitForFunction(() => !document.querySelector('[data-testid="u1-wait"]'), null, { timeout: T });
  await page.waitForTimeout(800);
  const formAfter = await page.locator('[data-testid="test-form"]').count();
  const quizOpened = await page.locator('[data-testid="u1-seal"]').count();
  const listed = await page.locator('[data-testid^="u1-use-"]').count();
  check(formMs < 1500 && stillWaiting === 1 && formAfter === 1 && quizOpened === 0 && listed > 0, `"Write my own test instead" opens the form at once (${formMs} ms, Wonder still writing: ${stillWaiting === 1}); Wonder's tests then wait in the list (${listed}) and do not replace the form`);
  await page.screenshot({ path: `${outDir}/own-test-during-wait.png` });
  await page.context().close();
}

async function phone(browser, theme) {
  const page = await newPage(browser, { width: 390, height: 844, theme });
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await overflow(page, `entry ${theme}`);
  await pasteKey(page, FILES[1].code);
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
    new MutationObserver((ms) => {
      for (const m of ms) if (m.target.hasAttribute?.("data-on")) window.__lit++;
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-on"] });
  });
  await page.getByRole("button", { name: "Seal my answers" }).click();
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  const lit = await page.evaluate(() => window.__lit);
  const label = await page.textContent('[data-testid="u1-replay"]');
  check(lit === 0 && label === "Play the run again", `reduced motion: the end state shows at once, no lamp ever lit (${lit}), replay offered`);
  await page.context().close();
}

const browser = await chromium.launch({ executablePath: exe });
try {
  await round(browser, FILES[0], "light");
  await round(browser, FILES[0], "dark", { claim: false });
  await round(browser, FILES[1], "light", { typed: true });
  await round(browser, FILES[1], "dark", { claim: false });
  await round(browser, FILES[0], "light", { width: 1366, height: 768, claim: false });
  await round(browser, FILES[1], "light", { width: 1366, height: 768, claim: false });
  await ownDuringWait(browser);
  for (const theme of ["light", "dark"]) await phone(browser, theme);
  await reduced(browser);
} catch (e) {
  check(false, `the click-through stopped: ${e.message.split("\n")[0]}`);
}
await browser.close();
check(results.errors.length === 0, `page errors: ${results.errors.length}${results.errors.length ? ` (${results.errors.slice(0, 3).join(" | ")})` : ""}`);
const notFound = results.bad.filter((b) => b.startsWith("404"));
check(notFound.length === 0, `no 404 responses (all failed responses: ${[...new Set(results.bad)].join(", ") || "none"})`);
say(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECKS FAILED`);
writeFileSync(`${outDir}/checks.json`, JSON.stringify(results, null, 2));
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
process.exit(failures.length === 0 ? 0 : 1);
