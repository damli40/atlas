# D01-03: withRpcRetry fixture and oracle table

Date: 2026-10-27 (WAT)

Both files here are PRE-EXISTING (listed in PRE-EXISTING.md): the 56 lines of
`withRpcRetry` and the oracle table were written before the hackathon. This task only
copies them in and adds checks that the copy is exact.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `shasum -a 256` on the original `chain-reads.ts`, then `diff` of its lines 31–86 against the fixture's verbatim block | `sha.txt` | hash `bf2d018c…59fb6` as expected; no differences |
| `pnpm exec vitest run --reporter=verbose` | `test-output.txt` | 6 passed, exit 0 |
| `pnpm exec tsc --noEmit` | `tsc-output.txt` | no errors, exit 0 (the fixture compiles) |

A one-off check also pointed the test at a missing path: the two original-file tests
showed as skipped (3 passed, 2 skipped), not failed. That temporary test file was deleted.

## What it proves

- The original file on this machine still has the SHA-256 recorded in PRE-EXISTING.md,
  so it has not changed since it was pinned.
- The fixture's block between the BEGIN and END markers is byte-for-byte lines 31–86
  of that file. No declarations had to be added: those lines need no imports.
- The oracle table has the eight cases S1–S6, H1, H2, and inside each case the number
  of waits, the number of log lines and the total wait agree with each other.

## What it does not prove

- That the oracle table describes what `withRpcRetry` really does. That needs the code
  to run; it is checked by the harness task (D01-04), not here.
- Anything on a machine without the original file (such as CI). There, the two checks
  against the original are skipped, and only the fixture's shape and the table's own
  consistency are checked.
- That the pinned file is the one that runs in production today. It only shows the
  file on this machine matches the pinned hash.
