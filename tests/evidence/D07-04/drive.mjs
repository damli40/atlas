// D07-04 live click-through in headless Chromium against the RUNNING app (tests/evidence/D07-04/mock-server.ts
// + Vite): real gate, real sandbox, real Base fork, real judge; every model answer mocked ($0).
// For each screen: a PNG, an axe-core accessibility run (WCAG 2 A/AA rules), a check that a 390 px wide page
// has no horizontal scroll, and a check that with prefers-reduced-motion nothing animates.
//
// Usage: PLAYWRIGHT_CORE=<playwright-core dir> AXE=<axe.min.js> node drive.mjs <chromium headless shell> <out dir>
// The person's bets are typed by this script: withRpcRetry S3 = calls 5, total wait 12000, throws;
// Moonwell Level 2 = $2,200 on line 42 of proposals/ChainlinkOracleConfigs.sol (picked by the script).
import { writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir] = process.argv.slice(2);
const AXE = process.env.AXE;
const URL0 = process.env.ATLAS_PAGE_URL ?? "http://localhost:5173/";
const browser = await chromium.launch({ executablePath: exe });
const out = [];
const say = (...a) => {
  const line = a.join(" ");
  out.push(line);
  console.log(line);
};
const flat = (s) => s.replace(/\s+/g, " ").trim();
// The toggle is a <fieldset disabled>; its radios then match :disabled (Playwright's isDisabled() does not read a fieldset).
const results = { axe: {}, overflow: {}, motion: {}, errors: [] };

async function newPage(width = 1920, height = 1080) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  page.on("pageerror", (e) => results.errors.push(e.message));
  return page;
}

/** axe-core over the whole page: violations by impact. */
async function axe(page, name) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return { violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })), passes: res.passes.length, incomplete: res.incomplete.length };
  });
  results.axe[name] = r;
  say(`axe ${name}: ${r.violations.length} violations (${r.violations.map((v) => `${v.id}/${v.impact}×${v.nodes}`).join(", ") || "none"}), ${r.passes} rules passed`);
  return r;
}

