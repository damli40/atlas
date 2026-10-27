// Screen 3: one row per question, one column per bettor ("You" and the model, by name). The verdict
// comes from src/judge.ts on the server; the seal check is done HERE, in the browser: it recomputes
// sha256(canonicalJson(revealed bet)) with src/seal.ts and compares it to the hash this page showed
// before the run (kept from the seal step, not taken from the run's answer). Model bets are checked
// the same way, against the hashes the page showed while their answers were still hidden.

import { computeSealHash } from "../../src/seal";
import type { Bet, Outcome, Verdict } from "../../src/types";
import type { RunAnswer, SealedOnly } from "../api";
import { ShortHash } from "./Bets";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

/** A bet as shown before the run: at least its id, who, measures and hash. */
type ShownBefore = Pick<SealedOnly, "id" | "who" | "measures" | "sealedHash">;

export interface SealCheck {
  betId: string;
  shownHash: string;
  recomputed: string;
  match: boolean;
  sealedBeforeRun: boolean;
}

/** The browser's own check of every revealed bet against the hash it displayed before the run. */
export function checkSeals(shown: ShownBefore[], result: RunAnswer): SealCheck[] {
  return shown.map((s) => {
    const revealed = result.bets.find((b) => b.id === s.id);
    let recomputed = "";
    try {
      recomputed = revealed ? computeSealHash(revealed) : "";
    } catch {
      recomputed = "";
    }
    return {
      betId: s.id,
      shownHash: s.sealedHash,
      recomputed,
      match: recomputed !== "" && recomputed === s.sealedHash,
      sealedBeforeRun: revealed !== undefined && Date.parse(revealed.sealedAt) < Date.parse(result.run.startedAt),
    };
  });
}

function answerText(b: Bet | undefined): string {
  if (!b) return "-";
  return b.answer.kind === "declined" ? "declined" : String(b.answer.value);
}

export interface VerdictProps {
  /** The person's bets as shown before the run. */
  shown: ShownBefore[];
  /** The model's bets as shown before the run (hashes only). Empty when it gave no usable answer. */
  modelShown: ShownBefore[];
  /** The model's column heading, e.g. "Muse Spark 1.3 (muse-spark-1.3)"; null when no model was asked. */
  modelName: string | null;
  /** Shown in the model's column when it has no bets (e.g. "no usable answer (…)"). */
  modelEmpty?: string;
  result: RunAnswer;
}

function Cell({ bet, verdict, testId }: { bet: Bet | undefined; verdict: Verdict | undefined; testId: string }) {
  if (!bet) return <td data-testid={testId}>-</td>;
  const outcome = verdict?.outcome ?? "cant_check";
  return (
    <td className={`verdict ${outcome}`} data-testid={testId} data-outcome={outcome}>
      {answerText(bet)} · <b>{SAY[outcome]}</b>
      {verdict?.reason && <span className="muted small"> ({verdict.reason})</span>}
    </td>
  );
}

export function VerdictScreen({ shown, modelShown, modelName, modelEmpty, result }: VerdictProps) {
  const all = [...shown, ...modelShown];
  const checks = checkSeals(all, result);
  const revealed = (id: string | undefined) => (id ? result.bets.find((b) => b.id === id) : undefined);
  const verdictOf = (id: string | undefined) => (id ? result.verdicts.find((v) => v.betId === id) : undefined);
  const measures = [...new Set([...shown.map((b) => b.measures), ...modelShown.map((b) => b.measures)])];
  const label = (s: ShownBefore) => (s.who === "human" ? "You" : (modelName ?? s.who));
  return (
    <section className="card" aria-label="verdicts">
      <h2>4. Whose bet matched</h2>
      <table className="verdicts">
        <thead>
          <tr>
            <th>question</th>
            <th>You</th>
            {modelName && <th>{modelName}</th>}
            <th>observed</th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => {
            const mine = shown.find((b) => b.measures === m);
            const theirs = modelShown.find((b) => b.measures === m);
            const youBet = revealed(mine?.id);
            const modelBet = revealed(theirs?.id);
            const v = verdictOf(mine?.id) ?? verdictOf(theirs?.id);
            return (
              <tr key={m} data-testid={`verdict-${m}`}>
                <td>{youBet?.question ?? modelBet?.question ?? m}</td>
                <Cell bet={youBet} verdict={verdictOf(mine?.id)} testId={`verdict-you-${m}`} />
                {modelName &&
                  (theirs ? (
                    <Cell bet={modelBet} verdict={verdictOf(theirs.id)} testId={`verdict-model-${m}`} />
                  ) : (
                    <td className="muted small" data-testid={`verdict-model-${m}`}>
                      {modelEmpty ?? "no bet"}
                    </td>
                  ))}
                <td>
                  {v?.observed === undefined ? "-" : String(v.observed)}
                  <div className="muted small">judged by {v?.judgedBy ?? "src/judge.ts"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Seal check (done by this page, for every bettor)</h3>
      <ul className="seals">
        {checks.map((c) => {
          const b = all.find((x) => x.id === c.betId)!;
          const testId = b.who === "human" ? `seal-check-${b.measures}` : `seal-check-model-${b.measures}`;
          return (
            <li key={c.betId} data-testid={testId} data-match={c.match ? "yes" : "no"}>
              {label(b)}, {b.measures}: shown <ShortHash hash={c.shownHash} /> · recomputed {c.recomputed ? <ShortHash hash={c.recomputed} /> : "nothing to recompute"} ·{" "}
              <b>{c.match ? "✓ match" : "✗ mismatch"}</b> · {c.sealedBeforeRun ? "sealed before the run started" : "NOT sealed before the run started"}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
