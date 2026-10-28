// E3 browser click-through of the whole paste flow, in headless Chromium, against the RUNNING app
// (tests/evidence/E3/mock-server.ts + Vite): real gate, real sandbox, real judge, real seals, real proof card;
// every model answer mocked ($0).
// The flow: paste → pick the export → Muse Wonder's proposals (one refused by the gate) → use test 1 → bet →
// run → verdict → call timeline → proof card. Then two more rounds: a person's own test from the form, and a
// file that imports a package (the whole run is "can't check", shown plainly).
// For each new screen: a PNG at 1920 and at 390 px wide, axe-core (WCAG 2 A/AA + best practice), the text-overlap
// check (from D07-04), no horizontal scroll at 390 px, and no running animation under reduced motion.
// The script exits 1 if any check fails, so it is a test, not only a picture maker.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core dir> AXE=<axe.min.js> node drive.mjs <chromium headless shell> <out dir>
import { writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:5183/";
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

const SECTIONS = {
  paste: 'section[aria-label="paste"]',
  pick: 'section[aria-label="pick a function"]',
  choose: 'section[aria-label="choose a test"]',
  bet: 'section[aria-label="bet"]',
  run: 'section[aria-label="run"]',
  verdict: 'section[aria-label="verdicts"]',
};

/** Plays the example round in a page of the given size; returns the run id. Shoots each section after it fills. */
async function exampleRound(page, tag, shoot) {
  await page.goto(URL0);
  await page.getByTestId("mode-paste").click();
  await page.getByTestId("paste-example").click();
  await page.getByTestId("paste-read").click();
  await page.getByTestId("paste-read-result").waitFor();
  await shoot("paste", SECTIONS.paste);
  await page.getByTestId("export-retryWithBackoff").check();
  await shoot("pick", SECTIONS.pick);
  await page.getByTestId("ask-wonder").click();
  await page.getByTestId("proposals").waitFor({ timeout: 30000 });
  await shoot("proposals", SECTIONS.choose);
  if (tag === "1920") {
    say("proposal 1:", flat(await page.getByTestId("proposal-0").innerText()));
    say("proposal 2:", flat(await page.getByTestId("proposal-1").innerText()));
    check((await page.getByTestId("proposal-1").getAttribute("data-allowed")) === "no", "the refused proposal is shown as refused");
    check((await page.getByTestId("refused-1").count()) === 1 && (await page.locator('[data-testid="proposal-1"] button').count()) === 0, "the refused proposal has no button to run it");
    check((await page.getByTestId("wonder-claim").count()) === 0, "Muse Wonder's claim is not on screen before the bets are sealed");
  }
  await page.getByTestId("use-0").click();
  await page.getByTestId("bet-outcome").waitFor();
  await page.getByTestId("seen-context").locator("summary").click();
  if (tag === "1920") {
    const seen = await page.locator(".seen-text").innerText();
    check(seen.includes("What will run: Atlas calls retryWithBackoff(fetchIt, 3, 100).") && !/give up right after/.test(seen), "the bet screen's 'what every bettor sees' holds the plain-code call and no claim");
  }
  await page.getByTestId("bet-outcome").selectOption("returned");
  await page.getByTestId("bet-returnedJson").fill('{"ok": true}');
  await page.getByTestId("bet-calls:fetchIt").fill("3");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  check((await page.getByTestId("wonder-claim").count()) === 0, `Muse Wonder's claim is still hidden after the person's seal (${tag})`);
  await shoot("bet", SECTIONS.bet);
  await page.getByTestId("run").click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
  // E3 review B2: the claim appears once every bet is frozen (the run started).
  await page.getByTestId("wonder-claim").waitFor();
  await page.getByTestId("call-timeline").waitFor();
  await shoot("run", SECTIONS.run);
  await shoot("verdict", SECTIONS.verdict);
  const runId = (await page.getByTestId("proof-link").getAttribute("href")).replace("?proof=", "");
  if (tag === "1920") {
    say("run facts:", flat(await page.getByTestId("paste-run-facts").innerText()));
    say("timeline readout:", flat(await page.locator('.ct [data-readout]').innerText()));
    say("verdicts:", flat(await page.locator(SECTIONS.verdict + " table").innerText()));
    check((await page.getByTestId("verdict-you-outcome").getAttribute("data-outcome")) === "matched", "your outcome bet: matched");
    check((await page.getByTestId("verdict-you-calls:fetchIt").getAttribute("data-outcome")) === "not_matched", "your call-count bet: didn't match");
    check((await page.getByTestId("seal-check-returnedJson").getAttribute("data-match")) === "yes", "the page re-hashed the JSON bet and it is the answer you typed");
  }
  return runId;
}

// ---------- 1. the example round at 1920 (light) and at 390 (dark) ----------
for (const [w, h, tag, theme] of [[1920, 1080, "1920", "light"], [390, 844, "390", "dark"]]) {
  say(`=== the example round at ${tag} px (${theme})`);
  const page = await newPage(w, h, theme);
  const shoot = async (name, sel) => {
    await page.locator(sel).screenshot({ path: `${outDir}/${name}-${tag}.png` });
    await overlap(page, `${name}-${tag}`, sel);
  };
  const runId = await exampleRound(page, tag, shoot);
  await page.screenshot({ path: `${outDir}/full-round-${tag}.png`, fullPage: true });
  await axe(page, `round-${tag}`);
  await motion(page, `round-${tag}`);
  if (tag === "390") await overflow(page, "round");
  // the proof card
  await page.goto(`${URL0}?proof=${runId}`);
  await page.getByTestId("proof-card").waitFor();
  await page.getByTestId("pc-rerun").click();
  await page.getByTestId("pc-replay").waitFor({ timeout: 60000 });
  if (tag === "1920") say("proof card replay:", flat(await page.getByTestId("pc-replay").innerText()));
  await page.screenshot({ path: `${outDir}/proof-card-${tag}.png`, fullPage: true });
  await overlap(page, `proof-card-${tag}`, '[data-testid="proof-card"]');
  await axe(page, `proof-card-${tag}`);
  if (tag === "390") await overflow(page, "proof-card");
  await page.close();
}

// ---------- 2. the person's own test, from the form ----------
say("=== a test written by the person");
{
  const page = await newPage();
  await page.goto(URL0);
  await page.getByTestId("mode-paste").click();
  await page.getByTestId("paste-example").click();
  await page.getByTestId("paste-read").click();
  await page.getByTestId("export-retryWithBackoff").check();
  await page.getByTestId("write-own").click();
  await page.getByRole("button", { name: "Add a stand-in function" }).click();
  // call 1 throws, call 2 never answers
  await page.locator('[data-testid="arg-0"] select').first().selectOption("throw");
  await page.getByRole("button", { name: "Add a call" }).click();
  await page.locator('[data-testid="arg-0"] select').nth(1).selectOption("never_settle");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.locator('[data-testid="arg-1"] input').fill("2");
  await page.getByTestId("test-form").screenshot({ path: `${outDir}/own-test-form-1920.png` });
  await axe(page, "own-test-form");
  await page.getByTestId("form-submit").click();
  await page.getByTestId("bet-outcome").waitFor();
  await page.getByTestId("bet-outcome").selectOption("never_settled");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("call-timeline").waitFor({ timeout: 60000 });
  say("own test, timeline readout:", flat(await page.locator('.ct [data-readout]').innerText()));
  check((await page.getByTestId("verdict-you-outcome").getAttribute("data-outcome")) === "matched", "own test: never_settled bet matched");
  await page.locator(SECTIONS.run).screenshot({ path: `${outDir}/own-test-run-1920.png` });
  await overlap(page, "own-test-run-1920", SECTIONS.run);
  // a refused own test: a never-answering step on a plain (not async) stand-in
  await page.getByTestId("paste-restart").click();
  await page.getByTestId("paste-read").click();
  await page.getByTestId("export-retryWithBackoff").check();
  await page.getByTestId("write-own").click();
  await page.getByRole("button", { name: "Add a stand-in function" }).click();
  await page.locator('[data-testid="arg-0"] select').first().selectOption("never_settle");
  await page.locator('[data-testid="arg-0"] input[type="checkbox"]').uncheck();
  await page.getByTestId("form-submit").click();
  await page.getByTestId("own-test-refused").waitFor();
  say("own test refused:", flat(await page.getByTestId("own-test-refused").innerText()));
  check((await page.getByTestId("run").count()) === 0, "a refused own test gives no Run button");
  await page.locator(SECTIONS.choose).screenshot({ path: `${outDir}/own-test-refused-1920.png` });
  await axe(page, "own-test-refused");
  await page.close();
}

// ---------- 3. a file that imports a package: the whole run is "can't check" ----------
say("=== can't check: the code imports a package");
for (const [w, h, tag] of [[1920, 1080, "1920"], [390, 844, "390"]]) {
  const page = await newPage(w, h);
  await page.goto(URL0);
  await page.getByTestId("mode-paste").click();
  await page.getByTestId("paste-code").fill('import axios from "axios";\n\nexport async function getUser(id: string) {\n  const r = await axios.get(`/users/${id}`);\n  return r.data;\n}\n');
  await page.getByTestId("paste-read").click();
  await page.getByTestId("paste-cant-check").waitFor();
  if (tag === "1920") say("early can't check:", flat(await page.getByTestId("paste-cant-check").innerText()));
  await page.getByTestId("export-getUser").check();
  await page.getByTestId("write-own").click();
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.locator('[data-testid="arg-0"] input').fill('"42"');
  await page.getByTestId("form-submit").click();
  await page.getByTestId("bet-outcome").selectOption("returned");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("paste-cant-check-run").waitFor({ timeout: 60000 });
  const text = flat(await page.getByTestId("paste-cant-check-run").innerText());
  if (tag === "1920") say("run can't check:", text);
  check(/^Can't check: the code needs axios; Atlas runs one pasted file on its own, with no packages or other modules\.$/.test(text), `can't check reason shown plainly (${tag})`);
  check((await page.getByTestId("call-timeline-cant-check").count()) === 1 && (await page.locator(".ct svg").count()) === 0, `the timeline draws nothing on a can't-check run (${tag})`);
  check((await page.getByTestId("verdict-you-outcome").getAttribute("data-outcome")) === "cant_check", `the bet is can't check, never 'threw' (${tag})`);
  await page.locator(SECTIONS.run).screenshot({ path: `${outDir}/cant-check-run-${tag}.png` });
  await overlap(page, `cant-check-run-${tag}`, SECTIONS.run);
  await axe(page, `cant-check-${tag}`);
  if (tag === "390") await overflow(page, "cant-check");
  await page.close();
}

// ---------- 4. a Python round (E2's runner, registered in E3 review round 2) ----------
say("=== a Python round");
for (const [w, h, tag] of [[1920, 1080, "1920"], [390, 844, "390"]]) {
  const page = await newPage(w, h);
  await page.goto(URL0);
  await page.getByTestId("mode-paste").click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="paste-lang"] option')].some((o) => o.textContent === "Python"), null, { timeout: 10000 }).catch(() => {});
  check(!(await page.getByTestId("paste-lang").textContent()).includes("(coming)"), `Python is offered, not "coming" (${tag})`);
  await page.getByTestId("paste-code").fill("def add(a, b):\n    return a + b\n");
  await page.getByTestId("paste-read").click();
  await page.getByTestId("paste-read-result").waitFor();
  if (tag === "1920") say("python read:", flat(await page.getByTestId("paste-read-result").innerText()));
  await page.getByTestId("export-add").check();
  await page.getByTestId("write-own").click();
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.locator('[data-testid="arg-0"] input').fill("1");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.locator('[data-testid="arg-1"] input').fill("2");
  await page.getByTestId("form-submit").click();
  await page.getByTestId("bet-returnedJson").waitFor();
  check(((await page.locator(".seen-text").textContent()) ?? "").startsWith("Code: one pasted Python file"), `the bettor text says Python (${tag})`);
  await page.getByTestId("bet-returnedJson").fill("3");
  await page.getByTestId("seal").click();
  await page.getByTestId("hash-returnedJson").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="model-slot"]')].every((e) => e.getAttribute("data-status") !== "thinking"), null, { timeout: 60000 });
  await page.getByTestId("run").click();
  await page.getByTestId("seal-check-returnedJson").waitFor({ timeout: 90000 });
  check((await page.getByTestId("verdict-you-returnedJson").getAttribute("data-outcome")) === "matched", `Python add(1, 2): the bet 3 matched (${tag})`);
  if (tag === "1920") say("python facts:", flat(await page.getByTestId("paste-run-facts").innerText()));
  await page.locator(SECTIONS.run).screenshot({ path: `${outDir}/python-run-${tag}.png` });
  await overlap(page, `python-run-${tag}`, SECTIONS.run);
  await axe(page, `python-${tag}`);
  if (tag === "390") await overflow(page, "python");
  await page.close();
}

check(results.errors.length === 0, `page errors: ${results.errors.length}${results.errors.length ? ` (${results.errors.slice(0, 3).join(" | ")})` : ""}`);
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
writeFileSync(`${outDir}/checks.json`, JSON.stringify(results, null, 2) + "\n");
await browser.close();
say(failures.length ? `${failures.length} checks FAILED` : "all checks passed");
process.exit(failures.length ? 1 : 0);
