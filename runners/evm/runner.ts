// The EVM Runner: Level 1 ("after the fact") price reads on a Base fork.
//
// Plain words: for a `price-read` experiment, Atlas starts a private copy of Base at the block it
// is given (anvil), runs the control on that same copy (see control.ts), then reads Moonwell's
// price for each market asked for, and, for cbETH, computes the reference price from the raw
// Chainlink feeds at the same block. The fork is always stopped afterwards.
//
// The fork block is a required input. It is never defaulted: a run without one throws, so a
// missing block can never quietly become "latest" (which would compare different ETH prices).
//
// `apply-proposal-then-read` (Level 2) and change-and-replay are later tasks and throw here.

import { nanoid } from "nanoid";
import type { Change, Experiment, Run, RunResult, Target, TraceEvent } from "../../src/types.ts";
import type { Runner } from "../runner.ts";
import { withAnvilFork } from "./anvil.ts";
import { cbEthReference, readControl, readNamedMarket, why, type EvmControlRecord } from "./control.ts";
import { BASE_CHAIN_ID } from "./moonwell-base.ts";
import { localClient } from "./reads.ts";

export interface EvmRunnerOptions {
  /** The fork block `control(target)` uses. run() takes its own block in opts and needs it. */
  controlForkBlock?: number;
  /** Defaults to process.env.BASE_RPC_URL (read by anvil.ts, never logged). */
  rpcUrl?: string;
}

function requireForkBlock(forkBlock: number | undefined, where: string): number {
  if (forkBlock === undefined) throw new Error(`${where}: forkBlock is required for an EVM run (it is never defaulted)`);
  if (!Number.isSafeInteger(forkBlock) || forkBlock <= 0) throw new RangeError(`${where}: forkBlock must be a positive whole number, got ${forkBlock}`);
  return forkBlock;
}

function controlRun(target: Target, ctl: EvmControlRecord, startedAt: string): Run {
  return {
    id: nanoid(10),
    experimentId: "control",
    runner: "evm",
    executor: "local",
    codeSha256: target.codeSha256,
    forkBlock: ctl.forkBlock,
    chainId: ctl.chainId,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace: [{ t: 0, event: ctl.passed ? "control_matched" : "control_did_not_match", data: { control: ctl as unknown as Record<string, unknown> } }],
    result: { measured: { controlPassed: ctl.passed }, notMeasured: ctl.passed ? {} : { control: ctl.reasons.join("; ") } },
    controlPassed: ctl.passed,
  };
}

export function evmRunner(options: EvmRunnerOptions = {}): Runner {
  const forkOpts = (forkBlock: number) => ({ forkBlock, ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}) });

  return {
    kind: "evm",

    async control(target: Target): Promise<Run> {
      const forkBlock = requireForkBlock(options.controlForkBlock, "evmRunner.control");
      const startedAt = new Date().toISOString();
      const ctl = await withAnvilFork(forkOpts(forkBlock), (fork) => readControl(localClient(fork.url), forkBlock));
      return controlRun(target, ctl, startedAt);
    },

    async run(exp: Experiment, opts): Promise<Run> {
      if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
      if (exp.runner !== "evm") throw new Error(`experiment ${exp.id} is for the ${exp.runner} runner, not evm`);
      if (exp.params.shape !== "price-read") {
        throw new Error(`the EVM runner does not run "${exp.params.shape}" yet (Level 1 runs price-read only)`);
      }
      const forkBlock = requireForkBlock(opts.forkBlock, "evmRunner.run");
      const markets = exp.params.markets;
      const startedAt = new Date().toISOString();

      return withAnvilFork(forkOpts(forkBlock), async (fork) => {
        const client = localClient(fork.url);
        const trace: TraceEvent[] = [];
        let t = 0;
        const log = (event: string, data?: Record<string, unknown>) => trace.push({ t: t++, event, ...(data ? { data } : {}) });
        log("fork_started", { forkBlock, chainId: BASE_CHAIN_ID });

        // The control runs first, on the same fork, at the same block.
        const ctl = await readControl(client, forkBlock);
        const ctlRun = controlRun(exp.target, ctl, startedAt);
        log(ctl.passed ? "control_matched" : "control_did_not_match", { control: ctl as unknown as Record<string, unknown> });

        const result: RunResult = { measured: {}, notMeasured: {}, references: {} };
        if (!ctl.passed) result.notMeasured.control = ctl.reasons.join("; ");

        for (const sym of markets) {
          try {
            const r = await readNamedMarket(client, sym);
            result.measured[`priceUsd1e18:${sym}`] = r.priceUsd1e18;
            result.measured[`rawUnderlyingPrice:${sym}`] = r.rawUnderlyingPrice;
            result.measured[`feedAddress:${sym}`] = r.feedAddress;
            result.measured[`feedDecimals:${sym}`] = r.feedDecimals;
            result.measured[`feedDescription:${sym}`] = r.feedDescription;
            result.measured[`tokenDecimals:${sym}`] = r.tokenDecimals;
            log("price_read", r as unknown as Record<string, unknown>);
          } catch (e) {
            result.notMeasured[`priceUsd1e18:${sym}`] = `the price read for ${sym} failed: ${why(e)}`;
            log("price_read_failed", { symbol: sym, reason: why(e) });
          }
        }

        // The reference: only for cbETH (an ETH-denominated market with a two-feed reference).
        if (markets.includes("cbETH")) {
          const ref = await cbEthReference(client, forkBlock);
          if (ref.ok) {
            result.references!["refUsd1e18:cbETH"] = { value: ref.value, method: ref.method };
            log("reference", { key: "refUsd1e18:cbETH", value: ref.value, method: ref.method, inputs: ref.inputs as unknown as Record<string, unknown> });
          } else {
            result.notMeasured["refUsd1e18:cbETH"] = ref.reason;
            log("reference_not_measured", { key: "refUsd1e18:cbETH", reason: ref.reason });
          }
        }

        return {
          id: nanoid(10),
          experimentId: exp.id,
          runner: "evm",
          executor: "local",
          codeSha256: exp.target.codeSha256,
          forkBlock,
          chainId: ctl.chainId,
          startedAt,
          finishedAt: new Date().toISOString(),
          trace,
          result,
          controlPassed: ctl.passed === true,
          controlRunId: ctlRun.id,
          ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
        };
      });
    },

    async replayWithChange(_run: Run, _change: Change): Promise<Run> {
      throw new Error("replayWithChange is not built yet for the EVM runner (Level 2 / change-and-replay task)");
    },
  };
}
