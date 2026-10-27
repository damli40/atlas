"use client";
// The price pipe's live layer: places the art in painter's order, draws the parts the run decides
// (feed canisters, the blank plate, the gear or its dashed ghost, the needles and the ghost bet
// marks) from model.ts, and moves only what the story moves (the lit part, the flow beads, the gear,
// the needles) through refs, from poseAt(). Under reduced motion the first paint is the end state;
// Space still replays it step by step with the arrow keys.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLoop, useReadout } from "../iso/react/live";
import { stillNow as asksForStillness, useVisible } from "../env";
import { Dots, FaceText, Line, Solid } from "../iso/react/draw";
import { BASE, GAUGE_BODY, HOUSING, HUB, OUTLET, PEDESTAL, Part } from "./art";
import { DIAL_NUMERALS, GAUGE_ART, GHOST_OUTLINE, HEIGHT, INLET_ART, OUTLET_ART, PRICE_NEEDLE_LEN, REF_NEEDLE_LEN, WIDTH, along, gearAt, ghostAt, needleAt, type PartName } from "./geometry";
import { pipeModel, poseAt, type Inlet, type PipeInput, type PipeModel, type Pose } from "./model";

const LABEL =
  "A price pipe on a bench, drawn from the run: feed canisters at the inlets stand for the price feeds the run read, their ducts meet in a gear slot, and a gauge shows the price that came out beside the raw Chainlink reference. A multiply gear sits in the slot only when the run counted two price sources.";

function InletParts({ i, inlet }: { i: 0 | 1; inlet: Inlet }) {
  const a = INLET_ART[i];
  const n = i + 1;
  const name = (s: string) => s.replace("#", String(n)) as PartName;
  const read = inlet.state === "read";
  return (
    <g key={`inlet-${n}`} className="pp-inlet" data-inlet={n} data-state={inlet.state}>
      {read ? (
        <g className="pp-feed">
          <Part name={name("feed-#-canister-foot")}>
            <Solid paths={a.canisterFoot} tone="lo" />
          </Part>
          <Part name={name("feed-#-canister")}>
            <Solid
              paths={a.canister}
              tone="hi"
              crease="lo"
              inner={
                <Part name={name("feed-#-bands")}>
                  <Line d={a.band} tone="faint" />
                </Part>
              }
            />
          </Part>
          <Part name={name("feed-#-cap")}>
            <Solid paths={a.cap} tone="mid" />
            <Line d={a.capRing} tone="lo" />
          </Part>
          <Part name={name("feed-#-knob")}>
            <Solid paths={a.knob} tone="mid" />
          </Part>
          <Part name={name("feed-#-connector")}>
            <Solid paths={a.connector} tone="mid" />
          </Part>
        </g>
      ) : null}
      <Part name={name("inlet-#-flange")}>
        <Solid paths={a.flange} tone="mid" />
        <Dots points={a.flangeBolts} size={0.45} tone="mid" />
      </Part>
      {inlet.state === "blank" && i === 1 ? (
        <Part name="inlet-2-blank-plate">
          <Solid paths={a.blank} tone="lo" />
          <Dots points={a.blankScrews} size={0.45} tone="mid" />
        </Part>
      ) : null}
      <Part name={name("inlet-#-duct")} className="pp-duct">
        <Solid paths={a.duct} tone={read ? "hi" : "mid"} crease="lo" inner={<Line d={a.ductSeam} tone="faint" />} />
      </Part>
      {inlet.label ? (
        <Part name={name("inlet-#-label")}>
          <FaceText transform={a.labelAt} size={2.5} tone="hi" anchor="middle">
            {inlet.label}
          </FaceText>
        </Part>
      ) : null}
    </g>
  );
}

const fmt = (n: number) => n.toFixed(2);

