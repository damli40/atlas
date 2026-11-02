// U1 (D47), redrawn in R3 phase 2 (D55): the full-screen drawing. Atlas authors a spec from the bench model
// (renderer/authors/bet-view.ts) and the renderer draws it; the chart draws itself on. It shows a card for each part,
// and AFTER the bets are sealed plays the run as the "what happened" path, from the measured trace, and marks each answer.
//
// The rule it keeps (D47): before the bets are sealed it is given no run at all. `after` is the only door for run data,
// and the page passes it only once the run answered (which happens only after sealing). Without `after` there is no path, no
// lit lamp, no mark (tests/unit/u1-stage.test.tsx checks the DOM, and the spec is refused if it holds run data).
//
// Motion: one story per run: each call's thread is drawn and its ticket pinned, each wait's clock sweeps, its device's lamp
// lights on the chart beside it, then the answers land. A click, Space or Escape skips to the end. Under reduced motion the
// end state is shown at once.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { benchSpec } from "../../../renderer/authors/bet-view";
import { momentOf, type Moment } from "../../../src/moment";
import { MachineSheet, machineFirst, rememberView, type MachineControl } from "../../drawing/MachineView";
import { drawMachine, machineParts, ringFor, type MachineParts, type MachineRing } from "../../../renderer/authors/machine";
import type { CountChange } from "../../../src/remember";
import { machineScript } from "../../../renderer/authors/machine-script";
import { whatHappened } from "../../../renderer/authors/what-happened";
import type { HelperAnswer } from "../../api";
import type { Mounted } from "../../../renderer/live/mount";
import type { SpecStep } from "../../../renderer/spec";
import { idFromAttr } from "../../../renderer/words";
import type { FileOutline } from "../../../src/file-outline";
import type { Bet, Experiment, Run, Verdict } from "../../../src/types";
import { Drawing } from "../../drawing/Drawing";
import { useDarkScheme, useReducedMotion } from "../../drawing/media";
import { CLOCK_ID, deviceId, type BenchModel, type BenchPart } from "./model";
import { OUTCOME_WORDS, type Mark, type Script } from "./play";
import { lineSpan } from "../../../src/words";
import { RESULT_WORDS, STAGE_WORDS } from "../../../src/paste-words";
import { CANT_TELL } from "../../../src/quiz";

export { useDarkScheme, useReducedMotion };

/** Run data for the drawing. Passed only after the bets are sealed and the run answered. */
export interface After {
  /** Changes on every play (so "Play again" restarts). */
  token: number;
  script: Script;
  marks: Mark[];
  /** The dial's full sweep in ms. */
  dialFullMs: number;
  run: Run;
  experiment: Pick<Experiment, "params">;
  bets: readonly Bet[];
  verdicts: readonly Verdict[];
  /** R3: the code's own steps, from a third run made only for this drawing. */
  helpers?: HelperAnswer | null;
}

export interface BenchStageProps {
  model: BenchModel;
  theme?: "light" | "dark";
  after?: After | null;
  /** This code and test have already run here: "nothing has run" would be false. */
  seenBefore?: boolean;
  /** This code has already run here on some test: nothing on screen may say nothing has run. */
  codeRan?: boolean;
  /** D60: a part was clicked on the drawing: the code drawer jumps to its lines. */
  onPart?: (name: string) => void;
  /** A code box was chosen as the function to test. */
  onTestFunction?: (name: string) => void;
  /** The file and its size, above the name. */
  title: string;
  /** The file itself: the chart's call sites and waits are read from it. */
  source: string;
  language: "js" | "ts" | "py";
  outline: FileOutline;
  fileName: string;
  children?: ReactNode;
  /**
   * X3 hook: plain code's failure labels, on the parts they are about. D50 (X3 review round 2): shown before betting too
   * (they are facts about the code's text, and every bettor's text carries the same labels).
   */
  extraMarks?: { anchor: string; text: string }[];
  /** A panel (the bet pop-up) is open beside the drawing. */
  side?: boolean;
  /** Words under the judged answers (e.g. Muse Wonder's sentence, shown only after the run). */
  footnote?: ReactNode;
  /** U3 item 7: called when a replay reaches its end state (the page then offers "Play the run again"). */
  onPlayed?: () => void;
  /** D66: the count this round moved, for the person who bet. */
  loop?: CountChange | null;
  /** U3 item 5: words ABOVE the judged answers (a "Test this claim" round's sentence beside the facts). */
  headnote?: ReactNode;
}

