# Bench M: note before the live run (2026-10-28)

Committed alone, before the first and only live run of bench M (decision D44: Muse Spark 1.3 + Muse Spark Open,
no Wonder, $8 hard stop).

- **The run may stop at $8.** `run.ts` adds up the cost logged for each model call and, once it reaches $8, makes no
  further model call. The estimate before the run: $4.63 central, $9.00 high (`dry-run/2026-10-28-3.json`).
- **Tests run in the registered order:** the order of `corpus.json` (m01a, m01b, m01c, m02a, ... m30c). For each test,
  Muse Spark bets first, then Muse Spark Open; then Atlas runs the code once and judges both.
- **A partial result is reported with its n, and only over the tests actually completed.** If the stop is reached,
  the result says how many of the 90 tests were done and where it stopped. Every rate is computed over completed
  tests only. Nothing is extrapolated to the tests not run, and the result is marked partial.
