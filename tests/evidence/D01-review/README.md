# D01 review: fixes for the day-1 adversarial review

Date: 2026-10-27 (WAT) · Node v25.8.1

An adversarial review of the day-1 code found 1 blocker, 11 should-fix and 10 minor issues.
Each finding had a probe: a small script that makes the bug happen. This folder records, for each
finding, whether it is fixed, the test that now guards it, and the probe output before and after.

The rule that settled every unclear case: **when Atlas did not truly measure something, the answer
is "can't check", never a guess.**

## Files

| File | What it is |
|---|---|
| `probes-before.txt` | Every probe run against the code before these fixes (commit fefad8d) |
| `probes-after.txt` | The same probes run against the fixed code |
| `blocker-tests-on-old-code.txt` | The blocker's new tests, run on the old code: 3 fail |
| `runner-tests-on-old-code.txt` | The runner tests (findings S1, S2, S6, S7, minors 5 and 6) on the old code: 12 fail |
| `judge-tests-on-old-code.txt` | The judge tests (S3, S4, S5, minors 1, 3, 4) on the old code: 14 fail |
| `seal-meta-tests-on-old-code.txt` | The seal and Meta client tests (S8, S9) on the old code: 4 fail |
| `fixture-edit-demo.txt` | One space added inside the fixture's verbatim block on a clean clone: old checks pass, new ones fail |
| `test-output.txt`, `tsc-output.txt`, `gate-day1.txt` | `pnpm test`, `pnpm exec tsc --noEmit` and `pnpm gate:day1` after all fixes |

The probe scripts themselves are not in the repo (they hold local paths).

## Findings

