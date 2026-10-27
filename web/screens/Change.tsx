// D06-01, screen 5: change toward what you expected, then re-run.
//
// One button asks the server (POST /changes) for Muse Code's change. The page then shows, in this
// order: the caption (a template, never a model's words), who proposed the change (agent and model
// id), the diff and only the diff, the SAME sealed bets in two columns ("Before change" | "After
// change", both judged by src/judge.ts), what plain code checked about the replay (same seed / same
// block), the pass rule's replay lines on Moonwell, and the machine drawn from the replay run.
// When Muse Code gave no usable change, the page says "Muse Code: no usable change (<reason>)".

import { useState } from "react";
import { AFTER_LABEL, BEFORE_LABEL, CHANGE_CAPTION } from "../../src/change";
import { parseUnifiedDiff } from "../../src/diff";
import type { Bet, Outcome, Verdict } from "../../src/types";
import type { Api, ChangeAnswer, RunAnswer } from "../api";
import { useRunnerProgress } from "../progress";
import { RetryMachine } from "../machines/retry/RetryMachine";
import { PricePipe } from "../machines/pricepipe/PricePipe";
import type { FormatValue } from "./Verdict";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };
const asStored: FormatValue = (_m, v) => String(v);

function answerText(b: Bet): string {
  if (b.answer.kind === "number") return `${b.answer.value} ${b.answer.unit} (±${b.answer.tolerancePct}%)`;
  return b.answer.kind === "declined" ? "declined" : String(b.answer.value);
}

function OutcomeCell({ v, format, measures, testId }: { v: Verdict | undefined; format: FormatValue; measures: string; testId: string }) {
  const o = v?.outcome ?? "cant_check";
  return (
    <td className={`verdict ${o}`} data-testid={testId} data-outcome={o}>
      <b>{SAY[o]}</b>
      <div className="muted small">
        observed {v?.observed === undefined ? "-" : format(measures, v.observed)}
        {v?.reason ? ` (${v.reason})` : ""}
      </div>
    </td>
  );
}

/** The diff as text, one line per row, + and − lines marked. Nothing but the diff. */
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="code diff" data-testid="change-diff" aria-label="the proposed diff">
      {lines.map((l, i) => (
        <div key={i} className={`line${l.startsWith("+") && !l.startsWith("+++") ? " add" : l.startsWith("-") && !l.startsWith("---") ? " del" : ""}`}>
          {l === "" ? " " : l}
        </div>
      ))}
    </pre>
  );
}

/**
 * S5 (day-6 review): a path from the diff is data, never part of Atlas's sentence: shown in a code element,
 * only characters a path needs, at most 120 of them.
 */
export function safePath(p: string | null): string {
  if (p === null) return "(none)";
  const clean = p.replace(/[^A-Za-z0-9._/-]/g, "?").slice(0, 120);
  return clean === "" ? "(empty)" : clean;
}

function DiffFiles({ diff }: { diff: string }) {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return null;
  return (
    <p className="muted small" data-testid="change-files">
      File changed:{" "}
      {parsed.files.map((f, i) => (
        <code key={i}>{safePath(f.newPath)}</code>
      ))}
    </p>
  );
}

