// X4 click-through at $0: the real Atlas server with every model call mocked (tests/evidence/U3/mock-server.ts), in a real
// browser. Checks, on the "how sure" tap and the record panel only:
// - nothing is preselected; the tap sits in the seal bar; the picker's answers stay visible without scrolling
// - clicks from paste to verdict, with and without the tap
// - the verdict line and the proof file hold what was tapped; a round with no tap says nothing
// - the record panel's comparison stays hidden under 3 answers a side, then appears, from real rounds
// - axe 0, text overlap 0, no sideways page scroll, at 1920x1080, 1366x768 and 390x844, light and dark
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> node tests/evidence/X4/drive.mjs <chromium> <outDir>
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const [exe, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:18972/";
const T = 120_000;
const CODE = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
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
const counts = { axe: 0, axeViolations: 0, overlap: 0, overlapHits: 0, wide: 0, wideFails: 0 };

async function newPage(browser, { width = 1920, height = 1080, theme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: theme });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  // The picker counts as one element; every click goes through this.
  page.clicks = 0;
  page.tap = async (sel) => {
    page.clicks++;
    await page.locator(sel).click();
  };
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("atlas-theme", t);
    } catch {}
  }, theme);
  return page;
}
async function axe(page, name) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return res.violations.map((v) => `${v.id}/${v.impact}×${v.nodes.length} [${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}]`);
  });
  counts.axe++;
  counts.axeViolations += r.length;
  check(r.length === 0, `axe ${name}: ${r.length} violations ${r.join(", ")}`);
}
async function overflow(page, name) {
  const r = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  counts.wide++;
  if (r.s > r.c) counts.wideFails++;
  check(r.s <= r.c, `no sideways scroll ${name}: ${r.s} vs ${r.c}`);
}
/** The same check as U3's: inside `root`, no two visible text boxes of different elements overlap, and none sticks out. */
async function overlap(page, name, root) {
  const r = await page.evaluate((sel) => {
    const card = document.querySelector(sel);
    if (!card) return { error: `no ${sel}` };
    const cb = card.getBoundingClientRect();
    // A text cut off by its own box (the clamped test sentence) counts only where it shows: the same clip as U3's check.
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
    const outside = items.filter((it) => it.b.left < cb.left - 1 || it.b.right > cb.right + 1).map((it) => it.text);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], c = items[j];
        if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
        if (a.el.closest(".u1-sealbar") !== c.el.closest(".u1-sealbar")) continue;
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (w > 1 && h > 1) hits.push(`"${a.text}" × "${c.text}"`);
      }
    return { n: items.length, hits: hits.slice(0, 8), hitCount: hits.length, outside: outside.slice(0, 8) };
  }, root);
  counts.overlap++;
  counts.overlapHits += (r.hitCount ?? 1) + (r.outside?.length ?? 0);
  check(!r.error && r.hitCount === 0 && r.outside.length === 0, `overlap ${name}: ${r.error ?? `${r.n} text boxes, ${r.hitCount} overlapping${r.hits.length ? ` (${r.hits.join("; ")})` : ""}, ${r.outside.length} outside${r.outside.length ? ` (${r.outside.join("; ")})` : ""}`}`);
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
async function toQuiz(page) {
  await page.goto(URL0);
  await page.waitForSelector('[data-testid="u1-code"]');
  await pasteKey(page, CODE);
  await page.waitForSelector(".u1-svg svg", { timeout: T });
  await page.waitForTimeout(500);
  await page.tap('[data-testid="u1-bet-toggle"]');
  await page.waitForSelector('[data-testid="u1-seal"]', { timeout: T });
  await page.waitForTimeout(600);
}
const firstOptions = (page) => page.evaluate(() => [...document.querySelectorAll(".u1-opts")].map((g) => g.querySelector('[role="radio"]').getAttribute("data-testid")));
const marked = async (page) => {
  await page.waitForSelector('[data-testid="mark-list"]', { timeout: T });
  await page.waitForTimeout(400);
};
/** Every answer button and the picker sit in view, above the sealbar's top or inside it. */
async function pickerFits(page, name) {
  const r = await page.evaluate(() => {
    const pop = document.querySelector(".u1-pop");
    pop.scrollTop = 0;
    const pb = pop.getBoundingClientRect();
    const bar = document.querySelector(".u1-sealbar").getBoundingClientRect();
    const limit = Math.min(window.innerHeight, bar.top);
    const answers = [...pop.querySelectorAll('.u1-opt[role="radio"], .u1-typed-in')];
    const felt = [...pop.querySelectorAll('.felt-opt[role="radio"]')];
    const hidden = answers.filter((e) => e.getBoundingClientRect().bottom > limit + 0.5 || e.getBoundingClientRect().top < pb.top - 0.5);
    const feltHidden = felt.filter((e) => e.getBoundingClientRect().bottom > window.innerHeight);
    const feltCovered = felt.filter((b) => {
      const q = b.getBoundingClientRect();
      const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return !at || !(at === b || b.contains(at));
    });
    return { answers: answers.length, hidden: hidden.map((e) => (e.textContent || e.id).trim().slice(0, 24)), feltHidden: feltHidden.length, feltCovered: feltCovered.length, bar: Math.round(bar.height), viewport: `${window.innerWidth}x${window.innerHeight}` };
  });
  return { ...r, ok: r.feltHidden === 0 && r.feltCovered === 0, name };
}

