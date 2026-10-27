// D04-04 browser rounds: headless Chromium against `pnpm dev:all` (real server, real Meta calls, real
// Base fork). One fixture round and one Moonwell Level 2 round, PNGs at each key step.
// Usage: node drive.mjs <chrome-headless-shell path> <out dir> [fixture|moonwell|both]
// The person's bets are typed by this script (fixture: 5 / 15000 / throws; Moonwell: 2200 USD).
// It uses the Investigator's place when one covers the cbETH config lines (41–43); otherwise it
// picks line 42 itself, as a person would.
import { chromium } from "playwright-core";
const [exe, outDir, which = "both"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const flat = (s) => s.replace(/\s+/g, " ").trim();

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const responses = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/") || r.url().includes("/events/")) return;
    try { responses.push({ url: r.url().replace(/^.*\/api/, ""), status: r.status(), body: await r.text() }); } catch {}
  });
  await page.goto("http://localhost:5173/");
  return { page, errors, responses };
}

function leakCheck(responses) {
  const pre = responses.filter((r) => !r.url.endsWith("/runs"));
  const leaked = pre.filter((r) => r.body.includes('"who":"model:muse-spark-1.3"') && /"answer"|"rationale"|"nonce"/.test(r.body));
  return `pre-run responses: ${pre.length}; any holding a model answer, rationale or nonce: ${leaked.length}`;
}

