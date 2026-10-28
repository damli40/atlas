// G1 (D33): the non-model places where Atlas spends, put behind the ledger without changing the runners.
//
// 1. Sandboxes. Every sandboxed command (a TypeScript or Python run, its control, a sweep, a change replay, a replay
//    from a proof card, the warm-up) goes through `executor.exec`. On Modal each one is a paid container, so the
//    wrapper reserves its worst case first (Modal's own lifetime limit for it, at the capped rate), checks Modal's
//    daily caps as kept on disk, and settles with the measured seconds. On the local executor a run costs $0: it is
//    never refused for money, only for a revoked invite, the "at once" limits, or a missing code.
//    A refusal THROWS, as the Modal executor's own daily cap does, so the run "did not finish" with the reason and
//    nothing is judged. G1 review B1: an exec that throws after it started is counted at its worst case (the
//    container may have run until Modal's own timeout).
// 2. EVM fork runs (POST /runs on Moonwell, change replays, autonomous rounds, GET /replay) and chain-facts reads.
//    Each one forks Base and makes paid archive-RPC reads, which have no dollar figure here, so they are counted per
//    invite per UTC day (default 10 for a "dev" code) on top of the existing per-hour gates.
// 3. G1 review B3/M3: the shared per-hour and "at once" gates (EVM runs, EVM replays, sandbox starts). Dev codes go
//    through the shared gate; the owner's code goes through its OWN copy of it, so no dev can use up the owner's slots.

import type { Executor } from "../../runners/runner";
import type { MoonwellChainFacts } from "../../src/chain-facts";
import type { ReplayGate } from "../replay-limits";
import { currentPrincipal } from "./context";
import { MODAL_USD_PER_SECOND_AT_CAPS, modalWorstCaseUsd, type Ledger } from "./ledger";

export function meteredExecutor<E extends Executor>(inner: E, ledger: Ledger): E {
  const modal = inner.kind === "modal";
  const exec: Executor["exec"] = async (req) => {
    const worst = modal ? modalWorstCaseUsd(req.wallClockMs) : 0;
    const held = ledger.reserve({ kind: "sandbox", usd: worst, what: `${inner.kind} sandbox`, modal });
    if (!held.ok) throw new Error(held.reason);
    const t0 = performance.now();
    let threw = false;
    try {
      return await inner.exec(req);
    } catch (e) {
      threw = true;
      throw e;
    } finally {
      const seconds = (performance.now() - t0) / 1000;
      if (!modal) held.settle(0);
      else if (threw) held.settle(worst, { seconds: (120_000 + req.wallClockMs + 30_000) / 1000, unknown: true });
      else held.settle(seconds * MODAL_USD_PER_SECOND_AT_CAPS, { seconds });
    }
  };
  return { ...inner, exec };
}

/**
 * A shared gate (EVM runs, EVM replays, sandbox starts) behind the ledger. `count` (EVM only) also counts each start
 * against the invite's daily EVM runs. The owner's code uses `ownerGate`, a separate copy with the same limits.
 */
export function meteredGate(inner: ReplayGate, ledger: Ledger, what: string, opts: { ownerGate?: ReplayGate; count?: boolean } = {}): ReplayGate {
  const count = opts.count ?? true;
  return {
    take(sessionId, clientIp) {
      const p = currentPrincipal();
      const gate = p?.kind === "invite" && p.role === "owner" && opts.ownerGate ? opts.ownerGate : inner;
      if (!count) return gate.take(sessionId, clientIp);
      const held = ledger.reserve({ kind: "evm", usd: 0, what });
      if (!held.ok) return { ok: false, reason: held.reason };
      const slot = gate.take(sessionId, clientIp);
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

/**
 * G1 review m2: the chain-facts read (an anvil fork with archive-RPC reads, once per fork block) counted as one EVM run
 * of the invite that triggered it. A success is cached for good; a failure for 60 s, so a failing RPC is not hammered.
 */
export function meteredChainFacts(read: (block: number) => Promise<MoonwellChainFacts>, ledger: Ledger, now: () => number = Date.now): (block: number) => Promise<MoonwellChainFacts> {
  const ok = new Map<number, Promise<MoonwellChainFacts>>();
  const failed = new Map<number, { at: number; error: unknown }>();
  return async (block) => {
    const hit = ok.get(block);
    if (hit) return hit;
    const f = failed.get(block);
    if (f && now() - f.at < 60_000) throw f.error;
    const held = ledger.reserve({ kind: "evm", usd: 0, what: "chain-facts read" });
    if (!held.ok) throw new Error(held.reason);
    const p = read(block);
    ok.set(block, p);
    try {
      const facts = await p;
      failed.delete(block);
      return facts;
    } catch (e) {
      ok.delete(block);
      failed.set(block, { at: now(), error: e });
      throw e;
    } finally {
      held.settle(0);
    }
  };
}
