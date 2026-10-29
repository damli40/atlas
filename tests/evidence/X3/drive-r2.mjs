// X3 review round 2 click-through (D50), against tests/evidence/X3/mock-server.ts + Vite (every model mocked, $0): the U1
// drawing shows plain code's failure labels before betting, "What every bettor sees" carries the same labels, and after a
// sealed never-answers round the label says reproduced. Usage as drive.mjs.
import { readFileSync, writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:5185/";
const EXAMPLE = /export const PASTE_EXAMPLE = `([\s\S]*?)`;/.exec(readFileSync(new URL("../../../web/paste-example.ts", import.meta.url), "utf8"))[1];
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
const flat = (s) => s.replace(/\s+/g, " ").trim();
const results = { axe: {}, overflow: {}, motion: {}, overlap: {}, errors: [] };

async function newPage(width = 1920, height = 1080, theme = "light", reducedMotion = "reduce") {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion, colorScheme: theme });
  page.on("pageerror", (e) => results.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && results.errors.push(`console: ${m.text()}`));
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


// ---------- X3 review round 2 (D50): labels on the U1 drawing BEFORE betting, and in every bettor's text ----------
async function pasteInto(page, text) {
  await page.locator('[data-testid="u1-code"]').focus();
  await page.evaluate((t) => {
    const ta = document.querySelector('[data-testid="u1-code"]');
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}
const markTexts = (page) => page.evaluate(() => [...document.querySelectorAll("[data-label-mark]")].map((e) => e.textContent.replace(/\s+/g, " ").trim()));

{
  say("=== U1 drawing at 1920×1080 (light): labels before betting, in the bettor text, then reproduced");
  const page = await newPage(1920, 1080, "light");
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteInto(page, EXAMPLE);
  await page.waitForSelector(".u1-svg svg", { timeout: 90000 });
  await page.waitForSelector("[data-label-mark]", { timeout: 30000 });
  const before = await markTexts(page);
  say("label marks before any bet:", before.join(" | "));
  check(before.length === 1 && /^found in this code: no overall timeout, lines 4–11$/.test(before[0]), "D50: the label is drawn on the part before any bet");
  check((await page.locator("[data-run]").count()) === 0, "before betting: nothing on the stage carries run data");
  const box = await page.evaluate(() => {
    const r = document.querySelector("[data-label-mark]").getBoundingClientRect();
    const bar = document.querySelector(".u1-bar").getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, barBottom: bar.bottom, vw: innerWidth, vh: innerHeight };
  });
  check(box.top > box.barBottom && box.bottom < box.vh && box.left >= 0 && box.right <= box.vw, `the label mark is on screen, below the top bar (${JSON.stringify(box)})`);
  await page.screenshot({ path: `${outDir}/r2-labels-before-bet-1920.png` });
  await axe(page, "r2 rest with labels");
  await overlap(page, "r2 rest with labels", '[data-testid="bench-stage"]');

  await page.locator('[data-testid="u1-bet-toggle"]').click();
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await page.locator(".u1-seen summary").click();
  const seen = await page.locator(".u1-seen pre").innerText();
  check(seen.includes("Atlas's failure labels for this function (plain code's reading of its text, before any run of this test):") && seen.includes("- no overall timeout (retry): found in this code at lines 4–11."), "D50: 'What every bettor sees' carries the same labels (the models' prompt is this text)");
  await page.locator('[data-testid="u1-pop"]').screenshot({ path: `${outDir}/r2-bettor-text-1920.png` });
  await axe(page, "r2 bet open");
  await overlap(page, "r2 bet open", '[data-testid="u1-pop"]');

  // Pick Wonder's second test (fetchIt never answers), answer one question, seal: the run plays.
  await page.locator('[data-testid="u1-change"]').click();
  await page.locator('[data-testid="u1-use-1"]').click();
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await page.locator(".u1-opts").first().locator(".u1-opt").first().click();
  await page.locator('[data-testid="u1-seal"]').click();
  await page.waitForSelector('[data-phase="marked"]', { timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-label-mark]")].some((e) => /^reproduced: no overall timeout/.test(e.textContent.trim())), null, { timeout: 30000 });
  const after = await markTexts(page);
  say("label marks after the never-answers round:", after.join(" | "));
  check(after.some((t) => /^reproduced: no overall timeout, lines 4–11$/.test(t)), "after a sealed never-answers round: the label on the drawing says reproduced");
  const proof = await page.getAttribute('[data-testid="u1-proof"]', "href");
  check(Boolean(proof), `the round's proof card link: ${proof}`);
  await page.screenshot({ path: `${outDir}/r2-reproduced-1920.png` });
  await axe(page, "r2 marked");
  await motion(page, "r2 marked");
  await page.close();
}

{
  say("=== U1 drawing at 390 px (dark): the label before betting");
  const page = await newPage(390, 844, "dark");
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteInto(page, EXAMPLE);
  await page.waitForSelector(".u1-svg svg", { timeout: 90000 });
  await page.waitForSelector("[data-label-mark]", { timeout: 30000 });
  await overflow(page, "r2 rest 390");
  await page.screenshot({ path: `${outDir}/r2-labels-before-bet-390-dark.png` });
  await axe(page, "r2 rest 390 dark");
  await page.close();
}

writeFileSync(`${outDir}/r2-checks.json`, JSON.stringify(results, null, 1));
writeFileSync(`${outDir}/r2-browser-output.txt`, out.join("\n") + "\n");
check(results.errors.length === 0, `no page errors (${results.errors.join("; ")})`);
await browser.close();
say(failures.length ? `FAILED: ${failures.length} checks` : "all checks passed");
process.exit(failures.length ? 1 : 0);
