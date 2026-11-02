// D06-03: the proof card, the end frame of a round. Read from one .atlas.json (GET /proofs/:runId).
//
// What it shows, all from the file: the scoreboard (the Atlas mark; each bettor by name, models with
// their Meta model id, and the outcome words), the target and its code fingerprint, the seed or fork
// block, the known-case check, the captions the file carries, every sealed hash (re-hashed in this
// browser), "judged by src/judge.ts", a link to download the exact file, and a "re-run it" link that
// asks the server to replay the round (GET /replay/:runId; the page sends the session header).

import { ProofImage } from "./ProofImage";
import { useEffect, useMemo, useState } from "react";
import type { AtlasFile } from "../../src/types";
import { ApiError, type Api, type HelperAnswer, type ReplayAnswer } from "../api";
import { Scoreboard, bettorName } from "../machines/scoreboard/Scoreboard";
import { SAY, bettorLineWords, bettorLines, creditLine, proofCardModel, replayWords } from "./proofcard-model";
import { DiffView } from "./Change";
import { BettorCounts } from "./Claimant";
import { bettorNames, changeProposer, orderModelBettors } from "../../src/claimants";
import { AFTER_LABEL, BEFORE_LABEL, CHANGE_CAPTION, CHANGE_CAPTION_READER, theoryCaptions } from "../../src/change";
import { targetName } from "../../src/target-name";
import { describeCall } from "../../src/gate";
import { shortQuestionFor, LANGUAGE_NAME } from "../../src/paste-context";
import { RunPath } from "../drawing/RunPath";
import { MoonwellDrawing } from "../drawing/MoonwellDrawing";
import { PASTE_WORDS } from "../../src/paste-words";
import { ConditionsLine } from "./Conditions";
import { RecordBefore } from "./TrackRecord";
import type { MachineEnd, MachineParts } from "../../renderer/authors/machine";
import { FELT_WORDS } from "../../src/paste-words";

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
/** R3: the same path in the pencil engine, on request. If it cannot be drawn, the server's own words say why. */
function PencilImage({ api, runId }: { api: Pick<Api, "pencil">; runId: string }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "none"; words: string } | { kind: "ok"; src: string }>({ kind: "idle" });
  if (state.kind === "ok") return <img className="pc-pencil" src={state.src} alt="The same path, drawn by the pencil engine" data-testid="pc-pencil-img" />;
  return (
    <p className="pc-small">
      <button
        type="button"
        className="u1-link"
        disabled={state.kind === "busy"}
        onClick={async () => {
          setState({ kind: "busy" });
          const a = await api.pencil(runId).catch(() => ({ words: "The server could not be reached; the drawing above is the same chart." }));
          setState("src" in a ? { kind: "ok", src: a.src } : { kind: "none", words: a.words });
        }}
        data-testid="pc-pencil"
      >
        {state.kind === "busy" ? "drawing in pencil…" : "draw this in pencil"}
      </button>{" "}
      {state.kind === "none" ? <span data-testid="pc-pencil-none">{state.words}</span> : null}
    </p>
  );
}

