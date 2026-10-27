// D05-04 / D05-05 browser rounds at 1920×1080: headless Chromium against the real server (real Meta
// calls, real Base fork) and Vite. One fixture round and one Moonwell PR #578 Level 2 round, with the
// agent log strip open, then "Ask why". PNGs, the strip's measured font size and visible lines, and the
// session's events (from the round's .atlas.json) are written to <out dir>.
// Usage: PW=<path to playwright-core> node drive.mjs <chrome-headless-shell path> <out dir>
// The person's bets are typed here (fixture: 5 / 15000 / throws; Moonwell: 2200 USD). On Moonwell the
// person always picks line 42 (the cbETH config line) themselves, whatever the Investigator found.
import { writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW ?? "playwright-core");
const [exe, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const out = [];
const say = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
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
    try { responses.push({ url: r.url().replace(/^.*\/api/, ""), status: r.status(), body: await r.text() }); } catch {}
  });
  await page.goto("http://localhost:5173/");
  return { page, errors, responses };
}

/** The strip as measured in the page: font size, lines, and how many sit fully inside the list without scrolling. */
async function measureStrip(page) {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="logstrip-lines"]');
    if (!list) return null;
    const box = list.getBoundingClientRect();
    const items = [...list.querySelectorAll('[data-testid="logstrip-line"]')];
    const inside = items.filter((li) => { const r = li.getBoundingClientRect(); return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5; });
    const sizes = items.map((li) => parseFloat(getComputedStyle(li).fontSize));
    const oneLine = items.every((li) => li.getBoundingClientRect().height < parseFloat(getComputedStyle(li).fontSize) * 2.2);
    const last = items.at(-1);
    return {
      lines: items.length,
      fullyVisible: inside.length,
      newestVisible: last ? inside.includes(last) : null,
      minFontPx: Math.min(...sizes),
      everyRowOneLine: oneLine,
      listHeightPx: Math.round(box.height),
      rowsThatFitWithoutScrolling: items.length ? Math.floor(box.height / items[0].getBoundingClientRect().height) : 0,
      cutWithEllipsis: items.filter((li) => { const a = li.querySelector(".act"); return a && a.scrollWidth > a.clientWidth + 1; }).length,
    };
  });
}

