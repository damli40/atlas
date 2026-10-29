// X3 browser click-through, in headless Chromium, against the RUNNING app (tests/evidence/X3/mock-server.ts + Vite,
// every model mocked, $0). The flow at 1920×1080 (light):
//   Explore → upload retry.ts → pick "Retry helper" → its card shows the failure labels ("found in this code")
//   → "Bet on retryWithBackoff" → the paste flow: "Your track record" (empty), the labels card
//   → Wonder's tests → round 1 (fetchIt fails once, then answers) → the panel shows the record by question type
//   → start again → Wonder's tests again: the page says what Wonder was told (the weak spots, counts only)
//   → round 2 (fetchIt never answers) → the label "no overall timeout" flips to "reproduced", linked to the proof card
//   → back to the explorer: the part's card says "reproduced" too → click the link → the proof card and
//     "Your record before this round".
// Then 390 px (dark): one round in the paste flow, the panel and labels, no horizontal scroll.
// Checks on every screen: axe-core (WCAG 2 A/AA + best practice), the D07-04 text-overlap check on the new sections,
// no horizontal scroll at 390 px, no running animation under reduced motion. Exits 1 on any failed check.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> node tests/evidence/X3/drive.mjs <chromium headless shell> <out dir>
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


const S = {
  track: '[data-testid="track-record"]',
  labels: '[data-testid="paste-failure-labels"]',
  card: '[data-testid="part-card"]',
};
const nt = (scope) => `${scope} [data-failure="no-overall-timeout"]`;

async function pickRetryPart(page) {
  await page.mouse.move(2, 2);
  const stage = page.getByTestId("explorer-stage");
  await stage.focus();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("ArrowRight");
    if (await page.getByTestId("bet-retryWithBackoff").count()) return;
  }
  throw new Error("no part offers retryWithBackoff");
}
/** Uses Wonder test `i`, bets, seals, runs and waits for the verdicts. */
async function round(page, i, bets, afterSeal) {
  await page.getByTestId("ask-wonder").click();
  await page.getByTestId("proposals").waitFor({ timeout: 30000 });
  await page.getByTestId(`use-${i}`).click();
  await page.getByTestId("bet-outcome").waitFor();
  for (const [m, v] of Object.entries(bets)) {
    const el = page.getByTestId(`bet-${m}`);
    if (m === "outcome") await el.selectOption(v);
    else await el.fill(String(v));
  }
  check((await page.locator(S.labels).count()) === 0, "review M2: no failure labels on the paste screen while the bets are not sealed");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  if (afterSeal) await afterSeal();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 120000 });
}
const labelOf = (page, scope) => page.locator(nt(scope)).getAttribute("data-label");

