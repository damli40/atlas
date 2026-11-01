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

import EXAMPLE_OUTLINE from "../u1-example-outline.json";
import { betView } from "../../renderer/authors/bet-view";
import { Drawing } from "../drawing/Drawing";
import { waitingPartsOf } from "../../src/call-sites";
import type { HelperAnswer } from "../api";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import type { Question } from "../../src/gate";
import { shortQuestionFor, pinsLineOf } from "../../src/paste-context";
import { CANT_TELL, timeOptions } from "../../src/quiz";
import { literal, parseTyped } from "../../src/literal";
import { WONDER_DISPLAY, BET_WORDS, RESULT_WORDS, STAGE_WORDS, betterByRole } from "../../src/paste-words";
import type { Mark } from "../machines/bench/play";
import { pickDefaultTest, type CodeContext } from "../../src/default-test";
import { keptState } from "../../src/code-facts";
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
import type { Confidence } from "../../src/types";
import { FeltRecord, FeltRoundLine, HowSurePicker } from "./FeltPanel";
import { FELT_WORDS } from "../../src/paste-words";

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

/**
 * U3: the test a "Test this claim" round opens on: Wonder's first allowed test (the one aimed at the sentence), except
 * that on code keeping state between calls a single call cannot show the state working, so a two-call test comes first.
 */
/** D60: the example's real drawing, drawing itself on the first screen: the same parser's output, kept in the page (a test holds them equal). */
function ExampleDrawing() {
  const spec = useMemo(() => {
    const s = betView({ fileName: "example.ts", outline: EXAMPLE_OUTLINE as unknown as FileOutline, source: U1_EXAMPLE, language: "ts", test: null, tested: "fetchWithRetry", seed: "first-screen" });
    return { ...s, title: undefined, kicker: undefined, subtitle: undefined, captions: [] } as typeof s;
  }, []);
  return (
    <div className="e-right" aria-hidden="true" data-testid="e-drawing">
      <Drawing
        spec={spec}
        theme="light"
        className="e-sheet"
        maxScale={1}
        hover={false}
        onMount={(m) => {
          if (m?.player && !m.player.reduced) void m.player.entrance();
        }}
      />
    </div>
  );
}

const HELPER_WAIT_MS = 2500;
const HELPER_TOO_SLOW = "Helper steps are not shown: the extra run made to see them took too long.";
export const CHANGE_WORDS = {
  open: "Change the code and bet again",
  explain: "Same test, same questions. Your new answers are sealed before anything runs, and the new run is judged the same way.",
  go: "Draw the change and bet again",
  sameTest: "The same test, on your changed code. Bet again: nothing about this code has run yet.",
  claimAsking: "Asking Muse Wonder for a new test…",
  claimNoNew: "Muse Wonder's tests for this sentence are ones that have already run here, so there is nothing new to bet on.",
  paidWonder: "Asks Muse Wonder: a paid AI call.",
  earlyWonder: "Muse Wonder is writing a test for this code: a paid AI call.",
  paidAgain: "The first two start paid AI calls.",
  paidBets: "The AI bettors answer too: paid AI calls.",
} as const;

export function claimProposal<P extends { gate: { allowed: boolean }; params: unknown }>(proposals: readonly P[], code?: CodeContext): P | undefined {
  const allowed = proposals.filter((p) => p.gate.allowed);
  const twoCalls = code && keptState(code.source, code.language).length > 0 ? allowed.find((p) => Array.isArray((p.params as CallTest).calls)) : undefined;
  return twoCalls ?? allowed[0];
}

