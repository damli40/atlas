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
import { literal, parseTyped } from "../../src/literal";
import { WONDER_DISPLAY, BET_WORDS, RESULT_WORDS, STAGE_WORDS, betterByRole } from "../../src/paste-words";
import type { Mark } from "../machines/bench/play";
import { pickDefaultTest, type CodeContext } from "../../src/default-test";
import { LIBRARY_WORDS } from "../../src/network-fake";
import { CALL_DEFAULT_WATCH_LIMIT_MS } from "../../src/gate";
import { ProofCardPage } from "./ProofCard";
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

/** U2 (D53): the plain-code rule's pick among the allowed proposals (src/default-test.ts), or undefined. */
export function defaultProposal<P extends { gate: { allowed: boolean }; params: unknown }>(proposals: readonly P[], code?: CodeContext): P | undefined {
  const allowed = proposals.filter((p) => p.gate.allowed);
  // U3: the rule prefers a test that hits an edge, read from the file's text (a second call on a cache, the Nth failure).
  const i = pickDefaultTest(allowed.map((p) => p.params as CallTest), code);
  return i >= 0 ? allowed[i] : undefined;
}

/** U2: the code boxes whose own lines wait (a timer or a sleep), read from the file's text by plain code. */
export function waitingParts(source: string, outline: FileOutline | undefined): string[] {
  if (!outline) return [];
  const lines = source.split(/\r\n|\r|\n/);
  const WAIT = /\b(setTimeout|setInterval|sleep|asyncio\.sleep|time\.sleep|wait_for|delay)\b/;
  return outline.parts.filter((p) => WAIT.test(lines.slice(p.lineStart - 1, p.lineEnd).join("\n"))).map((p) => p.name);
}

/**
 * The answers the page sends: a tap is a quiz answer; U3: a typed value (on a question that takes one) is a json answer;
 * an untouched question or "can't tell" is declined. A typed value that does not read is refused before sealing.
 */
