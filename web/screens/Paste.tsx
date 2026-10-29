// E3: the "paste any code" flow. Paste one file → pick the function → choose a test (Muse Wonder's, edited, or
// your own) → bet (sealed) → run → verdicts, the call timeline, and the proof card.
//
// Plain words on trust, as on every other screen:
// - The questions, the description of each test and every verdict are plain code's. Muse Wonder's tests are
//   proposals: the gate decides, and a refused one is shown with its reason and never runs.
// - The bet section shows "What every bettor sees": the exact text each betting model gets (D19). Muse Wonder's
//   own sentence is not in it (D18), and the page shows that sentence only after the person's bets are sealed.
// - Nothing from a run is drawn or shown as a number when src/trust.ts says it may not be shown as fact.
// Every sentence comes from src/paste-words.ts.

import { useEffect, useRef, useState } from "react";
import type { Question } from "../../src/gate";
import { CALL_OUTCOME_OPTIONS, measuredUnit } from "../../src/units";
import { notShownAsFact } from "../../src/trust";
import { answerHow, pinsLineOf, shortQuestionFor, testJson } from "../../src/paste-context";
import { CALL_OUTCOME_SAY, PASTE_WORDS as W, WONDER_DISPLAY, languageLabel } from "../../src/paste-words";
import { didNotFinish, type Api, type ExperimentAnswer, type HumanAnswer, type PasteAnswer, type PasteLanguage, type ProposalsAnswer, type RunAnswer, type ShownBet } from "../api";
import { useModelSlots, verdictColumns } from "./Claimant";
import { ModelSlotCard } from "./ModelPanel";
import { ShortHash } from "./Bets";
import { RunDidNotFinish } from "./Run";
import { VerdictScreen } from "./Verdict";
import { ProofLink } from "./ProofCard";
import { CallTimeline } from "../machines/calltimeline/CallTimeline";
import { TestForm, emptyForm, formFromParams, type TestFormState } from "./TestForm";
import { PASTE_EXAMPLE } from "../paste-example";
import type { BetHandoff } from "./Explorer";
import { ErrorNotice } from "./ErrorNotice";
import { TrackRecordPanel } from "./TrackRecord";
import { FailureLabels, FL_WORDS } from "./FailureLabels";
import type { PasteLabelsAnswer } from "../api";

type LangChoice = "auto" | "js" | "ts" | "py";