/** U2: a round number of ms at or above `ms`, for a dial rescaled to a run that went past the test's own dial. */
export function roundUp(ms: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, ms)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= ms) return m * p;
  return 10 * p;
}

function machineRing(after: After, language: "js" | "ts" | "py", tested: string | null, parts: MachineParts): MachineRing | null {
  const moment = momentOf(after.marks, after.run, language);
  if (!moment) return null;
  return ringFor({ kind: moment.kind, you: moment.you, outcome: (after.run.result.measured as { outcome?: unknown }).outcome, steps: after.helpers && "steps" in after.helpers ? after.helpers.steps : [], parts, tested });
}

export function BenchStage({ seenBefore = false, codeRan = false, loop = null, model, theme, after = null, onPart, onTestFunction, title, source, language, outline, fileName, children, extraMarks = [], side = false, footnote = null, onPlayed, headnote = null }: BenchStageProps) {
  const [wantMachine, setWantMachine] = useState(machineFirst);
  const playedRef = useRef(onPlayed);
  playedRef.current = onPlayed;
  const dark = useDarkScheme();
  const still = useReducedMotion();
  const shown = theme ?? (dark ? "dark" : "light");
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [marksOn, setMarksOn] = useState(false);
  const [focusMark, setFocusMark] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [panHint, setPanHint] = useState(false);
  const [playing, setPlaying] = useState(false);

  // ---- the chart: drawn from the bench model, with no run in it ----
  const labelsKey = JSON.stringify(extraMarks);
  const chart = useMemo(() => {
    const spec = benchSpec(model, { fileName, outline, source, language, labels: extraMarks, seed: `chart:${fileName}` });
    return { ...spec, title: undefined, kicker: undefined, subtitle: undefined } as typeof spec; // the page's own header says these
  }, [model, fileName, outline, source, language, labelsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartMount = useRef<Mounted | null>(null);
  const known = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  const onChart = (m: Mounted | null, narrow: boolean) => {
    chartMount.current = m;
    const p = m?.player;
    if (m) setPanHint(narrow && m.needsPan());
    if (!p) return;
    // The first time the chart draws itself on. When a test adds devices, only what is new is drawn; the rest is already there.
    const nodes = new Set(chart.nodes.map((n) => n.id));
    const edges = new Set(chart.edges.map((e) => e.id));
    const was = known.current;
    known.current = { nodes, edges };
    p.showAll();
    if (after) return;
    if (!was) void p.entrance();
    else {
      const newNodes = new Set([...nodes].filter((n) => !was.nodes.has(n)));
      const newEdges = new Set([...edges].filter((e) => !was.edges.has(e)));
      if (newNodes.size || newEdges.size) void p.entrance({ nodes: newNodes, edges: newEdges });
    }
  };

  // ---- the path: only from `after` ----
  const pathSpec = useMemo(() => {
    if (!after) return null;
    // D60: one ring or one tick on the drawing, for the question that leads the moment. The list beside it holds every other answer.
    const lead = momentOf(after.marks, after.run, language)?.measures ?? null;
    const spec = whatHappened({ run: after.run, experiment: after.experiment, bets: after.bets.filter((b) => b.who === "human" && b.measures === lead), verdicts: [...after.verdicts], origin: "this-run", ...(after.helpers ? { helpers: after.helpers } : {}), seed: `path:${after.run.id}` });
    return { ...spec, title: undefined, kicker: undefined, subtitle: undefined } as typeof spec;
  }, [after?.run, after?.experiment, after?.bets, after?.verdicts, after?.helpers, after?.marks]); // eslint-disable-line react-hooks/exhaustive-deps
  // D65: the machine, drawn by plain code from the same model as the chart. It holds its ring from the start, hidden until the run lands it.
  const machineRef = useRef<MachineControl | null>(null);
  const parts = useMemo(() => machineParts(model, outline, source, language), [model, outline, source, language]);
  const ring = useMemo(() => (after ? machineRing(after, language, model.tested, parts) : null), [after?.run, after?.marks, after?.helpers, model.tested, parts]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => {
    const d = drawMachine(parts, { seed: `machine:${outline.parts.map((p) => p.name).join(",")}`, ring });
    // The check runs on every drawing: a picture that fails it is not shown.
    return d.problems.length > 0 ? { ...d, tooMany: `The machine could not be drawn clearly (${d.problems[0]}), so here is the box chart.` } : d;
  }, [parts, ring, outline]);
  const noRunToShow = Boolean(after && (after.script.notShown !== null || pathSpec?.notShown !== undefined));
  const showMachine = wantMachine && !drawn.tooMany && !noRunToShow && model.notShown === null;
  const beats = useMemo(() => (pathSpec ? machineScript(pathSpec, parts, outline, model.tested) : []), [pathSpec, parts, outline, model.tested]);
  useEffect(() => {
    const onM = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      setWantMachine((w) => {
        rememberView(w ? "chart" : "machine");
        return !w;
      });
    };
    window.addEventListener("keydown", onM);
    return () => window.removeEventListener("keydown", onM);
  }, []);
  /** undefined: not drawn yet. null: refused. A mount with no player: the plain list. The last two have nothing to play. */
  const [pathMount, setPathMount] = useState<Mounted | null | undefined>(undefined);
  /** Ends the pause while the chart moves aside, so a click during it counts. */
  const endPause = useRef<(() => void) | null>(null);
  const skipAsked = useRef(false);

  // The run, played as a story. Without `after`: nothing plays.
  useEffect(() => {
    setMarksOn(false);
    setStep(null);
    if (!after) return;
    const end = () => {
      setPlaying(false);
      setStep(null);
      setMarksOn(true);
      playedRef.current?.();
    };
    const p = pathMount?.player;
    if (pathSpec && after.script.notShown === null && pathSpec.notShown === undefined && pathMount !== undefined && !p) {
      // R3 review B4: too long to draw, or refused. There is no story to play, and the verdict always appears.
      end();
      return;
    }
    if (!pathSpec || after.script.notShown !== null || pathSpec.notShown !== undefined) {
      if (pathSpec?.notShown !== undefined || after.script.notShown !== null) end();
      return;
    }
    if (!p) return; // the path's drawing arrives on the next render
    let live = true;
    const chartPlayer = chartMount.current?.player ?? null;
    const lit = (s: SpecStep) => {
      setStep(s.words ?? null);
      if (s.device === "clock") void chartPlayer?.sweep(CLOCK_ID, s.ms);
      else if (s.device) void chartPlayer?.flash(deviceId(s.device), 620);
    };
    void (async () => {
      skipAsked.current = false;
      setPlaying(true);
      p.rewind();
      machineRef.current?.rewind();
      machineRef.current?.setScript(beats);
      // D60: about 5 s to the ring, whatever the path's length, up to about 6 s. The final ring keeps its pace: it is the payoff.
      p.setRunPace(Math.max(0.12, Math.min(0.85, 4400 / Math.max(1, pathSpec.steps.length * 1000))));
      // The chart moves aside first, so the whole story is seen.
      if (!still && !p.reduced) {
        await new Promise<void>((r) => {
          const t = setTimeout(r, 420);
          endPause.current = () => {
            clearTimeout(t);
            r();
          };
        });
        endPause.current = null;
      }
      for (let i = 0; i < pathSpec.steps.length && live; i++) {
        lit(pathSpec.steps[i]!);
        machineRef.current?.play(i, Math.max(120, Math.min(800, 4400 / pathSpec.steps.length)));
        // The thread takes the centre and the view follows its head.
        pathMount?.bringIntoView(pathSpec.steps[i]!.nodes[0] ?? "", !skipAsked.current);
        const played = p.playStep(i);
        // A key pressed in the pause before the first step still skips: nothing was animating yet to cut short.
        if (skipAsked.current) p.skip();
        await played;
      }
      if (!live) return;
      setStep(null);
      setMarksOn(true);
      machineRef.current?.land();
      p.setRunPace(1);
      // The run's end card, or the card with the ring, is on screen when it finishes.
      pathMount?.bringIntoView(pathSpec.marks[0]?.on ?? pathSpec.nodes[pathSpec.nodes.length - 1]?.id ?? "");
      for (const m of pathSpec.marks) if (live) await p.landMark(m);
      if (!live) return;
      p.showCaptions();
      end();
    })();
    return () => {
      live = false;
      p.skip();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after?.token, pathMount, pathSpec, still]);

  const skip = () => {
    skipAsked.current = true;
    endPause.current?.();
    pathMount?.player?.skip();
    chartMount.current?.player?.skip();
    machineRef.current?.skip();
  };
  // D60: any key skips while the run plays (a key with a modifier is the browser's).
  useEffect(() => {
    if (!playing) return;
    const onAny = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Shift" || e.key === "Tab" || document.querySelector<HTMLElement>(".u1-fill")?.hidden === true) return;
      // A skip key only skips: it never goes on to do anything else.
      e.stopImmediatePropagation();
      e.preventDefault();
      skip();
    };
    window.addEventListener("keydown", onAny, true);
    return () => window.removeEventListener("keydown", onAny, true);
  });
  const onRootPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest?.("button, a, input, select, summary, textarea, .u1-card")) return;
    if (playing) skip();
  };

  // ---- a part's card ----
  const nodeAt = (e: { target: EventTarget }) => {
    const el = (e.target as Element).closest?.("[data-node]");
    return el ? idFromAttr(el.getAttribute("data-node")!) : null;
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => setHover(after ? null : nodeAt(e));
  const order = model.boxes.map((b) => b.id);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " && playing) {
      e.preventDefault();
      skip();
    }
    if (after) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const i = pinned ? order.indexOf(pinned) : -1;
      const n = order.length;
      setPinned(order[i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n]!);
    }
  };
  // A pinned card belongs to looking at the drawing. It closes when the bet opens or a run starts, and Escape closes it first.
  const hasRun = after !== null;
  useEffect(() => setPinned(null), [side, hasRun]);
  useEffect(() => {
    if (!pinned) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".u1-proof")) return;
      // First in line and marked as used: this key has closed the top-most thing, so nothing below closes too.
      e.preventDefault();
      setPinned(null);
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [pinned]);
  const cardId = pinned ?? hover;
  const stage = !after ? "structure" : marksOn ? "verdict" : "run";
  const readout = after && marksOn ? marksReadout(after.marks) : model.tested ? `testing ${model.tested}` : `${model.boxes.length} ${model.boxes.length === 1 ? "part" : "parts"} · ${model.lines.length} ${model.lines.length === 1 ? "join" : "joins"}`;

  return (
    <div className={`rr-host u1-root${marksOn ? " u1-marked" : ""}`} data-view={showMachine ? "machine" : "chart"} data-theme={shown} data-stage={stage} data-phase={!after ? "rest" : marksOn ? "marked" : "playing"} data-pop={side && !after ? "" : undefined} data-testid="bench-stage" onPointerUp={onRootPointerUp} onKeyDown={onKey} tabIndex={-1}>
      <header className="r-head">
        <p className="r-kick">{title}</p>
        <h1 className="r-name">{model.tested ?? fileName}</h1>
        <p className="r-sub" data-testid="r-sub">
          {after ? (marksOn ? "" : STAGE_WORDS.playing) : seenBefore ? "this code and test have already run here" : codeRan ? (model.parts[CLOCK_ID] ? "this code has run here; this test has not" : "what calls what. This code has already run here.") : model.parts[CLOCK_ID] ? "the code, and what Atlas will plug in. Nothing has run." : "what calls what, before anything has run"}
        </p>
      </header>
      <p id="bench-described" className="rr-unseen" data-testid="bench-described">{model.plainLabel}</p>
      <div className="r-viewport r-chart" role="group" aria-describedby="bench-described" aria-label="The drawing of your code. Tab to a part; Enter picks it; arrows walk its joins; plus and minus zoom." onPointerMove={onMove} onPointerLeave={() => setHover(null)} data-testid="bench-viewport">
        {model.notShown !== null ? (
          <p className="u1-notice" role="note" data-testid="bench-not-drawn">
            {model.notShown}
          </p>
        ) : (
          <Drawing spec={chart} theme={shown} className="u1-svg r-sheet" maxScale={1.2} minScale={0.3} hover={!after} onMount={onChart} onSelect={(id) => {
              setPinned((p) => (p === id ? null : id));
              onPart?.(id);
            }} />
        )}
      </div>
      {showMachine && (
        <div className="r-machine" data-testid="machine-region" data-captions={after && marksOn && pathSpec?.captions.length ? "" : undefined}>
          <MachineSheet ref={machineRef} drawn={drawn} reduced={still} penKey={after ? null : source} onPart={(id) => model.parts[id]?.kind === "code" && document.querySelector(".c-drawer") && onPart?.(id)} />
          {after && marksOn && pathSpec?.captions.length ? (
            <p className="m-captions" data-testid="machine-captions">
              {pathSpec.captions.map((c) => (
                <span key={c.words}>{c.words}</span>
              ))}
            </p>
          ) : null}
        </div>
      )}
      {wantMachine && drawn.tooMany && !noRunToShow && <p className="r-view-note" role="note" data-testid="machine-too-many">{drawn.tooMany}</p>}
      {!drawn.tooMany && !noRunToShow && model.notShown === null && typeof window !== "undefined" && window.innerWidth >= 760 && (
        <button type="button" className="r-view-toggle" onClick={() => setWantMachine((w) => { rememberView(w ? "chart" : "machine"); return !w; })} data-testid="view-toggle">
          {showMachine ? "Box chart" : "Machine"}
          <kbd className="k">M</kbd>
        </button>
      )}
      {pathSpec && (
        <div className="r-viewport r-path" data-testid="bench-path">
          <Drawing spec={pathSpec} theme={shown} className="r-sheet" maxScale={1.08} minScale={typeof window !== "undefined" && window.innerWidth <= 760 ? 0.66 : 0.5} hover={false} onPending={() => setPathMount(undefined)} onMount={(m) => setPathMount(m)} />
        </div>
      )}
      <p className="r-step" role="status" aria-live="polite" data-testid="run-step">
        {step ?? ""}
      </p>
      {after && !marksOn && <p className="r-skip" data-testid="r-skip">any key skips</p>}
      {panHint && !after && (
        <p className="r-pan-hint" data-testid="r-pan-hint">
          drag to move, pinch to zoom
        </p>
      )}
      {!after && cardId && model.parts[cardId] && <PartCard id={cardId} part={model.parts[cardId]!} tested={model.tested} hasTest={Boolean(model.parts[CLOCK_ID])} python={language === "py"} pinned={pinned === cardId} {...(onTestFunction ? { onTest: onTestFunction } : {})} canChange={!after} onClose={() => setPinned(null)} />}
      {after && marksOn && <MarkList marks={after.marks} focus={focusMark} onFocus={setFocusMark} footnote={footnote} headnote={headnote} moment={momentOf(after.marks, after.run, language)} readout={marksReadout(after.marks)} loop={loop} />}
      {children}
    </div>
  );
}

