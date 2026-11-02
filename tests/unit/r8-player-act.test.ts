// R8 review minor 7: the player's act and stopAct, on a jsdom SVG with a stub Web Animations API. Captions in order at their times,
// ink kept only where the resting drawing keeps it, and nothing the act adds left behind after it ends, is stopped, or is skipped.
import "../tools/jsdom-globals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachinePlayer } from "../../renderer/machine/player";
import type { ActStep } from "../../renderer/authors/run-act";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg">
<g data-part="f"><circle class="m-lamp" data-lamp="f" cx="1" cy="1" r="3"/></g>
<g data-part="f#inlet"><path d="M0 0L10 10"/></g>
<g data-part="stand-in x"><circle class="m-lamp" data-lamp="stand-in x" cx="5" cy="5" r="3"/></g>
<path class="m-thread" data-route="f->stand-in x" d="M0 0L5 5"/>
<path class="m-thread" data-route="f->g" d="M0 0L5 5"/>
<g data-part="g#dial"><g class="m-needle" data-dial="g" data-cx="1" data-cy="1"><path d="M0 0L1 1"/></g></g>
</svg>`;

let anims: { el: Element; cancelled: boolean }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  anims = [];
  const proto = (globalThis as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
  proto.animate = function (this: Element) {
    const rec = { el: this, cancelled: false };
    anims.push(rec);
    let done: () => void = () => {};
    const finished = new Promise<void>((r) => (done = r));
    return { cancel: () => { rec.cancelled = true; done(); }, finish: () => done(), finished, oncancel: null, playState: "running" };
  };
  proto.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
});
afterEach(() => vi.useRealTimers());

const make = () => {
  const host = document.createElement("div");
  host.innerHTML = SVG;
  document.body.append(host);
  return host.querySelector("svg") as unknown as SVGSVGElement;
};
const STEPS: ActStep[] = [
  { words: "Atlas calls f", vms: 0, motions: [{ kind: "enter", part: "f" }, { kind: "lamp", part: "f" }], field: "t" },
  { words: "call 1 to x: answered", vms: 0, motions: [{ kind: "pipe", route: "f->stand-in x" }, { kind: "flash", port: "stand-in x" }, { kind: "lamp", part: "stand-in x" }], field: "t" },
  { words: "g runs", vms: 0, motions: [{ kind: "pipe", route: "f->g" }], field: "t" },
  { words: "waits 100 ms", vms: 100, wait: 100, motions: [{ kind: "dial", part: "g", ms: 100 }], field: "t" },
];
const TIMES = [{ at: 0, ms: 250 }, { at: 250, ms: 250 }, { at: 500, ms: 250 }, { at: 750, ms: 400 }];
const keep = { routes: new Set(["f->stand-in x"]), lamps: new Set(["f", "stand-in x"]) };

describe("R8: MachinePlayer.act", () => {
  it("says each step in order at its time, and resolves when the act ends with nothing of its own left", async () => {
    const svg = make();
    const p = new MachinePlayer(svg);
    const seen: number[] = [];
    let ended = false;
    const done = p.act(STEPS, TIMES, { keep, onStep: (i) => seen.push(i) }).then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual([0]);
    expect(svg.querySelector('[data-lamp="f"]')!.hasAttribute("data-on")).toBe(true);
    await vi.advanceTimersByTimeAsync(260);
    expect(seen).toEqual([0, 1]);
    expect(svg.querySelectorAll("[data-act]").length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(ended).toBe(true);
    expect(seen).toEqual([0, 1, 2, 3]);
    // Every motion cancelled, every overlay gone, and the drawing rewound for land().
    expect(anims.every((a) => a.cancelled)).toBe(true);
    expect(svg.querySelectorAll("[data-act], .m-head").length).toBe(0);
    expect(svg.querySelectorAll("[data-on], [data-ran], [data-ended]").length).toBe(0);
  });
  it("the dial's label says the step's own ms", async () => {
    const svg = make();
    const p = new MachinePlayer(svg);
    void p.act(STEPS, TIMES, { keep });
    await vi.advanceTimersByTimeAsync(760);
    expect(svg.querySelector(".m-act-ms")?.textContent).toBe("100 ms");
    p.stopAct();
  });
  it("stopAct ends it at once: the promise resolves, no later step runs", async () => {
    const svg = make();
    const p = new MachinePlayer(svg);
    const seen: number[] = [];
    const done = p.act(STEPS, TIMES, { keep, onStep: (i) => seen.push(i) });
    await vi.advanceTimersByTimeAsync(10);
    p.stopAct();
    await done;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual([0]);
    expect(svg.querySelectorAll("[data-act], .m-head, [data-on]").length).toBe(0);
  });
  it("skip() stops the act and leaves the resting beats' end state", async () => {
    const svg = make();
    const p = new MachinePlayer(svg);
    p.setScript([{ routes: ["f->stand-in x"], lamps: ["f", "stand-in x"] }]);
    const done = p.act(STEPS, TIMES, { keep });
    await vi.advanceTimersByTimeAsync(300);
    p.skip();
    await done;
    expect([...svg.querySelectorAll("[data-ran]")].map((e) => e.getAttribute("data-route"))).toEqual(["f->stand-in x"]);
    expect([...svg.querySelectorAll("[data-on]")].map((e) => e.getAttribute("data-lamp")).sort()).toEqual(["f", "stand-in x"]);
    expect(svg.querySelectorAll("[data-act]").length).toBe(0);
  });
  it("reduced motion: nothing plays, the promise resolves at once", async () => {
    const svg = make();
    const seen: number[] = [];
    await new MachinePlayer(svg, true).act(STEPS, TIMES, { keep, onStep: (i) => seen.push(i) });
    expect(seen).toEqual([]);
    expect(anims).toEqual([]);
  });
});
