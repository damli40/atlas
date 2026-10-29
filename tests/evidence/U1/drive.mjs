// U1 browser click-through of the drawing-first screen, in headless Chromium, against the RUNNING app
// (tests/evidence/U1/mock-server.ts + Vite, every model mocked, $0) or, with U1_LIVE=1, against a server with real models.
// The flow: paste the U1 example (a real paste keystroke: no click) → the drawing → "Bet on your understanding" →
// Wonder's first allowed test preselected → tap three answers → "Seal my answers" → the run plays on the drawing →
// every question marked. Clicks are counted from the paste to the marked drawing.
// Checks on every state: axe-core (WCAG 2 A/AA + best practice), the D07-04 text-overlap check on the stage, the
// before-bet rule (no run value drawn before sealing), 390 px usable (no page scroll, the drawing zooms), reduced motion
// = the marked end state with no animation and no lamp ever lit. Film shots at 1920×1080 in both themes.
// Also drives the earlier paste screen (Demos) to count its clicks for the same kind of round. Exits 1 on a failure.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> node tests/evidence/U1/drive.mjs <chromium headless shell> <out dir>
import { readFileSync, writeFileSync } from "node:fs";
const EXAMPLE = /export const U1_EXAMPLE = `([\s\S]*?)`;/.exec(readFileSync(new URL("../../../web/u1-example.ts", import.meta.url), "utf8"))[1];
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:5185/";
const LIVE = process.env.U1_LIVE === "1";
const ONLY = process.env.U1_ONLY ?? "all";
const browser = await chromium.launch({ executablePath: exe });
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
const results = { axe: {}, overflow: {}, motion: {}, overlap: {}, beforeBet: {}, clicks: {}, errors: [] };
const T = LIVE ? 600_000 : 90_000;

async function newPage(width = 1920, height = 1080, theme = "light", reduced = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: reduced ? "reduce" : "no-preference", colorScheme: theme });
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
    return { violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })), passes: res.passes.length };
  });
  results.axe[name] = r;
  check(r.violations.length === 0, `axe ${name}: ${r.violations.length} violations ${r.violations.map((v) => `${v.id}/${v.impact}×${v.nodes} [${v.targets.join(" | ")}]`).join(", ")} (${r.passes} rules passed)`);
}

async function overflow(page, name) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== "fixed";
      })
      .filter((e) => !e.closest("pre, .code, [data-scroll-x]"))
      .slice(0, 5)
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} right=${Math.round(e.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, noScroll: document.documentElement.scrollWidth <= vw, wide };
  });
  results.overflow[name] = r;
  check(r.noScroll, `390px ${name}: scrollWidth ${r.scrollWidth} vs ${r.clientWidth}${r.wide.length ? ` (${r.wide.join("; ")})` : ""}`);
}

/** The D07-04 overlap check: inside `root`, no two visible text boxes of different elements overlap, and no text sticks out. */
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
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], c = items[j];
        if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (w > 1 && h > 1) hits.push(`"${a.text}" × "${c.text}"`);
      }
    }
    return { textBoxes: items.length, overlaps: hits.slice(0, 10), overlapCount: hits.length, outside: outside.slice(0, 10), outsideCount: outside.length, width: Math.round(cb.width) };
  }, root);
  results.overlap[name] = r;
  check(!r.error && r.overlapCount === 0 && r.outsideCount === 0, `overlap ${name}: ${r.error ?? `${r.width} px wide, ${r.textBoxes} text boxes, ${r.overlapCount} overlapping pairs${r.overlaps?.length ? ` (${r.overlaps.join("; ")})` : ""}, ${r.outsideCount} outside${r.outside?.length ? ` (${r.outside.join("; ")})` : ""}`}`);
}

async function motion(page, name) {
  const r = await page.evaluate(() => {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    return { running: running.length };
  });
  results.motion[name] = r;
  check(r.running === 0, `reduced motion ${name}: ${r.running} running animations`);
}


