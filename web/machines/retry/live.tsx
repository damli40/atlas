"use client";
// The retry machine's live layer: places the static art in painter's order, and moves only what the
// run moves (capsules, the lever, the drum, the counters), through refs, from model.ts's poseAt().
// One loop; it stops when the story ends or the figure leaves the screen. Under reduced motion the
// first paint is the end state and nothing animates; the keys still step through the run.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoop, useReadout } from "../iso/react/live";
import { stillNow as asksForStillness, useVisible } from "../env";
import { Dots, Line, Solid } from "../iso/react/draw";
import { BASE, CHUTE, CHUTE_MAST, DRUM_BASE, HEAD, LEVER, RACK, RULER, STATION, TUBE, TUBE_MAST } from "./art";
import { CAPSULE_ART, DRUM_ART, HEIGHT, STATION_ART, WIDTH, capsuleWorld, depthKey, drumAt, ghostAt, leverAt, move } from "./geometry";
import { poseAt, retryModel, type CapsulePose, type Pose, type RetryInput, type RetryModel } from "./model";

const LABEL =
  "A pneumatic-tube bench drawn from the run's trace: a dispatch station sends one capsule up the tube for every call, the return chute drops each answer onto the rack, the retry lever is pulled once per retry and the wait drum turns once per wait.";

function Capsule({ c, model }: { c: CapsulePose; model: RetryModel }) {
  const w = capsuleWorld(c.where, c.n);
  const hidden = c.where.at === "gone";
  const opacity = c.where.at === "cradle" ? c.where.appear : 1;
  return (
    <g
      className="rm-capsule"
      data-n={c.n}
      data-shows={c.shows ?? undefined}
      data-lit={c.lit ? "" : undefined}
      transform={move(w)}
      style={{ display: hidden ? "none" : undefined, opacity: opacity < 1 ? opacity : undefined }}
      data-part="capsule"
      aria-hidden="true"
    >
      <path className="iso-halo rm-capsule-halo" d={CAPSULE_ART.foot.fill} />
      <Solid paths={CAPSULE_ART.foot} tone="mid" lit={c.lit} />
      <Solid paths={CAPSULE_ART.body} tone="hi" crease="lo" lit={c.lit} inner={<Line d={CAPSULE_ART.seam} tone="faint" />} />
      <Solid paths={CAPSULE_ART.cap} tone="hi" crease="lo" lit={c.lit} />
      <Line d={CAPSULE_ART.capRing} tone="lo" />
      <Dots points={CAPSULE_ART.latch} size={0.45} tone="mid" />
      <g className="rm-mark-threw">
        <Line d={CAPSULE_ART.threw} tone="hi" />
      </g>
      <g className="rm-mark-returned">
        <Dots points={CAPSULE_ART.returned} size={1.2} tone="hi" />
      </g>
      <title>{`call ${c.n}${model.calls[c.n - 1]?.error ? `: ${model.calls[c.n - 1]!.error}` : ""}`}</title>
    </g>
  );
}

