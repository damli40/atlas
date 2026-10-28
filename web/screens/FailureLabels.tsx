// X3 (D28): common-failure labels, as plain code decided them (src/failure-labels.ts). Shown on the paste screen and
// on an explorer part's card. Each failure has exactly one label:
// - "found in this code" links to the lines the marker matched (shown right under it);
// - "reproduced" links to the proof card of the sealed run that showed it;
// - "inconclusive" names the run that came back can't check (and links to its proof card);
// - "common pattern" says only Atlas's list holds it: it is never shown as present in this code.

import type { FailureLabelKind, LabelledFailure, LabelsAnswer } from "../../src/failure-labels";
import { fileLines, lineSpan } from "../../src/words";

const LABEL_CLASS: Record<FailureLabelKind, string> = {
  "common pattern": "fl-common",
  "found in this code": "fl-found",
  reproduced: "fl-reproduced",
  inconclusive: "fl-inconclusive",
};

const span = (l: { path: string; lineStart: number; lineEnd: number }, showPath: boolean) => (showPath ? fileLines(l.path, l.lineStart, l.lineEnd) : lineSpan(l.lineStart, l.lineEnd));

export const FL_WORDS = {
  heading: "Known ways this kind of code fails",
  intro: "Atlas's short list of failures for each kind of code. Plain code decides each label; Muse Wonder may suggest a kind, never a label.",
  none: "Plain code saw none of the kinds of code on Atlas's list (retry, network call, concurrency, queue, database write, time) in these lines.",
  afterSeal: "Atlas's failure labels for this function appear once your bets on a round are sealed, so you and the betting models bet on the same information.",
  held: "Failure labels are held while a round on this code has bets still to seal, so you and the betting models bet on the same information.",
  legend: "Labels: reproduced (a sealed Atlas run showed it) · inconclusive (a run was tried but cannot show it) · found in this code (plain code saw the failure's marker in these lines; not a run) · common pattern (only Atlas's list says so).",
} as const;

function Item({ l, idPrefix, showPath }: { l: LabelledFailure; idPrefix: string; showPath: boolean }) {
  const linesId = `${idPrefix}-${l.kind}-${l.failure}-lines`;
  const kindWhy = [l.kindBy.plainCode ? `plain code saw ${l.kindBy.plainCode.sign} (${span(l.kindBy.plainCode.at, showPath)})` : "", l.kindBy.wonder ? `Muse Wonder (${l.kindBy.wonder.model}) tagged this part "${l.kindBy.wonder.tag}"` : ""].filter(Boolean).join("; ");
  return (
    <li className="fl-item" data-label={l.label} data-failure={l.failure} data-testid={`fl-${l.failure}`}>
      <p className="fl-head">
        <span className={`fl-badge ${LABEL_CLASS[l.label]}`} title={l.tooltip}>
          {l.label}
        </span> <b>{l.name}</b> <span className="muted small">{`(${l.kindName})`}</span>
      </p>
      <p className="small">{`What can go wrong: ${l.says}`}</p>
      <p className="small">{l.why}</p>
      {l.label !== "common pattern" && l.tooltip !== undefined ? <p className="muted small">{l.tooltip}</p> : null}
      {l.label === "reproduced" && l.runId ? (
        <p className="small">
          <a href={`?proof=${encodeURIComponent(l.runId)}`} data-testid={`fl-proof-${l.failure}`}>{`Open the proof card for run ${l.runId}`}</a>
        </p>
      ) : null}
      {l.label === "inconclusive" && l.runId ? (
        <p className="small">
          <a href={`?proof=${encodeURIComponent(l.runId)}`}>{`Open the proof card for run ${l.runId}`}</a>
        </p>
      ) : null}
      {l.lines && l.lines.length > 0 ? (
        <>
          <p className="small">
            <a href={`#${linesId}`} data-testid={`fl-lines-${l.failure}`}>
              {`${l.label === "found in this code" ? "The lines" : "Plain code also saw the marker in"}: ${l.lines.map((x) => span(x, showPath)).join(", ")}`}
            </a>
          </p>
          {l.excerpt && l.excerpt.length > 0 ? (
            <pre className="code fl-lines" id={linesId} tabIndex={0} data-scroll-x="" aria-label={`Lines for ${l.name}`}>
              {l.excerpt.map((x) => `${showPath ? `${x.path}:` : ""}${String(x.line).padStart(4, " ")}  ${x.text}`).join("\n")}
            </pre>
          ) : null}
        </>
      ) : null}
      {l.triedNotShown ? <p className="muted small">{`Run ${l.triedNotShown.runId} set this up and did not show it: ${l.triedNotShown.fact}.`}</p> : null}
      {l.markerRule && l.label !== "found in this code" ? <p className="muted small">{`The marker plain code looks for: ${l.markerRule}.`}</p> : null}
      {!l.markerRule ? <p className="muted small">No plain-code marker: Atlas never claims this one is present in the code; it stays a common pattern.</p> : null}
      <p className="muted small">{`Why this kind is listed: ${kindWhy}.`}</p>
    </li>
  );
}

export function FailureLabels({ answer, idPrefix, showPath = false, compact = false }: { answer: LabelsAnswer & { note?: string }; idPrefix: string; showPath?: boolean; compact?: boolean }) {
  const order: FailureLabelKind[] = ["reproduced", "found in this code", "inconclusive", "common pattern"];
  const sorted = [...answer.labels].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return (
    <div className="fl" data-testid={`${idPrefix}-labels`}>
      {compact ? null : <p className="muted small">{FL_WORDS.intro}</p>}
      <p className="muted small">{`Read: ${answer.read}.${answer.note ? ` ${answer.note}.` : ""}`}</p>
      {sorted.length === 0 ? (
        <p className="small">{FL_WORDS.none}</p>
      ) : (
        <ul className="fl-list">
          {sorted.map((l) => (
            <Item key={`${l.kind}/${l.failure}`} l={l} idPrefix={idPrefix} showPath={showPath} />
          ))}
        </ul>
      )}
      <p className="muted small">{FL_WORDS.legend}</p>
    </div>
  );
}
