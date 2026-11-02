// D65: the machine on the page. Plain SVG text from renderer/machine; React never touches what is inside it. Each part is a button, and
// clicking one says what it stands for and its lines.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MachinePlayer } from "../../renderer/machine/player";
import { MACHINE_CSS } from "../../renderer/machine/pencil";
import type { MachineDrawn } from "../../renderer/authors/machine";
import type { MachineBeat } from "../../renderer/authors/machine-script";
import { ensureRendererStyle } from "./Drawing";

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
function ensureMachineStyle() {
  ensureRendererStyle();
  if (styled || typeof document === "undefined") return;
  styled = true;
  const style = document.createElement("style");
  style.dataset.atlas = "machine";
  style.textContent = MACHINE_CSS;
  document.head.append(style);
}

export interface MachineControl {
  play(i: number, ms: number): void;
  setScript(beats: MachineBeat[]): void;
  rewind(): void;
  land(): void;
  skip(): void;
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

export const MachineSheet = forwardRef<MachineControl, { drawn: MachineDrawn; reduced?: boolean; onPart?: (id: string) => void; testid?: string; /** A new value pencils the machine in: a new paste, not a new test on it. */ penKey?: string | null }>(function MachineSheet({ drawn, reduced = false, onPart, testid = "machine", penKey = null }, ref) {
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
    if (penKey !== null && penKey !== penned.current) {
      penned.current = penKey;
      player.current?.penIn(penTime());
    }
  }, [drawn.svg, reduced, penKey]);
  useImperativeHandle(ref, () => ({
    play: (i, ms) => void player.current?.play(i, ms),
    setScript: (b) => player.current?.setScript(b),
    rewind: () => player.current?.rewind(),
    land: () => player.current?.land(),
    skip: () => player.current?.skip(),
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
  const show = (el: Element) => {
    const part = el.closest("[data-part]");
    if (!part) return setCard(null);
    const box = part.getBoundingClientRect();
    const mine = host.current!.getBoundingClientRect();
    setCard({ words: part.getAttribute("aria-label") ?? "", x: box.left - mine.left + box.width / 2, y: box.top - mine.top });
    onPart?.((part.getAttribute("data-part") ?? "").split("#")[0]!);
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
      <div className="m-svg" dangerouslySetInnerHTML={html} style={{ ["--m-w" as string]: `${drawn.width}px`, ["--m-h" as string]: `${drawn.height}px` }} />
      {card && (
        <p className="m-card-pop" role="status" data-testid="machine-card" style={{ left: Math.max(170, card.x), top: Math.max(8, card.y - 8) }}>
          {card.words}
        </p>
      )}
    </div>
  );
});