/** Applies a pose to the drawn nodes (no React render per frame). */
function apply(root: SVGSVGElement, pose: Pose) {
  for (const c of pose.capsules) {
    const g = root.querySelector<SVGGElement>(`.rm-capsule[data-n="${c.n}"]`);
    if (!g) continue;
    const w = capsuleWorld(c.where, c.n);
    g.setAttribute("transform", move(w));
    g.style.display = c.where.at === "gone" ? "none" : "";
    g.style.opacity = c.where.at === "cradle" && c.where.appear < 1 ? String(c.where.appear) : "";
    if (c.shows) g.setAttribute("data-shows", c.shows);
    else g.removeAttribute("data-shows");
    g.toggleAttribute("data-lit", c.lit);
    g.querySelectorAll(".iso-solid").forEach((s) => s.toggleAttribute("data-lit", c.lit));
    g.dataset.key = String(depthKey(w));
  }
  // Capsules not yet sent are hidden.
  root.querySelectorAll<SVGGElement>(".rm-capsule").forEach((g) => {
    const n = Number(g.dataset.n);
    if (!pose.capsules.some((c) => c.n === n)) g.style.display = "none";
  });
  // Painter's order among capsules: far first. Re-append only when the order changed.
  const layer = root.querySelector<SVGGElement>(".rm-capsules");
  if (layer) {
    const nodes = [...layer.children] as SVGGElement[];
    const sorted = [...nodes].sort((a, b) => Number(a.dataset.key ?? 0) - Number(b.dataset.key ?? 0));
    if (sorted.some((n, i) => n !== nodes[i])) sorted.forEach((n) => layer.appendChild(n));
  }
  root.querySelector(".rm-lever")?.setAttribute("transform", leverAt(pose.lever));
  root.querySelectorAll<SVGCircleElement>(".rm-pull-marks circle").forEach((c, k) => c.toggleAttribute("data-on", k < pose.pullsDone));
  root.querySelectorAll<SVGCircleElement>(".rm-turn-marks circle").forEach((c, k) => c.toggleAttribute("data-on", k < pose.waitsDone));
  const d = drumAt(pose.drumTurns);
  root.querySelector(".rm-drum-knurl")?.setAttribute("d", d.knurl);
  root.querySelector(".rm-drum-minor")?.setAttribute("d", d.minor);
  root.querySelector(".rm-drum-major")?.setAttribute("d", d.major);
  root.querySelector(".rm-drum-pointer")?.setAttribute("d", d.pointer);
  root.querySelector(".rm-drum-engraving")?.setAttribute("transform", d.engraving);
  root.querySelector(".rm-drum")?.toggleAttribute("data-turning", pose.drumTurns !== pose.waitsDone);
  // A ghost marker goes to the strong tone once the run is over and its bet matched.
  root.querySelectorAll<SVGElement>(".rm-ghost").forEach((g) => {
    const on = pose.done && g.dataset.outcome === "matched";
    g.toggleAttribute("data-matched", on);
    if (g.dataset.kind === "model") g.setAttribute("data-tone", on ? "hi" : "lo");
  });
}

export interface RetryLiveProps {
  input: RetryInput;
  /** Force the end state (the evidence pages and reduced motion). Defaults to the reader's setting. */
  still?: boolean;
  /** Paint this story moment (seconds) first and hold it: evidence pages only. */
  at?: number;
}

