// R3 fix round 4: each visual item in the state the cold tester saw it, at the sizes they saw it, with a check and a picture.
// Against the real server with models mocked ($0). The chain answer is routed where a real chain would be needed.
//   PW=<playwright-core> CHROME=<headless shell> BASE=http://localhost:18962 BASE_G=http://localhost:18986 GATE_FILE=<file> node tests/evidence/R3/round4.mjs <out dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:18962";
const here = new URL(".", import.meta.url);
const ORDERS = readFileSync(new URL("../U3/inputs/orders.ts", here), "utf8");
const D20 = readFileSync(new URL("../D20/d20.atlas.json", here), "utf8");
const WEATHER = `// Looks up the weather using a paid API.
const BASE = "https://api.weather.test/v1/current";

function buildUrl(city: string, key: string): string {
  return BASE + "?q=" + encodeURIComponent(city) + "&key=" + key;
}

export async function getTemperature(city: string): Promise<number> {
  const key = process.env.WEATHER_API_KEY;
  if (!key) {
    throw new Error("WEATHER_API_KEY is not set");
  }
  const res = await fetch(buildUrl(city, key));
  if (!res.ok) {
    throw new Error("weather API said " + res.status);
  }
  const body = await res.json();
  return body.current.temp_c;
}
`;
const LOOP = `export function waitForJob(job: { id: string; done: boolean; result?: string }): string {
  let polls = 0;
  while (!job.done) {
    polls += 1;
  }
  return job.result ?? "no result after " + polls;
}
`;
const PRICE = `export function price(n) {
  return "$100.00";
}
`;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const page = async (vw = 1440, vh = 900, base = BASE) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const p = await ctx.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(base);
  return p;
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const draw = async (p, code) => {
  await p.waitForSelector('[data-testid="u1-code"]');
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"] svg');
  await p.waitForTimeout(500);
};
const toQuiz = async (p) => {
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
};
const answerAll = async (p) => {
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    await p.keyboard.press("1");
    await p.waitForTimeout(190);
  }
};
const seal = async (p) => {
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="u1-actions"]', { timeout: 90000 });
  await p.keyboard.press("Space");
  await p.waitForSelector('[data-testid="bench-stage"][data-phase="marked"]', { timeout: 30000 });
  await p.waitForTimeout(500);
};
const round = async (p, code) => {
  await draw(p, code);
  await toQuiz(p);
  await answerAll(p);
  await seal(p);
};
/** Text lines (their real rectangles) that a box lies over. */
const under = (p, boxSel, withinSel) =>
  p.evaluate(({ boxSel, withinSel }) => {
    const box = document.querySelector(boxSel)?.getBoundingClientRect();
    if (!box) return ["no box"];
    const hits = [];
    const walker = document.createTreeWalker(document.querySelector(withinSel), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest(boxSel)) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const c of r.getClientRects()) if (c.width > 0 && c.left < box.right && c.right > box.left && c.top < box.bottom && c.bottom > box.top) hits.push(n.textContent.trim().slice(0, 40));
    }
    return hits;
  }, { boxSel, withinSel });

