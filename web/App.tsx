// One flow on the withRpcRetry fixture: pick a scenario → answer the plain-code questions → the
// server seals the bets (hashes on screen) → "Break it" runs the real code → verdicts + the
// browser's own seal check.

import { useEffect, useMemo, useState } from "react";
import type { Question } from "../src/gate";
import type { Target } from "../src/types";
import { createApi, type Api, type HumanAnswer, type RunAnswer, type ShownBet } from "./api";
import { DEFAULT_SCENARIO, FIXTURE_REF, SCENARIOS } from "./scenarios";
import { Bets, TargetCard } from "./screens/Bets";
import { RunScreen } from "./screens/Run";
import { VerdictScreen } from "./screens/Verdict";

export function App({ api: given }: { api?: Api } = {}) {
  const api = useMemo(() => given ?? createApi(), [given]);
  const [target, setTarget] = useState<Target | null>(null);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
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
    });

  const seal = () =>
    step(async () => {
      if (!experimentId) return;
      const out: ShownBet[] = [];
      for (const q of questions) {
        const raw = (answers[q.measures] ?? "").trim();
        const answer: HumanAnswer = q.kind === "enum" ? { kind: "enum", value: raw } : { kind: "integer", value: Number(raw) };
        out.push(await api.bet(experimentId, q.measures, answer));
      }
      setSealed(out);
    });

  const breakIt = async () => {
    if (!experimentId) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.run(experimentId));
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
      <RunScreen canRun={sealed.length > 0 && !busy} running={running} result={result} onBreak={breakIt} />
      {result && <VerdictScreen shown={sealed} result={result} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
