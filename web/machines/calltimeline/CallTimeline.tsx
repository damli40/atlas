// The call timeline (E3): a generic machine for any pasted function, drawn ONLY from one run (its trace and its
// measured fields). A timing bench: the ruler is Atlas's virtual clock; the front rail is the function's own lane
// with its end token; one rail behind per stand-in, a peg per call. A cursor sled runs along the ruler and each
// part appears when the sled passes its moment. Under reduced motion (or with no animation support) the end state
// is painted at once. Space or Enter replays.
//
// Trust: the model (model.ts) is empty when src/trust.ts says the run may not be shown as fact (the known-case
// check did not match, the whole run is "can't check", or the sandbox did not finish). The card then prints that
// reason and draws nothing.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Run } from "../../../src/types";
import { Dots, Line, Plate, Solid } from "../iso/react/draw";
import { useLoop, useReadout } from "../iso/react/live";
import { stillNow, useVisible } from "../env";
import { WIDTH, timelineGeometry, type PartName, type PegPart, type TimelineGeometry } from "./geometry";
import { timelineModel, type TimelineModel } from "./model";

const DARK = "(prefers-color-scheme: dark)";
/** The page's colour scheme, as the retry machine reads it (no window: light). */
function useDark(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const q = window.matchMedia(DARK);
      q.addEventListener("change", changed);
      return () => q.removeEventListener("change", changed);
    },
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK).matches,
    () => false,
  );
}

const Part = ({ name, children, ...rest }: { name: PartName; children: React.ReactNode } & Record<string, unknown>) => (
  <g data-part={name} {...rest}>
    {children}
  </g>
);

const LABEL =
  "A timing bench drawn from the run's trace: the ruler is Atlas's virtual clock, the front rail is the called function with its end token, and each rail behind is a stand-in with one peg per call, its cap marked by how the call answered.";

/** Story seconds the sled takes to cross the ruler (only how long the page takes to show it; not run time). */
const STORY_S = 3.2;

function Peg({ p, shown }: { p: PegPart; shown: boolean }) {
  return (
    <g className="ct-peg" data-t={p.t} data-mark={p.mark} style={shown ? undefined : { display: "none" }}>
      <Part name="peg" data-n={p.n} data-lane={p.lane}>
        <path className="iso-halo ct-halo" d={p.foot.fill} />
        <Solid paths={p.foot} tone="mid" />
        <Solid paths={p.body} tone={p.mark === "never_answered" || p.mark === "no_answer_seen" ? "lo" : "hi"} crease="lo" />
        <Solid paths={p.cap} tone={p.mark === "never_answered" || p.mark === "no_answer_seen" ? "lo" : "hi"} crease="lo" />
        <Line d={p.capRing} tone="lo" />
        {p.dot ? <Dots points={[p.dot]} size={1} tone="hi" /> : null}
        {p.slash ? <Line d={p.slash} tone="hi" /> : null}
      </Part>
    </g>
  );
}

function Bar({ p, shown }: { p: PegPart; shown: boolean }) {
  if (!p.bar) return null;
  return (
    <g className="ct-bar" data-t={p.bar.t} style={shown ? undefined : { display: "none" }}>
      <Part name="answer-bar">
        <Solid paths={p.bar.paths} tone="hi" crease="none" />
        <Solid paths={p.bar.stud} tone="hi" />
      </Part>
    </g>
  );
}

/** Paints the moment `t` (virtual ms) on the drawn nodes, without a React render per frame. */
function paint(root: Element, g: TimelineGeometry, t: number) {
  root.querySelectorAll<SVGGElement>(".ct-peg, .ct-bar, .ct-end").forEach((n) => {
    n.style.display = Number(n.dataset.t) <= t + 1e-9 ? "" : "none";
  });
  root.querySelector(".ct-sled")?.setAttribute("transform", g.sledAt(t));
}

export interface CallTimelineProps {
  run: Run;
  /** Force the end state (evidence pages). Defaults to the reader's reduced-motion setting. */
  still?: boolean;
  /** Force a theme (evidence pages). Defaults to the page's own. */
  theme?: "light" | "dark";
  /** Paint this virtual moment (ms) and hold it: evidence pages only. */
  at?: number;
}

