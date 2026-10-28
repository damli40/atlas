// R1 (D36): the "conditions" line. Shown on the verdict screen and the proof card for every call-function run that
// recorded its pins (seed, time zone, locale): what the result depends on that is Atlas's, not the code's. The
// sentences come from the run's recorded condition kinds (src/conditions.ts, words in src/paste-words.ts); a run
// from before R1 (seed "none") has no conditions and shows nothing here.

import type { Run } from "../../src/types";
import { CONDITION_WORDS } from "../../src/paste-words";

export function ConditionsLine({ run }: { run: Pick<Run, "conditions" | "seed" | "timeZone" | "locale"> | undefined }) {
  if (!run || run.conditions === undefined) return null;
  const W = CONDITION_WORDS;
  return (
    <div className="conditions small" data-testid="conditions" aria-label="conditions">
      <strong>{W.heading}</strong>
      {run.seed && run.timeZone && run.locale ? <span className="muted"> ({W.pins(run.seed, run.timeZone, run.locale)})</span> : null}
      {run.conditions.length === 0 ? (
        <p className="muted" data-testid="conditions-none">
          {W.none}
        </p>
      ) : (
        <>
          <p className="muted">{W.intro}</p>
          <ul>
            {run.conditions.map((c) => (
              <li key={c.kind} data-testid={`condition-${c.kind}`}>
                {c.says}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
