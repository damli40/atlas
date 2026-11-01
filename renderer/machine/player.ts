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
      if (t) list.push(t.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: each, delay, easing: "linear", fill: "forwards" }));
      delay += each;
    }
    if (b.dial) {
      const n = this.el(".m-needle", "data-dial", b.dial.part) as SVGElement | null;
      if (n) list.push(n.animate([{ transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), 0) }, { transform: needle(Number(n.dataset.cx), Number(n.dataset.cy), b.dial.sweep * 360) }], { duration: ms, easing: "ease-in-out", fill: "forwards" }));
    }
    window.setTimeout(() => {
      for (const l of b.lamps) this.el(".m-lamp", "data-lamp", l)?.setAttribute("data-on", "");
    }, delay);
    this.running.push(...list);
    await Promise.allSettled(list.map((a) => a.finished));
    this.settle(b);
  }
  /** The end of the run: everything that ran shows, and the ring lands. */
  land() {
    this.skip();
    this.svg.setAttribute("data-ended", "");
    if (this.reduced || !Element.prototype.animate) return;
    const ring = this.svg.querySelector(".m-end");
    if (ring) this.running.push(ring.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" }));
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
