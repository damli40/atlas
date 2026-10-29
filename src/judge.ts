// The judge. Plain code decides whether a sealed bet matched what a run measured.
//
// Pure and synchronous: no I/O, no clock, no randomness, no model. Same bet + same run
// always gives the same verdict. It reads only run.controlPassed, run.experimentId,
// run.result.measured[bet.measures], run.result.notMeasured and run.result.references.
//
// Outcomes are only "matched", "not_matched" or "cant_check". When the judge cannot
// compare honestly it says "cant_check" with a plain reason; it never guesses.
//
// It refuses (cant_check) when:
// - the run's control did not pass, or there is no control result (only controlPassed === true counts);
// - the bet's kind or unit is not the measured field's unit (src/units.ts holds the one table);
// - an enum bet's answer, or the observed value, is not one of the bet's options;
// - (added E1) the run says nothing in it counts (`notMeasured.wholeRun`: the code needed a package, the
//   sandbox refused an access, the export was missing, ...): every bet on it, whatever it is about;
// - (added E1) a json bet's value is not plain JSON, or the run stored the field as anything but JSON text.
//
// A json bet matches when its value, written as canonical JSON (src/seal.ts), is exactly the text the
// runner stored. Canonical JSON sorts keys, so {"a":1,"b":2} and {"b":2,"a":1} are the same answer.
//
// Tolerance is a share of the OBSERVED value. So when the observed value is 0, only a bet of
// exactly 0 can match, at any tolerance; this follows from the rule and is intended.
//
// R2 (D46), timing bets near zero: a bet in ms (a number, or a whole number) matches when
// |bet - measured| <= max(10% of measured, 1 ms) (a number bet uses its question's tolerancePct, 10% for
// virtualMs). A bet below 0 ms is can't check. Every verdict judged with this rule says so
// (`timingRule: "d46"`). A proof file says which rules it was made under (`rules`, src/atlasfile.ts);
// verify re-judges every verdict under those rules, so an old file keeps the rule before D46. USD bets
// and quiz ranges are unchanged.

import type { Bet, Run, Verdict } from "./types";
import { canonicalJson } from "./seal";
import { quizMembership } from "./quiz";
import { ENUM_FIELD_OPTION_SETS, alignDecimals, measuredUnit, parseExactDecimal, usdToUsd1e18, type ExactDecimal } from "./units";

const USD_1E18_PREFIX = "priceUsd1e18:";
const REF_USD_1E18_PREFIX = "refUsd1e18:";
const DECIMAL_INTEGER_RE = /^-?\d+$/;

type Observed = Verdict["observed"];
type Reference = Verdict["reference"];

function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  if (!record || !Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return record[key];
}

function findReference(run: Run, measures: string): Reference {
  const refs = run.result.references;
  // A price field's reference lives only under its refUsd1e18: key. No fallback to the measured
  // key itself, which could attach a value that was never computed as an independent reference.
  if (measures.startsWith(USD_1E18_PREFIX)) return own(refs, REF_USD_1E18_PREFIX + measures.slice(USD_1E18_PREFIX.length));
  return own(refs, measures);
}

/**
 * |observed − value| × 100 ≤ tolerancePct × |observed|, in exact decimal arithmetic.
 * The tolerance is a share of the OBSERVED value, never of the bet.
 */
function withinTolerance(observed: ExactDecimal, value: ExactDecimal, tolerancePct: ExactDecimal): boolean {
  const [o, v] = alignDecimals(observed, value);
  const diff = o >= v ? o - v : v - o;
  const absO = o < 0n ? -o : o;
  const tol = tolerancePct.digits;
  // diff * 100 * 10^tolScale <= tol * |o|   (both sides at the same scale as o and v)
  return diff * 100n * 10n ** BigInt(tolerancePct.scale) <= tol * absO;
}

export { TIMING_RULE, TIMING_TOLERANCE_PCT, TIMING_FLOOR_MS, matchRuleWords, toleranceShort, ruleShownFor, type TimingRule } from "./timing-rule";
import { NEGATIVE_TIMING, TIMING_FLOOR_MS, TIMING_RULE, TIMING_TOLERANCE_PCT, type TimingRule } from "./timing-rule";

/** |observed - value| <= floor, in exact decimal arithmetic (the three at one scale). */
function withinFloor(observed: ExactDecimal, value: ExactDecimal, floor: number): boolean {
  const [o, v, scale] = alignDecimals(observed, value);
  const diff = o >= v ? o - v : v - o;
  const f = parseExactDecimal(floor);
  const [d, fl] = alignDecimals({ digits: diff, scale }, f);
  return d <= fl;
}

