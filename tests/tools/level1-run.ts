// D03-03 Level 1 run: fork Base at a block, run the control, read cbETH, compute the reference,
// and (for the after-the-fact block) judge one sealed human bet with src/judge.ts.
// Used by tests/unit/evm-level1.test.ts and, to write dev evidence (NOT a published proof card), run directly:
//   ( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level1-run.ts tests/evidence/D03-03 )
// The RPC URL is never written: the output names only the fork block.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judge } from "../../src/judge.ts";
import { gate, questionsFor } from "../../src/gate.ts";
import { sealBet } from "../../src/seal.ts";
import type { Bet, Experiment, Run, Target, Verdict } from "../../src/types.ts";
import { evmRunner } from "../../runners/evm/runner.ts";
import { FORK_BLOCK, MIP_X43_MERGE_COMMIT, TOUCHED_MARKETS } from "../../runners/evm/moonwell-base.ts";

export const LEVEL1_CAPTION = `re-run after the fact, on a fork of Base at block ${FORK_BLOCK.proposalExecuted}`;

export const LEVEL1_TARGET: Target = {
  kind: "github-pr",
  ref: "moonwell-fi/moonwell-contracts-v2#578",
  // The PR files are fetched and hashed by D03-04 (another task). Level 1 reads only chain state,
  // so this run does not hash any code; the field says so instead of carrying a made-up hash.
  codeSha256: "not-hashed-in-D03-03 (Level 1 reads chain state only; PR files are hashed by D03-04)",
  commit: MIP_X43_MERGE_COMMIT,
};

export function level1Experiment(id = "level1-cbETH"): Experiment {
  const decision = gate({ shape: "price-read", markets: ["cbETH"] }, { shapes: ["price-read"], touchedMarkets: [...TOUCHED_MARKETS] });
  if (!decision.allowed) throw new Error(`gate refused the Level 1 experiment: ${decision.reason}`);
  return { id, target: LEVEL1_TARGET, runner: "evm", params: decision.params, proposedBy: { role: "human" }, gate: { allowed: true } };
}

/** The human bet from the D03-03 acceptance: 2200 USD, ±10% of the observed value, on priceUsd1e18:cbETH. */
export function humanBet(exp: Experiment): Bet {
  const q = questionsFor(exp.params, { touchedMarkets: [...TOUCHED_MARKETS] }).find((x) => x.measures === "priceUsd1e18:cbETH");
  if (!q) throw new Error("no cbETH price question for this experiment");
  return sealBet({
    experimentId: exp.id,
    who: "human",
    question: q.text,
    measures: q.measures,
    answer: { kind: "number", value: 2200, tolerancePct: q.tolerancePct ?? 10, unit: q.unit },
  });
}

export async function level1Run(forkBlock: number, exp: Experiment = level1Experiment()): Promise<Run> {
  return evmRunner().run(exp, { forkBlock });
}

// Run directly: write the dev evidence files.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "tests/evidence/D03-03";
  mkdirSync(dir, { recursive: true });
  const exp = level1Experiment();
  const bet = humanBet(exp); // sealed before the run starts
  const after = await level1Run(FORK_BLOCK.proposalExecuted, exp);
  const before = await level1Run(FORK_BLOCK.beforeProposal, exp);
  const verdict: Verdict = judge(bet, after);
  const write = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
  write("level1-after.json", { caption: LEVEL1_CAPTION, experiment: exp, run: after });
  write("level1-before.json", { caption: `fork of Base at block ${FORK_BLOCK.beforeProposal}, one block before MIP-X43 ran (read only, nothing applied)`, experiment: exp, run: before });
  write("verdict.json", { caption: LEVEL1_CAPTION, bet, betSealedBeforeRun: bet.sealedAt < after.startedAt, verdict });
  process.stdout.write(`after: control ${after.controlPassed}, cbETH ${after.result.measured["priceUsd1e18:cbETH"]}, ref ${after.result.references?.["refUsd1e18:cbETH"]?.value}\n`);
  process.stdout.write(`before: control ${before.controlPassed}, cbETH ${before.result.measured["priceUsd1e18:cbETH"]}, feed ${before.result.measured["feedAddress:cbETH"]}\n`);
  process.stdout.write(`verdict: ${verdict.outcome}\n`);
}
