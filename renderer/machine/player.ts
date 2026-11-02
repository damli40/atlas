// D65: plays a machine's script on its SVG: a red thread runs through the pipes, a dial's needle sweeps, a lamp comes on, and at the end the
// ring lands. Web Animations only, the same as the renderer's player. skip() jumps to the end; reduced motion shows the end at once.
import type { MachineBeat } from "../authors/machine-script";
import type { ActMotion, ActStep } from "../authors/run-act";

const SVGNS = "http://www.w3.org/2000/svg";
/** R8: the act's own marks, on the page only (never in a shared picture): a fake's flash, the dial's "N ms". */
export const ACT_CSS = `
.m-act-flash{fill:none;stroke:var(--rr-red-pen);stroke-width:2.4;pointer-events:none;transform-box:fill-box;transform-origin:center}
.m-act-ms{pointer-events:none}
`;
/** The dial's share of a turn for a wait of `ms`: the same scale the run's path uses for its clock (renderer/authors/what-happened.ts). */
export const dialSweep = (ms: number) => Math.max(0.06, Math.min(0.92, Math.log10(1 + ms) / 5));

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const INV = 1 / (2 * C * S);
const needle = (cx: number, cy: number, deg: number) => `translate(${cx}px,${cy}px) matrix(${C},${S},${-C},${S},0,0) rotate(${deg}deg) matrix(${S * INV},${-S * INV},${C * INV},${C * INV},0,0) translate(${-cx}px,${-cy}px)`;

