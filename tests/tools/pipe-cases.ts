// The four data cases the price pipe (D05-03) is drawn and tested from.
//
// Two are real runs, read from committed evidence files exactly as they are:
// - "level2-count1": the D04-04 Moonwell Level 2 round (run mwTaxvHFzB, person + Muse Spark 1.3).
//   After the proposal's feed actions, cbETH's read touched 1 price source.
// - "level1-not-measured": the D03-03 Level 1 run (U6Gk6cu_i0, block 42194663). Level 1 never traced
//   its price sources, so the count is not measured.
// Two are fixtures BUILT FROM real data, and say so on their card:
// - "pre-apply-count2": the same D04-04 run's pre-apply phase (block 42194662, before anything was
//   applied): its own pre-apply price read, reference and pre-apply call trace (2 price sources),
//   lifted into a Run of their own. Same numbers, nothing invented; the bets are re-judged on it.
// - "control-failed": the D04-04 run with its control marked as not passed (no real EVM run has
//   failed its control yet); the verdicts are re-judged by src/judge.ts, so every one is can't check.

import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "../../src/judge.ts";
import type { AtlasFile, Bet, Run, Verdict } from "../../src/types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface PipeCase {
  id: string;
  title: string;
  run: Run;
  bets: Bet[];
  verdicts: Verdict[];
  /** Only for fixtures: the caption that replaces the Level caption, saying what the fixture is. */
  captionOverride?: string;
  real: boolean;
}

const read = <T,>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;

export function level2Round(): { run: Run; bets: Bet[]; verdicts: Verdict[] } {
  const f = read<AtlasFile>("tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json");
  return { run: f.runs[0]!, bets: f.bets, verdicts: f.verdicts };
}

export function preApplyFixture(): { run: Run; bets: Bet[]; verdicts: Verdict[] } {
  const { run, bets } = level2Round();
  const m = run.result.measured;
  const pick = (event: string, phase?: string) =>
    run.trace.find((e) => e.event === event && (phase === undefined || (e.data as { phase?: string } | undefined)?.phase === phase) && (event !== "price_read" || (e.data as { symbol?: string }).symbol === "cbETH"))!;
  const preRead = pick("price_read", "pre-apply");
  const d = preRead.data as Record<string, unknown>;
  const trace = [pick("fork_started"), pick("pre_execution_checked"), pick("control_matched"), preRead, pick("reference"), pick("call_trace", "pre-apply")].map((e, t) => ({ ...e, t }));
  const fixture: Run = {
    ...run,
    id: `${run.id}-pre-apply`,
    trace,
    result: {
      measured: {
        "priceUsd1e18:cbETH": m["preApplyPriceUsd1e18:cbETH"]!,
        "rawUnderlyingPrice:cbETH": d.rawUnderlyingPrice as string,
        "feedAddress:cbETH": m["preApplyFeedAddress:cbETH"]!,
        "feedDecimals:cbETH": d.feedDecimals as number,
        "feedDescription:cbETH": (d.feedDescription as string | null) ?? null,
        "tokenDecimals:cbETH": d.tokenDecimals as number,
        "priceSources:cbETH": m["preApplyPriceSources:cbETH"]!,
      },
      notMeasured: {},
      references: run.result.references!,
    },
  };
  return { run: fixture, bets, verdicts: bets.map((b) => judge(b, fixture)) };
}

export function controlFailedFixture(): { run: Run; bets: Bet[]; verdicts: Verdict[] } {
  const { run, bets } = level2Round();
  const reason = "fixture: the D04-04 run with its control marked as not passed";
  const fixture: Run = {
    ...run,
    id: `${run.id}-control-failed`,
    controlPassed: false,
    trace: run.trace.map((e) => (e.event === "control_matched" ? { ...e, event: "control_did_not_match" } : e)),
    result: { ...run.result, notMeasured: { ...run.result.notMeasured, control: reason } },
  };
  return { run: fixture, bets, verdicts: bets.map((b) => judge(b, fixture)) };
}

export function level1Round(): { run: Run; bets: Bet[]; verdicts: Verdict[] } {
  const after = read<{ run: Run }>("tests/evidence/D03-03/level1-after.json");
  const v = read<{ bet: Bet; verdict: Verdict }>("tests/evidence/D03-03/verdict.json");
  return { run: after.run, bets: [v.bet], verdicts: [v.verdict] };
}

export function pipeCases(): PipeCase[] {
  return [
    { id: "level2-count1", title: "Level 2, real run mwTaxvHFzB (D04-04): 1 price source", ...level2Round(), real: true },
    {
      id: "pre-apply-count2",
      title: "Fixture from the same run's pre-apply phase: 2 price sources",
      ...preApplyFixture(),
      captionOverride: "fixture built from run mwTaxvHFzB's pre-apply phase: fork of Base at block 42194662, read before Atlas applied anything",
      real: false,
    },
    {
      id: "control-failed",
      title: "Fixture: the same run with its control marked as not passed",
      ...controlFailedFixture(),
      captionOverride: "fixture: run mwTaxvHFzB with its known-case control marked as not passed",
      real: false,
    },
    { id: "level1-not-measured", title: "Level 1, real run U6Gk6cu_i0 (D03-03): source count not measured", ...level1Round(), real: true },
  ];
}