/** Applies a pose to the drawn nodes (no React render per frame). */
function apply(root: SVGSVGElement, model: PipeModel, pose: Pose) {
  const lit = pose.lit;
  const toggle = (sel: string, on: boolean) => root.querySelectorAll(sel).forEach((g) => g.toggleAttribute("data-lit", on));
  toggle('.pp-inlet[data-state="read"] .pp-feed .iso-solid', lit === "inlets");
  toggle('.pp-inlet[data-state="read"] .pp-duct .iso-solid', lit === "ports");
  toggle(".pp-gear .iso-solid", lit === "slot" && model.slot.kind === "gear");
  toggle(".pp-housing .iso-solid", lit === "slot" && model.slot.kind !== "gear");
  toggle(".pp-outlet .iso-solid", lit === "outlet");
  root.querySelector(".pp-price-needle")?.setAttribute("data-tone", lit === "needles" ? "lit" : "hi");

  // Flow beads: one per inlet read, then one along the outlet.
  root.querySelectorAll<SVGCircleElement>(".pp-bead").forEach((c) => {
    const on = c.dataset.on!;
    let pt: [number, number] | null = null;
    if (pose.bead && (pose.bead.on === "inlets" || pose.bead.on === "ports") && on.startsWith("inlet-")) {
      const route = INLET_ART[Number(on.slice(6)) - 1]!.route;
      pt = along(route, pose.bead.on === "inlets" ? pose.bead.p * 0.5 : 0.5 + pose.bead.p * 0.5);
    } else if (pose.bead?.on === "outlet" && on === "outlet") pt = along(OUTLET_ART.route, pose.bead.p);
    if (pt) {
      c.setAttribute("cx", fmt(pt[0]));
      c.setAttribute("cy", fmt(pt[1]));
      c.style.display = "";
    } else c.style.display = "none";
  });

  if (model.slot.kind === "gear") {
    const g = gearAt(pose.gearTurn);
    const setSolid = (node: Element | null, paths: ReturnType<typeof gearAt>["body"]) => {
      if (!node) return;
      node.querySelector(".iso-fill")?.setAttribute("d", paths.fill);
      node.querySelector(".iso-top")?.setAttribute("d", paths.top);
      node.querySelector(".iso-edge")?.setAttribute("d", paths.outline);
      node.querySelector(".iso-crease")?.setAttribute("d", paths.crease);
      node.querySelectorAll(".iso-shade").forEach((s) => s.setAttribute("d", paths.shades[Number((s as SVGElement).dataset.shade)] ?? ""));
    };
    setSolid(root.querySelector(".pp-gear-body"), g.body);
    const back = root.querySelector(".pp-teeth-back");
    const front = root.querySelector(".pp-teeth-front");
    for (const t of g.teeth) {
      const node = root.querySelector(`.pp-tooth[data-i="${t.i}"]`);
      if (!node) continue;
      setSolid(node, t.paths);
      const layer = t.near ? front : back;
      if (layer && node.parentNode !== layer) layer.appendChild(node);
    }
    root.querySelector(".pp-gear-spokes")?.setAttribute("d", g.spokes);
  }
  if (model.price) root.querySelector(".pp-price-needle")?.setAttribute("d", needleAt(model.price.at * pose.needles, PRICE_NEEDLE_LEN));
  if (model.reference) root.querySelector(".pp-ref-needle")?.setAttribute("d", needleAt(model.reference.at * pose.needles, REF_NEEDLE_LEN));
  root.querySelectorAll<SVGElement>(".pp-ghost").forEach((g) => g.toggleAttribute("data-matched", pose.done && g.dataset.outcome === "matched"));
}

export interface PipeLiveProps {
  input: PipeInput;
  still?: boolean;
  at?: number;
}

