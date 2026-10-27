// The retry machine as a card (Anatomy's Plate): Fig label, title, hint, live readout, legend and a
// true caption under the card. Input is { run, bets, verdicts } only. Atlas's watch limit, when a
// run reached it, is a caption line here, never a part of the machine.

import { useMemo, useSyncExternalStore } from "react";
import { Plate } from "../iso/react/draw";
import { stillNow as asksForStillness } from "../env";
import { RetryLive } from "./live";
import { grouped, poseAt, retryModel, type RetryInput } from "./model";

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

const nameOf = (who: string) => (who === "human" ? "your" : `${who.replace(/^model:/, "")}'s`);

export interface RetryMachineProps extends RetryInput {
  /** Force the end state (evidence pages). Defaults to the reader's reduced-motion setting. */
  still?: boolean;
  /** Force a theme (evidence pages). Defaults to the reader's colour-scheme setting. */
  theme?: "light" | "dark";
  /** Paint this story moment (seconds) and hold it: evidence pages only. */
  at?: number;
}

export function RetryMachine({ run, bets, verdicts, still, theme, at }: RetryMachineProps) {
  const input = useMemo(() => ({ run, bets, verdicts }), [run, bets, verdicts]);
  const model = useMemo(() => retryModel(input), [input]);
  const dark = useDark();
  const calm = still ?? asksForStillness();
  const shown = theme ?? (dark ? "dark" : "light");
  if (model.notShown !== null) {
    // B1: nothing from this run is shown as fact. No drawing, no motion, no readout numbers: the reason only.
    return (
      <div className="iso rm" data-theme={shown === "light" ? "light" : undefined} data-testid="retry-machine">
        <div className="card notice" role="note" data-testid="retry-cant-check">
          <p className="label">Fig 1 · The retry machine · can't check</p>
          <p>{model.notShown}</p>
          <p className="muted small">Run {run.id}. Every verdict on this run is "can't check".</p>
        </div>
      </div>
    );
  }
  const firstReadout = at !== undefined ? poseAt(model, at).readout : calm ? model.readout : poseAt(model, 0).readout;
  const ghosts = model.ghosts
    .map((g) => `${nameOf(g.who)} bet: ${g.value} ${g.value === 1 ? "call" : "calls"}${g.offScale ? ` (drawn at the ruler's end, slot ${g.slot})` : ""}`)
    .join(" · ");
  const waits = model.waits.length ? `${model.waits.length} ${model.waits.length === 1 ? "wait" : "waits"} of ${model.waits.map((w) => grouped(w.ms)).join(", ")} ms of virtual time` : "no waits";
  return (
    <div className="iso rm" data-theme={shown === "light" ? "light" : undefined} data-testid="retry-machine">
      <Plate
        fig="Fig 1"
        title="The retry machine"
        hint="Space replays · ← → step"
        readout={firstReadout}
        keys={[
          { mark: "lit", label: "The capsule moving now; at the end, the call whose answer the function ended with" },
          { mark: "raised", label: "A slash across the cap: that call threw. A dot: it returned a value" },
          { mark: "dotted", label: "Ghost markers on the ruler: the bets on how many calls (solid = you, ring = the model)" },
        ]}
        caption={
          <>
            {`Drawn from run ${run.id}'s trace only: ${model.calls.length} ${model.calls.length === 1 ? "call" : "calls"} (one capsule each), ${model.pulls} ${model.pulls === 1 ? "pull" : "pulls"} of the retry lever, ${waits} (one drum turn each). The drum's turns are virtual time: nothing waited for real.`}
            {ghosts ? ` ${ghosts}.` : ""}
            {model.endCaption ? (
              <span className="rm-end-caption" data-testid="retry-end-caption">
                {" "}
                {model.endCaption}
              </span>
            ) : null}
          </>
        }
      >
        <RetryLive key={run.id} input={input} still={calm} {...(at !== undefined ? { at } : {})} />
      </Plate>
    </div>
  );
}
