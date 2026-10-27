// POST /changes {runId} (D06-01): Muse Code proposes a change toward what the bettors expected, plain
// code checks it, the SAME experiment re-runs on the changed code (TS: same seed; EVM: same fork
// block), and src/judge.ts judges the SAME sealed bets against the replay. No new bets are taken.
//
// Plain words on what is shown:
// - "Before change" = the original verdicts (unchanged). "After change" = the same bets judged
//   against the replay. Both come from src/judge.ts.
// - The diff is shown as the diff, nothing else. The caption is the template CHANGE_CAPTION
//   ("changed toward what you expected, then re-run"). No model sentence speaks for Atlas.
// - When Muse Code gives no usable change, the answer says "Muse Code: no usable change (<reason>)"
//   and nothing replays.

import { nanoid } from "nanoid";
import { judge } from "../src/judge";
import type { Bet, Change, Experiment, Finding, Run, Verdict } from "../src/types";
import { moonwellChangeContext, MOONWELL_CONFIG_FILE, tsChangeContext, type ChangeContext } from "../runners/change";
import { evaluateReplayRule, type PassRuleLine } from "../runners/evm/level2";
import type { ReplayContext } from "../runners/runner";
import { readFixture } from "../runners/ts/control";
import { runFixer, towardFromBets, type FixerAttempt, type FixerDeps, type FixerPath } from "./meta/roles/fixer";
import { CHANGE_CAPTION } from "../src/change";
import { fixtureFinding } from "./meta/roles/fixture-finding";
import type { Usage } from "./meta/client";
import { oneLine, type SessionEmitter } from "./log/agentlog";
import { roundLog } from "./log/round";
import type { Round } from "./bets";

export type ReplayFn = (run: Run, change: Change, ctx: ReplayContext) => Promise<Run>;

export interface FixerView {
  path: FixerPath;
  model: string;
  attempts: FixerAttempt[];
  usage: Usage | null;
}

export type ChangeAnswer =
  | {
      ok: false;
      runId: string;
      reason: string;
      fixer: FixerView | null;
      toward: string | null;
      /** Present when Muse Code's change was accepted but the replay could not finish. */
      change?: Change;
      diff?: string;
    }
  | {
      ok: true;
      runId: string;
      change: Change;
      fixer: FixerView;
      /** The diff exactly as Muse Code proposed it (only the diff; any prose around it was dropped). */
      diff: string;
      caption: typeof CHANGE_CAPTION;
      replay: Run;
      /** The same sealed bets, judged before (the original verdicts) and after (against the replay). */
      bets: Bet[];
      before: { run: Pick<Run, "id" | "seed" | "forkBlock" | "codeSha256">; verdicts: Verdict[] };
      after: { run: Pick<Run, "id" | "seed" | "forkBlock" | "codeSha256">; verdicts: Verdict[] };
      /** EVM: PASS-RULE.md rule 3 applied literally to the replay, one line per check. */
      passRule?: PassRuleLine[];
    };

export interface ChangeDeps {
  fixer: FixerDeps;
  tsReplay: ReplayFn;
  evmReplay: ReplayFn;
  log: SessionEmitter;
  /** Display names for the bettors' columns, e.g. { "model:muse-spark-1.3": "Muse Spark 1.3 (muse-spark-1.3)" }. */
  names?: Record<string, string>;
}

/** The scratch-copy files and the place in the code, for this round's target. */
export function changeInputsFor(round: Round): { context: ChangeContext; finding: Pick<Finding, "file" | "lineStart" | "lineEnd"> } {
  const exp = round.experiment;
  if (exp.runner === "ts") {
    const text = readFixture(exp.target);
    const f = round.finding && round.finding.file === exp.target.ref ? round.finding : fixtureFinding(text);
    return { context: tsChangeContext(exp.target.ref, text), finding: { file: f.file, lineStart: f.lineStart, lineEnd: f.lineEnd } };
  }
  const context = moonwellChangeContext();
  const f = round.finding && round.finding.file in context.files ? round.finding : undefined;
  const lines = context.files[MOONWELL_CONFIG_FILE]!.split("\n").length;
  return { context, finding: f ? { file: f.file, lineStart: f.lineStart, lineEnd: f.lineEnd } : { file: MOONWELL_CONFIG_FILE, lineStart: 1, lineEnd: lines } };
}

const pick = (r: Run) => ({ id: r.id, ...(r.seed !== undefined ? { seed: r.seed } : {}), ...(r.forkBlock !== undefined ? { forkBlock: r.forkBlock } : {}), codeSha256: r.codeSha256 });

/** The whole route body for one finished round. Throws only when the replay itself fails. */
export async function changeAndReplay(round: Round, deps: ChangeDeps): Promise<ChangeAnswer> {
  const run = round.run!;
  const exp: Experiment = round.experiment;
  const bets = [...round.bets];
  const before = round.verdicts ?? [];
  const toward = towardFromBets(bets, before); // no display names: .atlas.json verify recomputes this text exactly
  if (!toward) {
    return { ok: false, runId: run.id, reason: "no change asked: no sealed bet differed from what the run measured, so there is nothing to change toward", fixer: null, toward: null };
  }
  const { context, finding } = changeInputsFor(round);
  const fx = await runFixer({ context, finding, toward, experiment: exp, ...(run.forkBlock !== undefined ? { forkBlock: run.forkBlock } : {}) }, { ...deps.fixer, log: deps.log });
  const fixer: FixerView = { path: fx.path, model: fx.model, attempts: fx.attempts, usage: fx.usage ?? null };
  if (!fx.ok) return { ok: false, runId: run.id, reason: fx.reason, fixer, toward };

  const change: Change = { id: nanoid(10), runId: run.id, diff: fx.diff, proposedBy: { role: "fixer", model: fx.model }, toward };
  const log = roundLog(deps.log);
  const replayFn = exp.runner === "evm" ? deps.evmReplay : deps.tsReplay;
  let replay: Run;
  try {
    replay = await replayFn(run, change, { experiment: exp, onProgress: (s) => log.progress(exp, s) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.runnerStopped(exp, message);
    return { ok: false, runId: run.id, reason: `the replay could not finish: ${message}`, fixer, toward, change, diff: fx.diff };
  }
  // The replay must be the same experiment with the same seed / fork block (the runners assert it too).
  if (replay.experimentId !== exp.id) throw new Error(`the replay ran ${replay.experimentId}, not ${exp.id}`);
  if (exp.runner === "ts" && replay.seed !== run.seed) throw new Error(`the replay used seed ${replay.seed}, not the original ${run.seed}`);
  if (exp.runner === "evm" && replay.forkBlock !== run.forkBlock) throw new Error(`the replay forked at ${replay.forkBlock}, not the original ${run.forkBlock}`);
  if (replay.replayOf?.runId !== run.id || replay.replayOf.changeId !== change.id) throw new Error("the replay does not name the original run and this change");
  change.replayRunId = replay.id;
  deps.log.emit({ role: "runner", action: oneLine(`re-runs ${exp.id} on the changed code (${exp.runner === "ts" ? `same seed ${run.seed}` : `same block ${run.forkBlock}`})`), ref: { kind: "run", id: replay.id } });
  const after = bets.map((b) => judge(b, replay));
  log.judge(after, replay);
  return {
    ok: true,
    runId: run.id,
    change,
    fixer,
    diff: fx.diff,
    caption: CHANGE_CAPTION,
    replay,
    bets,
    before: { run: pick(run), verdicts: before },
    after: { run: pick(replay), verdicts: after },
    ...(exp.runner === "evm" ? { passRule: evaluateReplayRule(replay, run) } : {}),
  };
}