export function PipeLive({ input, still, at }: PipeLiveProps) {
  const model = useMemo(() => pipeModel(input), [input]);
  const calm = still ?? asksForStillness();
  const end = useMemo(() => poseAt(model, Infinity), [model]);
  const [first] = useState(() => (at !== undefined ? poseAt(model, at) : calm ? end : poseAt(model, 0)));
  const { anchor, say } = useReadout<HTMLDivElement>();
  const svgHost = useRef<HTMLDivElement>(null);
  const clock = useRef({ s: at ?? (calm ? model.total : 0), playing: !calm && at === undefined });
  const visible = useVisible(anchor);

  const draw = (s: number) => {
    const svg = svgHost.current?.querySelector("svg");
    if (!svg) return;
    const pose = poseAt(model, s);
    apply(svg, model, pose);
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

  const gear0 = gearAt(first.gearTurn);
  const lit = first.lit;
  const ghostRow = (kind: "person" | "model", i: number) => (kind === "person" ? 0 : 1 + i);
  const models = model.ghosts.filter((g) => g.kind === "model");
  return (
    <div
      ref={anchor}
      className="pp-live"
      tabIndex={0}
      role="group"
      aria-label={`${LABEL} Space or Enter replays the run; the arrow keys step through it, one step at a time.`}
      onKeyDown={onKey}
      data-still={calm ? "" : undefined}
    >
      <div ref={svgHost}>
        <div className="iso-stage pp-stage">
          <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false" data-slot={model.slot.kind}>
            {BASE}
            <InletParts i={0} inlet={model.inlets[0]} />
            <InletParts i={1} inlet={model.inlets[1]} />
            {HOUSING}
            {model.slot.kind === "ghost" ? (
              <Part name="slot-ghost-outline">
                <Line d={GHOST_OUTLINE} tone="mid" dashed className="pp-ghost-outline" />
              </Part>
            ) : null}
            {model.slot.kind === "gear" ? (
              <g key="gear" className="pp-gear-group">
                <Part name="multiply-gear" className="pp-gear">
                  <g className="pp-teeth-back">
                    {gear0.teeth.filter((t) => !t.near).map((t) => (
                      <g key={t.i} className="pp-tooth" data-i={t.i}>
                        <Solid paths={t.paths} tone="hi" crease="lo" lit={lit === "slot"} />
                      </g>
                    ))}
                  </g>
                  <g className="pp-gear-body">
                    <Solid paths={gear0.body} tone="hi" crease="lo" lit={lit === "slot"} inner={<Line d={gear0.rim} tone="faint" />} />
                  </g>
                  <g className="pp-teeth-front">
                    {gear0.teeth.filter((t) => t.near).map((t) => (
                      <g key={t.i} className="pp-tooth" data-i={t.i}>
                        <Solid paths={t.paths} tone="hi" crease="lo" lit={lit === "slot"} />
                      </g>
                    ))}
                  </g>
                </Part>
                <Part name="gear-spokes">
                  <Line d={gear0.spokes} tone="lo" className="pp-gear-spokes" />
                </Part>
                <Part name="gear-hub">
                  <Solid paths={gear0.hub} tone="mid" />
                  <Line d={gear0.hubRing} tone="lo" />
                </Part>
              </g>
            ) : null}
            {PEDESTAL}
            {OUTLET}
            <Part name="flow-bead">
              {model.inlets.map((inl, i) =>
                inl.state === "read" ? <circle key={i} className="pp-bead" data-on={`inlet-${i + 1}`} r={1.3} cx={0} cy={0} style={{ display: "none" }} /> : null,
              )}
              <circle className="pp-bead" data-on="outlet" r={1.3} cx={0} cy={0} style={{ display: "none" }} />
            </Part>
            {GAUGE_BODY}
            <Part name="dial-numerals">
              {DIAL_NUMERALS.map((n) => (
                <FaceText key={n.text} transform={n.transform} size={1.7} tone="mid" anchor="middle">
                  {n.text}
                </FaceText>
              ))}
            </Part>
            <Part name="dial-engraving">
              <FaceText transform={GAUGE_ART.engraving} size={2.2} tone={model.controlPassed ? "mid" : "hi"} anchor="middle">
                {model.engraving}
              </FaceText>
            </Part>
            <Part name="ghost-bet-marks">
              {model.ghosts.map((g, i) => {
                const [x, y] = ghostAt(g.at, ghostRow(g.kind, models.indexOf(g)));
                const settled = first.done && g.outcome === "matched";
                return g.kind === "person" ? (
                  <circle key={g.who + i} className="pp-ghost" data-kind="person" data-outcome={g.outcome ?? "none"} data-matched={settled ? "" : undefined} cx={x} cy={y} r={1.5} />
                ) : (
                  <path
                    key={g.who + i}
                    className="iso-line pp-ghost"
                    data-tone="mid"
                    data-kind="model"
                    data-outcome={g.outcome ?? "none"}
                    data-matched={settled ? "" : undefined}
                    d={`M${(x - 1.4).toFixed(2)} ${y.toFixed(2)}a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0Z`}
                  />
                );
              })}
            </Part>
            {model.reference ? (
              <Part name="reference-needle">
                <Line d={needleAt(model.reference.at * first.needles, REF_NEEDLE_LEN)} tone="mid" className="pp-ref-needle" free="end" />
              </Part>
            ) : null}
            {model.price ? (
              <Part name="price-needle">
                <Line d={needleAt(model.price.at * first.needles, PRICE_NEEDLE_LEN)} tone={lit === "needles" ? "lit" : "hi"} className="pp-price-needle" free="end" />
              </Part>
            ) : null}
            {HUB}
          </svg>
        </div>
      </div>
    </div>
  );
}
