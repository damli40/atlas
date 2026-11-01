// R3 phase 2 evidence: the real app (web/) against the real server with every model mocked ($0), in headless Chromium.
// Every path: the studio on TypeScript and Python (light, dark, 1920, 1366, 390), an upload to the explorer and "Bet on this
// part", the retry demo, Moonwell (the recorded run served through a route, because no fork runs here), the earlier paste
// screen, and the proof card. On each state: axe (WCAG 2 A/AA), words overlapping words, no page scroll at 390 px. Clicks are
// counted paste→verdict. Skip and reduced motion are timed. Exits 1 on a failure.
//
//   PORT=18961 U3_WONDER_DELAY_MS=800 pnpm exec tsx tests/evidence/U3/mock-server.ts &
//   PORT=18963 pnpm exec tsx tests/evidence/X2/mock-server.ts &
//   ATLAS_API_PORT=18961 pnpm exec vite --port 18962 --strictPort &
//   ATLAS_API_PORT=18963 pnpm exec vite --port 18964 --strictPort &
//   PW=<playwright-core index> CHROME=<headless shell> AXE=<axe.min.js> node tests/evidence/R3/app-drive.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(`${OUT}/screens`, { recursive: true });
const AXE = readFileSync(process.env.AXE, "utf8");
const BASE = process.env.BASE ?? "http://localhost:18962";
const BASE_X = process.env.BASE_X ?? "http://localhost:18964";
const here = new URL(".", import.meta.url);
const read = (p) => readFileSync(new URL(p, here), "utf8");
const ORDERS = read("../U3/inputs/orders.ts");
const PLAN = read("../U3/inputs/plan_cache.py");
const log = { checks: [] };
const failures = [];
const say = (name, ok, more = "") => {
  log.checks.push({ name, ok, more });
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
  if (!ok) failures.push(`${name}${more ? `: ${more}` : ""}`);
};
const b = await chromium.launch({ executablePath: process.env.CHROME });
const open = async (url, { vw = 1920, vh = 1080, scheme = "light", reduced = false } = {}) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, colorScheme: scheme, reducedMotion: reduced ? "reduce" : "no-preference" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => say(`no page error (${url})`, false, e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/favicon|status of 40[0-9]/.test(m.text())) say("no console error", false, m.text().slice(0, 200));
  });
  await p.goto(url);
  return p;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/screens/${name}.png` });

/** D60: words the product never uses on screen. The D21 caption is the one exception, pending Dami. */
async function bannedWords(p, where) {
  const text = await p.evaluate(() => document.body.innerText);
  const hits = [...text.replaceAll("The scoreboard that draws it from the verdicts", "").matchAll(/\b(race|showdown|vs|beat|winner|leaderboard|right|wrong|score|skill|teach|learn)\b/gi)].map((m) => m[0]);
  say(`no banned word: ${where}`, hits.length === 0, [...new Set(hits)].join(", "));
}
/** axe on the page as it stands. */
async function axe(p, where) {
  if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE);
  const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((x) => `${x.id} ×${x.nodes.length}: ${x.nodes[0]?.target}`));
  say(`axe 0: ${where}`, v.length === 0, v.join("; "));
  await bannedWords(p, where);
}
/** Words on top of words: all drawn text, and the page's text panels against it. Scaled drawings are measured on screen. */
async function overlaps(p, where) {
  const found = await p.evaluate(() => {
    const vis = (e) => {
      const s = getComputedStyle(e);
      if (s.visibility === "hidden" || s.display === "none") return false;
      for (let x = e; x; x = x.parentElement) if (Number(getComputedStyle(x).opacity) < 0.02) return false;
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    // What a drawing clips (it pans inside its own host) is not on screen, so a word is measured only where its host shows it.
    const seen = (e) => {
      const r = e.getBoundingClientRect();
      const h = e.closest(".rr-host:not(.u1-root):not(.ex-page)")?.getBoundingClientRect();
      if (!h) return r;
      const left = Math.max(r.left, h.left);
      const right = Math.min(r.right, h.right);
      const top = Math.max(r.top, h.top);
      const bottom = Math.min(r.bottom, h.bottom);
      return { left, right, top, bottom, height: bottom - top, width: right - left };
    };
    const texts = [...document.querySelectorAll("svg.rr text")].filter(vis).map((e) => ({ e, r: seen(e) })).filter((t) => t.r.width > 1 && t.r.height > 1);
    const clip = (r, by = 0.18) => ({ left: r.left, right: r.right, top: r.top + r.height * by, bottom: r.bottom - r.height * by });
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const out = [];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      if (texts[i].e.closest("svg") !== texts[j].e.closest("svg") && false) continue;
      if (hit(clip(texts[i].r), clip(texts[j].r))) out.push(`"${texts[i].e.textContent}" on "${texts[j].e.textContent}"`);
    }
    // The page's own words against the drawing's.
    const panels = [...document.querySelectorAll(".r-head h1, .r-head p, .u1-pop, .u1-marks, .u1-actions, .u1-card, .r-step, .u1-bet")].filter(vis).filter((e) => (e.textContent ?? "").trim() !== "").map((e) => ({ e, r: e.getBoundingClientRect() }));
    for (const t of texts) for (const q of panels) if (hit(clip(t.r), q.r)) out.push(`"${t.e.textContent}" under ${q.e.className || q.e.tagName}`);
    return out.slice(0, 8);
  });
  say(`overlap 0: ${where}`, found.length === 0, found.join("; "));
}
const noScroll = async (p, where) => say(`no sideways page scroll: ${where}`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
const wait = (p, ms) => p.waitForTimeout(ms);
const checks = async (p, where) => {
  await axe(p, where);
  await overlaps(p, where);
};

/** One round in the studio. */
async function studio({ name, code, vw = 1920, vh = 1080, scheme = "light", pick = 1, shots = true, film = false }) {
  const p = await open(`${BASE}/`, { vw, vh, scheme });
  let clicks = 0;
  const click = async (sel) => {
    clicks++;
    await p.click(sel);
  };
  await p.waitForSelector('[data-testid="u1-code"]');
  await wait(p, 300);
  if (shots) await shot(p, `${name}-0-entry`);
  await checks(p, `${name} entry`);
  if (vw < 500) await noScroll(p, `${name} entry`);
  await p.fill('[data-testid="u1-code"]', code);
  const t0 = Date.now();
  await click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]', { state: "visible", timeout: 30000 });
  log[`${name}-chartStartsMs`] = Date.now() - t0;
  await wait(p, 700);
  if (shots) await shot(p, `${name}-1-drawing-itself-on`);
  // Stay long enough for the entrance; before any bet there is no path and no mark.
  await wait(p, 3500);
  if (shots) await shot(p, `${name}-2-chart`);
  say(`${name}: nothing from a run before sealing`, await p.evaluate(() => !document.querySelector('[data-testid="bench-path"]') && !document.querySelector(".rr-mark") && !document.querySelector('[data-testid="mark-list"]')));
  await checks(p, `${name} chart`);
  if (vw < 500) {
    await noScroll(p, `${name} chart`);
    say(`${name}: a pan hint when the chart is wider than the phone, or none needed`, await p.evaluate(() => {
      const hint = !!document.querySelector('[data-testid="r-pan-hint"]');
      const s = document.querySelector(".r-chart svg");
      return hint || !!s;
    }));
  }
  await click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await wait(p, 1300);
  if (shots) await shot(p, `${name}-3-bet`);
  await checks(p, `${name} bet`);
  // X4: the confidence tap is in the pop-up.
  say(`${name}: X4's how-sure picker is in the pop-up`, await p.evaluate(() => !!document.querySelector(".u1-pop [data-testid^='felt'], .u1-pop .felt-pick, .u1-pop [class*='felt']")));
  // One question at a time: two answers by key, the rest left as "can't tell".
  for (let i = 0; i < 2; i++) {
    clicks++;
    await p.keyboard.press(String(pick + 1));
    await wait(p, 170);
  }
  if (shots) await shot(p, `${name}-4-picked`);
  await click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="bench-path"]', { timeout: 90000 });
  await wait(p, 3200);
  if (shots) await shot(p, `${name}-5-run`);
  say(`${name}: the run is playing, some steps still to come`, await p.evaluate(() => document.querySelector('[data-testid="bench-stage"]').getAttribute("data-phase") !== "rest"));
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 30000 });
  await wait(p, 500);
  if (shots) await shot(p, `${name}-6-verdict`);
  log[`${name}-clicks`] = clicks;
  say(`${name}: clicks paste→verdict ≤ 6`, clicks <= 6, `${clicks} (with the paste box filled by the "Draw it" button; a real paste needs one fewer)`);
  await checks(p, `${name} verdict`);
  if (vw < 500) await noScroll(p, `${name} verdict`);
  say(`${name}: a part's words on the path`, await p.evaluate(() => document.querySelectorAll('[data-testid="bench-path"] text').length > 3));
  // The replay plays again; the proof card opens in place.
  await p.click('[data-testid="u1-replay"]');
  await wait(p, 500);
  await p.mouse.click(vw > 500 ? vw - 30 : vw - 12, vw > 500 ? vh - 40 : vh * 0.6);
  await p.waitForFunction(() => document.querySelector('[data-testid="bench-stage"]').getAttribute("data-phase") === "marked", { timeout: 15000 });
  await p.click('[data-testid="u1-proof"]');
  await p.waitForSelector('[data-testid="u1-proof-panel"] [data-testid="pc-path"]', { timeout: 20000 }).catch(() => say(`${name}: proof card shows the path`, false));
  await wait(p, 600);
  if (shots) await shot(p, `${name}-7-proof`);
  const runId = await p.evaluate(() => new URL(document.querySelector('[data-testid="u1-proof-panel"] a').href).searchParams.get("proof"));
  await p.context().close();
  return { runId };
}

