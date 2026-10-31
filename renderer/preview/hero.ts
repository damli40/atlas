// R3: the hero: one function's whole journey, structure → bet → run → verdict. Real data throughout: the drawing and the
// options come from plain code before any run, and the run was recorded by Atlas's own runner (tests/fixtures/r3). The
// answer plays back from that file, so the page says "replayed", never "live".
import data from "../../tests/fixtures/r3/specs.json";
import { CLOCK_NODE, deviceNodeId } from "../authors/bet-view";
import { handLine, inkPoly, rng, ribbon, type Pt } from "../hand";
import { drawSpec } from "../live/draw";
import { mountDrawing, type Mounted } from "../live/mount";
import { paperTile } from "../live/svg";
import type { RenderSpec, SpecStep } from "../spec";
import { fontsReady, installStyle } from "./assets";

interface HeroData {
  bet: RenderSpec;
  question: string;
  options: { id: string; label: string }[];
  byOption: Record<string, { spec: RenderSpec; outcome: string; label: string }>;
  measuredCalls: number;
}
const hero = data.hero as unknown as HeroData;
const q = new URLSearchParams(location.search);
const theme = q.get("theme") === "dark" ? "dark" : "light";
const reducedMotion = q.get("reduced") === "1" ? true : undefined;

installStyle(`
html,body{height:100%}
#hero{position:fixed;inset:0;overflow:hidden;contain:none;color:var(--rr-ink);font-family:"Atlas Besley",Georgia,serif;font-kerning:none;font-variant-ligatures:none;touch-action:manipulation;user-select:none}
#paper{position:absolute;inset:0;width:100%;height:100%}
#hero .rr>rect{display:none}
#hero .rr-host{background:transparent}
.col{position:absolute;left:clamp(24px,5vw,96px);top:clamp(24px,7.4vh,80px);width:min(600px,calc(100vw - 48px));z-index:3}
.kick{margin:0 0 8px;font-size:17px;letter-spacing:.022em;color:var(--rr-soft)}
h1{margin:0;font-weight:400;font-size:clamp(38px,3.7vw,68px);letter-spacing:.012em;line-height:1.12}
.sub{margin:12px 0 0;font-style:italic;font-size:clamp(17px,1.2vw,22px);line-height:1.4;letter-spacing:.012em;transition:opacity .3s}
.bet{margin-top:clamp(28px,6vh,64px)}
.pre{margin:0 0 14px;font-style:italic;font-size:clamp(14px,.9vw,16.5px);line-height:1.5;color:var(--rr-soft);letter-spacing:.012em;overflow-wrap:anywhere;transition:opacity .3s}
.q{margin:0 0 20px;font-size:clamp(21px,1.5vw,29px);line-height:1.3;letter-spacing:.01em}
.bet.sealed .pre{display:none}
.opts{display:flex;flex-wrap:wrap;gap:12px 14px}
.tag{position:relative;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;font-size:18px;letter-spacing:.02em;height:56px;outline:none;transition:opacity .35s ease,transform .18s cubic-bezier(.3,1.3,.5,1)}
.tag svg{position:absolute;inset:-8px -10px -12px -10px;width:calc(100% + 20px);height:calc(100% + 20px);overflow:visible;pointer-events:none}
.tag span{position:relative;padding:0 22px;line-height:56px;white-space:nowrap}
.tag:hover,.tag:focus-visible{transform:translateY(-3px) rotate(-.5deg)}
.tag:focus-visible span{text-decoration:underline;text-underline-offset:4px}
.tag.chosen{transform:none}
.tag.gone{opacity:0;pointer-events:none}
.tag-pin{visibility:hidden}
.tag.chosen .tag-pin{visibility:visible}
.verdict{margin-top:clamp(28px,6vh,64px)}
.said{margin:0;font-size:clamp(22px,1.7vw,32px);line-height:1.32;letter-spacing:.01em}
.said em{display:block;font-size:.72em;color:var(--rr-soft);margin-top:10px}
.again{margin-top:22px;background:none;border:0;padding:6px 0;font:italic 18px "Atlas Besley",Georgia,serif;color:var(--rr-soft);cursor:pointer;border-bottom:1px solid currentColor}
.again:hover,.again:focus-visible{color:var(--rr-ink);outline:none}
.stage{position:absolute;transform-origin:0 0;transition:transform .95s cubic-bezier(.6,.02,.2,1),opacity .6s ease;will-change:transform}
#structure{left:39vw;top:6vh;width:58vw;height:88vh}
#path{left:44vw;top:2.5vh;width:53vw;height:95vh;opacity:0;pointer-events:none}
#hero[data-stage="run"] #path,#hero[data-stage="verdict"] #path{opacity:1;pointer-events:auto}
#hero[data-stage="run"] #structure,#hero[data-stage="verdict"] #structure{transform:translate(-33vw,44vh) scale(.5);pointer-events:none}
#hero[data-stage="run"] #structure .rr-captions,#hero[data-stage="verdict"] #structure .rr-captions{opacity:0;transition:opacity .4s}
.foot{position:absolute;left:clamp(24px,5vw,96px);bottom:clamp(10px,2.4vh,24px);margin:0;font-style:italic;font-size:14px;color:var(--rr-soft);opacity:0;transition:opacity .6s;z-index:3;max-width:min(560px,calc(100vw - 48px))}
#hero[data-stage="verdict"] .foot{opacity:1}
@media (max-width:760px){
.col{top:18px}
.kick{font-size:14px;margin-bottom:2px}
.sub{margin-top:6px}
.bet{margin-top:16px}.verdict{margin-top:12px}
#structure{left:0;top:178px;width:100vw;height:calc(100vh - 178px)}
#hero[data-stage="bet"] #structure{transform:translateY(calc(100vh - 460px)) scale(.62);transform-origin:50% 0}
#path{left:0;top:150px;width:100vw;height:calc(100vh - 150px)}
#hero[data-stage="run"] #structure,#hero[data-stage="verdict"] #structure{transform:none;opacity:0}
#hero[data-stage="verdict"] #path{top:230px;height:calc(100vh - 230px)}
.opts{gap:6px 8px}.tag{font-size:16px;height:46px}.tag span{line-height:46px;padding:0 14px}
.again{margin-top:6px;font-size:16px}
.foot{display:none}
}
@media (prefers-reduced-motion:reduce){.stage,.tag,.sub,.foot{transition:none}}
`);
await fontsReady();