/**
 * Judges one bet against one run. `opts.timingRule` is the rule a timing bet is judged with: D46 by default (every new
 * verdict); null for the rule before D46, which verify uses for a stored verdict that records no rule.
 */
export function judge(bet: Bet, run: Run, opts: { timingRule?: TimingRule | null } = {}): Verdict {
  const timingRule = opts.timingRule === undefined ? TIMING_RULE : opts.timingRule;
  const base = { betId: bet.id, runId: run.id, judgedBy: "src/judge.ts" as const };
  const cantCheck = (reason: string, observed?: Observed, reference?: Reference): Verdict => ({
    ...base,
    outcome: "cant_check",
    ...(observed !== undefined ? { observed } : {}),
    ...(reference !== undefined ? { reference } : {}),
    reason,
  });

  // 1. Only a run whose known-true control passed is trusted. Anything other than a strict `true`
  //    (false, missing, the string "false" from a reloaded file) means nothing from this run counts.
  if (run.controlPassed !== true) {
    const why = own(run.result?.notMeasured, "control");
    if (typeof why === "string") return cantCheck(`the run is not trusted: ${why}`);
    return cantCheck(run.controlPassed === false ? "control run did not match the known case" : "the run has no control result (controlPassed is not true)");
  }
  // 1a. Added E1: the runner says nothing in this run counts. Same answer for every bet on it.
  const wholeRun = own(run.result?.notMeasured, "wholeRun");
  if (typeof wholeRun === "string") return cantCheck(wholeRun);
  // 1b. A bet can only be judged against a run of the experiment it was placed on.
  if (bet.experimentId !== run.experimentId) {
    return cantCheck("the bet is for a different experiment than this run");
  }

  const field = bet.measures;
  const observed = own(run.result.measured, field);
  const reference = findReference(run, field);

  // 2. The bettor would not guess.
  if (bet.answer.kind === "declined") {
    return cantCheck("the bettor declined", observed, reference);
  }
  // 3. The runner says it knows it did not measure this field.
  const notMeasuredReason = own(run.result.notMeasured, field);
  if (notMeasuredReason !== undefined) {
    return cantCheck(notMeasuredReason, undefined, reference);
  }
  // 4. The field is simply absent.
  if (observed === undefined) {
    return cantCheck(`runner did not measure ${field}`, undefined, reference);
  }

  const decided = (matched: boolean): Verdict => ({
    ...base,
    outcome: matched ? "matched" : "not_matched",
    observed,
    ...(reference !== undefined ? { reference } : {}),
  });
  const unreadable = (what: string) =>
    cantCheck(`runner stored ${field} as ${observed === null ? "null" : typeof observed}, not ${what}`, observed, reference);

  // 4a. Added U1 (D48): a quiz bet matches when the measured value is inside the chosen option (src/quiz.ts).
  if (bet.answer.kind === "quiz") {
    const quizUnit = measuredUnit(field);
    if (quizUnit === undefined) return cantCheck(`Atlas has no unit on file for ${field}, so a bet on it cannot be compared`, observed, reference);
    const r = quizMembership(bet.answer.choice, bet.answer.options, quizUnit, observed);
    return "cantCheck" in r ? cantCheck(r.cantCheck, observed, reference) : decided(r.matched);
  }
  const answer = bet.answer;
  // 5. Units: the bet must be in the field's own unit (src/units.ts).
  const unit = measuredUnit(field);
  if (unit === undefined) return cantCheck(`Atlas has no unit on file for ${field}, so a bet on it cannot be compared`, observed, reference);
  const betUnit = answer.kind === "integer" ? "whole number" : answer.kind === "enum" ? "enum" : answer.kind === "json" ? "json" : answer.unit;
  const unitFits = answer.kind === "integer" ? unit === "count" || unit === "ms" : betUnit === unit;
  if (!unitFits) return cantCheck(`bet unit "${betUnit}" does not match measured unit "${unit}"`, observed, reference);

  switch (answer.kind) {
    case "integer": {
      if (typeof answer.value !== "number" || !Number.isSafeInteger(answer.value)) return cantCheck("the bet is not a whole number", observed, reference);
      // R2 review round 1 (m2): D46 covers every timing verdict, so a whole-number ms bet also matches within
      // 10% or 1 ms of the measured value (it used to need the exact value; it still does under the old rule).
      if (unit === "ms" && timingRule === TIMING_RULE) {
        if (answer.value < 0) return cantCheck(NEGATIVE_TIMING, observed, reference);
        const obsInt = typeof observed === "number" && Number.isSafeInteger(observed) ? String(observed) : typeof observed === "string" && DECIMAL_INTEGER_RE.test(observed) ? observed : null;
        if (obsInt === null) return unreadable("a whole number");
        const o = parseExactDecimal(obsInt);
        const v = parseExactDecimal(answer.value);
        return { ...decided(withinTolerance(o, v, parseExactDecimal(TIMING_TOLERANCE_PCT)) || withinFloor(o, v, TIMING_FLOOR_MS)), timingRule };
      }
      if (typeof observed === "number") {
        if (!Number.isSafeInteger(observed)) return unreadable("a whole number");
        return decided(observed === answer.value);
      }
      if (typeof observed === "string" && DECIMAL_INTEGER_RE.test(observed)) {
        return decided(BigInt(observed) === BigInt(answer.value));
      }
      return unreadable("a whole number");
    }

    case "enum": {
      if (typeof observed !== "string") return unreadable("text");
      const options = Array.isArray(answer.options) ? answer.options : [];
      // E1: a field may have more than one fixed list (one per shape); the bet's options must all come from ONE.
      const sets = own(ENUM_FIELD_OPTION_SETS, field);
      if (sets) {
        const fits = sets.find((set) => options.every((o) => set.includes(o)));
        if (!fits) {
          // Name the list closest to the bet (most options in common), as before when there was one list.
          const closest = [...sets].sort((a, b) => options.filter((o) => b.includes(o)).length - options.filter((o) => a.includes(o)).length)[0]!;
          const unknown = options.find((o) => !closest.includes(o));
          return cantCheck(`the bet's options include "${unknown}", which the runner never reports (it reports ${closest.join(", ")})`, observed, reference);
        }
      }
      if (!options.includes(answer.value)) return cantCheck("the bet's answer is not one of its own options", observed, reference);
      if (!options.includes(observed)) return cantCheck("observed value is not one of the options", observed, reference);
      return decided(observed === answer.value);
    }

    case "number": {
      // The bet's value and tolerance must be JSON numbers, not text that happens to parse.
      if (typeof answer.value !== "number") return cantCheck("the bet is not a number", observed, reference);
      if (typeof answer.tolerancePct !== "number") return cantCheck("the bet's tolerance is not a number", observed, reference);
      let tolerance: ExactDecimal;
      try {
        tolerance = parseExactDecimal(answer.tolerancePct);
      } catch {
        return cantCheck("the bet's tolerance is not a number", observed, reference);
      }
      if (tolerance.digits < 0n) return cantCheck("the bet's tolerance is below zero", observed, reference);

      if (unit === "USD") {
        if (typeof observed !== "string" || !DECIMAL_INTEGER_RE.test(observed)) {
          return unreadable("a whole-number string in USD 1e18");
        }
        let bet1e18: bigint;
        try {
          bet1e18 = usdToUsd1e18(answer.value);
        } catch {
          return cantCheck("the bet's USD amount cannot be read exactly", observed, reference);
        }
        return decided(
          withinTolerance({ digits: BigInt(observed), scale: 0 }, { digits: bet1e18, scale: 0 }, tolerance),
        );
      }

      let obs: ExactDecimal;
      let val: ExactDecimal;
      try {
        if (typeof observed !== "number" && typeof observed !== "string") return unreadable("a number");
        obs = parseExactDecimal(observed);
      } catch {
        return unreadable("a number");
      }
      try {
        val = parseExactDecimal(answer.value);
      } catch {
        return cantCheck("the bet is not a number", observed, reference);
      }
      // R2 (D46): a timing bet also matches within 1 ms; the verdict records the rule it was judged with.
      if (unit === "ms" && timingRule === TIMING_RULE) {
        if (val.digits < 0n) return cantCheck(NEGATIVE_TIMING, observed, reference); // R2 review round 1 (m1)
        return { ...decided(withinTolerance(obs, val, tolerance) || withinFloor(obs, val, TIMING_FLOOR_MS)), timingRule };
      }
      return decided(withinTolerance(obs, val, tolerance));
    }

    case "json": {
      // E1: the runner stores the value as canonical JSON text; the bet's value is written the same way.
      if (typeof observed !== "string") return unreadable("JSON text");
      let want: string;
      try {
        want = canonicalJson(answer.value);
      } catch {
        return cantCheck("the bet's value is not plain JSON", observed, reference);
      }
      return decided(observed === want);
    }

    default: {
      const unknownKind: never = answer;
      return cantCheck(`unknown bet kind ${String((unknownKind as { kind?: unknown }).kind)}`, observed, reference);
    }
  }
}