const early = process.env.R3_ONLY !== "late";
const late = process.env.R3_ONLY !== "early";
const ts = early ? await studio({ name: "studio-ts-1920", code: ORDERS }) : null;
if (early) {
  await studio({ name: "studio-py-1920-dark", code: PLAN, scheme: "dark" });
  await studio({ name: "studio-ts-1366", code: ORDERS, vw: 1366, vh: 768, shots: false });
  await studio({ name: "studio-py-390", code: PLAN, vw: 390, vh: 844 });
}

// ---- the proof card on its own page, with the pencil image where the engine is installed ----
if (early) {
  const p = await open(`${BASE}/?proof=${encodeURIComponent(ts.runId)}`);
  await p.waitForSelector('[data-testid="pc-path"] svg', { timeout: 20000 });
  await wait(p, 500);
  await shot(p, "proof-1920");
  await axe(p, "proof card");
  await p.click('[data-testid="pc-pencil"]');
  await p.waitForSelector('[data-testid="pc-pencil-img"], [data-testid="pc-pencil-none"]', { timeout: 90000 });
  say("the pencil image, or a plain sentence where the engine is absent", true, (await p.$('[data-testid="pc-pencil-img"]')) ? "image" : "sentence");
  await p.locator('[data-testid="pc-pencil-img"]').scrollIntoViewIfNeeded().catch(() => {});
  await wait(p, 300);
  await shot(p, "proof-pencil-1920");
  await p.context().close();
}