function marksReadout(marks: readonly Mark[]): string {
  const you = marks.map((m) => m.picks.find((p) => p.who === "human")?.outcome ?? "cant_check");
  const n = (o: string) => you.filter((x) => x === o).length;
  return `you: ${n("matched")} matched · ${n("not_matched")} didn't match · ${n("cant_check")} can't check`;
}

/**
 * U2: three shapes, never a spinner, always beside the words: matched = a filled disc with a tick; didn't match = an
 * open circle with a cross; can't check = a dashed square with a question mark.
 */
export function Glyph({ outcome }: { outcome: Mark["picks"][number]["outcome"] }) {
  return (
    <svg className="u1-glyph" data-outcome={outcome} viewBox="0 0 14 14" aria-hidden="true">
      {outcome === "matched" ? (
        <>
          <circle cx="7" cy="7" r="5.6" />
          <path d="M4.3 7.2l1.9 1.9 3.6-4" />
        </>
      ) : outcome === "not_matched" ? (
        <>
          <circle cx="7" cy="7" r="5.6" />
          <path d="M4.9 4.9l4.2 4.2M9.1 4.9l-4.2 4.2" />
        </>
      ) : (
        <>
          <rect x="1.6" y="1.6" width="10.8" height="10.8" rx="1.5" strokeDasharray="2 1.6" />
          <text x="7" y="10" textAnchor="middle">?</text>
        </>
      )}
    </svg>
  );
}