export function RetryLive({ input, still, at }: RetryLiveProps) {
  const model = useMemo(() => retryModel(input), [input]);
  const calm = still ?? asksForStillness();
  const end = useMemo(() => poseAt(model, Infinity), [model]);
  // First paint: the end state when calm, else the start of the story.
  const [first] = useState(() => (at !== undefined ? poseAt(model, at) : calm ? end : poseAt(model, 0)));
  const { anchor, say } = useReadout<HTMLDivElement>();
  const svgHost = useRef<HTMLDivElement>(null);
  const clock = useRef({ s: at ?? (calm ? model.total : 0), playing: !calm && at === undefined });
  const visible = useVisible(anchor);

  const draw = (s: number) => {
    const svg = svgHost.current?.querySelector("svg");
    if (!svg) return;
    const pose = poseAt(model, s);
    apply(svg, pose);
    say(pose.readout);
  };

  const kick = useLoop((dt, quiet) => {
    const c = clock.current;
    if (!c.playing) return false;
    c.s = quiet ? model.total : Math.min(model.total, c.s + dt);
    draw(c.s);
    if (c.s >= model.total) c.playing = false;
    return c.playing;
  }, visible && clock.current.playing);

  useEffect(() => {
    draw(clock.current.s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const boundaries = useMemo(() => {
    const out = [0];
    let t = 0;
    for (const st of model.steps) out.push((t += st.dur));
    return out;
  }, [model]);

  const replay = () => {
    clock.current = { s: 0, playing: !asksForStillness() };
    draw(asksForStillness() ? model.total : 0);
    kick();
  };
  const stepTo = (dir: 1 | -1) => {
    const c = clock.current;
    c.playing = false;
    const next = dir > 0 ? boundaries.find((b) => b > c.s + 1e-6) ?? model.total : [...boundaries].reverse().find((b) => b < c.s - 1e-6) ?? 0;
    c.s = next;
    draw(next);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") replay();
    else if (e.key === "ArrowRight") stepTo(1);
    else if (e.key === "ArrowLeft") stepTo(-1);
    else if (e.key === "Home") {
      clock.current = { s: 0, playing: false };
      draw(0);
    } else if (e.key === "End") {
      clock.current = { s: model.total, playing: false };
      draw(model.total);
    } else return;
    e.preventDefault();
  };

  const d0 = drumAt(first.drumTurns);
  const ghostRow = (kind: "person" | "model", i: number) => (kind === "person" ? 0 : 1 + i);
  return (
    <div
      ref={anchor}
      className="rm-live"
      tabIndex={0}
      role="group"
      aria-label={`${LABEL} Space or Enter replays the run; the arrow keys step through it, one step at a time.`}
      onKeyDown={onKey}
      data-still={calm ? "" : undefined}
    >
      <div ref={svgHost}>
        <div className="iso-stage rm-stage">
          <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false">
          {BASE}
          {CHUTE_MAST}
          {STATION}
          <g key="pull-marks" className="rm-pull-marks" data-part="pull-counter-marks">
            {STATION_ART.counterHolePoints.map(([x, y], k) => (
              <circle key={k} cx={x} cy={y} r={0.85} data-on={k < first.pullsDone ? "" : undefined} />
            ))}
          </g>
          {TUBE_MAST}
          {RACK}
          {RULER}
          <g key="ghosts" className="rm-ghosts" data-part="ghost-markers">
            {model.ghosts.map((g, i) => {
              const [x, y] = ghostAt(g.slot, ghostRow(g.kind, model.ghosts.filter((o) => o.kind === "model").indexOf(g)));
              const settled = first.done && g.outcome === "matched";
              return g.kind === "person" ? (
                <circle key={g.who + i} className="rm-ghost" data-kind="person" data-outcome={g.outcome ?? "none"} data-matched={settled ? "" : undefined} cx={x} cy={y} r={1.6} />
              ) : (
                <path
                  key={g.who + i}
                  className="iso-line rm-ghost"
                  data-tone={settled ? "hi" : "lo"}
                  data-kind="model"
                  data-outcome={g.outcome ?? "none"}
                  data-matched={settled ? "" : undefined}
                  d={`M${(x - 1.45).toFixed(2)} ${y.toFixed(2)}a1.45 1.45 0 1 0 2.9 0a1.45 1.45 0 1 0 -2.9 0Z`}
                />
              );
            })}
          </g>
          <g key="capsules" className="rm-capsules">
            {model.calls.map((call) => {
              const c = first.capsules.find((x) => x.n === call.n) ?? { n: call.n, where: { at: "gone" as const }, shows: null, lit: false };
              return <Capsule key={call.n} c={c} model={model} />;
            })}
          </g>
          {TUBE}
          {CHUTE}
          {HEAD}
          <g key="lever" className="rm-lever" transform={leverAt(first.lever)}>
            {LEVER}
          </g>
          <g key="drum" className="rm-drum">
            {DRUM_BASE}
            <g data-part="turn-counter-marks" className="rm-turn-marks">
              {DRUM_ART.counterHolePoints.map(([x, y], k) => (
                <circle key={k} cx={x} cy={y} r={0.8} data-on={k < first.waitsDone ? "" : undefined} />
              ))}
            </g>
            <g data-part="wait-drum">
              <Solid
                paths={DRUM_ART.body}
                tone="hi"
                crease="lo"
                inner={
                  <>
                    <g data-part="drum-band">
                      <Line d={DRUM_ART.band} tone="faint" />
                    </g>
                    <g data-part="drum-knurl">
                      <Line d={d0.knurl} tone="lo" className="rm-drum-knurl" />
                    </g>
                  </>
                }
              />
            </g>
            <g data-part="drum-rim">
              <Line d={DRUM_ART.rim} tone="lo" />
            </g>
            <g data-part="drum-ticks">
              <Line d={d0.minor} tone="lo" className="rm-drum-minor" />
              <Line d={d0.major} tone="mid" className="rm-drum-major" />
            </g>
            <g data-part="drum-engraving">
              <text className="iso-face-text rm-drum-engraving" data-tone="mid" transform={d0.engraving} fontSize={2} textAnchor="middle">
                {model.engraving}
              </text>
            </g>
            <g data-part="drum-pointer">
              <Line d={d0.pointer} tone="hi" className="rm-drum-pointer" />
            </g>
            <g data-part="drum-centre">
              <Line d={DRUM_ART.centre} tone="mid" />
            </g>
          </g>
        </svg>
        </div>
      </div>
    </div>
  );
}
