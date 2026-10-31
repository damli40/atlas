// R3: the motion. Everything here explains something: a thread drawn is a call being made; a ticket pinned is a step that
// happened; a clock's hand is a wait. It is built on the browser's Web Animations, so `skip()` can finish everything at once.
//
// Plain words on the two promises:
// - Never slower than the person wants: a click, Space or Escape calls skip(); whatever is running jumps to its end, and
//   anything still queued happens with no time at all.
// - Reduced motion: every moment takes no time. The drawing arrives finished, in the same state.
// Browser only. Reads the scene and the SVG; it decides nothing about what is true.

import type { Scene } from "../scene";
import type { RenderSpec, SpecMark, SpecStep } from "../spec";

const PEN = "cubic-bezier(.42,.04,.3,1)";
const SVG_NS = "http://www.w3.org/2000/svg";

export interface PlayerOptions {
  reducedMotion?: boolean;
  /** Called when a step starts: another drawing on the page can light its device. */
  onStep?: (step: SpecStep, index: number) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let maskCounter = 0;

export class Player {
  readonly nodes = new Map<string, SVGGElement>();
  readonly edges = new Map<string, SVGGElement>();
  readonly labels = new Map<string, SVGGElement>();
  readonly marks: { el: SVGGElement; on: string; kind: string }[] = [];
  private active = new Set<Animation>();
  private skipping = false;
  private instant: boolean;

  constructor(
    readonly svg: SVGSVGElement,
    readonly scene: Scene,
    readonly spec: RenderSpec,
    private o: PlayerOptions = {},
  ) {
    const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    this.instant = o.reducedMotion ?? media;
    for (const el of svg.querySelectorAll<SVGGElement>("[data-node]")) this.nodes.set(el.dataset.node!, el);
    for (const el of svg.querySelectorAll<SVGGElement>("[data-edge]")) this.edges.set(el.dataset.edge!, el);
    for (const el of svg.querySelectorAll<SVGGElement>("[data-label-of]")) this.labels.set(el.dataset.labelOf!, el);
    for (const el of svg.querySelectorAll<SVGGElement>("[data-mark]")) this.marks.push({ el, on: el.dataset.mark!, kind: [...el.classList].find((c) => c.startsWith("rr-mark-"))!.slice(8) });
  }

  get reduced(): boolean {
    return this.instant;
  }

  private get fast(): boolean {
    return this.instant || this.skipping;
  }

  /** Jump to the end of everything running and queued. */
  skip(): void {
    this.skipping = true;
    for (const a of [...this.active]) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
  }

  /** Motion again from here on, after a skip. */
  resume(): void {
    this.skipping = false;
  }

  private async animate(el: Element, frames: Keyframe[] | PropertyIndexedKeyframes, opts: KeyframeAnimationOptions): Promise<void> {
    if (this.fast) return;
    const a = el.animate(frames, { fill: "both", ...opts });
    this.active.add(a);
    try {
      await a.finished;
    } catch {
      /* cancelled */
    }
    this.active.delete(a);
    a.cancel();
  }

  private async rest(ms: number): Promise<void> {
    if (!this.fast) await wait(ms);
  }

  // ---- what is hidden until it happens ----

  /** Hide everything that a step or the entrance will bring in. */
  hide(ids?: { nodes?: Iterable<string>; edges?: Iterable<string> }): void {
    for (const id of ids?.nodes ?? this.nodes.keys()) this.nodes.get(id)?.classList.add("rr-pending");
    for (const id of ids?.edges ?? this.edges.keys()) {
      this.edges.get(id)?.classList.add("rr-pending");
      this.labels.get(id)?.classList.add("rr-pending");
    }
    for (const m of this.marks) m.el.classList.add("rr-pending");
    for (const el of this.svg.querySelectorAll(".rr-captions")) el.classList.add("rr-pending");
  }

  /** The finished picture, at once. */
  showAll(): void {
    for (const el of this.svg.querySelectorAll(".rr-pending")) el.classList.remove("rr-pending");
    for (const el of this.svg.querySelectorAll(".rr-calm")) el.classList.remove("rr-calm");
  }

  // ---- the moments ----

