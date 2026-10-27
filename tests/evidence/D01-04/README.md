# D01-04: TS harness (virtual clock, fake RPC, "never settles" detection, seed)

Date: 2026-10-27 (WAT)

The harness runs the real, unedited `withRpcRetry` from `tests/fixtures/with-rpc-retry.ts`
against a fake RPC function. It hands the code its own `sleep`, which writes each wait down
and moves a virtual clock forward instead of waiting. It also hands the code its own `log`,
which keeps every log line in a list. Every number below was counted while the code ran.
None of them is copied from the oracle table.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/harness.test.ts --reporter=verbose` (colour codes stripped) | `harness-oracle.txt` | 14 passed, exit 0 |
| a one-off script: `runScenario(withRpcRetry, S3 input, { seed: "atlas-d01-04" })`, one trace event per line | `trace-S3.jsonl` | 24 events, `t` = virtual ms, ends in `throws` at t = 12000 |

## What it proves

- For S1, S2, S3, S4, S5, S6 and H2 from `tests/oracle/retry-oracle.json`, the measured
  calls, list of waits, total wait, log-line count, `attempt i/n` in each log line, and the
  final outcome equal the oracle row exactly. **The table and the fixture agree on every
  row checked.** H1 was also run and agrees (1 call, 0 waits, returns at virtual 20,000 ms).
- For S3 and H2, the error thrown at the end is the one from the last call (call 5 and call 3).
- S6 (`fn` never answers) comes out as `outcome: "pending"`, `calls: 1`, `totalWaitMs: 0`,
  with `notMeasured.settleTime` = "the function never settled; Atlas stopped watching
  (harness limit, not the code's)". It takes about 0 ms of real time, well under the 200 ms limit.
- S3 covers 12,000 virtual ms in well under 200 ms of real time, so no real sleeping happened.
- Two runs with the same seed give deep-equal traces and results. A different seed gives
  different errors.
- If the code under test waits on a real timer the harness doesn't control, the outcome is
  reported as can't-check (`notMeasured.outcome`), not as "pending". This guards against plan
  section 10 item 7 (virtual time leaking into real time).

## What it does not prove

- **This run is in-process.** The sandboxed child process (no network, hard time limit) is
  D01-05. The same harness code runs there.
- **"Each error different" (S3) is true only because of the call number.** The seeded
  generator picks from a list of 6 error types, and repeats can happen (this seed picks
  `HttpRequestError` 3 times). Each message ends in "(call n)", which makes all five unique.
- **S4 and S5 aren't expressible in the shared shape.** The `retry-scenario` shape in
  `src/types.ts` has no field for "the error is a 429" (S4) or "resolve with this value" (S5).
  The harness takes a wider `RetryScenario` (`runners/ts/shapes.ts`) that adds `errorKind` and
  `resolvesWith`. A model's experiment can't ask for S4 or S5 until the shared type changes.
- **"Never settles" is decided by facts inside this process only:** the promise is unsettled,
  no virtual timers are left, and a `setImmediate` callback has run (so all queued promise
  reactions ran). Code that loops on microtasks forever would starve that check. Only the
  executor's wall-clock limit (D01-05) stops that case.
- **The 30 s watch limit is in virtual ms.** It only ends a run whose next virtual timer is
  past 30,000 ms. It isn't a real-time limit.
