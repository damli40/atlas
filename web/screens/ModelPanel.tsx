// The model's slot (D02-06). Muse Spark bets on the SAME experiment and the same plain-code questions
// as the person. Before the run this panel shows only that it has sealed its bets and their hashes:
// never its answers, which the server does not send before the run. After the run it shows what the
// model said (its answers and its own rationale). The rationale is the model's words, kept here in
// the model panel; it is never part of a verdict.

import type { Bet } from "../../src/types";
import type { ModelSlotView } from "../api";
import { ShortHash } from "./Bets";

export function ModelSlotCard({ slot, revealed }: { slot: ModelSlotView | null; revealed: Bet[] | null }) {
  if (!slot) return null;
  const name = slot.display;
  return (
    <section className="card model" aria-label="model bets" data-testid="model-slot" data-status={slot.status}>
      <h2>Model's bets: {name}</h2>
      {slot.status === "thinking" && (
        <p className="running" role="status">
          {name} is placing its bets on the same questions…
        </p>
      )}
      {slot.status === "off" && <p className="muted">{name}: not asked ({slot.reason ?? "no reason given"}).</p>}
      {slot.status === "no_usable_answer" && (
        <p className="notice" data-testid="model-no-answer">
          {name}: no usable answer ({slot.reason ?? "no reason given"}). Your bets are still judged.
        </p>
      )}
      {slot.status === "no_usable_answer" && slot.detail && (
        <p className="muted small" data-testid="model-no-answer-detail">
          After the run, in full: {slot.detail}
        </p>
      )}
      {slot.status === "sealed" && !revealed && (
        <>
          <p data-testid="model-sealed-note">
            <b>
              {name} has sealed {slot.sealed.length} {slot.sealed.length === 1 ? "bet" : "bets"}.
            </b>{" "}
            <span className="muted">Its answers stay hidden until the run; only the hashes are shown now.</span>
          </p>
          <ul className="seals">
            {slot.sealed.map((b) => (
              <li key={b.id}>
                {b.measures}: sealed at {b.sealedAt} · hash <ShortHash hash={b.sealedHash} testId={`model-hash-${b.measures}`} />
              </li>
            ))}
          </ul>
        </>
      )}
      {revealed && revealed.length > 0 && (
        <>
          <p className="muted">Revealed after the run. The reasons are the model's own words, not a verdict.</p>
          <ul className="seals" data-testid="model-panel">
            {revealed.map((b) => (
              <li key={b.id} data-testid={`model-said-${b.measures}`}>
                <b>{b.measures}</b>: {b.answer.kind === "declined" ? `declined (${b.answer.reason})` : String(b.answer.value)}
                {b.rationale && <span className="muted"> · "{b.rationale}"</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
