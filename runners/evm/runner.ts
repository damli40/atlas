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
import { createHash } from "node:crypto";
import type { ReplayContext, Runner } from "../runner.ts";
import { checkChange, moonwellChangeContext, MOONWELL_CONFIG_FILE, MOONWELL_SCRATCH_FILES } from "../change.ts";
import { theoryCaptions } from "../../src/change.ts";
import { withAnvilFork } from "./anvil.ts";
import { redactedError, redactRpc, scrubDeep } from "./redact.ts";
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
      options.onProgress?.(redactRpc(step, options.rpcUrl));
    } catch {
      // A progress line that could not be written never stops a run.
    }
  };

  /**
   * S1: everything that leaves the runner is redacted here, in one place: a thrown error becomes a new
   * Error with the RPC URL, host and key removed, and every string of a finished Run is scrubbed the same way.
   */
  const guarded = async (work: () => Promise<Run>): Promise<Run> => {
    let run: Run;
    try {
      run = await work();
    } catch (e) {
      throw redactedError(e, options.rpcUrl);
    }
    return scrubDeep(run, options.rpcUrl);
  };

  const runner: Runner = {
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
          // No controlRunId: the control ran on this same fork and is in this run's trace
          // (control_matched / control_did_not_match); a separate control Run is never stored (review M9).
          ...(opts.replayOf ? { replayOf: opts.replayOf } : {}),
        };
      });
    },

    /**
     * D06-01: the change edits the PR's config (proposals/ChainlinkOracleConfigs.sol) in a scratch
     * copy; the actions are re-derived from the CHANGED config by the same parser (apply.ts), every
     * name resolved in the PR's own chains/8453.json; then the SAME experiment runs on a FRESH fork at
     * the SAME block as the original run (copied from it, asserted equal), and the same reads follow.
     */
    async replayWithChange(original: Run, change: Change, ctx: ReplayContext): Promise<Run> {
      const exp = ctx.experiment;
      const say = (s: string) => {
        progress(s);
        try {
          ctx.onProgress?.(redactRpc(s, options.rpcUrl));
        } catch {
          // a progress line that could not be written never stops a replay
        }
      };
      assertSameEvmReplay(original, exp, change);
      const forkBlock = requireForkBlock(original.forkBlock, "evmRunner.replayWithChange");
      if (exp.params.shape !== "apply-proposal-then-read") throw new Error(`a change can be replayed on apply-proposal-then-read only, not "${exp.params.shape}"`);
      const params = exp.params;
      say("applies the change to the proposal's config in a scratch copy");
      const ctxFiles = moonwellChangeContext();
      const checked = await checkChange(change.diff, ctxFiles);
      if (!checked.ok) throw new Error(`the change cannot be replayed: ${checked.reason}`);
      // D20: the theoretical mode must be declared by the Change itself, exactly as plain code derives it.
      if ((checked.mode ?? null) !== (change.mode ?? null)) {
        throw new Error(checked.mode ? `the change can only be wired in ${checked.mode} mode, but the change does not say so` : `the change says ${change.mode} mode, but plain code wires it without it`);
      }
      if (JSON.stringify(checked.directWired ?? []) !== JSON.stringify(change.directWired ?? [])) throw new Error("the change's directly wired feeds are not the ones plain code derives");
      if (checked.mode) say(theoryCaptions(change).join(" "));
      const planned = checked.planned!;
      const changedConfig = checked.changedFiles[MOONWELL_CONFIG_FILE]!;
      const readSha = sha256(MOONWELL_SCRATCH_FILES.map((f) => checked.changedFiles[f]!).join("\n"));
      say(`re-derives ${planned.length} oracle-feed actions from the changed config`);
      const startedAt = new Date().toISOString();
      say(`forks Base @ ${forkBlock} (the original run's block)`);
      const run = await withAnvilFork(forkOpts(forkBlock), async (fork) => {
        const rec = await runLevel2OnFork(localClient(fork.url), fork, forkBlock, say, { replayPlan: planned });
        if (rec.forkBlock !== original.forkBlock) throw new Error(`the replay forked at ${rec.forkBlock}, not the original run's ${original.forkBlock}`);
        const r = level2Run(exp, rec, params.markets, startedAt);
        const wired = new Set(rec.actions.map((a) => a.symbol));
        r.trace.push({
          t: r.trace.length,
          event: REPLAY_CHECKS_EVENT,
          data: {
            replayOf: original.id,
            changeId: change.id,
            sameForkBlock: true,
            forkBlock,
            originalForkBlock: original.forkBlock,
            originalCodeSha256: original.codeSha256,
            changedFilesSha256: readSha,
            changedConfigSha256: sha256(changedConfig),
            changedLines: checked.changedLines,
            derivedActions: rec.actions.map((a) => ({ symbol: a.symbol, oracleName: a.config.oracleName, wrapperName: a.wrapperName, wrapper: a.wrapper, line: a.config.line, ...(a.directWire ? { directWire: true } : {}) })),
            marketsNotRewired: (rec.readMarkets ?? []).map((a) => a.symbol).filter((s) => !wired.has(s)),
            // D20: the mode, recorded in the replay run itself.
            ...(checked.mode ? { mode: checked.mode, directWired: checked.directWired, theory: theoryCaptions(change) } : {}),
          },
        });
        return { ...r, codeSha256: readSha, replayOf: { runId: original.id, changeId: change.id } };
      });
      if (run.forkBlock !== original.forkBlock) throw new Error(`replay fork block ${run.forkBlock} is not the original ${original.forkBlock}`);
      return run;
    },
  };
  return {
    ...runner,
    control: (target) => guarded(() => runner.control(target)),
    run: (exp, opts) => guarded(() => runner.run(exp, opts)),
    replayWithChange: (run, change, ctx) => guarded(() => runner.replayWithChange(run, change, ctx)),
  };
}

export const REPLAY_CHECKS_EVENT = "replay_checks";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Throws when the replay would not be the same experiment as the original EVM run. */
export function assertSameEvmReplay(original: Run, exp: Experiment, change: Change): void {
  if (original.runner !== "evm") throw new Error(`run ${original.id} is a ${original.runner} run, not an EVM run`);
  if (original.experimentId !== exp.id) throw new Error(`run ${original.id} ran experiment ${original.experimentId}, not ${exp.id}`);
  if (change.runId !== original.id) throw new Error(`change ${change.id} is for run ${change.runId}, not ${original.id}`);
  if (!exp.gate.allowed) throw new Error(`experiment ${exp.id} was rejected by the gate: ${exp.gate.reason}`);
  requireForkBlock(original.forkBlock, "evmRunner.replayWithChange");
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
  const wanted = markets === "touched" ? (rec.readMarkets ?? rec.actions).map((a) => a.symbol) : markets;
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
