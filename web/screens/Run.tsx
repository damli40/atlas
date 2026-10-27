// Screen 2: the "Break it" button and what the run was. Enabled only once bets are sealed.

import { notShownAsFact } from "../../src/trust";
import type { RunAnswer } from "../api";
import { RetryMachine } from "../machines/retry/RetryMachine";

export interface RunProps {
  canRun: boolean;
  running: boolean;
  result: RunAnswer | null;
  onBreak: () => void;
  /** Final review M6: the code under test, by the target's own name (src/target-name.ts). */
  name?: string;
  /** Final review S2: "the run did not finish: <reason>" when the last attempt stopped before a result. */
  failed?: string | null;
}

/**
 * Final review S2: the run stopped before it measured anything (the machine, not the code). Nothing was
 * judged; the sealed bets stay frozen; "Try the run again" runs the SAME experiment with the SAME bets.
 */
export function RunDidNotFinish({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled?: boolean }) {
  return (
    <div data-testid="run-failed" className="notice" role="alert">
      <p>{message}</p>
      <p className="small">Nothing was judged. Your sealed bets stay as they are; the same experiment runs again with them.</p>
      <button type="button" className="primary" onClick={onRetry} disabled={disabled}>
        Try the run again
      </button>
    </div>
  );
}

export function RunScreen({ canRun, running, result, onBreak, name = "the code", failed = null }: RunProps) {
  const m = result?.run.result.measured;
  // B1: a run that may not be shown as fact prints its reason, never its numbers.
  const notShown = result ? notShownAsFact(result.run) : null;
  return (
    <section className="card" aria-label="run">
      <h2>3. Run it</h2>
      {!result && failed === null && (
        <button type="button" className="primary" onClick={onBreak} disabled={!canRun || running}>
          Break it
        </button>
      )}
      {!result && failed !== null && !running && <RunDidNotFinish message={failed} onRetry={onBreak} disabled={!canRun} />}
      {running && (
        <p className="running" role="status">
          Running {name} in the sandbox…
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
          {notShown !== null ? (
            <dd data-testid="run-not-shown">nothing shown: {notShown}</dd>
          ) : (
            <dd>
              calls {String(m.calls ?? "-")} · total wait {String(m.totalWaitMs ?? "-")} ms · outcome {String(m.outcome ?? "-")}
            </dd>
          )}
        </dl>
      )}
      {result && result.run.runner === "ts" && <RetryMachine run={result.run} bets={result.bets} verdicts={result.verdicts} />}
    </section>
  );
}
