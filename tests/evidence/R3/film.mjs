// R3 phase 2: the hero film, from the real app (not the preview page): paste → the chart draws itself → the bet → the run → the
// verdict, on the real server with mocked models. Chromium's screencast through Playwright; ffmpeg encodes it afterwards.
//   PW=... CHROME=... BASE=http://localhost:18962 node tests/evidence/R3/film.mjs <out dir> [scheme]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(process.env.PW);
const [out, scheme = "light"] = process.argv.slice(2);
const frames = `${out}/frames`;
mkdirSync(frames, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: scheme });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const list = [];
cdp.on("Page.screencastFrame", async (f) => {
  const file = `f${String(list.length).padStart(5, "0")}.jpg`;
  writeFileSync(`${frames}/${file}`, Buffer.from(f.data, "base64"));
  list.push({ file, t: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await p.goto(process.env.BASE ?? "http://localhost:18962/");
await p.waitForSelector('[data-testid="u1-code"]');
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
await p.waitForTimeout(1400);
const code = readFileSync(new URL("../U3/inputs/orders.ts", import.meta.url), "utf8");
// A real paste event: the chart starts with no button pressed.
await p.locator('[data-testid="u1-code"]').focus();
await p.evaluate((text) => {
  const dt = new DataTransfer();
  dt.setData("text", text);
  document.querySelector('[data-testid="u1-code"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, code);
await p.waitForSelector('[data-testid="bench-stage"]', { state: "visible", timeout: 30000 });
await p.waitForTimeout(5000);
await p.click('[data-testid="u1-bet-toggle"]');
await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
await p.waitForTimeout(1600);
const qs = await p.$$(".u1-quiz > li");
for (const [i, want] of [[0, 1], [2, 1]]) {
  const o = await qs[i]?.$$(".u1-opt");
  if (o?.[want]) {
    await o[want].click();
    await p.waitForTimeout(700);
  }
}
await p.click('[data-testid="u1-seal"]');
await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, { timeout: 30000 });
await p.waitForTimeout(3500);
await cdp.send("Page.stopScreencast");
await ctx.close();
await b.close();
const lines = list.map((f, i) => `file '${f.file}'\nduration ${((list[i + 1]?.t ?? f.t + 0.04) - f.t).toFixed(4)}`);
writeFileSync(`${frames}/list.txt`, `${lines.join("\n")}\n`);
console.log(`${list.length} frames, ${(list[list.length - 1].t - list[0].t).toFixed(1)} s`);