export function ProofCardPage({ api, runId, embedded = false }: { api: Api; runId: string; embedded?: boolean }) {
  const [file, setFile] = useState<AtlasFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // J3: with an invite gate on, someone logged out cannot run anything, so nothing that runs or keeps is offered to them. Unknown yet counts as out.
  const [loggedOut, setLoggedOut] = useState(!embedded);
  useEffect(() => {
    if (embedded) return;
    let live = true;
    void Promise.resolve()
      .then(() => api.inviteStatus())
      .then(
        (st) => live && setLoggedOut(st.required && !st.signedIn),
        () => live && setLoggedOut(false),
      );
    return () => {
      live = false;
    };
  }, [api, embedded]);
  // J4, C3: what the server records about whoever is looking. If it can't say, nothing says "you" and the card asks nothing of the volume.
  const [viewer, setViewer] = useState<{ yours: boolean; keepsCards: boolean; canKeep: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => api.proofViewer(runId))
      .then(
        (v) => live && setViewer(v),
        () => live && setViewer({ yours: false, keepsCards: true, canKeep: false }),
      );
    return () => {
      live = false;
    };
  }, [api, runId]);
  // D66: the machine for the picture, when this reader may have it. Otherwise the picture keeps its marks.
  const [machineParts, setMachineParts] = useState<MachineParts | null>(null);
  const [machineHelpers, setMachineHelpers] = useState<HelperAnswer | null>(null);
  const [machineEnd, setMachineEnd] = useState<MachineEnd | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => api.proofMachine(runId))
      .then(
        (m) => {
          if (!live) return;
          setMachineParts(m.parts);
          setMachineHelpers(m.helpers ?? null);
          setMachineEnd(m.end ?? null);
        },
        () => live && setMachineParts(null),
      );
    return () => {
      live = false;
    };
  }, [api, runId]);
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
  // U2: inside the drawing screen the card is a panel, not a second <main> landmark.
  const Shell = embedded ? "div" : "main";
  return (
    <Shell className="proof-page">
      {file && viewer ? (
        <div className="proof-stack">
          {/* Inside the round's own screen the bettor is looking. Elsewhere only the server's record says so: where nothing records whose bet it was, the words stay neutral. */}
          <ProofCard file={file} api={api} machineParts={machineParts} machineHelpers={machineHelpers} machineEnd={machineEnd} reader={loggedOut} keepsCards={viewer.keepsCards} canKeep={viewer.canKeep} stranger={!embedded && !viewer.yours} />
          {/* X3 (D27): only for the person whose round this was (the server answers null for anyone else). */}
          <RecordBefore api={api} runId={runId} />
        </div>
      ) : error ? (
        <>
          <p className="notice" role="alert">
            {error}
          </p>
          <p className="pc-small">
            <a href="/" data-testid="pc-home-gone">Atlas: draw your own code and bet on what it does</a>
          </p>
        </>
      ) : (
        <p className="muted">Reading the .atlas.json for run {runId}…</p>
      )}
    </Shell>
  );
}

type ReplayState = { kind: "idle" } | { kind: "running" } | { kind: "done"; answer: ReplayAnswer } | { kind: "failed"; reason: string };

/** D10 + D07-01: each model bettor of the file by product name AND id (src/claimants.ts). An unknown id is shown as itself. */
export function modelNames(file: Pick<AtlasFile, "bets">): Record<string, string> {
  return bettorNames(file.bets.map((b) => b.who));
}