export class MachinePlayer {
  private running: Animation[] = [];
  private beats: MachineBeat[] = [];
  private done = -1;
  private pen: Animation[] = [];
  private penOff: (() => void) | null = null;
  constructor(private svg: SVGSVGElement, private reduced = false) {}
  setScript(beats: MachineBeat[]) {
    this.beats = beats;
    this.done = -1;
  }
  private el(sel: string, attr: string, v: string): Element | null {
    return [...this.svg.querySelectorAll(sel)].find((e) => e.getAttribute(attr) === v) ?? null;
  }
  rewind() {
    for (const a of this.running) a.cancel();
    this.running = [];
    this.done = -1;
    this.svg.removeAttribute("data-ended");
    for (const t of this.svg.querySelectorAll(".m-thread")) {
      t.removeAttribute("data-ran");
      (t as SVGElement).style.strokeDashoffset = "";
    }
    for (const l of this.svg.querySelectorAll(".m-lamp")) l.removeAttribute("data-on");
    for (const n of this.svg.querySelectorAll<SVGElement>(".m-needle")) n.style.transform = "";
  }
  private settle(b: MachineBeat) {
    for (const r of b.routes) {
      const t = this.el(".m-thread", "data-route", r) as SVGElement | null;
      if (t) {
        t.setAttribute("data-ran", "");
        t.style.strokeDashoffset = "0";
      }
    }
    for (const l of b.lamps) this.el(".m-lamp", "data-lamp", l)?.setAttribute("data-on", "");
    if (b.dial) {
      const n = this.el(".m-needle", "data-dial", b.dial.part) as SVGElement | null;
      if (n) n.style.transform = needle(Number(n.dataset.cx), Number(n.dataset.cy), b.dial.sweep * 360);
    }
  }
  /**
   * The machine pencils itself in, in the order the code flows. Nothing waits for it: every part is already in the page and can be clicked,
   * and any key or click ends it. Hatching grows along its own strokes; ink lines and fills come on in order.
   */
  penIn(total: number) {
    if (this.reduced || typeof Element === "undefined" || !Element.prototype.animate || total <= 0) return;
    const all = [...this.svg.querySelectorAll<SVGGraphicsElement>("path,circle,text")].filter((e) => !e.closest(".m-end,mask") && !e.classList.contains("m-thread"));
    const n = all.length;
    const list: Animation[] = [];
    all.forEach((e, i) => {
      const delay = (i / n) * total;
      const c = e.classList;
      if (c.contains("m-pencil-cream") || c.contains("m-pencil-blue") || c.contains("m-shade") || c.contains("m-shadow") || c.contains("m-knurl")) {
        list.push(e.animate([{ strokeDasharray: "80 80", strokeDashoffset: 80, opacity: 0.0, offset: 0 }, { opacity: 1, offset: 0.1 }, { strokeDasharray: "80 80", strokeDashoffset: 0, opacity: 1, offset: 1 }], { duration: Math.max(90, total * 0.18), delay, easing: "linear", fill: "backwards" }));
      } else {
        list.push(e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.max(40, total * 0.06), delay, easing: "linear", fill: "backwards" }));
      }
    });
    this.pen = list;
    const finish = () => this.finishPen();
    window.addEventListener("keydown", finish, { once: true, capture: true });
    window.addEventListener("pointerdown", finish, { once: true, capture: true });
    this.penOff = () => {
      window.removeEventListener("keydown", finish, true);
      window.removeEventListener("pointerdown", finish, true);
    };
  }
  finishPen() {
    for (const a of this.pen) a.finish();
    this.pen = [];
    this.penOff?.();
    this.penOff = null;
  }
  /** One beat. The promise ends when its motion does; it is never what the page waits on. */
  async play(i: number, ms: number): Promise<void> {
    const b = this.beats[i];
    if (!b) return;
    this.done = i;
    if (this.reduced || typeof Element === "undefined" || !Element.prototype.animate) return this.settle(b);
    const each = b.routes.length ? ms / b.routes.length : ms;
    let delay = 0;
    const list: Animation[] = [];
    for (const r of b.routes) {
      const t = this.el(".m-thread", "data-route", r);
      if (t) {
        list.push(t.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: each, delay, easing: "linear", fill: "forwards" }));
        this.head(t as SVGPathElement, each, delay);
      }
      delay += each;
    }
    if (b.dial) {
      const n = this.el(".m-needle", "data-dial", b.dial.part) as SVGElement | null;
      if (n) list.push(n.animate([{ transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), 0) }, { transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), b.dial.sweep * 360) }], { duration: ms, easing: "ease-in-out", fill: "forwards" }));
    }
    window.setTimeout(() => {
      for (const l of b.lamps) {
        const lamp = this.el(".m-lamp", "data-lamp", l);
        if (!lamp) continue;
        lamp.setAttribute("data-on", "");
        // lit on arrival: a small swell, once
        this.running.push(lamp.animate([{ transform: "scale(1.7)" }, { transform: "scale(1)" }], { duration: 240, easing: "cubic-bezier(.2,.7,.3,1)" }));
      }
    }, delay);
    this.running.push(...list);
    await Promise.allSettled(list.map((a) => a.finished));
    this.settle(b);
  }
  /** The ink's wet head, running down the pipe with the thread: a small round end, gone on arrival. */
  private head(t: SVGPathElement, ms: number, delay: number, list: Animation[] = this.running) {
    if (typeof t.getPointAtLength !== "function") return;
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", "m-head");
    dot.setAttribute("r", "3.4");
    dot.setAttribute("opacity", "0");
    t.after(dot);
    const len = t.getTotalLength();
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 24; k++) {
      const q = t.getPointAtLength((k / 24) * len);
      frames.push({ transform: `translate(${q.x}px,${q.y}px)`, opacity: 1 });
    }
    const a = dot.animate(frames, { duration: ms, delay, easing: "linear" });
    list.push(a);
    void a.finished.catch(() => {}).then(() => dot.remove());
    a.oncancel = () => dot.remove();
  }
  /** The end of the run: everything that ran shows, and the ring is drawn on in one stroke, with a small settle. */
  land() {
    this.skip();
    this.svg.setAttribute("data-ended", "");
    if (this.reduced || !Element.prototype.animate) return;
    const draw = this.svg.querySelector(".m-ring-draw");
    const ring = this.svg.querySelector(".m-ring-g");
    const words = this.svg.querySelector(".m-end-words");
    if (draw) this.running.push(draw.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 620, easing: "cubic-bezier(.45,.05,.3,1)" }));
    if (ring) this.running.push(ring.animate([{ transform: "scale(1)", offset: 0 }, { transform: "scale(1)", offset: 0.72 }, { transform: "scale(1.035)", offset: 0.84 }, { transform: "scale(1)", offset: 1 }], { duration: 860, easing: "ease-out" }));
    if (words) this.running.push(words.animate([{ opacity: 0 }, { opacity: 0, offset: 0.65 }, { opacity: 1 }], { duration: 920, easing: "ease-out" }));
  }
  hasLanded() {
    return this.svg.hasAttribute("data-ended");
  }
  /** A machine that arrives after the result: the same end state, with no motion. */
  settleAt(beats: MachineBeat[]) {
    this.beats = beats;
    this.skip();
    this.svg.setAttribute("data-ended", "");
  }
  // ---- R8: the run acted out, step by step, from its recorded fields (renderer/authors/run-act.ts) ----
  private actAnims: Animation[] = [];
  private actNodes: Element[] = [];
  private actTimers: ReturnType<typeof setTimeout>[] = [];
  private actEnd: (() => void) | null = null;
  private part(id: string): SVGGraphicsElement | null {
    return this.el("[data-part]", "data-part", id) as SVGGraphicsElement | null;
  }
  private overlay<K extends "circle" | "ellipse" | "text">(tag: K, attrs: Record<string, string>, text?: string): SVGElement {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    n.setAttribute("data-act", "");
    this.svg.append(n);
    this.actNodes.push(n);
    return n;
  }
  private anim(e: Element, frames: Keyframe[], o: KeyframeAnimationOptions): Animation {
    const a = e.animate(frames, o);
    this.actAnims.push(a);
    return a;
  }
  /** A drop of ink along a straight line, gone on arrival. */
  private drop(from: [number, number], to: [number, number], ms: number, r = 4.2) {
    const dot = this.overlay("circle", { class: "m-head", r: String(r), cx: "0", cy: "0", opacity: "0" });
    void this.anim(dot, [{ transform: `translate(${from[0]}px,${from[1]}px)`, opacity: 0 }, { opacity: 1, offset: 0.15 }, { transform: `translate(${to[0]}px,${to[1]}px)`, opacity: 1, offset: 0.85 }, { transform: `translate(${to[0]}px,${to[1]}px)`, opacity: 0 }], { duration: ms, easing: "ease-in" })
      .finished.catch(() => {})
      .then(() => dot.remove());
  }
  /** Spokes and knurl of a loop's hand wheel: the knurl and the strokes drawn just before it, back to the rim's fill (pencil.ts wheel()). */
  private wheelOf(part: string): { els: SVGGraphicsElement[]; cx: number; cy: number } | null {
    const knurl = this.part(`${part}#return`)?.querySelector<SVGGraphicsElement>(".m-knurl");
    if (!knurl || typeof knurl.getBBox !== "function") return null;
    const els: SVGGraphicsElement[] = [knurl];
    for (let e = knurl.previousElementSibling; e && !e.classList.contains("m-card"); e = e.previousElementSibling) els.push(e as SVGGraphicsElement);
    const b = knurl.getBBox();
    return { els, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }
  private motion(m: ActMotion, ms: number, keep: { routes: ReadonlySet<string>; lamps: ReadonlySet<string> }, inked: Set<string>) {
    const box = (id: string) => {
      const g = this.part(id);
      return g && typeof g.getBBox === "function" ? g.getBBox() : null;
    };
    switch (m.kind) {
      case "enter": {
        const b = box(`${m.part}#inlet`);
        if (b) this.drop([b.x + b.width / 2, b.y - 44], [b.x + b.width / 2, b.y + b.height * 0.55], Math.min(ms * 0.8, 520), 5);
        return;
      }
      case "lamp": {
        const lamp = this.el(".m-lamp", "data-lamp", m.part);
        if (!lamp) return;
        if (keep.lamps.has(m.part)) lamp.setAttribute("data-on", "");
        else this.anim(lamp, [{ fill: "var(--rr-red-pen)" }, { fill: "var(--rr-red-pen)", offset: 0.7 }, { fill: "var(--rr-paper)" }], { duration: Math.max(240, ms) });
        this.anim(lamp, [{ transform: "scale(1.7)" }, { transform: "scale(1)" }], { duration: 240, easing: "cubic-bezier(.2,.7,.3,1)" });
        return;
      }
      case "pipe": {
        const t = this.el(".m-thread", "data-route", m.route) as SVGPathElement | null;
        if (!t) return;
        const run = Math.min(ms * 0.8, 600);
        if (keep.routes.has(m.route)) {
          // Ink that the resting drawing keeps stays on; a pipe already inked only carries the wet head again.
          if (!inked.has(m.route)) {
            inked.add(m.route);
            this.anim(t, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: run, easing: "linear", fill: "forwards" });
          }
        } else this.anim(t, [{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0 }], { duration: Math.max(run, ms), easing: "linear" });
        this.head(t, run, 0, this.actAnims);
        return;
      }
      case "flash": {
        // A burst round the fake's own lamp: small, so it never reads as the result's ring.
        const lamp = this.el(".m-lamp", "data-lamp", m.port);
        if (!lamp) return;
        const burst = this.overlay("circle", { class: "m-act-flash", cx: lamp.getAttribute("cx") ?? "0", cy: lamp.getAttribute("cy") ?? "0", r: "16" });
        void this.anim(burst, [{ opacity: 0.95, transform: "scale(.3)" }, { opacity: 0, transform: "scale(1.25)" }], { duration: Math.min(Math.max(ms, 260), 520), easing: "cubic-bezier(.2,.7,.3,1)" })
          .finished.catch(() => {})
          .then(() => burst.remove());
        return;
      }
      case "turn": {
        const w = this.wheelOf(m.part);
        if (!w) return;
        for (const e of w.els) this.anim(e, [{ transform: needle(w.cx, w.cy, 0) }, { transform: needle(w.cx, w.cy, 360) }], { duration: Math.min(ms * 0.9, 720), easing: "ease-in-out" });
        return;
      }
      case "dial": {
        const n = this.el(".m-needle", "data-dial", m.part) as SVGElement | null;
        if (n) this.anim(n, [{ transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), 0) }, { transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), dialSweep(m.ms) * 360), offset: 0.8 }, { transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), dialSweep(m.ms) * 360) }], { duration: ms, easing: "ease-in-out" });
        const b = box(`${m.part}#dial`);
        if (b) {
          const label = this.overlay("text", { class: "m-t m-redw m-act-ms", x: String(b.x + b.width + 8), y: String(b.y + b.height * 0.42), "font-size": "15", opacity: "0" }, `${m.ms.toLocaleString("en-US")} ms`);
          void this.anim(label, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: ms })
            .finished.catch(() => {})
            .then(() => label.remove());
        }
        return;
      }
      case "chute": {
        const g = this.part(`${m.part}#chute`);
        const red = g?.querySelector(".m-hit-only");
        if (red) this.anim(red, [{ visibility: "visible" }, { visibility: "visible" }], { duration: ms, fill: "forwards" });
        const b = box(`${m.part}#chute`);
        if (b) this.drop([b.x + b.width * 0.3, b.y + b.height * 0.2], [b.x + b.width * 0.7, b.y + b.height * 0.95], Math.min(ms * 0.8, 620), 4.6);
        return;
      }
    }
  }
  /**
   * R8: plays the act. Each step's motions start at its time; `onStep` says which step is on (for the caption). The promise ends when the
   * act does, or at once on skip(). Nothing it does stays: at its end every motion and overlay is taken off and the drawing is rewound,
   * so the caller's land() leaves exactly the resting end state the beats give, as before.
   */
  act(steps: readonly ActStep[], times: readonly { at: number; ms: number }[], o: { keep: { routes: ReadonlySet<string>; lamps: ReadonlySet<string> }; onStep?: (i: number) => void }): Promise<void> {
    this.stopAct();
    if (this.reduced || typeof Element === "undefined" || !Element.prototype.animate || steps.length === 0) return Promise.resolve();
    const inked = new Set<string>();
    return new Promise<void>((resolve) => {
      this.actEnd = resolve;
      steps.forEach((s, i) => {
        const t = times[i] ?? { at: 0, ms: 250 };
        this.actTimers.push(
          setTimeout(() => {
            o.onStep?.(i);
            for (const m of s.motions) this.motion(m, t.ms, o.keep, inked);
          }, t.at),
        );
      });
      const last = times[times.length - 1];
      this.actTimers.push(setTimeout(() => this.stopAct(), last ? last.at + last.ms : 0));
    });
  }
  /** Ends the act now: every timer, motion and overlay goes, and the drawing is rewound for land(). */
  stopAct() {
    for (const t of this.actTimers) clearTimeout(t);
    this.actTimers = [];
    for (const a of this.actAnims) a.cancel();
    this.actAnims = [];
    for (const n of this.actNodes) n.remove();
    this.actNodes = [];
    const end = this.actEnd;
    this.actEnd = null;
    if (end) {
      this.rewind();
      end();
    }
  }
  skip() {
    this.stopAct();
    for (const a of this.running) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
    this.running = [];
    for (let i = 0; i < this.beats.length; i++) this.settle(this.beats[i]!);
    this.done = this.beats.length - 1;
  }
}
