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
import type { AtlasFile, Bet, BettorSlot, Outcome, Run, TargetKind } from "../../src/types";
import { canonicalJson } from "../../src/seal";
import { AUTONOMOUS_PERSON_REASON, orderModelBettors } from "../../src/claimants";
import { formatUsd1e18 } from "../../src/units";
import { appliedFeedActions, forkEventsWarning, level2Header } from "../../src/captions";

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
  target: { kind: TargetKind; ref: string; codeSha256: string; commit?: string };
  /** "seed tFjD64Wn2K (same seed = same run)" or "Base (chain 8453), fork block 42194662". */
  where: string;
  /** Level 2 / Level 1 for a Moonwell round, from the experiment's shape; absent otherwise. */
  level?: string;
  /** Final review M5: a plain warning when the fork's FeedSet events differ from the derived actions. */
  warning?: string;
  /** Final review S2: earlier attempts of this experiment that did not finish (never verdicts). */
  attempts: string[];
  controlPassed: boolean;
  /** Plain lines about the known-case check, read from the run. */
  controls: string[];
  /** R1 (D42): the run with its recorded pins and conditions, for the "conditions" line (absent before R1). */
  conditionsRun?: Pick<Run, "conditions" | "seed" | "timeZone" | "locale"> & { result: Pick<Run["result"], "notMeasured"> };
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
    case "json":
      // E1: a JSON answer is printed as the judge compares it (canonical JSON).
      return canonicalJson(a.value);
  }
}

/** What the run's own record says about its known-case check. Never more than the run holds. */
export function controlLines(run: Run): string[] {
  if (run.controlPassed !== true) {
    const why = run.result.notMeasured.control;
    return [`known-case check did not match${why ? `: ${why}` : ""}`];
  }
  const calls = run.trace.find((t) => t.event === "call_checks")?.data as { controlRunId?: unknown; controlFinishedAt?: unknown } | undefined;
  if (run.runner === "ts" && typeof calls?.controlFinishedAt === "string") {
    // D31: a call-function run relies on a control of Atlas's measuring code that may be up to 10 minutes old.
    const age = Math.max(0, Math.round((Date.parse(run.startedAt) - Date.parse(calls.controlFinishedAt)) / 1000));
    return [`known-case check of Atlas's measuring code matched at ${calls.controlFinishedAt} (control run ${String(calls.controlRunId ?? run.controlRunId ?? "?")}), ${age} s before this run`];
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
      : exp.params.shape === "call-function" && run.seed !== undefined && run.seed !== "none"
        ? // R1 (D42): the seed every random source drew from, and the pinned time zone and locale.
          `seed ${run.seed} · time zone ${run.timeZone ?? "?"} · locale ${run.locale ?? "?"} (same seed = same run); the virtual clock starts at 2026-01-01T00:00:00Z`
        : exp.params.shape === "call-function"
        ? // E3 (files from before R1): the run's seed field says "none"; nothing was seeded then.
          "no seed: this run is from before Atlas seeded randomness (code that uses Math.random or crypto was not seeded, so its replay can differ); the virtual clock starts at 2026-01-01T00:00:00Z"
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
    // Final review S5: the Level 2 header says what was applied (the proposal's oracle-feed actions only).
    ...(level ? { level: level === "level2" ? level2Header(appliedFeedActions(run)) : "Level 1: re-run after the fact" } : {}),
    ...(run.runner === "evm" && forkEventsWarning(run) ? { warning: forkEventsWarning(run)! } : {}),
    attempts: (file.attempts ?? []).map((a) => `attempt ${a.attempt} did not finish (${a.stoppedAt}): ${a.reason}`),
    controlPassed: run.controlPassed === true,
    controls: controlLines(run),
    ...(run.conditions !== undefined ? { conditionsRun: { conditions: run.conditions, result: { notMeasured: run.result.notMeasured }, ...(run.seed ? { seed: run.seed } : {}), ...(run.timeZone ? { timeZone: run.timeZone } : {}), ...(run.locale ? { locale: run.locale } : {}) } } : {}),
    notShownAsFact: notShownAsFact(run),
    captions: [...file.captions],
    bets,
    judgedBy: [...new Set(file.verdicts.map((v) => v.judgedBy))],
  };
}

/** What the card says about a replay: the same result, or the fields that differ. */
type ReplayCheck = { measuredEqual: boolean; resultDiff: string[]; sameOutcomes: boolean; controlPassed: boolean };
const oneRun = (r: ReplayCheck): { same: boolean; why: string } => {
  if (!r.controlPassed) return { same: false, why: "the known-case check did not match on the replay, so it can't check" };
  if (r.measuredEqual && r.resultDiff.length === 0 && r.sameOutcomes) return { same: true, why: "same result" };
  return { same: false, why: r.resultDiff.length > 0 ? `differs: ${r.resultDiff.join(", ")}` : r.measuredEqual ? "every measured field equal, but a verdict came out differently" : "measured fields differ" };
};

