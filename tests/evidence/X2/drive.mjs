// X2 browser click-through of the code explorer, in headless Chromium, against the RUNNING app (tests/evidence/X2/
// mock-server.ts + Vite, every model mocked, $0) or, with X2_LIVE=1, against a server with real models.
// The flow: Explore a codebase → outline damli40/atlas server/meta at 058ab2a (a real outline job: intake, code map in
// its own process, plain-code checks) → the machine → pick "Secret redaction" → its card → "Bet on redactSecret" →
// the paste flow with the file and the function picked → Muse Wonder's tests → use test 1 → bet → run → verdict.
// Checks on every screen: axe-core (WCAG 2 A/AA + best practice), the D07-04 text-overlap check, no horizontal scroll
// at 390 px, no running animation under reduced motion. Film shots at 1920×1080 in both themes. Exits 1 on a failure.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> node tests/evidence/X2/drive.mjs <chromium headless shell> <out dir>
import { writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:5184/";
const REF = process.env.X2_REF ?? "058ab2a29634dc0b8c092fe7816a6fd57ce9b74c";
const LIVE = process.env.X2_LIVE === "1";
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
const results = { axe: {}, overflow: {}, motion: {}, overlap: {}, errors: [], timings: {} };

async function newPage(width = 1920, height = 1080, theme = "light") {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: theme });
  page.on("pageerror", (e) => results.errors.push(e.message));
  // A 422 is the gate refusing a test on purpose (the refused-test step); the browser logs it as a failed resource.
  page.on("console", (m) => m.type() === "error" && !/status of 422/.test(m.text()) && results.errors.push(`console: ${m.text()}`));
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


const S = { form: 'section[aria-label="choose a codebase"]', card: '[data-testid="part-card"]', lists: '[data-testid="chalk-list"]', machine: '[data-testid="explorer-machine"]' };

async function outlineLive(page) {
  await page.goto(URL0);
  await page.getByTestId("mode-explore").click();
  await page.getByTestId("outline-ref").fill(REF);
  const t0 = Date.now();
  await page.getByTestId("outline-start").click();
  await page.getByTestId("explorer-machine").waitFor({ timeout: LIVE ? 300000 : 90000 });
  results.timings.outline = Date.now() - t0;
  say(`outline job to drawn machine: ${(results.timings.outline / 1000).toFixed(1)} s`);
  say("progress:", flat(await page.getByTestId("outline-progress").innerText()));
}
async function pick(page, name) {
  const stage = page.getByTestId("explorer-stage");
  await stage.focus();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("ArrowRight");
    if ((await page.locator(`${S.card} h3`).count()) && (await page.locator(`${S.card} h3`).innerText()) === name) return;
  }
  throw new Error(`could not pick ${name}`);
}
const shotMachine = async (page, path) => {
  await page.locator(S.machine).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('[data-testid="explorer"]').scrollIntoView({ block: "start" }));
  await page.screenshot({ path });
};

