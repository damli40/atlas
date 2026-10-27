// D06-03: the proof card, the end frame of a round. Read from one .atlas.json (GET /proofs/:runId).
//
// What it shows, all from the file: the scoreboard (the Atlas mark; each bettor by name, models with
// their Meta model id, and the outcome words), the target and its code fingerprint, the seed or fork
// block, the known-case check, the captions the file carries, every sealed hash (re-hashed in this
// browser), "judged by src/judge.ts", a link to download the exact file, and a "re-run it" link that
// asks the server to replay the round (GET /replay/:runId; the page sends the session header).

import { useEffect, useMemo, useState } from "react";
import type { AtlasFile } from "../../src/types";
import { ApiError, type Api, type ReplayAnswer } from "../api";
import { Scoreboard, bettorName } from "../machines/scoreboard/Scoreboard";
import { SAY, proofCardModel, replayWords } from "./proofcard-model";
import { DiffView } from "./Change";
import { AFTER_LABEL, BEFORE_LABEL, CHANGE_CAPTION } from "../../src/change";

/** S6: the pre-existing label, from the file when it carries one. */
const preExistingLabel = (file: AtlasFile) =>
  file.target.preExisting ? `${file.target.preExisting.label} (listed in ${file.target.preExisting.listedIn})` : "Pre-existing (listed in PRE-EXISTING.md)";

/** A link to a round's proof card, for the end of a round. */
export function ProofLink({ runId }: { runId: string }) {
  return (
    <p className="small">
      <a href={`?proof=${encodeURIComponent(runId)}`} data-testid="proof-link">
        Open the proof card for run {runId}
      </a>
    </p>
  );
}

/** The card on its own page (`?proof=<runId>`): fetches the file, then draws it. */
export function ProofCardPage({ api, runId }: { api: Api; runId: string }) {
  const [file, setFile] = useState<AtlasFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.proof(runId).then(
      (f) => live && setFile(f),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api, runId]);
  return (
    <div className="proof-page">
      {file ? (
        <ProofCard file={file} api={api} />
      ) : error ? (
        <p className="notice" role="alert">
          {error}
        </p>
      ) : (
        <p className="muted">Reading the .atlas.json for run {runId}…</p>
      )}
    </div>
  );
}

type ReplayState = { kind: "idle" } | { kind: "running" } | { kind: "done"; answer: ReplayAnswer } | { kind: "failed"; reason: string };

