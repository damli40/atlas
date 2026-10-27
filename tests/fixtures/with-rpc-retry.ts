// PRE-EXISTING (listed in PRE-EXISTING.md). Atlas checks this code; it is not part of Atlas.
//
// Source: Dami's production LayerZero monitor (private repo), file chain-reads.ts,
// lines 31–86, copied verbatim. SHA-256 of the whole original file:
// bf2d018c092deba95fb40fc6c4a934e2b2992b58bcde2b83d08590d197059fb6
//
// Nothing between the BEGIN and END markers may be edited.
// tests/unit/fixture.test.ts compares it to the original when the original is present.

// ---- BEGIN VERBATIM (chain-reads.ts lines 31–86) ----
/** Retry budget for a single chain read. 5 attempts, 3s apart — measured against
 *  the lag that produced the failures these retries exist for (a load-balanced RPC
 *  answering from a node one or two blocks behind a just-landed transaction). */
export const RPC_RETRY_ATTEMPTS = 5;
export const RPC_RETRY_DELAY_MS = 3000;

/** The slice of a viem PublicClient this module uses. Structural on purpose: tests
 *  inject a plain object and exercise the failure branches, which are the branches
 *  that matter and the ones a live RPC will not reproduce on demand. */
export interface ChainReadClient {
  readContract(args: any): Promise<any>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ blockNumber: bigint }>;
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Injectable so tests do not spend 12 real seconds proving the retry budget. */
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Every chain read on the guardian path goes through here.
 *
 * KeeperHub reports an execution `completed` as soon as ITS node has the receipt,
 * while a public RPC endpoint is load-balanced — so the very next read can land on a
 * node one or two blocks behind and throw (`BlockNotFoundError`, seen live on
 * rehearsal run-005) or answer from stale state. Block-pinned reads are MORE exposed
 * to this than `latest` reads, not less: a node that has not seen the block cannot
 * serve a query against it at all.
 *
 * **Fail-closed.** Rethrows the last error after the final attempt rather than
 * returning a default. Each caller decides what a permanent failure means for its own
 * artifact — and none of them may drop the artifact.
 */
export async function withRpcRetry<T>(label: string, fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? RPC_RETRY_ATTEMPTS;
  const delayMs = opts.delayMs ?? RPC_RETRY_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;
  const log = opts.log ?? console.log;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i < attempts) {
        log(`${label}: chain read failed (attempt ${i}/${attempts}, likely RPC lag) — retrying in ${delayMs / 1000}s`);
        await sleep(delayMs);
      }
    }
  }
  throw last;
}
// ---- END VERBATIM ----
