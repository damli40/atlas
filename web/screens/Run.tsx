// Screen 2: the "Break it" button and what the run was. Enabled only once bets are sealed.

import type { RunAnswer } from "../api";
import { RetryMachine } from "../machines/retry/RetryMachine";

export interface RunProps {
  canRun: boolean;
  running: boolean;
  result: RunAnswer | null;
  onBreak: () => void;
}

export function RunScreen({ canRun, running, result, onBreak }: RunProps) {
  const m = result?.run.result.measured;
  return (
    <section className="card" aria-label="run">
      <h2>3. Run it</h2>
      {!result && (
        <button type="button" className="primary" onClick={onBreak} disabled={!canRun || running}>
          Break it
        </button>
      )}
      {running && (
        <p className="running" role="status">
          Running withRpcRetry in the sandbox…
        </p>
      )}
      {result && m && (
        <dl className="facts" data-testid="run-facts">
          <dt>run</dt>
          <dd>
            {result.run.id} (seed {result.run.seed}, {result.run.executor} sandbox)
          </dd>
          <dt>started</dt>
          <dd>{result.run.startedAt}</dd>
          <dt>known-case check first</dt>
          <dd>{result.run.controlPassed ? "passed" : "did not pass, so every verdict is can't check"}</dd>
          <dt>measured</dt>
          <dd>
            calls {String(m.calls ?? "-")} · total wait {String(m.totalWaitMs ?? "-")} ms · outcome {String(m.outcome ?? "-")}
          </dd>
        </dl>
      )}
      {result && result.run.runner === "ts" && <RetryMachine run={result.run} bets={result.bets} verdicts={result.verdicts} />}
    </section>
  );
}
