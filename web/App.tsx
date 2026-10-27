// One flow on the withRpcRetry fixture: pick a scenario → answer the plain-code questions → the
// server seals the bets (hashes on screen) → "Break it" runs the real code → verdicts + the
// browser's own seal check.
// D02-06: as soon as the experiment exists, the server asks Muse Spark for its bets on the SAME
// questions. The page shows only "has sealed N bets" + hashes until the run, then both columns.
// D04-04: a target switcher (the withRpcRetry fixture, or a pull request link: Moonwell PR #578 on
// the EVM runner), and a findings panel (the Investigator's places, checked against the file).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Question } from "../src/gate";
import type { Target } from "../src/types";
import { createApi, type Api, type HumanAnswer, type ModelSlotView, type RunAnswer, type ShownBet } from "./api";
import { DEFAULT_SCENARIO, FIXTURE_REF, SCENARIOS } from "./scenarios";
import { Bets, TargetCard } from "./screens/Bets";
import { RunScreen } from "./screens/Run";
import { VerdictScreen } from "./screens/Verdict";
import { ModelSlotCard } from "./screens/ModelPanel";
import { FindingsPanel } from "./screens/Findings";
import { MoonwellFlow } from "./screens/Moonwell";
import { ChangePanel } from "./screens/Change";
import { AdversaryPanel } from "./screens/Adversary";
import { LogStrip, useAgentEvents } from "./logstrip/LogStrip";
import { modelTextsOf, WhyDroppedContext, WhyScreen } from "./screens/Why";
import { ScaleScreen } from "./screens/Scale";
import { ProofCardPage, ProofLink } from "./screens/ProofCard";
import type { Finding } from "../src/types";

type Mode = "fixture" | "pr" | "scale";