/** R3: tests compared by what they do, whatever order their keys came in. */
export const canonicalTest = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

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
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [wholeTest, setWholeTest] = useState(false);
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
  // R3: "Change the code and bet again": the code being edited. The test stays the one just run.
  const [editing, setEditing] = useState<string | null>(null);
  // D60: the bet is one question at a time. All of them stay in the page (D19); CSS shows the current one.
  const [step, setStep] = useState(0);
  // R3: "Test this claim": asking Wonder, and whether it had nothing new (the button then goes away).
  const [claimAsking, setClaimAsking] = useState(false);
  const [claimNoNew, setClaimNoNew] = useState(false);
  // R3: the tests already run on this code: offering one again would show its answer.
  const ranTests = useRef(new Set<string>());
  // R3: the code's own steps for the drawing (a third run made after the sealed ones). Arrives with the result, or not at all.
  const [helpers, setHelpers] = useState<HelperAnswer | null>(null);
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
    setConfidence(null);
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
    setEditing(null);
    setStep(0);
    setClaimNoNew(false);
    setHelpers(null);
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
      // D60: the test-writing that began when the drawing finished, if it is for this file and function.
      const ready = !opts.claimOf && early.current?.key === `${target.codeSha256}|${fn}` ? early.current.answer : null;
      if (ready) early.current = null;
      const p = (await ready) ?? (await api.proposals(target, fn, opts.claimOf ? { claimOf: opts.claimOf } : undefined));
      if (g !== gen.current) return;
      setProposals(p);
      const allowedN = p.proposals.filter((x) => x.gate.allowed).length;
      setWonderWait((w) => (w ? { ...w, phase: BET_WORDS.waitChecked(allowedN, p.proposals.length) } : w));
      if (ownTest.current) return; // the person is writing their own test: Wonder's tests wait in the list
      const lang = pasted?.target.language ?? pasted?.language.chosen;
      // U2 (D53) / U3: the default is the plain-code rule's pick (src/default-test.ts); "Test this claim" opens on
      // Wonder's first allowed test, the one aimed at the sentence.
      const first = opts.pick === "list" ? undefined : opts.pick === "first" ? claimProposal(p.proposals, lang ? { source: readText, language: lang } : undefined) : defaultProposal(p.proposals, lang ? { source: readText, language: lang } : undefined);
      if (first) await start(() => api.experimentFromProposal(target, first.id, { quiz: true }));
      else setChanging(true);
    } catch (e) {
      if (g === gen.current) setError((e as Error).message);
    } finally {
      if (g === gen.current) setWonderWait(null);
    }
  };
  // D60: Muse Wonder starts writing tests when the drawing is done, not on the Bet click, so the wait is spent looking at the
  // drawing. Only the test-writing: its sentence stays hidden (D18), and the two model bets start only with a test.
  const early = useRef<{ key: string; answer: Promise<ProposalsAnswer | null> } | null>(null);
  const [earlyBusy, setEarlyBusy] = useState(false);
  useEffect(() => {
    if (!target || !fn || pasted?.cantCheck || !api.proposals) return;
    const key = `${target.codeSha256}|${fn}`;
    if (early.current?.key === key || exp || proposals) return;
    setEarlyBusy(true);
    const answer = Promise.resolve()
      .then(() => api.proposals(target, fn))
      .catch(() => null)
      .finally(() => setEarlyBusy(false));
    early.current = { key, answer };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.codeSha256, fn]);
  const writeOwn = () => {
    ownTest.current = true;
    setChanging(true);
    setForm({ initial: emptyForm() });
  };

  const read = useCallback(
    async (text: string, language?: Lang, want?: string, from?: string) => {
      if (text.trim() === "") return null;
      reset();
      ranTests.current = new Set();
      const g = gen.current;
      setPasted(null);
      setHandoffNote(null);
      setSource(from ?? null);
      setBusy("Reading your code…");
      setReadText(text);
      try {
        const r = await api.paste(text, language);
        if (g !== gen.current) return null;
        setPasted(r);
        // Review M4: a function the explorer named that this file does not export is said plainly, never swapped silently.
        if (want && !r.exports.some((e) => e.name === want)) {
          setHandoffNote(`${want} is not exported by this file, and Atlas can only call exported functions. Pick one on the drawing.`);
          setFn(null);
        } else setFn(want ?? defaultFunction(r.outline, r.exports));
        return r;
      } catch (e) {
        setError((e as Error).message);
        return null;
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

  // ---- D60: the invite on the first screen. A link can carry the code in its fragment, which never reaches a server's logs.
  const [invite, setInvite] = useState<{ required: boolean; signedIn: boolean; error?: string; busy?: boolean } | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const locked = Boolean(invite?.required && !invite.signedIn);
  const useCode = async (typed: string) => {
    setInvite((v) => (v ? { ...v, busy: true } : v));
    const a = await api.signIn(typed);
    if ("error" in a) {
      setInvite((v) => ({ required: true, signedIn: false, ...v, busy: false, error: a.error }));
      return false;
    }
    setInvite({ required: true, signedIn: true });
    return true;
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      const carried = typeof location !== "undefined" ? /^#(?:invite|code)=(.+)$/.exec(location.hash)?.[1] : undefined;
      if (carried) {
        history.replaceState(null, "", location.pathname + location.search);
        const ok = await Promise.resolve().then(() => useCode(decodeURIComponent(carried))).catch(() => false);
        if (ok || !live) return;
      }
      const st = await Promise.resolve().then(() => api.inviteStatus()).catch(() => null);
      if (live && st) setInvite((v) => (v?.error ? v : { required: st.required, signedIn: st.signedIn }));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    // Whatever was pasted stays in its box: the code only opens the door.
    const ok = await useCode(inviteCode.trim());
    if (ok && code.trim() !== "") void read(code, lang === "auto" ? undefined : lang);
  };
  // D60: paste anywhere on the first screen draws at once.
  useEffect(() => {
    if (pasted) return;
    const onDocPaste = (e: globalThis.ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim() === "") return;
      e.preventDefault();
      setCode(text);
      if (!locked) void read(text, lang === "auto" ? undefined : lang);
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  });

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // The drawing comes first: pasted code is read at once (no button to press).
    const text = e.clipboardData.getData("text");
    if (text.trim() === "" || code.trim() !== "") return;
    e.preventDefault();
    setCode(text);
    if (!locked) void read(text, lang === "auto" ? undefined : lang);
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
      setSealed(await api.bets(exp.experiment.id, out.answers, confidence));
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
      async (r) => {
        if (g !== gen.current) return;
        ranTests.current.add(canonicalTest(exp.experiment.params));
        // R3: the third run starts when the sealed runs end. Its steps join the drawing if they come quickly; the story never
        // waits long for them, and a page without them still shows everything that was measured.
        const steps = await Promise.race<HelperAnswer | null>([
          Promise.resolve()
            .then(() => api.helpers(r.run.id))
            .catch(() => null),
          new Promise<HelperAnswer>((done) => setTimeout(() => done({ none: HELPER_TOO_SLOW }), HELPER_WAIT_MS)),
        ]);
        if (g !== gen.current) return;
        setHelpers(steps);
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
    return { token: plays, script: playScript(result.run, test, tested, pasted?.outline ? waitingPartsOf(pasted.outline) : [], wiring), marks: marksOf(exp.questions, result.bets, result.verdicts, result.run, tested, language), dialFullMs: fullMs, ...(helpers ? { helpers } : {}), run: result.run, experiment: exp.experiment, bets: result.bets, verdicts: result.verdicts };
  }, [result, exp, test, sealed, plays, model, fullMs, readText, pasted, helpers]);

  // U2 (D53, "Test this claim"): Muse Wonder writes tests aimed at its own sentence (shown only after this run, D18); the gate
  // checks them as usual. R3: the round opens only on a test that is really different from what has already run here, compared
  // whatever order its keys came in. The same test again would show its answer. With nothing new, the button goes away.
  const testClaim = async () => {
    if (!target || !fn || !exp || !claim) return;
    const g = gen.current;
    const from = exp.experiment.id;
    const sentence = claim;
    setClaimAsking(true);
    setError(null);
    try {
      const p = await api.proposals(target, fn, { claimOf: from });
      if (g !== gen.current) return;
      const lang = pasted?.target.language ?? pasted?.language.chosen;
      const fresh = p.proposals.filter((x) => x.gate.allowed && !ranTests.current.has(canonicalTest(x.params)));
      const first = claimProposal(fresh, lang ? { source: readText, language: lang } : undefined);
      if (!first) {
        setClaimNoNew(true);
        return;
      }
      reset();
      setClaimRound({ sentence });
      setProposals(p);
      setOpen(true);
      await start(() => api.experimentFromProposal(target, first.id, { quiz: true }));
    } catch (e) {
      if (g === gen.current) setError((e as Error).message);
    } finally {
      setClaimAsking(false);
    }
  };
  // R3: the same test on changed code, judged the same way: the bets are sealed first, then the two runs.
  const changeAndBet = async () => {
    if (editing === null || !exp) return;
    const params = exp.experiment.params;
    const language = pasted?.target.language ?? undefined;
    const want = fn ?? undefined;
    const text = editing;
    setCode(text);
    const r = await read(text, language, want);
    if (!r?.runnable || (want && !r.exports.some((x) => x.name === want))) return;
    setHandoffNote(CHANGE_WORDS.sameTest);
    setOpen(true);
    await start(() => api.experiment(r.target, params, undefined, undefined, { quiz: true }));
  };
  const anotherTest = async () => {
    reset();
    setOpen(true);
    if (!target || !fn) return;
    setChanging(true);
    await askWonder({ pick: "list" });
  };
  // D60: when the questions arrive, the keys belong to them, not to the button that opened the bet.
  const expId = exp?.experiment.id;
  useEffect(() => {
    if (expId && open) document.querySelector<HTMLElement>('[data-testid="u1-pop"]')?.focus({ preventScroll: true });
  }, [expId, open]);
  // D60: the bet's keys: 1 to 9 answer the question showing, the left arrow goes back, Enter seals on the last step.
  useEffect(() => {
    if (!exp || !open || sealed.length > 0 || changing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, select")) return;
      if (e.key === "ArrowLeft") {
        setStep((n) => Math.max(0, n - 1));
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setStep((n) => Math.min(exp.questions.length, n + 1));
        e.preventDefault();
      } else if (e.key === "Enter" && step >= exp.questions.length && !t?.closest?.("button, a, summary")) {
        e.preventDefault();
        void seal();
      } else if (/^[1-9]$/.test(e.key) && step < exp.questions.length) {
        const q = exp.questions[step]!;
        const ids = [...(q.quiz ?? []).map((o) => o.id), CANT_TELL];
        const id = ids[Number(e.key) - 1];
        if (id === undefined) return;
        e.preventDefault();
        document.querySelector<HTMLElement>(`[data-testid="opt-${q.measures}-${id}"]`)?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // D60: the keys. Never while typing, and never with a modifier. The bet's own keys live in the bet.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") {
        setEditing(null);
        setProofOpen(false);
        return;
      }
      if (!result) return;
      const k = e.key.toLowerCase();
      if (k === "r" && played > 0) setPlays((n) => n + 1);
      else if (k === "b") void anotherTest();
      else if (k === "p" && result.proof?.ok) setProofOpen((o) => !o);
      else if (k === "e" && exp) setEditing((x) => (x === null ? readText : null));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const nextTries = (labels?.labels ?? []).filter((l) => l.label === "found in this code" || l.label === "reproduced");

  // ---- entry ----
  if (!pasted) {
    return (
      <section className="u1-entry" aria-labelledby="u1-entry-h" data-testid="u1-entry">
        <div className="e-left">
        <h1 id="u1-entry-h">See how your code is built</h1>
        <p className="u1-lede">Paste one file. Atlas draws its functions and how they call each other. Then, if you like, bet on what it will do: Atlas runs it and shows whether your bet matched.</p>
        {invite?.required && !invite.signedIn && (
          <form className="e-invite" onSubmit={(e) => void submitInvite(e)} data-testid="e-invite">
            <label htmlFor="e-invite-code">Your invite code</label>
            <div className="e-invite-row">
              <input id="e-invite-code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" spellCheck={false} data-testid="e-invite-code" />
              <button type="submit" className="u1-btn" disabled={inviteCode.trim() === "" || invite.busy === true} data-testid="e-invite-go">
                Use this code
              </button>
            </div>
            {invite.error && <p className="e-invite-error" role="alert" data-testid="e-invite-error">{invite.error}</p>}
          </form>
        )}
        <div className="e-try">
          <button
            type="button"
            className="u1-btn u1-primary e-example"
            onClick={() => {
              setCode(U1_EXAMPLE);
              void read(U1_EXAMPLE, "ts");
            }}
            disabled={busy !== null || locked}
            data-testid="u1-example"
          >
            Try the example
          </button>
          <span className="u1-sub e-or">or paste a file anywhere on this page</span>
        </div>
        <label htmlFor="u1-code" className="u1-sr">
          Your code
        </label>
        <textarea
          id="u1-code"
          className="u1-code"
          data-testid="u1-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && code.trim() !== "" && !locked) {
              e.preventDefault();
              void read(code, lang === "auto" ? undefined : lang);
            }
          }}
          placeholder="Paste a JavaScript, TypeScript or Python file here"
          spellCheck={false}
        />
        <div className="u1-entry-row">
          <button type="button" className="u1-btn" onClick={() => read(code, lang === "auto" ? undefined : lang)} disabled={busy !== null || code.trim() === "" || locked} data-testid="u1-draw">
            Draw it
            <kbd className="k">⌘↵</kbd>
          </button>
          {/* The language is guessed. The choice appears only if a guess did not work. */}
          {error && (
            <label className="u1-inline">
              <span className="u1-sr">Language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang | "auto")} aria-label="Language" data-testid="u1-lang">
                <option value="auto">Guess the language</option>
                <option value="ts">TypeScript</option>
                <option value="js">JavaScript</option>
                <option value="py">Python</option>
              </select>
            </label>
          )}
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
        </div>
        <ExampleDrawing />
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
      {shownModel && pasted.outline ? (
        <BenchStage
          model={shownModel}
          source={readText}
          language={pasted.target.language ?? pasted.language.chosen ?? "ts"}
          outline={pasted.outline}
          fileName={FILE_NAME[pasted.target.language ?? "ts"]}
          after={after}
          extraMarks={labelMarks}
          title={title}
          side={open}
          onPlayed={() => setPlayed((n) => n + 1)}
          headnote={
            after && result ? (
              <>
                <FeltRoundLine bets={result.bets} verdicts={result.verdicts} />
                {claimRound && <ClaimFacts sentence={claimRound.sentence} marks={after.marks} />}
              </>
            ) : null
          }
          footnote={
            <>
            {claimRound ? null : claim || nextTries.length ? (
              <>
                {claim && (
                  <div className="u1-claim" data-testid="u1-claim">
                    <p>
                      <span className="u1-k">{`${WONDER_DISPLAY} said, before the run:`}</span> <q>{claim}</q>
                    </p>
                    {claimNoNew ? (
                      <p className="u1-sub" data-testid="u1-claim-none">{CHANGE_WORDS.claimNoNew}</p>
                    ) : (
                      <>
                        <button type="button" className="u1-btn" onClick={testClaim} disabled={busy !== null || claimAsking} data-testid="u1-test-claim">
                          {claimAsking ? CHANGE_WORDS.claimAsking : RESULT_WORDS.testClaim}
                        </button>
                        <span className="u1-sub u1-paid" data-testid="u1-paid-claim">{CHANGE_WORDS.paidWonder}</span>
                      </>
                    )}
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
            ) : null}
            {result?.track && ("error" in result.track ? <p className="u1-sub">{FELT_WORDS.recordNotSaved(result.track.error)}</p> : <FeltRecord record={result.track.after} />)}
            </>
          }
          {...(!sealed.length ? { onTestFunction: chooseFunction } : {})}
        >
          {after && (
            <div className="u1-actions" data-testid="u1-actions">
              {exp && (
                <button type="button" className="u1-btn u1-primary" onClick={() => setEditing((t) => (t === null ? readText : null))} aria-expanded={editing !== null} data-testid="u1-change">
                  {CHANGE_WORDS.open}
                  <kbd className="k">E</kbd>
                </button>
              )}
              <button type="button" className="u1-btn" onClick={() => void anotherTest()} data-testid="u1-again" title={CHANGE_WORDS.paidWonder}>
                Bet on another test
                <kbd className="k">B</kbd>
              </button>
              {result?.proof?.ok ? (
                <button type="button" className="u1-btn u1-quiet" aria-expanded={proofOpen} onClick={() => setProofOpen((o) => !o)} data-testid="u1-proof">
                  {RESULT_WORDS.proofTitle}
                  <kbd className="k">P</kbd>
                </button>
              ) : result?.proof ? (
                <span className="u1-sub">{`No proof card: ${result.proof.ok ? "" : result.proof.reason}`}</span>
              ) : null}
              <button type="button" className="u1-btn u1-quiet" onClick={() => setPlays((n) => n + 1)} disabled={played === 0} data-testid="u1-replay">
                {played === 0 ? STAGE_WORDS.playing : STAGE_WORDS.playAgain}
                <kbd className="k">R</kbd>
              </button>
              <span className="u1-sub u1-paid" data-testid="u1-paid-again">{CHANGE_WORDS.paidAgain}</span>
            </div>
          )}
        </BenchStage>
      ) : null}
      {after && editing !== null && (
        <section className="u1-proof u1-changing" role="dialog" aria-modal="false" aria-label={CHANGE_WORDS.open} data-testid="u1-change-panel">
          <div className="u1-proof-head">
            <h2>{CHANGE_WORDS.open}</h2>
            <button type="button" className="u1-close" onClick={() => setEditing(null)} aria-label="Close without changing">
              ×
            </button>
          </div>
          <p className="u1-sub">{CHANGE_WORDS.explain}</p>
          <textarea className="u1-code" aria-label="Your code" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} data-testid="u1-change-code" />
          <div className="u1-entry-row">
            <button type="button" className="u1-btn u1-primary" onClick={() => void changeAndBet()} disabled={busy !== null || editing.trim() === "" || editing === readText} data-testid="u1-change-go">
              {CHANGE_WORDS.go}
            </button>
            <span className="u1-sub u1-paid" data-testid="u1-paid-change">{CHANGE_WORDS.paidBets}</span>
          </div>
        </section>
      )}
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
          {!open && !exp && !proposals && <span className="u1-sub u1-paid" data-testid="u1-paid-bet">{earlyBusy ? CHANGE_WORDS.earlyWonder : CHANGE_WORDS.paidBets}</span>}
          <button type="button" className="u1-btn u1-primary u1-toggle" aria-expanded={open} aria-controls="u1-pop" onClick={openBet} data-testid="u1-bet-toggle">
            {open ? "Hide the bet" : "Bet on your understanding"}
          </button>
          {open && (
            <section id="u1-pop" className="u1-pop" tabIndex={-1} aria-label="Bet on your understanding" data-testid="u1-pop">
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
                  <p className={`u1-test${wholeTest ? "" : " u1-test-clamp"}`} data-testid="u1-test">
                    <span className="u1-k">{BET_WORDS.testIs}</span> {chosenSays ?? exp.experiment.params.shape}
                  </p>
                  <div className="u1-testrow">
                    <button type="button" className="u1-link" aria-expanded={wholeTest} onClick={() => setWholeTest((w) => !w)} data-testid="u1-whole-test">
                      {wholeTest ? BET_WORDS.testShort : BET_WORDS.testWhole}
                    </button>
                    {sealed.length === 0 && (
                      <button type="button" className="u1-link" onClick={() => setChanging(true)} data-testid="u1-change">
                        change test
                      </button>
                    )}
                  </div>
                  {sealed.length === 0 && (
                    <div className="b-head" data-testid="b-head">
                      <button type="button" className="b-back" onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0} aria-label="Back to the question before" data-testid="b-back">
                        ←
                      </button>
                      <span className="b-progress" data-testid="b-progress">{step < exp.questions.length ? `${step + 1} of ${exp.questions.length}` : `${exp.questions.length} of ${exp.questions.length}`}</span>
                      <span className="b-dots" aria-hidden="true">
                        {exp.questions.map((q, i) => (
                          <i key={q.measures} data-on={i <= step ? "" : undefined} />
                        ))}
                      </span>
                    </div>
                  )}
                  <ol className="u1-quiz" data-sealed={sealed.length > 0 ? "" : undefined}>
                    {exp.questions.map((q, qi) => (
                      <li key={q.measures} data-active={qi === step ? "" : undefined}>
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
                                // A moment to see the choice land, then the next question.
                                window.setTimeout(() => setStep((n) => (n === qi ? n + 1 : n)), 130);
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
                  {sealed.length === 0 && step >= exp.questions.length && (
                    <ol className="b-review" data-testid="b-review">
                      {exp.questions.map((q, qi) => {
                        const t = (typed[q.measures] ?? "").trim();
                        const label = t !== "" ? t : (q.quiz ?? []).find((o) => o.id === picked[q.measures])?.label ?? CANT_TELL;
                        return (
                          <li key={q.measures}>
                            <button type="button" onClick={() => setStep(qi)} data-testid={`b-review-${qi}`}>
                              <span className="b-n">{qi + 1}</span>
                              <span className="b-a">{label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
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
                  {sealed.length === 0 ? (
                    <div className="u1-sealbar" data-last={step >= exp.questions.length ? "" : undefined}>
                      <button type="button" className={`u1-btn${step >= exp.questions.length ? " u1-primary" : ""}`} onClick={seal} disabled={busy !== null} data-testid="u1-seal">
                        {BET_WORDS.seal}
                        {step >= exp.questions.length && <kbd className="k">↵</kbd>}
                      </button>
                      <HowSurePicker value={confidence} onChange={setConfidence} disabled={busy !== null} hint={false} />
                      <p className="u1-sub">{`${BET_WORDS.untapped} ${FELT_WORDS.pickerHint}`}</p>
                    </div>
                  ) : (
                    <>
                      <p className="u1-status" role="status" data-testid="u1-sealed">
                        {`Sealed ${plural(sealed.length, "answer")}. ${confidence ? `${FELT_WORDS.sealedSaid(confidence)} ` : ""}${busy ?? (models.thinking ? "Waiting for the AIs to seal theirs…" : "")}`}
                      </p>
                      <SealTags sealed={sealed} slots={models.slots} />
                    </>
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
                  {proposals && !proposals.ok && proposals.reason && (
                    <p className="u1-sub" role="note" data-testid="u1-no-tests">
                      {BET_WORDS.noTests(proposals.reason)}
                    </p>
                  )}
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

/** D60: after sealing, each bettor's sealed tag with its real short hash, and a real seconds counter. Answers stay hidden. */
function SealTags({ sealed, slots }: { sealed: readonly { sealedHash?: string }[]; slots: ReturnType<typeof useModelSlots>["slots"] }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const short = (list: readonly { sealedHash?: string }[]) => (list[0]?.sealedHash ? list[0].sealedHash.slice(0, 8) : "");
  const on = slots.filter((s) => s.status !== "off");
  return (
    <ul className="b-seals" data-testid="b-seals">
      <li>
        <span className="b-seal-who">You</span>
        <span className="b-seal-v">{`sealed ${short(sealed)}`}</span>
      </li>
      {on.map((s) => (
        <li key={s.who} data-state={s.status}>
          <span className="b-seal-who">{betterByRole(s.model)}</span>
          <span className="b-seal-v">{s.status === "sealed" ? `sealed ${short((s as { sealed?: { sealedHash?: string }[] }).sealed ?? [])}` : s.status === "thinking" ? "answering" : s.status === "no_usable_answer" ? "no usable answer" : s.status}</span>
        </li>
      ))}
      <li className="b-seal-time" data-testid="b-seal-time">{`${((now - started) / 1000).toFixed(1)} s`}</li>
    </ul>
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
        <div className="u1-who" role="radiogroup" aria-label={BET_WORDS.whoBets}>
          <span>{BET_WORDS.whoBets}</span>
          {(
            [
              ["spark", "Muse Spark 1.3"],
              ["spark-open", "Muse Spark Open"],
              ["both", "Both"],
            ] as const
          ).map(([value, words]) => (
            <button type="button" role="radio" key={value} className="u1-seg" aria-checked={claimant === value} onClick={() => claimant !== value && onClaimant(value)} data-testid={`who-${value}`}>
              {words}
            </button>
          ))}
        </div>
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
      <input id={id} className="u1-typed-in" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" placeholder={py ? 'e.g. "pro", 42, True, None' : 'e.g. "pro", 42, true, null'} aria-describedby={`${id}-hint`} data-testid={id} />
      <p className="u1-sub" id={`${id}-hint`} aria-live="polite">
        {t === "" ? "" : read ? BET_WORDS.typedReads(literal(read.value, language)) : BET_WORDS.typedBad(py)}
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
