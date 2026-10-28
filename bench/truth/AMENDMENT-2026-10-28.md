# Bench T, amendment 1 (2026-10-28, after the first result and the B1 review)

`PASS-RULE.md` and `expected.json` are frozen and stay as they are. This file adds rules; it changes no expectation.
It was written AFTER the first result (`results/2026-10-28.json`) and after an adversarial review of B1, and says so.

## 1. Can't-check reasons are now checked

Before: any "can't check" on a trap counted as a correct can't-check, whatever the reason (review, minor 1).
Now: each of the 18 traps has a reason category in `reason-categories.json` (for example t20a: network-or-files,
t25a: syntax). Atlas's reason must match the category's patterns; otherwise the test is
**"can't-check, wrong reason"**, a new name next to the five in the pass rule.

Honest note: the categories were assigned after seeing Atlas's reasons in the first result. The reviewer had
already checked all 18 reasons by hand against each trap's `because` text, independently, and found all 18 right.
Re-scoring the first result with the categories leaves it unchanged (18 correct can't-checks); the order test
re-scores every committed result and checks this.

## 2. Fields are counted, not only tests

The first result compared **304 fields** in its 70 fact tests (every field verdict "correct"). Results now state
the number of fields compared and how each was judged. Of the 70 fact tests, 46 take 0 virtual ms and use no
stand-in; 25 of those simply return plain JSON and 10 simply throw (the review counted 35 such "easy" tests). They can
only go wrong in how the value is written down. Any public sentence should say "70 tests (304 compared fields)",
not "70 facts".

## 3. The pass rule names the wrong test file

`PASS-RULE.md` says the order is checked by `tests/unit/bench-truth-order.test.ts`. The real file is
`tests/unit/bench-order.test.ts`.

## 4. Known false facts outside this set

The review found false facts in cases bench T does not contain: the type of a returned list or object that holds a
value JSON cannot store (`[1n]` is reported as `bigint`), CPU time read as 0 under the virtual clock, and orders or
values that change from run to run (setImmediate vs a 0 ms timer, Python's hash seed, `Math.random`). They are
pre-registered as bench T2 (`bench/truth-2/`). "0 false facts" is a statement about these 88 tests only.

## 5. Tooling

The runner (`run.ts`) no longer rewrites a result's table (`--render` is gone: result files are append-only), reads
expectations only from the registered path, refuses a dirty working tree, and records the registration's content
hash and the SHA-256 of every file that produced the result. Changes to the scoring code after a result are logged
in `bench/TOOLING-CHANGES.md` (the order test requires it).