export function answersToSend(questions: readonly Question[], picked: Record<string, string>, typed: Record<string, string> = {}, language?: Lang): { ok: true; answers: { measures: string; answer: HumanAnswer }[] } | { ok: false; measures: string } {
  const answers: { measures: string; answer: HumanAnswer }[] = [];
  for (const q of questions) {
    const t = (typed[q.measures] ?? "").trim();
    if (q.allowsTyped && t !== "") {
      const v = parseTyped(t, language);
      if (!v) return { ok: false, measures: q.measures };
      answers.push({ measures: q.measures, answer: { kind: "json", value: v.value } });
      continue;
    }
    const c = picked[q.measures];
    answers.push({ measures: q.measures, answer: c && c !== CANT_TELL ? { kind: "quiz", choice: c } : { kind: "declined", reason: CANT_TELL } });
  }
  return { ok: true, answers };
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
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState<{ initial: TestFormState; editedFrom?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plays, setPlays] = useState(0);
  // U3 item 7: how many replays have finished (the button says "again" only after the first one ended).
  const [played, setPlayed] = useState(0);
  // U3 item 5: a round opened by "Test this claim": the sentence it tests (the person's screen only; D18 keeps it from
  // the betting models). Its result is shown beside the run's measured facts, never judged.
  const [claimRound, setClaimRound] = useState<{ sentence: string } | null>(null);
  // U3 item 6: while Muse Wonder writes tests: when it started and what is happening now (real steps, not a guess).
  const [wonderWait, setWonderWait] = useState<{ started: number; phase: string; claim?: string } | null>(null);
  const ownTest = useRef(false);
  const [repo, setRepo] = useState("");
  const models = useModelSlots(api);
  const runStarted = useRef(false);
  // Review M1: every async answer belongs to one round. reset() starts a new round, and a late answer from an older one
  // (Wonder's tests, an experiment, a run) is dropped instead of landing on the new drawing.
  const gen = useRef(0);
  const [runTry, setRunTry] = useState(0);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [readText, setReadText] = useState("");
  useEffect(() => onRoundOpen?.(exp !== null && result === null), [exp, result, onRoundOpen]);

  const target = pasted?.runnable ? pasted.target : null;
  const test = exp?.experiment.gate.allowed ? (exp.experiment.params as CallTest) : null;
  const marks = useMemo(() => (test ? timeOptions(test).flatMap((o) => (o.match.kind === "ms" && o.match.min > 0 ? [o.match.min] : o.match.kind === "ms" && o.match.max ? [o.match.max] : [])) : []), [test]);
  const fullMs = useMemo(() => dialFullMs(marks), [marks]);
  const model = useMemo(
    () => (pasted?.outline ? benchModel({ fileName: FILE_NAME[pasted.target.language ?? "ts"], outline: pasted.outline, test: test ? test : null, dial: { marks: [...new Set(marks)], fullMs }, source: readText, language: pasted.target.language ?? pasted.language.chosen }) : null),
    [pasted, test, marks, fullMs, readText],
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
    setTyped({});
    setSealed([]);
    setResult(null);
    setClaim(null);
    setChanging(false);
    setForm(null);
    setError(null);
    setProofOpen(false);
    setPlayed(0);
    setClaimRound(null);
    setWonderWait(null);
    ownTest.current = false;
    runStarted.current = false;
    gen.current++;
  };

  /**
   * U3 item 6: asks Muse Wonder for tests with real progress on screen (elapsed time, what is happening), and the
   * person may write their own test at once; if they do, Wonder's answer never replaces it.
   */
  const askWonder = async (opts: { claimOf?: string; claim?: string; pick: "default" | "first" | "list" }) => {
    if (!target || !fn) return;
    const g = gen.current;
    ownTest.current = false;
    setWonderWait({ started: Date.now(), phase: BET_WORDS.waitAsking, ...(opts.claim ? { claim: opts.claim } : {}) });
    setError(null);
    try {
      const p = await api.proposals(target, fn, opts.claimOf ? { claimOf: opts.claimOf } : undefined);
      if (g !== gen.current) return;
      setProposals(p);
      const allowedN = p.proposals.filter((x) => x.gate.allowed).length;
      setWonderWait((w) => (w ? { ...w, phase: BET_WORDS.waitChecked(allowedN, p.proposals.length) } : w));
      if (ownTest.current) return; // the person is writing their own test: Wonder's tests wait in the list
      const lang = pasted?.target.language ?? pasted?.language.chosen;
      // U2 (D53) / U3: the default is the plain-code rule's pick (src/default-test.ts); "Test this claim" opens on
      // Wonder's first allowed test, the one aimed at the sentence.
      const first = opts.pick === "list" ? undefined : opts.pick === "first" ? p.proposals.find((x) => x.gate.allowed) : defaultProposal(p.proposals, lang ? { source: readText, language: lang } : undefined);
      if (first) await start(() => api.experimentFromProposal(target, first.id, { quiz: true }));
      else setChanging(true);
    } catch (e) {
      if (g === gen.current) setError((e as Error).message);
    } finally {
      if (g === gen.current) setWonderWait(null);
    }
  };
  const writeOwn = () => {
    ownTest.current = true;
    setChanging(true);
    setForm({ initial: emptyForm() });
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
      setReadText(text);
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
    if (!next || !target || !fn || exp || proposals || wonderWait) return;
    await askWonder({ pick: "default" });
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
      const lang = exp.experiment.target.language;
      const out = answersToSend(exp.questions, picked, typed, lang);
      if (!out.ok) {
        setError(BET_WORDS.typedBad(lang === "py"));
        return;
      }
      setSealed(await api.bets(exp.experiment.id, out.answers));
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
        // U3 item 5: a "Test this claim" round shows the sentence it tested beside the facts, not a new sentence to test.
        if (!claimRound && (exp.experiment.proposedBy.role === "investigator" || exp.experiment.proposedBy.editedFrom)) api.claim(exp.experiment.id).then((c) => setClaim(c.claim), () => setClaim(null));
      },
      (e: Error) => {
        if (g !== gen.current) return;
        runStarted.current = false;
        setBusy(null);
        setError(didNotFinish(e) ? `The run did not finish: ${e.message}` : e.message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, sealed, result, models.thinking, runTry, claimRound]);

  const after: After | null = useMemo(() => {
    // D47: run data only after the bets are sealed, and only the run of THIS round's test (review M1).
    if (!result || !exp || !test || sealed.length === 0 || result.run.experimentId !== exp.experiment.id) return null;
    const tested = model?.tested ?? null;
    const callers = Object.fromEntries(Object.entries(model?.parts ?? {}).flatMap(([id, p]) => (p.kind === "device" ? [[id, (p.calledBy ?? []).map((c) => c.part)]] : [])));
    const language = pasted?.target.language ?? pasted?.language.chosen;
    const wiring = pasted?.outline ? { outline: pasted.outline, callers, ...(language ? { language } : {}) } : undefined;
    return { token: plays, script: playScript(result.run, test, tested, waitingParts(readText, pasted?.outline), wiring), marks: marksOf(exp.questions, result.bets, result.verdicts, result.run, tested, language), dialFullMs: fullMs };
  }, [result, exp, test, sealed, plays, model, fullMs, readText, pasted]);

  // U2 (D53, "Test this claim"): Muse Wonder writes tests aimed at its own sentence (shown only after this run, D18);
  // the gate checks them as usual, the plain-code rule preselects one, and a new round opens on it.
  const testClaim = async () => {
    if (!target || !fn || !exp || !claim) return;
    const from = exp.experiment.id;
    const sentence = claim;
    reset();
    setClaimRound({ sentence });
    setOpen(true);
    // Here Wonder was asked to aim at its own sentence, so its first allowed test is the one aimed at it (the
    // plain-code "most interesting" rule would steer away from, say, the zero the sentence is about).
    await askWonder({ claimOf: from, claim: sentence, pick: "first" });
  };
  const anotherTest = async () => {
    reset();
    setOpen(true);
    if (!target || !fn) return;
    setChanging(true);
    await askWonder({ pick: "list" });
  };
  const nextTries = (labels?.labels ?? []).filter((l) => l.label === "found in this code" || l.label === "reproduced");

  // ---- entry ----
  if (!pasted) {
    return (
      <section className="u1-entry" aria-labelledby="u1-entry-h">
        <h1 id="u1-entry-h">See how your code is built</h1>
        <p className="u1-lede">Paste one file. Atlas draws its functions and how they call each other. Then, if you like, bet on what it will do: Atlas runs it and shows whether your bet matched.</p>
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
          onPlayed={() => setPlayed((n) => n + 1)}
          footnote={
            claimRound && after ? (
              <ClaimFacts sentence={claimRound.sentence} marks={after.marks} />
            ) : claim || nextTries.length ? (
              <>
                {claim && (
                  <div className="u1-claim" data-testid="u1-claim">
                    <p>
                      <span className="u1-k">{`${WONDER_DISPLAY} said, before the run:`}</span> <q>{claim}</q>
                    </p>
                    <button type="button" className="u1-btn" onClick={testClaim} disabled={busy !== null} data-testid="u1-test-claim">
                      {RESULT_WORDS.testClaim}
                    </button>
                  </div>
                )}
                {nextTries.length > 0 && (
                  <div className="u1-next" data-testid="u1-next">
                    <p className="u1-k">{RESULT_WORDS.nextTry}</p>
                    <ul>
                      {nextTries.map((l, i) => (
                        <li key={i}>{`${l.name}${l.lines?.[0] ? `, ${lineSpan(l.lines[0].lineStart, l.lines[0].lineEnd)}` : ""}`}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : null
          }
          {...(!sealed.length ? { onTestFunction: chooseFunction } : {})}
        >
          {after && (
            <div className="u1-actions" data-testid="u1-actions">
              <button type="button" className="u1-btn" onClick={() => setPlays((n) => n + 1)} disabled={played === 0} data-testid="u1-replay">
                {played === 0 ? STAGE_WORDS.playing : STAGE_WORDS.playAgain}
              </button>
              {result?.proof?.ok ? (
                <button type="button" className="u1-btn" aria-expanded={proofOpen} onClick={() => setProofOpen((o) => !o)} data-testid="u1-proof">
                  {RESULT_WORDS.proofTitle}
                </button>
              ) : result?.proof ? (
                <span className="u1-sub">{`No proof card: ${result.proof.ok ? "" : result.proof.reason}`}</span>
              ) : null}
              <button
                type="button"
                className="u1-btn"
                onClick={() => void anotherTest()}
                data-testid="u1-again"
              >
                Bet on another test
              </button>
            </div>
          )}
        </BenchStage>
      ) : null}
      {proofOpen && result?.proof?.ok && (
        <section className="u1-proof" role="dialog" aria-modal="false" aria-label={RESULT_WORDS.proofTitle} data-testid="u1-proof-panel">
          <div className="u1-proof-head">
            <h2>{RESULT_WORDS.proofTitle}</h2>
            <a className="u1-link" href={`?proof=${encodeURIComponent(result.proof.runId)}`} target="_blank" rel="noreferrer">
              Open on its own page
            </a>
            <button type="button" className="u1-close" onClick={() => setProofOpen(false)} aria-label={RESULT_WORDS.closeProof}>
              ×
            </button>
          </div>
          <ProofCardPage api={api} runId={result.proof.runId} embedded />
        </section>
      )}

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
              {wonderWait && !exp && <WonderWaiting wait={wonderWait} fn={fn} onOwn={changing ? null : writeOwn} />}
              {!exp && !changing && busy && !wonderWait && (
                <p className="u1-status" role="status">
                  {busy}
                </p>
              )}
              {exp && !changing && (
                <>
                  {claimRound && (
                    <p className="u1-sub u1-claim-tested" data-testid="u1-claim-tested">
                      {RESULT_WORDS.testingSentence(claimRound.sentence)}
                    </p>
                  )}
                  <p className="u1-test" data-testid="u1-test">
                    <span className="u1-k">{BET_WORDS.testIs}</span> {chosenSays ?? exp.experiment.params.shape}
                  </p>
                  {sealed.length === 0 && (
                    <button type="button" className="u1-link" onClick={() => setChanging(true)} data-testid="u1-change">
                      change test
                    </button>
                  )}
                  <ol className="u1-quiz">
                    {exp.questions.map((q) => (
                      <li key={q.measures}>
                        <p className="u1-q" id={`q-${q.measures}`}>
                          {shortQuestionFor(q.text, exp.experiment.params, exp.experiment.target.language)}
                        </p>
                        <div className="u1-opts" role="radiogroup" aria-labelledby={`q-${q.measures}`}>
                          {[...(q.quiz ?? []).map((o) => ({ id: o.id, label: o.label })), { id: CANT_TELL, label: CANT_TELL }].map((o) => (
                            <button
                              type="button"
                              role="radio"
                              key={o.id}
                              className="u1-opt"
                              aria-checked={(typed[q.measures] ?? "").trim() === "" && (picked[q.measures] ?? "") === o.id}
                              disabled={sealed.length > 0 || busy !== null}
                              onClick={() => {
                                setPicked((p) => ({ ...p, [q.measures]: o.id }));
                                setTyped((t) => ({ ...t, [q.measures]: "" }));
                              }}
                              data-testid={`opt-${q.measures}-${o.id}`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                        {q.allowsTyped && (
                          <TypedValue
                            id={`typed-${q.measures}`}
                            value={typed[q.measures] ?? ""}
                            {...(exp.experiment.target.language ? { language: exp.experiment.target.language } : {})}
                            disabled={sealed.length > 0 || busy !== null}
                            onChange={(v) => setTyped((t) => ({ ...t, [q.measures]: v }))}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
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
                  {sealed.length === 0 ? (
                    <>
                      <button type="button" className="u1-btn u1-primary" onClick={seal} disabled={busy !== null} data-testid="u1-seal">
                        {BET_WORDS.seal}
                      </button>
                      <p className="u1-sub">{BET_WORDS.untapped}</p>
                    </>
                  ) : (
                    <p className="u1-status" role="status" data-testid="u1-sealed">
                      {`Sealed ${plural(sealed.length, "answer")}. ${busy ?? (models.thinking ? "Waiting for the AIs to seal theirs…" : "")}`}
                    </p>
                  )}
                  {sealed.length > 0 && !result && error && !busy && (
                    <button type="button" className="u1-btn" onClick={() => setRunTry((n) => n + 1)} data-testid="u1-run-again">
                      Run it again
                    </button>
                  )}
                  <details className="u1-seen u1-how" data-testid="u1-how">
                    <summary>{BET_WORDS.howRuns}</summary>
                    <ul className="u1-explain" data-testid="u1-explain">
                      {test?.network && <li>{BET_WORDS.network(LIBRARY_WORDS[test.network.replaces])}</li>}
                      <li>{BET_WORDS.clock}</li>
                      <li>{BET_WORDS.random}</li>
                      <li>{BET_WORDS.zone(exp.experiment.target.language ?? "js")}</li>
                      <li>{BET_WORDS.watch(test?.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS, test?.watchLimitMs !== undefined)}</li>
                    </ul>
                  </details>
                  {exp.seenContext && (
                    <details className="u1-seen">
                      <summary>{BET_WORDS.seen}</summary>
                      <p className="u1-pins-line">{pinsLineOf(exp.seenContext, exp.experiment.target.language ?? "js")}</p>
                      <pre tabIndex={0} aria-label="What every bettor sees">
                        {exp.seenContext}
                      </pre>
                    </details>
                  )}
                </>
              )}
              {changing && target && fn && (
                <div data-testid="u1-tests">
                  <p className="u1-k">{BET_WORDS.pickFor(fn)}</p>
                  {busy && (
                    <p className="u1-status" role="status">
                      {busy}
                    </p>
                  )}
                  <ul className="u1-testlist">
                    {(proposals?.proposals ?? [])
                      .filter((p) => p.gate.allowed)
                      .map((p, i) => (
                        <li key={p.id}>
                          <span>{p.says}</span>{" "}
                          <button type="button" className="u1-link" onClick={() => start(() => api.experimentFromProposal(target, p.id, { quiz: true }))} disabled={busy !== null} data-testid={`u1-use-${i}`}>
                            Use this test
                          </button>{" "}
                          <button type="button" className="u1-link" onClick={() => setForm({ initial: formFromParams(p.params), editedFrom: p.id })}>
                            Edit
                          </button>
                        </li>
                      ))}
                  </ul>
                  {(() => {
                    // U2 (D53): a test the gate or the sandbox would refuse is never offered; it is only counted, quietly.
                    const out = (proposals?.proposals ?? []).filter((p) => !p.gate.allowed).length;
                    return out > 0 ? (
                      <p className="u1-sub" data-testid="u1-left-out">
                        {BET_WORDS.leftOut(out)}
                      </p>
                    ) : null;
                  })()}
                  <div className="u1-linkrow">
                  <button type="button" className="u1-link" onClick={() => setForm({ initial: emptyForm() })} data-testid="u1-own">
                    Write your own test
                  </button>
                  {form && <TestForm key={JSON.stringify(form.initial)} exportName={fn} initial={form.initial} busy={busy !== null} onSubmit={(params) => start(() => api.experiment(target, params, undefined, form.editedFrom, { quiz: true }))} />}
                  {exp && (
                    <button type="button" className="u1-link" onClick={() => setChanging(false)}>
                      Back to the quiz
                    </button>
                  )}
                  </div>
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
  const say = (st: string) => (st === "thinking" ? "answering" : st === "sealed" ? "sealed" : st === "no_usable_answer" ? "no usable answer" : st);
  return (
    <div className="u1-models" data-testid="u1-models">
      <p>{BET_WORDS.ais(on.map((s) => betterByRole(s.model)))}</p>
      {on.length > 0 && <p className="u1-sub">{on.map((s) => BET_WORDS.aiStatus(betterByRole(s.model), say(s.status))).join(" · ")}</p>}
      {!locked && (
        <label className="u1-who">
          <span>{BET_WORDS.whoBets}</span>
          <select className="u1-who-bets" value={claimant} onChange={(e) => onClaimant(e.target.value as ClaimantMode)}>
            <option value="spark">Muse Spark 1.3 (Meta)</option>
            <option value="spark-open">Muse Spark Open (Meta, open weights)</option>
            <option value="both">Both</option>
          </select>
        </label>
      )}
    </div>
  );
}

/** U3 item 4: the typed returned value, next to the options. It says how Atlas reads it, in the code's own spelling. */
function TypedValue({ id, value, language, disabled, onChange }: { id: string; value: string; language?: Lang; disabled: boolean; onChange: (v: string) => void }) {
  const py = language === "py";
  const t = value.trim();
  const read = t === "" ? null : parseTyped(t, language);
  return (
    <div className="u1-typed">
      <label htmlFor={id}>{BET_WORDS.typedLabel}</label>
      <input id={id} className="u1-typed-in" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" aria-describedby={`${id}-hint`} data-testid={id} />
      <p className="u1-sub" id={`${id}-hint`} aria-live="polite">
        {t === "" ? BET_WORDS.typedHint(py) : read ? BET_WORDS.typedReads(literal(read.value, language)) : BET_WORDS.typedBad(py)}
      </p>
    </div>
  );
}

/** U3 item 6: Muse Wonder is writing tests: the seconds so far, what is happening, and "write my own test" at once. */
function WonderWaiting({ wait, fn, onOwn }: { wait: { started: number; phase: string; claim?: string }; fn: string; onOwn: (() => void) | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - wait.started) / 1000));
  return (
    <div className="u1-wait" data-testid="u1-wait">
      {wait.claim && <p className="u1-sub u1-claim-tested">{RESULT_WORDS.testingSentence(wait.claim)}</p>}
      <p className="u1-status" role="status" aria-live="polite">
        {BET_WORDS.waitHead(fn, s)}
      </p>
      <p className="u1-sub">{wait.phase}</p>
      <p className="u1-sub">{BET_WORDS.waitExplore}</p>
      {onOwn && (
        <button type="button" className="u1-btn" onClick={onOwn} data-testid="u1-own-now">
          {BET_WORDS.writeOwnNow}
        </button>
      )}
    </div>
  );
}

/**
 * U3 item 5: after a "Test this claim" run, Wonder's sentence beside the run's measured facts that bear on it. Neither a
 * model nor plain code says whether the sentence holds: the person decides.
 */
function ClaimFacts({ sentence, marks }: { sentence: string; marks: readonly Mark[] }) {
  return (
    <section className="u1-claimfacts" aria-labelledby="u1-claimfacts-h" data-testid="u1-claim-facts">
      <h3 id="u1-claimfacts-h">{RESULT_WORDS.claimFactsHeading}</h3>
      <div className="u1-claimfacts-cols">
        <div>
          <p className="u1-k">{RESULT_WORDS.claimSaid}</p>
          <q>{sentence}</q>
        </div>
        <div>
          <p className="u1-k">{RESULT_WORDS.claimMeasured}</p>
          <ul>
            {marks.map((m) => (
              <li key={m.measures}>
                <span className="u1-k">{`${m.question}:`}</span> {m.measured}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="u1-sub">{RESULT_WORDS.claimYouDecide}</p>
    </section>
  );
}