export function ProofCard({ file, api, replay: given }: { file: AtlasFile; api?: Api; replay?: ReplayAnswer }) {
  const card = useMemo(() => proofCardModel(file), [file]);
  const [replay, setReplay] = useState<ReplayState>(given ? { kind: "done", answer: given } : { kind: "idle" });
  const download = useMemo(() => {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return null;
    return URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + "\n"], { type: "application/json" }));
  }, [file]);
  useEffect(() => () => void (download && URL.revokeObjectURL(download)), [download]);

  const rerun = async () => {
    if (!api) return;
    setReplay({ kind: "running" });
    try {
      setReplay({ kind: "done", answer: await api.replay(card.runId) });
    } catch (e) {
      setReplay({ kind: "failed", reason: e instanceof ApiError || e instanceof Error ? e.message : String(e) });
    }
  };
  const words = replay.kind === "done" ? replayWords(replay.answer) : null;
  const fp = (h: string) => `${h.slice(0, 12)}…${h.slice(-6)}`;

  return (
    <article className="proof-card" data-testid="proof-card" aria-label={`proof card for run ${card.runId}`}>
      <header className="pc-head">
        <div>
          <p className="pc-kicker">Atlas · proof card</p>
          <h1 className="pc-title">{card.target.kind === "github-pr" ? card.target.ref : "withRpcRetry"}</h1>
          {card.target.kind === "ts-fixture" && (
            // S6 (day-6 review): mandatory label, this code was written before the hackathon (PRE-EXISTING.md).
            <span className="label" data-testid="pc-pre-existing">
              {preExistingLabel(file)}
            </span>
          )}
          {card.level && (
            <p className="pc-level" data-testid="pc-level">
              {card.level}
            </p>
          )}
        </div>
        <p className="pc-judged" data-testid="pc-judged">
          judged by {card.judgedBy.join(", ") || "src/judge.ts"}
        </p>
      </header>

      <section className="pc-score" aria-label="scoreboard">
        {card.notShownAsFact ? (
          <p className="notice" data-testid="pc-not-shown">
            {card.notShownAsFact}
          </p>
        ) : (
          <Scoreboard verdicts={file.verdicts} bets={file.bets} still />
        )}
        <table className="pc-bets" data-testid="pc-bets">
          <thead>
            <tr>
              <th>who</th>
              <th>asked</th>
              <th>bet</th>
              <th>the code</th>
              <th>outcome</th>
            </tr>
          </thead>
          <tbody>
            {card.bets.map((b) => (
              <tr key={b.betId} data-outcome={b.outcome ?? "none"}>
                <td className="pc-who">{bettorName(b.who, {})}</td>
                <td>{b.measures}</td>
                <td>{b.said}</td>
                <td>{card.notShownAsFact ? "not shown" : b.observed}</td>
                <td className={`pc-out pc-${b.outcome ?? "none"}`}>
                  {b.outcome ? SAY[b.outcome] : "no verdict"}
                  {b.reason ? <span className="muted"> ({b.reason})</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {file.change && file.replay && <ProofChange file={file} said={Object.fromEntries(card.bets.map((b) => [b.betId, b.said]))} />}

      <section className="pc-facts" aria-label="what ran">
        <dl>
          <dt>target</dt>
          <dd>
            {card.target.ref}
            {card.target.commit ? ` @ ${card.target.commit.slice(0, 10)}` : ""}
          </dd>
          <dt>code fingerprint</dt>
          <dd className="pc-mono" title={card.target.codeSha256}>
            sha256 {fp(card.target.codeSha256)}
          </dd>
          <dt>{card.where.startsWith("seed") ? "seed" : "fork"}</dt>
          <dd data-testid="pc-where">{card.where}</dd>
          <dt>control</dt>
          <dd data-testid="pc-controls">
            {card.controlPassed ? "passed: " : ""}
            {card.controls.join("; ")}
          </dd>
        </dl>
        <ul className="pc-captions" data-testid="pc-captions" aria-label="captions">
          {card.captions.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="pc-seals" aria-label="sealed hashes">
        <p className="pc-small">Sealed before the run (hash re-computed in this browser):</p>
        <ul data-testid="pc-seals">
          {card.bets.map((b) => (
            <li key={b.betId}>
              <span className="pc-who">{bettorName(b.who, {})}</span> · {b.measures} · <span className="pc-mono">{b.sealedHash}</span> {b.sealHolds ? "✓" : "✗ does not match its fields"}
            </li>
          ))}
        </ul>
      </section>

      <footer className="pc-foot">
        {download && (
          <a href={download} download={`${card.runId}.atlas.json`} data-testid="pc-download">
            Download {card.runId}.atlas.json
          </a>
        )}
        <a
          href={`/api/replay/${encodeURIComponent(card.runId)}`}
          data-testid="pc-rerun"
          onClick={(e) => {
            e.preventDefault();
            if (replay.kind !== "running") void rerun();
          }}
          aria-disabled={!api || replay.kind === "running" ? true : undefined}
        >
          {replay.kind === "running" ? "re-running…" : "Re-run it"}
        </a>
        {words && (
          <span className={`pc-replay${words.same ? " pc-same" : ""}`} data-testid="pc-replay">
            {words.text}
            {replay.kind === "done" && replay.answer.replayForkBlock !== undefined ? ` · same fork block ${replay.answer.replayForkBlock}` : ""}
            {replay.kind === "done" && replay.answer.replaySeed !== undefined ? ` · same seed ${replay.answer.replaySeed}` : ""}
          </span>
        )}
        {replay.kind === "failed" && (
          <span className="notice" data-testid="pc-replay-failed">
            replay not run: {replay.reason}
          </span>
        )}
        <span className="pc-small muted">recorded {card.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")} · run {card.runId}</span>
      </footer>
    </article>
  );
}

/** D06-01: the change and its replay, from the file: the diff only, and the SAME bets before | after. */
function ProofChange({ file, said }: { file: AtlasFile; said: Record<string, string> }) {
  const change = file.change!;
  const replay = file.replay!;
  const before = (id: string) => file.verdicts.find((v) => v.betId === id)?.outcome;
  const after = (id: string) => replay.verdicts.find((v) => v.betId === id)?.outcome;
  const same = replay.run.runner === "ts" ? `same seed ${replay.run.seed}` : `same fork block ${replay.run.forkBlock}`;
  return (
    <section className="pc-change" aria-label="change and re-run" data-testid="pc-change">
      <p className="caption label" data-testid="pc-change-caption">
        {CHANGE_CAPTION}
      </p>
      <p className="pc-small">
        Change proposed by {change.proposedBy.model} · replay {replay.run.id}, {same} · judged by src/judge.ts
      </p>
      {file.target.kind === "ts-fixture" && (
        <p className="pc-small" data-testid="pc-change-pre-existing">
          <span className="label">{preExistingLabel(file)}</span> The diff below is a proposed change to that code, not code written for it.
        </p>
      )}
      <DiffView diff={change.diff} />
      <table className="pc-bets" data-testid="pc-change-table">
        <thead>
          <tr>
            <th>who</th>
            <th>asked</th>
            <th>bet</th>
            <th>{BEFORE_LABEL}</th>
            <th>{AFTER_LABEL}</th>
          </tr>
        </thead>
        <tbody>
          {file.bets.map((b) => {
            const o1 = before(b.id);
            const o2 = after(b.id);
            return (
              <tr key={b.id}>
                <td className="pc-who">{bettorName(b.who, {})}</td>
                <td>{b.measures}</td>
                <td>{said[b.id] ?? ""}</td>
                <td className={`pc-out pc-${o1 ?? "none"}`}>{o1 ? SAY[o1] : "no verdict"}</td>
                <td className={`pc-out pc-${o2 ?? "none"}`}>{o2 ? SAY[o2] : "no verdict"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {replay.passRule && (
        <ul className="pc-small" data-testid="pc-change-pass-rule">
          {replay.passRule.map((l) => (
            <li key={l.rule}>
              {l.rule}: <b>{l.outcome}</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
