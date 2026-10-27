// The price pipe as a card (Anatomy's Plate): Fig label, title, hint, live readout, legend and a true
// caption under the card. Input is { run, bets, verdicts } only. The Level caption comes from the
// run: a run whose trace applied the proposal's feed actions is Level 2; a plain read is Level 1.

import { useMemo, useSyncExternalStore } from "react";
import { Plate } from "../iso/react/draw";
import { stillNow as asksForStillness } from "../env";
import { LEVEL2_CAPTION, level1Caption } from "../../../src/atlasfile";
import { formatUsd1e18, usdToUsd1e18 } from "../../../src/units";
import { PipeLive } from "./live";
import { pipeModel, poseAt, type PipeInput, type PipeModel } from "./model";

const DARK = "(prefers-color-scheme: dark)";
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

const nameOf = (who: string) => (who === "human" ? "you" : who.replace(/^model:/, ""));
const usd = (n: number) => {
  try {
    return formatUsd1e18(usdToUsd1e18(n)).replace(/\.00$/, "");
  } catch {
    return `$${n}`;
  }
};

/** The Level caption this run earns (never "caught before shipping" for Level 1). */
export function levelCaptionOf(model: Pick<PipeModel, "level" | "forkBlock">): string | null {
  if (model.level === "level2") return LEVEL2_CAPTION;
  if (model.level === "level1" && model.forkBlock !== null) return level1Caption(model.forkBlock);
  return null;
}

function slotSentence(m: PipeModel): string {
  const s = m.slot;
  if (s.kind === "gear") return "The call trace counted 2 price sources for this read, so a multiply gear sits in the slot.";
  if (s.kind === "not_measured") return `Gear slot: not measured (${s.reason}), so it is drawn plain, with no gear and no outline.`;
  const one = `The call trace counted ${m.count} price ${m.count === 1 ? "source" : "sources"} for this read, so no gear sits in the slot.`;
  if (s.kind === "empty") return one;
  return `${one} The dashed outline is the bettors' expectation, drawn from the bets (each asked for a USD price), not a part of the code.`;
}

function inletSentence(m: PipeModel): string {
  const named = m.inlets.filter((i) => i.state === "read").map((i) => i.label ?? "unnamed");
  const from = m.inlets[0].labelFrom === "feedDescription" ? "the feed's own description, read on-chain" : m.inlets[0].labelFrom === "reference input" ? "the raw Chainlink feeds the reference read, matched to the call trace" : "the feed's address";
  if (named.length === 0) return "Inlets: no price was read.";
  const second = m.inlets[1].state === "blank" ? " The second inlet is blanked: the read used one price source." : m.inlets[1].state === "unknown" ? " Nothing is said about the second inlet: the source count was not measured." : "";
  return `Inlets: ${named.join(" and ")} (named from ${from}).${second}`;
}

function gaugeSentence(m: PipeModel): string {
  if (!m.controlPassed) return `Gauge: can't check. The known-case control did not pass (${m.controlReason}), so no needle is drawn.`;
  const price = m.price ? `the price needle reads ${m.price.text}${m.price.offScale ? " (off the scale, drawn at its end)" : ""}` : "no price was read";
  const ref = m.reference ? `; the smaller needle is the reference (raw Chainlink, same block), ${m.reference.text}` : "; no reference was computed";
  return `Gauge: log scale, $0.01 to $10,000; ${price}${ref}.`;
}

function ghostSentence(m: PipeModel): string {
  const marks = m.ghosts.map((g) => `${nameOf(g.who)} bet ${usd(g.usd)} (${g.kind === "person" ? "solid dot" : "ring"}${g.offScale ? ", drawn at the scale's end" : ""})`);
  const declined = m.declined.map((w) => `${nameOf(w)}: declined (no mark)`);
  const all = [...marks, ...declined];
  return all.length ? `Bets on the rim: ${all.join(" · ")}.` : "";
}

export interface PricePipeProps extends PipeInput {
  still?: boolean;
  theme?: "light" | "dark";
  at?: number;
  /** Evidence only: a caption that replaces the Level caption (for a fixture that is not a whole run). */
  captionOverride?: string;
}

export function PricePipe({ run, bets, verdicts, still, theme, at, captionOverride }: PricePipeProps) {
  const input = useMemo(() => ({ run, bets, verdicts }), [run, bets, verdicts]);
  const model = useMemo(() => pipeModel(input), [input]);
  const dark = useDark();
  const calm = still ?? asksForStillness();
  const shown = theme ?? (dark ? "dark" : "light");
  const firstReadout = at !== undefined ? poseAt(model, at).readout : calm ? model.readout : poseAt(model, 0).readout;
  const levelCaption = captionOverride ?? levelCaptionOf(model);
  const keys = [
    { mark: "lit" as const, label: "The part moving now; at the end, the price needle" },
    { mark: "raised" as const, label: "Smaller needle: reference (raw Chainlink, same block)" },
    ...(model.slot.kind === "ghost" ? [{ mark: "dashed" as const, label: "Dashed outline: the bettors' expectation, not the code" }] : []),
    { mark: "dotted" as const, label: "Rim marks: the bets (solid = you, ring = the model)" },
  ];
  return (
    <div className="iso pp" data-theme={shown === "light" ? "light" : undefined} data-testid="price-pipe">
      <Plate
        fig="Fig 2"
        title="The price pipe"
        hint="Space replays · ← → step"
        readout={firstReadout}
        keys={keys}
        caption={
          <>
            {levelCaption ? (
              <span className="pp-level-caption" data-testid="pipe-level-caption">
                {levelCaption}.{" "}
              </span>
            ) : null}
            {`Drawn from run ${run.id} only. `}
            <span data-testid="pipe-slot-caption">{slotSentence(model)}</span> {inletSentence(model)} {gaugeSentence(model)} {ghostSentence(model)}
          </>
        }
      >
        <PipeLive key={run.id} input={input} still={calm} {...(at !== undefined ? { at } : {})} />
      </Plate>
    </div>
  );
}
