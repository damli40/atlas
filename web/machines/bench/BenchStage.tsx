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
import { whatHappened } from "../../../renderer/authors/what-happened";
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
}

export interface BenchStageProps {
  model: BenchModel;
  theme?: "light" | "dark";
  after?: After | null;
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
  /** U3 item 5: words ABOVE the judged answers (a "Test this claim" round's sentence beside the facts). */
  headnote?: ReactNode;
}

/** U2: a round number of ms at or above `ms`, for a dial rescaled to a run that went past the test's own dial. */
export function roundUp(ms: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, ms)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= ms) return m * p;
  return 10 * p;
}

export function BenchStage({ model, theme, after = null, onTestFunction, title, source, language, outline, fileName, children, extraMarks = [], side = false, footnote = null, onPlayed, headnote = null }: BenchStageProps) {
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
    const spec = whatHappened({ run: after.run, experiment: after.experiment, bets: after.bets.filter((b) => b.who === "human"), verdicts: [...after.verdicts], origin: "this-run", seed: `path:${after.run.id}` });
    return { ...spec, title: undefined, kicker: undefined, subtitle: undefined } as typeof spec;
  }, [after?.run, after?.experiment, after?.bets, after?.verdicts]); // eslint-disable-line react-hooks/exhaustive-deps
  /** undefined: not drawn yet. null: refused. A mount with no player: the plain list. The last two have nothing to play. */
  const [pathMount, setPathMount] = useState<Mounted | null | undefined>(undefined);
  /** Ends the pause while the chart moves aside, so a click during it counts. */
  const endPause = useRef<(() => void) | null>(null);

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
      setPlaying(true);
      p.rewind();
      // The chart moves aside first, so the whole story is seen.
      if (!still && !p.reduced) {
        await new Promise<void>((r) => {
          const t = setTimeout(r, 800);
          endPause.current = () => {
            clearTimeout(t);
            r();
          };
        });
        endPause.current = null;
      }
      for (let i = 0; i < pathSpec.steps.length && live; i++) {
        lit(pathSpec.steps[i]!);
        await p.playStep(i);
      }
      if (!live) return;
      setStep(null);
      setMarksOn(true);
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
    endPause.current?.();
    pathMount?.player?.skip();
    chartMount.current?.player?.skip();
  };
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
    if (e.key === "Escape") setPinned(null);
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
  const cardId = pinned ?? hover;
  const stage = !after ? "structure" : marksOn ? "verdict" : "run";
  const readout = after && marksOn ? marksReadout(after.marks) : model.tested ? `testing ${model.tested}` : `${model.boxes.length} ${model.boxes.length === 1 ? "part" : "parts"} · ${model.lines.length} ${model.lines.length === 1 ? "join" : "joins"}`;

  return (
    <div className={`rr-host u1-root${marksOn ? " u1-marked" : ""}`} data-theme={shown} data-stage={stage} data-phase={!after ? "rest" : marksOn ? "marked" : "playing"} data-pop={side && !after ? "" : undefined} data-testid="bench-stage" onPointerUp={onRootPointerUp} onKeyDown={onKey} tabIndex={-1}>
      <header className="r-head">
        <p className="r-kick">{title}</p>
        <h1 className="r-name">{model.tested ?? fileName}</h1>
        <p className="r-sub" data-testid="r-sub">
          {after ? (marksOn ? readout : STAGE_WORDS.playing) : model.parts[CLOCK_ID] ? "the code, and what Atlas will plug in. Nothing has run." : "what calls what, before anything has run"}
        </p>
      </header>
      <p id="bench-described" className="rr-unseen" data-testid="bench-described">{model.plainLabel}</p>
      <div className="r-viewport r-chart" role="group" aria-describedby="bench-described" aria-label="The drawing of your code. Tab to a part; Enter picks it; arrows walk its joins; plus and minus zoom." onPointerMove={onMove} onPointerLeave={() => setHover(null)} data-testid="bench-viewport">
        {model.notShown !== null ? (
          <p className="u1-notice" role="note" data-testid="bench-not-drawn">
            {model.notShown}
          </p>
        ) : (
          <Drawing spec={chart} theme={shown} className="u1-svg r-sheet" maxScale={1.2} hover={!after} onMount={onChart} onSelect={(id) => setPinned((p) => (p === id ? null : id))} />
        )}
      </div>
      {pathSpec && (
        <div className="r-viewport r-path" data-testid="bench-path">
          <Drawing spec={pathSpec} theme={shown} className="r-sheet" maxScale={1.08} minScale={0.66} hover={false} onPending={() => setPathMount(undefined)} onMount={(m) => setPathMount(m)} />
        </div>
      )}
      <p className="r-step" role="status" aria-live="polite" data-testid="run-step">
        {step ?? ""}
      </p>
      {panHint && !after && (
        <p className="r-pan-hint" data-testid="r-pan-hint">
          drag to move, pinch to zoom
        </p>
      )}
      {cardId && model.parts[cardId] && <PartCard id={cardId} part={model.parts[cardId]!} tested={model.tested} hasTest={Boolean(model.parts[CLOCK_ID])} python={language === "py"} pinned={pinned === cardId} {...(onTestFunction ? { onTest: onTestFunction } : {})} canChange={!after} onClose={() => setPinned(null)} />}
      {after && marksOn && <MarkList marks={after.marks} focus={focusMark} onFocus={setFocusMark} footnote={footnote} headnote={headnote} />}
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

function MarkList({ marks, focus, onFocus, footnote, headnote }: { marks: readonly Mark[]; focus: string | null; onFocus: (m: string | null) => void; footnote: ReactNode; headnote: ReactNode }) {
  const same = sharedReason(marks);
  return (
    <section className="u1-marks" aria-label="How each answer was judged" data-testid="mark-list">
      <p className="u1-headline" data-testid="u1-headline">
        {headlineOf(marks)}
      </p>
      {headnote}
      {same && (
        <p className="u1-samewhy" data-testid="u1-same-reason">
          {RESULT_WORDS.sameReason(same)}
        </p>
      )}
      <h2>Judged by plain code</h2>
      <ul>
        {marks.map((m) => (
          <li key={m.measures} data-focus={focus === m.measures ? "" : undefined} data-testid={`mark-${m.measures}`}>
            <button type="button" className="u1-mark-head" onClick={() => onFocus(focus === m.measures ? null : m.measures)} aria-expanded={focus === m.measures}>
              {`${marks.indexOf(m) + 1}. ${m.question}`}
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
        ))}
      </ul>
      {footnote}
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