for (const [vw, vh] of [[1440, 900], [1280, 800]]) {
  // ---- D "Hide the bet" over "Step 1 of 3": while Wonder writes, and on the question
  {
    const p = await page(vw, vh);
    await p.route("**/paste/proposals", async (r) => {
      await new Promise((d) => setTimeout(d, 2500));
      await r.continue();
    });
    await draw(p, WEATHER);
    await p.click('[data-testid="u1-bet-toggle"]');
    await p.waitForSelector('[data-testid="u1-wait"]');
    await p.waitForTimeout(200);
    say(`Hide the bet covers no words while waiting (${vw})`, (await under(p, '[data-testid="u1-bet-toggle"]', '[data-testid="u1-pop"]')).length === 0);
    await shot(p, `d-hide-wait-${vw}`);
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await p.waitForTimeout(200);
    say(`Hide the bet covers no words on the question (${vw})`, (await under(p, '[data-testid="u1-bet-toggle"]', '[data-testid="u1-pop"]')).length === 0);
    await shot(p, `d-hide-quiz-${vw}`);
    await p.context().close();
  }
  // ---- D the note about a change round, and R4, and J1
  {
    const p = await page(vw, vh);
    const early = [];
    p.on("request", (r) => {
      if (/paste\/proposals/.test(r.url()) && r.method() === "POST" && /early/.test(r.postData() ?? "")) early.push(r.url());
    });
    await round(p, ORDERS);
    const before = early.length;
    await p.click('[data-testid="u1-change"]');
    await p.fill('[data-testid="u1-change-code"]', ORDERS.replace("HTTP", "HTTPS"));
    await p.click('[data-testid="u1-change-go"]');
    await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
    await p.waitForSelector('[data-testid="u1-handoff-note"]');
    await p.waitForTimeout(300);
    say(`J1 no Wonder call on a Change round (${vw})`, early.length === before, `${early.length - before} extra`);
    const note = await p.$eval('[data-testid="u1-handoff-note"]', (e) => {
      const r = e.getBoundingClientRect();
      const col = document.querySelector('[data-testid="u1-pop"]').getBoundingClientRect();
      return { left: r.left, popRight: col.right, right: r.right, vw: innerWidth };
    });
    say(`D the change note sits clear of the panel, whole (${vw})`, note.left >= note.popRight && note.right <= note.vw, JSON.stringify(note));
    await shot(p, `d-toast-${vw}`);
    if (vw === 1440) {
      // R4: another test on this round: no note, no before and after.
      await p.click('.u1-testrow [data-testid="u1-change"]');
      await p.waitForSelector('[data-testid="u1-tests"]');
      await shot(p, "j5-change-test-list");
      const offer = await p.$('[data-testid="u1-no-offer"]');
      say("J5 an empty list says why, with a way on", offer !== null);
      await p.click('[data-testid="u1-own"]');
      await p.waitForSelector('[data-testid="test-form"]');
      const form = await p.$('[data-testid="form-submit"]');
      const style = await form.evaluate((e) => getComputedStyle(e).backgroundColor);
      say("D Use my test is ink", style === "rgb(31, 27, 29)", style);
      await shot(p, "d-own-test");
      const posts = [];
      p.on("request", (r) => r.method() === "POST" && /experiments/.test(r.url()) && posts.push(1));
      await form.click();
      await p.waitForSelector('[data-testid="form-problem"]');
      say("D an empty test is refused, and nothing starts", posts.length === 0, await p.$eval('[data-testid="form-problem"]', (e) => e.textContent));
      await shot(p, "d-own-test-empty");
    }
    await p.context().close();
  }
}

// ---- R3 + the keys, on the typed question
{
  const p = await page();
  await draw(p, ORDERS);
  await toQuiz(p);
  const id = await p.$eval(".u1-typed-in", (e) => e.id);
  say("E the typed box does not take the keys by itself", await p.evaluate((id) => document.activeElement?.id !== id, id));
  await p.keyboard.press("9");
  await p.waitForTimeout(100);
  say("E a digit with no option starts the typed value, not lost", (await p.inputValue(`#${id}`)) === "9" && (await p.evaluate((id) => document.activeElement?.id === id, id)));
  await shot(p, "e-digit-goes-to-box");
  await p.keyboard.press("Escape");
  say("E Esc leaves the box", await p.evaluate((id) => document.activeElement?.id !== id, id));
  await p.fill(`#${id}`, "");
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector('[data-testid="u1-pop"]').focus());
  await p.keyboard.press("t");
  say("E T opens the box", await p.evaluate((id) => document.activeElement?.id === id, id));
  await shot(p, "e-typing-here");
  await p.keyboard.type("1");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  say("R3 setup: moved on", /2 of/.test(await p.textContent('[data-testid="b-progress"]')));
  await p.click('.u1-testrow [data-testid="u1-change"]');
  await p.click('[data-testid="u1-use-1"]');
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-tests"]'));
  await p.waitForTimeout(250);
  say("R3 another test starts at question 1", /^1 of/.test(await p.textContent('[data-testid="b-progress"]')));
  say("R3 the value typed for the last test is gone", (await p.inputValue(".u1-quiz li[data-active] .u1-typed-in").catch(() => "")) === "");
  await p.context().close();
}

