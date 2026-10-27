// Screen 3: one row per bet. The verdict comes from src/judge.ts on the server; the seal check is
// done HERE, in the browser: it recomputes sha256(canonicalJson(revealed bet)) with src/seal.ts and
// compares it to the hash this page showed before the run (kept from the seal step, not taken from
// the run's answer).

import { computeSealHash } from "../../src/seal";
import type { Outcome } from "../../src/types";
import type { RunAnswer, ShownBet } from "../api";
import { ShortHash } from "./Bets";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

export interface SealCheck {
  betId: string;
  shownHash: string;
  recomputed: string;
  match: boolean;
  sealedBeforeRun: boolean;
}

/** The browser's own check of every revealed bet against the hash it displayed before the run. */
export function checkSeals(shown: ShownBet[], result: RunAnswer): SealCheck[] {
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

function answerText(b: ShownBet): string {
  return b.answer.kind === "declined" ? "declined" : String(b.answer.value);
}

export function VerdictScreen({ shown, result }: { shown: ShownBet[]; result: RunAnswer }) {
  const checks = checkSeals(shown, result);
  return (
    <section className="card" aria-label="verdicts">
      <h2>4. Whose bet matched</h2>
      <table className="verdicts">
        <thead>
          <tr>
            <th>question</th>
            <th>your bet</th>
            <th>observed</th>
            <th>verdict</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => {
            const v = result.verdicts.find((x) => x.betId === b.id);
            return (
              <tr key={b.id} className={`verdict ${v?.outcome ?? "cant_check"}`} data-testid={`verdict-${b.measures}`}>
                <td>{b.question}</td>
                <td>{answerText(b)}</td>
                <td>{v?.observed === undefined ? "-" : String(v.observed)}</td>
                <td>
                  <b>{v ? SAY[v.outcome] : SAY.cant_check}</b>
                  {v?.reason && <span className="muted"> ({v.reason})</span>}
                  <div className="muted small">judged by {v?.judgedBy ?? "src/judge.ts"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Seal check (done by this page)</h3>
      <ul className="seals">
        {checks.map((c) => {
          const b = shown.find((x) => x.id === c.betId)!;
          return (
            <li key={c.betId} data-testid={`seal-check-${b.measures}`} data-match={c.match ? "yes" : "no"}>
              {b.measures}: shown <ShortHash hash={c.shownHash} /> · recomputed {c.recomputed ? <ShortHash hash={c.recomputed} /> : "nothing to recompute"} ·{" "}
              <b>{c.match ? "✓ match" : "✗ mismatch"}</b> · {c.sealedBeforeRun ? "sealed before the run started" : "NOT sealed before the run started"}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
