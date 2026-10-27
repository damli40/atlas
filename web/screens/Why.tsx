// D05-05: "Ask why", after the run.
//
// Plain words: the person presses "Ask why" and sees short sentences about what the run did. Each one is
// shown ONLY if plain code (src/why.ts) finds the run evidence it points at: a trace event ("trace #23")
// or lines inside one of the round's findings ("lines 42–42"). Sentences come from two places:
// - plain code, templated from the run's own trace (shown as "Atlas, plain code");
// - a Meta model's own words (Muse Spark's bet rationale, the Investigator's claim), shown with the
//   model's id and kept apart from the verdicts: they are the model's words, never a verdict.
// Every sentence without such evidence is dropped, whoever wrote it, and the agent log strip counts it
// as "dropped: no run evidence".

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Bet, Finding, Run } from "../../src/types";
import { notShownAsFact } from "../../src/trust";
import { linkSentences, modelSentences, templatedSentences, type LinkedSentence, type WhyLink, type WhySentence } from "../../src/why";

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
  /** Model words to offer; each sentence is kept only with run evidence. */
  modelTexts?: readonly ModelText[];
}

/** The model words a round offers "Ask why": each model bet's rationale, and the Investigator's claim when its finding is the round's. */
export function modelTextsOf(bets: readonly Bet[], finding: Finding | null | undefined): ModelText[] {
  const out: ModelText[] = [];
  if (finding && finding.proposedBy.role === "investigator" && finding.claim.trim()) out.push({ text: finding.claim, model: finding.proposedBy.model, role: "investigator" });
  for (const b of bets) if (b.who !== "human" && b.rationale) out.push({ text: b.rationale, model: b.who.slice("model:".length), role: "claimant" });
  return out;
}

/** All candidate sentences for a run, in the order shown: plain code first, then the models' words. */
export function whySentences(run: Run, finding: Finding | null | undefined, modelTexts: readonly ModelText[]): WhySentence[] {
  return [...templatedSentences(run, finding ?? undefined), ...modelTexts.flatMap((m) => modelSentences(m.text, { kind: "model", model: m.model, role: m.role }))];
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
    return linkSentences(whySentences(run, finding, modelTexts), run, all);
  }, [run, finding, findings, modelTexts, notShown]);
  const droppedCount = result.dropped.length;
  useEffect(() => {
    if (asked) report(droppedCount);
  }, [asked, droppedCount, report]);
  const plain = result.shown.filter((s) => s.by.kind === "plain-code");
  const byModel = result.shown.filter((s) => s.by.kind === "model");
  return (
    <section className="card" aria-label="ask why" data-testid="why">
      <h2>Ask why</h2>
      {!asked ? (
        <button type="button" onClick={() => setAsked(true)} data-testid="why-ask">
          Ask why
        </button>
      ) : notShown !== null ? (
        <p className="notice" role="note" data-testid="why-cant-check">
          {notShown}
        </p>
      ) : (
        <>
          <p className="muted small">Only sentences that point at this run's evidence (a trace event or a finding's lines) are shown. {result.dropped.length} dropped: no run evidence.</p>
          <ul className="why" data-testid="why-plain">
            {plain.map((s, i) => (
              <WhyLine key={i} s={s} who="Atlas, plain code" />
            ))}
          </ul>
          {byModel.length > 0 && (
            <div className="model-panel" data-testid="why-model">
              <p className="muted small">The model's own words, with the run evidence they point at. Not a verdict.</p>
              <ul className="why">
                {byModel.map((s, i) => (
                  <WhyLine key={i} s={s} who={s.by.kind === "model" ? s.by.model : ""} />
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