export function ProofCard({ file, api, replay: given, stranger = false, reader = false, keepsCards = true, canKeep = true, machineParts = null, machineHelpers = null, machineEnd = null }: { machineParts?: MachineParts | null; machineHelpers?: HelperAnswer | null; machineEnd?: MachineEnd | null; file: AtlasFile; api?: Api; replay?: ReplayAnswer; /** Whoever is looking did not place these bets, so nothing says "you". */ stranger?: boolean; /** Logged out: nothing that runs or keeps is offered. */ reader?: boolean; /** False: this server has no volume to keep a card on. */ keepsCards?: boolean; /** False: whoever is looking did not run this round, so the link stays the file's own address. */ canKeep?: boolean }) {
  const card = useMemo(() => proofCardModel(file), [file]);
  // D10 + D07-01: every model bettor by product name AND id (src/claimants.ts), e.g.
  // "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten". An unknown id is shown as itself.
  // Day-7 review M3/M7: every bettor of the round, including a model that sealed nothing and a person not asked.
  const lines = useMemo(() => bettorLines(file), [file]);
  const names = useMemo(() => ({ ...bettorNames([...file.bets.map((b) => b.who), ...lines.map((l) => l.who)]), ...(stranger ? { human: "The bettor" } : {}) }), [file, lines, stranger]);
  const modelBettors = orderModelBettors(lines.filter((l) => l.who !== "human").map((l) => l.who));
  const unseated = Object.fromEntries(lines.filter((l) => l.status !== "sealed").map((l) => [l.who, l.status === "not_asked" ? "not asked" : "no usable answer"]));
  const [replay, setReplay] = useState<ReplayState>(given ? { kind: "done", answer: given } : { kind: "idle" });
  const download = useMemo(() => {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return null;
    // What the server says about a link is not part of the file: the download must pass verifyAtlasFile.
    const { keptCard: _kept, ...plain } = file as AtlasFile & { keptCard?: unknown };
    return URL.createObjectURL(new Blob([JSON.stringify(plain, null, 2) + "\n"], { type: "application/json" }));
  }, [file]);
  useEffect(() => () => void (download && URL.revokeObjectURL(download)), [download]);

  // A reader of a shared card, or a card kept past its round: re-running or drawing it again is for the session that ran it.
  const readerOnly = reader || (file as { sourceWithheld?: boolean }).sourceWithheld === true || (file as { keptCard?: unknown }).keptCard !== undefined;
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
  // E3: a pasted round is named by the function it called, and its questions drop the call description.
  const exp0 = file.experiments[0];
  const call = exp0?.params.shape === "call-function" ? exp0.params : undefined;
  const title = call && file.target.kind === "pasted" ? `${call.exportName} · pasted ${file.target.language ? LANGUAGE_NAME[file.target.language] : "code"}` : targetName(card.target);
  const caption = (q: string) => shortQuestionFor(q, exp0?.params, file.target.language);
  // The file's own caption stays as it was sealed; only what a reader who did not bet sees changes.
  const sayCaption = (c: string) => (stranger && c === CHANGE_CAPTION ? CHANGE_CAPTION_READER : c);
  const fp = (h: string) => `${h.slice(0, 12)}…${h.slice(-6)}`;
  const saidHowSure = file.bets.find((b) => b.who === "human" && b.confidence)?.confidence;

  return (
    <article className="proof-card" data-testid="proof-card" aria-label={`proof card for run ${card.runId}`}>
      <ProofImage stranger={stranger} reader={reader} keepsCards={keepsCards} canKeep={canKeep} machineParts={machineParts} machineHelpers={machineHelpers} machineEnd={machineEnd} card={card} file={file} lines={lines} names={names} preExisting={card.target.kind === "ts-fixture" ? preExistingLabel(file) : null} {...(api ? { api } : {})} {...(download ? { download, downloadName: `${card.runId}.atlas.json` } : {})} />
      <header className="pc-head">
        <div>
          <p className="pc-kicker">Atlas · proof card</p>
          <h1 className="pc-title">{title}</h1>
          {card.target.kind === "ts-fixture" && (
            // S6 (day-6 review): mandatory label, this code was written before the hackathon (PRE-EXISTING.md).
            <span className="label" data-testid="pc-pre-existing">
              {preExistingLabel(file)}
            </span>
          )}
          {file.bets.some((b) => b.repeat) && (
            // E3 review r2 M2: a repeat of a test already run in the session; its bets are sealed with repeat: true.
            <p className="pc-level" data-testid="pc-repeat">
              A repeat of a test already run in this session: its bets are marked as a repeat.
            </p>
          )}
          {saidHowSure && (
            // X4 (D56): sealed with the person's answers; verify checks it.
            <p className="pc-level" data-testid="pc-how-sure">
              {FELT_WORDS.proofSaid(saidHowSure)}
            </p>
          )}
          {card.level && (
            <p className="pc-level" data-testid="pc-level">
              {card.level}
            </p>
          )}
        </div>
        <p className="pc-judged" data-testid="pc-judged">
          {PROOF_WORDS.judged}
        </p>
      </header>
      {/* U3 item 7: plain words first; the technical details are folded below. */}
      {call && (
        <p className="pc-plain pc-call" data-testid="pc-call">
          <b>What it was given:</b> {describeCall(call, file.target.language)}
        </p>
      )}
      <p className="pc-plain" data-testid="pc-plain">
        {PROOF_WORDS.what}
      </p>
      {/* R7 (D69): Meta's tools, credited plainly. */}
      {creditLine(file) && (
        <p className="pc-plain pc-credit" data-testid="pc-credit">
          {creditLine(file)}
        </p>
      )}

      {/* D07-04: the film's end frame. The scoreboard is the Atlas mark, large and centred, then who bet and how it came out. */}
      <section className="pc-hero" aria-label="the marks">
        {card.notShownAsFact ? (
          <p className="notice" data-testid="pc-not-shown">
            {card.notShownAsFact}
          </p>
        ) : (
          <Scoreboard verdicts={file.verdicts} bets={file.bets} names={names} still who={false} size={240} caption={caption} />
        )}
        <ul className="pc-bettors" data-testid="pc-bettors" aria-label="who bet and how it came out">
          {lines.map((l) => (
            <li key={l.who} data-bettor={l.who} data-status={l.status}>
              {bettorName(l.who, names)} · {card.notShownAsFact && l.status === "sealed" ? "not shown" : bettorLineWords(l)}
            </li>
          ))}
        </ul>
      </section>

      <section className="pc-score" aria-label="bets" tabIndex={0}>
        {!card.notShownAsFact && (modelBettors.length > 1 || Object.keys(unseated).length > 0) && lines.length > 1 && (
          <BettorCounts verdicts={file.verdicts} bets={file.bets} names={names} columns={modelBettors} unseated={unseated} />
        )}
        <table className="pc-bets" data-testid="pc-bets">
          <thead>
            <tr>
              <th>who</th>
              <th>question</th>
              <th>answer</th>
              <th>the run measured</th>
              <th>outcome</th>
            </tr>
          </thead>
          <tbody>
            {card.bets.map((b) => (
              <tr key={b.betId} data-outcome={b.outcome ?? "none"}>
                <td className="pc-who">{bettorName(b.who, names)}</td>
                <td title={b.measures}>{plainField(b.measures)}</td>
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

      {file.change && file.replay && <ProofChange file={file} names={names} stranger={stranger} said={Object.fromEntries(card.bets.map((b) => [b.betId, b.said]))} />}

      {call && file.runs[0] && (
        // E3: the call timeline, drawn from the file's own run (the same component as the round's screen).
        <section className="pc-machine" aria-label="call timeline" data-testid="pc-call-timeline">
          <RunPath run={file.runs[0]} experiment={file.experiments[0]} bets={file.bets} verdicts={file.verdicts} still testid="pc-path" stranger={stranger} />
          {api && !reader && (file as { keptCard?: unknown }).keptCard === undefined && <PencilImage api={api} runId={file.runs[0].id} />}
        </section>
      )}

      {/* R3 phase 2: the retry demo's and Moonwell's cards carry their drawing too. */}
      {!call && file.runs[0]?.runner === "ts" && (
        <section className="pc-machine" aria-label="what happened" data-testid="pc-retry">
          <RunPath run={file.runs[0]} experiment={file.experiments[0]} bets={file.bets} verdicts={file.verdicts} still retry testid="pc-path" stranger={stranger} />
          {api && !reader && (file as { keptCard?: unknown }).keptCard === undefined && <PencilImage api={api} runId={file.runs[0].id} />}
        </section>
      )}
      {!call && file.runs[0]?.runner === "evm" && (
        <section className="pc-machine" aria-label="the price flow" data-testid="pc-moonwell">
          <MoonwellDrawing run={file.runs[0]} bets={file.bets} verdicts={file.verdicts} captions={[...new Set(file.captions.map(sayCaption))]} still stranger={stranger} {...(file.change ? { beforeChange: true } : {})} />
          {api && !reader && (file as { keptCard?: unknown }).keptCard === undefined && <PencilImage api={api} runId={file.runs[0].id} />}
        </section>
      )}

      <details className="pc-tech" data-testid="pc-tech">
      <summary>{PROOF_WORDS.techSummary}</summary>
      <p className="pc-small" data-testid="pc-judged-by">
        judged by {card.judgedBy.join(", ") || "src/judge.ts"}
      </p>
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
          <dt>{card.where.startsWith("seed") ? "seed" : card.where.startsWith("no seed") ? "clock" : "fork"}</dt>
          <dd data-testid="pc-where">{card.where}</dd>
          {card.conditionsRun && (
            <>
              <dt>conditions</dt>
              <dd data-testid="pc-conditions">
                <ConditionsLine run={card.conditionsRun} />
              </dd>
            </>
          )}
          <dt>control</dt>
          <dd data-testid="pc-controls">
            {card.controlPassed ? "passed: " : ""}
            {card.controls.join("; ")}
          </dd>
          {card.warning && (
            <>
              <dt>fork events</dt>
              <dd className="notice" data-testid="pc-fork-events-warning">
                {card.warning}
              </dd>
            </>
          )}
          {card.attempts.length > 0 && (
            <>
              <dt>earlier attempts</dt>
              <dd data-testid="pc-attempts">
                {card.attempts.map((a) => (
                  <div key={a}>{a}</div>
                ))}
                <div className="muted">Not verdicts: nothing was judged on them; the same sealed bets ran above.</div>
              </dd>
            </>
          )}
        </dl>
        <ul className="pc-captions" data-testid="pc-captions" aria-label="captions">
          {card.captions.map((c) => (
            <li key={c}>{sayCaption(c)}</li>
          ))}
        </ul>
      </section>

      <section className="pc-seals" aria-label="sealed hashes">
        <p className="pc-small">Sealed before the run (hash re-computed in this browser):</p>
        <ul data-testid="pc-seals">
          {card.bets.map((b) => (
            <li key={b.betId}>
              <span className="pc-who">{bettorName(b.who, names)}</span> · {b.measures} · <span className="pc-mono">{b.sealedHash}</span> {b.sealHolds ? "✓" : "✗ does not match its fields"}
            </li>
          ))}
        </ul>
      </section>
      </details>

      <footer className="pc-foot">
        {download && (
          <a href={download} download={`${card.runId}.atlas.json`} data-testid="pc-download">
            Download {card.runId}.atlas.json
          </a>
        )}
        {!readerOnly && (
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
        )}
        {words && (
          <span className={`pc-replay${words.same ? " pc-same" : ""}`} data-testid="pc-replay">
            {words.text}
            {!words.same && call ? ` (${PASTE_WORDS.replayDiffers})` : ""}
            {replay.kind === "done" && replay.answer.replayForkBlock !== undefined ? ` · same fork block ${replay.answer.replayForkBlock}` : ""}
            {replay.kind === "done" && replay.answer.replaySeed !== undefined && replay.answer.replaySeed !== "none" ? ` · same seed ${replay.answer.replaySeed}` : ""}
          </span>
        )}
        {replay.kind === "failed" && (
          <span className="notice" data-testid="pc-replay-failed">
            replay not run: {replay.reason}
          </span>
        )}
        <a className="pc-small pc-home" href="/" data-testid="pc-home">
          Atlas: draw your own code and bet on what it does
        </a>
        <span className="pc-small muted">recorded {card.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")} · run {card.runId}</span>
      </footer>
    </article>
  );
}

/** D06-01: the change and its replay, from the file: the diff only, and the SAME bets before | after. */
function ProofChange({ file, said, names, stranger }: { file: AtlasFile; said: Record<string, string>; names: Record<string, string>; stranger: boolean }) {
  const change = file.change!;
  const replay = file.replay!;
  const before = (id: string) => file.verdicts.find((v) => v.betId === id)?.outcome;
  const after = (id: string) => replay.verdicts.find((v) => v.betId === id)?.outcome;
  const same = replay.run.runner === "ts" ? `same seed ${replay.run.seed}` : `same fork block ${replay.run.forkBlock}`;
  return (
    <section className="pc-change" aria-label="change and re-run" data-testid="pc-change">
      <h2>
        The same sealed bets, {BEFORE_LABEL.toLowerCase()} | {AFTER_LABEL.toLowerCase()}
      </h2>
      <p className="caption label" data-testid="pc-change-caption">
        {stranger ? CHANGE_CAPTION_READER : CHANGE_CAPTION}
      </p>
      {theoryCaptions(change).map((t) => (
        <p key={t} className="caption label theory" data-testid="pc-change-theory">
          {t}
        </p>
      ))}
      <p className="pc-small">
        Change proposed by {change.proposedBy.path ? changeProposer(change.proposedBy.path, change.proposedBy.model) : change.proposedBy.model} · replay {replay.run.id}, {same} · judged by src/judge.ts
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
                <td className="pc-who">{bettorName(b.who, names)}</td>
                <td>{b.measures}</td>
                <td>{said[b.id] ?? ""}</td>
                <td className={`pc-out pc-${o1 ?? "none"}`}>{o1 ? SAY[o1] : "no verdict"}</td>
                <td className={`pc-out pc-${o2 ?? "none"}`}>{o2 ? SAY[o2] : "no verdict"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {replay.passRule && change.mode && (
        <p className="pc-small" data-testid="pc-change-pass-rule-theory">
          PASS-RULE.md replay lines, in theory (about the theoretical replay, not the real proposal):
        </p>
      )}
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

/** U3 item 7: the proof card's plain words (the technical details are folded under techSummary). */
const PROOF_WORDS = {
  judged: "Judged by plain code, not by an AI",
  what: "What this card shows: each answer was sealed (locked with a fingerprint) before the code ran. Then Atlas ran the code, and plain code compared each answer with what the run measured: matched, didn't match, or can't check.",
  techSummary: "Technical details: the judge's file, the code's fingerprint (sha256), the seed, the control run and the sealed hashes",
} as const;

/** U3 item 7: a measured field's name in plain words ("calls:fetch" → "calls to fetch"). */
export function plainField(measures: string): string {
  if (measures.startsWith("calls:")) return `calls to ${measures.slice(6)}`;
  if (measures.startsWith("priceUsd1e18:")) return `${measures.slice(13)} in dollars`;
  const words: Record<string, string> = { outcome: "how it ends", returnedJson: "what it returns", virtualMs: "how long it takes", calls: "calls", totalWaitMs: "total wait" };
  return words[measures] ?? measures;
}