// ---------- 1. the whole flow at 1920×1080, light ----------
{
  say("=== explore → bet → two rounds → reproduced → proof card (1920×1080, light)");
  const page = await newPage(1920, 1080, "light");
  await page.goto(URL0);
  await page.getByTestId("mode-explore").click();
  await page.getByTestId("outline-files").setInputFiles({ name: "retry.ts", mimeType: "text/plain", buffer: Buffer.from(EXAMPLE) });
  await page.getByTestId("outline-upload").click();
  await page.locator('[data-testid="explorer-stage"] svg').waitFor({ timeout: 90000 });
  await pickRetryPart(page);
  await page.locator(`${S.card} [data-testid="part-retry-labels"]`).waitFor({ timeout: 30000 });
  check((await labelOf(page, S.card)) === "found in this code", "explorer card: 'no overall timeout' is found in this code before any run");
  const cardText = await page.locator(S.card).innerText();
  check(/Muse Wonder \(muse-wonder-1\.0\) tagged this part "retry"/.test(cardText), "explorer card names Wonder's tag as Wonder's");
  await page.locator(S.card).screenshot({ path: `${outDir}/explorer-card-found-1920.png` });
  await overlap(page, "explorer-card-found", S.card);
  await axe(page, "explorer-card-found");

  await page.getByTestId("bet-retryWithBackoff").click();
  await page.getByTestId("export-retryWithBackoff").waitFor({ timeout: 30000 });
  await page.getByTestId("labels-after-seal").waitFor({ timeout: 30000 });
  check((await page.locator(S.labels).count()) === 0, "review M2: paste screen shows no labels before a round's bets are sealed, only the note");
  check(/No judged bets yet/.test(await page.locator(S.track).innerText()), "paste screen: the panel starts empty");
  await overlap(page, "track-empty", S.track);
  await axe(page, "paste-before");

  // Round 1: fetchIt fails once, then answers. The person bets "threw", 500 ms, 2 calls. Labels appear after the seal.
  await round(page, 0, { outcome: "threw", virtualMs: 500, "calls:fetchIt": 2 }, async () => {
    await page.locator(S.labels).waitFor({ timeout: 30000 });
    check((await labelOf(page, S.labels)) === "found in this code", "paste screen, after the seal: 'no overall timeout' found in this code");
    check((await page.locator(`${S.labels} [data-failure="rate-limit"]`).count()) === 0 && (await page.locator(`${S.labels} [data-failure="retry-storm"]`).getAttribute("data-label")) === "common pattern", "review M1: the default example shows no rate limit claim and retry storm only as a common pattern");
    await page.locator(`${S.labels} [data-testid="fl-lines-no-overall-timeout"]`).click();
    check(await page.evaluate(() => document.querySelector("#paste-retry-no-overall-timeout-lines")?.matches(":target") ?? false), "the 'found in this code' link goes to its lines");
    await page.locator(S.labels).screenshot({ path: `${outDir}/paste-labels-found-1920.png` });
    await overlap(page, "paste-labels-found", S.labels);
    await axe(page, "paste-labels-after-seal");
  });
  await page.locator(`${S.track} [data-type="timing"]`).waitFor({ timeout: 30000 });
  const panel1 = flat(await page.locator(S.track).innerText());
  say("panel after round 1:", panel1);
  check(/Outcome: matched 0 of 1 · didn't match 1 · can't check 0 \(n = 1\)/.test(panel1) && /Timing: matched 0 of 1 · didn't match 1/.test(panel1) && /Call counts: matched 1 of 1/.test(panel1), "the panel shows the record by question type with n");
  check(!/\b(learn|teach|score|skill|right|wrong)/i.test(panel1), "the panel never says learn, teach, score, skill, right or wrong");
  await page.locator(S.track).screenshot({ path: `${outDir}/track-panel-1920.png` });
  await overlap(page, "track-panel", S.track);
  await axe(page, "after-round-1");

  // Round 2: start again, ask Wonder again: the page says what Wonder was told.
  await page.getByTestId("paste-restart").click();
  await page.getByTestId("paste-read").click();
  await page.getByTestId("export-retryWithBackoff").waitFor();
  await page.getByTestId("ask-wonder").click();
  await page.getByTestId("wonder-aimed").waitFor({ timeout: 30000 });
  const aimed = flat(await page.getByTestId("wonder-aimed").innerText());
  say("Wonder was told:", aimed);
  check(/outcome \(1 of 1 didn't match\)/.test(aimed) && /timing \(1 of 1 didn't match; guessed lower than the run 0, higher 1\)/.test(aimed) && !/retryWithBackoff|fetchIt/.test(aimed), "Wonder's weak-spot note: types and counts only, no code");
  await page.getByTestId("proposals").screenshot({ path: `${outDir}/wonder-aimed-1920.png` });
  await page.getByTestId("use-1").click();
  await page.getByTestId("bet-outcome").waitFor();
  await page.getByTestId("bet-outcome").selectOption("threw");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 120000 });
  say("round 2 facts:", flat(await page.getByTestId("paste-run-facts").innerText()).slice(0, 300));
  await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("data-label") === "reproduced", nt(S.labels), { timeout: 30000 });
  const runId = (await page.locator(`${S.labels} [data-testid="fl-proof-no-overall-timeout"]`).getAttribute("href")).replace("?proof=", "");
  check(/^[A-Za-z0-9_-]{6,}$/.test(runId), `paste screen: 'no overall timeout' flipped to reproduced, linked to run ${runId}`);
  await page.locator(nt(S.labels)).scrollIntoViewIfNeeded();
  await page.locator(S.labels).screenshot({ path: `${outDir}/paste-labels-reproduced-1920.png` });
  await overlap(page, "paste-labels-reproduced", S.labels);
  await axe(page, "after-round-2");
  await motion(page, "after-round-2");

  // Back to the explorer: the same part's card now says reproduced, with the same proof link.
  await page.getByTestId("mode-explore").click();
  await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("data-label") === "reproduced", nt(S.card), { timeout: 30000 });
  const cardLink = await page.locator(`${S.card} [data-testid="fl-proof-no-overall-timeout"]`).getAttribute("href");
  check(cardLink === `?proof=${runId}`, `explorer card: reproduced, linked to the same proof card (${cardLink})`);
  await page.locator(S.card).screenshot({ path: `${outDir}/explorer-card-reproduced-1920.png` });
  await overlap(page, "explorer-card-reproduced", S.card);
  await axe(page, "explorer-card-reproduced");

  // The link opens the proof card, with "Your record before this round" under it.
  await page.locator(`${S.card} [data-testid="fl-proof-no-overall-timeout"]`).click();
  await page.getByTestId("proof-card").waitFor({ timeout: 30000 });
  await page.getByTestId("record-before").waitFor({ timeout: 30000 });
  const before = flat(await page.getByTestId("record-before").innerText());
  say("record before round 2:", before);
  check(/Your record before this round/.test(before) && /Timing: matched 0 of 1/.test(before) && /3 bets from 1 round/.test(before), "the proof card shows the record before this round (round 1 only)");
  await page.screenshot({ path: `${outDir}/proof-card-1920.png`, fullPage: true });
  await page.getByTestId("record-before").screenshot({ path: `${outDir}/record-before-1920.png` });
  await overlap(page, "record-before", '[data-testid="record-before"]');
  await axe(page, "proof-card");
  await page.close();
}

