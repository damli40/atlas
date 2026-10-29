// U1 (D47/D48): the drawing-first screen. One entry (paste, upload or a GitHub folder) → a full-screen drawing of how
// the code is built → an optional "Bet on your understanding" pop-up with a quiz → the run plays on the same drawing
// and every answer is marked there.
//
// Plain words on trust, as on every screen:
// - The drawing before betting comes from plain code's outline of the file and, once a test is chosen, from the test
//   itself (its stand-ins and their scripted answers). It never shows a run result: no run exists until the bets are
//   sealed, and the stage is given run data only after that (BenchStage's `after`).
// - The quiz options are plain code's (src/quiz.ts), the same for the person and every model (D19: the "what every
//   bettor sees" text lists them, and the models' prompt is that text).
// - Muse Wonder's test is a proposal: the gate decides. Its claim sentence is shown only after the run (D18).
// - Verdicts are plain code's (src/judge.ts): matched / didn't match / can't check.

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import type { Question } from "../../src/gate";
import { shortQuestionFor, pinsLineOf } from "../../src/paste-context";
import { CANT_TELL, timeOptions } from "../../src/quiz";
import { WONDER_DISPLAY } from "../../src/paste-words";
import type { ClaimantMode } from "../../src/claimants";
import { didNotFinish, type Api, type ExperimentAnswer, type HumanAnswer, type PasteAnswer, type ProposalsAnswer, type RunAnswer, type ShownBet } from "../api";
import { useModelSlots } from "./Claimant";
import { ErrorNotice } from "./ErrorNotice";
import { TestForm, emptyForm, formFromParams, type TestFormState } from "./TestForm";
import { BenchStage, type After } from "../machines/bench/BenchStage";
import { benchModel, dialFullMs, type CallTest } from "../machines/bench/model";
import { marksOf, playScript } from "../machines/bench/play";
import type { FileOutline } from "../../src/file-outline";
import { U1_EXAMPLE } from "../u1-example";
import { plural } from "../../src/words";
import type { BetHandoff } from "./Explorer";
import type { PasteLabelsAnswer } from "../api";
import { lineSpan } from "../../src/words";

type Lang = "js" | "ts" | "py";
const FILE_NAME: Record<Lang, string> = { js: "pasted.js", ts: "pasted.ts", py: "pasted.py" };

/** The function drawn as "under test" by default: the exported function with the most calls out, then the first. */
export function defaultFunction(outline: FileOutline | undefined, exports: readonly { name: string }[]): string | null {
  const names = new Set(exports.map((e) => e.name));
  const fns = (outline?.parts ?? []).filter((p) => p.kind === "function" && names.has(p.name));
  if (fns.length === 0) return exports[0]?.name ?? null;
  const out = (n: string) => outline!.joins.filter((j) => j.from === n).length;
  return [...fns].sort((a, b) => out(b.name) - out(a.name) || a.lineStart - b.lineStart)[0]!.name;
}

/** The answers the page sends: a tap is a quiz answer; an untouched question or "can't tell" is declined. */
export function answersToSend(questions: readonly Question[], picked: Record<string, string>): { measures: string; answer: HumanAnswer }[] {
  return questions.map((q) => {
    const c = picked[q.measures];
    return { measures: q.measures, answer: c && c !== CANT_TELL ? { kind: "quiz", choice: c } : { kind: "declined", reason: CANT_TELL } };
  });
}

export interface StudioProps {
  api: Api;
  /** "Upload files" with more than one file, or a GitHub folder: the code explorer (X2), full screen. */
  onExplore: (start?: { repo?: string; files?: FileList }) => void;
  /** From the explorer's "Bet on this part": the file and the function. */
  handoff?: BetHandoff | null;
  onHandoffUsed?: () => void;
  onRoundOpen?: (open: boolean) => void;
  claimant: ClaimantMode;
  onClaimant: (m: ClaimantMode) => void;
}