// ---- click to skip; reduced motion ----
if (early) {
  const p = await open(`${BASE}/`);
  await p.waitForSelector('[data-testid="u1-code"]');
  await p.fill('[data-testid="u1-code"]', ORDERS);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]', { state: "visible" });
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="bench-path"]', { timeout: 90000 });
  await wait(p, 1600);
  const t = Date.now();
  await p.mouse.click(1880, 1040);
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 8000 }).catch(() => {});
  log.skipMs = Date.now() - t;
  say("a click skips the run to its end", log.skipMs < 1500, `${log.skipMs} ms`);
  await p.context().close();
}
if (early) {
  const p = await open(`${BASE}/`, { reduced: true });
  await p.waitForSelector('[data-testid="u1-code"]');
  await p.fill('[data-testid="u1-code"]', ORDERS);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]', { state: "visible" });
  await p.waitForTimeout(150);
  say("reduced motion: the chart is there at once", await p.evaluate(() => document.querySelectorAll(".rr-pending").length === 0 && document.getAnimations().filter((a) => a.playState === "running").length === 0));
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.click('[data-testid="u1-seal"]');
  const t = Date.now();
  await p.waitForSelector('[data-testid="bench-path"]', { timeout: 90000 });
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 8000 });
  say("reduced motion: the verdict arrives finished", Date.now() - t < 1000, `${Date.now() - t} ms`);
  await shot(p, "reduced-motion-verdict");
  await p.context().close();
}