const main = document.getElementById("hero")!;
main.dataset.theme = theme;
const $ = (id: string) => document.getElementById(id)!;

// One sheet of paper under everything.
const paper = $("paper");
paper.innerHTML = `${paperTile("hero", "hero-paper")}<rect class="rr-sheet" width="100%" height="100%"/><rect width="100%" height="100%" fill="url(#hero-paper)"/>`;

const betDrawn = drawSpec(hero.bet);
const structure: Mounted = mountDrawing($("structure"), betDrawn, hero.bet, { theme, maxScale: 1.2, pan: false, ...(reducedMotion ? { reducedMotion } : {}) });
$("structure").style.touchAction = "manipulation";
let pathMount: Mounted | null = null;

// Global skip: a click anywhere (or Space, Escape) while something plays.
let playing = false;
const skipAll = () => {
  if (!playing) return;
  structure.player?.skip();
  pathMount?.player?.skip();
};
main.addEventListener("pointerup", (e) => {
  if (!(e.target as Element).closest("button")) skipAll();
});
window.addEventListener("keydown", (e) => {
  if ((e.key === " " || e.key === "Escape") && !(e.target as Element).closest?.("button")) {
    e.preventDefault();
    skipAll();
  }
});

const buildTag = (id: string, label: string, i: number) => {
  const b = document.createElement("button");
  b.className = "tag";
  b.dataset.option = id;
  const span = document.createElement("span");
  span.textContent = label;
  b.append(span);
  $("opts").append(b);
  const r = b.getBoundingClientRect();
  const R = rng(`tag:${id}:${i}`);
  const W = r.width + 20;
  const H = r.height + 20;
  const x0 = 10;
  const y0 = 8;
  const x1 = W - 10;
  const y1 = H - 12;
  const teeth = Math.max(5, Math.round((x1 - x0) / 10));
  const zig: Pt[] = [];
  for (let k = 0; k <= teeth; k++) zig.push([x1 - ((x1 - x0) * k) / teeth, y1 - (k % 2 ? 0 : 4.4) + R.range(-0.5, 0.5)]);
  const svg = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="rr-card" d="M${x0} ${y0}L${x1} ${y0}${zig.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("")}Z"/><path class="rr-ink" d="${inkPoly([[x0, y1 - 4], [x0, y0], [x1, y0], [x1, y1 - 4]], R, 1.25, { closed: false, bow: 0.3, tremor: 0.7 })}"/><path class="rr-ink" d="${ribbon(handLine(zig, R, { bow: 0.1, tremor: 0.3, smooth: 0.6, step: 2.4 }), 1.05, R)}"/><g class="tag-pin"><circle class="rr-pin-red" cx="${(x0 + x1) / 2}" cy="${y0}" r="6.5"/><path class="rr-ink" d="${ribbon(handLine(Array.from({ length: 19 }, (_, a) => [(x0 + x1) / 2 + Math.cos((a / 18) * 6.4) * 6.5, y0 + Math.sin((a / 18) * 6.4) * 6.5] as Pt), R, { bow: 0, tremor: 0.3, smooth: 0.3, step: 1.5 }), 0.9, R)}"/></g></svg>`;
  b.insertAdjacentHTML("afterbegin", svg);
  b.addEventListener("click", () => void choose(id));
};

let chosenOnce = false;
async function choose(id: string) {
  if (chosenOnce) return;
  chosenOnce = true;
  for (const el of $("opts").querySelectorAll<HTMLButtonElement>(".tag")) {
    el.classList.toggle("chosen", el.dataset.option === id);
    el.classList.toggle("gone", el.dataset.option !== id);
    el.disabled = true;
  }
  const choice = hero.byOption[id]!;
  $("bet").classList.add("sealed");
  await new Promise((r) => setTimeout(r, structure.player?.reduced ? 0 : 520));
  await playRun(id, choice);
}

async function playRun(id: string, choice: HeroData["byOption"][string]) {
  $("sub").textContent = "what happened, step by step. Every line is measured.";
  main.dataset.stage = "run";
  const drawn = drawSpec(choice.spec);
  pathMount = mountDrawing($("path"), drawn, choice.spec, {
    theme,
    maxScale: 1.1,
    minScale: 0.66,
    onStep: (s: SpecStep) => {
      if (s.device === "clock") void structure.player?.sweep(CLOCK_NODE, s.ms);
      else if (s.device) void structure.player?.flash(deviceNodeId(s.device), 700);
    },
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  const p = pathMount.player!;
  structure.player?.resume();
  playing = true;
  p.hide({ nodes: choice.spec.steps.flatMap((s) => s.nodes), edges: choice.spec.steps.flatMap((s) => s.edges) });
  await new Promise((r) => setTimeout(r, p.reduced ? 0 : 900));
  for (let i = 0; i < choice.spec.steps.length; i++) await p.playStep(i);
  main.dataset.stage = "verdict";
  $("sub").hidden = true;
  $("bet").hidden = true;
  $("verdict").hidden = false;
  const measured = hero.measuredCalls;
  const said = id === "cant" ? `You said you couldn't tell.<em>It called fetch ${measured} times. No answer, so nothing to compare.</em>` : choice.outcome === "matched" ? `You said ${esc(choice.label)}.<em>It called fetch ${measured} times. Matched.</em>` : `You said ${esc(choice.label)}.<em>It called fetch ${measured} times. Didn't match. The ring shows where your answer and the run part ways.</em>`;
  $("said").innerHTML = said;
  $("foot").textContent = "A recorded run, replayed from a file. Measured by Atlas's own runner; no model said what happened.";
  for (const m of choice.spec.marks) await p.landMark(m);
  p.showCaptions();
  playing = false;
  document.body.dataset.done = "1";
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

$("again").addEventListener("click", () => {
  pathMount?.destroy();
  pathMount = null;
  chosenOnce = false;
  delete document.body.dataset.done;
  main.dataset.stage = "bet";
  $("sub").hidden = false;
  $("sub").textContent = "the code, and what Atlas will plug in. Nothing has run.";
  $("verdict").hidden = true;
  $("bet").hidden = false;
  $("bet").classList.remove("sealed");
  for (const el of $("opts").querySelectorAll<HTMLButtonElement>(".tag")) {
    el.classList.remove("chosen", "gone");
    el.disabled = false;
  }
  structure.player?.resume();
});

// ---- the journey begins: the code draws itself; then the question ----
const start = async () => {
  playing = true;
  if (structure.player) await structure.player.entrance();
  playing = false;
  structure.player?.resume();
  main.dataset.stage = "bet";
  // The same words every bettor reads (D19): the set-up small, the question large.
  const cut = hero.question.lastIndexOf(". ");
  $("pre").textContent = cut > 0 ? hero.question.slice(0, cut + 1) : "";
  $("q").textContent = cut > 0 ? hero.question.slice(cut + 2) : hero.question;
  $("bet").hidden = false;
  hero.options.forEach((o, i) => buildTag(o.id, o.label, i));
  buildTag("cant", "can't tell", hero.options.length);
  document.body.dataset.ready = "1";
};
void start();
