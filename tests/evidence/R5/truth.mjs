// D65 review: through the machine view, on real runs: what is red, what is ringed, which threads ran, which dial moved. Models mocked, $0. Every line here failed at 2859dab, or holds a rule that did.
//   PW=<playwright-core> CHROME=<headless shell> node tests/evidence/R5/truth.mjs <out dir>       (add BASE=<page> to use a page already running)
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const { chromium } = await import(process.env.PW);
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
// With no BASE it starts its own mock server and page, and stops them at the end: it needs nothing else running.
let BASE = process.env.BASE;
const helpers = [];
if (!BASE) {
  const root = new URL("../../../", import.meta.url).pathname;
  const usage = `${process.env.TMPDIR ?? "/tmp"}/truth-usage-${process.pid}.jsonl`;
  const start = (bin, args, env) => helpers.push(spawn(`${root}node_modules/.bin/${bin}`, args, { cwd: root, detached: true, stdio: "ignore", env: { ...process.env, ...env } }));
  start("tsx", ["tests/evidence/U3/mock-server.ts"], { PORT: "18971", ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR: "2000", ATLAS_PASTES_PER_IP_PER_HOUR: "2000", U3_WONDER_DELAY_MS: "100", U3_QUIET_MOCK: "1", ATLAS_USAGE_PATH: usage });
  start("vite", ["--port", "18972", "--strictPort"], { ATLAS_API_PORT: "18971" });
  BASE = "http://localhost:18972";
  const up = async (url) => {
    for (let i = 0; i < 120; i++) {
      if (await fetch(url).then((r) => r.status < 500, () => false)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`nothing answered at ${url}`);
  };
  await up("http://localhost:18971/health");
  await up(BASE);
  process.on("exit", () => helpers.forEach((h) => { try { process.kill(-h.pid); } catch { /* already gone */ } }));
}
const b = await chromium.launch({ executablePath: process.env.CHROME });
const out = [];
let failed = 0;
const say = (name, ok, more = "") => {
  out.push({ name, ok, more });
  if (!ok) failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${more ? `: ${more}` : ""}`);
};
const state = (p) =>
  p.evaluate(() => {
    const svg = document.querySelector('[data-testid="machine"] svg');
    if (!svg) return { noMachine: document.querySelector('[data-testid="machine-too-many"]')?.textContent ?? "no machine", view: document.querySelector('[data-testid="bench-stage"]')?.dataset.view };
    const vis = (e) => getComputedStyle(e).visibility === "visible";
    const partOf = (e) => e.closest("[data-part]")?.getAttribute("data-part");
    const end = svg.querySelector(".m-end[data-ring]");
    return {
      ended: svg.hasAttribute("data-ended"),
      redChutes: [...svg.querySelectorAll(".m-hit-only")].filter(vis).map(partOf),
      ran: [...svg.querySelectorAll(".m-thread[data-ran]")].map((t) => t.dataset.route),
      lamps: [...svg.querySelectorAll(".m-lamp[data-on]")].map((l) => l.dataset.lamp),
      needles: [...svg.querySelectorAll(".m-needle")].filter((n) => n.style.transform).map((n) => n.dataset.dial),
      ring: end && vis(end) ? { part: end.dataset.ring, on: end.dataset.ringOn } : null,
      words: [...svg.querySelectorAll(".m-end text")].filter(vis).map((t) => t.textContent).join(" "),
      labels: [...svg.querySelectorAll("[data-part]")].map((x) => x.getAttribute("aria-label")),
    };
  });
const round = async (name, code, want, o = {}) => {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ...(o.reduced ? { reducedMotion: "reduce" } : {}) });
  const p = await c.newPage();
  p.on("pageerror", (e) => say("no page error", false, e.message));
  await p.goto(BASE);
  await p.fill('[data-testid="u1-code"]', code);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(300);
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  const n = (await p.$$(".u1-quiz > li")).length;
  for (let i = 0; i < n; i++) {
    const li = (await p.$$(".u1-quiz > li"))[i];
    const q = await li.$eval(".u1-q", (e) => e.textContent);
    const opts = await li.$$eval(".u1-opt", (x) => x.map((y) => y.textContent));
    let k = opts.length - 1;
    if (o.bet && /What does/.test(q)) k = opts.findIndex((t) => o.bet.test(t));
    await p.keyboard.press(String(k + 1));
    await p.waitForTimeout(210);
  }
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(600);
  const s = await state(p);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  want(s, (what, ok) => say(`${name}: ${what}`, ok, ok ? "" : JSON.stringify({ red: s.redChutes, ring: s.ring, ran: s.ran, needles: s.needles, lamps: s.lamps, no: s.noMachine })));
  if (o.after) await o.after(p);
  await c.close();
};
const J = (k, src) => `// CASE_${k}\n${src}`;
const RET = /returns a value/;
const THR = /^throws/;
const one = `export function f(x) {\n  if (x === 9) throw new Error("no");\n  return 1;\n}\n`;
await round("returned-with-a-chute", J("noarg", one), (s, t) => {
  t("it returned, so no chute is red", s.redChutes.length === 0);
  t("a matched bet has no ring", s.ring === null);
}, { bet: RET });
await round("returned-bet-throws", J("noarg", one), (s, t) => {
  t("no chute is red", s.redChutes.length === 0);
  t("the ring is on the outlet", s.ring?.on === "outlet" && s.ring.part === "f");
}, { bet: THR });
await round("own-throw", J("noarg", `export function f() {\n  throw new Error("mine");\n}\n`), (s, t) => {
  t("its chute is red", s.redChutes.length === 1 && s.redChutes[0] === "f#chute");
  t("the ring is on that chute", s.ring?.on === "chute" && s.ring.part === "f");
}, { bet: RET });
await round("fake-threw-unrelated-chute", J("xthrows", `function validate(v) {\n  if (!v) throw new Error("bad");\n}\nexport async function f(x) {\n  return await x();\n}\n`), (s, t) => {
  t("the chute of a function that never ran is not red", s.redChutes.length === 0);
  t("the ring is on the fake", s.ring?.on === "port" && s.ring.part === "stand-in x");
}, { bet: RET });
await round("caught-upstream", J("noarg", `function boom() {\n  throw new Error("x");\n}\nexport function f() {\n  try { boom(); } catch (e) {}\n  return 1;\n}\n`), (s, t) => {
  t("a throw caught upstream draws no red", s.redChutes.length === 0);
}, { bet: THR });
await round("caught-then-other", J("noarg", `function boom() {\n  throw new Error("x");\n}\nfunction real() {\n  throw new Error("real");\n}\nexport function f() {\n  try { boom(); } catch (e) {}\n  real();\n}\n`), (s, t) => {
  t("not the one that was caught", !s.redChutes.includes("boom#chute") && s.ring?.part !== "boom");
}, { bet: RET });
await round("library-threw", J("noarg", `export function f() {\n  if (Date.now() < 0) throw new Error("mine");\n  return JSON.parse("{");\n}\n`), (s, t) => {
  t("an error no throw here made: nothing red, nothing ringed", s.redChutes.length === 0 && s.ring === null);
  t("the words stand alone", /you said/.test(s.words));
}, { bet: RET });
await round("dial-not-run", J("xwait", `function slow() {\n  return new Promise((r) => setTimeout(r, 100));\n}\nexport async function f(x) {\n  await x();\n  return 1;\n}\n`), (s, t) => {
  t("the dial of a function that never ran does not move", s.needles.length === 0);
}, { bet: RET });
await round("stale-helper", J("noarg", `function b() {\n  return 2;\n}\nfunction a(flag) {\n  if (flag) b();\n  return 1;\n}\nexport function f() {\n  a(false);\n  b();\n  return 3;\n}\n`), (s, t) => {
  t("no thread for a call that didn't happen", !s.ran.includes("a->b"));
}, { bet: RET });
await round("two-callers", J("plain", `function h(x) {\n  return x();\n}\nexport async function f(x) {\n  if (x === 0) x();\n  return await h(x);\n}\n`), (s, t) => {
  t("a fake with two possible callers: no thread into it", !s.ran.some((r) => r.endsWith("stand-in x")));
  t("its lamp is lit: it was called", s.lamps.includes("stand-in x"));
}, { bet: RET });
await round("uses-not-wraps", J("noarg", `function fmt(v) {\n  return v;\n}\nexport function f(a = []) {\n  return a.map(fmt);\n}\n`), (s, t) => {
  t("says uses, never wraps", s.labels.some((l) => l === "f uses fmt") && !s.labels.some((l) => /wraps/.test(l)));
}, { bet: RET });
await round("callback-return", J("noarg", `export function f(a = []) {\n  a.forEach((v) => {\n    return v;\n  });\n}\n`), (s, t) => {
  t("no spout from a callback's return", !s.labels.some((l) => /returns/.test(l)));
}, { bet: RET });
// The final review's false rings: a throw that exists is not the throw that ended the run. Nothing is placed, and the words stand alone.
const noRing = (s, t) => {
  t("no chute is red", s.redChutes.length === 0);
  t("nothing is ringed", s.ring === null);
};
await round("same-text-in-class-method", J("noarg", `class V {\n  check() {\n    throw new Error("invalid");\n  }\n}\nexport function f(x) {\n  if (x === null) throw new Error("invalid");\n  return new V().check();\n}\n`), noRing, { bet: RET });
await round("same-text-in-nested-closure", J("noarg", `function h(flag) {\n  if (flag) throw new Error("bad");\n  return 1;\n}\nexport function f() {\n  h(false);\n  const g = () => { throw new Error("bad"); };\n  g();\n}\n`), noRing, { bet: RET });
await round("caught-then-same-text-built-elsewhere", J("noarg", `function h() {\n  throw new Error("x");\n}\nfunction mk() {\n  return new Error("x");\n}\nexport function f() {\n  try { h(); } catch (e) {}\n  throw mk();\n}\n`), noRing, { bet: RET });
await round("template-opening-words", J("noarg", "export function g(s) {\n  if (s === 1) throw new SyntaxError(`Unexpected ${s}`);\n  return JSON.parse('<');\n}\nexport function f() {\n  return g(0);\n}\n"), noRing, { bet: RET });
await round("function-returning-a-function", J("noarg", `export const f = (a) => (b) => {\n  for (const v of [a]) if (v) throw new Error("late");\n  return b;\n};\n`), (s, t) => {
  t("no throw or loop from the inner function", !s.labels.some((l) => /throws|loop/.test(l)));
}, { bet: THR });
await round("wait-never-reached", J("flagfalse", `export async function f(x, flag) {\n  await x();\n  if (flag) await new Promise((r) => setTimeout(r, 100));\n  return 1;\n}\n`), (s, t) => {
  t("the dial stays still: a fake's delay moved the clock", s.needles.length === 0);
}, { bet: THR });
await round("reduced-motion", J("noarg", one), (s, t) => {
  t("reduced motion: the same truth", s.redChutes.length === 0 && s.ring?.on === "outlet");
}, { bet: THR, reduced: true });
await round("m-twice", J("noarg", `export function f() {\n  throw new Error("mine");\n}\n`), () => {}, {
  bet: RET,
  after: async (p) => {
    await p.keyboard.press("m");
    await p.waitForTimeout(300);
    await p.keyboard.press("m");
    await p.waitForTimeout(500);
    const s = await state(p);
    say("J1: M twice keeps the result on the machine", s.ended === true && s.ring?.on === "chute" && s.redChutes.length === 1, JSON.stringify({ ended: s.ended, ring: s.ring }));
    await p.screenshot({ path: `${OUT}/m-twice-after.png` });
  },
});
{
  // J1: chart first, then M.
  const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await c.addInitScript(() => sessionStorage.setItem("atlas-view", "chart"));
  const p = await c.newPage();
  await p.goto(BASE);
  await p.fill('[data-testid="u1-code"]', J("noarg", `export function f() {\n  throw new Error("mine");\n}\n`));
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.click('[data-testid="u1-bet-toggle"]');
  await p.waitForSelector('[data-testid="u1-seal"]', { timeout: 60000 });
  await p.waitForTimeout(250);
  await p.click('[data-testid="u1-seal"]');
  await p.waitForSelector('[data-testid="mark-list"]', { timeout: 90000 });
  await p.waitForFunction(() => !document.querySelector('[data-testid="u1-replay"]')?.disabled, null, { timeout: 15000 }).catch(() => {});
  await p.keyboard.press("m");
  await p.waitForTimeout(500);
  const s = await state(p);
  say("J1: chart first, then M, shows the result", s.ended === true && s.redChutes.length === 1, JSON.stringify({ ended: s.ended, red: s.redChutes }));
  await c.close();
}
{
  // J2: the floor.
  const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await c.newPage();
  await p.goto(BASE);
  const eight = Array.from({ length: 7 }, (_, i) => `function h${i}() {\n  return ${i};\n}`).join("\n") + `\nexport function f() {\n  return ${Array.from({ length: 7 }, (_, i) => `h${i}()`).join(" + ")};\n}\n`;
  await p.fill('[data-testid="u1-code"]', eight);
  await p.click('[data-testid="u1-draw"]');
  await p.waitForSelector('[data-testid="bench-stage"]');
  await p.waitForTimeout(500);
  const small = await p.evaluate(() => [...document.querySelectorAll('[data-testid="machine"] text')].map((t) => t.getBoundingClientRect().height).filter((h) => h > 0));
  const note = await p.textContent('[data-testid="machine-too-many"]').catch(() => null);
  const least = small.length ? Math.min(...small) : null;
  say("J2: eight parts at 1280x720: words at a readable size, or the chart in plain words", (note !== null && !/->|pipe /.test(note)) || (least !== null && least >= 11), `${note ?? ""} smallest ${least}`);
  await p.screenshot({ path: `${OUT}/eight-1280.png` });
  await c.close();
}
writeFileSync(`${OUT}/truth.json`, JSON.stringify({ checks: out }, null, 1));
await b.close();
console.log(failed ? `${failed} FAILED` : "all pass");
process.exit(failed ? 1 : 0);
