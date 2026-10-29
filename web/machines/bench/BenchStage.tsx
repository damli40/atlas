// U1 (D47): the full-screen drawing. It draws the bench model (model.ts) with the explorer's drawing code
// (figure.mjs, in a worker), lets the reader pan and zoom it, shows a hover card for each box, and AFTER the bets are
// sealed plays the run on it and pins the quiz marks to the parts they are about.
//
// The rule it keeps (D47): before the bets are sealed it is given no run at all. `after` is the only door for run data,
// and the page passes it only once the run answered (which happens only after sealing). Without `after`, no lamp is
// lit, the dial needle stands at 0, no chip and no mark is drawn (tests/unit/u1-stage.test.tsx checks the DOM).
//
// Motion: one orchestrated sequence per run (calls light their devices in order, the dial follows the virtual clock,
// the function box shows its ending, then the marks appear). Under reduced motion the end state is shown at once.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent } from "react";
import { buildFigure, dialNeedle, TooManyToDraw, W, H } from "../explorer/figure.mjs";
import type { BenchReply } from "./bench.worker";
import { CLOCK_ID, type BenchModel, type BenchPart } from "./model";
import { OUTCOME_WORDS, type Mark, type Script } from "./play";
import { applyPick } from "../explorer/pick";
import { lineSpan } from "../../../src/words";

const DARK = "(prefers-color-scheme: dark)";
const STILL = "(prefers-reduced-motion: reduce)";
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(q);
      m.addEventListener("change", changed);
      return () => m.removeEventListener("change", changed);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches,
    () => false,
  );
}
export const useDarkScheme = () => useMedia(DARK);
export const useReducedMotion = () => useMedia(STILL);

