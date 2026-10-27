// Screen 1: the target, the scenario, the questions, and the person's sealed bets.
// After "Seal my bets" every input is disabled and each bet's hash is on screen, before the run.

import type { Question } from "../../src/gate";
import type { Target } from "../../src/types";
import type { ShownBet } from "../api";
import { SCENARIOS } from "../scenarios";

export function ShortHash({ hash, testId }: { hash: string; testId?: string }) {
  return (
    <code className="hash" title={hash} data-hash={hash} data-testid={testId} tabIndex={0} aria-label={`hash ${hash}`}>
      {hash.slice(0, 12)}…
    </code>
  );
}

export function TargetCard({ target }: { target: Target | null }) {
  if (!target) return <section className="card">Loading the code under test…</section>;
  return (
    <section className="card" aria-label="code under test">
      <div className="row">
        <h2>withRpcRetry</h2>
        {/* Mandatory label: this code was written before the hackathon (PRE-EXISTING.md). */}
        <span className="label" data-testid="pre-existing">
          {target.preExisting ? `${target.preExisting.label} (listed in ${target.preExisting.listedIn})` : "Pre-existing"}
        </span>
      </div>
      <p className="muted">
        {target.ref} · code fingerprint <ShortHash hash={target.codeSha256} />
      </p>
    </section>
  );
}

export interface BetsProps {
  scenarioId: string;
  onScenario: (id: string) => void;
  /** True once the questions are out: the scenario can no longer change. */
  asked: boolean;
  onAsk: () => void;
  questions: Question[];
  answers: Record<string, string>;
  onAnswer: (measures: string, value: string) => void;
  /** Hashes shown before the run, in question order. Non-empty = sealed: inputs are disabled. */
  sealed: ShownBet[];
  onSeal: () => void;
  busy: boolean;
}

export function Bets(p: BetsProps) {
  const locked = p.sealed.length > 0 || p.busy;
  const complete = p.questions.length > 0 && p.questions.every((q) => (p.answers[q.measures] ?? "").trim() !== "");
  return (
    <section className="card" aria-label="bets">
      <h2>1. Pick a scenario</h2>
      <fieldset disabled={p.asked || p.busy}>
        <legend className="muted">What the fake chain read does when withRpcRetry calls it</legend>
        {SCENARIOS.map((s) => (
          <label key={s.id} className="choice">
            <input type="radio" name="scenario" value={s.id} checked={p.scenarioId === s.id} onChange={() => p.onScenario(s.id)} />
            <span>
              <b>{s.id}</b> {s.label}
            </span>
          </label>
        ))}
      </fieldset>
      {!p.asked && (
        <button type="button" onClick={p.onAsk} disabled={p.busy}>
          Show the questions
        </button>
      )}

      {p.asked && (
        <>
          <h2>2. Place your bets</h2>
          <p className="muted">The questions are written by plain code (src/gate.ts), the same ones a model answers.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (complete && !locked) p.onSeal();
            }}
          >
            {p.questions.map((q) => {
              const id = `bet-${q.measures}`;
              const shown = p.sealed.find((b) => b.measures === q.measures);
              return (
                <div key={q.measures} className="question">
                  <label htmlFor={id}>{q.text}</label>
                  {q.kind === "enum" ? (
                    <select id={id} data-testid={id} value={p.answers[q.measures] ?? ""} disabled={locked} onChange={(e) => p.onAnswer(q.measures, e.target.value)}>
                      <option value="" disabled>
                        choose one
                      </option>
                      {(q.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      data-testid={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={p.answers[q.measures] ?? ""}
                      disabled={locked}
                      onChange={(e) => p.onAnswer(q.measures, e.target.value)}
                    />
                  )}
                  {shown && (
                    <p className="sealed">
                      sealed at {shown.sealedAt} · hash <ShortHash hash={shown.sealedHash} testId={`hash-${q.measures}`} />
                    </p>
                  )}
                </div>
              );
            })}
            {p.sealed.length === 0 && (
              <button type="submit" disabled={!complete || locked}>
                Seal my bets
              </button>
            )}
          </form>
          {p.sealed.length > 0 && (
            <p className="muted" data-testid="sealed-note">
              Sealed by the server at its own time. The hashes are on screen now, before the run; the secret part of each seal is revealed after the run so this page can check it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