export function CallTimeline({ run, still, theme, at }: CallTimelineProps) {
  const model: TimelineModel = useMemo(() => timelineModel(run), [run]);
  const dark = useDark();
  const themeAttr = (theme ?? (dark ? "dark" : "light")) === "light" ? "light" : undefined;
  if (model.notShown !== null) {
    return (
      <div className="iso ct" data-theme={themeAttr} data-testid="call-timeline">
        <div className="card notice" role="note" data-testid="call-timeline-cant-check">
          <p className="label">Fig 2 · The call timeline · can't check</p>
          <p>{model.notShown}</p>
          <p className="muted small">Run {run.id}. Nothing from this run is drawn, and every verdict on it is "can't check".</p>
        </div>
      </div>
    );
  }
  return <Bench model={model} run={run} themeAttr={themeAttr} {...(still !== undefined ? { still } : {})} {...(at !== undefined ? { at } : {})} />;
}

function Bench({ model, run, themeAttr, still, at }: { model: TimelineModel; run: Run; themeAttr: "light" | undefined; still?: boolean; at?: number }) {
  const g = useMemo(() => timelineGeometry(model), [model]);
  const calm = still ?? stillNow();
  const span = model.span;
  const endT = model.allAtZero ? 0 : span;
  const first = at ?? (calm ? endT : 0);
  const clock = useRef({ t: first, playing: !calm && at === undefined });
  const { anchor, say } = useReadout<HTMLDivElement>();
  const host = useRef<HTMLDivElement>(null);
  const visible = useVisible(anchor);
  const draw = (t: number) => {
    const svg = host.current?.querySelector("svg");
    if (svg) paint(svg, g, t);
    say(t >= endT ? model.readout : `virtual clock ${Math.round(t).toLocaleString("en-US")} ms`);
  };
  const kick = useLoop((dt, quiet) => {
    const c = clock.current;
    if (!c.playing) return false;
    c.t = quiet ? endT : Math.min(endT, c.t + (dt / STORY_S) * Math.max(span, 1));
    draw(c.t);
    if (c.t >= endT) c.playing = false;
    return c.playing;
  }, visible && clock.current.playing);
  useEffect(() => {
    draw(clock.current.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);
  const replay = () => {
    const quiet = stillNow();
    clock.current = { t: quiet ? endT : 0, playing: !quiet };
    draw(clock.current.t);
    kick();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      replay();
    }
  };

  const notDrawn = model.traceCut ?? g.tooMany;
  if (notDrawn) {
    return (
      <div className="iso ct" data-theme={themeAttr} data-testid="call-timeline">
        <div className="card notice" role="note" data-testid="call-timeline-too-many">
          <p className="label">Fig 2 · The call timeline · not drawn</p>
          <p>{model.traceCut ? `Not drawn: ${model.traceCut}. ${model.detail} · ${model.readout}.` : `Not drawn: ${g.tooMany}, so the bench would have to squeeze parts it does not have room for. ${model.detail} · ${model.readout}.`}</p>
        </div>
      </div>
    );
  }
  const shownAt = (t: number) => t <= first + 1e-9;
  const lanes = [...g.lanes].sort((a, b) => a.key - b.key);
  const e = g.front.end;
  return (
    <div className="iso ct" data-theme={themeAttr} data-testid="call-timeline">
      <Plate
        fig="Fig 2"
        title="The call timeline"
        hint="Space replays"
        readout={first >= endT ? model.readout : "virtual clock 0 ms"}
        keys={[
          { mark: "raised", label: "A peg: one call to a stand-in, at the moment it was made. Dot on the cap: it returned. Slash: it threw. A dark peg with no mark: it never answered" },
          { mark: "flat", label: "A rib along a rail: a call that answered later, from its call to its answer" },
          { mark: "lit", label: "The sled on the ruler: the virtual clock. The block on the front rail: how the function ended (dot returned, slash threw, ring never settled, two bars still running at the stop)" },
        ]}
        caption={<span data-testid="call-timeline-caption">{model.caption}</span>}
      >
        <div ref={anchor} className="ct-live" tabIndex={0} role="group" aria-label={`${LABEL} Space or Enter replays the run.`} onKeyDown={onKey} data-still={calm ? "" : undefined}>
          <div ref={host}>
            <div className="iso-stage ct-stage">
              <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${g.height}`} role="img" aria-label={LABEL} focusable="false">
                <Part name="base-halo">
                  <path className="iso-halo" d={g.base.halo} />
                </Part>
                {g.base.feet.map((f, i) => (
                  <Part key={i} name="foot">
                    <Solid paths={f[0]} tone="lo" />
                    <Solid paths={f[1]} tone="mid" />
                  </Part>
                ))}
                <Part name="base-plate">
                  <Solid paths={g.base.slab} tone="mid" />
                </Part>
                <Part name="base-groove">
                  <Line d={g.base.groove} tone="lo" />
                </Part>
                <Part name="corner-screws">
                  <Dots points={g.base.screws} size={0.55} tone="mid" />
                </Part>
                {lanes.map((l) => (
                  <g key={l.name} className="ct-lane" data-lane={l.index} data-name={l.name}>
                    {l.posts.map((p, i) => (
                      <Part key={i} name="lane-post">
                        <Solid paths={p} tone="lo" />
                      </Part>
                    ))}
                    <Part name="lane-rail">
                      <Solid paths={l.rail} tone="mid" inner={<Line d={l.railSeam} tone="faint" />} />
                    </Part>
                    {l.caps.map((cp, i) => (
                      <Part key={i} name="lane-cap">
                        <Solid paths={cp} tone="lo" />
                      </Part>
                    ))}
                    {[...l.pegs].sort((a, b) => a.key - b.key).map((p) => (
                      <Bar key={`b${p.n}`} p={p} shown={!!p.bar && shownAt(p.bar.t)} />
                    ))}
                    {[...l.pegs].sort((a, b) => a.key - b.key).map((p) => (
                      <Peg key={p.n} p={p} shown={shownAt(p.t)} />
                    ))}
                  </g>
                ))}
                <g className="ct-front">
                  {g.front.posts.map((p, i) => (
                    <Part key={i} name="function-post">
                      <Solid paths={p} tone="lo" />
                    </Part>
                  ))}
                  <Part name="function-rail">
                    <Solid paths={g.front.rail} tone="mid" inner={<Line d={g.front.railSeam} tone="faint" />} />
                  </Part>
                  <Part name="start-block">
                    <Solid paths={g.front.start} tone="hi" />
                    <Dots points={[g.front.startDot]} size={0.7} tone="mid" />
                  </Part>
                  <Part name="end-stop">
                    <Solid paths={g.front.stop} tone="lo" />
                    <Dots points={[g.front.stopScrew]} size={0.5} tone="mid" />
                  </Part>
                  {e ? (
                    <g className="ct-end" data-t={e.t} data-kind={e.kind} style={shownAt(e.t) ? undefined : { display: "none" }}>
                      <Part name="end-token">
                        <path className="iso-halo ct-halo" d={e.block.fill} />
                        <Solid paths={e.block} tone={e.kind === "never_settled" || e.kind === "still_running" ? "lo" : "hi"} crease="lo" />
                        {e.dot ? <Dots points={[e.dot]} size={1.3} tone="hi" /> : null}
                        {e.slash ? <Line d={e.slash} tone="hi" /> : null}
                        {e.ring ? <Line d={e.ring} tone="hi" /> : null}
                        {e.bars ? <Line d={e.bars} tone="hi" /> : null}
                      </Part>
                    </g>
                  ) : null}
                </g>
                <Part name="ruler-strip">
                  <Solid paths={g.ruler.strip} tone="lo" crease="none" />
                </Part>
                <Part name="ruler-ticks">
                  <Line d={g.ruler.minor} tone="lo" />
                  <Line d={g.ruler.major} tone="mid" />
                  <Line d={g.ruler.zero} tone="hi" />
                </Part>
                <Part name="label-plate">
                  <Solid paths={g.base.label} tone="lo" crease="none" />
                  <Line d={g.base.labelLine} tone="faint" />
                  <Line d={g.base.labelRule} tone="lo" free />
                  <Dots points={g.base.labelScrews} size={0.45} tone="mid" />
                </Part>
                <g className="ct-sled" transform={g.sledAt(first)}>
                  <Part name="cursor-sled">
                    <Solid paths={g.sled.body} tone="mid" lit />
                    <Line d={g.sled.index} tone="lit" />
                  </Part>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </Plate>
      <p className="small ct-detail" data-testid="call-timeline-detail">
        {model.detail}
      </p>
      <p className="muted small ct-run" data-testid="call-timeline-run">
        {`Run ${run.id} · ${model.lanes.length === 1 ? "1 stand-in" : `${model.lanes.length} stand-ins`} · drawn from the trace, not from any bet or model`}
      </p>
    </div>
  );
}