export function Studio({ api, onExplore, handoff = null, onHandoffUsed, onRoundOpen, claimant, onClaimant }: StudioProps) {
  const [code, setCode] = useState("");
  const [lang, setLang] = useState<Lang | "auto">("auto");
  const [pasted, setPasted] = useState<PasteAnswer | null>(null);
  const [fn, setFn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [proposals, setProposals] = useState<ProposalsAnswer | null>(null);
  const [exp, setExp] = useState<ExperimentAnswer | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState<{ initial: TestFormState; editedFrom?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plays, setPlays] = useState(0);
  const [repo, setRepo] = useState("");
  const models = useModelSlots(api);
  const runStarted = useRef(false);
  // Review M1: every async answer belongs to one round. reset() starts a new round, and a late answer from an older one
  // (Wonder's tests, an experiment, a run) is dropped instead of landing on the new drawing.
  const gen = useRef(0);
  const [runTry, setRunTry] = useState(0);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => onRoundOpen?.(exp !== null && result === null), [exp, result, onRoundOpen]);

  const target = pasted?.runnable ? pasted.target : null;
  const test = exp?.experiment.gate.allowed ? (exp.experiment.params as CallTest) : null;
  const marks = useMemo(() => (test ? timeOptions(test).flatMap((o) => (o.match.kind === "ms" && o.match.min > 0 ? [o.match.min] : o.match.kind === "ms" && o.match.max ? [o.match.max] : [])) : []), [test]);
  const fullMs = useMemo(() => dialFullMs(marks), [marks]);
  const model = useMemo(
    () => (pasted?.outline ? benchModel({ fileName: FILE_NAME[pasted.target.language ?? "ts"], outline: pasted.outline, test: test ? test : null, dial: { marks: [...new Set(marks)], fullMs } }) : null),
    [pasted, test, marks, fullMs],
  );
  // Mark the function under test even before a test exists (it is lit on the drawing).
  const shownModel = useMemo(() => (model && !model.tested && fn ? { ...model, tested: fn } : model), [model, fn]);

  // X3 (D28) + review round 2 (D50): plain code's failure labels for the function, drawn on the parts BEFORE betting
  // (every bettor's text carries the same labels). Read again after each run (a run can reproduce one). Only labels
  // plain code claims ("found in this code", "reproduced", "inconclusive") become marks; "common pattern" ones stay in
  // the bettor text, where they are said to be Atlas's list only.
  const [labels, setLabels] = useState<PasteLabelsAnswer | null>(null);
  useEffect(() => {
    if (!target || !fn) {
      setLabels(null);
      return;
    }
    let live = true;
    Promise.resolve()
      .then(() => api.pasteLabels(target, fn))
      .then(
        (a) => live && setLabels(a),
        () => live && setLabels(null),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, target?.codeSha256, fn, result?.run.id]);
  const labelMarks = useMemo(() => {
    if (!labels || !pasted?.outline) return [];
    const partAt = (line: number) => pasted.outline!.parts.find((p) => p.lineStart <= line && line <= p.lineEnd)?.name ?? fn ?? "";
    return labels.labels
      .filter((l) => l.label !== "common pattern")
      .map((l) => ({ anchor: partAt(l.lines?.[0]?.lineStart ?? 0), text: `${l.label}: ${l.name}${l.lines?.[0] ? `, ${lineSpan(l.lines[0].lineStart, l.lines[0].lineEnd)}` : ""}` }));
  }, [labels, pasted, fn]);

  const reset = () => {
    setProposals(null);
    setExp(null);
    setPicked({});
    setSealed([]);
    setResult(null);
    setClaim(null);
    setChanging(false);
    setForm(null);
    setError(null);
    runStarted.current = false;
    gen.current++;
  };

  const read = useCallback(
    async (text: string, language?: Lang, want?: string, from?: string) => {
      if (text.trim() === "") return;
      reset();
      const g = gen.current;
      setPasted(null);
      setHandoffNote(null);
      setSource(from ?? null);
      setBusy("Reading your code…");
      try {
        const r = await api.paste(text, language);
        if (g !== gen.current) return;
        setPasted(r);
        // Review M4: a function the explorer named that this file does not export is said plainly, never swapped silently.
        if (want && !r.exports.some((e) => e.name === want)) {
          setHandoffNote(`${want} is not exported by this file, and Atlas can only call exported functions. Pick one on the drawing.`);
          setFn(null);
        } else setFn(want ?? defaultFunction(r.outline, r.exports));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  // X2's "Bet on this part": the explorer hands one file and one function to this screen.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.nonce) return;
    handled.current = handoff.nonce;
    onHandoffUsed?.();
    setCode(handoff.code);
    setLang(handoff.language);
    void read(handoff.code, handoff.language, handoff.exportName, handoff.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.nonce]);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // The drawing comes first: pasted code is read at once (no button to press).
    const text = e.clipboardData.getData("text");
    if (text.trim() === "" || code.trim() !== "") return;
    e.preventDefault();
    setCode(text);
    void read(text, lang === "auto" ? undefined : lang);
  };

  // ---- the bet pop-up ----
  const start = async (make: () => Promise<ExperimentAnswer>) => {
    const g = gen.current;
    setBusy("Getting the questions ready…");
    setError(null);
    try {
      const out = await make();
      if (g !== gen.current) return;
      setExp(out);
      setPicked({});
      setChanging(false);
      setForm(null);
      models.fromExperiment(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const openBet = async () => {
    const next = !open;
    setOpen(next);
    if (next && proposals && !exp) setChanging(true); // proposals came back but no test is in use: show the list
    if (!next || !target || !fn || exp || proposals) return;
    setBusy(`${WONDER_DISPLAY} is writing a test for ${fn}…`);
    setError(null);
    const g = gen.current;
    try {
      const p = await api.proposals(target, fn);
      if (g !== gen.current) return;
      setProposals(p);
      const first = p.proposals.find((x) => x.gate.allowed);
      if (first) await start(() => api.experimentFromProposal(target, first.id, { quiz: true }));
      else setChanging(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const chooseFunction = (name: string) => {
    if (sealed.length > 0) return;
    reset();
    setOpen(false); // the next "Bet on your understanding" asks Wonder about the new function
    setFn(name);
  };

  const seal = async () => {
    if (!exp) return;
    setBusy("Sealing your answers…");
    setError(null);
    try {
      setSealed(await api.bets(exp.experiment.id, answersToSend(exp.questions, picked)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // After sealing: wait for the models' sealed answers, then run (no extra click).
  useEffect(() => {
    if (!exp || sealed.length === 0 || result || models.thinking || runStarted.current) return;
    runStarted.current = true;
    const g = gen.current;
    setBusy("Running the test…");
    api.run(exp.experiment.id).then(
      (r) => {
        if (g !== gen.current) return;
        models.fromRun(r);
        setResult(r);
        setPlays((n) => n + 1);
        setOpen(false);
        setBusy(null);
        if (exp.experiment.proposedBy.role === "investigator" || exp.experiment.proposedBy.editedFrom) api.claim(exp.experiment.id).then((c) => setClaim(c.claim), () => setClaim(null));
      },
      (e: Error) => {
        if (g !== gen.current) return;
        runStarted.current = false;
        setBusy(null);
        setError(didNotFinish(e) ? `The run did not finish: ${e.message}` : e.message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, sealed, result, models.thinking, runTry]);

  const after: After | null = useMemo(() => {
    // D47: run data only after the bets are sealed, and only the run of THIS round's test (review M1).
    if (!result || !exp || !test || sealed.length === 0 || result.run.experimentId !== exp.experiment.id) return null;
    const tested = model?.tested ?? null;
    return { token: plays, script: playScript(result.run, test, tested), marks: marksOf(exp.questions, result.bets, result.verdicts, result.run, tested), dialFullMs: fullMs };
  }, [result, exp, test, sealed, plays, model, fullMs]);

  // ---- entry ----
  if (!pasted) {
    return (
      <section className="u1-entry" aria-labelledby="u1-entry-h">
        <h1 id="u1-entry-h">See how your code is built</h1>
        <p className="u1-lede">Paste one file. Atlas draws its functions and how they call each other. Then, if you like, test your understanding against a real run.</p>
        <label htmlFor="u1-code" className="u1-sr">
          Your code
        </label>
        <textarea id="u1-code" className="u1-code" data-testid="u1-code" value={code} onChange={(e) => setCode(e.target.value)} onPaste={onPaste} placeholder="Paste a JavaScript, TypeScript or Python file here" spellCheck={false} rows={10} disabled={busy !== null} />
        <div className="u1-entry-row">
          <button type="button" className="u1-btn u1-primary" onClick={() => read(code, lang === "auto" ? undefined : lang)} disabled={busy !== null || code.trim() === ""} data-testid="u1-draw">
            Draw it
          </button>
          <label className="u1-inline">
            <span className="u1-sr">Language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang | "auto")} aria-label="Language" data-testid="u1-lang">
              <option value="auto">Guess the language</option>
              <option value="ts">TypeScript</option>
              <option value="js">JavaScript</option>
              <option value="py">Python</option>
            </select>
          </label>
          <button
            type="button"
            className="u1-link"
            onClick={() => {
              setCode(U1_EXAMPLE);
              void read(U1_EXAMPLE, "ts");
            }}
            disabled={busy !== null}
            data-testid="u1-example"
          >
            Try an example
          </button>
        </div>
        <div className="u1-entry-or">
          <label className="u1-file">
            <span>Upload files</span>
            <input
              type="file"
              multiple
              accept=".js,.mjs,.cjs,.jsx,.ts,.tsx,.mts,.cts,.py,.json"
              data-testid="u1-upload"
              onChange={async (e) => {
                const list = e.target.files;
                if (!list || list.length === 0) return;
                if (list.length === 1) {
                  const text = await list[0]!.text();
                  setCode(text);
                  void read(text, /\.py$/.test(list[0]!.name) ? "py" : /\.(m|c)?jsx?$/.test(list[0]!.name) ? "js" : /\.(m|c)?tsx?$/.test(list[0]!.name) ? "ts" : undefined);
                } else onExplore({ files: list });
              }}
            />
          </label>
          <form
            className="u1-gh"
            onSubmit={(e) => {
              e.preventDefault();
              onExplore({ repo: repo.trim() });
            }}
          >
            <label htmlFor="u1-repo">A GitHub folder</label>
            <input id="u1-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo or a folder link" data-testid="u1-repo" />
            <button type="submit" className="u1-btn" disabled={repo.trim() === ""}>
              Draw the codebase
            </button>
          </form>
        </div>
        {busy && (
          <p className="u1-status" role="status">
            {busy}
          </p>
        )}
        {error && <ErrorNotice message={error} />}
      </section>
    );
  }

  // ---- the drawing ----
  const notRunnable = !pasted.runnable ? (pasted.reason ?? "Atlas cannot run this language here yet.") : pasted.cantCheck;
  const allowed = proposals?.proposals.filter((p) => p.gate.allowed) ?? [];
  const chosenSays = exp ? allowed.find((p) => p.params && JSON.stringify(p.params) === JSON.stringify(exp.experiment.params))?.says : undefined;
  const title = `${source ?? FILE_NAME[pasted.target.language ?? "ts"]} · ${plural(pasted.lines, "line")}`;
  return (
    <div className="u1-studio">
      {shownModel ? (
        <BenchStage
          model={shownModel}
          after={after}
          extraMarks={labelMarks}
          title={title}
          side={open}
          footnote={
            claim ? (
              <p className="u1-claim" data-testid="u1-claim">
                <span className="u1-k">{`${WONDER_DISPLAY} said, before the run:`}</span> <q>{claim}</q>
              </p>
            ) : null
          }
          {...(!sealed.length ? { onTestFunction: chooseFunction } : {})}
        >
          {after && (
            <div className="u1-actions" data-testid="u1-actions">
              <button type="button" className="u1-btn" onClick={() => setPlays((n) => n + 1)} data-testid="u1-replay">
                Play the run again
              </button>
              {result?.proof?.ok ? (
                <a className="u1-btn" href={`?proof=${encodeURIComponent(result.proof.runId)}`} target="_blank" rel="noreferrer" data-testid="u1-proof">
                  Proof card
                </a>
              ) : result?.proof ? (
                <span className="u1-sub">{`No proof card: ${result.proof.ok ? "" : result.proof.reason}`}</span>
              ) : null}
              <button
                type="button"
                className="u1-btn"
                onClick={() => {
                  reset();
                  setOpen(true);
                  void (async () => {
                    if (!target || !fn) return;
                    setBusy(`${WONDER_DISPLAY} is writing a test for ${fn}…`);
                    const g = gen.current;
                    try {
                      const p = await api.proposals(target, fn);
                      if (g !== gen.current) return;
                      setProposals(p);
                      setChanging(true);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
                data-testid="u1-again"
              >
                Bet on another test
              </button>
            </div>
          )}
        </BenchStage>
      ) : null}

      <div className="u1-topbar">
        <button
          type="button"
          className="u1-link"
          onClick={() => {
            reset();
            setPasted(null);
            setCode("");
            setFn(null);
            setOpen(false);
          }}
          data-testid="u1-new"
        >
          New code
        </button>
      </div>

      {handoffNote && (
        <p className="u1-banner" role="note" data-testid="u1-handoff-note">
          {handoffNote}
        </p>
      )}
      {notRunnable && (
        <p className="u1-banner" role="note" data-testid="u1-cant-run">
          {notRunnable}
        </p>
      )}

      {!notRunnable && fn && !after && (
        <div className="u1-bet">
          <button type="button" className="u1-btn u1-primary u1-toggle" aria-expanded={open} aria-controls="u1-pop" onClick={openBet} data-testid="u1-bet-toggle">
            {open ? "Hide the bet" : "Bet on your understanding"}
          </button>
          {open && (
            <section id="u1-pop" className="u1-pop" aria-label="Bet on your understanding" data-testid="u1-pop">
              {!exp && !changing && busy && (
                <p className="u1-status" role="status">
                  {busy}
                </p>
              )}
              {exp && !changing && (
                <>
                  <p className="u1-test" data-testid="u1-test">
                    <span className="u1-k">The test:</span> {chosenSays ?? exp.experiment.params.shape}
                  </p>
                  {sealed.length === 0 && (
                    <button type="button" className="u1-link" onClick={() => setChanging(true)} data-testid="u1-change">
                      change test
                    </button>
                  )}
                  <p className="u1-pins-line">{pinsLineOf(exp.seenContext, exp.experiment.target.language ?? "js")}</p>
                  <ol className="u1-quiz">
                    {exp.questions.map((q) => (
                      <li key={q.measures}>
                        <p className="u1-q" id={`q-${q.measures}`}>
                          {shortQuestionFor(q.text, exp.experiment.params)}
                        </p>
                        <div className="u1-opts" role="radiogroup" aria-labelledby={`q-${q.measures}`}>
                          {[...(q.quiz ?? []).map((o) => ({ id: o.id, label: o.label })), { id: CANT_TELL, label: CANT_TELL }].map((o) => (
                            <button
                              type="button"
                              role="radio"
                              key={o.id}
                              className="u1-opt"
                              aria-checked={(picked[q.measures] ?? "") === o.id}
                              disabled={sealed.length > 0 || busy !== null}
                              onClick={() => setPicked((p) => ({ ...p, [q.measures]: o.id }))}
                              data-testid={`opt-${q.measures}-${o.id}`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {sealed.length === 0 ? (
                    <>
                      <button type="button" className="u1-btn u1-primary" onClick={seal} disabled={busy !== null} data-testid="u1-seal">
                        Seal my answers
                      </button>
                      <p className="u1-sub">Anything you leave untapped is sealed as “can't tell”.</p>
                    </>
                  ) : (
                    <p className="u1-status" role="status" data-testid="u1-sealed">
                      {`Sealed ${plural(sealed.length, "answer")}. ${busy ?? (models.thinking ? "Waiting for the models to seal theirs…" : "")}`}
                    </p>
                  )}
                  {sealed.length > 0 && !result && error && !busy && (
                    <button type="button" className="u1-btn" onClick={() => setRunTry((n) => n + 1)} data-testid="u1-run-again">
                      Run it again
                    </button>
                  )}
                  <ModelsLine
                    slots={models.slots}
                    claimant={claimant}
                    locked={sealed.length > 0 || busy !== null}
                    onClaimant={(m) => {
                      // Review m7: who bets is chosen per test, so a change asks again on the same test.
                      onClaimant(m);
                      const same = (proposals?.proposals ?? []).find((p) => p.gate.allowed && JSON.stringify(p.params) === JSON.stringify(exp.experiment.params));
                      if (target) {
                        const params = exp.experiment.params;
                        const editedFrom = exp.experiment.proposedBy.editedFrom?.proposalId;
                        reset();
                        if (same && exp.experiment.proposedBy.role === "investigator") void start(() => api.experimentFromProposal(target, same.id, { quiz: true }));
                        else void start(() => api.experiment(target, params, undefined, editedFrom, { quiz: true }));
                        setProposals(proposals);
                      }
                    }}
                  />
                  {exp.seenContext && (
                    <details className="u1-seen">
                      <summary>What every bettor sees</summary>
                      <pre tabIndex={0} aria-label="What every bettor sees" data-scroll-x="">
                        {exp.seenContext}
                      </pre>
                    </details>
                  )}
                </>
              )}
              {changing && target && fn && (
                <div data-testid="u1-tests">
                  <p className="u1-k">{`Pick a test for ${fn}`}</p>
                  {busy && (
                    <p className="u1-status" role="status">
                      {busy}
                    </p>
                  )}
                  <ul className="u1-testlist">
                    {(proposals?.proposals ?? []).map((p, i) => (
                      <li key={p.id}>
                        {p.gate.allowed ? (
                          <>
                            <span>{p.says}</span>{" "}
                            <button type="button" className="u1-link" onClick={() => start(() => api.experimentFromProposal(target, p.id, { quiz: true }))} disabled={busy !== null} data-testid={`u1-use-${i}`}>
                              Use this test
                            </button>{" "}
                            <button type="button" className="u1-link" onClick={() => setForm({ initial: formFromParams(p.params), editedFrom: p.id })}>
                              Edit
                            </button>
                          </>
                        ) : (
                          <span className="u1-sub">{`${WONDER_DISPLAY}'s test ${i + 1} was refused by the gate: ${p.gate.reason}`}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="u1-link" onClick={() => setForm({ initial: emptyForm() })}>
                    Write your own test
                  </button>
                  {form && <TestForm key={JSON.stringify(form.initial)} exportName={fn} initial={form.initial} busy={busy !== null} onSubmit={(params) => start(() => api.experiment(target, params, undefined, form.editedFrom, { quiz: true }))} />}
                  {exp && (
                    <button type="button" className="u1-link" onClick={() => setChanging(false)}>
                      Back to the quiz
                    </button>
                  )}
                </div>
              )}
              {error && <ErrorNotice message={error} />}
            </section>
          )}
        </div>
      )}
      {after === null && result === null && busy && !open && (
        <p className="u1-toast" role="status">
          {busy}
        </p>
      )}
      {!open && error && (
        <div className="u1-toast">
          <ErrorNotice message={error} />
        </div>
      )}
    </div>
  );
}

function ModelsLine({ slots, claimant, onClaimant, locked }: { slots: ReturnType<typeof useModelSlots>["slots"]; claimant: ClaimantMode; onClaimant: (m: ClaimantMode) => void; locked: boolean }) {
  const on = slots.filter((s) => s.status !== "off");
  return (
    <p className="u1-sub" data-testid="u1-models">
      {on.length
        ? `${on.map((s) => `${s.display}: ${s.status === "thinking" ? "answering" : s.status === "sealed" ? "sealed" : s.status === "no_usable_answer" ? "no usable answer" : s.status}`).join(" · ")}. They answer the same options, without seeing yours.`
        : "No model bets on this test."}
      {!locked && (
        <select className="u1-who-bets" value={claimant} onChange={(e) => onClaimant(e.target.value as ClaimantMode)} aria-label="Who bets with you">
          <option value="spark">Muse Spark</option>
          <option value="spark-open">Muse Spark Open</option>
          <option value="both">Both</option>
        </select>
      )}
    </p>
  );
}