/** An attribute value inside a "…" selector. */
const attr = (v: string) => v.replace(/["\\]/g, "\\$&");

type Dials = Record<string, { x: number; y: number; top: number; r: number }>;
type Built = { svg: string; P: unknown; dials: Dials } | { error: string } | { drawing: true };

/** Builds the figure in a worker (or in place where there is no Worker, e.g. tests). */
function useFigure(model: BenchModel): Built {
  const [built, setBuilt] = useState<Built>({ drawing: true });
  useEffect(() => {
    if (model.notShown !== null) {
      setBuilt({ error: model.notShown });
      return;
    }
    const sync = () => {
      try {
        const f = buildFigure(model);
        setBuilt({ svg: f.svg, P: f.P, dials: f.dials });
      } catch (e) {
        setBuilt({ error: e instanceof TooManyToDraw ? `${(e as Error).message}; the parts are listed in the side panel` : `The drawing could not be made: ${(e as Error).message}` });
      }
    };
    if (typeof Worker === "undefined" || typeof window === "undefined") {
      sync();
      return;
    }
    // Keep the last drawing on screen while the next one is built (a test adds the stand-in deck).
    setBuilt((b) => ("svg" in b ? b : { drawing: true }));
    const worker = new Worker(new URL("./bench.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<BenchReply>) => {
      worker.terminate();
      const r = e.data;
      setBuilt(r.ok ? { svg: r.svg, P: r.P, dials: r.dials } : { error: r.tooMany ? `${r.message}; the parts are listed in the side panel` : `The drawing could not be made: ${r.message}` });
    };
    worker.onerror = () => {
      worker.terminate();
      sync();
    };
    worker.postMessage({ id: 1, model });
    return () => worker.terminate();
  }, [model]);
  return built;
}

/** Run data for the drawing. Passed only after the bets are sealed and the run answered. */
export interface After {
  /** Changes on every play (so "Play again" restarts). */
  token: number;
  script: Script;
  marks: Mark[];
  /** The dial's full sweep in ms. */
  dialFullMs: number;
}

export interface Anchor {
  x: number;
  y: number;
}

export interface BenchStageProps {
  model: BenchModel;
  theme?: "light" | "dark";
  after?: After | null;
  /** A code box was chosen as the function to test. */
  onTestFunction?: (name: string) => void;
  /** Words in the corners (Anatomy's card: Fig n, title, hint, readout). */
  title: string;
  /** Called with each mark's anchor position, so the page can lay out its own list. */
  children?: ReactNode;
  /**
   * X3 hook: extra marks pinned to parts: plain code's failure labels. D50 (X3 review round 2): shown before betting too
   * (they are facts about the code's text, and every bettor's text carries the same labels); after a run they follow
   * the marks toggle like the run's own marks. They never carry run data before a run exists.
   */
  extraMarks?: { anchor: string; text: string }[];
  /** A panel (the bet pop-up) is open on the right: the drawing moves left to stay in view. */
  side?: boolean;
  /** Words under the judged answers (e.g. Muse Wonder's sentence, shown only after the run). */
  footnote?: ReactNode;
}

const STEP_MS = 700;

export function BenchStage({ model, theme, after = null, onTestFunction, title, children, extraMarks = [], side = false, footnote = null }: BenchStageProps) {
  const dark = useDarkScheme();
  const still = useReducedMotion();
  const shown = theme ?? (dark ? "dark" : "light");
  const built = useFigure(model);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgHost = useRef<HTMLDivElement | null>(null);
  const [anchors, setAnchors] = useState<Record<string, Anchor & { w: number; h: number }>>({});
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [chips, setChips] = useState<Record<string, string>>({});
  const [clockMs, setClockMs] = useState<number | null>(null);
  const [marksOn, setMarksOn] = useState(false);
  const [focusMark, setFocusMark] = useState<string | null>(null);
  const svgReady = "svg" in built ? built.svg : null;

  // Anchors: each box's top centre in SVG units, measured from its hit path.
  useLayoutEffect(() => {
    const host = svgHost.current;
    if (!host || !svgReady) return;
    const out: Record<string, Anchor & { w: number; h: number }> = {};
    for (const el of host.querySelectorAll<SVGGraphicsElement>("[data-hit]")) {
      const id = el.getAttribute("data-hit")!;
      try {
        const b = el.getBBox();
        out[id] = { x: b.x + b.width / 2, y: b.y, w: b.width, h: b.height };
      } catch {
        out[id] = { x: W / 2, y: H / 2, w: 0, h: 0 };
      }
    }
    setAnchors(out);
  }, [svgReady]);

  // The tested function and its devices are lit (the rest steps back), as the explorer's pick does.
  useEffect(() => {
    if (rootRef.current && svgReady) applyPick(rootRef.current, model.boxes, model.tested);
  }, [svgReady, model]);

  const needle = useCallback(
    (frac: number) => {
      if (!("svg" in built)) return;
      const d = built.dials[CLOCK_ID];
      const el = svgHost.current?.querySelector(`[data-needle="${attr(CLOCK_ID)}"] path`);
      if (d && el) el.setAttribute("d", dialNeedle(d, built.P, frac));
    },
    [built],
  );
  const lamp = (id: string, on: boolean) => {
    const el = svgHost.current?.querySelector(`[data-lamp="${attr(id)}"]`);
    if (el) el.toggleAttribute("data-on", on);
  };
  const lineLit = (id: string | null, on: boolean) => {
    if (!id) return;
    for (const el of svgHost.current?.querySelectorAll(`[data-line="${attr(id)}"]`) ?? []) el.classList.toggle("u1-live", on);
  };

  // The run, played on the drawing. Without `after`: the rest state (lamps off, needle at 0, no chips, no marks).
  useEffect(() => {
    setChips({});
    setClockMs(null);
    setMarksOn(false);
    if (!svgReady) return;
    for (const el of svgHost.current?.querySelectorAll("[data-lamp]") ?? []) el.removeAttribute("data-on");
    for (const el of svgHost.current?.querySelectorAll(".u1-live") ?? []) el.classList.remove("u1-live");
    needle(0);
    if (!after) return;
    const { script, dialFullMs } = after;
    const frac = (ms: number) => ms / Math.max(1, dialFullMs);
    const endState = () => {
      const c: Record<string, string> = { ...script.totals };
      if (script.ending && model.tested) c[model.tested] = script.ending;
      setChips(c);
      if (script.dialEndMs !== null) {
        needle(frac(script.dialEndMs));
        setClockMs(script.dialEndMs);
      }
      setMarksOn(true);
    };
    if (still || script.notShown !== null || script.steps.length === 0) {
      endState();
      return;
    }
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const raf = { current: 0 };
    let from = 0;
    const turn = (to: number, over: number) => {
      // One needle motion at a time: a newer turn cancels the older one, so a slow frame never lands an old value last.
      cancelAnimationFrame(raf.current);
      const start = performance.now();
      const a = from;
      from = to;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / over);
        const e = 1 - (1 - t) ** 3;
        needle(frac(a + (to - a) * e));
        if (t < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    };
    script.steps.forEach((s, i) => {
      at(300 + i * STEP_MS, () => {
        lamp(s.device, true);
        lineLit(s.line, true);
        setChips((c) => ({ ...c, [s.device]: s.words }));
        if (script.dialEndMs !== null) {
          turn(s.at, STEP_MS * 0.6);
          setClockMs(s.at);
        }
      });
      at(300 + i * STEP_MS + STEP_MS * 0.6, () => {
        lamp(s.device, false);
        lineLit(s.line, false);
      });
    });
    const end = 300 + script.steps.length * STEP_MS;
    at(end, () => {
      if (script.dialEndMs !== null) turn(script.dialEndMs, 500);
    });
    at(end + 600, () => {
      cancelAnimationFrame(raf.current);
      endState();
    });
    return () => {
      timers.forEach((t) => clearTimeout(t));
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after?.token, svgReady, still]);

  // ---- pan and zoom ----
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean; pointers: Map<number, { x: number; y: number }>; pinch: number | null } | null>(null);
  const zoomBy = (f: number) => setView((v) => ({ ...v, s: Math.min(4, Math.max(0.6, v.s * f)) }));
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest(".u1-card, .u1-zoom, .u1-pin")) return;
    const d = drag.current ?? { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, pointers: new Map(), pinch: null };
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 1) Object.assign(d, { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false });
    drag.current = d;
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) {
      const hit = (e.target as Element).closest?.("[data-hit]");
      setHover(hit ? hit.getAttribute("data-hit") : null);
      return;
    }
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d.pinch !== null) zoomBy(dist / d.pinch);
      d.pinch = dist;
      d.moved = true;
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.pointers.delete(e.pointerId);
    if (d.pointers.size > 0) return;
    drag.current = null;
    if (!d.moved) {
      const hit = (e.target as Element).closest?.("[data-hit]");
      setPinned(hit ? hit.getAttribute("data-hit") : null);
    }
  };
  const order = model.boxes.map((b) => b.id);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = pinned ? order.indexOf(pinned) : -1;
      const n = order.length;
      setPinned(order[i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!);
    } else if (e.key === "Escape") setPinned(null);
    else if (e.key === "+" || e.key === "=") zoomBy(1.2);
    else if (e.key === "-") zoomBy(1 / 1.2);
    else if (e.key === "0") setView({ s: 1, x: 0, y: 0 });
  };

  const cardId = pinned ?? hover;
  const at = (a: Anchor) => ({ left: `${(a.x / W) * 100}%`, top: `${(a.y / H) * 100}%` });
  const marksByAnchor = useMemo(() => {
    const m = new Map<string, Mark[]>();
    for (const mk of after?.marks ?? []) m.set(mk.anchor, [...(m.get(mk.anchor) ?? []), mk]);
    return m;
  }, [after]);
  const readout = after && marksOn ? marksReadout(after.marks) : model.tested ? `testing ${model.tested}` : `${model.boxes.length} ${model.boxes.length === 1 ? "part" : "parts"} · ${model.lines.length} ${model.lines.length === 1 ? "join" : "joins"}`;

  return (
    <div className={`iso u1-root${marksOn ? " u1-marked" : ""}`} data-theme={shown === "light" ? "light" : undefined} ref={rootRef} data-testid="bench-stage" data-phase={after ? (marksOn ? "marked" : "playing") : "rest"} data-side={side || (after && marksOn) ? "" : undefined}>
      <div className="iso-plate-corners u1-corners" aria-hidden="true">
        <span className="iso-plate-corner" data-corner="fig">Fig U1</span>
        <span className="iso-plate-corner" data-corner="title">{title}</span>
        <span className="iso-plate-corner" data-corner="hint">drag to move · pinch or ctrl+scroll to zoom · Tab, then ← →</span>
        <span className="iso-plate-corner" data-corner="readout" data-readout="">
          {readout}
        </span>
      </div>
      <div
        className="u1-viewport ex"
        tabIndex={0}
        role="group"
        aria-label="The drawing of your code. Left and right arrows pick a part; Escape clears; plus and minus zoom."
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        data-testid="bench-viewport"
      >
        <div className="u1-pan" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          <div className="u1-figure">
            {"svg" in built ? (
              <div className="u1-svg" ref={svgHost} dangerouslySetInnerHTML={{ __html: built.svg }} />
            ) : "error" in built ? (
              <p className="u1-notice" role="note" data-testid="bench-not-drawn">
                {built.error}
              </p>
            ) : (
              <p className="u1-notice" role="status" data-testid="bench-drawing">
                Drawing your code…
              </p>
            )}
            {/* Run chips: only from `after` (never before the bets are sealed). */}
            {after &&
              Object.entries(chips).map(([id, words]) =>
                anchors[id] ? (
                  <span key={`chip-${id}`} className="u1-chip" data-run="" data-of={id} style={at(anchors[id]!)} data-testid={`chip-${id}`}>
                    {words}
                  </span>
                ) : null,
              )}
            {after && clockMs !== null && anchors[CLOCK_ID] && (
              <span className="u1-chip u1-chip-clock" data-run="" style={at(anchors[CLOCK_ID]!)} data-testid="chip-clock">
                {`${clockMs.toLocaleString("en-US")} ms${clockMs > after.dialFullMs ? ` (past the dial's ${after.dialFullMs.toLocaleString("en-US")} ms)` : ""}`}
              </span>
            )}
            {after &&
              marksOn &&
              [...marksByAnchor.entries()].map(([anchor, list]) =>
                anchors[anchor] ? (
                  <div key={`pins-${anchor}`} className="u1-pins" style={at({ x: anchors[anchor]!.x, y: anchors[anchor]!.y + anchors[anchor]!.h })} data-run="">
                    {list.map((mk) => {
                      const you = mk.picks.find((p) => p.who === "human");
                      return (
                        <button
                          type="button"
                          key={mk.measures}
                          className="u1-pin"
                          data-outcome={you?.outcome ?? "cant_check"}
                          aria-pressed={focusMark === mk.measures}
                          aria-label={`${after.marks.indexOf(mk) + 1}. ${mk.question}: ${you ? OUTCOME_WORDS[you.outcome] : "no pick"}`}
                          onClick={() => setFocusMark((f) => (f === mk.measures ? null : mk.measures))}
                          data-testid={`pin-${mk.measures}`}
                        >
                          <Glyph outcome={you?.outcome ?? "cant_check"} />
                          <span className="u1-pin-n" aria-hidden="true">
                            {after.marks.indexOf(mk) + 1}
                          </span>
                          <span className="u1-pin-t">{`${mk.question}: ${you ? OUTCOME_WORDS[you.outcome] : "no pick"}`}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null,
              )}
            {(after ? marksOn : true) &&
              extraMarks.map((x, i) =>
                anchors[x.anchor] ? (
                  <span key={`x-${i}`} className="u1-chip u1-chip-label" data-label-mark="" style={{ ...at(anchors[x.anchor]!), marginTop: `${28 * extraMarks.slice(0, i).filter((y) => y.anchor === x.anchor).length}px` }} data-testid={`label-mark-${i}`}>
                    {x.text}
                  </span>
                ) : null,
              )}
          </div>
        </div>
        {cardId && anchors[cardId] && model.parts[cardId] && <PartCard id={cardId} part={model.parts[cardId]!} tested={model.tested} pinned={pinned === cardId} onTest={onTestFunction} onClose={() => setPinned(null)} canChange={!after} />}
      </div>
      <div className="u1-zoom" role="group" aria-label="zoom">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView({ s: 1, x: 0, y: 0 })} aria-label="Fit the drawing">
          Fit
        </button>
      </div>
      {after && marksOn && <MarkList marks={after.marks} focus={focusMark} onFocus={setFocusMark} footnote={footnote} />}
      {children}
    </div>
  );
}

function marksReadout(marks: readonly Mark[]): string {
  const you = marks.map((m) => m.picks.find((p) => p.who === "human")?.outcome ?? "cant_check");
  const n = (o: string) => you.filter((x) => x === o).length;
  return `you: ${n("matched")} matched · ${n("not_matched")} didn't match · ${n("cant_check")} can't check`;
}

/** matched = a filled dot; didn't match = a ring cut short; can't check = a dashed ring with a level dash (the scoreboard's marks). */
export function Glyph({ outcome }: { outcome: Mark["picks"][number]["outcome"] }) {
  return (
    <svg className="u1-glyph" data-outcome={outcome} viewBox="0 0 12 12" aria-hidden="true">
      {outcome === "matched" ? <circle cx="6" cy="6" r="4.2" /> : outcome === "not_matched" ? <path d="M6 1.8a4.2 4.2 0 1 0 4.2 4.2" /> : <><circle cx="6" cy="6" r="4.2" strokeDasharray="1.6 1.6" /><path d="M3.6 6h4.8" /></>}
    </svg>
  );
}

function MarkList({ marks, focus, onFocus, footnote }: { marks: readonly Mark[]; focus: string | null; onFocus: (m: string | null) => void; footnote: ReactNode }) {
  return (
    <section className="u1-marks" aria-label="How each answer was judged" data-testid="mark-list">
      <h2>Judged by plain code</h2>
      <ul>
        {marks.map((m) => (
          <li key={m.measures} data-focus={focus === m.measures ? "" : undefined} data-testid={`mark-${m.measures}`}>
            <button type="button" className="u1-mark-head" onClick={() => onFocus(focus === m.measures ? null : m.measures)} aria-expanded={focus === m.measures}>
              {`${marks.indexOf(m) + 1}. ${m.question}`}
            </button>
            <p className="u1-measured">
              <span className="u1-k">The run:</span> {m.measured}
            </p>
            <ul className="u1-picks">
              {m.picks.map((p) => (
                <li key={p.who}>
                  <Glyph outcome={p.outcome} />
                  <span className="u1-who" title={p.name}>
                    {shortName(p.name)}
                  </span>
                  <span className="u1-pick">{p.pick}</span>
                  <span className="u1-out">{OUTCOME_WORDS[p.outcome]}</span>
                  {p.outcome === "cant_check" && p.reason && focus === m.measures && <span className="u1-why">{p.reason}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {footnote}
    </section>
  );
}

/** "Muse Spark 1.3 (muse-spark-1.3)" → "Muse Spark 1.3"; the full name stays in the title (D10: Meta's names stay visible). */
const shortName = (name: string) => name.replace(/\s*\(.*$/, "");

function PartCard({ id, part, tested, pinned, onTest, onClose, canChange }: { id: string; part: BenchPart; tested: string | null; pinned: boolean; onTest?: (name: string) => void; onClose: () => void; canChange: boolean }) {
  return (
    <aside className="u1-card" data-pinned={pinned ? "" : undefined} aria-live="polite" data-testid="part-card">
      {part.kind === "code" ? (
        <>
          <h3>{part.part.name}</h3>
          <p className="u1-sub">{`${part.part.kind === "class" ? "class" : "function"} · ${lineSpan(part.part.lineStart, part.part.lineEnd)}${part.part.exported ? " · exported" : ""}`}</p>
          {part.part.signature && <code className="u1-sig">{part.part.signature}</code>}
          <p>{part.callsTo.length ? `Calls ${part.callsTo.join(", ")}.` : "Calls no other part of this file."} {part.calledBy.length ? `Called by ${part.calledBy.join(", ")}.` : ""}</p>
          {tested === id ? <p className="u1-sub">This is the function the test calls.</p> : part.part.exported && part.part.kind === "function" && onTest && canChange ? (
            <button type="button" className="u1-btn" onClick={() => onTest(id)} data-testid={`test-fn-${id}`}>
              Test this function
            </button>
          ) : null}
        </>
      ) : part.kind === "device" ? (
        <>
          <h3>{`Stand-in: ${part.name}`}</h3>
          <p className="u1-sub">{`A fake function Atlas passes in${part.async ? " (async)" : ""}. Scripted by the test:`}</p>
          <ol className="u1-steps">
            {part.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="u1-sub">{`After that, ${part.then}.`}</p>
        </>
      ) : (
        <>
          <h3>Atlas's clock</h3>
          <p className="u1-sub">{`Atlas's clock is simulated: waits cost no real time. The dial runs from 0 to ${part.fullMs.toLocaleString("en-US")} ms.${part.marks.length ? ` Its longer ticks mark ${part.marks.map((m) => `${m.toLocaleString("en-US")} ms`).join(" and ")}, from the test's own scripted waits.` : ""}`}</p>
        </>
      )}
      {pinned && (
        <button type="button" className="u1-close" onClick={onClose} aria-label="Close this card">
          ×
        </button>
      )}
    </aside>
  );
}
