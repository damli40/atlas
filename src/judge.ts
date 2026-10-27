// The judge. Plain code decides whether a sealed bet matched what a run measured.
//
// Pure and synchronous: no I/O, no clock, no randomness, no model. Same bet + same run
// always gives the same verdict. It reads only run.controlPassed, run.experimentId,
// run.result.measured[bet.measures], run.result.notMeasured and run.result.references.
//
// Outcomes are only "matched", "not_matched" or "cant_check". When the judge cannot
// compare honestly it says "cant_check" with a plain reason; it never guesses.

import type { Bet, Run, Verdict } from "./types";
import { alignDecimals, parseExactDecimal, usdToUsd1e18, type ExactDecimal } from "./units";

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
  if (measures.startsWith(USD_1E18_PREFIX)) {
    const ref = own(refs, REF_USD_1E18_PREFIX + measures.slice(USD_1E18_PREFIX.length));
    if (ref) return ref;
  }
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

export function judge(bet: Bet, run: Run): Verdict {
  const base = { betId: bet.id, runId: run.id, judgedBy: "src/judge.ts" as const };
  const cantCheck = (reason: string, observed?: Observed, reference?: Reference): Verdict => ({
    ...base,
    outcome: "cant_check",
    ...(observed !== undefined ? { observed } : {}),
    ...(reference !== undefined ? { reference } : {}),
    reason,
  });

  // 1. The harness's known-true control did not reproduce: nothing from this run is trusted.
  if (run.controlPassed === false) {
    return cantCheck("control run did not match the known case");
  }
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

  const answer = bet.answer;
  switch (answer.kind) {
    case "integer": {
      if (!Number.isSafeInteger(answer.value)) return cantCheck("the bet is not a whole number", observed, reference);
      if (typeof observed === "number") return decided(observed === answer.value);
      if (typeof observed === "string" && DECIMAL_INTEGER_RE.test(observed)) {
        return decided(BigInt(observed) === BigInt(answer.value));
      }
      return unreadable("a whole number");
    }

    case "enum": {
      if (typeof observed !== "string") return unreadable("text");
      return decided(observed === answer.value);
    }

    case "number": {
      let tolerance: ExactDecimal;
      try {
        tolerance = parseExactDecimal(answer.tolerancePct);
      } catch {
        return cantCheck("the bet's tolerance is not a number", observed, reference);
      }
      if (tolerance.digits < 0n) return cantCheck("the bet's tolerance is below zero", observed, reference);

      if (field.startsWith(USD_1E18_PREFIX)) {
        if (answer.unit !== "USD") return cantCheck("bet unit is not USD", observed, reference);
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
      return decided(withinTolerance(obs, val, tolerance));
    }

    default: {
      const unknownKind: never = answer;
      return cantCheck(`unknown bet kind ${String((unknownKind as { kind?: unknown }).kind)}`, observed, reference);
    }
  }
}
