// X3 (D27): "Your track record": where the person's guesses matched what the code did, by kind of question.
// Every number comes from the server's plain-code record (src/track-record.ts) over the person's own sealed bets and
// the judge's verdicts. The panel is NOT part of the bet text: no betting model sees it (D19).

import { useEffect, useState } from "react";
import { TRACK_WORDS, recordWords, typeLineWords, type TrackRecord } from "../../src/track-record";
import type { Api, TrackAnswer } from "../api";

/** One record as a list (also used by the proof card for "your record before this round"). */
export function RecordView({ record, testId }: { record: TrackRecord; testId?: string }) {
  if (record.counted === 0 && record.excludedRepeats === 0) return <p className="muted small">{TRACK_WORDS.empty}</p>;
  return (
    <div data-testid={testId}>
      <ul className="track-lines">
        {record.lines.map((l) => (
          <li key={l.type} data-type={l.type}>
            {typeLineWords(l)}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {TRACK_WORDS.counted(record.counted, record.rounds)}
        {record.excludedRepeats > 0 ? ` ${TRACK_WORDS.repeats(record.excludedRepeats)}` : ""}
      </p>
    </div>
  );
}

/** The small panel. `refreshKey` changes after each run so the panel reads the record again. */
export function TrackRecordPanel({ api, refreshKey }: { api: Api; refreshKey: string | number }) {
  const [answer, setAnswer] = useState<TrackAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // A rejection (or an api without this route) shows the reason instead of breaking the page.
    Promise.resolve().then(() => api.trackRecord()).then(
      (a) => {
        if (!live) return;
        setAnswer(a);
        setError(null);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api, refreshKey]);
  return (
    <section className="card track" aria-label={TRACK_WORDS.heading} data-testid="track-record">
      <h2>{TRACK_WORDS.heading}</h2>
      <p className="small">{TRACK_WORDS.subheading}</p>
      {answer ? <RecordView record={answer.record} testId="track-record-lines" /> : error ? <p className="muted small">{`The record could not be read: ${error}`}</p> : <p className="muted small">Reading your record…</p>}
      <p className="muted small">
        {TRACK_WORDS.how} {answer ? (answer.person === "invite" ? TRACK_WORDS.whoInvite : TRACK_WORDS.whoLocal) : ""}
      </p>
      <p className="muted small">{TRACK_WORDS.wonderNote}</p>
    </section>
  );
}

/** For the proof card: the record before this round, read from the server (only this person's own rounds). */
export function RecordBefore({ api, runId }: { api: Api; runId: string }) {
  const [before, setBefore] = useState<TrackRecord | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => api.trackRecord(runId)).then(
      (a) => live && setBefore(a.before ?? null),
      () => live && setBefore(null),
    );
    return () => {
      live = false;
    };
  }, [api, runId]);
  if (!before) return null; // not this person's round (or no record): nothing is shown
  return (
    <section className="card proof-record" aria-label={TRACK_WORDS.beforeHeading} data-testid="record-before">
      <h3>{TRACK_WORDS.beforeHeading}</h3>
      <p className="muted small">{TRACK_WORDS.subheading}</p>
      {before.counted === 0 && before.excludedRepeats === 0 ? <p className="small">{TRACK_WORDS.beforeNone}</p> : <RecordView record={before} />}
    </section>
  );
}

/** For tests: every sentence the panel can show for a record. */
export const panelWords = (r: TrackRecord): string[] => [TRACK_WORDS.heading, TRACK_WORDS.subheading, TRACK_WORDS.how, TRACK_WORDS.whoInvite, TRACK_WORDS.whoLocal, TRACK_WORDS.wonderNote, TRACK_WORDS.empty, TRACK_WORDS.beforeHeading, TRACK_WORDS.beforeNone, ...recordWords(r)];
