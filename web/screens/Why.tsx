// D05-05: "Ask why", after the run.
//
// Plain words: the person presses "Ask why" and sees short sentences about what the run did. Only plain
// code writes them (src/why.ts templates them from the run's own trace), and each one is shown ONLY if
// plain code finds the run evidence it points at: a trace event ("trace #23") or lines inside one of the
// round's findings ("lines 42–42"). Those are the only linked sentences ("Atlas, plain code").
// A Meta model's own words (Muse Spark's bet rationale, the Investigator's claim) are shown apart, whole,
// unlinked and labelled as the model's words (S2, day-5 review): a rationale is sealed BEFORE the run, so a
// "trace #N" inside it is a guess and is never turned into a link. A finding written by hand ("none: …"
// model id) is not a model, so its claim is not offered as a model's words.
// A plain-code sentence without evidence is dropped, and the agent log strip counts it as
// "dropped: no run evidence". When the run may not be shown as fact (src/trust.ts), no sentence is shown.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Bet, Finding, Run } from "../../src/types";
import { notShownAsFact } from "../../src/trust";
import { linkSentences, templatedSentences, type LinkedSentence, type WhyLink, type WhySentence } from "../../src/why";

/** Where "Ask why" reports how many sentences it dropped (App passes it to the log strip). */
export const WhyDroppedContext = createContext<(count: number) => void>(() => {});

export interface ModelText {
  text: string;
  model: string;
  role: "claimant" | "investigator";
}

export interface WhyProps {
  run: Run;
  /** The round's finding (shown first as a plain-code sentence when present) and any other findings to link lines against. */
  finding?: Finding | null;
  findings?: readonly Finding[];
  /** Model words to show apart, whole and unlinked (never as evidence). */
  modelTexts?: readonly ModelText[];
}

/** The model words a round offers "Ask why": each model bet's rationale, and the Investigator's claim when its finding is the round's (and a model wrote it). */
export function modelTextsOf(bets: readonly Bet[], finding: Finding | null | undefined): ModelText[] {
  const out: ModelText[] = [];
  if (finding && finding.proposedBy.role === "investigator" && !finding.proposedBy.model.startsWith("none:") && finding.claim.trim()) out.push({ text: finding.claim, model: finding.proposedBy.model, role: "investigator" });
  for (const b of bets) if (b.who !== "human" && b.rationale) out.push({ text: b.rationale, model: b.who.slice("model:".length), role: "claimant" });
  return out;
}

/** The candidate linked sentences for a run: plain code only (a model's words are never linked). */
export function whySentences(run: Run, finding: Finding | null | undefined): WhySentence[] {
  return templatedSentences(run, finding ?? undefined);
}

const linkWords = (l: WhyLink) => (l.kind === "trace" ? `trace #${l.index}: ${l.event}` : `${l.file} lines ${l.lineStart}–${l.lineEnd}`);

export function WhyScreen({ run, finding, findings, modelTexts = [] }: WhyProps) {
  const [asked, setAsked] = useState(false);
  const report = useContext(WhyDroppedContext);
  const notShown = useMemo(() => notShownAsFact(run), [run]);
  const result = useMemo(() => {
    // B1: from a run that may not be shown as fact, no sentence is offered at all (none is "dropped" either).
    if (notShown !== null) return { shown: [], dropped: [] };
    const all = [...(finding ? [finding] : []), ...(findings ?? []).filter((f) => f.id !== finding?.id)];
    return linkSentences(whySentences(run, finding), run, all);
  }, [run, finding, findings, notShown]);
  const droppedCount = result.dropped.length;
  useEffect(() => {
    if (asked) report(droppedCount);
  }, [asked, droppedCount, report]);
  const plain = result.shown;
  return (
    <section className="card" aria-label="ask why" data-testid="why">
      <h2>Ask why</h2>
      {!asked ? (
        <button type="button" onClick={() => setAsked(true)} data-testid="why-ask">
          Ask why
        </button>
      ) : (
        <>
          {notShown !== null ? (
            <p className="notice" role="note" data-testid="why-cant-check">
              {notShown}
            </p>
          ) : (
            <>
              <p className="muted small">Only sentences written by plain code that point at this run's evidence (a trace event or a finding's lines) are shown. {result.dropped.length} dropped: no run evidence.</p>
              <ul className="why" data-testid="why-plain">
                {plain.map((s, i) => (
                  <WhyLine key={i} s={s} who="Atlas, plain code" />
                ))}
              </ul>
            </>
          )}
          {modelTexts.length > 0 && (
            <div className="model-panel" data-testid="why-model">
              <p className="muted small">The model's own words, written before the run. Not linked to run evidence, not checked, not a verdict.</p>
              <ul className="why">
                {modelTexts.map((m, i) => (
                  <li key={i} data-testid="why-model-words">
                    <span className="muted small">
                      {m.model} ({m.role === "claimant" ? "its bet's reasoning" : "its finding"}), the model's words:{" "}
                    </span>
                    {m.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function WhyLine({ s, who }: { s: LinkedSentence; who: string }) {
  return (
    <li data-testid="why-sentence">
      <span className="muted small">{who}: </span>
      {s.text}
      <span className="muted small"> · evidence: {s.links.map(linkWords).join("; ")}</span>
    </li>
  );
}