export function ChangeResult({ answer, modelName, format = asStored }: { answer: ChangeAnswer; modelName?: string | null; format?: FormatValue }) {
  if (!answer.ok) {
    return (
      <div data-testid="change-refused">
        <p className="notice">{answer.reason}</p>
        {answer.toward && (
          <>
            <h3>What you expected (written by plain code from the sealed bets)</h3>
            <pre className="code toward">{answer.toward}</pre>
          </>
        )}
        {answer.diff && (
          <>
            <h3>The change plain code accepted (it did not replay)</h3>
            <DiffView diff={answer.diff} />
          </>
        )}
      </div>
    );
  }
  const label = (who: string) => (who === "human" ? "You" : (modelName ?? who.replace(/^model:/, "")));
  const by = answer.fixer.path === "muse-exec" ? `Muse Code (muse exec, ${answer.fixer.model})` : `${answer.fixer.model} (chat fallback: Muse Code gave no answer)`;
  const r = answer.replay;
  const checks = r.trace.at(-1)?.event === "replay_checks" ? (r.trace.at(-1)!.data as Record<string, unknown>) : undefined;
  const harness = checks?.harnessCheck as { passed?: boolean } | undefined;
  return (
    <div data-testid="change-result">
      <p className="caption label" data-testid="change-caption">
        {CHANGE_CAPTION}
      </p>
      <p className="muted small" data-testid="change-by">
        Proposed by {by}. Checked by plain code before it ran: only the allowed file, at most 200 lines, placed by Atlas's own reader and by git apply in a scratch copy (both
        must agree).
      </p>
      {answer.proof && !answer.proof.ok && (
        <p className="notice" data-testid="change-proof-refused">
          The change ran, but the proof file could not take it, so the proof card does not show it: {answer.proof.reason}
        </p>
      )}
      <DiffFiles diff={answer.diff} />
      <DiffView diff={answer.diff} />
      <table className="verdicts" data-testid="change-table">
        <thead>
          <tr>
            <th>question</th>
            <th>bettor</th>
            <th>sealed bet</th>
            <th>{BEFORE_LABEL}</th>
            <th>{AFTER_LABEL}</th>
          </tr>
        </thead>
        <tbody>
          {answer.bets.map((b) => (
            <tr key={b.id} data-testid={`change-row-${b.who === "human" ? "you" : "model"}-${b.measures}`}>
              <td>{b.question}</td>
              <td>{label(b.who)}</td>
              <td>{answerText(b)}</td>
              <OutcomeCell v={answer.before.verdicts.find((v) => v.betId === b.id)} format={format} measures={b.measures} testId={`before-${b.id}`} />
              <OutcomeCell v={answer.after.verdicts.find((v) => v.betId === b.id)} format={format} measures={b.measures} testId={`after-${b.id}`} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small" data-testid="change-same">
        {r.runner === "ts"
          ? `Same experiment, same seed (${answer.before.run.seed} → ${answer.after.run.seed}). The harness was checked on the original code first (${harness?.passed ? "matched its known cases" : "did not match its known cases, so every verdict is can't check"}).`
          : `Same experiment, same block (fork of Base at ${answer.before.run.forkBlock} → ${answer.after.run.forkBlock}), on a fresh fork. Judged by src/judge.ts.`}{" "}
        Run {answer.before.run.id} → replay {answer.after.run.id}.
      </p>
      {answer.passRule && (
        <>
          <h3>PASS-RULE.md, replay rule (plain code)</h3>
          <ul className="seals" data-testid="change-pass-rule">
            {answer.passRule.map((l) => (
              <li key={l.rule} data-outcome={l.outcome}>
                {l.rule}: <b>{l.outcome}</b>
                <div className="muted small">{l.detail}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {r.runner === "ts" ? <RetryMachine run={r} bets={answer.bets} verdicts={answer.after.verdicts} /> : <PricePipe run={r} bets={answer.bets} verdicts={answer.after.verdicts} />}
    </div>
  );
}

export function ChangePanel({ api, result, experimentId, modelName, format }: { api: Api; result: RunAnswer; experimentId: string; modelName?: string | null; format?: FormatValue }) {
  const [answer, setAnswer] = useState<ChangeAnswer | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useRunnerProgress(api.session(), experimentId, running);
  const ask = async () => {
    setRunning(true);
    setError(null);
    try {
      setAnswer(await api.change(result.run.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  return (
    <section className="card" aria-label="change and re-run" data-testid="change">
      <h2>5. Change it toward what you expected</h2>
      {!answer && (
        <>
          <p className="muted small">Muse Code proposes a change toward the bets that did not match. Atlas re-runs the same experiment on the changed code and judges the same sealed bets again. No new bets.</p>
          <button type="button" className="primary" onClick={ask} disabled={running}>
            Ask Muse Code for a change, then re-run
          </button>
        </>
      )}
      {running && (
        <div role="status">
          <p className="running">Muse Code is proposing a change; then Atlas re-runs…</p>
          {progress.length > 0 && (
            <ol className="progress">
              {progress.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {answer && <ChangeResult answer={answer} modelName={modelName ?? null} {...(format ? { format } : {})} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
