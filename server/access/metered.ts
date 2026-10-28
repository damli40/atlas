// G1 (D33): the two non-model places where Atlas spends, put behind the ledger without changing the runners.
//
// 1. Sandboxes. Every sandboxed command (a TypeScript or Python run, its control, a sweep, a change replay, a replay
//    from a proof card, the warm-up) goes through `executor.exec`. On Modal each one is a paid container, so the
//    wrapper reserves its worst case first (Modal's own lifetime limit for it, at the capped rate), checks Modal's
//    daily caps as kept on disk, and settles with the measured seconds. On the local executor a run costs $0: it is
//    never refused for money, only for a revoked invite, the "at once" limit, or a missing code.
//    A refusal THROWS, as the Modal executor's own daily cap does, so the run "did not finish" with the reason and
//    nothing is judged.
// 2. EVM fork runs (POST /runs on Moonwell, change replays, autonomous rounds, GET /replay). Each one forks Base and
//    makes paid archive-RPC reads, which have no dollar figure here, so they are counted per invite per UTC day
//    (default 10 for a "dev" code) on top of the existing per-hour gates.

import type { Executor } from "../../runners/runner";
import type { ReplayGate } from "../replay-limits";
import { MODAL_USD_PER_SECOND_AT_CAPS, modalWorstCaseUsd, type Ledger } from "./ledger";

export function meteredExecutor<E extends Executor>(inner: E, ledger: Ledger): E {
  const modal = inner.kind === "modal";
  const exec: Executor["exec"] = async (req) => {
    const held = ledger.reserve({ kind: "sandbox", usd: modal ? modalWorstCaseUsd(req.wallClockMs) : 0, what: `${inner.kind} sandbox`, modal });
    if (!held.ok) throw new Error(held.reason);
    const t0 = performance.now();
    try {
      return await inner.exec(req);
    } finally {
      const seconds = (performance.now() - t0) / 1000;
      held.settle(modal ? seconds * MODAL_USD_PER_SECOND_AT_CAPS : 0, modal ? { seconds } : undefined);
    }
  };
  return { ...inner, exec };
}

/** An EVM gate (runs or replays) that also counts each start against the invite's daily EVM runs. */
export function meteredGate(inner: ReplayGate, ledger: Ledger, what: string): ReplayGate {
  return {
    take(sessionId, clientIp) {
      const held = ledger.reserve({ kind: "evm", usd: 0, what });
      if (!held.ok) return { ok: false, reason: held.reason };
      const slot = inner.take(sessionId, clientIp);
      if (!slot.ok) {
        held.cancel();
        return slot;
      }
      return {
        ok: true,
        release: () => {
          slot.release();
          held.settle(0);
        },
      };
    },
  };
}
