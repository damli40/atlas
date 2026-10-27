# The intermittent RPC-suite failure: found, explained, fixed

Date: 2026-10-27 (WAT) · no model call ($0).

## Where to look first

- **The flaky test:** `tests/unit/review-final-server.test.ts` → "S2 on a real Base fork … the file verifies with its
  attempt". It failed in run 4 of 5 before the fix (`runs.txt`), at `expect(file.attempts).toHaveLength(1)`: the round's
  `.atlas.json` did not exist.
- **The cause (a real server bug, not the network):** when a run attempt does not finish (anvil failed), the server records
  the time it stopped. The `.atlas.json` check requires that attempt to have stopped **strictly before** the next run started.
  The retry can land in the same millisecond as the failed attempt's 503. Then the run's start time equals the attempt's stop
  time, the file does not verify, no proof is kept, and `GET /proofs/:runId` is 404. The server already waited for the clock
  to move past the last **seal** before starting a run; it did not wait past the last failed **attempt**.
- **The fix:** `server/app.ts` `runRound` waits until the clock is past both the last seal and the last failed attempt's
  stop time (a few ms at most). No retry was added.
- **Proof:** `tests/unit/attempt-order.test.ts` freezes the clock so the retry lands in the same millisecond every time. On
  the old code it fails with "attempt 1 did not stop before run … started" (`test-on-old-code.txt`); with the fix it passes.
  Then **5 of 5 RPC-loaded runs were clean** (782 passed each). The offline suite: 766 passed, 19 skipped.
- This also explains the final review's "one flaky RPC run (1 of 7)" whose test was never named. The offline S2 tests could
  hit the same race; they just did not in these runs.

## A second failure I caused, and fixed

The first after-fix batch failed 4 of 5 runs on `review-day7-minors.test.ts` M5 ("72 lines, $5.82752 in all"). That was not a
flake: my D22 live rounds appended 8 lines to `tests/evidence/usage/usage.jsonl`, and the test pinned the file at exactly 72
lines. Its purpose was to check that a one-time migration kept the old lines' dollars, so it now checks the first 72 lines
only. That batch was thrown away (the code changed during it); the 5 clean runs above are a fresh batch on commit `af4305d`.

## How the runs were made

Each run: the full suite (`vitest run`, JSON reporter) with `~/.config/atlas/rpc.env` loaded at run time, the failing test
names taken from the JSON. Before: a clean copy of commit `bb2a329` (a git worktree, so in-progress edits could not cause
failures). After: this repo at `af4305d`. Before-run 5 skipped one more test (the live GitHub fetch, which skips on a GitHub
rate limit by design); the 3 skips in every run are fixture-hash checks that need a private original file.

## What this proves

- The named test failed for the reason above, the race is reproducible on demand, and the fix removes it.

## What this does not prove

- 5 clean runs alone are weak evidence for a failure seen about 1 time in 5 to 7. The deterministic test is the stronger proof.
- Other rare network failures (a slow Base RPC) can still fail an RPC test. None was seen in these 10 runs.

## Files

- `runs.txt` (every run's totals and failing test names), `test-on-old-code.txt`, `test-output-offline.txt`.