// ---------- 2. 390 px, dark: one round in the paste flow ----------
{
  say("=== paste flow at 390 px (dark)");
  const page = await newPage(390, 844, "dark");
  await page.goto(URL0);
  await page.getByTestId("mode-paste").click();
  await page.getByTestId("paste-example").click();
  await page.getByTestId("paste-read").click();
  await page.getByTestId("labels-after-seal").waitFor({ timeout: 30000 });
  await overflow(page, "paste-before-390");
  await overlap(page, "track-empty-390", S.track);
  await round(page, 1, { outcome: "returned" }, async () => {
    await page.locator(S.labels).waitFor({ timeout: 30000 });
    await overflow(page, "paste-labels-390");
    await overlap(page, "paste-labels-390", S.labels);
  });
  await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute("data-label") === "reproduced", nt(S.labels), { timeout: 30000 });
  await page.locator(`${S.track} [data-type="outcome"]`).waitFor({ timeout: 30000 });
  await overflow(page, "after-round-390");
  await overlap(page, "track-390", S.track);
  await overlap(page, "labels-reproduced-390", S.labels);
  await page.locator(S.track).screenshot({ path: `${outDir}/track-panel-390-dark.png` });
  await page.locator(S.labels).screenshot({ path: `${outDir}/paste-labels-390-dark.png` });
  await axe(page, "paste-390-dark");
  await motion(page, "paste-390-dark");
  const href = await page.locator(`${S.labels} [data-testid="fl-proof-no-overall-timeout"]`).getAttribute("href");
  await page.goto(new URL(href, URL0).toString());
  await page.getByTestId("record-before").waitFor({ timeout: 30000 });
  check(/This was your first judged round on this server/.test(await page.getByTestId("record-before").innerText()), "390 px: a first round's proof card says it was the first");
  await overflow(page, "proof-card-390");
  await page.screenshot({ path: `${outDir}/proof-card-390-dark.png`, fullPage: true });
  await axe(page, "proof-card-390-dark");
  await page.close();
}

writeFileSync(`${outDir}/checks.json`, JSON.stringify(results, null, 1));
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
check(results.errors.length === 0, `no page errors (${results.errors.join("; ")})`);
await browser.close();
say(failures.length ? `FAILED: ${failures.length} checks` : "all checks passed");
process.exit(failures.length ? 1 : 0);