export function PasteFlow({ api, onRoundOpen, handoff = null, onHandoffUsed }: { api: Api; onRoundOpen?: (open: boolean) => void; handoff?: BetHandoff | null; onHandoffUsed?: () => void }) {
  const [code, setCode] = useState("");
  const [langChoice, setLangChoice] = useState<LangChoice>("auto");
  const [languages, setLanguages] = useState<PasteLanguage[] | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(null);
  const [pasted, setPasted] = useState<PasteAnswer | null>(null);
  const [exportName, setExportName] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalsAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState<{ initial: TestFormState; note?: string; editedFrom?: string } | null>(null);
  const [exp, setExp] = useState<ExperimentAnswer | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [claim, setClaim] = useState<{ display: string; claim: string } | null>(null);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [running, setRunning] = useState(false);
  const [runFailed, setRunFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useModelSlots(api);
  useEffect(() => onRoundOpen?.(exp !== null && result === null), [exp, result, onRoundOpen]);
  useEffect(() => {
    let live = true;
    api.pasteLanguages().then(
      (r) => {
        if (!live) return;
        setLanguages(r.languages);
        setPrivacy(r.privacy); // E3 review r3 B1: built by the server from its own configuration
      },
      () => live && setLanguages(null),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const step = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // X2: "Bet on this part" from the explorer. The file and the function arrive here and go through exactly the
  // same steps as a paste: POST /paste reads the file (its own export scan decides), the person still picks a test,
  // the gate checks it, the bets are sealed as always. Only the paste box and the function choice are filled in.
  const [from, setFrom] = useState<{ where: string; exportName: string; found: boolean; code: string } | null>(null);
  // One POST /paste per hand-off, even when React runs the effect twice (development mode): the nonce is remembered,
  // and an answer is used only while its hand-off is still the latest.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.nonce) return;
    const nonce = handoff.nonce;
    handled.current = nonce;
    // Used once: coming back to this screen later must not paste the file again.
    onHandoffUsed?.();
    setCode(handoff.code);
    setLangChoice(handoff.language);
    setPasted(null);
    setExportName(null);
    setProposals(null);
    setForm(null);
    setRefused(null);
    setFrom({ where: handoff.from, exportName: handoff.exportName, found: false, code: handoff.code });
    setBusy(true);
    setError(null);
    api.paste(handoff.code, handoff.language).then(
      (r) => {
        if (handled.current !== nonce) return;
        setPasted(r);
        const found = r.exports.some((e) => e.name === handoff.exportName);
        if (found) setExportName(handoff.exportName);
        setFrom({ where: handoff.from, exportName: handoff.exportName, found, code: handoff.code });
        setBusy(false);
      },
      (e: Error) => {
        if (handled.current !== nonce) return;
        setError(e.message);
        setBusy(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.nonce]);
  const locked = exp !== null;
  const target = pasted?.runnable ? pasted.target : null;

  // X3 (D28): the picked function's common-failure labels, read again after every run (a run can reproduce one).
  // X3 review round 2 (D50, replacing round 1's "after the seal" rule): shown before betting; every bettor's text
  // carries the same labels (server/app.ts puts them in the bettor text).
  const [labels, setLabels] = useState<PasteLabelsAnswer | null>(null);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const labelsOpen = true;
  const labelKey = target && exportName && labelsOpen ? `${target.codeSha256}:${exportName}:${exp?.experiment.id ?? ""}:${result?.run.id ?? ""}` : null;
  useEffect(() => {
    if (!target || !exportName || !labelsOpen) {
      setLabelsError(null);
      setLabels(null);
      return;
    }
    let live = true;
    Promise.resolve().then(() => api.pasteLabels(target, exportName)).then(
      (a) => {
        if (!live) return;
        setLabels(a);
        setLabelsError(null);
      },
      (e: Error) => live && setLabelsError(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelKey, api]);

  const read = () =>
    step(async () => {
      // Review M2: "From the explorer" stays only while the box still holds exactly the handed-off file.
      if (from && code !== from.code) setFrom(null);
      setPasted(null);
      setExportName(null);
      setProposals(null);
      setForm(null);
      setRefused(null);
      const r = await api.paste(code, langChoice === "auto" ? undefined : langChoice);
      setPasted(r);
      if (r.exports.length === 1) setExportName(r.exports[0]!.name);
    });

  const askWonder = async () => {
    if (!target || !exportName) return;
    setAsking(true);
    setError(null);
    try {
      setProposals(await api.proposals(target, exportName));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const started = (out: ExperimentAnswer) => {
    setExp(out);
    setRefused(null);
    setForm(null);
    models.fromExperiment(out);
  };
  const useProposal = (id: string) =>
    step(async () => {
      if (!target) return;
      started(await api.experimentFromProposal(target, id));
    });
  const useOwn = (params: unknown) =>
    step(async () => {
      if (!target) return;
      try {
        started(await api.experiment(target, params, undefined, form?.editedFrom));
      } catch (e) {
        // The gate refused the person's test: kept on the server, shown here, never run.
        setRefused((e as Error).message);
      }
    });

  const seal = () =>
    step(async () => {
      if (!exp) return;
      const toSend: { measures: string; answer: HumanAnswer }[] = [];
      for (const q of exp.questions) {
        const raw = (answers[q.measures] ?? "").trim();
        if (raw === "") continue;
        if (q.kind === "enum") toSend.push({ measures: q.measures, answer: { kind: "enum", value: raw } });
        else if (q.kind === "json") {
          let v: unknown;
          try {
            v = JSON.parse(raw);
          } catch {
            throw new Error(W.needJson(shortQuestionFor(q.text, exp.experiment.params)));
          }
          toSend.push({ measures: q.measures, answer: { kind: "json", value: v } });
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0 || (q.kind === "integer" && !Number.isSafeInteger(n))) throw new Error(W.needNumber(shortQuestionFor(q.text, exp.experiment.params), answerHow(q)));
          toSend.push({ measures: q.measures, answer: q.kind === "integer" ? { kind: "integer", value: n } : { kind: "number", value: n } });
        }
      }
      if (toSend.length === 0) throw new Error(W.needAnswer);
      setSealed(await api.bets(exp.experiment.id, toSend));
    });

  const run = async () => {
    if (!exp) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.run(exp.experiment.id);
      models.fromRun(r);
      setRunFailed(null);
      setResult(r);
      // E3 review B2: Muse Wonder's sentence is shown only once every bet on the round is frozen (the run started).
      if (exp.experiment.proposedBy.role === "investigator" || exp.experiment.proposedBy.editedFrom) {
        api.claim(exp.experiment.id).then(
          (c) => setClaim({ display: c.display, claim: c.claim }),
          () => setClaim(null),
        );
      }
    } catch (e) {
      if (didNotFinish(e)) setRunFailed((e as Error).message);
      else setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const restart = () => {
    setFrom(null);
    setPasted(null);
    setExportName(null);
    setProposals(null);
    setForm(null);
    setExp(null);
    setRefused(null);
    setAnswers({});
    setSealed([]);
    setClaim(null);
    setResult(null);
    setRunFailed(null);
    setError(null);
  };

  const runnableLang = (l: "js" | "ts" | "py") => languages?.find((x) => x.language === l)?.runnable ?? true;
  return (
    <>
      <TrackRecordPanel api={api} refreshKey={result?.run.id ?? 0} />
      <section className="card" aria-label="paste">
        <h2>{W.heading}</h2>
        <p className="muted small">{W.intro}</p>
        <label htmlFor="paste-code">{W.codeLabel}</label>
        <textarea id="paste-code" className="paste" data-testid="paste-code" value={code} onChange={(e) => {
            setCode(e.target.value);
            setFrom(null); // review M2: edited code is no longer the explorer's file
          }} disabled={locked || busy} spellCheck={false} rows={12} />
        <div className="row">
          <label htmlFor="paste-lang">{W.languageLabel}</label>
          <select id="paste-lang" data-testid="paste-lang" value={langChoice} onChange={(e) => setLangChoice(e.target.value as LangChoice)} disabled={locked || busy}>
            <option value="auto">{W.languageAutoOption}</option>
            {(["js", "ts", "py"] as const).map((l) => (
              <option key={l} value={l}>
                {languageLabel(l, runnableLang(l))}
              </option>
            ))}
          </select>
          <button type="button" className="primary" onClick={read} disabled={locked || busy || code.trim() === ""} data-testid="paste-read">
            {W.readButton}
          </button>
          {!locked && code === "" && (
            <button type="button" onClick={() => setCode(PASTE_EXAMPLE)} data-testid="paste-example">
              {W.exampleButton}
            </button>
          )}
          {locked && (
            <button type="button" onClick={restart} data-testid="paste-restart">
              {W.restartButton}
            </button>
          )}
        </div>
        {from && (
          <p className="small" data-testid="paste-from-explorer">
            {`From the explorer: ${from.where}, function ${from.exportName}.`}
            {pasted && !from.found ? ` The paste reader found no export named ${from.exportName} in this file, so pick one below.` : ""}
          </p>
        )}
        {privacy && (
          <p className="muted small" data-testid="paste-privacy">
            {privacy}
          </p>
        )}
        {pasted && (
          <div data-testid="paste-read-result">
            <p className="small">
              {pasted.language.chosenBy === "person" ? W.languageYouChose(langName(pasted.language.chosen)) : `${W.languageAuto(langName(pasted.language.chosen))} (${pasted.language.why}).`} {W.linesAndPrint(pasted.lines)}{" "}
              <ShortHash hash={pasted.target.codeSha256} />
            </p>
            {!pasted.runnable && (
              <p className="notice" data-testid="paste-not-runnable">
                {pasted.reason}
              </p>
            )}
            {pasted.cantCheck && (
              <p className="notice" data-testid="paste-cant-check">
                {W.cantCheckEarly(pasted.cantCheck)}
              </p>
            )}
          </div>
        )}
      </section>

      {target && pasted && (
        <section className="card" aria-label="pick a function">
          <h2>{W.exportsHeading}</h2>
          {pasted.exports.length === 0 ? (
            <p className="notice">{W.noExports}</p>
          ) : (
            <fieldset disabled={locked || busy}>
              <legend className="muted small">{W.exportsFound}</legend>
              {pasted.exports.map((e) => (
                <label key={e.name} className="choice">
                  <input type="radio" name="export" value={e.name} checked={exportName === e.name} onChange={() => setExportName(e.name)} data-testid={`export-${e.name}`} />
                  {W.exportLine(e.name, e.line, e.declaredAs)}
                </label>
              ))}
            </fieldset>
          )}
        </section>
      )}

      {target && exportName && labelsOpen && (labels || labelsError) && (
        <section className="card" aria-label={FL_WORDS.heading} data-testid="paste-failure-labels">
          <h2>{FL_WORDS.heading}</h2>
          <p className="small">{`For ${exportName}.`}</p>
          {labels ? <FailureLabels answer={labels} idPrefix="paste" /> : <p className="muted small">{`The labels could not be read: ${labelsError}`}</p>}
        </section>
      )}

      {target && exportName && (
        <section className="card" aria-label="choose a test">
          <h2>{W.proposalsHeading}</h2>
          {!locked && (
            <div className="row">
              <button type="button" className="primary" onClick={askWonder} disabled={asking || busy || proposals !== null} data-testid="ask-wonder">
                {W.askWonder}
              </button>
              <button type="button" onClick={() => setForm({ initial: emptyForm() })} disabled={busy} data-testid="write-own">
                {W.writeOwn}
              </button>
            </div>
          )}
          {asking && (
            <p className="running" role="status">
              {W.wonderThinking(WONDER_DISPLAY)}
            </p>
          )}
          {proposals && <Proposals p={proposals} locked={locked} busy={busy} onUse={useProposal} onEdit={(id, params) => setForm({ initial: formFromParams(params), note: W.proposalEditedNote, editedFrom: id })} claim={claim} />}
          {!locked && form && <TestForm key={JSON.stringify(form.initial)} exportName={exportName} initial={form.initial} onSubmit={useOwn} busy={busy} {...(form.note ? { note: form.note } : {})} />}
          {refused && (
            <p className="notice" role="alert" data-testid="own-test-refused">
              {refused}
            </p>
          )}
          {exp && (
            <p className="small" data-testid="chosen-test">
              {W.chosenTest(exp.experiment.id, exp.experiment.proposedBy.editedFrom ? W.writtenByEdited(exp.experiment.proposedBy.editedFrom.proposalId) : exp.experiment.proposedBy.role === "human" ? W.writtenByYou : WONDER_DISPLAY)}
              {exp.repeatOf && (
                <span className="label" data-testid="repeat-note">
                  {" "}
                  {W.repeatNote(exp.repeatOf)}
                </span>
              )}
            </p>
          )}
        </section>
      )}

      {exp && (
        <section className="card" aria-label="bet">
          <h2>{W.betsHeading}</h2>
          <p className="muted small">{W.betsIntro}</p>
          {/* R1 review round 2 (M1): the pins, always visible, the same bytes as in the bettor text below. */}
          <p className="small" data-testid="pins-sentence">
            {pinsLineOf(exp.seenContext, exp.experiment.target.language ?? "js")}
          </p>
          {exp.seenContext !== undefined && (
            <details className="seen" data-testid="seen-context">
              <summary>{W.seenHeading}</summary>
              <p className="muted small">{W.seenNote(models.slots.filter((s) => s.status !== "off").map((s) => s.display).join(" and ") || "The betting models", Math.max(1, models.slots.filter((s) => s.status !== "off").length))}</p>
              <pre className="code seen-text" data-scroll-x="" tabIndex={0} aria-label={W.seenHeading}>
                {exp.seenContext}
              </pre>
            </details>
          )}
          <fieldset disabled={sealed.length > 0 || busy}>
            {exp.questions.map((q) => (
              <div key={q.measures} className="question">
                <label htmlFor={`bet-${q.measures}`}>{shortQuestionFor(q.text, exp.experiment.params)}</label>
                <QuestionInput q={q} value={answers[q.measures] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [q.measures]: v }))} />
                <p className="muted small">
                  {answerHow(q)}
                  {sealed.find((b) => b.measures === q.measures) && (
                    <>
                      {" "}
                      · sealed, hash <ShortHash hash={sealed.find((b) => b.measures === q.measures)!.sealedHash} testId={`hash-${q.measures}`} />
                    </>
                  )}
                </p>
              </div>
            ))}
          </fieldset>
          {sealed.length === 0 && (
            <button type="button" className="primary" onClick={seal} disabled={busy} data-testid="seal">
              {W.sealButton}
            </button>
          )}
        </section>
      )}

      {exp && models.slots.map((slot) => <ModelSlotCard key={slot.who} slot={slot} revealed={result ? result.bets.filter((b) => b.who === slot.who) : null} />)}

      {exp && (
        <section className="card" aria-label="run">
          <h2>{W.runHeading}</h2>
          {!result && runFailed === null && (
            <button type="button" className="primary" onClick={run} disabled={sealed.length === 0 || running || models.thinking} data-testid="run">
              {W.runButton}
            </button>
          )}
          {!result && runFailed !== null && !running && <RunDidNotFinish message={runFailed} onRetry={run} disabled={sealed.length === 0} />}
          {running && (
            <p className="running" role="status">
              {W.running}
            </p>
          )}
          {result && <RunFacts result={result} />}
          {result && <CallTimeline run={result.run} />}
        </section>
      )}

      {result && exp && <VerdictScreen shown={sealed} typed={answers} modelShown={[]} modelName={null} models={verdictColumns(models.slots)} result={result} questionText={(q) => shortQuestionFor(q, exp.experiment.params)} heading={W.verdictHeading} />}
      {result?.proof && !result.proof.ok && (
        // E3 review r3 M1: never silent. The verdicts above say whether they stand.
        <section className="card" aria-label="proof card">
          <h2>{W.proofHeading}</h2>
          <p className="notice" data-testid="proof-missing">
            {W.proofMissing(result.proof.reason)}
          </p>
        </section>
      )}
      {result?.proof?.ok && (
        <section className="card" aria-label="proof card">
          <h2>{W.proofHeading}</h2>
          <ProofLink runId={result.proof.runId} />
        </section>
      )}
      {error && <ErrorNotice message={error} />}
    </>
  );
}

const langName = (l: "js" | "ts" | "py") => (l === "js" ? "JavaScript" : l === "ts" ? "TypeScript" : "Python");

function QuestionInput({ q, value, onChange }: { q: Question; value: string; onChange: (v: string) => void }) {
  const id = `bet-${q.measures}`;
  if (q.kind === "enum") {
    return (
      <select id={id} data-testid={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{W.skipOption}</option>
        {(q.options ?? CALL_OUTCOME_OPTIONS).map((o) => (
          <option key={o} value={o}>
            {CALL_OUTCOME_SAY[o] ? `${o}: ${CALL_OUTCOME_SAY[o]}` : o}
          </option>
        ))}
      </select>
    );
  }
  if (q.kind === "json") return <textarea id={id} data-testid={id} className="paste small-area" value={value} onChange={(e) => onChange(e.target.value)} rows={2} spellCheck={false} placeholder='{"ok": true}' />;
  return <input id={id} data-testid={id} type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Proposals({ p, locked, busy, onUse, onEdit, claim }: { p: ProposalsAnswer; locked: boolean; busy: boolean; onUse: (id: string) => void; onEdit: (id: string, params: unknown) => void; claim: { display: string; claim: string } | null }) {
  return (
    <div className="model-panel" data-testid="proposals" aria-label="Muse Wonder's proposed tests">
      <p className="small">
        <b>{p.display}</b> {W.proposedCount(p.proposals.length)}
        {p.usage ? ` · ${p.usage.promptTokens.toLocaleString("en-US")} + ${p.usage.completionTokens.toLocaleString("en-US")} tokens, $${p.usage.usd.toFixed(4)}` : ""}
      </p>
      {!p.ok && p.reason && <p className="notice">{`${p.display}: ${p.reason}`}</p>}
      {p.aimedAt ? (
        <p className="muted small" data-testid="wonder-aimed">
          {`${p.display} was told only this about your earlier rounds (plain code's counts from your track record, no code): ${p.aimedAt}`}
        </p>
      ) : null}
      <ol className="proposals">
        {p.proposals.map((x, i) => (
          <li key={x.id} data-testid={`proposal-${i}`} data-allowed={x.gate.allowed ? "yes" : "no"}>
            {x.gate.allowed ? (
              <>
                <p>{x.says}</p>
                <p className="small ok">{W.proposalAllowed}</p>
                {!locked && (
                  <div className="row">
                    <button type="button" className="primary" onClick={() => onUse(x.id)} disabled={busy} data-testid={`use-${i}`}>
                      {W.useProposal}
                    </button>
                    <button type="button" onClick={() => onEdit(x.id, x.params)} disabled={busy}>
                      {W.editProposal}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="notice small" data-testid={`refused-${i}`}>
                {W.proposalRefused(x.gate.reason)}
              </p>
            )}
            <details>
              <summary className="small">{W.testAsJson}</summary>
              <pre className="code" data-scroll-x="" tabIndex={0} aria-label={W.testAsJson}>
                {testJson(x.params)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
      {p.claimHeld && !claim && <p className="muted small">{W.claimHidden}</p>}
      {claim && (
        <p className="small" data-testid="wonder-claim">
          {W.claimLabel(claim.display)} <q>{claim.claim}</q>
        </p>
      )}
    </div>
  );
}

/** What the run measured, field by field, with the can't-check reasons. Nothing is shown when the run may not be shown as fact. */
function RunFacts({ result }: { result: RunAnswer }) {
  const run = result.run;
  const notShown = notShownAsFact(run);
  const whole = run.result.notMeasured.wholeRun;
  if (notShown !== null) {
    return (
      <div data-testid="paste-run-facts">
        <p className="notice" data-testid="paste-cant-check-run">
          {run.controlPassed !== true ? W.controlNotPassed(run.result.notMeasured.control ?? "no reason recorded") : typeof whole === "string" ? W.wholeRunCantCheck(whole) : notShown}
        </p>
        <p className="muted small">{W.runNotShown(run.id)}</p>
      </div>
    );
  }
  const m = run.result.measured;
  const nm = run.result.notMeasured;
  const fields = [...new Set([...Object.keys(m), ...Object.keys(nm)])].filter((k) => k !== "control");
  return (
    <div data-testid="paste-run-facts">
      <h3>{W.factsHeading}</h3>
      <p className="muted small">
        {W.runLine(run.id, run.controlPassed === true, run.executor)}
      </p>
      <table className="verdicts facts-table">
        <thead>
          <tr>
            <th>{W.factField}</th>
            <th>{W.factValue}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((k) => (
            <tr key={k} data-testid={`fact-${k}`}>
              <td>
                <code>{k}</code>
              </td>
              <td>
                {Object.prototype.hasOwnProperty.call(m, k) ? String(m[k]) : <span className="muted">{W.factCantCheck(nm[k] ?? "")}</span>}
                {Object.prototype.hasOwnProperty.call(m, k) && measuredUnit(k) === undefined && <div className="muted small">{W.noUnit}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
