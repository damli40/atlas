// R2 (D46): the timing rule, in one small module with no imports of its own, so the judge, the gate (bettor text)
// and the screens can all use it without an import cycle (judge -> quiz -> gate).
import type { Verdict } from "./types";

/** R2 (D46): the timing rule a verdict records. Absent on a verdict = the rule before D46 (tolerancePct only). */
export const TIMING_RULE = "d46" as const;
export type TimingRule = typeof TIMING_RULE;
/** R2 review round 1 (m2): the share D46 uses for a whole-number ms bet, which carries no tolerance of its own. */
export const TIMING_TOLERANCE_PCT = 10;
/** R2 review round 1 (m1): a timing bet below 0 ms is not a bet on anything a run can measure. */
export const NEGATIVE_TIMING = "a timing bet cannot be below 0 ms";
/** R2 (D46): the absolute floor of a timing match, in ms. */
export const TIMING_FLOOR_MS = 1;

/**
 * R2 (D46): a number bet's match rule in the words bettors see, the screen and every model alike: "within 10%", and
 * for ms "within 10% or 1 ms". `rule` null gives the words of the rule before D46 (for a verdict that records none).
 */
export function matchRuleWords(unit: string | undefined, tolerancePct: number, rule: TimingRule | null = TIMING_RULE): string {
  return unit === "ms" && rule === TIMING_RULE ? `within ${tolerancePct}% or ${TIMING_FLOOR_MS} ms` : `within ${tolerancePct}%`;
}

/** The same rule, short, for a table cell: "±10%", or for ms "±10% or 1 ms". */
export function toleranceShort(unit: string | undefined, tolerancePct: number, rule: TimingRule | null = TIMING_RULE): string {
  return `±${matchRuleWords(unit, tolerancePct, rule).slice("within ".length)}`;
}

/**
 * The rule to show next to a bet: the one its verdict recorded; a judged verdict without one was judged before D46;
 * no verdict yet, or can't check, shows today's rule.
 */
export function ruleShownFor(v: Pick<Verdict, "outcome" | "timingRule"> | undefined): TimingRule | null {
  if (v?.timingRule) return v.timingRule;
  return v && v.outcome !== "cant_check" ? null : TIMING_RULE;
}


