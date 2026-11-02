// R1 (D42): the "conditions" line. Shown on the verdict screen and the proof card for every call-function run that
// recorded its pins (seed, time zone, locale): what the result depends on that is Atlas's, not the code's. The
// sentences come from the run's recorded condition kinds (src/conditions.ts, words in src/paste-words.ts); a run
// from before R1 (seed "none") has no conditions and shows nothing here.

import type { Run } from "../../src/types";
import { CONDITION_WORDS } from "../../src/paste-words";

/** A long sentence-by-sentence note: its first sentence, the rest under a fold. Every word stays. */
export function FoldedWords({ words }: { words: string }) {
  const at = words.search(/[.:] [A-Z]/);
  if (at < 0 || words.length < 160) return <>{words}</>;
  return (
    <details className="u1-fold-words">
      <summary>{words.slice(0, at + 1)}</summary>
      {words.slice(at + 2)}
    </details>
  );
}

export function ConditionsLine({ run }: { run: (Pick<Run, "conditions" | "seed" | "timeZone" | "locale"> & { result?: Pick<Run["result"], "notMeasured"> }) | undefined }) {
  if (!run || run.conditions === undefined) return null;
  const W = CONDITION_WORDS;
  // R1 review M6: a run that did not run to the end says nothing about what the code depends on.
  const didNotFinish = run.result?.notMeasured.wholeRun !== undefined;
  return (
    <div className="conditions small" data-testid="conditions" aria-label="conditions">
      <strong>{W.heading}</strong>
      {run.seed && run.timeZone && run.locale ? <span className="muted"> ({W.pins(run.seed, run.timeZone, run.locale)})</span> : null}
      {didNotFinish ? (
        <p className="muted" data-testid="conditions-not-known">
          {W.notKnown}
        </p>
      ) : run.conditions.length === 0 ? (
        <p className="muted" data-testid="conditions-none">
          {W.none}
        </p>
      ) : (
        <>
          <p className="muted">{W.intro}</p>
          <ul>
            {run.conditions.map((c) => (
              <li key={c.kind} data-testid={`condition-${c.kind}`}>
                <FoldedWords words={c.says} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