/** U2: the results' headline, counted by plain code from the marks: each bettor's matched of checkable answers. */
export function headlineOf(marks: readonly Mark[]): string {
  const by = new Map<string, { name: string; matched: number; checkable: number; cantTell: number; total: number }>();
  for (const m of marks)
    for (const p of m.picks) {
      const e = by.get(p.who) ?? { name: shortName(p.name), matched: 0, checkable: 0, cantTell: 0, total: 0 };
      e.total++;
      if (p.pick === CANT_TELL) e.cantTell++;
      if (p.outcome !== "cant_check") e.checkable++;
      if (p.outcome === "matched") e.matched++;
      by.set(p.who, e);
    }
  const you = by.get("human") ?? { name: "You", matched: 0, checkable: 0, cantTell: 0, total: 0 };
  // Muse Spark first, then Muse Spark Open (the open-weights model), then any other, as the pop-up introduced them.
  const rank = (w: string) => (/open/i.test(w) ? 1 : /spark/i.test(w) ? 0 : 2);
  const others = [...by.entries()].filter(([w]) => w !== "human").sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1)).map(([, e]) => e);
  return RESULT_WORDS.headline(you, others);
}

/** U2: when every mark is can't check for the same reason, that reason (said once, not on every question). */
export function sharedReason(marks: readonly Mark[]): string | null {
  if (marks.length < 2) return null;
  const all = marks.map((m) => m.measured);
  if (!all.every((x) => x.startsWith("can't check: ") && x === all[0])) return null;
  return all[0]!.slice("can't check: ".length);
}