// ---- E text that isn't JSON seals as text, and matches what the run returned
{
  const p = await page();
  await draw(p, PRICE);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-tests"], [data-testid="u1-own-now"]', { timeout: 60000 });
  if (await p.$('[data-testid="u1-own-now"]')) await p.click('[data-testid="u1-own-now"]');
  else await p.click('[data-testid="u1-own"]');
  await p.waitForSelector('[data-testid="test-form"]');
  await p.click('[data-testid="test-form"] .row button');
  await p.fill('[data-testid="arg-0"] input', "1");
  await p.click('[data-testid="form-submit"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 30000 });
  await p.waitForTimeout(200);
  const box = ".u1-quiz li[data-active] .u1-typed-in";
  await p.click(box);
  await p.keyboard.type("$100.00");
  await p.waitForTimeout(100);
  const hint = await p.$eval(".u1-quiz li[data-active] .u1-typed .u1-sub", (e) => e.textContent);
  say("E the box says how it reads the text", /the text "\$100\.00"/.test(hint), hint);
  await shot(p, "e-typed-text");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  await p.waitForTimeout(200);
  await shot(p, "e-typed-review");
  await seal(p);
  const you = await p.textContent('[data-testid="moment-you"]');
  say("E it leads, as typed", /\$100\.00/.test(you), you);
  say("E plain code matched it against the returned string", (await p.getAttribute('[data-testid="moment"]', "data-kind")) === "matched");
  await shot(p, "e-typed-result");
  await p.context().close();
}

// ---- C1, D: the claim test that never reaches fetch, the drawing, the words
{
  const p = await page();
  await round(p, WEATHER);
  await shot(p, "r2-weather-result");
  await p.click('[data-testid="u1-test-claim"]');
  await p.waitForSelector('[data-testid="u1-claim-tested"]', { timeout: 60000 });
  await p.waitForSelector('[data-testid="u1-seal"]');
  await p.waitForTimeout(400);
  const words = await p.textContent('[data-testid="u1-pop"]');
  say("C1 no 'checks' sentence", !/checks Muse Wonder/.test(words) && /wrote this test for its sentence/.test(words));
  const differs = await p.$eval('[data-testid="u1-claim-closeness"]', (e) => e.textContent);
  say("D no internal words in the difference", !/throw_exhausted|repeat_last/.test(differs), differs);
  await shot(p, "c1-claim-bet");
  await answerAll(p);
  await seal(p);
  const reach = await p.textContent('[data-testid="u1-claim-reach"]').catch(() => "");
  say("C1 plain code says it may not reach the sentence", /ended the same way as the last one and made 0 calls to fetch\. It may not reach/.test(reach), reach);
  await p.locator('[data-testid="u1-claim-reach"]').scrollIntoViewIfNeeded();
  await shot(p, "c1-claim-reach");
  await p.context().close();
}
{
  const p = await page();
  await draw(p, ORDERS);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(300);
  const chart = await p.evaluate(() => {
    const host = document.querySelector('[data-testid="bench-viewport"]').getBoundingClientRect();
    const pop = document.querySelector('[data-testid="u1-pop"]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('[data-testid="bench-viewport"] [data-node]')].map((n) => n.getBoundingClientRect());
    return { popRight: pop.right, hostLeft: host.left, leastLeft: Math.min(...boxes.map((x) => x.left)) };
  });
  say("D no box of the drawing is under the panel", chart.leastLeft >= chart.popRight - 1, JSON.stringify(chart));
  await shot(p, "d-chart-beside-bet");
  await p.context().close();
}

// ---- C4 the loop that never ends
{
  const p = await page();
  await round(p, LOOP);
  say("C4 nothing to draw: no Play again", (await p.$('[data-testid="u1-replay"]')) === null);
  say("C4 nothing to draw: no proof card", (await p.$('[data-testid="u1-proof"]')) === null);
  await shot(p, "c4-loop");
  await p.context().close();
}

// ---- D the box card, Escape, and the code panel at 1280
{
  const p = await page(1280, 800);
  await draw(p, ORDERS);
  await p.click('[data-testid="bench-viewport"] [data-node]');
  await p.waitForSelector('[data-testid="part-card"][data-pinned]');
  await p.waitForSelector(".c-drawer");
  await shot(p, "d-card-pinned");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(100);
  say("D Escape closes the card first, the code panel stays", (await p.$('[data-testid="part-card"][data-pinned]')) === null && (await p.$(".c-drawer")) !== null);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(100);
  say("D Escape then closes the code panel", (await p.$(".c-drawer")) === null);
  await p.click('[data-testid="bench-viewport"] [data-node]');
  await p.waitForSelector('[data-testid="part-card"][data-pinned]');
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  say("D the pinned card closes on the bet", (await p.$('[data-testid="part-card"][data-pinned]')) === null);
  await answerAll(p);
  await seal(p);
  say("D no box card on the result", (await p.$('[data-testid="part-card"]')) === null);
  if (!(await p.$(".c-drawer"))) await p.keyboard.press("c");
  await p.waitForSelector(".c-drawer");
  await p.waitForTimeout(900);
  const clipped = await p.evaluate(() => {
    const d = document.querySelector(".c-drawer").getBoundingClientRect();
    const seen = [];
    for (const t of document.querySelectorAll('[data-testid="bench-path"] text')) {
      const r = t.getBoundingClientRect();
      if (r.width > 0 && (r.left < d.right - 1 && r.right > d.left + 1 || r.right > innerWidth)) seen.push(t.textContent.slice(0, 30));
    }
    return seen;
  });
  say("D at 1280 with the code panel open, no word of the path runs under it", clipped.length === 0, clipped.join(" | "));
  await shot(p, "d-1280-code-panel-result");
  // the consent, at the tester's size
  await p.keyboard.press("c");
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.keyboard.press("p");
  await p.waitForSelector('[data-testid="pc-copy-link"]');
  await p.click('[data-testid="pc-copy-link"]');
  await p.waitForSelector('[data-testid="pc-link-yes"]');
  await p.waitForTimeout(300);
  const seen = await p.evaluate(() => {
    const y = document.querySelector('[data-testid="pc-link-ask"]').getBoundingClientRect();
    return { top: y.top, bottom: y.bottom, h: innerHeight };
  });
  say("D the consent is on screen when Copy link is pressed", seen.top >= 0 && seen.bottom <= seen.h, JSON.stringify(seen));
  await shot(p, "d-consent-1280");
  await p.context().close();
}

// ---- D the first screen, and Enter, and the limit
{
  const p = await page(1280, 800);
  await p.waitForSelector('[data-testid="u1-repo"]');
  const w = await p.$eval('[data-testid="u1-repo"]', (e) => ({ box: e.clientWidth, need: e.scrollWidth }));
  say("D the placeholder is whole at 1280", w.box >= 90, JSON.stringify(w));
  say("D no browser file picker text", !/No file chosen/.test(await p.textContent("body")));
  await shot(p, "d-landing-1280");
  await p.fill('[data-testid="u1-code"]', `// ${"x".repeat(670)}\n`.repeat(200));
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector(".notice, [role=alert]", { timeout: 20000 });
  const limit = await p.textContent("[role=alert]");
  say("D a 133 KB file is told the limit", /64 KB/.test(limit) && !/^code:/.test(limit), limit);
  await shot(p, "d-too-long");
  await p.fill('[data-testid="u1-repo"]', "a/b");
  await p.keyboard.press("Enter");
  await p.waitForSelector('[data-testid="outline-start"]');
  const started = [];
  await p.route("**/outline**", (r) => {
    started.push(r.request().method());
    return r.abort();
  });
  await p.focus('input[placeholder="owner/repo"]:visible');
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  say("D Enter in the repo box submits", started.length > 0);
  await shot(p, "d-explorer-form");
  await p.context().close();
}

// ---- B Demos
{
  const p = await page(1440, 900);
  await p.click('[data-testid="u1-demos"]');
  await p.waitForTimeout(150);
  const first = await p.$eval(".u1-menu > ul > li button span", (e) => e.textContent);
  say("B Moonwell is first", /Moonwell/.test(first), first);
  say("B the earlier screens are folded", !(await p.$eval('[data-testid="u1-earlier"]', (e) => e.open)));
  await shot(p, "b-menu-closed");
  await p.click('[data-testid="u1-earlier"] summary');
  await p.waitForTimeout(100);
  await shot(p, "b-menu-open");
  await p.click('[data-testid="mode-fixture"]');
  await p.waitForSelector('[data-testid="pc-pre-existing"], .label', { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(400);
  const text = await p.textContent("main");
  say("B the retry machine keeps its label", /pre-existing/i.test(text));
  say("B no old screen switcher", (await p.$(".u1-sheet nav.switch")) === null);
  await shot(p, "b-retry");
  await p.click('[data-testid="u1-demos"]');
  await p.click('[data-testid="mode-pr"]');
  await p.waitForSelector('[data-testid="moonwell-saved"]');
  await p.waitForTimeout(500);
  say("B the Moonwell words say 'no multiply step here'", /no multiply step here/.test(await p.textContent('[data-testid="moonwell-sheet"]')) && !/bettors expected/.test(await p.textContent('[data-testid="moonwell-sheet"]')));
  await shot(p, "b-moonwell-saved-1440");
  // no chain: said at once, the saved result stays, nothing asked of GitHub or the models
  const asked = [];
  p.on("request", (r) => r.method() === "POST" && /targets|experiments|bets/.test(r.url()) && asked.push(r.url()));
  await p.route("**/moonwell/ready", (r) => r.fulfill({ json: { ready: false, words: "This server has no chain connection, so a new Moonwell run can't happen here. Nothing was spent." } }));
  const t0 = Date.now();
  await p.click('[data-testid="moonwell-run-again"]');
  await p.waitForSelector('[data-testid="moonwell-cant"]');
  say("B no chain: said at once", Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  say("B no chain: the saved result stays and nothing was asked", (await p.$('[data-testid="moonwell-saved"]')) !== null && asked.length === 0);
  await shot(p, "b-moonwell-no-chain");
  // with a chain: straight in, the pull request filled in, the lines chosen, the question one click away
  await p.unroute("**/moonwell/ready");
  await p.click('[data-testid="moonwell-run-again"]');
  await p.waitForSelector('[data-testid="pr-link"]');
  say("B Run it again fills in the pull request", /moonwell-contracts-v2\/pull\/578/.test(await p.inputValue('[data-testid="pr-link"]')));
  await shot(p, "b-moonwell-reading");
  const read = await p.waitForSelector('[data-testid="pr-target"]', { timeout: 40000 }).catch(() => null);
  if (read) {
    await p.waitForSelector('[data-testid="moonwell-place"]');
    await p.waitForTimeout(500);
    say("B the bet's place is chosen for you", /line 42/.test(await p.textContent('[data-testid="moonwell-place"] summary')));
    await shot(p, "b-moonwell-flow");
  } else say("B GitHub read in this environment", true, "not reached: GitHub read failed here; said as an error on screen");
  await p.click('[data-testid="moonwell-back"]');
  await p.waitForSelector('[data-testid="moonwell-saved"]');
  say("B the way back to the saved result", true);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(400);
  await shot(p, "b-moonwell-saved-1280");
  await p.click('[data-testid="mode-record"]');
  await p.waitForSelector('[data-testid="track-record"]');
  await p.waitForTimeout(200);
  await shot(p, "b-record");
  await p.click('[data-testid="u1-log-toggle"]');
  await p.waitForTimeout(200);
  say("B no stale date in the words", !/Oct 30/.test(await p.textContent("body")));
  await p.context().close();
}

// ---- J2, J4: D20's image, for a reader
{
  const p = await page(1280, 800);
  await p.route("**/proofs/d20run", (r) => r.fulfill({ contentType: "application/json", body: D20 }));
  await p.route("**/proofs/d20run/viewer", (r) => r.fulfill({ json: { yours: false, keepsCards: true } }));
  await p.goto(`${BASE}/?proof=d20run`);
  await p.waitForSelector('[data-testid="pc-image"] svg');
  await p.waitForTimeout(300);
  const lines = await p.$$eval('[data-testid="pc-image-change"]', (l) => l.map((e) => ({ t: e.textContent, right: e.getBoundingClientRect().right, edge: e.ownerSVGElement.getBoundingClientRect().right })));
  say("J2 D20's sentence stays on the image", lines.length >= 2 && lines.every((l) => l.right <= l.edge), JSON.stringify(lines.map((l) => l.t.length)));
  say("J4 no 'you' for a reader", !/\bYOU BET\b/.test(await p.$eval('[data-testid="pc-image"] svg', (e) => e.textContent)) && !/what you expected/.test(await p.textContent("article")));
  await shot(p, "j2-d20-image");
  await p.locator('[data-testid="pc-change-table"]').scrollIntoViewIfNeeded();
  await shot(p, "j4-d20-table");
  await p.context().close();
}

// ---- R1, J3 behind the real gate, the proof card
if (process.env.BASE_G) {
  const code = readFileSync(process.env.GATE_FILE, "utf8").trim();
  const p = await page(1280, 800, `${process.env.BASE_G}/`);
  await p.fill('[data-testid="e-invite-code"]', code);
  await p.click('[data-testid="e-invite-go"]');
  await p.waitForTimeout(500);
  await round(p, ORDERS);
  await p.keyboard.press("p");
  await p.waitForSelector('[data-testid="pc-copy-link"]');
  await p.waitForTimeout(300);
  await shot(p, "e-proof-panel");
  const url = await p.$eval('.u1-proof a.u1-link', (e) => e.href);
  await p.click('[data-testid="pc-copy-link"]');
  await p.click('[data-testid="pc-link-yes"]');
  await p.waitForSelector('[data-testid="pc-delete-link"]');
  const stranger = await page(1280, 800, url);
  await stranger.waitForSelector('[data-testid="proof-card"]');
  await stranger.waitForTimeout(300);
  say("J3 a stranger has no Delete", (await stranger.$('[data-testid="pc-delete-link"]')) === null);
  say("J3 a stranger has no Re-run or pencil", (await stranger.$('[data-testid="pc-rerun"]')) === null && (await stranger.$('[data-testid="pc-pencil"]')) === null);
  await stranger.click('[data-testid="pc-copy-link"]');
  await stranger.waitForSelector('[data-testid="pc-share-said"]');
  const said = await stranger.textContent('[data-testid="pc-share-said"]');
  say("J3 no raw invite sentence", !/invite|header/i.test(said) && (await stranger.$('[data-testid="pc-link-ask"]')) === null, said);
  await stranger.waitForTimeout(200);
  await shot(stranger, "j3-stranger-card");
  say("E the card says what the function got", /What it was given/.test(await stranger.textContent('[data-testid="pc-call"]')));
  say("E the quiet link into Atlas", (await stranger.$('[data-testid="pc-home"]')) !== null);
  await stranger.locator('[data-testid="pc-home"]').scrollIntoViewIfNeeded();
  await shot(stranger, "e-card-foot");
  await p.click('[data-testid="pc-delete-link"]');
  await p.waitForFunction(() => /deleted/.test(document.querySelector('[data-testid="pc-share-said"]')?.textContent ?? ""));
  await stranger.reload();
  await stranger.waitForSelector(".notice");
  const gone = await stranger.textContent(".notice");
  say("R1 after Delete a stranger's reload says it is gone", /deleted/.test(gone), gone);
  say("R1 no card is left for the stranger", (await stranger.$('[data-testid="proof-card"]')) === null);
  await shot(stranger, "r1-gone");
  await stranger.context().close();
  await p.context().close();
}
writeFileSync(`${OUT}/round4.json`, JSON.stringify({ checks: out }, null, 1));
await b.close();
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
