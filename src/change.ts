// Wording for a change and its replay, shared by the server and the page. No imports, no I/O.
//
// Atlas never calls a change a repair of anything: the code changed toward what the bettors
// expected, and the same experiment ran again. The verdicts say whether the same bets matched.

import type { Bet, Verdict } from "./types";
import { formatUsd1e18 } from "./units";

/** The caption under every before/after view. Templated by plain code, never a model's words. */
export const CHANGE_CAPTION = "changed toward what you expected, then re-run";
export const BEFORE_LABEL = "Before change";
export const AFTER_LABEL = "After change";

// ── toward: written by plain code from the sealed bets ──────────────────────────────────────────

function answerText(b: Bet): string {
  const a = b.answer;
  if (a.kind === "number") return `${a.value} ${a.unit} (match if within ${a.tolerancePct}% of what the run measures)`;
  if (a.kind === "declined") return "declined to guess";
  return String(a.value);
}

function observedText(measures: string, v: Verdict["observed"]): string {
  if (v === undefined) return "not measured";
  if (typeof v === "string" && measures.startsWith("priceUsd1e18:") && /^\d+$/.test(v)) return `${formatUsd1e18(BigInt(v))} USD`;
  return String(v);
}

/**
 * What the bettors expected, from the bets the run did NOT match (a matched bet asks for no change).
 * Returns null when no bet is left to move toward. One line per bet; plain code only.
 */
export function towardFromBets(bets: readonly Bet[], verdicts: readonly Verdict[], names: Record<string, string> = {}): string | null {
  const lines: string[] = [];
  for (const b of bets) {
    const v = verdicts.find((x) => x.betId === b.id);
    if (!v || v.outcome !== "not_matched") continue;
    const who = b.who === "human" ? "The person" : (names[b.who] ?? b.who.replace(/^model:/, ""));
    lines.push(`- ${who} bet on "${b.question}" (${b.measures}): ${answerText(b)}. The run measured: ${observedText(b.measures, v.observed)}.`);
  }
  return lines.length ? lines.join("\n") : null;
}
