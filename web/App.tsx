// One flow on the withRpcRetry fixture: pick a scenario → answer the plain-code questions → the
// server seals the bets (hashes on screen) → "Break it" runs the real code → verdicts + the
// browser's own seal check.
// D02-06: as soon as the experiment exists, the server asks Muse Spark for its bets on the SAME
// questions. The page shows only "has sealed N bets" + hashes until the run, then both columns.

import { useEffect, useMemo, useState } from "react";
import type { Question } from "../src/gate";
import type { Target } from "../src/types";
import { createApi, type Api, type HumanAnswer, type ModelSlotView, type RunAnswer, type ShownBet } from "./api";
import { DEFAULT_SCENARIO, FIXTURE_REF, SCENARIOS } from "./scenarios";
import { Bets, TargetCard } from "./screens/Bets";
import { RunScreen } from "./screens/Run";
import { VerdictScreen } from "./screens/Verdict";
import { ModelSlotCard } from "./screens/ModelPanel";

export function App({ api: given }: { api?: Api } = {}) {
  const api = useMemo(() => given ?? createApi(), [given]);
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
      const out = await api.experiment(target, scenario.params);
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
    <main>
      <header>
        <h1>Atlas</h1>
        <p className="muted">Know what your AI-written code does before you trust it.</p>
      </header>
      <TargetCard target={target} />
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
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
