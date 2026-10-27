// D04-04: one round on a pull request link (Moonwell PR #578, MIP-X43), on the EVM runner.
// link → the server reads the PR at its merge commit → a finding (the Investigator's, or lines the
// person picks) → the plain-code question about cbETH → the person's sealed bet, and Muse Spark's
// sealed beside it (hashes only) → a real run on a fork of Base (30–90 s, progress from the agent
// log) → verdicts by src/judge.ts → the false-alarm table → the captions this kind of run must carry.

import { ProofLink } from "./ProofCard";
import { useState } from "react";
import { MOONWELL_FORK_BLOCKS, MOONWELL_LEVEL_CAPTION, MOONWELL_LEVEL_SAYS, MOONWELL_LICENCE_LINE, moonwellBetContext, type MoonwellLevel } from "../../src/bet-context";
import type { Question } from "../../src/gate";
import type { Finding } from "../../src/types";
import { formatUsd1e18 } from "../../src/units";
import { rowWords, tableCounts } from "../../src/falsealarm";
import type { Api, FalseAlarmRow, PrTarget, RunAnswer, ShownBet } from "../api";
import { useModelSlots, verdictColumns } from "./Claimant";
import { useRunnerProgress } from "../progress";
import { ShortHash } from "./Bets";
import { FindingsPanel } from "./Findings";
import { ModelSlotCard } from "./ModelPanel";
import { VerdictScreen, type FormatValue } from "./Verdict";
import { modelTextsOf, WhyScreen } from "./Why";
import { notShownAsFact } from "../../src/trust";
import { PricePipe } from "../machines/pricepipe/PricePipe";
import { ChangePanel } from "./Change";
import { AdversaryPanel } from "./Adversary";

export const PR_FORK_BLOCK = { level2: MOONWELL_FORK_BLOCKS.level2.block, level1: MOONWELL_FORK_BLOCKS.level1.block } as const;

const LEVELS = {
  level2: {
    label: "Before it shipped (Level 2)",
    says: MOONWELL_LEVEL_SAYS.level2,
    params: { shape: "apply-proposal-then-read", markets: "touched" },
    caption: MOONWELL_LEVEL_CAPTION.level2,
  },
  level1: {
    label: "After the fact (Level 1)",
    says: MOONWELL_LEVEL_SAYS.level1,
    params: { shape: "price-read", markets: ["cbETH"] },
    caption: MOONWELL_LEVEL_CAPTION.level1,
  },
} as const;
type Level = MoonwellLevel;

/** "https://github.com/o/r/pull/578", "github.com/o/r/pull/578/files" or "o/r#578" → "o/r#578". */
export function prRefFromLink(link: string): string | null {
  const t = link.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(t);
  if (url) return `${url[1]}/${url[2]}#${url[3]}`;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(t) ? t : null;
}

const usd: FormatValue = (m, v) => (/^(priceUsd1e18|preApplyPriceUsd1e18|refUsd1e18):/.test(m) && typeof v === "string" && /^-?\d+$/.test(v) ? formatUsd1e18(BigInt(v)) : String(v));
const usdOf = (v: string | null) => (v === null ? "not read" : formatUsd1e18(BigInt(v)));

