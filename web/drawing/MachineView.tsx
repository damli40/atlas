// D65: the machine on the page. Plain SVG text from renderer/machine; React never touches what is inside it. Each part is a button, and
// clicking one says what it stands for and its lines: in the page's part panel (R6) when the page has one, else in a small card.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACT_CSS, MachinePlayer } from "../../renderer/machine/player";
import type { ActStep } from "../../renderer/authors/run-act";
import { MACHINE_CSS } from "../../renderer/machine/pencil";
import type { MachineDrawn } from "../../renderer/authors/machine";
import type { MachineBeat } from "../../renderer/authors/machine-script";
import { ensureRendererStyle } from "./Drawing";
import { NAMER_WORDS } from "../../src/natural-names";

const VIEW_KEY = "atlas-view";
/** The machine is the first view unless this person chose the chart, or the screen is a phone. */
export const machineFirst = (): boolean => {
  if (typeof window === "undefined") return true;
  if (window.innerWidth < 760) return false;
  try {
    return window.sessionStorage.getItem(VIEW_KEY) !== "chart";
  } catch {
    return true;
  }
};
export const rememberView = (view: "machine" | "chart") => {
  try {
    window.sessionStorage.setItem(VIEW_KEY, view);
  } catch {
    // only a preference
  }
};

let styled = false;
export function ensureMachineStyle() {
  ensureRendererStyle();
  if (styled || typeof document === "undefined") return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.atlas = "machine";
  style.textContent = MACHINE_CSS + ACT_CSS;
  document.head.append(style);
}

/** True once the machine's font is in, or soon enough. Parts and words are placed by measuring them: measured in the fallback font, they overrun. */
export function useFontsIn(): boolean {
  const [fontsIn, setFontsIn] = useState(() => typeof document === "undefined" || typeof document.fonts?.load !== "function");
  useEffect(() => {
    if (fontsIn) return;
    let live = true;
    const done = () => live && setFontsIn(true);
    const fonts = (typeof document !== "undefined" ? document : {}) as { fonts?: { load?: (f: string) => Promise<unknown> } };
    void Promise.race([Promise.all([fonts.fonts?.load?.('400 20px "Atlas Besley"'), fonts.fonts?.load?.('italic 400 14px "Atlas Besley"')]), new Promise((r) => setTimeout(r, 500))]).then(done, done);
    return () => {
      live = false;
    };
  }, [fontsIn]);
  return fontsIn;
}

export interface MachineControl {
  play(i: number, ms: number): void;
  setScript(beats: MachineBeat[]): void;
  rewind(): void;
  land(): void;
  skip(): void;
  /** R8: plays the run's act; ends when it does, or at once on skip(). */
  act(steps: readonly ActStep[], times: readonly { at: number; ms: number }[], o: { keep: { routes: ReadonlySet<string>; lamps: ReadonlySet<string> }; onStep?: (i: number) => void }): Promise<void>;
}

const DRAWN_KEY = "atlas-machine-drawn";
/** How long the machine takes to pencil itself in: the first ever about 850 ms; after that it just arrives quickly. */
function penTime(): number {
  try {
    const seen = window.localStorage.getItem(DRAWN_KEY);
    window.localStorage.setItem(DRAWN_KEY, "1");
    return seen ? 240 : 850;
  } catch {
    return 240;
  }
}