async function fixtureRound() {
  say("=== FIXTURE ROUND (withRpcRetry), 1920×1080, strip open");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("pre-existing").waitFor();
  await page.getByRole("button", { name: "Show the questions" }).click();
  await page.getByTestId("bet-calls").fill("5");
  await page.getByTestId("bet-totalWaitMs").fill("15000");
  await page.getByTestId("bet-outcome").selectOption("throws");
  await page.getByRole("button", { name: "Seal my bets" }).click();
  await page.getByTestId("hash-outcome").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  say("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  const preRunStrip = flat(await page.getByTestId("logstrip-lines").innerText());
  await page.getByRole("button", { name: "Break it" }).click();
  await page.getByTestId("seal-check-outcome").waitFor({ timeout: 60000 });
  const run = JSON.parse(responses.find((r) => r.url.endsWith("/runs")).body);
  const modelValues = run.bets.filter((b) => b.who !== "human" && b.answer.kind !== "declined").map((b) => String(b.answer.value));
  say("pre-run strip holds a model bet value:", modelValues.filter((v) => preRunStrip.includes(` ${v} `) || preRunStrip.endsWith(` ${v}`)).length > 0, "| model values (revealed after the run):", modelValues);
  await page.getByTestId("why-ask").click();
  await page.getByTestId("why").scrollIntoViewIfNeeded();
  say("why (fixture):", flat(await page.getByTestId("why").innerText()));
  say("strip (fixture):", await measureStrip(page));
  await page.screenshot({ path: `${outDir}/fixture-why-1080p.png` });
  say("fixture runId:", run.run.id, "| proof:", run.proof);
  say("page errors:", errors.length ? errors : "none");
  await page.close();
  return run.run.id;
}

async function moonwellRound() {
  say("=== MOONWELL ROUND (PR #578, Level 2), 1920×1080, strip open");
  const { page, errors, responses } = await newPage();
  await page.getByTestId("mode-pr").click();
  await page.getByTestId("pr-link").fill("https://github.com/moonwell-fi/moonwell-contracts-v2/pull/578");
  await page.getByRole("button", { name: "Read it" }).click();
  await page.getByTestId("pr-target").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: /Ask the Investigator/ }).click();
  const t0 = Date.now();
  await page.locator('[data-testid="findings-list"], [data-testid="findings-none"]').first().waitFor({ timeout: 240000 });
  say(`investigator answered after ${Date.now() - t0} ms`);
  const inv = JSON.parse(responses.find((r) => r.url.endsWith("/investigate")).body);
  say("investigator places:", (inv.findings ?? []).map((f) => `${f.file}:${f.lineStart}-${f.lineEnd}`), "| removed:", (inv.dropped ?? []).length);
  await page.getByRole("button", { name: "Read the files and pick lines" }).click();
  await page.getByTestId("pick-file").selectOption("proposals/ChainlinkOracleConfigs.sol");
  await page.locator('[data-testid="pick-code"] [data-line="42"]').click();
  await page.getByTestId("pick-use").click();
  await page.getByTestId("chosen-finding").waitFor();
  await page.getByRole("button", { name: "Show the question" }).click();
  await page.getByTestId("bet-usd").fill("2200");
  await page.getByRole("button", { name: "Seal my bet" }).click();
  await page.getByTestId("hash-usd").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="model-slot"]')?.getAttribute("data-status") !== "thinking", null, { timeout: 120000 });
  say("model slot:", flat(await page.getByTestId("model-slot").innerText()));
  const preRunStrip = flat(await page.getByTestId("logstrip-lines").innerText());
  say("strip before the run:", await measureStrip(page));
  await page.screenshot({ path: `${outDir}/strip-1080p-before-run.png` });
  await page.getByRole("button", { name: "Run it on a fork of Base" }).click();
  const r0 = Date.now();
  await page.getByTestId("seal-check-model-priceUsd1e18:cbETH").or(page.getByTestId("seal-check-priceUsd1e18:cbETH")).first().waitFor({ timeout: 400000 });
  say(`run answered after ${Date.now() - r0} ms`);
  const run = JSON.parse(responses.find((r) => r.url.endsWith("/runs")).body);
  const modelValues = run.bets.filter((b) => b.who !== "human" && b.answer.kind !== "declined").map((b) => String(b.answer.value));
  say("model bets revealed after the run:", run.bets.filter((b) => b.who !== "human").map((b) => b.answer));
  say("pre-run strip holds the person's 2200 or a model bet value:", ["2200", ...modelValues].some((v) => preRunStrip.includes(v)));
  say("verdict row cbETH:", flat(await page.getByTestId("verdict-priceUsd1e18:cbETH").innerText()));
  say("captions:", flat(await page.getByTestId("captions").innerText()));
  await page.getByTestId("why-ask").click();
  await page.getByTestId("why").scrollIntoViewIfNeeded();
  say("why (moonwell):", flat(await page.getByTestId("why").innerText()));
  const m = await measureStrip(page);
  say("strip after the run (1920×1080):", m);
  await page.screenshot({ path: `${outDir}/strip-1080p.png` });
  // The same page on a 390 px phone: the strip collapses under the flow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("logstrip").scrollIntoViewIfNeeded();
  say("390 px: page wider than the screen:", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), "| strip below the flow:", await page.evaluate(() => document.querySelector("main").getBoundingClientRect().bottom <= document.querySelector('[data-testid="logstrip"]').getBoundingClientRect().top + 1));
  await page.screenshot({ path: `${outDir}/strip-390.png` });
  const proof = await page.evaluate(async (id) => (await fetch(`/api/proofs/${id}`)).json(), run.run.id);
  writeFileSync(`${outDir}/moonwell-session-events.json`, JSON.stringify({ runId: run.run.id, runStartedAt: run.run.startedAt, agentLog: proof.agentLog }, null, 2) + "\n");
  say("moonwell runId:", run.run.id, "| proof:", run.proof, "| session events:", proof.agentLog.length);
  say("page errors:", errors.length ? errors : "none");
  await page.close();
  return run.run.id;
}

const fx = await fixtureRound();
const mw = await moonwellRound();
writeFileSync(`${outDir}/browser-output.txt`, out.join("\n") + "\n");
console.log(JSON.stringify({ fixtureRunId: fx, moonwellRunId: mw }));
await browser.close();
