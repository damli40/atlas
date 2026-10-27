// Screen 3: one row per question, one column per bettor ("You" and the model, by name). The verdict
// comes from src/judge.ts on the server; the seal check is done HERE, in the browser: it recomputes
// sha256(canonicalJson(revealed bet)) with src/seal.ts and compares it to the hash this page showed
// before the run (kept from the seal step, not taken from the run's answer). Model bets are checked
// the same way, against the hashes the page showed while their answers were still hidden.

import { computeSealHash } from "../../src/seal";
import type { Bet, Outcome, Verdict } from "../../src/types";
import type { RunAnswer, SealedOnly } from "../api";
import { ShortHash } from "./Bets";
import { Scoreboard } from "../machines/scoreboard/Scoreboard";
import { BettorCounts } from "./Claimant";

const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

/** A bet as shown before the run: at least its id, who, measures and hash. */
type ShownBefore = Pick<SealedOnly, "id" | "who" | "measures" | "sealedHash">;

export interface SealCheck {
  betId: string;
  shownHash: string;
  recomputed: string;
  match: boolean;
  sealedBeforeRun: boolean;
  /** True for a revealed bet whose hash this page never displayed before the run. */
  notShown?: boolean;
}

/**
 * The browser's own check of every revealed bet against the hash it displayed before the run.
 * One line per bet shown before the run, then one per revealed bet the page never showed (a bet the
 * server judged that this page did not see sealed): those always fail, because the page cannot vouch
 * for a hash it never displayed.
 */
export function checkSeals(shown: ShownBefore[], result: RunAnswer): SealCheck[] {
  const out: SealCheck[] = shown.map((s) => {
    const revealed = result.bets.find((b) => b.id === s.id);
    let recomputed = "";
    try {
      recomputed = revealed ? computeSealHash(revealed) : "";
    } catch {
      recomputed = "";
    }
    return {
      betId: s.id,
      shownHash: s.sealedHash,
      recomputed,
      match: recomputed !== "" && recomputed === s.sealedHash,
      sealedBeforeRun: revealed !== undefined && Date.parse(revealed.sealedAt) < Date.parse(result.run.startedAt),
    };
  });
  for (const b of result.bets) {
    if (shown.some((s) => s.id === b.id)) continue;
    let recomputed = "";
    try {
      recomputed = computeSealHash(b);
    } catch {
      recomputed = "";
    }
    out.push({ betId: b.id, shownHash: "", recomputed, match: false, sealedBeforeRun: Date.parse(b.sealedAt) < Date.parse(result.run.startedAt), notShown: true });
  }
  return out;
}

function answerText(b: Bet | undefined): string {
  if (!b) return "-";
  if (b.answer.kind === "number") return `${b.answer.value} ${b.answer.unit} (±${b.answer.tolerancePct}%)`;
  return b.answer.kind === "declined" ? "declined" : String(b.answer.value);
}

/** D04-04: a stored value for the screen. USD 1e18 prices become dollars; everything else as stored. */
export type FormatValue = (measures: string, value: string | number | boolean | null) => string;
const asStored: FormatValue = (_m, v) => String(v);

export interface VerdictProps {
  /** The person's bets as shown before the run. */
  shown: ShownBefore[];
  /** What the person typed, by measured field: the page checks the server sealed exactly that. */
  typed?: Record<string, string>;
  /** The model's bets as shown before the run (hashes only). Empty when it gave no usable answer. */
  modelShown: ShownBefore[];
  /** The model's column heading, e.g. "Muse Spark 1.3 (muse-spark-1.3)"; null when no model was asked. */
  modelName: string | null;
  /** Shown in the model's column when it has no bets (e.g. "no usable answer (…)"). */
  modelEmpty?: string;
  /**
   * D07-01: one column per model, in order (Muse Spark, Muse Spark Open). When given, it replaces
   * modelShown / modelName / modelEmpty. `shown`: that model's hashes as shown before the run.
   */
  models?: ModelColumn[];
  result: RunAnswer;
  /** How to show observed and reference values (default: as stored). */
  format?: FormatValue;
}

function Cell({ bet, verdict, testId }: { bet: Bet | undefined; verdict: Verdict | undefined; testId: string }) {
  if (!bet) return <td data-testid={testId}>-</td>;
  const outcome = verdict?.outcome ?? "cant_check";
  return (
    <td className={`verdict ${outcome}`} data-testid={testId} data-outcome={outcome}>
      {answerText(bet)} · <b>{SAY[outcome]}</b>
      {verdict?.reason && <span className="muted small"> ({verdict.reason})</span>}
    </td>
  );
}

export interface ModelColumn {
  who: string;
  name: string;
  shown: ShownBefore[];
  empty?: string;
}

/** The legacy single-model props as columns: the named model, plus any judged model the page did not name. */
function legacyColumns(modelShown: ShownBefore[], modelName: string | null, modelEmpty: string | undefined, judgedModel: Bet[]): ModelColumn[] {
  const whos = [...new Set([...modelShown.map((b) => b.who), ...judgedModel.map((b) => b.who)])];
  if (whos.length === 0) return modelName !== null ? [{ who: "", name: modelName, shown: [], ...(modelEmpty !== undefined ? { empty: modelEmpty } : {}) }] : [];
  return whos.map((who, i) => ({ who, name: i === 0 ? (modelName ?? who) : who, shown: modelShown.filter((b) => b.who === who), ...(i === 0 && modelEmpty !== undefined ? { empty: modelEmpty } : {}) }));
}

