# D07-02 merge with D07-01 (open weights)

Date: 2026-10-27. `git merge d07-adversary` into main, which already held d07-openweights.

- Conflicts resolved keeping both: POST /runs answers carry `models` (D07-01) and run through the shared
  `runRound` (D07-02); server log line names both features; the fixture flow shows the claimant toggle and "What else?".
- `usage.jsonl`: every line from both sides kept (67 main + 62 branch − 57 shared = 72), sorted by `ts`.
- The autonomous round obeys `x-atlas-claimant`: with `both`, Muse Spark and Muse Spark Open each seal bets before the
  run (test: 2 sealed slots, 6 verdicts); an unknown header is refused (400). The screen lists every model slot.
- Repeat check fills in defaults before comparing: the harness's (resolveAfterMs 0, errorKind seeded, resolvesWith
  "the value", only where they can act) and the function's, read from the target's code (`opts.attempts ?? …` →
  attempts 5, delayMs 3000 on the fixture). `failTimes 5` = `failTimes 5, attempts 5`. A default it cannot read is
  not guessed. Tested in `tests/unit/adversary.test.ts`.
- A Level 1 autonomous run shows its caption beside the run: "re-run after the fact, on a fork of Base at block
  42194663. Fork Base at block 42194663, the block the proposal ran in … So this read is after the proposal ran".
  The Adversary's own sentence is unchanged (model panel).

| Check | Output | Result |
|---|---|---|
| `pnpm test` offline | `test-output-offline.txt` | 681 passed, 17 skipped |
| `pnpm test` with BASE_RPC_URL | `test-output-rpc.txt` | 695 passed, 3 skipped |
| `tsc --noEmit` | `tsc-output.txt` | exit 0 |
| `vite build` | `vite-build.txt` | built |
| `pnpm gate:day1` | `gate-day1.txt` | 18 / 1 / 1 |
| secret scan, every tracked file | (no findings) | exit 0 |
| no-local-paths test | in the suites above | passed |
| headless page (`page-check.mjs`, no model asked) | `page-check.txt`, `page-check.png` | toggle and "What else?" render; page errors none |

No live model call was made for the merge ($0). Not re-shown live: a "both" autonomous round with real models.
