// D07-02 live rounds in headless Chromium against `pnpm dev:all` (real server, real Muse Spark bets, real
// Adversary (muse-spark-1.3), real sandbox, real Base fork). For each target: one normal round, then
// "What else?", which runs one autonomous round with no further click. Saves the server's own answers
// (POST /runs, POST /adversary), the agent log strip's lines, and PNGs of the strip and the section.
// Usage: PLAYWRIGHT_CORE=<path to playwright-core> node drive.mjs <chromium-headless-shell path> <out dir> [fixture|moonwell|both]
// The person's bets are typed by this script: fixture S3 = calls 5, total wait 12000, outcome throws;
// Moonwell Level 2 = 2200 USD, on line 42 of proposals/ChainlinkOracleConfigs.sol (picked by the script,
// as in D04-04 and D06-01). No Investigator call, no Fixer call.
import { writeFileSync } from "node:fs";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const [exe, outDir, which = "both"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const out = [];
const say = (...a) => {
  const line = a.join(" ");
  out.push(line);
  console.log(line);
};

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const responses = [];
  page.on("response", async (r) => {
    if (!r.url().includes("/api/") || r.url().includes("/events/")) return;
    try {
      responses.push({ url: r.url().replace(/^.*\/api/, ""), status: r.status(), body: await r.text() });
    } catch {}
  });
  await page.goto(process.env.ATLAS_PAGE_URL ?? "http://localhost:5173/");
  return { page, errors, responses };
}

const save = (responses, path, file) => {
  const r = responses.filter((x) => x.url.endsWith(path)).at(-1);
  if (r) writeFileSync(`${outDir}/${file}`, JSON.stringify(JSON.parse(r.body), null, 2) + "\n");
  return r ? JSON.parse(r.body) : null;
};

async function whatElse(page, responses, tag) {
  await page.getByTestId("adversary-ask").click();
  const t0 = Date.now();
  await page.getByTestId("adversary-result").or(page.locator('[data-testid="adversary"] [role="alert"]')).first().waitFor({ timeout: 900000 });
  say(`${tag} what else answered after ${Date.now() - t0} ms`);
  say(`${tag} what else section:`, flat(await page.getByTestId("adversary").innerText()).slice(0, 4000));
  const a = save(responses, "/adversary", `adversary-${tag}.json`);
  await page.getByTestId("adversary").screenshot({ path: `${outDir}/${tag}-what-else.png` });
  // The strip's lines from "asks what else" on: the handoff.
  const lines = await page.$$eval('[data-testid="logstrip-line"]', (els) => els.map((e) => e.getAttribute("title")));
  const from = lines.findIndex((l) => / asks what else/.test(l ?? ""));
  say(`${tag} strip, the handoff (${lines.length - from} of ${lines.length} lines):`);
  for (const l of lines.slice(from)) say(`  ${l}`);
  writeFileSync(`${outDir}/${tag}-strip-lines.txt`, lines.join("\n") + "\n");
  await page.getByTestId("logstrip").screenshot({ path: `${outDir}/${tag}-strip-handoff.png` });
  const text = await page.locator("body").innerText();
  say(`${tag} page says "fixed" anywhere:`, /\bfix(ed|es)?\b/i.test(text));
  return a;
}

async function fixtureRound() {
  say("=== FIXTURE ROUND (withRpcRetry, S3), then What else?");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("pre-existing").waitFor();
  await page.locator('input[name="scenario"][value="S3"]').check();
  await page.getByRole("button", { name: "Show the questions" }).click();
  await page.getByTestId("bet-calls").fill("5");
  await page.getByTestId("bet-totalWaitMs").fill("12000");
  await page.getByTestId("bet-outcome").selectOption("throws");
  await page.getByRole("button", { name: "Seal my bets" }).click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  say("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  await page.getByRole("button", { name: "Break it" }).click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
  say("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  save(responses, "/runs", "run-fixture.json");
  await whatElse(page, responses, "fixture");
  say("page errors:", errors.length ? errors.join(" | ") : "none");
  await page.close();
}

async function moonwellRound() {
  say("=== MOONWELL ROUND (PR #578, Level 2), then What else?");
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
  say("chosen:", flat(await page.getByTestId("chosen-finding").innerText()));
  await page.getByRole("button", { name: "Show the question" }).click();
  await page.getByTestId("bet-usd").fill("2200");
  await page.getByRole("button", { name: "Seal my bet" }).click();
  await page.getByTestId("hash-usd").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  say("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  await page.getByRole("button", { name: "Run it on a fork of Base" }).click();
  await page.getByTestId("seal-check-model-priceUsd1e18:cbETH").or(page.getByTestId("seal-check-priceUsd1e18:cbETH")).first().waitFor({ timeout: 400000 });
  say("run facts:", flat(await page.getByTestId("run-facts").innerText()));
  save(responses, "/runs", "run-moonwell.json");
  await whatElse(page, responses, "moonwell");
  say("page errors:", errors.length ? errors.join(" | ") : "none");
  await page.close();
}

if (which === "fixture" || which === "both") await fixtureRound();
if (which === "moonwell" || which === "both") await moonwellRound();
writeFileSync(`${outDir}/browser-output-${which}.txt`, out.join("\n") + "\n");
await browser.close();