| Finding | Status | What changed | Probe before → after |
|---|---|---|---|
| **B1** watch limit recorded as "pending" | fixed | A run that Atlas's watch limit or step limit (or a real timer) ended while the function was still working now puts outcome, calls, waits, logs and settle time in `notMeasured`, e.g. "Atlas's watch limit (30000 ms of virtual time…) ended the run before the function finished; the count so far was 11". The partial counts stay in the trace, marked `partial: true`. A measured "pending" now means only: unsettled, no timers left, queue drained. | attempts=20: `calls 11, totalWaitMs 33000, outcome pending` → all can't check |
| **S1** result over 64 KB cut off | fixed | The worker writes with blocking writes to fd 1 in a loop, then exits. | attempts 200/400: `SyntaxError` → 200/400 calls measured |
| **S2** code under test can rewrite its result | fixed (best effort) | Native references kept before the import; a random per-run marker passed as an argument and removed from `process.argv`; the parent takes only the first marker line; a second one, bad JSON, a wrong shape or a `toJSON` on a built-in prototype counts as tampering (`controlPassed: false`, reason kept). **Same-process isolation is best effort, not a security boundary**: code written to attack the harness could still change built-ins it relies on. Atlas runs the user's own code, not an attacker's. | stdout rewrite: `controlPassed true` → `false`; exit-handler forgery: overrode the real result → ignored; malformed line: threw → ignored |
| **S3** judge counts a run with missing control | fixed | Only `controlPassed === true` counts. Checked `server/app.ts` and `runExperiment`: both now use the strict check. | missing / `"false"`: matched → can't check |
| **S4** enum options not checked | fixed | Answer and observed value must be among the bet's options; outcome options must be `returns` / `throws` / `pending` (`OUTCOME_OPTIONS`, src/units.ts). Gate question text uses the same words. | (judge tests) |
| **S5** unit check only on prices | fixed | One table in `src/units.ts` gives each field a unit (calls = count, totalWaitMs = ms, priceUsd1e18:* = USD, outcome = enum). Wrong kind or unit, or a field with no unit on file → can't check. | integer 2205 on a price: not matched → can't check; 12 "s" on totalWaitMs: not matched → can't check |
| **S6** unref'd real timer looked like "never settles" | fixed | The harness wraps setTimeout / setInterval / setImmediate before the target is imported. A pending real timer → can't check. The code's own setImmediate is waited for. Best effort: a `node:timers/promises` timer created with `ref: false` is not seen. | `outcome pending` → can't check |
| **S7** control skipped never-settles | fixed | `CONTROL_CASES` is now S1, S3, S6. A test edit that gives up on a call that never answers passes S1 + S3 but fails S6. H1 was not added: it is a held-out row. | (control tests) |
| **S8** Meta client throws after a billed call | fixed | A usage-file failure returns the result with a `warning`; a 200 with usage but no choices writes the usage line first. | threw ENOENT → ok with warning; no usage line → line written |
| **S9** rationale not sealed | fixed | The rationale is in the hash when present. **Stricter than the original spec's field list**, on purpose. A bet without a rationale hashes the original seven fields. | rewritten rationale verifies: true → false |
| **S10** tests/ publishes everything | fixed | `.githooks/pre-commit` runs `tests/tools/secret-scan.mjs` on staged files: blocks the real Meta key and Base RPC URL (loaded at run time, never printed) and generic shapes. `.githooks/` added to the allow-list on purpose; `core.hooksPath` set. A throwaway file with a fake `sk-` key was staged and the commit was blocked. | (no probe) |
| **S11** fixture not checked on a fresh clone | fixed | The verbatim block's SHA-256 is pinned in `fixture.test.ts` and runs everywhere. The control test pins the fixture file's SHA-256. | see `fixture-edit-demo.txt` |
| Minor 1: integer bet vs 5.5 | fixed | can't check | |
| Minor 2: zero observed value | documented | Written in the judge's header comment: with observed 0, only a bet of exactly 0 matches. | |
| Minor 3: tolerance or value as text | fixed | The judge refuses non-number values. | |
| Minor 4: reference fallback | fixed | A price bet reads only its `refUsd1e18:` reference. | reference `9` attached → none |
| Minor 5: negative wait | fixed | A negative wait leaves `totalWaitMs` not measured, with the reason. | `totalWaitMs -3000` → not measured |
| Minor 6: own setImmediate → can't check | fixed | Waited for (see S6). | can't check → returns |
| Minor 7: test that could not fail | fixed | The S3 errors test now checks each error's call number. The control test's self-computed SHA is pinned (S11). | |
| Minor 8: private-plan references | fixed | Plain wording in runner.ts, types.ts, app.ts, harness.test.ts, three READMEs. Task ids like D01-08 stay: they name the evidence folders. | |
| Minor 9: local paths | fixed | Removed from evidence outputs. The fixture test reads the private original's path from `ATLAS_FIXTURE_SOURCE` (no default: the path names a private repo). | |
| Minor 10: usage log in a public file | not changed | The default still appends to `tests/evidence/usage/usage.jsonl`. Each line holds only tokens, dollars and the finish reason (the key is never written), and the file is the public spend record the project rules ask for. Set `ATLAS_USAGE_PATH` to send it elsewhere. | |

## Gate after the fixes

`pnpm gate:day1`: **18 matched, 1 didn't match, 1 can't check**, control passed on every run,
680 ms. Same counts as before. The one control run now covers S1, S3 and S6.

## What this does not prove

- **The secret hook was tested with a fake key only.** Writing the real key into a throwaway file to
  test the block was refused by the session's safety check. The hook does load both real values
  (checked by printing only their names).
- **The hook runs only where `git config core.hooksPath .githooks` was set.** A fresh clone must set it.
- **Tampering protection is best effort** (see S2). It stops the forgeries the review tried, not a
  target written to attack the harness.
- **The original-file fixture checks are now skipped unless `ATLAS_FIXTURE_SOURCE` is set**, on this
  machine too. Run once with it set: 7 of 7 fixture tests passed.
- **Probe 1 of the harness probe** under `tsx` picks up the timer through the new wrapper; before the
  fix it was caught only by accident (tsx's own file reads), which is why `unref-probe.mjs` is the
  clean before/after for S6.