/** D60: your bet and what the run did. The run's fact is the largest words on the screen. */
export function MomentView({ moment, stranger = false }: { moment: Moment; /** Whoever is looking did not place this bet. */ stranger?: boolean }) {
  return (
    <section className="m-moment" data-kind={moment.kind} aria-label="What you bet and what the run did" data-testid="moment">
      {moment.you !== null && (
        <p className="m-you">
          <span className="m-k">{stranger ? "The bet" : "You bet"}</span>
          <span className="m-you-v" data-testid="moment-you">{moment.you}</span>
        </p>
      )}
      <p className="m-run">
        <span className="m-k">The run</span>
        <span className="m-run-v" data-testid="moment-run">{moment.run}</span>
      </p>
      {moment.bettors.length > 0 && (
        <>
        <p className="m-covers" data-testid="moment-covers">{`On this question: ${moment.question ?? ""}`}</p>
        <ul className="m-bettors" aria-label={moment.question ?? "the bets"} data-testid="moment-bettors">
          {moment.bettors.map((b) => (
            <li key={b.who}>
              <Glyph outcome={b.outcome} />
              <span className="m-who" title={b.name}>{shortName(b.name)}</span>
              <span className="m-pick">{b.pick}</span>
              <span className="m-out">{OUTCOME_WORDS[b.outcome]}</span>
            </li>
          ))}
        </ul>
        </>
      )}
    </section>
  );
}