/** Before the bets are sealed, nothing on the stage may carry a run result. */
async function beforeBet(page, name) {
  const r = await page.evaluate(() => {
    const st = document.querySelector('[data-testid="bench-stage"]');
    const fig = st.querySelector(".u1-figure");
    const overlay = [...fig.children].filter((c) => !c.classList.contains("u1-svg")).map((c) => c.textContent).join("");
    const svgText = st.querySelector(".u1-svg svg")?.textContent ?? "";
    return {
      phase: st.getAttribute("data-phase"),
      runEls: st.querySelectorAll("[data-run]").length,
      litLamps: st.querySelectorAll("[data-lamp][data-on]").length,
      liveLines: st.querySelectorAll(".u1-live").length,
      marks: st.querySelectorAll(".u1-pin, [data-testid=mark-list]").length,
      overlay,
      svgHasRunWords: /\d+\s*(ms|calls?)\b|returned|threw|matched/i.test(svgText),
    };
  });
  results.beforeBet[name] = r;
  check(r.phase === "rest" && r.runEls === 0 && r.litLamps === 0 && r.liveLines === 0 && r.marks === 0 && r.overlay === "" && !r.svgHasRunWords, `before-bet rule ${name}: ${JSON.stringify(r)}`);
}

let clicks = 0;
const click = async (page, sel) => {
  clicks++;
  await page.locator(sel).first().click();
};
/** A real paste: the example goes on the clipboard event, as when a person presses Cmd/Ctrl+V. */
async function pasteExample(page) {
  const example = EXAMPLE;
  await page.locator('[data-testid="u1-code"]').focus();
  await page.evaluate((text) => {
    const ta = document.querySelector('[data-testid="u1-code"]');
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, example);
}
const answers = ['[data-testid="opt-outcome-a"]', '[data-testid="opt-calls:fetchIt-c"]', '[data-testid="opt-virtualMs-d"]'];

async function round(theme, { shots = true, reduced = false } = {}) {
  const page = await newPage(1920, 1080, theme, reduced);
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  if (shots) await page.screenshot({ path: `${outDir}/film-entry-1920-${theme}.png` });
  if (!reduced) await axe(page, `entry ${theme}`);
  clicks = 0;
  await pasteExample(page);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(700);
  await beforeBet(page, `rest ${theme}`);
  if (shots) await page.screenshot({ path: `${outDir}/film-rest-1920-${theme}.png` });
  if (!reduced) {
    await axe(page, `rest ${theme}`);
    await overlap(page, `rest ${theme}`, '[data-testid="bench-stage"]');
  }
  await click(page, '[data-testid="u1-bet-toggle"]');
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.waitForSelector("[data-lamp]", { timeout: T });
  await page.waitForTimeout(900);
  await beforeBet(page, `bet open ${theme}`);
  for (const a of answers) await click(page, a);
  if (shots) await page.screenshot({ path: `${outDir}/film-bet-1920-${theme}.png` });
  if (!reduced) {
    await axe(page, `bet open ${theme}`);
    await overlap(page, `bet open ${theme}`, '[data-testid="u1-pop"]');
  }
  if (reduced) await page.evaluate(() => {
    window.__lit = 0;
    new MutationObserver((ms) => { for (const m of ms) if (m.target.hasAttribute?.("data-on")) window.__lit++; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-on"] });
  });
  await click(page, '[data-testid="u1-seal"]');
  if (!reduced) {
    await page.waitForSelector("[data-lamp][data-on]", { timeout: T });
    await page.waitForTimeout(150);
    if (shots) await page.screenshot({ path: `${outDir}/film-mid-1920-${theme}.png` });
  }
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  results.clicks[`new ${theme}${reduced ? " reduced" : ""}`] = clicks;
  check(clicks <= 5, `clicks from paste to the marked drawing (${theme}${reduced ? ", reduced motion" : ""}): ${clicks}`);
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${outDir}/film-marked-1920-${theme}.png` });
  if (!reduced) {
    await axe(page, `marked ${theme}`);
    await overlap(page, `marked ${theme}`, '[data-testid="bench-stage"]');
  } else {
    await motion(page, `marked ${theme}`);
    const lit = await page.evaluate(() => window.__lit);
    results.motion[`lamps lit ${theme}`] = lit;
    check(lit === 0, `reduced motion ${theme}: no lamp ever lit (${lit}); the end state shows at once`);
    if (shots) await page.screenshot({ path: `${outDir}/reduced-marked-1920-${theme}.png` });
  }
  const proofHref = await page.getAttribute('[data-testid="u1-proof"]', "href").catch(() => null);
  const marks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="mark-"]')].filter((e) => e.getAttribute("data-testid") !== "mark-list").map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  say(`marks (${theme}): ${marks.join(" | ")}`);
  check(marks.length >= 3, `marked: ${marks.length} questions marked on the drawing`);
  check(Boolean(proofHref), `proof card link: ${proofHref}`);
  await page.context().close();
  return proofHref;
}

async function phone(theme) {
  const page = await newPage(390, 844, theme);
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await overflow(page, `entry ${theme}`);
  await page.screenshot({ path: `${outDir}/phone-entry-390-${theme}.png` });
  clicks = 0;
  await pasteExample(page);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(600);
  await overflow(page, `rest ${theme}`);
  const before = await page.evaluate(() => document.querySelector(".u1-pan").getAttribute("style"));
  await click(page, 'button[aria-label="Zoom in"]');
  const after = await page.evaluate(() => document.querySelector(".u1-pan").getAttribute("style"));
  check(before !== after, `390px ${theme}: the drawing zooms (${before} → ${after})`);
  await page.screenshot({ path: `${outDir}/phone-zoomed-390-${theme}.png` });
  await click(page, 'button[aria-label="Fit the drawing"]');
  await click(page, '[data-testid="u1-bet-toggle"]');
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.waitForTimeout(700);
  await overflow(page, `bet open ${theme}`);
  await page.screenshot({ path: `${outDir}/phone-bet-390-${theme}.png` });
  for (const a of answers) await click(page, a);
  await click(page, '[data-testid="u1-seal"]');
  await page.waitForSelector('[data-phase="marked"]', { timeout: T });
  await page.waitForTimeout(500);
  await overflow(page, `marked ${theme}`);
  await overlap(page, `marked 390 ${theme}`, '[data-testid="mark-list"]');
  await page.screenshot({ path: `${outDir}/phone-marked-390-${theme}.png` });
  await page.context().close();
}

/** The earlier paste screen, as it stood on main (where the app opened on the retry machine): the same kind of round. */
async function before() {
  const page = await newPage(1920, 1080, "light");
  await page.goto(URL0);
  clicks = 1; // on main the app opened on the retry machine: one click on "Paste any code" to get here
  await click(page, '[data-testid="u1-demos"]');
  await click(page, '[data-testid="mode-paste"]');
  clicks -= 2; // the Demos menu is U1's way in; it is not counted against the old flow
  const example = EXAMPLE;
  await page.locator('[data-testid="paste-code"]').fill(example);
  await click(page, '[data-testid="paste-read"]');
  await page.waitForSelector('[data-testid="export-fetchWithRetry"]', { timeout: T });
  await click(page, '[data-testid="export-fetchWithRetry"]');
  await click(page, '[data-testid="ask-wonder"]');
  await page.waitForSelector('[data-testid="use-0"]', { timeout: T });
  await click(page, '[data-testid="use-0"]');
  await page.waitForSelector('[data-testid="seal"]', { timeout: T });
  clicks += 2; // the outcome select: open + choose
  await page.selectOption('[data-testid="bet-outcome"]', "returned");
  await click(page, '[data-testid="bet-calls:fetchIt"]');
  await page.locator('[data-testid="bet-calls:fetchIt"]').fill("3");
  await click(page, '[data-testid="bet-virtualMs"]');
  await page.locator('[data-testid="bet-virtualMs"]').fill("300");
  await click(page, '[data-testid="seal"]');
  await page.waitForSelector('[data-testid="run"]:not([disabled])', { timeout: T });
  await click(page, '[data-testid="run"]');
  await page.waitForSelector('section[aria-label="verdicts"], [data-testid="paste-run-facts"]', { timeout: T });
  results.clicks.before = clicks;
  say(`clicks on the earlier paste screen, paste to verdict (3 answers, 2 typed): ${clicks}`);
  await page.screenshot({ path: `${outDir}/before-earlier-screen-1920-light.png`, fullPage: true });
  await page.context().close();
}

try {
  for (const theme of ["light", "dark"]) if (ONLY === "all" || ONLY === "film") await round(theme);
  if (ONLY === "all" || ONLY === "reduced") for (const theme of ["light", "dark"]) await round(theme, { shots: theme === "light", reduced: true });
  if (ONLY === "all" || ONLY === "phone") for (const theme of ["light", "dark"]) await phone(theme);
  if (ONLY === "all" || ONLY === "before") await before();
} catch (e) {
  check(false, `the click-through stopped: ${e.message.split("\n")[0]}`);
}
check(results.errors.length === 0, `page errors: ${results.errors.length}${results.errors.length ? ` (${results.errors.slice(0, 3).join(" | ")})` : ""}`);
say(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECKS FAILED`);
writeFileSync(`${outDir}/checks${LIVE ? "-live" : ""}.json`, JSON.stringify(results, null, 2));
writeFileSync(`${outDir}/browser-output${LIVE ? "-live" : ""}.txt`, out.join("\n") + "\n");
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