/** testids: the first model keeps the original ids ("verdict-model-<field>"); later ones add their position. */
const colTag = (i: number) => (i === 0 ? "model" : `model${i + 1}`);

export function VerdictScreen({ shown, typed, modelShown, modelName, modelEmpty, models, result, format = asStored }: VerdictProps) {
  // The table shows the JUDGED bets (the run's revealed set), so the page and the server agree on it.
  const judgedYou = result.bets.filter((b) => b.who === "human");
  const judgedModel = result.bets.filter((b) => b.who !== "human");
  const cols = models ?? legacyColumns(modelShown, modelName, modelEmpty, judgedModel);
  // A judged model bet whose bettor has no column still gets one (never hidden).
  for (const b of judgedModel) if (!cols.some((c) => c.who === b.who)) cols.push({ who: b.who, name: b.who, shown: [] });
  const shownBefore = [...shown, ...cols.flatMap((c) => c.shown)];
  const checks = checkSeals(shownBefore, result);
  const verdictOf = (id: string | undefined) => (id ? result.verdicts.find((v) => v.betId === id) : undefined);
  const measures = [...new Set([...shown.map((b) => b.measures), ...judgedYou.map((b) => b.measures), ...shownBefore.map((b) => b.measures), ...judgedModel.map((b) => b.measures)])];
  const label = (who: string) => (who === "human" ? "You" : (cols.find((c) => c.who === who)?.name ?? who));
  const names = Object.fromEntries(cols.filter((c) => c.who !== "").map((c) => [c.who, c.name]));
  // D04-04: a reference column when the runner computed one (EVM: the raw-Chainlink price, same block).
  const showReference = result.verdicts.some((v) => v.reference !== undefined);
  return (
    <section className="card" aria-label="verdicts">
      <h2>4. Whose bet matched</h2>
      <Scoreboard verdicts={result.verdicts} bets={result.bets} names={names} />
      {cols.length > 1 && <BettorCounts verdicts={result.verdicts} bets={result.bets} names={names} columns={cols.map((c) => c.who)} />}
      <table className="verdicts">
        <thead>
          <tr>
            <th>question</th>
            <th>You</th>
            {cols.map((col) => (
              <th key={col.who || col.name}>{col.name}</th>
            ))}
            <th>observed</th>
            {showReference && <th>reference</th>}
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => {
            const youBet = judgedYou.find((b) => b.measures === m);
            const modelBets = cols.map((col) => judgedModel.find((b) => b.who === col.who && b.measures === m));
            const modelBet = modelBets.find((b) => b !== undefined);
            const v = verdictOf(youBet?.id) ?? verdictOf(modelBet?.id);
            return (
              <tr key={m} data-testid={`verdict-${m}`}>
                <td>{youBet?.question ?? modelBet?.question ?? m}</td>
                <Cell bet={youBet} verdict={verdictOf(youBet?.id)} testId={`verdict-you-${m}`} />
                {cols.map((col, i) => {
                  const mb = modelBets[i];
                  return mb ? (
                    <Cell key={col.who || col.name} bet={mb} verdict={verdictOf(mb.id)} testId={`verdict-${colTag(i)}-${m}`} />
                  ) : (
                    <td key={col.who || col.name} className="muted small" data-testid={`verdict-${colTag(i)}-${m}`}>
                      {col.empty ?? "no bet"}
                    </td>
                  );
                })}
                <td data-testid={`observed-${m}`}>
                  {v?.observed === undefined ? "-" : format(m, v.observed)}
                  <div className="muted small">judged by {v?.judgedBy ?? "src/judge.ts"}</div>
                </td>
                {showReference && (
                  <td data-testid={`reference-${m}`}>
                    {v?.reference ? format(m, v.reference.value) : "-"}
                    {v?.reference && <div className="muted small">{v.reference.method}</div>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Seal check (done by this page, for every bettor)</h3>
      <ul className="seals">
        {checks.map((c) => {
          const b = shownBefore.find((x) => x.id === c.betId) ?? result.bets.find((x) => x.id === c.betId)!;
          const ci = cols.findIndex((col) => col.who === b.who);
          const testId = b.who === "human" ? `seal-check-${b.measures}` : `seal-check-${colTag(Math.max(0, ci))}-${b.measures}`;
          const revealed = result.bets.find((x) => x.id === c.betId);
          // The server sealed what the person typed? (The page kept its own copy of the answer.)
          const typedRaw = b.who === "human" && typed ? typed[b.measures]?.trim() : undefined;
          const typedOk =
            typedRaw === undefined ||
            (revealed !== undefined &&
              revealed.answer.kind !== "declined" &&
              (revealed.answer.kind === "number" ? Number(typedRaw) === revealed.answer.value : String(revealed.answer.value) === typedRaw));
          return (
            <li key={c.betId} data-testid={testId} data-match={c.match && typedOk ? "yes" : "no"}>
              {label(b.who)}, {b.measures}:{" "}
              {c.notShown ? (
                <b>✗ judged, but this page never showed its hash before the run</b>
              ) : (
                <>
                  shown <ShortHash hash={c.shownHash} /> · recomputed {c.recomputed ? <ShortHash hash={c.recomputed} /> : "nothing to recompute"} ·{" "}
                  <b>{c.match ? "✓ match" : "✗ mismatch"}</b>
                </>
              )}{" "}
              · {c.sealedBeforeRun ? "sealed before the run started" : "NOT sealed before the run started"}
              {typedRaw !== undefined && <> · {typedOk ? "the answer you typed" : <b>NOT the answer you typed ({typedRaw})</b>}</>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
