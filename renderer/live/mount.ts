// R3: puts a drawing on the page and makes it answer: hover, click, keyboard, pan, zoom, click-to-skip, dark paper.
//
// Plain words: the drawing is one SVG. Moving and zooming only changes its viewBox, so a big chart stays cheap. A short click
// on a playing drawing skips to its end; a drag pans; the wheel or a pinch zooms about the pointer; 0 fits it again.
// Hover or focus on a part quiets everything it is not joined to. Browser only.

import type { Scene } from "../scene";
import type { RenderSpec } from "../spec";
import { idFromAttr } from "../words";
import type { Drawn } from "./draw";
import { Player, type PlayerOptions } from "./player";

export interface MountOptions extends PlayerOptions {
  theme?: "light" | "dark";
  /** The most a small chart is enlarged to fill its host. */
  maxScale?: number;
  /** The least scale at fit: below this the words are too small to read, so the fit fills the width and the rest pans. */
  minScale?: number;
  onSelect?: (nodeId: string) => void;
  pan?: boolean;
  /** Hovering a part quiets what it is not joined to. Off while a drawing is telling a story. */
  hover?: boolean;
}

export interface Mounted {
  player: Player | null;
  fit(): void;
  setTheme(t: "light" | "dark"): void;
  destroy(): void;
  view(): { x: number; y: number; k: number };
  /** Keep this part and its joins lit (a picked part), or null. */
  pick(id: string | null): void;
  /** True when the drawing is wider or taller than its host at the fit, so a phone needs to pan. */
  needsPan(): boolean;
}

/** Puts `drawn` in `host`. The list and the "not shown" sentence are plain HTML, with nothing to move. */
export function mountDrawing(host: HTMLElement, drawn: Drawn, spec: RenderSpec, o: MountOptions = {}): Mounted {
  host.classList.add("rr-host");
  host.dataset.theme = o.theme ?? "light";
  if (drawn.kind !== "drawing") {
    host.innerHTML = drawn.html;
    return { player: null, fit() {}, setTheme: (t) => void (host.dataset.theme = t), destroy: () => void (host.innerHTML = ""), view: () => ({ x: 0, y: 0, k: 1 }), pick() {}, needsPan: () => false };
  }
  // The text was escaped and no script, link or foreign object was written (renderer/check.ts proves it for hostile names).
  host.innerHTML = drawn.svg;
  const svg = host.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const scene: Scene = drawn.scene;
  const player = new Player(svg as SVGSVGElement, scene, spec, o);
  const state = { x: 0, y: 0, k: 1 };
  const apply = () => {
    const w = host.clientWidth / state.k;
    const h = host.clientHeight / state.k;
    svg.setAttribute("viewBox", `${state.x.toFixed(2)} ${state.y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  };
  const fit = () => {
    const W = host.clientWidth || 1;
    const H = host.clientHeight || 1;
    const contain = Math.min(W / scene.width, H / scene.height);
    const k = Math.min(o.maxScale ?? 1.15, Math.max(contain, Math.min(o.minScale ?? 0.62, W / Math.min(scene.width, 500))));
    state.k = k;
    // Centre what fits; start at the top left of what doesn't, where the title is.
    state.x = scene.width * k <= W ? (scene.width - W / k) / 2 : 0;
    state.y = scene.height * k <= H ? (scene.height - H / k) / 2 : 0;
    apply();
  };
  fit();

  const cleanups: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn as EventListener, opts);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener, opts));
  };

  // ---- hover and focus: what is this joined to? ----
  const near = (id: string | null) => {
    const world = svg.querySelector(".rr-world");
    for (const el of svg.querySelectorAll(".rr-near")) el.classList.remove("rr-near");
    if (id === null) {
      world?.classList.remove("rr-hover");
      return;
    }
    world?.classList.add("rr-hover");
    player.nodes.get(id)?.classList.add("rr-near");
    for (const e of scene.edges) {
      if (e.from !== id && e.to !== id) continue;
      player.edges.get(e.id)?.classList.add("rr-near");
      player.labels.get(e.id)?.classList.add("rr-near");
      player.nodes.get(e.from)?.classList.add("rr-near");
      player.nodes.get(e.to)?.classList.add("rr-near");
    }
  };
  let picked: string | null = null;
  const nodeOf = (t: EventTarget | null) => (t as Element | null)?.closest?.("[data-node]") as SVGGElement | null;
  on(host, "pointerover", (e) => {
    if (o.hover === false || e.pointerType !== "mouse") return;
    const n = nodeOf(e.target);
    near(n ? idFromAttr(n.dataset.node!) : picked);
  });
  on(host, "pointerleave", () => near(picked));
  on(host, "focusin", (e) => {
    const n = nodeOf(e.target);
    if (n) near(idFromAttr(n.dataset.node!));
  });
  on(host, "focusout", () => near(picked));
  on(host, "keydown", (e) => {
    const n = nodeOf(e.target);
    if (e.key === "0") return fit();
    if (e.key === "+" || e.key === "=") return zoomAt(host.clientWidth / 2, host.clientHeight / 2, 1.2);
    if (e.key === "-") return zoomAt(host.clientWidth / 2, host.clientHeight / 2, 1 / 1.2);
    if (e.key === "Escape") return player.skip();
    if (!n) {
      if (e.key === " ") {
        e.preventDefault();
        player.skip();
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      o.onSelect?.(idFromAttr(n.dataset.node!));
      return;
    }
    // Arrow keys walk to the next part this one is joined to.
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const id = idFromAttr(n.dataset.node!);
      const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
      const next = forward ? scene.edges.find((x) => x.from === id && x.to !== id)?.to : scene.edges.find((x) => x.to === id && x.from !== id)?.from;
      if (next) (player.nodes.get(next) as unknown as HTMLElement | undefined)?.focus();
    }
  });

  // ---- pan and zoom ----
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  const zoomAt = (px: number, py: number, factor: number) => {
    const k = Math.max(0.2, Math.min(4, state.k * factor));
    state.x += px / state.k - px / k;
    state.y += py / state.k - py / k;
    state.k = k;
    apply();
  };
  const panOn = o.pan ?? true;
  on(host, "pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  });
  on(host, "pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !panOn) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0) {
        const r = host.getBoundingClientRect();
        zoomAt((a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top, d / pinch);
      }
      pinch = d;
      return;
    }
    if (moved < 4) return;
    host.setPointerCapture?.(e.pointerId);
    state.x -= dx / state.k;
    state.y -= dy / state.k;
    apply();
  });
  const up = (e: PointerEvent) => {
    const was = pointers.delete(e.pointerId);
    if (!was) return;
    if (moved < 4 && e.type === "pointerup") {
      player.skip();
      const n = nodeOf(e.target);
      if (n) o.onSelect?.(idFromAttr(n.dataset.node!));
    }
  };
  on(host, "pointerup", up);
  on(host, "pointercancel", up);
  if (panOn) {
    on(
      host,
      "wheel",
      (e) => {
        e.preventDefault();
        const r = host.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
        else {
          state.x += e.deltaX / state.k;
          state.y += e.deltaY / state.k;
          apply();
        }
      },
      { passive: false },
    );
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  ro?.observe(host);
  cleanups.push(() => ro?.disconnect());

  return {
    player,
    fit,
    setTheme: (t) => void (host.dataset.theme = t),
    destroy() {
      for (const c of cleanups) c();
      host.innerHTML = "";
    },
    view: () => ({ ...state }),
    pick(id) {
      picked = id;
      near(id);
    },
    needsPan: () => scene.width * state.k > host.clientWidth + 2 || scene.height * state.k > host.clientHeight + 2,
  };
}