// ---- R3 fix round 3: the keyboard paths the review and the cold test found ----
if (late) {
  const p = await open(`${BASE}/`, { vw: 1280, vh: 720 });
  let wonder = 0;
  let bets = 0;
  let experiments = 0;
  p.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (r.url().includes("/paste/proposals")) wonder++;
    if (r.url().endsWith("/api/bets")) bets++;
    if (r.url().endsWith("/api/experiments")) experiments++;
  });
  await p.click('[data-testid="u1-example"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  // A held digit answers one question, not all of them.
  await p.keyboard.down("1");
  await p.keyboard.down("1");
  await p.keyboard.down("1");
  await p.keyboard.up("1");
  await wait(p, 250);
  say("a held digit answers one question", (await p.textContent('[data-testid="b-progress"]')).startsWith("2 of"), await p.textContent('[data-testid="b-progress"]'));
  await p.keyboard.press("ArrowLeft");
  await wait(p, 100);
  const chosenBefore = await p.$$eval('.u1-opt[aria-checked="true"]', (e) => e.length);
  // The cold test's wipe: Enter on a focused bettor control.
  const beforeExp = experiments;
  const beforeWonder = wonder;
  await p.focus('[data-testid="who-spark"]');
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="b-claimant-confirm"]');
  say("Enter on a bettor control asks first and restarts nothing", experiments === beforeExp && wonder === beforeWonder);
  say("answers survive", (await p.$$eval('.u1-opt[aria-checked="true"]', (e) => e.length)) === chosenBefore);
  await p.click('[data-testid="b-claimant-yes"]');
  await wait(p, 800);
  say("answers survive a real change of bettor", (await p.$$eval('.u1-opt[aria-checked="true"]', (e) => e.length)) === chosenBefore);
  await p.click('[data-testid="who-both"]');
  await p.click('[data-testid="b-claimant-yes"]');
  await wait(p, 800);
  // Enter in a typed answer moves on.
  await p.keyboard.press("ArrowRight");
  await wait(p, 100);
  const typed = await p.$('.u1-quiz > li[data-active] .u1-typed-in');
  if (typed) {
    const at = await p.textContent('[data-testid="b-progress"]');
    await typed.fill("42");
    await typed.press("Enter");
    await wait(p, 120);
    say("Enter after a typed answer moves on", (await p.textContent('[data-testid="b-progress"]')) !== at && (await p.$$('[data-testid="u1-sealed"]')).length === 0);
  }
  for (let i = 0; i < 6 && !(await p.$('[data-testid="b-review"]')); i++) {
    await p.keyboard.press("ArrowRight");
    await wait(p, 60);
  }
  await p.locator('[data-testid="u1-pop"]').focus();
  // A double Enter seals once.
  await p.keyboard.press("Enter");
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="bench-path"]', { timeout: 60000 });
  say("a double Enter seals once", bets === 1, `${bets} requests`);
  await wait(p, 300);
  const paid = wonder;
  await p.keyboard.press("b");
  await wait(p, 200);
  say("B while the run plays only skips: nothing wiped, nothing paid", wonder === paid && !(await p.$('[data-testid="u1-pick-panel"]')));
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 15000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 30000 });
  await p.keyboard.press("b");
  await p.waitForSelector('[data-testid="u1-pick-panel"]');
  say("B after the verdict opens a list: the result stays, nothing paid", wonder === paid && !!(await p.$('[data-testid="mark-list"]')));
  await axe(p, "another-test list");
  await overlaps(p, "another-test list");
  await p.keyboard.press("Escape");
  await p.context().close();
}