  /** The pen draws a thread from one end to the other, a nib leading; the head lands last; the words beside it are written. */
  async drawThread(id: string, o: { pace?: number } = {}): Promise<void> {
    const el = this.edges.get(id);
    if (!el) return;
    el.classList.remove("rr-pending");
    const label = this.labels.get(id);
    label?.classList.remove("rr-pending");
    if (this.fast) return;
    const spine = el.querySelector<SVGPathElement>(".rr-spine");
    const line = el.querySelector<SVGPathElement>(".rr-line");
    const head = el.querySelector<SVGPathElement>(".rr-head");
    if (!spine || !line) {
      // A dotted note: it fades in; a note is not a line someone is drawing with force.
      await this.animate(el, { opacity: [0, 1] }, { duration: 260, easing: "ease-out" });
      return;
    }
    const len = spine.getTotalLength();
    const duration = Math.max(280, Math.min(1000, 200 + len * 1.5)) * (o.pace ?? 1);
    // The ribbon is revealed through a mask that is itself a stroke being drawn: pen-like, and the ribbon keeps its width.
    const id2 = `rr-reveal-${++maskCounter}`;
    const mask = document.createElementNS(SVG_NS, "mask");
    mask.id = id2;
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    const box = this.svg.viewBox.baseVal;
    mask.setAttribute("x", String(-200));
    mask.setAttribute("y", String(-200));
    mask.setAttribute("width", String(box.width + 2000));
    mask.setAttribute("height", String(box.height + 2000));
    const rev = document.createElementNS(SVG_NS, "path");
    rev.setAttribute("d", spine.getAttribute("d")!);
    rev.setAttribute("fill", "none");
    rev.setAttribute("stroke", "#fff");
    rev.setAttribute("stroke-width", "12");
    rev.setAttribute("stroke-linecap", "round");
    rev.setAttribute("pathLength", "1");
    rev.setAttribute("stroke-dasharray", "1 1");
    rev.setAttribute("stroke-dashoffset", "1");
    mask.append(rev);
    el.append(mask);
    line.setAttribute("mask", `url(#${id2})`);
    if (head) head.style.visibility = "hidden";
    const nib = document.createElementNS(SVG_NS, "circle");
    nib.setAttribute("r", "2.6");
    nib.setAttribute("class", "rr-nib");
    el.append(nib);
    const reveal = rev.animate({ strokeDashoffset: [1, 0] }, { duration, easing: PEN, fill: "both" });
    this.active.add(reveal);
    let raf = 0;
    const follow = () => {
      const p = reveal.effect?.getComputedTiming().progress ?? 1;
      const pt = spine.getPointAtLength(p * len);
      nib.setAttribute("cx", String(pt.x));
      nib.setAttribute("cy", String(pt.y));
      if (reveal.playState === "running" || reveal.pending) raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    const writing = label ? this.writeOn(label, Math.max(220, duration * 0.8), duration * 0.25) : Promise.resolve();
    try {
      await reveal.finished;
    } catch {
      /* cancelled */
    }
    cancelAnimationFrame(raf);
    this.active.delete(reveal);
    nib.remove();
    line.removeAttribute("mask");
    mask.remove();
    if (head) {
      head.style.visibility = "";
      const tip = spine.getPointAtLength(len);
      await this.animate(head, [{ transform: "scale(.2)", transformOrigin: `${tip.x}px ${tip.y}px`, transformBox: "view-box" }, { transform: "scale(1.14)", transformOrigin: `${tip.x}px ${tip.y}px`, transformBox: "view-box", offset: 0.65 }, { transform: "scale(1)", transformOrigin: `${tip.x}px ${tip.y}px`, transformBox: "view-box" }], { duration: 150, easing: "ease-out" });
    }
    await writing;
  }

  /** Words written left to right, at about the speed a hand writes a short phrase. */
  async writeOn(el: Element, duration = 360, delay = 0): Promise<void> {
    el.classList.remove("rr-pending");
    await this.animate(el, [{ clipPath: "inset(-8px 100% -8px -8px)" }, { clipPath: "inset(-8px -12px -8px -8px)" }], { duration, delay, easing: "cubic-bezier(.3,.3,.5,1)" });
  }

  /** A ticket is held up, the pin goes in, and the paper swings round the pin and comes to rest. */
  async settle(id: string): Promise<void> {
    const el = this.nodes.get(id);
    if (!el) return;
    el.classList.remove("rr-pending");
    if (this.fast) return;
    const body = el.querySelector<SVGGElement>(".rr-settle")!;
    const px = el.dataset.px;
    const py = el.dataset.py;
    const origin = { transformOrigin: `${px}px ${py}px`, transformBox: "view-box" as const };
    const pin = el.querySelector(".rr-pin");
    if (el.classList.contains("rr-clock")) {
      await this.animate(body, [{ opacity: 0, transform: "scale(.92)", ...this.centerOf(el) }, { opacity: 1, transform: "scale(1)", ...this.centerOf(el) }], { duration: 170, easing: "ease-out" });
      return;
    }
    const swing = this.animate(
      body,
      [
        { opacity: 0, transform: "translateY(-13px) rotate(-4.4deg)", ...origin },
        { opacity: 1, transform: "translateY(-4px) rotate(-3.2deg)", offset: 0.22, ...origin },
        { transform: "translateY(0) rotate(2.1deg)", offset: 0.42, ...origin },
        { transform: "rotate(-1.05deg)", offset: 0.6, ...origin },
        { transform: "rotate(.48deg)", offset: 0.78, ...origin },
        { transform: "rotate(0deg)", ...origin },
      ],
      { duration: 640, easing: "ease-out" },
    );
    const press = pin
      ? this.animate(
          pin,
          [
            { opacity: 0, transform: "translateY(-16px) scale(1.5)", ...origin },
            { opacity: 1, transform: "translateY(-2px) scale(1.18)", offset: 0.55, ...origin },
            { transform: "translateY(0) scale(.92)", offset: 0.82, ...origin },
            { transform: "translateY(0) scale(1)", ...origin },
          ],
          { duration: 230, easing: "ease-in" },
        )
      : Promise.resolve();
    await Promise.all([swing, press]);
  }

  private centerOf(el: Element) {
    const hand = el.querySelector<SVGGElement>(".rr-hand");
    return { transformOrigin: `${hand?.dataset.cx}px ${hand?.dataset.cy}px`, transformBox: "view-box" as const };
  }

  /** A clock's hand sweeps; its length follows the measured wait, within limits so no wait drags. */
  async sweep(id: string, ms?: number): Promise<void> {
    const el = this.nodes.get(id);
    const hand = el?.querySelector<SVGGElement>(".rr-hand");
    if (!el || !hand || this.fast) return;
    const deg = Number(hand.dataset.sweep ?? 72);
    const duration = Math.max(420, Math.min(1100, 340 + 240 * Math.log10(1 + (ms ?? 100))));
    const origin = this.centerOf(el);
    const wedge = el.querySelector(".rr-wedge");
    const text = el.querySelectorAll(".rr-t");
    await Promise.all([
      this.animate(hand, [{ transform: `rotate(${-deg}deg)`, ...origin }, { transform: "rotate(0deg)", ...origin }], { duration, easing: "cubic-bezier(.35,0,.25,1)" }),
      wedge ? this.animate(wedge, { opacity: [0, 0.72] }, { duration, easing: "linear" }) : Promise.resolve(),
      ...[...text].map((t) => this.writeOn(t, duration * 0.7, 0)),
    ]);
  }

  /** A device's lamp blinks: this call reached it. `ok`: the steady ochre of an answer. */
  async flash(id: string, ms = 340): Promise<void> {
    const el = this.nodes.get(id);
    if (!el) return;
    el.classList.add("rr-lit");
    if (!this.fast) await wait(ms);
    el.classList.remove("rr-lit");
  }

  /** The way in for a chart: tickets pinned in layout order, threads drawn from each to each. */
  async entrance(): Promise<void> {
    this.hide();
    const order = [...this.scene.nodes].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
    const big = order.length > 16 || this.scene.edges.length > 24;
    const seen = new Set<string>();
    for (const n of order) {
      if (big) void this.settle(n.id);
      else await this.settle(n.id);
      await this.rest(big ? 34 : 60);
      seen.add(n.id);
      if (big) continue;
      for (const e of this.scene.edges) if (e.from !== e.to && seen.has(e.from) && e.to === n.id) await this.drawThread(e.id, { pace: 0.8 });
    }
    for (const e of this.scene.edges) {
      if (this.edges.get(e.id)?.classList.contains("rr-pending")) {
        if (big) void this.drawThread(e.id, { pace: 0.7 });
        else await this.drawThread(e.id, { pace: 0.8 });
        await this.rest(big ? 14 : 0);
      }
    }
    if (big) await this.rest(900);
    this.showCaptions();
  }

  showCaptions(): void {
    for (const el of this.svg.querySelectorAll(".rr-captions")) el.classList.remove("rr-pending");
  }

  /** One step of a run: its thread is drawn, its ticket pinned, its clock swept. */
  async playStep(i: number): Promise<void> {
    const step = this.spec.steps[i];
    if (!step) return;
    this.o.onStep?.(step, i);
    await Promise.all(step.edges.map((e) => this.drawThread(e)));
    await Promise.all(step.nodes.map((n) => this.settle(n)));
    if (step.beat === "wait") await Promise.all(step.nodes.map((n) => this.sweep(n, step.ms)));
    await this.rest(step.beat === "end" ? 260 : 90);
  }

  /** A whole run, step by step. */
  async playSteps(): Promise<void> {
    this.hide({ nodes: this.spec.steps.flatMap((s) => s.nodes), edges: this.spec.steps.flatMap((s) => s.edges) });
    for (let i = 0; i < this.spec.steps.length; i++) await this.playStep(i);
  }

  /**
   * The verdict lands. Matched: a tick is drawn, a few small sparks, the ticket lifts a hair: a small delight.
   * Didn't match: everything else grows quiet, a red ring is drawn round the step where the answer and the run part ways, and
   * the words are written: a clear, calm moment, with no shake and no alarm. Can't check: a dashed ring and the reason.
   */
  async landMark(m: SpecMark): Promise<void> {
    const found = this.marks.find((x) => x.on === m.on && x.kind === m.kind);
    if (!found) return;
    const el = found.el;
    el.classList.remove("rr-pending");
    const words = el.querySelectorAll(".rr-mark-words");
    const node = this.nodes.get(m.on);
    if (this.fast) {
      if (m.kind === "didnt-match") this.calm(m.on);
      return;
    }
    if (m.kind === "didnt-match") {
      this.calm(m.on);
      await this.rest(420);
      await this.revealArt(el.querySelector(".rr-mark-ring")!, el.querySelector(".rr-mark-spine")!, 1150, 9);
      await Promise.all([...words].map((w) => this.writeOn(w, 640)));
    } else if (m.kind === "matched") {
      await this.revealArt(el.querySelector(".rr-mark-tick")!, el.querySelector(".rr-mark-spine")!, 340, 10);
      if (node) {
        const box = node.querySelector(".rr-settle")!;
        void this.animate(box, [{ transform: "translateY(0)" }, { transform: "translateY(-3px)", offset: 0.4 }, { transform: "translateY(0)" }], { duration: 420, easing: "ease-out" });
      }
      const sparks = [...el.querySelectorAll<SVGPathElement>(".rr-spark")];
      const pops = sparks.map((s, i) => this.animate(s, [{ opacity: 0, transform: "scale(.2)", transformBox: "fill-box", transformOrigin: "center" }, { opacity: 1, transform: "scale(1.5) rotate(20deg)", offset: 0.5, transformBox: "fill-box", transformOrigin: "center" }, { opacity: 1, transform: "scale(1) rotate(0deg)", transformBox: "fill-box", transformOrigin: "center" }], { duration: 480, delay: i * 70, easing: "ease-out" }));
      await Promise.all([...pops, ...[...words].map((w) => this.writeOn(w, 460))]);
    } else {
      await this.animate(el, { opacity: [0, 1] }, { duration: 420 });
    }
  }

  /** Everything but this node, its mark and its words grows quiet. */
  private calm(on: string): void {
    for (const [id, el] of this.nodes) if (id !== on) el.classList.add("rr-calm");
    for (const el of this.edges.values()) el.classList.add("rr-calm");
    for (const el of this.labels.values()) el.classList.add("rr-calm");
  }

  private async revealArt(art: SVGPathElement, spine: SVGPathElement, duration: number, width: number): Promise<void> {
    const id = `rr-reveal-${++maskCounter}`;
    const mask = document.createElementNS(SVG_NS, "mask");
    mask.id = id;
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    const box = this.svg.viewBox.baseVal;
    mask.setAttribute("x", "-200");
    mask.setAttribute("y", "-200");
    mask.setAttribute("width", String(box.width + 2000));
    mask.setAttribute("height", String(box.height + 2000));
    const rev = document.createElementNS(SVG_NS, "path");
    rev.setAttribute("d", spine.getAttribute("d")!);
    rev.setAttribute("fill", "none");
    rev.setAttribute("stroke", "#fff");
    rev.setAttribute("stroke-width", String(width));
    rev.setAttribute("stroke-linecap", "round");
    rev.setAttribute("pathLength", "1");
    rev.setAttribute("stroke-dasharray", "1 1");
    mask.append(rev);
    art.parentElement!.append(mask);
    art.setAttribute("mask", `url(#${id})`);
    await this.animate(rev, { strokeDashoffset: [1, 0] }, { duration, easing: "cubic-bezier(.5,.05,.4,1)" });
    art.removeAttribute("mask");
    mask.remove();
  }
}
