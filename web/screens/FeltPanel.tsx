// X4 (D56): "felt vs happened". Three small pieces with nothing tied to the drawing: they take plain data as props and
// import nothing from web/machines, so a new drawing can replace the stage without touching them.
// - HowSurePicker: the optional tap beside "Seal my answers".
// - FeltRoundLine: after the run, "You said 'sure' and matched 1 of 4."
// - FeltRecord: the person's record by how sure they said they were, and by whether the test scripted a failure.
// Every number is plain code's (src/felt.ts, src/track-record.ts). Every sentence is in src/paste-words.ts.

import { CONFIDENCE_LEVELS, roundConfidence } from "../../src/felt";
import { FELT_WORDS } from "../../src/paste-words";
import { levelsWords, pathWords, type TrackRecord } from "../../src/track-record";
import type { Bet, Confidence, Verdict } from "../../src/types";
import "./felt.css";

/** `hint`: show the "optional" sentence here. Off when the screen says it itself (the seal bar keeps it to one line). */
export function HowSurePicker({ value, onChange, disabled = false, hint = true, onEnter }: { onEnter?: (level: Confidence) => void; value: Confidence | null; onChange: (v: Confidence | null) => void; disabled?: boolean; hint?: boolean }) {
  return (
    <div className="felt-pick" data-testid="felt-pick">
      <span className="felt-pick-label" id="felt-pick-label">
        {FELT_WORDS.pickerLabel}
      </span>
      <div className="felt-opts" role="radiogroup" aria-labelledby="felt-pick-label">
        {CONFIDENCE_LEVELS.map((level) => (
          // A second tap takes the answer back: the question stays optional until the seal.
          <button type="button" role="radio" key={level} className="felt-opt" aria-checked={value === level} disabled={disabled} onKeyDown={(e) => {
            // Enter picks this level and seals, as the seal button's ↵ says; Space still only picks.
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter(level);
            }
          }} onClick={() => onChange(value === level ? null : level)} data-testid={`felt-${level.replace(" ", "-")}`}>
            {level}
          </button>
        ))}
      </div>
      {hint && <span className="felt-hint">{FELT_WORDS.pickerHint}</span>}
    </div>
  );
}

/** The round's line. Nothing at all when the person did not say how sure they were. */
export function FeltRoundLine({ bets, verdicts }: { bets: readonly Bet[]; verdicts: readonly Verdict[] }) {
  const c = roundConfidence(bets, verdicts);
  if (!c) return null;
  return (
    <p className="felt-round" data-testid="felt-round">
      {c.checkable === 0 ? FELT_WORDS.roundNone(c.level) : FELT_WORDS.roundMatched(c.level, c.matched, c.checkable)}
      {c.checkable > 0 && c.cantCheck > 0 ? ` ${FELT_WORDS.roundCantCheck(c.cantCheck)}` : ""}
    </p>
  );
}

export function FeltRecord({ record }: { record: TrackRecord }) {
  const p = pathWords(record.felt);
  return (
    <section className="felt-record" aria-label={FELT_WORDS.recordHeading} data-testid="felt-record">
      <details className="m-fold felt-fold" data-testid="felt-fold">
      <summary>
        {p.line ? (
          <span className="felt-paths" data-testid="felt-paths">
            {p.line}
          </span>
        ) : (
          FELT_WORDS.recordHeading
        )}
      </summary>
      {p.line && <h3>{FELT_WORDS.recordHeading}</h3>}
      <ul>
        {levelsWords(record.felt).map((s) => (
          <li key={s} data-testid="felt-level">
            {s}
          </li>
        ))}
      </ul>
      <p className="felt-note" data-testid="felt-paths-note">
        {[...p.notes, FELT_WORDS.pathsMeaning].join(" ")}
      </p>
      <p className="felt-note">{FELT_WORDS.luck}</p>
      </details>
    </section>
  );
}