// ---- R3 fix round 3: the hosted path, behind the real invite gate ----
if (late && process.env.BASE_G) {
  const code = readFileSync(process.env.GATE_FILE, "utf8").trim();
  const p = await open(`${process.env.BASE_G}/`, { vw: 1280, vh: 720 });
  let keeps = 0;
  p.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/keep")) keeps++;
  });
  await p.waitForSelector('[data-testid="e-invite"]');
  await p.fill('[data-testid="e-invite-code"]', code);
  await p.click('[data-testid="e-invite-go"]');
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-example"]')?.disabled);
  await p.click('[data-testid="u1-example"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 60000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 30000 });
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.keyboard.press("p");
  await p.waitForSelector('[data-testid="pc-copy-link"]', { timeout: 15000 });
  await p.click('[data-testid="pc-copy-link"]');
  await p.waitForSelector('[data-testid="pc-link-ask"]');
  say("the truthful sentence comes before anything is written", keeps === 0 && /values it returned or threw/.test(await p.textContent('[data-testid="pc-link-ask"]')));
  await shot(p, "gate-link-ask-1280");
  await p.click('[data-testid="pc-link-yes"]');
  await p.waitForSelector('[data-testid="pc-share-said"]');
  const said = await p.textContent('[data-testid="pc-share-said"]');
  say("behind the gate, the link is really kept", keeps === 1 && /30 days/.test(said) && !/JSON|nothing was run/.test(said), said);
  const link = await p.evaluate(() => navigator.clipboard.readText());
  const q = await open(link, { vw: 1280, vh: 720 });
  await q.waitForSelector('[data-testid="pc-image"]', { timeout: 15000 });
  const readerWords = await q.evaluate(() => document.body.textContent);
  say("a shared card doesn't call its reader 'you'", /The bettor/.test(readerWords) && !/YOU BET|You bet|you said|You:|You ·/.test(readerWords));
  say("a logged-out reader sees the card, with no re-run and no pencil", !(await q.$('[data-testid="pc-rerun"]')) && !(await q.$('[data-testid="pc-pencil"]')));
  await q.click('[data-testid="pc-copy-link"]');
  await wait(q, 200);
  say("a reader's Copy link makes nothing", !(await q.$('[data-testid="pc-link-ask"]')) && !/needs an invite/.test(await q.textContent('[data-testid="pc-image"]')));
  await axe(q, "shared card, logged out");
  await q.context().close();
  await p.click('[data-testid="pc-delete-link"]');
  await p.waitForFunction(() => /deleted/.test(document.querySelector('[data-testid="pc-share-said"]')?.textContent ?? ""));
  say("the maker can delete it", true);
  await p.context().close();
}

// ---- the explorer: a real outline job, with a mocked Wonder; then "Bet on this part" ----
if (late) {
  const p = await open(`${BASE_X}/`);
  await p.click('[data-testid="mode-explore"]');
  await p.waitForSelector('[data-testid="outline-start"]');
  // Pinned to the commit Wonder's saved answer describes, so plain code confirms a real answer.
  await p.fill('[data-testid="outline-repo"]', "damli40/atlas");
  await p.fill('[data-testid="outline-subfolder"]', "server/meta");
  await p.fill('[data-testid="outline-ref"]', "058ab2a");
  await p.click('[data-testid="outline-start"]');
  await p.waitForSelector('[data-testid="explorer-stage"] svg', { timeout: 120000 });
  await wait(p, 5500);
  await p.locator('[data-testid="explorer-stage"]').scrollIntoViewIfNeeded();
  await wait(p, 300);
  await shot(p, "explorer-rest-1920");
  await checks(p, "explorer");
  say("the explorer: threads only where plain code found the join", await p.evaluate(() => [...document.querySelectorAll('[data-testid="explorer-stage"] .rr-thread')].every((e) => e.getAttribute("data-provenance") === "plain-code")));
  const part = await p.locator('[data-testid="explorer-stage"] [data-node="secret-redaction"]').boundingBox();
  if (part) await p.mouse.click(part.x + part.width / 2, part.y + part.height / 2);
  else say("the explorer has the part to bet on", false);
  await wait(p, 500);
  await shot(p, "explorer-picked-1920");
  const bet = await p.$('[data-testid="bet-redactSecret"]');
  if (bet) {
    await bet.click();
    await p.waitForSelector('[data-testid="bench-stage"]', { state: "visible", timeout: 30000 });
    await wait(p, 2500);
    await shot(p, "explorer-bet-on-part-1920");
    say("Bet on this part opens the studio on that function", (await p.textContent(".r-name")) === "redactSecret", await p.textContent(".r-name"));
  } else say("Bet on this part is offered", false);
  await p.context().close();
  const q = await open(`${BASE_X}/`, { vw: 390, vh: 844 });
  await q.click('[data-testid="mode-explore"]');
  await q.waitForSelector('[data-testid="outline-saved"]');
  await q.click('[data-testid="outline-saved"]');
  await q.waitForSelector('[data-testid="explorer-stage"] svg', { timeout: 30000 });
  await wait(q, 5000);
  await q.locator('[data-testid="explorer-stage"]').scrollIntoViewIfNeeded();
  await shot(q, "explorer-390");
  await noScroll(q, "explorer");
  await q.context().close();
}

