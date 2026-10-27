// The proof card's content, as a pure function of one .atlas.json (D06-03). No drawing, no I/O.
//
// Plain words: the card is the end frame of a round. Everything on it is read from the file: who bet
// what (with the Meta model id), what plain code measured, how each bet came out (src/judge.ts's
// verdicts), the code's fingerprint, where it ran (seed or fork block), whether the known-case check
// matched first, the captions the file carries, and every sealed hash, re-hashed here in the browser.
// The card never says whether code is "good"; only whether each bet matched what the code did.

import { moonwellLevelOf } from "../../src/bet-context";
import { verifySeal } from "../../src/seal";
import { notShownAsFact } from "../../src/trust";
import type { AtlasFile, Bet, Outcome, Run } from "../../src/types";
import { formatUsd1e18 } from "../../src/units";

export const SAY: Record<Outcome, string> = { matched: "matched", not_matched: "didn't match", cant_check: "can't check" };

export interface CardBet {
  betId: string;
  who: string;
  measures: string;
  question: string;
  said: string;
  observed: string;
  outcome: Outcome | null;
  reason?: string;
  sealedHash: string;
  sealedAt: string;
  /** The hash recomputed in this browser from the bet's revealed fields equals the one in the file. */
  sealHolds: boolean;
}

export interface ProofCardModel {
  runId: string;
  createdAt: string;
  target: { kind: "ts-fixture" | "github-pr"; ref: string; codeSha256: string; commit?: string };
  /** "seed tFjD64Wn2K (same seed = same run)" or "Base (chain 8453), fork block 42194662". */
  where: string;
  /** Level 2 / Level 1 for a Moonwell round, from the experiment's shape; absent otherwise. */
  level?: string;
  controlPassed: boolean;
  /** Plain lines about the known-case check, read from the run. */
  controls: string[];
  /** src/trust.ts: when not null, nothing from the run is shown as fact; the card shows this instead. */
  notShownAsFact: string | null;
  captions: string[];
  bets: CardBet[];
  judgedBy: string[];
}

const isUsdField = (m: string) => /^(priceUsd1e18|preApplyPriceUsd1e18|refUsd1e18):/.test(m);

/** A measured value as the card prints it: USD fields formatted by src/units.ts, others as recorded. */
export function showValue(measures: string, v: unknown): string {
  if (v === undefined || v === null) return "not measured";
  if (isUsdField(measures) && typeof v === "string" && /^-?\d+$/.test(v)) return formatUsd1e18(BigInt(v));
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}

export function showAnswer(b: Pick<Bet, "answer">): string {
  const a = b.answer;
  switch (a.kind) {
    case "declined":
      return "declined to guess";
    case "integer":
      return a.value.toLocaleString("en-US");
    case "enum":
      return a.value;
    case "number":
      return a.unit === "USD" ? `$${a.value.toLocaleString("en-US")} (±${a.tolerancePct}%)` : `${a.value} ${a.unit} (±${a.tolerancePct}%)`;
  }
}

/** What the run's own record says about its known-case check. Never more than the run holds. */
export function controlLines(run: Run): string[] {
  if (run.controlPassed !== true) {
    const why = run.result.notMeasured.control;
    return [`known-case check did not match${why ? `: ${why}` : ""}`];
  }
  if (run.runner === "ts") {
    return [`known-case check matched before this run, on the same code bytes${run.controlRunId ? ` (control run ${run.controlRunId})` : ""}`];
  }
  const ev = run.trace.find((t) => t.event === "control_matched");
  const ctl = (ev?.data as { control?: { weth?: { matched?: unknown }; stablecoins?: { inBand?: unknown }[] }; postStablecoins?: { inBand?: unknown }[] } | undefined) ?? {};
  const out: string[] = [];
  if (ctl.control?.weth?.matched === true) out.push("WETH read equals its Chainlink feed at the same block");
  const st = ctl.control?.stablecoins;
  if (Array.isArray(st) && st.length > 0) out.push(`${st.filter((s) => s.inBand === true).length} of ${st.length} stablecoins inside the $1 band before`);
  const post = ctl.postStablecoins;
  if (Array.isArray(post) && post.length > 0) out.push(`${post.filter((s) => s.inBand === true).length} of ${post.length} inside the band after`);
  return out.length > 0 ? out : ["known-case check matched on the same fork (recorded in this run's trace)"];
}

export function proofCardModel(file: AtlasFile): ProofCardModel {
  const run = file.runs[0]!;
  const exp = file.experiments.find((e) => e.id === run.experimentId) ?? file.experiments[0]!;
  const level = moonwellLevelOf(exp.params.shape);
  const where =
    run.runner === "evm"
      ? `Base (chain ${run.chainId ?? file.chainId ?? "?"}), fork block ${run.forkBlock ?? file.forkBlock ?? "?"}`
      : `seed ${run.seed ?? file.seed ?? "?"} (same seed = same run)`;
  const bets: CardBet[] = file.bets.map((b) => {
    const v = file.verdicts.find((x) => x.betId === b.id);
    let holds = false;
    try {
      holds = verifySeal(b);
    } catch {
      holds = false;
    }
    return {
      betId: b.id,
      who: b.who,
      measures: b.measures,
      question: b.question,
      said: showAnswer(b),
      observed: showValue(b.measures, v?.observed ?? run.result.measured[b.measures]),
      outcome: v?.outcome ?? null,
      ...(v?.reason ? { reason: v.reason } : {}),
      sealedHash: b.sealedHash,
      sealedAt: b.sealedAt,
      sealHolds: holds,
    };
  });
  return {
    runId: run.id,
    createdAt: file.createdAt,
    target: { kind: file.target.kind, ref: file.target.ref, codeSha256: file.target.codeSha256, ...(file.target.commit ? { commit: file.target.commit } : {}) },
    where,
    ...(level ? { level: level === "level2" ? "Level 2: fork one block before the proposal ran, proposal applied" : "Level 1: re-run after the fact" } : {}),
    controlPassed: run.controlPassed === true,
    controls: controlLines(run),
    notShownAsFact: notShownAsFact(run),
    captions: [...file.captions],
    bets,
    judgedBy: [...new Set(file.verdicts.map((v) => v.judgedBy))],
  };
}

/** What the card says about a replay: the same result, or the fields that differ. */
export function replayWords(r: { measuredEqual: boolean; resultDiff: string[]; sameOutcomes: boolean; controlPassed: boolean }): { same: boolean; text: string } {
  if (!r.controlPassed) return { same: false, text: "replayed: the known-case check did not match on the replay, so it can't check" };
  if (r.measuredEqual && r.resultDiff.length === 0 && r.sameOutcomes) return { same: true, text: "replayed: same result ✓" };
  const diff = r.resultDiff.length > 0 ? r.resultDiff.join(", ") : r.measuredEqual ? "every measured field equal, but a verdict came out differently" : "measured fields differ";
  return { same: false, text: `replayed: the result differs (${diff})` };
}
