# D01-06: judge, seal and units (pure code)

Date: 2026-10-27 (WAT)

The judge is the plain code that decides whether a sealed bet matched what a run measured.
It has no I/O, no clock and no model. The seal fixes a bet before the run with a SHA-256 hash.
`src/units.ts` is the only file that changes the scale of a number (for example, a stablecoin
price the oracle reports as about 1e30 becomes about 1e18, which means $1).

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `pnpm exec vitest run --reporter=verbose tests/unit/judge.test.ts tests/unit/seal.test.ts tests/unit/units.test.ts tests/unit/wording.test.ts` | `judge-tests.txt` | 61 passed, exit 0 |
| `pnpm exec tsc --noEmit` | `tsc-output.txt` | no errors, exit 0 |

Two one-off checks that the tests can fail (both reverted, not committed):
- A temporary `src/__tmp_lint.ts` holding the string "that was wrong" made the wording lint fail and name `src/__tmp_lint.ts:1`.
- Changing the judge to measure tolerance against the bet instead of the observed value made 3 judge tests fail.

## What it proves

- Every "can't check" branch fires with its plain reason: control run failed, bettor declined,
  runner listed the field as not measured, field absent, bet on another experiment's run,
  non-USD unit on a USD 1e18 price, observed value stored in a type the bet cannot be compared with.
- Whole-number and choice bets match only exactly. Number bets use a tolerance that is a share of
  the OBSERVED value: bet 2200 USD vs observed $1.12 at 10% → not_matched; bet 2250 vs observed
  $2,205 at 10% → matched; bet 1.0 vs $1.12 → not_matched; bet 1.24 vs $1.12 → not_matched
  (this last one would match if the tolerance were a share of the bet, so the rule is pinned).
- USD amounts become 1e18 integers from their decimal text, never by multiplying a float
  (2205.05 → exactly 2205050000000000000000).
- The pure-TypeScript SHA-256 gives the same hash as `node:crypto` on empty, ASCII, unicode,
  emoji, block-boundary lengths and random bytes. Key order does not change a bet's hash;
  changing any sealed field (answer included) makes `verifySeal` return false.
- No string literal (or JSX text) under src/, server/, web/, runners/ in this worktree uses
  "wrong", "correct", "bug", "right answer", "fixed" or "broken".

## What it does not prove

- That runners store measured values in the form the judge expects (USD 1e18 prices as
  whole-number strings). That is checked when the runners land (D01-08, D04).
- The SHA-256 was run in Node only, not in a real browser. It uses only `TextEncoder`,
  typed arrays and `crypto.getRandomValues`, which browsers have.
- The wording lint is a small hand-written scanner, not a full TypeScript parser. Unusual
  syntax (for example a regex right after `)`) could be misread. It only covers files present
  in this worktree; runners/ and server/meta/ from other worktrees are scanned once merged.