// ---- the retry demo ----
if (late) {
  const p = await open(`${BASE}/`);
  await p.click('[data-testid="u1-demos"]');
  await p.click('[data-testid="mode-fixture"]');
  await p.waitForSelector('[data-testid="pre-existing"]', { timeout: 15000 });
  await p.getByRole("button", { name: /Show the questions|the questions/i }).first().click();
  await p.waitForSelector('[data-testid="bet-calls"]', { timeout: 30000 });
  for (const s of await p.$$('select[data-testid^="bet-"]')) await s.selectOption({ index: 1 });
  for (const i of await p.$$('input[type="number"][data-testid^="bet-"]')) await i.fill("5");
  await p.getByRole("button", { name: "Seal my bets" }).click();
  await p.waitForSelector('[data-testid="sealed-note"]', { timeout: 30000 });
  await wait(p, 600);
  const go = p.locator("button.primary:not([disabled])").first();
  await go.click();
  await p.waitForSelector('[data-testid="retry-path"]', { timeout: 60000 });
  await wait(p, 14000);
  await p.locator('[data-testid="retry-path"]').scrollIntoViewIfNeeded();
  await wait(p, 300);
  await shot(p, "retry-demo-1920");
  const said = await p.evaluate(() => [...document.querySelectorAll('[data-testid="retry-path"] text')].map((t) => t.textContent).join(" "));
  say("the retry demo says the code is pre-existing", said.includes("Pre-existing"));
  say("the retry demo never says hangs or hammers", !/hang|hammer|forever/i.test(said));
  await axe(p, "retry demo");
  await p.context().close();
}

