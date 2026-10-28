# R1: the false facts bench T2 found, fixed (D36)

Date: 2026-10-28 · no model call ($0) · no Modal call · Node 25.8.1, Python 3.14.7, macOS, local executors only.
Branch `r1-facts`, from main `298a781`.

## Where to look first

- **Bench T2 on these 22 tests, before → after: 15 FALSE FACTs → 4.** The 4 left are the ones Atlas now *pins*
  (the time zone, `Math.random`, `crypto.randomUUID`, Python's set order). Each one now reports its value **with a
  conditions line** saying it is Atlas's pinned value. T2's pass rule (written before R1) counts a labelled pinned
  value as honest only after an amendment, which has not been committed yet. The amendment text is at the end of this
  file. Under that amendment the count would be **0 FALSE FACTs on these 22 tests**. This is a scratch run on one
  laptop (`t2-after-scratch.md`), not a registered T2 result: `bench/` is on `b1-bench` and was not edited.
- **What changed, in plain words:**
  1. **Randomness has one recorded seed** (default `20260101`; it is just a number). `Math.random`,
     `crypto.getRandomValues` and `crypto.randomUUID` in JavaScript, and Python's `random`, `os.urandom` (and with it
     `uuid4`, `secrets` and `SystemRandom`), an unseeded `Random()`, and the string-hash seed (`PYTHONHASHSEED`, which
     decides the order of a set of text) all draw from it. The same test gives the same run every time, and a replay
     uses the original run's seed.
  2. **The time zone is UTC and the locale is fixed** (`en-US` for JavaScript, `C` for Python). The sandbox checks
     Node's and Python's own answers before the code exists. If the check fails, the whole run is "can't check", so
     a result is never in this machine's zone.
  3. **Conditions.** When the code leans on one of these pinned things, the run records it, and the verdict screen
     and the proof card show a plain "Conditions" line. Example: "This code read the clock. Atlas's clock is
     simulated (it starts at 2026-01-01T00:00:00Z and moves only while the code waits), so time-based values are
     Atlas's, not your machine's." The same happens when the code depends on something nobody controls.
  4. **Where no honest value exists, Atlas does not report how the call ended:**
     - CPU work timed with the clock (Atlas's clock does not move during work);
     - an order Node leaves open (a 0 ms timer next to `setImmediate`, or `process.nextTick` in the call's synchronous
       part next to promise callbacks);
     - a call waiting only on unref'd timers (a plain script would exit first);
     - randomness Atlas cannot seed (`crypto.subtle` key generation, randomized signatures).
     The bets on those fields are "can't check", each with its reason.
  5. **`returnedType` is the returned value's own type.** `[1n]` is now `array`, not `bigint`. The item inside
     that JSON cannot hold is named, with where it is, in the reason, e.g. "an item inside it (at [0], bigint) is not
     plain JSON: it is a BigInt…".
- **Nothing regressed:** full suite 3× **1,266 passed, 35 skipped, 0 failed** (from 1,196 on main). tsc clean.
  `no-local-paths` passes. The retry fixture day gate still gives 18 / 1 / 1.

## Per-test outcome, bench T2 (22 tests), before → after

| Test | What it does | Before (main, T2 result `2026-10-28`) | After (R1) | T2 class after |
|---|---|---|---|---|
| h01a | CPU work timed with Date.now / performance.now | `dateMs 0` as a fact | outcome not measured: timed work, clock reason; conditions clock, clock-during-work | correct can't-check |
| h01b | busy-wait on Date.now | can't check (real-time limit) | same | correct can't-check |
| h02a | waits on an unref'd setTimeout | returned "done" at 100 ms | outcome not measured: unref'd timer reason | correct can't-check |
| h02b | AbortSignal.timeout alone | threw TimeoutError at 100 ms | outcome not measured: unref'd timer reason | correct can't-check |
| h03a | setTimeout 0 vs setImmediate | `["immediate","timeout"]` as a fact | outcome not measured: order Node leaves open | correct can't-check |
| h03b | nextTick vs promise | `["promise","nextTick"]` as a fact | outcome not measured: order Node leaves open | correct can't-check |
| h04a | local hour, offset, time-zone name | `hour 1, Africa/Lagos` (this Mac's zone) | `{"hour":0,"offset":0,"tz":"UTC"}` + conditions clock, time-zone-or-locale | FALSE FACT until the amendment (pinned + labelled) |
| h04b | Math.random coin | "heads" one run, "tails" another | "tails" on every run + condition randomness (seed 20260101) | FALSE FACT until the amendment |
| h04c | crypto.randomUUID prefix | different every run | "b6cb50a1" on every run + condition randomness | FALSE FACT until the amendment |
| h05a | setInterval cleared after 3 | 3 at 3 ms, cb×3 | same | correct fact |
| h05b | timer.refresh | 160 at 160 ms | same (+ condition clock) | correct fact |
| q01a | list() of a set of text | a different order per run | one order on every run + condition hash-seed | FALSE FACT until the amendment |
| q01b | `{1:…, True:…, "1":…}` | object, not JSON | same | correct fact |
| q01c | `[("a", 1)]` | type `tuple` | type `array`, reason names the tuple at [0] | correct fact |
| q01d | `2.0` | 2 | same | correct fact |
| q02a | blocking sleep while a task waits | `["v",500]` at 500 ms | same (+ condition clock) | correct fact |
| q02b | wait_for 0.1 s vs a 0.5 s answer | "timed out" at 100 ms | same | correct fact |
| q02c | perf_counter around CPU work | `false` as a fact | outcome not measured: timed work, clock reason | correct can't-check |
| h06a | `[1n]` | type `bigint` | type `array`, reason names the BigInt at [0] | correct fact |
| h06b | `[1, NaN]` | type `number (NaN)` | type `array`, reason names NaN at [1] | correct fact |
| h06c | `{ a: undefined }` | type `undefined` | type `object`, reason names undefined at .a | correct fact |
| h06d | `{ when: Date }` | type `object (Date)` | type `object`, reason names the Date at .when | correct fact |

Counts after: 11 correct fact, 7 correct can't-check, 4 FALSE FACT (all pinned + labelled), 0 over-refusal, 0
wrong-reason (`t2-after-scratch.md`; fields compared 63, 59 correct, 4 FALSE).

## The command and the counts

```
pnpm vitest run tests/unit/r1-facts.test.ts tests/unit/r1-conditions-ui.test.tsx --reporter=verbose
pnpm test        # 3 times: full-suite.txt
npx tsc -p .     # tsc-output.txt
# the T2 "after" run, in a throwaway worktree holding b1-bench's bench/ (removed afterwards):
npx tsx bench/truth/run.ts --bench truth-2 --allow-dirty
```

| | main `298a781` | R1 |
|---|---|---|
| Test files | 94 (+2 skipped) | 96 (+2 skipped) |
| Tests passed | 1,196 | 1,266 (+70: 64 in r1-facts, 4 UI, 2 changed tests split) |
| Skipped | 35 | 35 |
| tsc | 0 errors | 0 errors |

Files: `test-output.txt` (the R1 tests, no-local-paths and the day gate by name), `full-suite.txt` (3 runs),
`tsc-output.txt`, `t2-after-scratch.md` / `.json` (the scratch T2 run).

## What was tested (`tests/unit/r1-facts.test.ts`, `tests/unit/r1-conditions-ui.test.tsx`)

- **The 22 T2 tests** (fixtures in `tests/fixtures/r1-t2/`, copied unchanged from `b1-bench:bench/truth-2/cases/`),
  each asserting the honest result above. Each not-measured reason is checked against T2's registered category
  patterns, copied into the test.
- **Seeding:** `Math.random` / `getRandomValues` / `randomUUID` code gives identical measurements on two runs.
  Seed 42 gives other values, is recorded, and a replay with 42 reproduces them exactly. Seeds Atlas does not use
  (`none`, `0`, text) fall back to the default. The worker refuses an invalid seed. Python: `random`, `uuid4`,
  `secrets`, `os.urandom`, `Random()` and set order are identical across runs and differ under another seed.
- **Conditions, one per kind**, in JavaScript (16 cases) and Python (8). Each case checks the kinds recorded and
  whether the outcome was reported. Negative cases too: a deadline loop that reads the clock between waits is not
  "timed work"; `console.log` (Node calls `process.nextTick` inside it) is not a race; `setImmediate` alone is not a
  race; UTC getters read no zone; an unref'd timer next to a ref'd one is measured, and `hasRef()` now says `false`;
  `Random(5)` is the code's own seed.
- **Pins in the sandbox:** a JavaScript sandbox started with `TZ=Africa/Lagos` is whole-run can't check, never
  Lagos hours. A Python sandbox without the pinned hash seed is whole-run can't check. The JavaScript env is exactly
  `TZ=UTC, LC_ALL=en_US.UTF-8`.
- **Proof files:** a run's file carries the seed, `timeZone`, `locale` and `conditions`, and verifies. Verify fails
  when any of these is edited: a condition removed or reworded, the trace's conditions event removed, the time
  zone, the locale, or the seed. It also fails when an undecided run claims an outcome. A pre-R1 file (seed `none`,
  no pins) still verifies; one that mixes old and new does not. A Python file verifies with locale `C`.
- **D31 fingerprints (confirmed):** `callHarnessSha256()` and `pyHarnessSha256()` equal the SHA-256 of the sandbox
  files read from disk at that moment, so any edit to a harness file changes the reuse key. R1 also added the seed,
  the pinned time zone, the locale and the sandbox env to both control keys (they live in the runner, which is not
  hashed).
- **Controls:** new known cases C10-pins (JavaScript: `Math.random`, `randomUUID`, `getHours` of epoch,
  Intl time zone, `toLocaleString`) and P14-pins (Python: `random`, `uuid4`, `secrets`, `localtime`, `%Z`). If the
  seed or the pins stop working on an executor, its control fails and every verdict is "can't check".
- **UI:** the proof card shows "seed 20260101 · time zone UTC · locale en-US" and each condition sentence. It says
  "None" when there are no conditions. The verdict screen shows the same line. An old file shows no conditions line,
  and its seed text says the run is from before Atlas seeded randomness.
- **Tests changed on purpose (their old answers were the false facts):**
  - `AbortSignal.timeout` alone used to "return at 20 ms". It is now unref'd as in Node, so the test keeps the
    process alive with a ref'd timer, and a new test asserts the alone case is can't check.
  - "works: process.nextTick" now calls it from a timer callback.
  - The nested poisoned float in Python now reports `object` with the item named.
  - Python flag and env tests use `-s -P -S -B` and the pinned env.

## Spec deviations and choices (the conservative one each time)

1. **"Timed work" is decided with real CPU time:** two clock reads at the same virtual moment with ≥ 2 ms of the
   process's CPU time between them. A rule that flagged every repeated read would refuse ordinary deadline and retry
   loops. Near the 2 ms line the decision can differ between runs or machines (see limits).
2. **`process.nextTick` in the call's synchronous part is always "timer-order"**, even when no promise callback
   races it. Atlas cannot see the microtask queue, so this over-refuses. Calls made by Node's own code are told apart
   by their caller frame (`node:`).
3. **A 0 ms timer next to `setImmediate` is flagged even inside a timer callback,** where real Node's order is in fact
   fixed. This over-refuses.
4. **Python's "hash-seed" and "time zone" disclosures come partly from reading the file** (sets, set comprehensions,
   `set()` / `frozenset()` / `hash()`, `.keys() & …`, `time.timezone`, `tzname`, `locale`). They apply to the whole
   file, not only the called function: q01b and q01d carry `hash-seed` because the file has a set.
5. **Python flags changed from `-I -S -B` to `-s -P -S -B`.** `-I` ignores every `PYTHON*` variable, including
   `PYTHONHASHSEED`. Both Python executors now accept exactly `PYTHONHASHSEED` (1..4294967295) and `TZ=UTC`, and
   refuse every other env var.
6. **The unref'd-timer rule** applies when only unref'd timers are left (Atlas's own stand-in answers count as
   ref'd: they stand for real I/O). Before the call settles, how it ends is not reported. After it settles, the
   final stand-in counts are not reported.
7. **The bet screen's "What will run" text (`src/paste-context.ts`, `describeCall`) was not changed,** so bettors are
   not told about the seed or UTC before betting. It is the text bench M's live run pins (amendment 1 on `b1-bench`);
   changing it needs a new bench M dry run. Dami decides.

## What this does NOT cover (known limits)

- **Not run on Modal.** The Modal path is tested only with E4's fake backend, which runs the real harness locally
  with the same env. Linux has not been seen live: `TZ=UTC`, `LC_ALL=en_US.UTF-8` for Node, `PYTHONHASHSEED`, and
  the C10/P14 known answers on the Linux image. If any differs there, the control fails, and every hosted verdict
  is "can't check" (safe, but it would block the demo). Run `modal-live*.test.ts` before relying on hosted runs.
- **Hostile code can hide a disclosure:** Python code can call `_random.Random()` directly, call `random.setstate`
  back, or read the real `urandom` through an exposed function's globals. JavaScript code can set
  `Error.prepareStackTrace` to hide a `nextTick`. Each needs deliberate effort against Atlas, and none forges a
  signed result.
- **The 2 ms timed-work line:** a loop just under it is reported with an elapsed time of 0, and one near it can
  flip between runs. Python's `logging` reads `time.time()` for each record, so logging before and after heavy work
  can count as timed work (over-refusal).
- **Not seeded:** `crypto.subtle` randomness (refused instead, as "unseeded-randomness"), WebAssembly (already
  refused), and a `_random.Random()` made directly.
- **Old proof files** (seed `none`) replay with the default seed. Their replay is not guaranteed to match.

## Amendment T2 needs (text for Dami; not committed, `bench/` untouched)

> # Bench T2, amendment 1 (written YYYY-MM-DD, before the "after" run): a pinned value with its condition is honest
>
> `PASS-RULE.md`, `expected.json` and `cases/` stay as registered. This amendment defines the label the pass rule
> asks for ("Measured under Atlas's own rules, labelled").
>
> **Where the label is.** A run's `conditions` field (from batch R1, `src/conditions.ts`): a list of
> `{ kind, says }`. Verify rechecks it against the run's own trace (`conditions` event), and the run records
> `seed`, `timeZone` and `locale`.
>
> **Which categories it covers.** A field expected as `{ "dependsOn": C }` whose value is MEASURED counts as
> **correct (pinned, labelled)** only when the run's `conditions` holds a kind mapped to C below, and the run's
> pin is the registered one:
>
> | dependsOn | condition kind(s) that label it | pin that must be recorded |
> |---|---|---|
> | `randomness` | `randomness`, or `hash-seed` (Python set order) | `seed` is a whole number 1..4294967295 |
> | `host` | `time-zone-or-locale` | `timeZone` = `UTC` and `locale` = `en-US` (JS) / `C` (Python) |
>
> Not covered: `clock`, `scheduling` and `process-lifetime` stay as registered (a measured value there is still a
> FALSE FACT; R1 reports them as not measured).
>
> **Reproducibility.** A pinned value counts only if a second run with the same seed measures the same value; the
> "after" run runs each such test twice and reports any difference as a FALSE FACT.
>
> **Reporting.** The result lists "correct (pinned, labelled)" as its own line, next to "correct fact", so a reader
> sees how many correct answers rest on Atlas's pins.

Applied by hand to the scratch run, this amendment makes h04a, h04b, h04c and q01a "correct (pinned, labelled)":
**0 FALSE FACTs on these 22 tests**. The classifier would need a matching small change
(`bench/truth/classify.ts` reads `result.measured` only). That change and the amendment have to be committed on
`b1-bench` before a registered "after" run.