/**
 * The words under "Re-run it". S2 (day-6 review): on a card with a change, BOTH the original run and the
 * change replay are re-run; "same result ✓" only when both match, otherwise which one differed.
 */
export function replayWords(r: ReplayCheck & { changeReplay?: ReplayCheck | { error: string } }): { same: boolean; text: string } {
  const orig = oneRun(r);
  if (r.changeReplay === undefined) {
    if (!r.controlPassed) return { same: false, text: `replayed: ${orig.why}` };
    return orig.same ? { same: true, text: "replayed: same result ✓" } : { same: false, text: `replayed: the result ${orig.why === "measured fields differ" ? "differs (measured fields differ)" : orig.why.startsWith("differs") ? `differs (${orig.why.slice("differs: ".length)})` : `differs (${orig.why})`}` };
  }
  if ("error" in r.changeReplay) return { same: false, text: `replayed the original run (${orig.why}); the change replay could not be re-run: ${r.changeReplay.error}` };
  const ch = oneRun(r.changeReplay);
  if (orig.same && ch.same) return { same: true, text: "replayed both runs (before and after the change): same result ✓" };
  return { same: false, text: `replayed both runs: before the change, ${orig.why}; after the change, ${ch.why}` };
}

/**
 * Day-7 review M3/M7: one line per bettor of the round, including those who sealed nothing, for the
 * card's names-and-outcomes list and its counts table.
 * - A file with `bettors` (written since the day-7 review) says it directly.
 * - An older file: the bettors of its bets; a model whose claimant line in the file's own agent log says
 *   "no usable answer (…)" (plain code wrote that line; a network error is not a decline); and the person
 *   is "not asked" when the Adversary proposed the experiment (an autonomous round takes no person's bet).
 */
export interface BettorLine {
  who: string;
  status: BettorSlot["status"];
  /** Short plain reason for a bettor with no bets, e.g. "network error". */
  reason?: string;
  /** Outcome words for a bettor with bets, e.g. "didn't match" or "2 matched, 1 can't check". */
  outcomes?: string;
}

/** "the model call failed: network error (TypeError: fetch failed)" → "network error". Any other reason as is. */
export function shortSlotReason(reason: string): string {
  const m = /^the model call failed: ([^()]+?) \(/.exec(reason);
  return m ? m[1]!.trim() : reason;
}

/** The text inside the first balanced "(…)" that follows `prefix`, or null. */
function insideParens(text: string, prefix: string): string | null {
  if (!text.startsWith(prefix + "(")) return null;
  let depth = 0;
  for (let i = prefix.length; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(prefix.length + 1, i);
  }
  return null;
}

const ORDER: Outcome[] = ["matched", "not_matched", "cant_check"];

export function bettorLines(file: Pick<AtlasFile, "bets" | "verdicts" | "agentLog" | "experiments" | "bettors">): BettorLine[] {
  const slots: BettorSlot[] = [];
  if (file.bettors) slots.push(...file.bettors);
  else {
    if (file.experiments[0]?.proposedBy.role === "adversary" && !file.bets.some((b) => b.who === "human")) slots.push({ who: "human", status: "not_asked", reason: AUTONOMOUS_PERSON_REASON });
    for (const e of file.agentLog) {
      if (e.role !== "claimant" || !e.model) continue;
      const inner = insideParens(e.action, "no usable answer ");
      const who = `model:${e.model}` as const;
      if (inner !== null && !file.bets.some((b) => b.who === who) && !slots.some((s) => s.who === who)) slots.push({ who, status: "no_usable_answer", reason: inner });
    }
  }
  for (const b of file.bets) if (!slots.some((s) => s.who === b.who)) slots.push({ who: b.who, status: "sealed" });
  const models = orderModelBettors(slots.filter((s) => s.who !== "human").map((s) => s.who));
  const ordered = [...slots.filter((s) => s.who === "human"), ...models.map((w) => slots.find((s) => s.who === w)!)];
  return ordered.map((s) => {
    if (s.status !== "sealed") return { who: s.who, status: s.status, ...(s.reason ? { reason: shortSlotReason(s.reason) } : {}) };
    const mine = file.bets.filter((b) => b.who === s.who).map((b) => file.verdicts.find((v) => v.betId === b.id)?.outcome);
    const n = (o: Outcome) => mine.filter((x) => x === o).length;
    const parts = ORDER.filter((o) => n(o) > 0).map((o) => (mine.length === 1 ? SAY[o] : `${n(o)} ${SAY[o]}`));
    return { who: s.who, status: "sealed", outcomes: parts.join(", ") || "no verdict" };
  });
}

/** What a bettor line says after its name. */
export const bettorLineWords = (l: BettorLine): string =>
  l.status === "sealed" ? l.outcomes ?? "no verdict" : `${l.status === "not_asked" ? "not asked" : "no usable answer"}${l.reason ? ` (${l.reason})` : ""}`;
