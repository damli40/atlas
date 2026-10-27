// D07-01, open-weights mode. Three small pieces the round screens share:
// - ClaimantToggle: who places the model's sealed bets on the next experiment: Muse Spark, Muse Spark
//   Open (Meta's open-weights model, via Baseten) or both. When the server cannot ask Muse Spark Open,
//   the toggle says "Muse Spark Open: not available (<reason>)" and those choices are disabled. It
//   never shows a score for a model that was not asked.
// - useModelSlots: the page's copy of every model slot of the round (one, or two in "both" mode).
// - BettorCounts: per bettor, how many bets matched, didn't match, or can't check. Counts only: no
//   word here says one bettor is better than another.

import { useEffect, useState } from "react";
import { sparkOpenUnavailableText, type ClaimantMode, type ClaimantsInfo } from "../../src/claimants";
import type { Outcome, Verdict } from "../../src/types";
import { slotsOf, type Api, type ExperimentAnswer, type ModelSlotView, type RunAnswer } from "../api";
import { bettorName } from "../machines/scoreboard/Scoreboard";

const LABEL: Record<ClaimantMode, string> = { spark: "Muse Spark", "spark-open": "Muse Spark Open", both: "Both" };

export function ClaimantToggle({ api, mode, onMode, locked }: { api: Api; mode: ClaimantMode; onMode: (m: ClaimantMode) => void; locked?: boolean }) {
  const [info, setInfo] = useState<ClaimantsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.claimants().then(
      (i) => live && setInfo(i),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api]);
  // Until the server says Spark Open is available, it is not offered (never assumed).
  const openOk = info?.sparkOpen.available === true;
  const why = info && !info.sparkOpen.available ? info.sparkOpen.reason : error ? `the page could not ask the server: ${error}` : null;
  return (
    <fieldset className="switch claimant" data-testid="claimant-toggle" disabled={locked}>
      <legend className="small">Who bets with you</legend>
      {(["spark", "spark-open", "both"] as const).map((m) => (
        <label key={m}>
          <input type="radio" name="claimant" value={m} checked={mode === m} disabled={m !== "spark" && !openOk} onChange={() => onMode(m)} data-testid={`claimant-${m}`} /> {LABEL[m]}
        </label>
      ))}
      {why !== null && (
        <p className="muted small" data-testid="spark-open-unavailable">
          {sparkOpenUnavailableText(why)}
        </p>
      )}
      {openOk && info && <p className="muted small">{info.sparkOpen.display}: Meta's open-weights model, served by Baseten.</p>}
    </fieldset>
  );
}

/** The page's model slots for one round. Before the run: status and hashes only. */
export function useModelSlots(api: Api) {
  const [slots, setSlots] = useState<ModelSlotView[]>([]);
  const fromExperiment = (out: ExperimentAnswer) => {
    const list = slotsOf(out);
    setSlots(list);
    if (list.some((s) => s.status === "thinking")) {
      // Not awaited: the person bets while the models think. Only hashes come back.
      api.modelSlots(out.experiment.id).then(
        (ms) => setSlots(ms),
        (e: Error) => setSlots(list.map((s) => (s.status === "thinking" ? { ...s, status: "no_usable_answer", reason: `the page could not reach the server: ${e.message}`, sealed: [] } : s))),
      );
    }
  };
  // After the run, the server's slot is the truth (its bets were sealed even if the page's own
  // model-bets request failed). A slot the page already showed as sealed keeps the page's copy: the
  // seal check compares against what was on screen BEFORE the run.
  const fromRun = (r: RunAnswer) => {
    const list = slotsOf(r);
    setSlots((cur) => list.map((s) => cur.find((c) => c.who === s.who && c.status === "sealed") ?? { ...s, sealed: [] }));
  };
  return { slots, fromExperiment, fromRun, thinking: slots.some((s) => s.status === "thinking") };
}

/** The heading a model column carries, or null when the model was not asked. */
export const shownName = (s: ModelSlotView) => (s.status !== "off" ? s.display : null);

/** The Verdict screen's model columns, from the page's slots. */
export const verdictColumns = (slots: ModelSlotView[]) =>
  slots
    .filter((s) => s.status !== "off")
    .map((s) => ({ who: s.who, name: s.display, shown: s.sealed, ...(s.status === "no_usable_answer" ? { empty: `no usable answer (${s.reason ?? "no reason given"})` } : {}) }));

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };
const ORDER: Outcome[] = ["matched", "not_matched", "cant_check"];

/**
 * Per bettor, the count of each outcome, one column per bettor: You first, then each model in the
 * order given (bettors with no judged bet still get a column when named). Plain counts only.
 */
export function BettorCounts({ verdicts, bets, names = {}, columns }: { verdicts: Verdict[]; bets: { id: string; who: string }[]; names?: Record<string, string>; columns?: string[] }) {
  const who = [...new Set(["human", ...(columns ?? []), ...bets.map((b) => b.who)])];
  const count = (w: string, o: Outcome) => verdicts.filter((v) => v.outcome === o && bets.find((b) => b.id === v.betId)?.who === w).length;
  const total = (w: string) => bets.filter((b) => b.who === w).length;
  if (who.length < 2) return null;
  return (
    <table className="counts small" data-testid="bettor-counts">
      <thead>
        <tr>
          <th>bets</th>
          {who.map((w) => (
            <th key={w} data-bettor={w}>
              {bettorName(w, names)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ORDER.map((o) => (
          <tr key={o}>
            <td>{SAY[o]}</td>
            {who.map((w) => (
              <td key={w} data-testid={`count-${o}-${w}`}>
                {count(w, o)}
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <td>bets placed</td>
          {who.map((w) => (
            <td key={w} data-testid={`count-total-${w}`}>
              {total(w)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