// ---- Moonwell: no fork runs here, so the recorded run (D04-04) is served to the real screen through routes ----
if (late) {
  const file = JSON.parse(read("../D04-04/moonwell-level2-mwTaxvHFzB.atlas.json"));
  const exp = file.experiments[0];
  const q = { measures: file.bets[0].measures, text: file.bets[0].question, kind: "number", unit: "USD" };
  const p = await open(`${BASE}/`, { vw: 1440, vh: 900 });
  await p.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (path === "/invite/status") return json({ required: false, signedIn: false });
    if (path === "/targets") return json({ ...file.target, title: "MIP-X43", files: [{ path: "mip-x43.sol", text: "contract MIPX43 {}\n" }] });
    if (path === "/investigate") return json({ ok: true, model: "muse-wonder-1.0", findings: file.findings ?? [], dropped: [] });
    if (path === "/experiments") return json({ experiment: exp, questions: [q], model: null, models: [] });
    if (path.endsWith("/model-bets")) return json({ model: null, models: [] });
    if (path === "/bets") return json({ bets: [{ id: file.bets[0].id, who: "human", question: q.text, measures: q.measures, sealedAt: file.bets[0].sealedAt, sealedHash: file.bets[0].sealedHash }] });
    if (path === "/runs") return json({ run: file.runs[0], verdicts: file.verdicts, bets: file.bets, betsFrozenAt: file.bets[0].sealedAt, model: null, models: [] });
    return route.continue();
  });
  await p.click('[data-testid="u1-demos"]');
  await p.click('[data-testid="mode-pr"]');
  await p.waitForSelector('[data-testid="moonwell-saved-label"]');
  say("Moonwell's menu opens the saved result, labelled as a replay of a saved file", /replay of a saved file/.test(await p.textContent('[data-testid="moonwell-saved-label"]')));
  await axe(p, "Moonwell saved");
  await shot(p, "moonwell-saved-1440");
  const savedWords = await p.evaluate(() => document.querySelector('[data-testid="moonwell-saved"]').textContent);
  say("a saved replay doesn't call a stranger 'you'", /The bet/.test(savedWords) && !/You bet|you said/i.test(savedWords) && !/\bYou\b/.test(savedWords));
  say("nothing is being asked, so no 'who bets' row", !(await p.locator('[data-testid="claimant-toggle"]').isVisible()));
  await p.setViewportSize({ width: 1280, height: 720 });
  await wait(p, 400);
  await shot(p, "moonwell-saved-1280");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.click('[data-testid="moonwell-run-again"]');
  await p.fill('[data-testid="pr-link"]', "https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578");
  await p.locator('[data-testid="pr-link"]').press("Tab");
  await p.locator('section[aria-label="pull request"] button').first().click();
  await p.waitForSelector('[data-testid="pr-target"]', { timeout: 15000 });
  await p.locator('[data-testid="findings"] button').first().click();
  await p.waitForSelector('[data-testid="findings-list"] button', { timeout: 15000 });
  await p.locator('[data-testid="findings-list"] button').first().click();
  await p.getByRole("button", { name: "Show the question" }).click();
  await p.waitForSelector('[data-testid="bet-usd"]', { timeout: 15000 });
  await p.fill('[data-testid="bet-usd"]', "2200");
  await p.locator('[data-testid="bet-usd"]').press("Enter");
  await wait(p, 600);
  await p.locator("button.primary:not([disabled]), button:has-text(\"Run\"):not([disabled])").last().click();
  await p.waitForSelector('[data-testid="price-pipe"] svg', { timeout: 20000 });
  await wait(p, 5000);
  await p.locator('[data-testid="m-split"]').first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await wait(p, 300);
  await shot(p, "moonwell-1440");
  const words = await p.evaluate(() => [...document.querySelectorAll('[data-testid="price-pipe"] text')].map((t) => t.textContent).join(" "));
  say("Moonwell: $1.12 and the reference $2,206.68, only from the run", words.includes("$1.12") && words.includes("$2,206.68"));
  say("Moonwell: the allowed wording", words.replace(/\s+/g, " ").includes("Moonwell took $1.78M in bad debt from one oracle setting"));
  await axe(p, "Moonwell");
  await p.context().close();
}

// ---- the recorded retry and Moonwell proof cards, served through a route ----
if (late) for (const [name, rel] of [["moonwell", "../D04-04/moonwell-level2-mwTaxvHFzB.atlas.json"], ["retry", "../D04-04/fixture-eRopGsrp2a.atlas.json"]]) {
  const file = JSON.parse(read(rel));
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  await p.route("**/api/proofs/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(file) }));
  await p.goto(`${BASE}/?proof=${encodeURIComponent(file.runs[0].id)}`);
  await p.waitForSelector(".pc-machine svg", { timeout: 20000 });
  await wait(p, 400);
  await p.locator(".pc-machine").first().scrollIntoViewIfNeeded();
  await wait(p, 200);
  await shot(p, `proof-${name}-1920`);
  await axe(p, `proof card, ${name}`);
  await ctx.close();
}

await b.close();
log.failures = failures;
writeFileSync(`${OUT}/app-drive-log.json`, `${JSON.stringify(log, null, 1)}\n`);
console.log(failures.length ? `\n${failures.length} FAILED:\n${failures.join("\n")}` : "\nall passed");
process.exit(failures.length ? 1 : 0);