export function MoonwellFlow({ api }: { api: Api }) {
  const [link, setLink] = useState("");
  const [target, setTarget] = useState<PrTarget | null>(null);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [level, setLevel] = useState<Level>("level2");
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answer, setAnswer] = useState("");
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const models = useModelSlots(api);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useRunnerProgress(api.session(), experimentId, running);

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

  const read = () =>
    step(async () => {
      const ref = prRefFromLink(link);
      if (!ref) throw new Error("paste a pull request link like https://github.com/owner/repo/pull/123");
      setTarget(await api.prTarget(ref));
    });

  const ask = () =>
    step(async () => {
      if (!target || !finding) return;
      const out = await api.experiment(target, LEVELS[level].params, finding.id);
      setExperimentId(out.experiment.id);
      setQuestions(out.questions);
      models.fromExperiment(out);
    });

  const seal = () =>
    step(async () => {
      if (!experimentId) return;
      const q = questions[0]!;
      const n = Number(answer.trim());
      if (answer.trim() === "" || !Number.isFinite(n) || n < 0) throw new Error(`"${q.text}" needs a number of US dollars`);
      const set = await api.bets(experimentId, [{ measures: q.measures, answer: { kind: "number", value: n } }]);
      setSealed(set);
    });

  const run = async () => {
    if (!experimentId) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.run(experimentId);
      models.fromRun(r);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const q = questions[0];
  const m = result?.run.result.measured;
  const fileOf = (path: string) => target?.files.find((f) => f.path === path)?.text;
  return (
    <>
      <section className="card" aria-label="pull request">
        <h2>Paste a pull request link</h2>
        <div className="row">
          <input data-testid="pr-link" className="link" type="text" placeholder="https://github.com/owner/repo/pull/123" value={link} disabled={!!target || busy} onChange={(e) => setLink(e.target.value)} />
          {!target && (
            <button type="button" onClick={read} disabled={busy || link.trim() === ""}>
              Read it
            </button>
          )}
        </div>
        {target && (
          <p className="muted" data-testid="pr-target">
            <b>{target.ref}</b> · {target.title} · merge commit <code>{target.commit?.slice(0, 10)}</code> · {target.files.length} files · code fingerprint <ShortHash hash={target.codeSha256} />
            <br />
            <span className="small">{MOONWELL_LICENCE_LINE}</span>
          </p>
        )}
      </section>

      {target && <FindingsPanel api={api} target={target} chosen={finding} onChoose={setFinding} locked={experimentId !== null} allowPick />}

      {target && (
        <section className="card" aria-label="bet">
          <h2>Place your bet</h2>
          <fieldset disabled={experimentId !== null || busy}>
            {(Object.keys(LEVELS) as Level[]).map((k) => (
              <label key={k} className="choice">
                <input type="radio" name="level" value={k} checked={level === k} onChange={() => setLevel(k)} />
                <span>
                  <b>{LEVELS[k].label}</b> {LEVELS[k].says}
                </span>
              </label>
            ))}
          </fieldset>
          <p className="label caption" data-testid="level-caption">
            {LEVELS[level].caption}
          </p>
          {!experimentId && (
            <button type="button" onClick={ask} disabled={busy || !finding}>
              {finding ? "Show the question" : "Choose a place in the code first"}
            </button>
          )}
          {q && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (sealed.length === 0) seal();
              }}
            >
              {finding && fileOf(finding.file) !== undefined && (
                <details className="small">
                  <summary>What you know before betting. Each Meta model that bets (Muse Spark, and Muse Spark Open when chosen) gets exactly this text, nothing more (no prices).</summary>
                  <pre className="code" data-testid="bet-context">
                    {moonwellBetContext({ level, question: q, finding, fileText: fileOf(finding.file)!, pr: { ref: target.ref, title: target.title, ...(target.commit !== undefined ? { commit: target.commit } : {}), fileCount: target.files.length, codeSha256: target.codeSha256 } })}
                  </pre>
                </details>
              )}
              <div className="question">
                <label htmlFor="bet-usd">{q.text}</label>
                <p className="muted small">Written by plain code (src/gate.ts). Each Meta model that bets answers the same question. Matched means within {q.tolerancePct}% of what the run reads.</p>
                <input id="bet-usd" data-testid="bet-usd" type="number" inputMode="decimal" min={0} step="any" value={answer} disabled={sealed.length > 0 || busy} onChange={(e) => setAnswer(e.target.value)} /> USD
                {sealed[0] && (
                  <p className="sealed">
                    sealed at {sealed[0].sealedAt} · hash <ShortHash hash={sealed[0].sealedHash} testId="hash-usd" />
                  </p>
                )}
              </div>
              {sealed.length === 0 && (
                <button type="submit" disabled={busy || answer.trim() === ""}>
                  Seal my bet
                </button>
              )}
            </form>
          )}
        </section>
      )}

      {models.slots.map((slot) => (
        <ModelSlotCard key={slot.who} slot={slot} revealed={result ? result.bets.filter((b) => b.who === slot.who) : null} />
      ))}

      {sealed.length > 0 && (
        <section className="card" aria-label="run">
          <h2>Run it</h2>
          {!result && (
            <button type="button" className="primary" onClick={run} disabled={running || busy || models.thinking}>
              Run it on a fork of Base
            </button>
          )}
          {running && (
            <div role="status" data-testid="run-progress">
              <p className="running">Running on a fork of Base. This takes 30–90 seconds.</p>
              <ol className="progress small">
                {progress.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          )}
          {result && m && (
            <dl className="facts" data-testid="run-facts">
              <dt>run</dt>
              <dd>
                {result.run.id} · fork of Base at block {result.run.forkBlock} · chain {result.run.chainId}
              </dd>
              <dt>known-case check first</dt>
              <dd>{result.run.controlPassed ? "passed (WETH exact, USD stablecoins about $1)" : "did not pass, so every verdict is can't check"}</dd>
              <dt>cbETH, read</dt>
              <dd>{notShownAsFact(result.run) !== null ? `nothing shown: ${notShownAsFact(result.run)}` : typeof m["priceUsd1e18:cbETH"] === "string" ? usd("priceUsd1e18:cbETH", m["priceUsd1e18:cbETH"]) : "not read"}</dd>
              {notShownAsFact(result.run) === null && typeof m["priceSources:cbETH"] === "number" && (
                <>
                  <dt>price sources</dt>
                  <dd>cbETH's read touched {m["priceSources:cbETH"]} price source(s) (call trace). Observed, not part of the pre-registered rule: PASS-RULE.md counts sources only after a proposed change.</dd>
                </>
              )}
            </dl>
          )}
        </section>
      )}

      {result && result.run.runner === "evm" && <PricePipe run={result.run} bets={result.bets} verdicts={result.verdicts} />}

      {result && (
        <VerdictScreen
          shown={sealed}
          typed={q ? { [q.measures]: answer } : undefined}
          modelShown={[]}
          modelName={null}
          models={verdictColumns(models.slots)}
          result={result}
          format={usd}
        />
      )}

      {result?.falseAlarm && <FalseAlarmTable rows={result.falseAlarm} />}

      {result?.proof && (
        <section className="card" aria-label="captions" data-testid="captions">
          <h2>Read with this run</h2>
          {result.proof.ok ? (
            <>
              <ul>
                {result.proof.captions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="muted small">
                .atlas.json for run {result.proof.runId}: {result.proof.published ? "written to the proofs folder" : "kept on the server (not published)"}. Anyone can replay it at /replay/{result.proof.runId}.
              </p>
              <ProofLink runId={result.proof.runId} />
            </>
          ) : (
            <p className="notice">The .atlas.json could not be built: {result.proof.reason}</p>
          )}
        </section>
      )}

      {result && <WhyScreen run={result.run} finding={finding} modelTexts={modelTextsOf(result.bets, finding)} />}

      {result && experimentId && result.run.runner === "evm" && (
        <ChangePanel api={api} result={result} experimentId={experimentId} format={usd} />
      )}

      {result && result.run.runner === "evm" && <AdversaryPanel api={api} runId={result.run.id} format={usd} />}

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function FalseAlarmTable({ rows }: { rows: FalseAlarmRow[] }) {
  // PASS-RULE.md: when the run's control did not pass, every flag on it is "can't check".
  const n = tableCounts(rows);
  const controlFailed = !n.controlPassed;
  const cb = n.cbEthFlagged === null ? "cbETH can't check" : n.cbEthFlagged ? "cbETH flagged" : "cbETH not flagged";
  const summary = controlFailed
    ? "can't check (control did not pass)"
    : `${cb} (rule 1); of the other ${n.markets - (rows.some((r) => r.market === "cbETH") ? 1 : 0)}: ${n.within2Pct} within 2% of their price before${n.unchanged ? ` (${n.unchanged} of them exactly unchanged)` : ""}, ${n.movedMoreThan2Pct} moved more than 2%${n.cantCheck ? `, ${n.cantCheck} can't check` : ""} (rule 2)`;
  return (
    <section className="card" aria-label="false-alarm table" data-testid="false-alarm">
      <h2>Every market the proposal touches</h2>
      {controlFailed && (
        <p className="notice" data-testid="fa-control-failed">
          The control did not pass, so every flag on this run is "can't check". {rows.find((r) => r.note)?.note ?? ""}
        </p>
      )}
      <p className="muted" data-testid="fa-summary">
        {rows.length} markets: {summary}. Rule 1: cbETH is flagged when its price after the proposal differs by more than 50% from the raw Chainlink price (ETH/USD × cbETH/ETH, same block). Rule 2: no other market may be flagged when its price after is within 2% of its price before, at the same block.
      </p>
      <table className="verdicts">
        <thead>
          <tr>
            <th>market</th>
            <th>before</th>
            <th>after</th>
            <th>compared with</th>
            <th>difference</th>
            <th>what the rule says</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.market} data-testid={`fa-${r.market}`} className={r.controlPassed === true && r.flagged ? "flagged" : undefined}>
              <td>{r.market}</td>
              <td>{usdOf(r.preUsd1e18)}</td>
              <td>{usdOf(r.postUsd1e18)}</td>
              <td>{r.market === "cbETH" ? `raw Chainlink ${usdOf(r.flagReferenceUsd1e18)}` : "its price before"}</td>
              <td>{r.diffVsFlagReferencePct ?? "-"}</td>
              <td>{r.flagged === true && r.controlPassed ? <b>{rowWords(r)}</b> : rowWords(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
