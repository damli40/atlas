# Bench T2, "the found failures": pass rule (written before any T2 run)

This is a pre-registration, like bench T's. It is committed alone with `expected.json` and `cases/`, before any T2
run, and `tests/unit/bench-order.test.ts` checks the order and refuses later edits.

## Why this bench exists

Bench T (88 tests) found 0 false facts. The adversarial review of B1 then found, within an hour and outside that set,
calls where Atlas reports something untrue as a measured fact:
- the **type** of a returned list or object that holds a value JSON cannot store (`[1n]` reported as `bigint`);
- **CPU time** read as 0 (`Date.now()`, `performance.now()`, `perf_counter` around a busy loop), because Atlas's
  simulated ("virtual") clock only moves when the code waits;
- **orders and values that change between runs** (a 0 ms timer vs `setImmediate`, Python's string-hash seed,
  `Math.random`, `crypto.randomUUID`), reported as if they were fixed;
- the **machine's time zone**, and calls on **unref'd timers** whose ending depends on what keeps the process alive.

T2 holds exactly the review's 22 cases (8 files, copied unchanged), each with what an **honest** Atlas should
report. It is run once now, against the runners on main ("before"), and again when the runner fixes land ("after").
The "before" run is expected to show false facts.

## What "honest" means here

For each test `expected.json` writes one of:
- **A plain fact** (outcome, returned JSON, type, virtual ms, call counts), compared exactly as in bench T.
  **11 tests are plain facts**: 6 the review found Atlas already gets right (h05a, h05b, q01b, q01d, q02a, q02b) and 5
  returned types it gets wrong today (q01c, h06a-d).
- **`{ "dependsOn": "<category>" }`** on a field: the true value depends on something outside the code (Atlas's
  clock, randomness, scheduling order, the host, the process's lifetime). Reporting it as a plain measured value is a
  **FALSE FACT**. Not measuring it, with a reason in that category, is correct. `wholeRunCantCheckOk` on such a test
  says a whole-run "can't check" with a reason in that category is also honest.
- **`cantCheck`** with a `reasonCategory` (h01b, a busy-wait): Atlas must refuse, for a clock or real-time reason.

Reason categories are registered in `expected.json` (`reasonCategories`: category -> patterns, case-insensitive).
A refusal whose reason matches none of its category's patterns is **"can't-check, wrong reason"**.

**Measured under Atlas's own rules, labelled.** A fix may instead pin the outside thing (a fixed time zone, a fixed
hash seed, a seeded random generator, a declared timer order) and report the value as measured under that rule. That
is honest only if the run says so. Today's result format has no field for such a label, so the "after" run can count
a labelled value as correct only if an amendment, committed before that run, defines exactly where the label is and
which categories it covers. Without that amendment, a pinned value reported as a plain fact still counts as a FALSE
FACT.

Conventions already stated by bench T stay: JSON writes -0 as 0 and 2.0 as 2; the clock starts at
2026-01-01T00:00:00Z; virtual ms measure Atlas's clock.

## Classification and reporting

Same names as bench T plus amendment 1: correct fact, FALSE FACT, correct can't-check, can't-check wrong reason,
wrong can't-check (over-refusal), missed can't-check, control failed. A result states the sample (22 tests, 8 files),
the executor, versions, the commit, the registration's content hash, the SHA-256 of every file that produced it, and
**fields compared**, as well as tests. The h02 pair (unref'd timers) is reported on its own line too: the review rated
it context-dependent (minor), not a plain error.

**Sample size always stated; no general claims.** "Before" and "after" are about these 22 tests.

## When the "after" run is clean

The bench B1 README's honest sentence keeps its last clause ("we have since found cases outside this set where it
does") until the runner fixes land AND T2's "after" run has 0 FALSE FACTs. Expectations are never edited; corrections
go in a dated amendment committed before the run that uses it.