/** D06-03: `?proof=<runId>` opens one round's proof card on its own (the end frame). */
export function proofIdFromLocation(search: string): string | null {
  const id = new URLSearchParams(search).get("proof");
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export function App({ api: given }: { api?: Api } = {}) {
  const proofId = typeof window === "undefined" ? null : proofIdFromLocation(window.location.search);
  if (proofId) return <ProofCardPage api={given ?? createApi()} runId={proofId} />;
  return <Rounds {...(given ? { api: given } : {})} />;
}

function Rounds({ api: given }: { api?: Api }) {
  const [mode, setMode] = useState<Mode>("fixture");
  // One API client (one session) per target, so switching starts a clean round.
  const fixtureApi = useMemo(() => given ?? createApi(), [given]);
  const prApi = useMemo(() => given ?? createApi(), [given]);
  const scaleApi = useMemo(() => given ?? createApi(), [given]);
  // D05-04: the agent log strip. A side panel on a wide screen (toggled), under the flow on a phone.
  const [stripOpen, setStripOpen] = useState(true);
  // D05-05: how many "Ask why" sentences were dropped (no run evidence), per target, for the strip.
  const [dropped, setDropped] = useState<Record<"fixture" | "pr", { count: number; at: string } | null>>({ fixture: null, pr: null });
  const reportDropped = useCallback(
    (count: number) => {
      if (mode === "scale") return; // no "Ask why" on the waves screen
      setDropped((d) => (d[mode]?.count === count ? d : { ...d, [mode]: { count, at: new Date().toISOString() } }));
    },
    [mode],
  );
  return (
    <div className={`shell${stripOpen ? " with-strip" : ""}`}>
      <main>
        <header>
          <h1>Atlas</h1>
          <p className="muted">Know what your AI-written code does before you trust it.</p>
        </header>
        <nav className="switch" aria-label="what to test">
          <button type="button" className={mode === "fixture" ? "on" : undefined} aria-pressed={mode === "fixture"} onClick={() => setMode("fixture")}>
            withRpcRetry (TypeScript)
          </button>
          <button type="button" className={mode === "pr" ? "on" : undefined} aria-pressed={mode === "pr"} onClick={() => setMode("pr")} data-testid="mode-pr">
            A pull request link (Solidity, Base fork)
          </button>
          <button type="button" className={mode === "scale" ? "on" : undefined} aria-pressed={mode === "scale"} onClick={() => setMode("scale")} data-testid="mode-scale">
            Many callers at once
          </button>
        </nav>
        <WhyDroppedContext.Provider value={reportDropped}>{mode === "fixture" ? <FixtureFlow api={fixtureApi} /> : mode === "pr" ? <MoonwellFlow api={prApi} /> : <ScaleScreen api={scaleApi} />}</WhyDroppedContext.Provider>
      </main>
      <LiveLogStrip key={mode} api={mode === "fixture" ? fixtureApi : mode === "pr" ? prApi : scaleApi} dropped={mode === "scale" ? null : dropped[mode]} open={stripOpen} onToggle={() => setStripOpen((o) => !o)} />
    </div>
  );
}

/** The strip for one API client's session (keyed per client by App, so a switch starts a fresh stream). */
function LiveLogStrip({ api, dropped, open, onToggle }: { api: Api; dropped: { count: number; at: string } | null; open: boolean; onToggle: () => void }) {
  const events = useAgentEvents(api.session);
  return <LogStrip events={events} dropped={dropped} open={open} onToggle={onToggle} />;
}

function FixtureFlow({ api }: { api: Api }) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [modelSlot, setModelSlot] = useState<ModelSlotView | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.target(FIXTURE_REF).then(
      (t) => live && setTarget(t),
      (e: Error) => live && setError(e.message),
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

  const ask = () =>
    step(async () => {
      if (!target) return;
      const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
      const out = await api.experiment(target, scenario.params, finding?.id);
      setExperimentId(out.experiment.id);
      setQuestions(out.questions);
      setModelSlot(out.model);
      if (out.model?.status === "thinking") {
        // Not awaited: the person bets while the model thinks. Only hashes come back.
        const thinking = out.model;
        api.modelBets(out.experiment.id).then(
          (m) => setModelSlot(m),
          (e: Error) => setModelSlot({ ...thinking, status: "no_usable_answer", reason: `the page could not reach the server: ${e.message}`, sealed: [] }),
        );
      }
    });

  const seal = () =>
    step(async () => {
      if (!experimentId) return;
      // Check every answer here first, then send them all in ONE request: the server seals all or
      // none, so a half-sealed attempt cannot happen (S1).
      const toSend: { measures: string; answer: HumanAnswer }[] = [];
      for (const q of questions) {
        const raw = (answers[q.measures] ?? "").trim();
        if (q.kind === "enum") {
          toSend.push({ measures: q.measures, answer: { kind: "enum", value: raw } });
          continue;
        }
        const n = Number(raw);
        if (raw === "" || !Number.isSafeInteger(n) || n < 0) throw new Error(`"${q.text}" needs a whole number of 0 or more`);
        toSend.push({ measures: q.measures, answer: { kind: "integer", value: n } });
      }
      const set = await api.bets(experimentId, toSend);
      // The page shows exactly the set the server will judge: one sealed bet per question asked.
      const asked = new Set(questions.map((q) => q.measures));
      if (set.length !== asked.size || set.some((b) => !asked.has(b.measures))) {
        throw new Error(`the server holds ${set.length} sealed bets for you, not one per question; start a new experiment`);
      }
      setSealed(set);
    });

  const breakIt = async () => {
    if (!experimentId) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.run(experimentId);
      // After the run, the server's slot is the truth (its bets were sealed even if the page's own
      // model-bets request failed), so the model column is rebuilt from it. When the page already
      // showed the model's hashes, it keeps its own copy: the seal check compares against what was
      // on screen BEFORE the run, and any judged bet the page never showed is flagged there.
      if (r.model && modelSlot?.status !== "sealed") setModelSlot({ ...r.model, sealed: [] });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <TargetCard target={target} />
      <FindingsPanel api={api} target={target} chosen={finding} onChoose={setFinding} locked={experimentId !== null} />
      <Bets
        scenarioId={scenarioId}
        onScenario={setScenarioId}
        asked={experimentId !== null}
        onAsk={ask}
        questions={questions}
        answers={answers}
        onAnswer={(m, v) => setAnswers((a) => ({ ...a, [m]: v }))}
        sealed={sealed}
        onSeal={seal}
        busy={busy || !target}
      />
      <ModelSlotCard slot={modelSlot} revealed={result && modelSlot ? result.bets.filter((b) => b.who === modelSlot.who) : null} />
      <RunScreen canRun={sealed.length > 0 && !busy && modelSlot?.status !== "thinking"} running={running} result={result} onBreak={breakIt} />
      {result && (
        <VerdictScreen
          shown={sealed}
          typed={answers}
          modelShown={modelSlot?.sealed ?? []}
          modelName={modelSlot && modelSlot.status !== "off" ? modelSlot.display : null}
          modelEmpty={modelSlot?.status === "no_usable_answer" ? `no usable answer (${modelSlot.reason ?? "no reason given"})` : undefined}
          result={result}
        />
      )}
      {result && <WhyScreen run={result.run} finding={finding} modelTexts={modelTextsOf(result.bets, finding)} />}
      {result?.proof?.ok && <ProofLink runId={result.proof.runId} />}
      {result && experimentId && <ChangePanel api={api} result={result} experimentId={experimentId} modelName={modelSlot && modelSlot.status !== "off" ? modelSlot.display : null} />}
      {result && <AdversaryPanel api={api} runId={result.run.id} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
