// D07-02: "What else?". After a round has run, one button asks the server (POST /adversary). The
// Adversary (muse-spark-1.3) reads the run and proposes one more experiment on the same target; the gate
// decides; then Atlas runs it as an autonomous round with no click: Muse Spark bets on the plain-code
// questions (sealed before the run), the person is "not asked", the code runs, src/judge.ts judges.
//
// What the screen says in its own voice: the experiment's name from src/experiment-name.ts (shape id +
// params, by plain code), the gate's decision, the verdict words "matched / didn't match / can't check".
// The Adversary's own sentence ("why") sits in a separate model panel with the model id, never beside a
// verdict as Atlas's words.

import { useState } from "react";
import { notShownAsFact } from "../../src/trust";
import type { Question } from "../../src/gate";
import type { Bet, Experiment, Outcome, Run, Verdict } from "../../src/types";
import type { AdversaryAnswer, Api, ModelSlotView, ProofInfo } from "../api";
import { ModelSlotCard } from "./ModelPanel";
import { ProofLink } from "./ProofCard";
import type { FormatValue } from "./Verdict";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };
const asStored: FormatValue = (_m, v) => String(v);

/** The autonomous round as POST /adversary returns it (the POST /runs answer plus the experiment and questions). */
export interface AutonomousRound {
  experiment: Experiment;
  questions: Question[];
  model?: ModelSlotView | null;
  run?: Run;
  verdicts?: Verdict[];
  bets?: Bet[];
  proof?: ProofInfo;
}

function answerText(b: Bet, format: FormatValue): string {
  if (b.answer.kind === "declined") return "declined";
  if (b.answer.kind === "number") return `${b.answer.value} ${b.answer.unit} (±${b.answer.tolerancePct}%)`;
  return format(b.measures, b.answer.value);
}

export function AdversaryResult({ answer, format = asStored }: { answer: AdversaryAnswer; format?: FormatValue }) {
  const adv = answer.adversary;
  const round = answer.round as AutonomousRound | undefined;
  const run = round?.run;
  const hidden = run ? notShownAsFact(run) : null;
  const slot = round?.model ?? null;
  return (
    <div data-testid="adversary-result" data-ok={answer.ok ? "yes" : "no"}>
      {adv?.rejected.map((r) => (
        <p key={r.id} className="notice small" data-testid="adversary-rejected">
          Adversary ({adv.model}) proposed an experiment · gate (plain code): rejected ({r.safeReason}). Recorded as a refusal; it never ran.
        </p>
      ))}
      {adv?.proposed && (
        <dl className="facts" data-testid="adversary-proposal">
          <dt>Adversary ({adv.model}) proposed</dt>
          <dd>
            <code data-testid="adversary-proposed">{adv.proposed.name}</code>
          </dd>
          <dt>gate (plain code)</dt>
          <dd>allowed (src/gate.ts); not run on this target before</dd>
          <dt>you</dt>
          <dd data-testid="adversary-person">not asked ({answer.person?.reason ?? "autonomous round"})</dd>
          {run && (
            <>
              <dt>run</dt>
              <dd>
                {run.id} · {run.runner === "evm" ? `fork of Base at block ${run.forkBlock}` : `sandbox, seed ${run.seed ?? "-"}`} · known-case check {run.controlPassed ? "passed" : "did not pass, so every verdict is can't check"}
              </dd>
            </>
          )}
        </dl>
      )}
      {!answer.ok && (
        <p className="notice" data-testid="adversary-reason">
          {answer.reason ?? "no reason given"}
        </p>
      )}
      {run && hidden !== null && <p className="notice">{hidden}</p>}
      {run && round?.verdicts && (
        <table className="verdicts" data-testid="adversary-verdicts">
          <thead>
            <tr>
              <th>bettor</th>
              <th>question (plain code)</th>
              <th>bet</th>
              <th>verdict (src/judge.ts)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>You</td>
              <td colSpan={2}>not asked: autonomous round, no click</td>
              <td>-</td>
            </tr>
            {(round.bets ?? []).map((b) => {
              const v = round.verdicts!.find((x) => x.betId === b.id);
              const o = v?.outcome ?? "cant_check";
              return (
                <tr key={b.id} data-testid={`adversary-verdict-${b.measures}`}>
                  <td>{slot && b.who === slot.who ? slot.display : b.who}</td>
                  <td>{b.question}</td>
                  <td>{answerText(b, format)}</td>
                  <td className={`verdict ${o}`} data-outcome={o}>
                    <b>{SAY[o]}</b>
                    <div className="muted small">
                      observed {v?.observed === undefined || hidden !== null ? "-" : format(b.measures, v.observed)}
                      {v?.reason ? ` (${v.reason})` : ""}
                    </div>
                  </td>
                </tr>
              );
            })}
            {(round.bets ?? []).length === 0 && (
              <tr>
                <td colSpan={4}>No bets were sealed, so there is no verdict{slot?.reason ? ` (${slot.display}: ${slot.reason})` : ""}.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {round && slot && <ModelSlotCard slot={slot} revealed={run && round.bets ? round.bets.filter((b) => b.who === slot.who) : null} />}
      {adv?.why && (
        <div className="card model" data-testid="adversary-why">
          <p className="muted small">
            What the Adversary wrote, in its own words ({adv.display}). Model text: not a verdict, not checked by Atlas.
          </p>
          <p>"{adv.why}"</p>
        </div>
      )}
      {round?.proof?.ok && <ProofLink runId={round.proof.runId} />}
    </div>
  );
}

export function AdversaryPanel({ api, runId, format }: { api: Api; runId: string; format?: FormatValue }) {
  const [answer, setAnswer] = useState<AdversaryAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api.adversary(runId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-label="what else" data-testid="adversary">
      <h2>What else?</h2>
      <p className="muted small">
        The Adversary (Muse Spark 1.3, muse-spark-1.3) reads this run and proposes one more experiment on the same code. The gate decides. Then Atlas runs it with no click: Muse Spark bets, you are not asked, the code runs, plain code judges.
      </p>
      {!answer && (
        <button type="button" onClick={ask} disabled={busy} data-testid="adversary-ask">
          What else?
        </button>
      )}
      {busy && (
        <p className="running" role="status">
          The Adversary proposes, the gate decides, Muse Spark bets, the code runs… (a fork of Base takes 30–90 seconds)
        </p>
      )}
      {answer && <AdversaryResult answer={answer} {...(format ? { format } : {})} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
