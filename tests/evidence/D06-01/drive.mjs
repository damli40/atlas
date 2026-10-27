// D06-01 live rounds in headless Chromium against `pnpm dev:all` (real server, real Muse Spark bets,
// real Muse Code via `muse exec`, real Base fork). One withRpcRetry round (S6) and one Moonwell PR #578
// Level 2 round, each followed by "Ask Muse Code for a change, then re-run".
// Usage: PLAYWRIGHT_CORE=<path to playwright-core> node drive.mjs <chromium-headless-shell path> <out dir> [fixture|moonwell|both]
// The person's bets are typed by this script: fixture S6 = calls 5, total wait 12000, outcome throws
// (what oracle row S6 says people expect: "5 retries, so it's safe"); Moonwell = 2200 USD.
// No Investigator call (the fixture uses its hand-written finding; on the PR the script picks line 42).
// Saves the server's own answers: run-*.json (POST /runs), replay-*.json (POST /changes), and PNGs.
import { writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
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
  await page.goto(process.env.ATLAS_PAGE_URL ?? "http://localhost:5173/");
  return { page, errors, responses };
}

const save = (responses, path, file) => {
  const r = responses.filter((x) => x.url.endsWith(path)).at(-1);
  if (r) writeFileSync(`${outDir}/${file}`, JSON.stringify(JSON.parse(r.body), null, 2) + "\n");
  return r ? JSON.parse(r.body) : null;
};

async function change(page, responses, tag) {
  await page.getByRole("button", { name: "Ask Muse Code for a change, then re-run" }).click();
  const t0 = Date.now();
  await page.locator('[data-testid="change-result"], [data-testid="change-refused"], [data-testid="change"] [role="alert"]').first().waitFor({ timeout: 900000 });
  console.log(`${tag} change answered after ${Date.now() - t0} ms`);
  console.log(`${tag} change section:`, flat(await page.getByTestId("change").innerText()).slice(0, 3000));
  await page.getByTestId("change").screenshot({ path: `${outDir}/${tag}-before-after.png` });
  await page.screenshot({ path: `${outDir}/${tag}-page.png`, fullPage: true });
  const body = save(responses, "/changes", `replay-${tag}.json`);
  if (body?.diff) writeFileSync(`${outDir}/diff-${tag}.diff`, body.diff);
  else if (body) writeFileSync(`${outDir}/diff-${tag}.txt`, `no diff replayed: ${body.reason}\n`);
  const text = await page.locator("body").innerText();
  console.log(`${tag} page says "fixed" anywhere:`, /\bfix(ed|es)?\b/i.test(text));
}

async function fixtureRound() {
  console.log("=== FIXTURE ROUND (withRpcRetry, S6)");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("pre-existing").waitFor();
  await page.locator('input[name="scenario"][value="S6"]').check();
  await page.getByRole("button", { name: "Show the questions" }).click();
  await page.getByTestId("bet-calls").fill("5");
  await page.getByTestId("bet-totalWaitMs").fill("12000");
  await page.getByTestId("bet-outcome").selectOption("throws");
  await page.getByRole("button", { name: "Seal my bets" }).click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  console.log("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  await page.getByRole("button", { name: "Break it" }).click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
  console.log("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  for (const m of ["calls", "totalWaitMs", "outcome"]) console.log(`row ${m}:`, flat(await page.getByTestId(`verdict-${m}`).innerText()));
  save(responses, "/runs", "run-ts.json");
  await change(page, responses, "ts");
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
  await page.getByRole("button", { name: "Read the files and pick lines" }).click();
  await page.getByTestId("pick-file").selectOption("proposals/ChainlinkOracleConfigs.sol");
  await page.locator('[data-testid="pick-code"] [data-line="42"]').click();
  await page.getByTestId("pick-use").click();
  await page.getByTestId("chosen-finding").waitFor();
  console.log("chosen:", flat(await page.getByTestId("chosen-finding").innerText()));
  await page.getByRole("button", { name: "Show the question" }).click();
  await page.getByTestId("bet-usd").fill("2200");
  await page.getByRole("button", { name: "Seal my bet" }).click();
  await page.getByTestId("hash-usd").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  console.log("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  await page.getByRole("button", { name: "Run it on a fork of Base" }).click();
  await page.getByTestId("seal-check-model-priceUsd1e18:cbETH").or(page.getByTestId("seal-check-priceUsd1e18:cbETH")).first().waitFor({ timeout: 400000 });
  console.log("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  console.log("row cbETH:", flat(await page.getByTestId("verdict-priceUsd1e18:cbETH").innerText()));
  save(responses, "/runs", "run-evm.json");
  await change(page, responses, "evm");
  console.log("page errors:", errors.length ? errors : "none");
  await page.close();
}

if (which === "fixture" || which === "both") await fixtureRound();
if (which === "moonwell" || which === "both") await moonwellRound();
await browser.close();
