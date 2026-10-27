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
// `apply-proposal-then-read` (Level 2, D04-02) forks one block before the proposal ran, checks the
// fork is really pre-execution, applies the proposal's oracle-feed actions as the oracle's admin,
// and reads before and after (see level2.ts). Change-and-replay is a later task and throws here.

import { nanoid } from "nanoid";
import type { Change, Experiment, Run, RunResult, Target, TraceEvent } from "../../src/types.ts";
import type { Runner } from "../runner.ts";
import { withAnvilFork } from "./anvil.ts";
import { cbEthReference, readControl, readNamedMarket, why, type EvmControlRecord } from "./control.ts";
import { BASE_CHAIN_ID } from "./moonwell-base.ts";
import { localClient } from "./reads.ts";
import { runLevel2OnFork, type Level2Record } from "./level2.ts";

export interface EvmRunnerOptions {
  /** The fork block `control(target)` uses. run() takes its own block in opts and needs it. */
  controlForkBlock?: number;
  /** Defaults to process.env.BASE_RPC_URL (read by anvil.ts, never logged). */
  rpcUrl?: string;
  /** Called with one short present-tense line per step of a run (the server streams them to the agent log). */
  onProgress?: (step: string) => void;
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
  const progress = (step: string) => {
    try {
      options.onProgress?.(step);
    } catch {
      // A progress line that could not be written never stops a run.
    }
  };

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
      if (exp.params.shape === "apply-proposal-then-read") {
        const forkBlock = requireForkBlock(opts.forkBlock, "evmRunner.run");
        const params = exp.params;
        const startedAt = new Date().toISOString();
        progress(`forks Base @ ${forkBlock}`);
        return withAnvilFork(forkOpts(forkBlock), async (fork) => {
          const rec = await runLevel2OnFork(localClient(fork.url), fork, forkBlock, progress);
          return { ...level2Run(exp, rec, params.markets, startedAt), ...(opts.replayOf ? { replayOf: opts.replayOf } : {}) };
        });
      }
      if (exp.params.shape !== "price-read") {
        throw new Error(`the EVM runner does not run "${exp.params.shape}" yet`);
      }
      const forkBlock = requireForkBlock(opts.forkBlock, "evmRunner.run");
      const markets = exp.params.markets;
      const startedAt = new Date().toISOString();
      progress(`forks Base @ ${forkBlock}`);

      return withAnvilFork(forkOpts(forkBlock), async (fork) => {
        const client = localClient(fork.url);
        progress("runs the known-case control (WETH, stablecoins)");
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

        progress(`reads ${markets.length} ${markets.length === 1 ? "market" : "markets"}`);
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

/** Turn a Level 2 record into a Run. `priceUsd1e18:<sym>` is the POST-apply price (what the bets ask about). */
export function level2Run(exp: Experiment, rec: Level2Record, markets: string[] | "touched", startedAt: string): Run {
  const trace: TraceEvent[] = [];
  let t = 0;
  const log = (event: string, data?: Record<string, unknown>) => trace.push({ t: t++, event, ...(data ? { data } : {}) });
  const result: RunResult = { measured: {}, notMeasured: {}, references: {} };

  log("fork_started", { forkBlock: rec.forkBlock, chainId: BASE_CHAIN_ID });
  log("pre_execution_checked", rec.preExecution as unknown as Record<string, unknown>);
  const postBandOk = rec.postStablecoins.every((s) => s.inBand);
  const controlPassed = rec.control.passed === true && postBandOk;
  log(controlPassed ? "control_matched" : "control_did_not_match", { control: rec.control as unknown as Record<string, unknown>, postStablecoins: rec.postStablecoins });
  if (!controlPassed) {
    const reasons = [...rec.control.reasons, ...rec.postStablecoins.filter((s) => !s.inBand).map((s) => `${s.symbol} post-apply reads ${s.priceUsd1e18 ?? "nothing"} USD 1e18, outside 0.95–1.05 USD`)];
    result.notMeasured.control = reasons.join("; ");
  }

  log("proposal_derived", { count: rec.actions.length, actions: rec.actions.map((a) => ({ symbol: a.symbol, wrapper: a.wrapper, line: a.config.line })) });
  const wanted = markets === "touched" ? rec.actions.map((a) => a.symbol) : markets;
  for (const sym of wanted) {
    const pre = rec.pre[sym];
    if (pre?.ok) {
      result.measured[`preApplyPriceUsd1e18:${sym}`] = pre.read.priceUsd1e18;
      result.measured[`preApplyFeedAddress:${sym}`] = pre.read.feedAddress;
      log("price_read", { phase: "pre-apply", ...(pre.read as unknown as Record<string, unknown>) });
    } else {
      result.notMeasured[`preApplyPriceUsd1e18:${sym}`] = pre ? pre.reason : `${sym} is not a market this proposal touches`;
    }
  }
  for (const a of rec.applied) log("feed_set", a as unknown as Record<string, unknown>);
  result.measured.appliedFeedActions = rec.applied.length;
  result.measured.forkEventsEqualDerived = rec.forkEventsVsDerived.equal;
  result.measured.blockAfterApply = rec.blockAfterApply;
  for (const sym of wanted) {
    const post = rec.post[sym];
    if (post?.ok) {
      const r = post.read;
      result.measured[`priceUsd1e18:${sym}`] = r.priceUsd1e18;
      result.measured[`rawUnderlyingPrice:${sym}`] = r.rawUnderlyingPrice;
      result.measured[`feedAddress:${sym}`] = r.feedAddress;
      result.measured[`feedDecimals:${sym}`] = r.feedDecimals;
      result.measured[`feedDescription:${sym}`] = r.feedDescription;
      result.measured[`tokenDecimals:${sym}`] = r.tokenDecimals;
      log("price_read", { phase: "post-apply", ...(r as unknown as Record<string, unknown>) });
    } else {
      result.notMeasured[`priceUsd1e18:${sym}`] = post ? post.reason : `${sym} is not a market this proposal touches`;
      log("price_read_failed", { phase: "post-apply", symbol: sym, reason: post ? post.reason : "not touched" });
    }
  }
  if (wanted.includes("cbETH")) {
    const ref = rec.referencePost;
    if (ref.ok) {
      result.references!["refUsd1e18:cbETH"] = { value: ref.value, method: ref.method };
      log("reference", { key: "refUsd1e18:cbETH", value: ref.value, method: ref.method, inputs: ref.inputs as unknown as Record<string, unknown> });
    } else {
      result.notMeasured["refUsd1e18:cbETH"] = ref.reason;
      log("reference_not_measured", { key: "refUsd1e18:cbETH", reason: ref.reason });
    }
    for (const [phase, tr] of [["pre-apply", rec.trace.pre], ["post-apply", rec.trace.post]] as const) {
      const key = phase === "post-apply" ? "priceSources:cbETH" : "preApplyPriceSources:cbETH";
      if (tr.ok) result.measured[key] = tr.count;
      else result.notMeasured[key] = tr.reason;
      log("call_trace", { phase, ...(tr as unknown as Record<string, unknown>) });
    }
  }

  return {
    id: nanoid(10),
    experimentId: exp.id,
    runner: "evm",
    executor: "local",
    codeSha256: exp.target.codeSha256,
    forkBlock: rec.forkBlock,
    chainId: rec.control.chainId,
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    result,
    controlPassed,
  };
}
