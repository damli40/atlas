// U2 walkthrough driver: paste a file, open the bet, tap answers, seal, watch the run, replay, proof card.
// Usage: node walk.cjs <pageUrl> <codeFile> <lang> <outDir> [headed]
const { chromium } = require(process.env.PW || "playwright");
const fs = require("fs");
const path = require("path");
const [url, codeFile, lang, out, headed] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const log = [];
const say = (...a) => { const l = a.join(" "); log.push(l); console.log(l); };
(async () => {
  const home = require("os").homedir() + "/Library/Caches/ms-playwright/";
  const exe = headed === "headed" ? home + "chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" : home + "chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell";
  const browser = await chromium.launch({ headless: headed !== "headed", executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => say("[pageerror]", e.message));
  const shot = async (name) => page.screenshot({ path: path.join(out, name + ".png") });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle" });
  await shot("01-arrive");
  const code = fs.readFileSync(codeFile, "utf8");
  await page.getByTestId("u1-code").fill(code);
  await page.getByTestId("u1-lang").selectOption(lang);
  await page.getByTestId("u1-draw").click();
  await page.getByTestId("bench-stage").waitFor();
  await page.waitForTimeout(1500);
  await shot("02-drawn");
  const hit = page.locator("[data-hit]").first();
  const hb = await hit.boundingBox();
  if (hb) { await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.waitForTimeout(400); await shot("02b-hover"); say("hover card:", (await page.getByTestId("part-card").innerText().catch(() => "")).replace(/\n/g, " / ")); await page.mouse.move(5, 500); }
  // hover the function under test
  await page.getByTestId("u1-bet-toggle").click();
  const tw = Date.now();
  await page.waitForTimeout(1000);
  await shot("02c-writing");
  await page.getByTestId("u1-test").waitFor({ timeout: 300000 });
  say("wonder took s:", Math.round((Date.now() - tw) / 1000));
  await page.waitForTimeout(500);
  await shot("03-bet-open");
  say("test:", await page.getByTestId("u1-test").innerText());
  await page.getByTestId("u1-change").click(); await page.waitForTimeout(300); await shot("03b-picker");
  say("picker:", (await page.getByTestId("u1-tests").innerText()).replace(/\n/g, " | ").slice(0, 1200));
  await page.getByText("Back to the quiz").click();
  say("explain:", (await page.getByTestId("u1-explain").innerText()).replace(/\n/g, " | "));
  say("models:", (await page.getByTestId("u1-models").innerText()).replace(/\n/g, " | "));
  // tap answers by accessible name: the first option of each question (checks no layer blocks the buttons)
  const groups = page.locator(".u1-opts");
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    const first = groups.nth(i).getByRole("radio").first();
    const name = await first.innerText();
    await groups.nth(i).getByRole("radio", { name, exact: true }).click({ timeout: 5000 });
    say(`tapped q${i + 1}:`, name);
  }
  await page.locator(".u1-pop").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(300);
  await shot("04-before-seal");
  const sealBox = await page.getByTestId("u1-seal").boundingBox();
  const modelsBox = await page.getByTestId("u1-models").boundingBox();
  say("models line above seal:", modelsBox.y < sealBox.y);
  await page.getByRole("button", { name: "Seal my answers" }).click({ timeout: 5000 });
  const tSeal = Date.now();
  await page.waitForSelector('[data-testid="bench-stage"][data-phase="playing"]', { timeout: 120000 });
  const tPlay = Date.now();
  for (const ms of [500, 1500, 3000, 4500]) { await page.waitForTimeout(ms - (Date.now() - tPlay) > 0 ? ms - (Date.now() - tPlay) : 0); await shot(`05-play-${ms}ms`); }
  await page.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 60000 });
  const playMs = Date.now() - tPlay;
  say("play took ms:", playMs, "(seal to play start:", tPlay - tSeal, ")");
  await page.waitForTimeout(500);
  await shot("06-marked");
  say("headline:", await page.getByTestId("u1-headline").innerText());
  say("marks:", (await page.getByTestId("mark-list").innerText()).replace(/\n/g, " | ").slice(0, 1500));
  await page.getByTestId("u1-replay").click();
  await page.waitForTimeout(1500);
  const phase = await page.getByTestId("bench-stage").getAttribute("data-phase");
  say("replay phase after 1.5 s:", phase);
  await shot("07-replay-1500ms");
  await page.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 60000 });
  await page.getByTestId("u1-proof").click();
  await page.getByTestId("u1-proof-panel").waitFor();
  await page.waitForTimeout(1500);
  await shot("08-proof");
  say("proof panel text:", (await page.getByTestId("u1-proof-panel").innerText()).slice(0, 300).replace(/\n/g, " | "));
  await page.getByRole("button", { name: "Close the proof card" }).click();
  say("claim:", await page.getByTestId("u1-claim").innerText().catch(() => "(none)"));
  if (await page.locator('[data-testid="u1-next"]').count()) say("next tries:", (await page.getByTestId("u1-next").innerText()).replace(/\n/g, " | "));
  if (await page.getByTestId("u1-test-claim").count()) {
    await shot("09-claim");
    await page.getByTestId("u1-test-claim").click();
    const tc = Date.now();
    await page.getByTestId("u1-test").waitFor({ timeout: 300000 }).catch(() => null);
    say("test this claim took s:", Math.round((Date.now() - tc) / 1000));
    await page.waitForTimeout(600);
    await shot("10-claim-test");
    say("claim test:", await page.getByTestId("u1-test").innerText().catch(() => "(no test)"));
    if (await page.getByTestId("u1-left-out").count()) say("left out:", await page.getByTestId("u1-left-out").innerText());
    const g2 = page.locator(".u1-opts");
    for (let i = 0; i < await g2.count(); i++) await g2.nth(i).getByRole("radio").nth(1).click({ timeout: 5000 }).catch(() => null);
    await page.getByRole("button", { name: "Seal my answers" }).click({ timeout: 5000 }).catch(() => null);
    await page.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 300000 }).catch(() => null);
    await page.waitForTimeout(800);
    await shot("11-claim-marked");
    say("claim headline:", await page.getByTestId("u1-headline").innerText().catch(() => "(none)"));
    say("claim marks:", (await page.getByTestId("mark-list").innerText().catch(() => "")).replace(/\n/g, " | ").slice(0, 1500));
  }
  fs.writeFileSync(path.join(out, "walk-log.txt"), log.join("\n") + "\n");
  await ctx.close();
  await browser.close();
  say("total s:", Math.round((Date.now() - t0) / 1000));
})().catch((e) => { say("FAILED:", e.message); fs.writeFileSync(path.join(out, "walk-log.txt"), log.join("\n") + "\n"); process.exit(1); });