async function main() {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    // ---- with the tap, all sizes and themes
    for (const [width, height, theme] of [[1920, 1080, "light"], [1366, 768, "light"], [1366, 768, "dark"], [390, 844, "light"], [390, 844, "dark"]]) {
      const name = `${width}x${height} ${theme}`;
      const page = await newPage(browser, { width, height, theme });
      await toQuiz(page);
      const checked = await page.locator('.felt-opt[aria-checked="true"]').count();
      check(checked === 0, `nothing is preselected ${name}`);
      const fit = await pickerFits(page, name);
      check(fit.ok, `the picker is in view and clickable ${name}: ${JSON.stringify(fit)}`);
      say(`answers hidden behind the taller seal bar ${name}: ${fit.hidden.length} of ${fit.answers} (seal bar ${fit.bar} px)`);
      if (width >= 1366) check(fit.hidden.length === 0, `every answer visible without scrolling ${name}: ${JSON.stringify(fit.hidden)}`);
      await axe(page, `quiz ${name}`);
      await overlap(page, `quiz ${name}`, '[data-testid="u1-pop"]');
      if (width === 390) await overflow(page, `quiz ${name}`);
      await page.locator('[data-testid="felt-pick"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outDir}/${width}-${theme}-1-quiz.png` });

      await page.tap('[data-testid="felt-sure"]');
      check((await page.locator('[data-testid="felt-sure"]').getAttribute("aria-checked")) === "true", `the tap selects ${name}`);
      await axe(page, `quiz with the tap selected ${name}`);
      await page.screenshot({ path: `${outDir}/${width}-${theme}-1b-tapped.png` });
      await page.tap('[data-testid="u1-seal"]');
      await marked(page);
      const line = await page.textContent('[data-testid="felt-round"]');
      check(/^You said 'sure'\. None of your answers could be checked\.$|^You said 'sure' and matched \d+ of \d+\./.test(line), `the verdict's line ${name}: ${line}`);
      check((await page.locator('[data-testid="felt-record"]').count()) === 1, `the record is on the verdict ${name}`);
      await axe(page, `marked ${name}`);
      await overlap(page, `marked ${name}`, '[data-testid="mark-list"]');
      if (width === 390) await overflow(page, `marked ${name}`);
      await page.screenshot({ path: `${outDir}/${width}-${theme}-2-marked.png` });
      await page.locator('[data-testid="felt-record"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${outDir}/${width}-${theme}-3-record.png` });
      await page.context().close();
    }

    // ---- clicks, paste to verdict (the paste itself is a keystroke; only clicks count, as in U1)
    {
      const page = await newPage(browser);
      await toQuiz(page);
      const opts = await firstOptions(page);
      say(`questions in this quiz: ${opts.length}`);
      page.clicks = 1; // the toggle
      for (const o of opts.slice(0, 3)) await page.tap(`[data-testid="${o}"]`);
      await page.tap('[data-testid="felt-think-so"]');
      await page.tap('[data-testid="u1-seal"]');
      await marked(page);
      say(`clicks, 3 answers + the tap: ${page.clicks}`);
      check(page.clicks <= 6, `paste to verdict stays at 6 clicks or fewer with 3 answers and the tap: ${page.clicks}`);
      const line = await page.textContent('[data-testid="felt-round"]');
      say(`line: ${line}`);
      // The proof card shows what was sealed.
      await page.locator('[data-testid="u1-proof"]').click();
      await page.waitForSelector('[data-testid="pc-how-sure"]', { timeout: T });
      check(/said 'think so'/.test(await page.textContent('[data-testid="pc-how-sure"]')), "the proof card shows the sealed tap");
      await page.screenshot({ path: `${outDir}/proof-card-how-sure.png` });
      await page.context().close();
    }
    {
      const page = await newPage(browser);
      await toQuiz(page);
      page.clicks = 1;
      const opts = await firstOptions(page);
      for (const o of opts) await page.tap(`[data-testid="${o}"]`);
      await page.tap('[data-testid="u1-seal"]');
      await marked(page);
      say(`clicks, every answer and no tap: ${page.clicks}`);
      check(page.clicks <= 6, `no tap: every answer stays at 6 clicks or fewer: ${page.clicks}`);
      check((await page.locator('[data-testid="felt-round"]').count()) === 0, "no tap: the verdict has no 'You said' line");
      const rec = await page.textContent('[data-testid="felt-record"]');
      check(/You have not said how sure you were on any round yet\.|on no rounds/.test(rec), `no tap: the record says so: ${rec.slice(0, 120)}`);
      await page.context().close();
    }
    {
      const page = await newPage(browser);
      await toQuiz(page);
      page.clicks = 1;
      const opts = await firstOptions(page);
      for (const o of opts) await page.tap(`[data-testid="${o}"]`);
      await page.tap('[data-testid="felt-guess"]');
      await page.tap('[data-testid="u1-seal"]');
      await marked(page);
      say(`clicks, every answer and the tap (the most a person can do on this quiz): ${page.clicks}`);
      await page.context().close();
    }
    {
      const page = await newPage(browser);
      await toQuiz(page);
      page.clicks = 1;
      await page.tap('[data-testid="u1-seal"]');
      await marked(page);
      say(`clicks, the fewest possible (toggle + seal): ${page.clicks}`);
      await page.context().close();
    }

    // ---- the comparison line appears from real rounds, in one browser (the same person)
    {
      const page = await newPage(browser, { width: 1366, height: 768 });
      await toQuiz(page);
      let rounds = 0;
      const answerAll = async () => {
        for (const o of await firstOptions(page)) await page.locator(`[data-testid="${o}"]`).click();
      };
      await answerAll();
      await page.locator('[data-testid="u1-seal"]').click();
      await marked(page);
      rounds++;
      const first = await page.textContent('[data-testid="felt-paths-note"]');
      say(`after round 1: ${first.slice(0, 200)}`);
      check((await page.locator('[data-testid="felt-paths"]').count()) === 0, "under 3 answers on a side: the comparison stays hidden, with the note");
      await page.screenshot({ path: `${outDir}/record-hidden.png` });
      await page.context().close();
      say(`rounds in this check: ${rounds}. The line itself, with real counts, is checked in tests/unit/x4-felt.test.ts.`);
    }
  } finally {
    await browser.close();
  }
  say(`\nTotals: axe ${counts.axe} runs, ${counts.axeViolations} violations · overlap ${counts.overlap} runs, ${counts.overlapHits} hits · 390 px sideways-scroll checks ${counts.wide}, ${counts.wideFails} failed`);
  say(failures.length ? `FAILED ${failures.length}:\n${failures.join("\n")}` : "ALL PASS");
  writeFileSync(`${outDir}/browser-output.txt`, `${out.join("\n")}\n`);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  writeFileSync(`${outDir}/browser-output.txt`, `${out.join("\n")}\nCRASH ${e.stack}\n`);
  process.exit(2);
});