function MarkRow({ m, same, focus, onFocus, hidden = false }: { m: Mark; same: string | null; focus: string | null; onFocus: (m: string | null) => void; hidden?: boolean }) {
  return (
    <li hidden={hidden} data-focus={focus === m.measures ? "" : undefined} data-testid={`mark-${m.measures}`}>
      <button type="button" className="u1-mark-head" onClick={() => onFocus(focus === m.measures ? null : m.measures)} aria-expanded={focus === m.measures}>
        {m.question}
      </button>
      <p className="u1-measured">
        <span className="u1-k">The run:</span> {same ? RESULT_WORDS.seeAbove : m.measured}
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
            {p.outcome === "cant_check" && p.reason && !same && p.reason !== m.measured.replace(/^can't check: /, "") && focus === m.measures && <span className="u1-why">{p.reason}</span>}
          </li>
        ))}
      </ul>
    </li>
  );
}

function MarkList({ marks, focus, onFocus, footnote, headnote, moment, readout, loop }: { marks: readonly Mark[]; focus: string | null; onFocus: (m: string | null) => void; footnote: ReactNode; headnote: ReactNode; moment: Moment | null; readout: string; loop: CountChange | null }) {
  const same = sharedReason(marks);
  // Questions nobody could check fold to one line with their reason: a real result must not read as a shrug.
  const checkable = marks.filter((m) => !m.picks.every((p) => p.outcome === "cant_check"));
  const unchecked = marks.filter((m) => m.picks.every((p) => p.outcome === "cant_check"));
  const rest = checkable.filter((m) => m.measures !== moment?.measures);
  const uncheckedWhy = unchecked[0]?.measured.replace(/^can't check: /, "") ?? "";
  return (
    <section className="u1-marks" aria-label="How each answer was judged" data-testid="mark-list">
      <div className="m-top">
        {moment && <MomentView moment={moment} />}
        <p className="m-count" data-testid="m-count">{readout}</p>
        {loop && (
          <p className="m-loop" data-testid="m-loop">
            {`${loop.words}: `}
            <span className="m-loop-from">{loop.from}</span>
            <span className="m-loop-arrow" aria-label="now"> → </span>
            <span className="m-loop-to">{loop.to}</span>
          </p>
        )}
      </div>
      <div className="m-pane" data-testid="m-pane">
        {/* The plain counts stay for a screen reader; the moment is what the eye reads. */}
        <p className="rr-unseen" data-testid="u1-headline">
          {headlineOf(marks)}
        </p>
        {headnote}
        {same && (
          <p className="u1-samewhy" data-testid="u1-same-reason">
            {RESULT_WORDS.sameReason(same)}
          </p>
        )}
        <details className="m-fold m-others" data-testid="m-others" open={rest.length === 1} hidden={rest.length === 0}>
          <summary>{`Judged by plain code: ${rest.length} more ${rest.length === 1 ? "answer" : "answers"}`}</summary>
          <ul>
            {checkable.map((m) => (
              // The question that leads is already at the top, whole.
              <MarkRow key={m.measures} m={m} same={same} focus={focus} onFocus={onFocus} hidden={m.measures === moment?.measures} />
            ))}
          </ul>
        </details>
        {unchecked.length > 0 && (
          <details className="m-fold" data-testid="m-cant-fold">
            <summary>{`${unchecked.length} can't check${uncheckedWhy && !same ? `: ${uncheckedWhy}` : ""}`}</summary>
            <ul>
              {unchecked.map((m) => (
                <MarkRow key={m.measures} m={m} same={same} focus={focus} onFocus={onFocus} />
              ))}
            </ul>
          </details>
        )}
        {footnote}
      </div>
    </section>
  );
}

/** "Muse Spark 1.3 (muse-spark-1.3)" → "Muse Spark 1.3"; the full name stays in the title (D10: Meta's names stay visible). */
const shortName = (name: string) => name.replace(/\s*\(.*$/, "");

function PartCard({ id, part, tested, hasTest, python, pinned, onTest, onClose, canChange }: { id: string; part: BenchPart; tested: string | null; hasTest: boolean; python: boolean; pinned: boolean; onTest?: (name: string) => void; onClose: () => void; canChange: boolean }) {
  return (
    <aside className="u1-card" data-pinned={pinned ? "" : undefined} aria-live="polite" data-testid="part-card">
      {part.kind === "code" ? (
        <>
          <h3>{part.part.name}</h3>
          <p className="u1-sub">{`${part.part.kind === "class" ? "class" : "function"} · ${lineSpan(part.part.lineStart, part.part.lineEnd)}${part.part.exported ? (python ? " · top-level (Atlas can call it)" : " · exported (Atlas can call it)") : ""}`}</p>
          {part.part.signature && <code className="u1-sig">{part.part.signature}</code>}
          <p>{part.callsTo.length ? `Calls ${part.callsTo.join(", ")}.` : "Calls no other part of this file."} {part.calledBy.length ? `Called by ${part.calledBy.join(", ")}.` : ""}</p>
          {part.selfCalls?.length ? <p data-testid="card-self">{STAGE_WORDS.selfCalls(part.selfCalls)}</p> : null}
          {part.devices?.map((d) => (
            <p key={d.name} data-testid={`card-calls-${d.name}`}>
              {STAGE_WORDS.callsDevice(d.name, d.network, d.lines)}
            </p>
          ))}
          {part.wrappedBy?.length ? <p>{STAGE_WORDS.wrappedBy(part.wrappedBy)}</p> : null}
          {part.wraps?.length ? <p>{STAGE_WORDS.wraps(part.wraps)}</p> : null}
          {tested === id ? <p className="u1-sub">{hasTest ? STAGE_WORDS.testCalls : STAGE_WORDS.willTest}</p> : part.part.exported && part.part.kind === "function" && onTest && canChange ? (
            <button type="button" className="u1-btn" onClick={() => onTest(id)} data-testid={`test-fn-${id}`}>
              Test this function
            </button>
          ) : !part.part.exported && part.part.kind === "function" ? (
            <p className="u1-sub" data-testid="card-not-callable">
              {STAGE_WORDS.notCallable(id, part.calledBy, python)}
            </p>
          ) : null}
        </>
      ) : part.kind === "device" ? (
        <>
          <h3>{part.network ? `Fake network: ${part.name}` : `Stand-in: ${part.name}`}</h3>
          <p className="u1-sub">{part.network ? STAGE_WORDS.fakeNetwork(part.name) : `A fake function Atlas passes in${part.async ? " (async)" : ""}. Scripted by the test:`}</p>
          <ol className="u1-steps">
            {part.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="u1-sub">{`After that, ${part.then}.`}</p>
          {part.calledBy?.length ? <p data-testid="card-called-by">{STAGE_WORDS.deviceCalledBy(part.calledBy)}</p> : part.noCable ? <p data-testid="card-no-cable">{part.noCable}</p> : null}
        </>
      ) : (
        <>
          <h3>Atlas's clock</h3>
          <p className="u1-sub">{`Atlas's clock is simulated: waits cost no real time. ${part.marks.length ? ` Its longer ticks mark ${part.marks.map((m) => `${m.toLocaleString("en-US")} ms`).join(" and ")}, from the test's own scripted waits.` : ""}`}</p>
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