/** True when nothing is wider than the viewport (no horizontal scroll). */
async function overflow(page, name) {
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== "fixed";
      })
      .filter((e) => !e.closest("pre, .code, [data-scroll-x]")) // code blocks scroll inside their own box
      .slice(0, 5)
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} right=${Math.round(e.getBoundingClientRect().right)}`);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, noScroll: document.documentElement.scrollWidth <= vw, wide };
  });
  results.overflow[name] = r;
  say(`390px ${name}: scrollWidth ${r.scrollWidth} vs ${r.clientWidth} → ${r.noScroll ? "no horizontal scroll" : "HORIZONTAL SCROLL"}${r.wide.length ? ` (${r.wide.join("; ")})` : ""}`);
  return r;
}

/** With prefers-reduced-motion: no running CSS animation or transition on the page. */
async function motion(page, name) {
  const r = await page.evaluate(() => {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    return { running: running.length, which: running.slice(0, 5).map((a) => `${a.constructor.name}:${a.animationName ?? a.transitionProperty ?? ""} on ${a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? ""}`) };
  });
  results.motion[name] = r;
  say(`reduced motion ${name}: ${r.running} running animations${r.which.length ? ` (${r.which.join("; ")})` : ""}`);
  return r;
}

async function at390(path, name, prep) {
  const p = await newPage(390, 844);
  await p.goto(URL0 + path);
  if (prep) await prep(p);
  await overflow(p, name);
  await p.screenshot({ path: `${outDir}/${name}-390.png`, fullPage: true });
  await p.close();
}

// ---------- 1. withRpcRetry round ----------
say("=== withRpcRetry (S3): verdict and retry machine");
const page = await newPage();
await page.goto(URL0);
await page.getByTestId("pre-existing").waitFor();
await axe(page, "drop-fixture");
await motion(page, "drop-fixture");
await page.locator('input[name="scenario"][value="S3"]').check();
await page.getByRole("button", { name: "Show the questions" }).click();
await page.getByTestId("bet-calls").waitFor();
say("toggle locked while the round is open:", await page.getByTestId("claimant-spark").evaluate((e) => e.matches(":disabled")));
await page.getByTestId("bet-calls").fill("5");
await page.getByTestId("bet-totalWaitMs").fill("12000");
await page.getByTestId("bet-outcome").selectOption("throws");
await page.getByRole("button", { name: "Seal my bets" }).click();
await page.getByTestId("hash-outcome").waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 60000 });
await page.getByRole("button", { name: "Break it" }).click();
await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
await page.getByTestId("retry-machine").waitFor();
say("toggle unlocked after the run:", !(await page.getByTestId("claimant-spark").evaluate((e) => e.matches(":disabled"))));
say("run facts:", flat(await page.getByTestId("run-facts").innerText()));
const fixtureRunId = (await page.getByTestId("proof-link").getAttribute("href")).replace("?proof=", "");
say("fixture run id:", fixtureRunId);
await page.locator('section[aria-label="verdicts"]').screenshot({ path: `${outDir}/fixture-verdict.png` });
await page.getByTestId("retry-machine").screenshot({ path: `${outDir}/fixture-retry-machine.png` });
await page.screenshot({ path: `${outDir}/fixture-verdict-full.png`, fullPage: true });
await axe(page, "verdict-fixture");
await motion(page, "verdict-fixture");
await page.close();

// ---------- 2. Moonwell Level 2, then the D20 change ----------
say("=== Moonwell PR #578, Level 2: verdict, price pipe, market table; then the change and replay");
const mw = await newPage();
await mw.goto(URL0);
await mw.getByTestId("mode-pr").click();
await mw.getByTestId("pr-link").fill("https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578");
await mw.getByRole("button", { name: "Read it" }).click();
await mw.getByTestId("pr-target").waitFor({ timeout: 60000 });
await axe(mw, "drop-moonwell");
await mw.getByRole("button", { name: "Read the files and pick lines" }).click();
await mw.getByTestId("pick-file").selectOption("proposals/ChainlinkOracleConfigs.sol");
await mw.locator('[data-testid="pick-code"] [data-line="42"]').click();
await mw.getByTestId("pick-use").click();
await mw.getByTestId("chosen-finding").waitFor();
say("chosen:", flat(await mw.getByTestId("chosen-finding").innerText()));
await mw.getByRole("button", { name: "Show the question" }).click();
await mw.getByTestId("bet-usd").fill("2200");
await mw.getByRole("button", { name: "Seal my bet" }).click();
await mw.getByTestId("hash-usd").waitFor();
await mw.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 60000 });
await mw.getByRole("button", { name: "Run it on a fork of Base" }).click();
await mw.getByTestId("price-pipe").first().waitFor({ timeout: 400000 });
say("run facts:", flat(await mw.getByTestId("run-facts").innerText()));
const mwRunId = (await mw.getByTestId("proof-link").getAttribute("href")).replace("?proof=", "");
say("moonwell run id:", mwRunId);
await mw.locator('section[aria-label="verdicts"]').screenshot({ path: `${outDir}/moonwell-verdict.png` });
await mw.getByTestId("price-pipe").first().screenshot({ path: `${outDir}/moonwell-price-pipe.png` });
await mw.getByTestId("false-alarm").screenshot({ path: `${outDir}/moonwell-market-table.png` });
await axe(mw, "verdict-moonwell");
await motion(mw, "verdict-moonwell");
await mw.getByRole("button", { name: "Ask Muse Code for a change, then re-run" }).click();
await mw.getByTestId("change-result").or(mw.getByTestId("change-refused")).first().waitFor({ timeout: 600000 });
say("change:", flat(await mw.getByTestId("change").innerText()).slice(0, 1500));
await mw.getByTestId("change").screenshot({ path: `${outDir}/moonwell-d20-change-replay.png` });
await axe(mw, "change-moonwell");
await motion(mw, "change-moonwell");
await mw.screenshot({ path: `${outDir}/moonwell-full.png`, fullPage: true });
await mw.close();

// ---------- 3. Proof cards ----------
for (const [tag, id] of [
  ["fixture", fixtureRunId],
  ["moonwell", mwRunId],
]) {
  say(`=== proof card (${tag}, run ${id})`);
  const pc = await newPage(1920, 1080);
  await pc.goto(`${URL0}?proof=${id}`);
  await pc.getByTestId("proof-card").waitFor({ timeout: 30000 });
  const h = await pc.locator(".pc-hero .sb-mark").first().boundingBox();
  const g = await pc.locator(".pc-hero .sb").boundingBox();
  say(`${tag} proof card: each mark is ${Math.round(h.width)}×${Math.round(h.height)} px at 1920×1080; the marks' group is centred at x ${Math.round(g.x + g.width / 2)} of 1920, top at y ${Math.round(h.y)}`);
  results[`markSize-${tag}`] = h;
  say(`${tag} bettors:`, flat(await pc.getByTestId("pc-bettors").innerText()));
  await pc.screenshot({ path: `${outDir}/proof-card-${tag}-1920.png` });
  await pc.screenshot({ path: `${outDir}/proof-card-${tag}-1920-full.png`, fullPage: true });
  await axe(pc, `proof-card-${tag}`);
  await motion(pc, `proof-card-${tag}`);
  await pc.close();
  await at390(`?proof=${id}`, `proof-card-${tag}`, (p) => p.getByTestId("proof-card").waitFor({ timeout: 30000 }));
}

// ---------- 4. 390 px: every screen ----------
say("=== 390 px width, every screen");
await at390("", "drop-fixture", (p) => p.getByTestId("pre-existing").waitFor());
await at390("", "verdict-fixture", async (p) => {
  await p.getByTestId("pre-existing").waitFor();
  await p.locator('input[name="scenario"][value="S3"]').check();
  await p.getByRole("button", { name: "Show the questions" }).click();
  await p.getByTestId("bet-calls").fill("5");
  await p.getByTestId("bet-totalWaitMs").fill("12000");
  await p.getByTestId("bet-outcome").selectOption("throws");
  await p.getByRole("button", { name: "Seal my bets" }).click();
  await p.getByTestId("hash-outcome").waitFor();
  await p.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 60000 });
  await p.getByRole("button", { name: "Break it" }).click();
  await p.getByTestId("retry-machine").waitFor({ timeout: 60000 });
  await p.getByRole("button", { name: "Ask Muse Code for a change, then re-run" }).click();
  await p.getByTestId("change-result").or(p.getByTestId("change-refused")).first().waitFor({ timeout: 120000 });
});
await at390("", "drop-moonwell", async (p) => {
  await p.getByTestId("mode-pr").click();
  await p.getByTestId("pr-link").fill("https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578");
  await p.getByRole("button", { name: "Read it" }).click();
  await p.getByTestId("pr-target").waitFor({ timeout: 60000 });
  await p.getByRole("button", { name: "Read the files and pick lines" }).click();
  await p.getByTestId("pick-file").selectOption("proposals/ChainlinkOracleConfigs.sol");
});
await at390("", "scale", async (p) => {
  await p.getByTestId("mode-scale").click();
  await p.waitForTimeout(500);
});

say("page errors:", results.errors.length ? results.errors.join(" | ") : "none");
writeFileSync(`${outDir}/checks.json`, JSON.stringify(results, null, 2) + "\n");
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
await browser.close();
