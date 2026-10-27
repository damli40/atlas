// The log lines one POST /runs round writes, in order (D02-05). Kept here so server/app.ts only calls them.
//
// Order: human (one line per sealed human bet) → investigator stand-in (role "human", because a
// person wrote the finding by hand; the Investigator model arrives Oct 30) → gate → seal → runner → judge.
// Model bets (who "model:…") get no line here: the Claimant role writes its own model line, with usage.

import type { Bet, Experiment, Run, RunAttempt, Verdict } from "../../src/types";
import { oneLine, type SessionEmitter } from "./agentlog";
import { targetName } from "../../src/target-name";

export const INVESTIGATOR_STUB_ACTION = "uses a fixture finding, written by hand (Investigator arrives Oct 30)";
export const GATE_STUB_ACTION = "allowed (src/gate.ts)";

/** What the screen calls the code under test: the target's own name (src/target-name.ts, final review M6). */
function codeName(exp: Experiment): string {
  return targetName(exp.target);
}

export function roundLog(emit: SessionEmitter) {
  return {
    humanBets(bets: Bet[]) {
      for (const b of bets.filter((x) => x.who === "human")) {
        emit.emit({ role: "human", action: `seals a bet on ${b.measures}`, ref: { kind: "bet", id: b.id } });
      }
    },
    investigatorStub(exp: Experiment) {
      emit.emit({ role: "human", action: INVESTIGATOR_STUB_ACTION, ref: { kind: "experiment", id: exp.id } });
    },
    gate(exp: Experiment) {
      // The gate's reason can be long or hold a line break (it quotes the refused field names), so the
      // log line is flattened and shortened. The full reason stays in the 422 answer and the experiment.
      const action = exp.gate.allowed ? GATE_STUB_ACTION : oneLine(`rejected (${exp.gate.reason})`);
      emit.emit({ role: "gate", action, ref: { kind: "experiment", id: exp.id } });
    },
    seals(total: number, unsealed: string[]) {
      const action =
        unsealed.length === 0
          ? `verifies ${total} ${total === 1 ? "seal" : "seals"}`
          : `refuses bet ${unsealed.join(", ")}: seal did not verify, nothing runs`;
      emit.emit({ role: "seal", action: oneLine(action) });
    },
    runner(exp: Experiment, run: Run) {
      const where = exp.runner === "evm" && run.forkBlock !== undefined ? `on a fork of Base @ ${run.forkBlock}` : "in the sandbox";
      emit.emit({ role: "runner", action: oneLine(`runs ${codeName(exp)} ${where} (${exp.id})`), ref: { kind: "run", id: run.id } });
    },
    /** D04-04: one line per step of a long EVM run, so the page can show progress while it waits. */
    progress(exp: Experiment, step: string) {
      emit.emit({ role: "runner", action: oneLine(step), ref: { kind: "experiment", id: exp.id } });
    },
    runnerStopped(exp: Experiment, message: string) {
      emit.emit({ role: "runner", action: oneLine(`could not finish ${exp.id}: ${message}`), ref: { kind: "experiment", id: exp.id } });
    },
    /** Final review S2: a run attempt that did not finish. Not a verdict: the sealed bets stay and the run can be tried again. */
    runDidNotFinish(exp: Experiment, attempt: RunAttempt) {
      emit.emit({ role: "runner", action: oneLine(`the run did not finish (attempt ${attempt.attempt}): ${attempt.reason}; nothing was judged, the sealed bets stay as they are`), ref: { kind: "experiment", id: exp.id } });
    },
    judge(verdicts: Verdict[], run: Run) {
      const n = verdicts.length;
      const count = (o: Verdict["outcome"]) => verdicts.filter((v) => v.outcome === o).length;
      const parts = [
        [count("matched"), "matched"],
        [count("not_matched"), "didn't match"],
        [count("cant_check"), "can't check"],
      ]
        .filter(([k]) => (k as number) > 0)
        .map(([k, say]) => `${k} ${say}`);
      const action = n === 0 ? "has no bets to judge" : `judges ${n} ${n === 1 ? "bet" : "bets"}: ${parts.join(", ")}`;
      emit.emit({ role: "judge", action, ref: { kind: "run", id: run.id } });
    },
  };
}
