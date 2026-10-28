# R1: the false facts bench T2 found, fixed (D36)

Date: 2026-10-28 · no model call ($0) · no Modal call · Node 25.8.1, Python 3.14.7, macOS, local executors only.
Branch `r1-facts`, from main `298a781`.

## Where to look first

> **Read "Review round 1" at the end first.** The adversarial review found 2 blockers. The design changed after it,
> and these parts of the first round below are now **out of date**:
> - "timed work" is no longer decided by a 2 ms CPU line, and no longer refuses;
> - `process.nextTick` is disclosed, not refused;
> - every pasted test now runs **twice**;
> - a `host` condition was added;
> - Modal was run live: 16 of 16 pass.
>
> The T2 count is now 7 "FALSE FACTs" under the rule as registered, all measured and labelled, and **0 under the
> amendment**.


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


---

## Review round 1 (2026-10-28)

The review (`scratchpad/review-R1.md`, outside the repo) found **2 BLOCKER, 6 MAJOR, 6 MINOR**. The coordinator
chose the fixes. They are deterministic rather than threshold-based. Commits `0ef9c6e` (code) and `0952ed6` (tests).

### Where to look first

- **B1 + B2, values that change between runs. Fixed with a double run.** Every pasted test now runs twice, in two
  fresh sandboxes, with the same seed and pins.
  - A field the two runs measured differently is "can't check": "this value changed between two identical runs …
    such as memory addresses, process ids or paths".
  - The run gets a `changed-between-runs` condition that names the fields.
  - The second run is kept in the proof file (`Run.twin`), and verify rechecks it.
  - The second Python run starts with a different heap layout (a spacer of every small object size), so values that
    come from memory addresses (a set of plain objects, `id()`, a default `repr`) almost always differ and are caught.
    Before the spacer, 2 distinct orders in 6 tries slipped through. After it, 6 of 6 are caught.
  - Cost: two sandboxes per pasted test (the reused D31 control is unchanged).
- **B1, values that are the same in both runs but depend on the machine: a `host` condition** that names what the code
  read. In JavaScript: `process.platform/arch/version(s)/pid/…`, `process.cwd()/memoryUsage()/…`,
  `navigator.hardwareConcurrency/platform/userAgent`, an error's stack. In Python: `os.getpid/getcwd/cpu_count/…`,
  `platform.*`, `sys.platform`/`sys.version`/`os.environ` read in the code, `id()`. The value stays measured.
  `uuid.uuid1` is refused, because it reads the real clock and a network address.
