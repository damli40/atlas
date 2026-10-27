// D04-02 Level 2 run (dev evidence, NOT a published proof card: nothing goes to proofs/**/run.json).
// Fork Base at 42194662 (one block before MIP-X43 ran), guard, control, read the 14 touched markets,
// apply the proposal's 14 setFeed actions as the oracle's admin, read again, reference, trace, then
// apply PASS-RULE.md by plain code and judge one sealed human bet.
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level2-run.ts tests/evidence/D04-02 )
// The RPC URL is never written; errors are redacted to "<rpc>" / "<rpc-host>".

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gate, questionsFor } from "../../src/gate.ts";
import { judge } from "../../src/judge.ts";
import { sealBet } from "../../src/seal.ts";
import type { Bet, Experiment, Target } from "../../src/types.ts";
import { formatUsd1e18 } from "../../src/units.ts";
import { withAnvilFork } from "../../runners/evm/anvil.ts";
import { comparePairs } from "../../runners/evm/apply.ts";
import { why } from "../../runners/evm/control.ts";
import { evaluatePassRule, falseAlarmTable, LEVEL2_CAPTION, LEVEL2_NOT_APPLIED, referenceRecomputes, runLevel2OnFork, type FalseAlarmRow, type Level2Record } from "../../runners/evm/level2.ts";
import { FORK_BLOCK, MIP_X43_MERGE_COMMIT, TOUCHED_MARKETS } from "../../runners/evm/moonwell-base.ts";
import { localClient } from "../../runners/evm/reads.ts";
import { level2Run } from "../../runners/evm/runner.ts";
import { realFeedSetPairs } from "./level2-derive.ts";

/** codeSha256 of PR #578's 6 changed files at the merge commit (D03-04). */
export const PR578_CODE_SHA256 = "6c431aaec1a5631719cb0c90128b0b2b0f294bafb3634c775cb93fee0670f7c7";

export const LEVEL2_TARGET: Target = { kind: "github-pr", ref: "moonwell-fi/moonwell-contracts-v2#578", codeSha256: PR578_CODE_SHA256, commit: MIP_X43_MERGE_COMMIT };

export function level2Experiment(id = "level2-touched"): Experiment {
  const decision = gate({ shape: "apply-proposal-then-read", markets: "touched" }, { shapes: ["apply-proposal-then-read"], touchedMarkets: [...TOUCHED_MARKETS] });
  if (!decision.allowed) throw new Error(`gate refused the Level 2 experiment: ${decision.reason}`);
  return { id, target: LEVEL2_TARGET, runner: "evm", params: decision.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

/** The sealed human bet: 2200 USD, ±10% of the observed value, on priceUsd1e18:cbETH (post-apply). */
export function level2HumanBet(exp: Experiment): Bet {
  const q = questionsFor(exp.params, { touchedMarkets: [...TOUCHED_MARKETS] }).find((x) => x.measures === "priceUsd1e18:cbETH");
  if (!q) throw new Error("no cbETH price question for this experiment");
  return sealBet({ experimentId: exp.id, who: "human", question: q.text, measures: q.measures, answer: { kind: "number", value: 2200, tolerancePct: q.tolerancePct ?? 10, unit: q.unit } });
}

const usd = (v: string | null) => (v === null ? "not read" : formatUsd1e18(BigInt(v)));

export function tableMarkdown(rows: FalseAlarmRow[]): string {
  const head =
    "| Market | Feed changed? | Pre-apply (USD) | Post-apply (USD) | Post-apply exact (USD × 1e18) | Diff vs pre | Flag compares against | Diff vs that | Flagged? |\n" +
    "|---|---|---|---|---|---|---|---|---|";
  const body = rows.map((r) => {
    const refCol = r.market === "cbETH" ? `raw Chainlink reference ${usd(r.flagReferenceUsd1e18)}` : "its pre-apply price";
    const changed = r.feedBefore && r.feedAfter ? (r.feedBefore.toLowerCase() !== r.feedAfter.toLowerCase() ? "yes" : "no") : "can't check";
    const exact = r.preUsd1e18 !== null && r.preUsd1e18 === r.postUsd1e18 ? " (exactly equal)" : "";
    return `| ${r.market} | ${changed} | ${usd(r.preUsd1e18)} | ${usd(r.postUsd1e18)} | ${r.postUsd1e18 ?? "not read"} | ${r.diffVsPrePct ?? "n/a"}${exact} | ${refCol} | ${r.diffVsFlagReferencePct ?? "n/a"} | ${r.flagged === null ? "can't check" : r.flagged ? "**yes**" : "no"} |`;
  });
  return [head, ...body].join("\n");
}

export async function level2Evidence(forkBlock = FORK_BLOCK.beforeProposal) {
  const exp = level2Experiment();
  const bet = level2HumanBet(exp); // sealed before the run starts
  const startedAt = new Date().toISOString();
  let rec: Level2Record;
  try {
    rec = await withAnvilFork({ forkBlock }, (fork) => runLevel2OnFork(localClient(fork.url), fork, forkBlock));
  } catch (e) {
    return { ok: false as const, exp, bet, startedAt, error: why(e) };
  }
  const run = level2Run(exp, rec, "touched", startedAt);
  const table = falseAlarmTable(rec);
  const passRule = evaluatePassRule(rec, table);
  const verdict = judge(bet, run);
  const derivedVsReal = comparePairs(rec.actions.map((a) => ({ symbol: a.symbol, wrapper: a.wrapper })), realFeedSetPairs());
  return { ok: true as const, exp, bet, startedAt, rec, run, table, passRule, verdict, derivedVsReal };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "tests/evidence/D04-02";
  mkdirSync(dir, { recursive: true });
  const r = await level2Evidence();
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
  if (!r.ok) {
    write("level2.json", { caption: LEVEL2_CAPTION, failed: true, error: r.error, experiment: r.exp, bet: r.bet, startedAt: r.startedAt });
    process.stderr.write(`Level 2 stopped: ${r.error}\n`);
    process.exit(1);
  }
  write("level2.json", {
    caption: LEVEL2_CAPTION,
    notApplied: LEVEL2_NOT_APPLIED,
    experiment: r.exp,
    bet: r.bet,
    betSealedBeforeRun: r.bet.sealedAt < r.run.startedAt,
    verdict: r.verdict,
    passRule: r.passRule,
    falseAlarmTable: r.table,
    derivedVsRealFeedSet: r.derivedVsReal,
    referenceRecomputesFromInputs: referenceRecomputes(r.rec.referencePost),
    referencePreEqualsPost: r.rec.referencePre.ok && r.rec.referencePost.ok && r.rec.referencePre.value === r.rec.referencePost.value,
    record: r.rec,
    run: r.run,
  });
  writeFileSync(
    join(dir, "false-alarm-table.md"),
    `# Level 2 false-alarm table\n\nCaption: **${LEVEL2_CAPTION}**.\n\nFork block ${r.rec.forkBlock}; 14 setFeed actions applied (fork block after apply: ${r.rec.blockAfterApply}). ` +
      `Prices are Moonwell's getUnderlyingPrice brought to USD by src/units.ts, shown rounded to the cent; exact values are in level2.json. ` +
      `A market is flagged when its post-apply price differs from what it is compared against by more than 50% (PASS-RULE.md).\n\n${tableMarkdown(r.table)}\n`,
  );
  process.stdout.write(`control ${r.run.controlPassed}; verdict ${r.verdict.outcome}\n`);
  for (const l of r.passRule) process.stdout.write(`${l.outcome.padEnd(13)} ${l.rule}\n`);
}