export const MachineSheet = forwardRef<MachineControl, { drawn: MachineDrawn; reduced?: boolean; /** True: the page showed the part in its panel, so no card is shown here as well. */ onPart?: (id: string) => boolean | void; /** The part the page's panel is about: marked on the drawing. */ picked?: string | null; /** R14: the part Muse Wonder picked for this person: marked on the drawing (live page only, never the proof picture). */ aimed?: string | null; testid?: string; /** A new value pencils the machine in: a new paste, not a new test on it. */ penKey?: string | null; /** The run's beats, and whether its result has landed: a machine that mounts after that (M, or the chart first) shows the same result at once. */ beats?: MachineBeat[]; landed?: boolean }>(function MachineSheet({ drawn, reduced = false, onPart, picked = null, aimed = null, testid = "machine", penKey = null, beats, landed = false }, ref) {
  ensureMachineStyle();
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<MachinePlayer | null>(null);
  const penned = useRef<string | null>(null);
  const playerOf = useRef<Element | null>(null);
  const [card, setCard] = useState<{ words: string; x: number; y: number } | null>(null);
  const html = useMemo(() => ({ __html: drawn.svg }), [drawn.svg]);
  useLayoutEffect(() => {
    const svg = host.current?.querySelector("svg");
    // React's strict mode runs this twice for one drawing: the same SVG keeps its player, and its pencilling goes on.
    if (svg !== playerOf.current) {
      player.current?.finishPen();
      player.current = svg ? new MachinePlayer(svg as SVGSVGElement, reduced) : null;
      playerOf.current = svg ?? null;
    }
    if (landed && beats && player.current && !player.current.hasLanded()) player.current.settleAt(beats);
    if (penKey !== null && penKey !== penned.current) {
      penned.current = penKey;
      player.current?.penIn(penTime());
    }
  }, [drawn.svg, reduced, penKey, landed]);
  // R8: a machine taken off the page (M, or a new paste) ends its act, so the page's story goes on to the result.
  useEffect(() => () => player.current?.stopAct(), []);
  useImperativeHandle(ref, () => ({
    play: (i, ms) => void player.current?.play(i, ms),
    setScript: (b) => player.current?.setScript(b),
    rewind: () => player.current?.rewind(),
    land: () => player.current?.land(),
    skip: () => player.current?.skip(),
    act: (steps, times, o) => player.current?.act(steps, times, o) ?? Promise.resolve(),
  }), []);
  useEffect(() => {
    if (!card) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".u1-proof")) return;
      e.preventDefault();
      setCard(null);
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [card]);
  // The part the panel is about stays marked, whatever is redrawn under it.
  useEffect(() => {
    const svg = host.current?.querySelector("svg");
    if (!svg) return;
    for (const el of svg.querySelectorAll("[data-picked]")) el.removeAttribute("data-picked");
    if (picked) for (const el of svg.querySelectorAll(".m-part[data-part]")) if ((el.getAttribute("data-part") ?? "").split("#")[0] === picked) el.setAttribute("data-picked", "");
  }, [picked, drawn.svg]);
  useEffect(() => {
    const svg = host.current?.querySelector("svg");
    if (!svg) return;
    for (const el of svg.querySelectorAll("[data-aimed]")) el.removeAttribute("data-aimed");
    if (aimed) for (const el of svg.querySelectorAll(".m-part[data-part]")) if ((el.getAttribute("data-part") ?? "").split("#")[0] === aimed) el.setAttribute("data-aimed", "");
  }, [aimed, drawn.svg]);
  const show = (el: Element) => {
    const part = el.closest("[data-part]");
    if (!part) return setCard(null);
    // One place says what a part is: the page's panel when it took the click, else the card.
    if (onPart?.((part.getAttribute("data-part") ?? "").split("#")[0]!) === true) return setCard(null);
    const box = part.getBoundingClientRect();
    const mine = host.current!.getBoundingClientRect();
    setCard({ words: part.getAttribute("aria-label") ?? "", x: box.left - mine.left + box.width / 2, y: box.top - mine.top });
  };
  return (
    <div
      ref={host}
      className="rr-host m-host"
      data-theme="light"
      data-testid={testid}
      onClick={(e) => {
        e.stopPropagation();
        show(e.target as Element);
      }}
      onPointerUp={(e) => (e.target as Element).closest?.("[data-part]") && e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (!(e.target as Element).closest?.("[data-part]")) return;
          e.preventDefault();
          show(e.target as Element);
        }
      }}
    >
      {/* R6: whenever a lid carries a name Meta's AI wrote, the page says so in words, not only with the star. */}
      {drawn.aiNames ? <p className="m-legend" data-testid="machine-names-legend">{NAMER_WORDS.legend}</p> : null}
      <div className="m-svg" data-legend={drawn.aiNames ? "" : undefined} dangerouslySetInnerHTML={html} style={{ ["--m-w" as string]: `${drawn.width}px`, ["--m-h" as string]: `${drawn.height}px` }} />
      {card && (
        <p className="m-card-pop" role="status" data-testid="machine-card" style={{ left: Math.max(170, card.x), top: Math.max(8, card.y - 8) }}>
          {card.words}
        </p>
      )}
    </div>
  );
});