async function fixtureRound() {
  console.log("=== FIXTURE ROUND (withRpcRetry)");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("pre-existing").waitFor();
  console.log("target label:", flat(await page.getByTestId("pre-existing").innerText()));
  await page.getByRole("button", { name: /Ask the Investigator/ }).click();
  const t0 = Date.now();
  await page.locator('[data-testid="findings-list"], [data-testid="findings-none"]').first().waitFor({ timeout: 180000 });
  console.log(`investigator answered after ${Date.now() - t0} ms`);
  console.log("findings panel:", flat(await page.getByTestId("findings").innerText()));
  await page.screenshot({ path: `${outDir}/fixture-1-findings.png`, fullPage: true });
  const use = page.getByRole("button", { name: "Use this place" });
  if (await use.count()) await use.first().click();
  console.log("chosen:", (await page.getByTestId("chosen-finding").count()) ? flat(await page.getByTestId("chosen-finding").innerText()) : "none (hand-written finding is used)");
  await page.getByRole("button", { name: "Show the questions" }).click();
  await page.getByTestId("bet-calls").fill("5");
  await page.getByTestId("bet-totalWaitMs").fill("15000");
  await page.getByTestId("bet-outcome").selectOption("throws");
  await page.getByRole("button", { name: "Seal my bets" }).click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  console.log("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  console.log(leakCheck(responses));
  await page.screenshot({ path: `${outDir}/fixture-2-sealed-before-run.png`, fullPage: true });
  await page.getByRole("button", { name: "Break it" }).click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
  console.log("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  console.log("table columns:", JSON.stringify(await page.locator(".verdicts th").allInnerTexts()));
  for (const m of ["calls", "totalWaitMs", "outcome"]) console.log(`row ${m}:`, flat(await page.getByTestId(`verdict-${m}`).innerText()));
  for (const li of await page.locator(".seals li[data-match]").all()) console.log("seal check:", await li.getAttribute("data-match"), "|", flat(await li.innerText()));
  if (await page.getByTestId("model-panel").count()) console.log("model panel:", flat(await page.getByTestId("model-panel").innerText()));
  await page.screenshot({ path: `${outDir}/fixture-3-verdict.png`, fullPage: true });
  const run = responses.find((r) => r.url.endsWith("/runs"));
  const body = run ? JSON.parse(run.body) : null;
  console.log("fixture runId:", body?.run?.id, "| proof:", JSON.stringify(body?.proof));
  console.log("page errors:", errors.length ? errors : "none");
  await page.close();
}

async function moonwellRound() {
  console.log("=== MOONWELL ROUND (PR #578, Level 2)");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("mode-pr").click();
  await page.getByTestId("pr-link").fill("https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578");
  await page.getByRole("button", { name: "Read it" }).click();
  await page.getByTestId("pr-target").waitFor({ timeout: 60000 });
  console.log("target:", flat(await page.getByTestId("pr-target").innerText()));
  await page.getByRole("button", { name: /Ask the Investigator/ }).click();
  const t0 = Date.now();
  await page.locator('[data-testid="findings-list"], [data-testid="findings-none"]').first().waitFor({ timeout: 240000 });
  console.log(`investigator answered after ${Date.now() - t0} ms`);
  console.log("findings panel:", flat(await page.getByTestId("findings").innerText()));
  await page.screenshot({ path: `${outDir}/moonwell-1-findings.png`, fullPage: true });
  // Does any Investigator place cover the cbETH config lines (41–43 of ChainlinkOracleConfigs.sol)?
  const inv = responses.find((r) => r.url.endsWith("/investigate"));
  const findings = inv ? JSON.parse(inv.body).findings ?? [] : [];
  const hit = findings.findIndex((f) => f.file === "proposals/ChainlinkOracleConfigs.sol" && f.lineStart <= 43 && 41 <= f.lineEnd);
  console.log("investigator places:", JSON.stringify(findings.map((f) => `${f.file}:${f.lineStart}-${f.lineEnd}`)), "| covers cbETH lines 41–43:", hit >= 0);
  if (hit >= 0) {
    await page.locator(`[data-testid="finding-${findings[hit].id}"] button`).click();
  } else {
    await page.getByRole("button", { name: "Read the files and pick lines" }).click();
    await page.getByTestId("pick-file").selectOption("proposals/ChainlinkOracleConfigs.sol");
    await page.locator('[data-testid="pick-code"] [data-line="42"]').click();
    await page.getByTestId("pick-use").click();
  }
  await page.getByTestId("chosen-finding").waitFor();
  console.log("chosen:", flat(await page.getByTestId("chosen-finding").innerText()));
  await page.screenshot({ path: `${outDir}/moonwell-2-chosen.png`, fullPage: true });
  await page.getByRole("button", { name: "Show the question" }).click();
  await page.getByTestId("bet-usd").fill("2200");
  await page.getByRole("button", { name: "Seal my bet" }).click();
  await page.getByTestId("hash-usd").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  console.log("caption shown before run:", flat(await page.getByTestId("level-caption").innerText()));
  console.log("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  console.log(leakCheck(responses));
  await page.screenshot({ path: `${outDir}/moonwell-3-sealed-before-run.png`, fullPage: true });
  await page.getByRole("button", { name: "Run it on a fork of Base" }).click();
  const r0 = Date.now();
  await page.getByTestId("run-progress").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="run-progress"] li').length >= 3, null, { timeout: 120000 }).catch(() => {});
  console.log("progress while running:", flat(await page.getByTestId("run-progress").innerText()));
  await page.screenshot({ path: `${outDir}/moonwell-4-run-progress.png`, fullPage: true });
  await page.getByTestId("seal-check-model-priceUsd1e18:cbETH").or(page.getByTestId("seal-check-priceUsd1e18:cbETH")).first().waitFor({ timeout: 400000 });
  console.log(`run answered after ${Date.now() - r0} ms`);
  console.log("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  console.log("table columns:", JSON.stringify(await page.locator('[aria-label="verdicts"] .verdicts th').allInnerTexts()));
  console.log("row cbETH:", flat(await page.getByTestId("verdict-priceUsd1e18:cbETH").innerText()));
  for (const li of await page.locator(".seals li[data-match]").all()) console.log("seal check:", await li.getAttribute("data-match"), "|", flat(await li.innerText()));
  if (await page.getByTestId("model-panel").count()) console.log("model panel:", flat(await page.getByTestId("model-panel").innerText()));
  if (await page.getByTestId("false-alarm").count()) console.log("false-alarm:", flat(await page.getByTestId("false-alarm").innerText()));
  console.log("captions:", flat(await page.getByTestId("captions").innerText()));
  await page.screenshot({ path: `${outDir}/moonwell-5-verdict.png`, fullPage: true });
  const run = responses.find((r) => r.url.endsWith("/runs"));
  const body = run ? JSON.parse(run.body) : null;
  console.log("moonwell runId:", body?.run?.id, "| proof:", JSON.stringify(body?.proof));
  console.log("page errors:", errors.length ? errors : "none");
  await page.close();
}

if (which === "fixture" || which === "both") await fixtureRound();
if (which === "moonwell" || which === "both") await moonwellRound();
await browser.close();