// ---------- 1. the whole flow at 1920×1080, light then dark ----------
for (const theme of ["light", "dark"]) {
  say(`=== explorer at 1920×1080 (${theme})`);
  const page = await newPage(1920, 1080, theme);
  await outlineLive(page);
  await overlap(page, `form-${theme}`, S.form);
  await shotMachine(page, `${outDir}/film-rest-1920-${theme}.png`);
  const drawn = await page.locator('[data-testid="explorer-stage"] .it[data-line]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-line")))].sort());
  const chalk = await page.locator("[data-chalk]").evaluateAll((els) => els.map((e) => e.getAttribute("data-chalk")));
  say(`drawn lines: ${drawn.length}; chalk tags: ${chalk.length}`);
  check(chalk.every((c) => !drawn.includes(c)), "no Wonder-only join is drawn as a line");
  await axe(page, `explorer-rest-${theme}`);
  await motion(page, `explorer-rest-${theme}`);
  await pick(page, "Secret redaction");
  await page.waitForTimeout(200);
  check((await page.locator(S.machine).getAttribute("data-picked")) === "secret-redaction", "picking a box marks it on the machine");
  const faded = await page.locator('[data-testid="explorer-stage"] .it[data-line]:not(.on)').first().evaluate((e) => getComputedStyle(e).opacity);
  check(Number(faded) < 0.3, `unrelated lines fade when a part is picked (opacity ${faded})`);
  await shotMachine(page, `${outDir}/film-selected-1920-${theme}.png`);
  await page.locator(S.card).screenshot({ path: `${outDir}/card-1920-${theme}.png` });
  await overlap(page, `card-${theme}`, S.card);
  await overlap(page, `lists-${theme}`, S.lists);
  await axe(page, `explorer-picked-${theme}`);
  say("card:", flat(await page.locator(S.card).innerText()).slice(0, 400));
  check(/lines confirmed/i.test(await page.locator(S.card).innerText()) && !/purpose (is )?confirmed/i.test(await page.locator(S.card).innerText()), "the card says lines confirmed, never purpose confirmed");
  check(/muse-wonder-1\.0 says what this part is for/.test(await page.locator(S.card).innerText()), "the purpose is labelled as Muse Wonder's words");
  check(/at commit 058ab2a/.test(await page.locator(S.card).innerText()), "the card shows the commit");
  if (theme === "dark") {
    await page.close();
    continue;
  }
  // ---------- 2. Bet on this part → the paste flow → a verdict ----------
  await page.getByTestId("bet-redactSecret").click();
  await page.getByTestId("paste-read-result").waitFor({ timeout: 30000 });
  await page.getByTestId("export-redactSecret").waitFor();
  check(await page.getByTestId("export-redactSecret").isChecked(), "the paste flow opens with redactSecret picked");
  say("hand-off:", flat(await page.getByTestId("paste-from-explorer").innerText()));
  await page.evaluate(() => document.querySelector('section[aria-label="paste"]').scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${outDir}/film-handoff-1920-light.png` });
  await axe(page, "handoff");
  await page.getByTestId("ask-wonder").click();
  await page.getByTestId("proposals").waitFor({ timeout: LIVE ? 180000 : 30000 });
  say("proposal 1:", flat(await page.getByTestId("proposal-0").innerText()).slice(0, 300));
  await page.getByTestId("use-0").click();
  await page.getByTestId("bet-outcome").waitFor();
  await page.getByTestId("bet-outcome").selectOption("returned");
  if (await page.getByTestId("bet-returnedJson").count()) await page.getByTestId("bet-returnedJson").fill(process.env.X2_BET_JSON ?? '"Invalid API key [redacted]... refused"');
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: LIVE ? 180000 : 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 120000 });
  await page.evaluate(() => document.querySelector('section[aria-label="verdicts"]').scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${outDir}/film-verdict-1920-light.png` });
  say("run facts:", flat(await page.getByTestId("paste-run-facts").innerText()).slice(0, 300));
  say("verdicts:", flat(await page.locator('section[aria-label="verdicts"] table').innerText()).slice(0, 600));
  await axe(page, "verdict");
  await page.close();
}

// ---------- 3. 390 px (the saved outline, no model call) and the not-drawn state ----------
for (const theme of ["light", "dark"]) {
  say(`=== explorer at 390 px (${theme})`);
  const page = await newPage(390, 844, theme);
  await page.goto(URL0);
  await page.getByTestId("mode-explore").click();
  await page.getByTestId("outline-saved").click();
  await page.getByTestId("explorer-machine").waitFor();
  await overflow(page, `explorer-saved-${theme}`);
  await pick(page, "Secret redaction");
  await overflow(page, `explorer-picked-${theme}`);
  await overlap(page, `card-390-${theme}`, S.card);
  await page.screenshot({ path: `${outDir}/phone-390-${theme}.png`, fullPage: true });
  await axe(page, `explorer-390-${theme}`);
  await motion(page, `explorer-390-${theme}`);
  await page.close();
}

writeFileSync(`${outDir}/checks.json`, JSON.stringify(results, null, 1));
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
check(results.errors.length === 0, `no page errors (${results.errors.join("; ")})`);
await browser.close();
say(failures.length ? `FAILED: ${failures.length} checks` : "all checks passed");
process.exit(failures.length ? 1 : 0);