- **M1–M3, "timed work" is now decided from the code alone.** It applies when the code reads the clock twice or more at
  one moment of the simulated clock. It is disclosed ("This code timed its own work … Elapsed times read 0 ms here and
  don't reflect your machine"), and the value stays measured. The 2 ms CPU line is gone, so a test can no longer flip
  between runs or machines. Only a call whose outcome depends on real time (the busy-wait) stays "can't check".
- **M3 also changed:**
  - `process.nextTick` is disclosed (`tick-order`: "Atlas calls it from a plain async function").
  - An explicit locale, an explicit `timeZone`, or ISO date text with "Z" or an offset adds no time-zone/locale
    condition.
  - `random.seed(n)` set by the code itself adds no randomness condition.
- **M5:** the bet context (`src/paste-context.ts`, shown to every bettor before sealing) now says: "Atlas runs it on a
  simulated clock starting 2026-01-01 UTC, in time zone UTC with an en-US locale, with randomness seeded (seed
  20260101)." For Python it says "a C locale". The D19 byte-equality tests still pass. **Bench M needs a new dry run.**
- **M6:** a run that did not finish shows "Conditions: Not known: the run did not finish…", never "None". "None" now
  says only what Atlas looked for, and that a second run checked every reported value.
- **M4:** the Modal live env assertions now expect the exact pins. JS sees `["LC_ALL","TZ"]`; Python sees
  `["LC_CTYPE","PYTHONHASHSEED","TZ"]` (Python adds `LC_CTYPE` itself). **Live run once: 16 of 16 passed** (130 s of
  wall time), output in `modal-live-review1.txt`.
- **m1:** a run that says "seed none" but started on or after `R1_SINCE` (2026-10-29) is refused. Since R1, a run that
  finished must have its twin.
- **Also fixed:** `process.memoryUsage.rss` (and any function's own extras) survives Atlas's access wrapper. Before,
  it threw "is not a function".
- **Counts:** full suite 3× **1,289 passed, 36 skipped, 0 failed** (`full-suite-review1.txt`; the skips are the same
  tests as on main, file by file). tsc clean.

### Bench T2, 22 tests: main → R1 round 1 → after review round 1

| Test | main | R1 first round | after review round 1 | T2 as registered | with amendment 1 (below) |
|---|---|---|---|---|---|
| h01a CPU timed with Date.now | dateMs 0, unlabelled | not reported | measured, `timed-work` | FALSE | correct (labelled) |
| h01b busy-wait | can't check | same | same | correct can't-check | same |
| h02a / h02b unref'd timers | returned / threw | not reported | not reported | correct can't-check | same |
| h03a setTimeout 0 vs setImmediate | one order | not reported | not reported | correct can't-check | same |
| h03b nextTick vs promise | one order, unlabelled | not reported | measured, `tick-order` | FALSE | correct (labelled) |
| h04a local hour | Lagos, unlabelled | UTC, labelled | UTC, labelled (+ timed-work: two `new Date()`) | FALSE | correct (pinned) |
| h04b / h04c random | varied | seeded, labelled | seeded, labelled | FALSE | correct (pinned) |
| h05a / h05b | correct | correct | correct | correct fact | same |
| q01a set of text | varied | seeded, labelled | seeded, labelled | FALSE | correct (pinned) |
| q01b / q01d / q02a / q02b | correct | correct | correct | correct fact | same |
| q01c / h06a–d inner type | inner type | top-level type | top-level type | correct fact | same |
| q02c perf_counter | false, unlabelled | not reported | measured, `timed-work` | FALSE | correct (labelled) |
| **FALSE FACT count** | **15** | **4** | **7** (all labelled) | | **0** |

Raw: `t2-after-review1-scratch.md/.json` (a scratch run, not a registered result).

### The reviewer's 15 ordinary functions (plus 3 extra probes), before → after

Each was run 3 times through the real local runners (`ordinary-15-after-review1.txt`).

| # | Function | Before (review) | After |
|---|---|---|---|
| 1 | JS logger around a 20,000-order aggregation | **not measured** (and it flips near 2 ms) | measured, `clock`, `timed-work` |
| 2 | JS retry with jitter | measured, randomness | same |
| 3 | JS id generator | measured, randomness | same |
| 4 | JS `toLocaleDateString("en-GB", { timeZone: "UTC" })` | measured, **misleading** time-zone/locale | measured, no condition |
| 5 | JS TTL cache | measured, clock | measured, clock, timed-work (two `Date.now()` at one moment: noise, see limits) |
| 6 | JS `localeCompare` sort | measured, time-zone-or-locale | same (true: no locale given) |
| 7 | JS set intersection | measured, none | same |
| 8 | JS emitter with nextTick | **not measured** | measured, `tick-order` |
| 9 | TS groupBy | measured | same |
| 10 | TS `Intl.NumberFormat("en-US", …)` | measured, time-zone-or-locale | measured, no condition |
| 11 | Python logging around a 200,000-step loop | **not measured** | measured, clock, timed-work, host (logging reads `os.getpid()` for its records) |
| 12 | Python retry with jitter | measured, randomness | same |
| 13 | Python uuid4 id | measured, randomness | same |
| 14 | Python dedupe with a seen-set | measured, hash-seed (noise) | same (noise) |
| 15 | Python `sorted(set & set)` | measured, hash-seed (noise) | same (noise) |

**Over-refusal: 3 of 15 → 0 of 15. Misleading conditions: 1 → 0** (plus the reviewer's `random.seed(42)` case,
now no condition). Noise conditions that remain: 5, 11, 14 and 15, true statements about the code that do not affect
the value. All 18 cases gave the same answer on all 3 runs.

### Host and run-to-run probes (the review's B1 / B2 table), after

Raw: `scratchpad/r1r/after-host.txt`, outside the repo.

- **JavaScript, measured with the `host` condition naming the read:** `navigator.hardwareConcurrency`, `process.platform/arch/version`,
  `process.versions.v8`, `constrainedMemory`, `new Date(0).toString()` (time-zone-or-locale).
- **JavaScript, not reported (changed between the two runs):** `process.pid`, `process.cwd()`, `heapUsed`,
  `availableMemory`, an error's stack.
- **Python, not reported (changed between runs):** a default repr, `id(object())`, `hash(object())`, `os.getpid()`,
  `os.getcwd()`, a set of plain objects (6 of 6).
- **Python, measured with `host`:** `sys.platform`, `os.cpu_count()`. **Refused:** `uuid.uuid1`.

### T2 amendment 1, revised for review round 1 (text for Dami; not committed, `bench/` untouched)

> # Bench T2, amendment 1 (written YYYY-MM-DD, before the "after" run): labelled values and the double run
>
> `PASS-RULE.md`, `expected.json` and `cases/` stay as registered. This amendment defines the label the pass rule
> asks for ("Measured under Atlas's own rules, labelled"), and how Atlas's double run counts.
>
> **Where the label is.** A run's `conditions` field (batch R1, `src/conditions.ts`): a list of `{ kind, says }`.
> Verify rechecks it against the run's own trace: the `conditions` event, and the `twin_differs` event written by the
> double run. The run also records `seed`, `timeZone`, `locale`, and its second run as `twin`.
>
> **A measured field expected as `{ "dependsOn": C }` counts as "correct (labelled)"** only when the run's
> `conditions` holds a kind mapped to C below, and the run records the pin that kind needs:
>
> | dependsOn | condition kind(s) that label it | what must be recorded |
> |---|---|---|
> | `randomness` | `randomness`, or `hash-seed` (Python set order of text or bytes) | `seed` 1..4294967295 |
> | `host` | `time-zone-or-locale` (time zone, locale) or `host` (a machine detail, named in the sentence) | `timeZone` = `UTC`, `locale` = `en-US` (JS) / `C` (Python) for the first; the read named in `says` for the second |
> | `clock` | `timed-work` (the code read the clock two or more times at one simulated moment; the sentence says elapsed times read 0 ms) | none |
> | `scheduling` | `tick-order` (process.nextTick next to promise callbacks; the sentence names Atlas's calling order) | none |
>
> Not covered: `process-lifetime`, and `scheduling` for a 0 ms timer next to `setImmediate`. These stay as
> registered (a measured value there is still a FALSE FACT; R1 does not report them).
>
> **The double run.** A field that is not reported with the reason "this value changed between two identical runs"
> counts as **correct can't-check** when the field's expectation is `{ "dependsOn": … }` (any category). When the
> expectation is a plain fact, it counts as **wrong can't-check (over-refusal)**. The result counts double-run
> refusals on a line of their own.
>
> **Reproducibility.** A labelled value counts only if the run's own twin measured the same value (verify checks this).
>
> **Reporting.** "Correct (labelled)" is its own line next to "correct fact", so a reader sees how many correct
> answers rest on Atlas's pins or on a disclosed condition.

Applied by hand to the scratch run, this makes h01a, h03b, h04a, h04b, h04c, q01a and q02c "correct (labelled)":
**0 FALSE FACTs on these 22 tests.** No T2 test is refused by the double run. As before, `bench/truth/classify.ts`
needs a matching change, committed on `b1-bench` before a registered "after" run.

### What this does not cover (review round 1)

- **The double run catches only what differs between two runs.**
  - Something that varies across machines but not across two runs on one machine is covered only when Atlas
    instruments the read (`host`).
  - On Modal, both runs use the same folder (`/sandbox`), so `process.cwd()` is measured there, and the `host`
    condition names it.
  - Address-dependent Python values could, rarely, match by chance even with the heap spacer.
- **Noise conditions:** "timed its own work" appears whenever the code reads the clock twice at one moment, for
  example a TTL cache that stamps and checks at once, or `localHour` reading `new Date()` twice. Python's `logging`
  adds `host` (it reads `os.getpid()` for each record). Python's hash-seed and host detection from reading the code
  applies to the whole file, not just the called function (review m3, logged).
- **Logged, not fixed:**
  - m4: a time-sliced loop counts chunks by Atlas's clock and gets only `clock`.
  - m5: the `replayDiffers` wording. With the double run, a re-run that differs should now be rare.
  - m6: hostile-code gaps. Also: code that sets `Error.prepareStackTrace` itself turns off the stack-trace `host`
    note; the double run still catches temp paths in local runs.
- **Bench M:** the bet context changed (M5), so its frozen dry-run prompts no longer match. A new dry run is needed
  before its live run.
- `R1_SINCE` is 2026-10-29. A run from today (2026-10-28) can still be relabelled as "seed none" without being
  caught.
