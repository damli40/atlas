// The log lines one POST /runs round writes, in order (D02-05). Kept here so server/app.ts only calls them.
//
// Order: human (one line per sealed human bet) → investigator stand-in (role "human", because a
// person wrote the finding by hand; the Investigator model arrives Oct 30) → gate → seal → runner → judge.
// Model bets (who "model:…") get no line here: the Claimant role writes its own model line, with usage.

import type { Bet, Experiment, Run, Verdict } from "../../src/types";
import type { SessionEmitter } from "./agentlog";

export const INVESTIGATOR_STUB_ACTION = "uses a fixture finding, written by hand (Investigator arrives Oct 30)";
export const GATE_STUB_ACTION = "allowed (src/gate.ts)";

/** What the screen calls the code under test. Today only the TS runner's one export exists. */
function codeName(exp: Experiment): string {
  return exp.runner === "ts" ? "withRpcRetry" : exp.target.ref;
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
      const action = exp.gate.allowed ? GATE_STUB_ACTION : `rejected (${exp.gate.reason})`;
      emit.emit({ role: "gate", action, ref: { kind: "experiment", id: exp.id } });
    },
    seals(total: number, unsealed: string[]) {
      const action =
        unsealed.length === 0
          ? `verifies ${total} ${total === 1 ? "seal" : "seals"}`
          : `refuses bet ${unsealed.join(", ")}: seal did not verify, nothing runs`;
      emit.emit({ role: "seal", action: action.slice(0, 160) });
    },
    runner(exp: Experiment, run: Run) {
      emit.emit({ role: "runner", action: `runs ${codeName(exp)} in the sandbox (${exp.id})`.slice(0, 160), ref: { kind: "run", id: run.id } });
    },
    runnerStopped(exp: Experiment, message: string) {
      emit.emit({ role: "runner", action: `could not finish ${exp.id}: ${message.replace(/\s+/g, " ")}`.slice(0, 160), ref: { kind: "experiment", id: exp.id } });
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
