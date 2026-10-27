// Final review S2: a run that did not finish, as opposed to a run that finished with a result.
//
// Plain words: a run can stop before it measures anything because of the machine, not the code: the Base
// RPC is not set, anvil (Foundry's local fork) is missing or crashed or was too slow to start, or the
// sandbox could not start. That is not a result about the code, so nothing is judged and the experiment is
// not used up: the same experiment can run again with the same sealed bets. This file turns the runner's
// error into one plain sentence (the RPC URL, its host and key removed; at most 300 characters).

import { redactRpc } from "../runners/evm/redact";

/** Thrown by the server's run step when the runner stopped before a Run existed. `message` is what the page shows. */
export class RunDidNotFinish extends Error {
  constructor(readonly reason: string) {
    super(`the run did not finish: ${reason}`);
    this.name = "RunDidNotFinish";
  }
}

const MAX = 300;

/** The runner's error as one plain, redacted line. */
export function runFailureReason(e: unknown): string {
  let text = redactRpc(e instanceof Error ? e.message : String(e));
  if (/spawn anvil ENOENT/.test(text)) text = "anvil (Foundry's local fork) was not found on this machine; install Foundry or put anvil on PATH";
  // anvil's own output tail can be long: keep the first sentence and the start of the output.
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text || "no reason given";
}
