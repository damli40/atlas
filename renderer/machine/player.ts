// D65: plays a machine's script on its SVG: a red thread runs through the pipes, a dial's needle sweeps, a lamp comes on, and at the end the
// ring lands. Web Animations only, the same as the renderer's player. skip() jumps to the end; reduced motion shows the end at once.
import type { MachineBeat } from "../authors/machine-script";

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
  private head(t: SVGPathElement, ms: number, delay: number) {
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
    this.running.push(a);
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
  skip() {
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
