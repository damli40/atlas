# B1: two benchmarks (D35), "Does Atlas tell the truth?" and "Do models know what code does?"

Date: 2026-10-27/28 (WAT) · no model call ($0) · Node 25.8.1, CPython 3.14.7, macOS (Darwin 25), local executor only.
Updated 2026-10-28 after the adversarial review of B1 (sections marked "After the review"). The earlier sections are
kept as written; where the review changed what they mean, the new section says so.

## Where to look first (updated after R1, main `233e297`)

- **Approved wording is the next section: the final review's sentences, word for word.** The earlier ones are kept
  under it, marked superseded.
- **Bench T2, the 22 cases the review used to break Atlas: 15 FALSE FACTS before, 0 after** (R1 runners,
  registered result `bench/truth-2/results/2026-10-28-2.md`): 11 correct facts, **7 correct (labelled)**, 4 correct
  can't-checks, 0 over-refusals, 0 wrong reasons. 75 fields compared.
  - **The 7 "labelled" answers count as correct only under T2 amendment 1** (`bench/truth-2/AMENDMENT-1.md`,
    committed alone before the run, but drafted after scratch runs showed which answers it would cover). They are
    5 values under Atlas's pins or calling order (seed 20260101, UTC / en-US or C, its nextTick order) and 2 CPU
    timings Atlas cannot measure, shown as 0 ms with a warning (h01a, q02c). All 7 carry a conditions line. Under
    the rule as first registered, the same run counts **7 FALSE FACTS**. Both numbers belong in any claim.
  - The amendment text was written by the R1 batch, the batch that built the fixes, and extended by me (E1-E5).
- **Bench T, the original 88, re-run on the R1 runners: still 0 FALSE FACTS** (`bench/truth/results/2026-10-28-2.md`):
  69 correct facts, 18 correct can't-checks, **1 over-refusal**. In t19a, Atlas now withholds the call count because an
  unref'd AbortSignal timer was left after the call returned. 304 fields compared, 303 correct.
  - Conditions: 8 of the 70 fact tests carry a conditions line (clock ×7, timed-work ×4, unref-timer ×1); 62 read
    "None of the conditions Atlas checks for".
  - Some conditions are noise the R1 evidence already logs. "timed-work" appears on the token bucket, the polling
    tests and the throttle, which read the clock twice at one moment. "hash-seed" appears on every function of a
    Python file that builds a set anywhere.
- **Bench M ran live once, all 90 of 90 tests, for $2.55** (`bench/models/results/2026-10-28.md`). That is under the
  $8 stop. My earlier "not run, the high estimate is $9.00" was overruled by the coordinator, since D44 says to run it
  and stop at $8 if the cost gets there. It did not get there. Results are in the section "Bench M live result" below. The gap between the models is mostly the 0 ms scoring edge case, so the film must not compare them.
- The order test still passes after merging main twice: 35 tests, now also (l), amendments never edited.

## Approved wording (after the final B1 review; the only approved sentences for the README, the result page and the film)

These are the final review's replacement sentences (`review-B1-r2.md`), word for word. The earlier "after R1"
sentences overclaimed. They opened "Before running Atlas, we wrote down 110 test calls", but the 22 were found by
running Atlas. They did not say the fix was built and unit-tested on those same 22 cases, or that the label rule was
written after seeing the 7 answers it covers. They also called 2 CPU timings "pinned clock" values. Those sentences are
kept below, marked superseded.

T / T2, long form (README, result page):

> "We wrote 88 test calls and their expected answers before running Atlas on them. On one run, Atlas got none of the
> 70 checkable answers wrong (it withheld one it could have given) and said 'can't check' on all 18 traps. A review
> session then ran Atlas looking for failures and found 22 cases where it reported 15 false facts. We froze those 22
> with their honest answers, fixed the runner using those same cases as its tests, and ran them again: no false facts,
> under a rule we added after seeing the fixed output that accepts a value Atlas labels. 7 of the 22 rely on that
> rule: 5 are values under Atlas's fixed random seed, time zone or calling order, and 2 are CPU timings Atlas cannot
> measure, shown as 0 ms with a warning. Under the rule as first written, those 7 count as false. All 110 tests were
> written by AI sessions working on Atlas; one run each, one laptop, 28 October 2026. This shows Atlas keeps its stated
> rules on these cases. It does not show that Atlas can never report a false fact."

T / T2, film (with the qualifier on screen):

> "88 checks written before the first run: 0 wrong. 22 cases a reviewer used to break it: fixed against those cases,
> now 0 unlabelled errors, with 7 answers flagged (seeded, UTC, call order, or a timing it can't measure). Our tests,
> one run."

Bench M, film (the only approved bench M sentence; the film makes no model-vs-model comparison):

> "On 90 calls to 30 small functions written for this bench by an AI session, with one answer per model per question,
> Muse Spark 1.3 matched what Atlas measured on 276 of 282 answered questions and Muse Spark Open on 245 of 273, most of
> its misses being guesses of 1 ms where Atlas measured 0; one run, $2.55, not a general accuracy claim."

Rules that still hold:
- Never say "Atlas's false-fact count: 0" without "on these tests".
- Never drop "labelled" or "flagged" from the 7.
- **Amendment 1 was drafted after scratch runs of these 22 cases on the fixed runner showed which answers it would
  cover.** It was committed alone (`f08d37e`), before the classifier change (`a5dcb45`) and before the registered
  "after" run, which records its SHA-256. But it was not written blind. The R1 README, which drafted it, says so
  itself:
  - line 209 (round 1): "Applied by hand to the scratch run, this amendment makes h04a, h04b, h04c and q01a
    'correct (pinned, labelled)'";
  - line 355 (revised text): "Applied by hand to the scratch run, this makes h01a, h03b, h04a, h04b, h04c, q01a and
    q02c 'correct (labelled)'".

  (The review cites line 356 of main's copy; on this branch the line is 355.) The rows that cover nothing
  (process-lifetime, the setImmediate order) cost nothing, because R1 already refuses those cases.
- **2 of the 7 are a stretch** (review M1): h01a and q02c. These are CPU timings shown as 0 ms (and
  `perfMsOver1: false` / `False`), the opposite of what the code does on a real machine. The label is accurate, but
  there is no pin behind the value. T2's original pass rule did not list the clock as a pin. They rest on D43 ("timed
  work is disclosed, not refused"), a design call Dami may revisit. Always split the 7 as "5 pinned (seed, time zone,
  call order) + 2 timings Atlas cannot measure".
- "11 plain facts": 5 of the 11 (h05b, q01b, q01c, q01d, q02a) carry a conditions line (clock or hash-seed noise).
  Their values don't depend on it.

### Superseded: approved wording after R1 (kept as written; do not use)


Long form, for the README or the result page:

> "Before running Atlas, we wrote down 110 test calls and the answers they should give. The first 88 came first.
> Then an adversarial review session wrote 22 harder cases specifically to break Atlas, and on those Atlas first
> reported 15 false facts. All 110 were written by AI sessions working on Atlas, not by outside users. After the
> runner was fixed, one run on one laptop on 28 October 2026 gave these results:
> - On the 22 harder cases: no false facts. 11 were plain facts, and 4 were 'can't check'. The other 7 were values
>   that depend on Atlas's own pinned clock, random seed, time zone or calling order; each was shown with a label
>   saying so, and our rules count a labelled value as honest. Without that rule, those 7 would count as false.
> - On the original 88: none of the 70 checkable answers was wrong, though Atlas withheld one it could have given. It
>   said 'can't check' on all 18 traps.
>
> That shows Atlas keeps its stated rules on these cases. It does not show that Atlas can never report a false fact."

Short form, for the film, only with the qualifier on screen:

> "110 checks written before running, 22 of them by a reviewer trying to break it. After the fix: 0 wrong, and 7
> answers carry a label saying they depend on Atlas's own clock, seed or time zone. Our tests, one run."

Never say "Atlas's false-fact count: 0" without "on these tests". Never drop "labelled" from the 7: under the rule
first registered they are false facts.

## Bench T2: before → after (registered results `2026-10-28` and `2026-10-28-2`)

| Test | Before (main, pre-R1) | After (R1, amendment 1) | Conditions after |
|---|---|---|---|
| h01a | FALSE FACT | correct (labelled) | clock, timed-work |
| h01b | correct can't-check | correct can't-check | none |
| h02a | FALSE FACT | correct can't-check | unref-timer |
| h02b | FALSE FACT | correct can't-check | unref-timer |
| h03a | FALSE FACT | correct can't-check | timer-order |
| h03b | FALSE FACT | correct (labelled) | tick-order |
| h04a | FALSE FACT | correct (labelled) | clock, timed-work, time-zone-or-locale |
| h04b | FALSE FACT | correct (labelled) | randomness |
| h04c | FALSE FACT | correct (labelled) | randomness |
| h05a | correct fact | correct fact | none |
| h05b | correct fact | correct fact | clock |
| q01a | FALSE FACT | correct (labelled) | hash-seed |
| q01b | correct fact | correct fact | hash-seed |
| q01c | FALSE FACT | correct fact | hash-seed |
| q01d | correct fact | correct fact | hash-seed |
| q02a | correct fact | correct fact | clock |
| q02b | correct fact | correct fact | none |
| q02c | FALSE FACT | correct (labelled) | clock, timed-work |
| h06a | FALSE FACT | correct fact | none |
| h06b | FALSE FACT | correct fact | none |
| h06c | FALSE FACT | correct fact | none |
| h06d | FALSE FACT | correct fact | none |
| **Totals** | 15 FALSE, 6 fact, 1 can't-check (81 fields) | 0 FALSE, 11 fact, 7 labelled, 4 can't-check (75 fields) | |

The number of fields compared falls from 81 to 75. When a test's whole outcome is now "can't check" (h02a/b, h03a),
its fields are no longer compared.

## Bench T, first → second result (original 88)

| | 2026-10-28 (pre-R1) | 2026-10-28-2 (R1 runners) |
|---|---|---|
| correct fact | 70 | 69 |
| FALSE FACT | 0 | 0 |
| correct can't-check | 18 | 18 |
| over-refusal | 0 | 1 (t19a calls:work withheld, unref'd timer left) |
| fields compared | 304 (304 correct) | 304 (303 correct, 1 not measured) |
| conditions recorded | no (pre-R1) | yes: 8 fact tests carry one |

## Bench M after E3 and G1

- Dry run 3 (`bench/models/dry-run/2026-10-28-3.json`, `builder: "e3"`): 90 prompts of 2,677-4,895 characters
  (mean 3,476; E3's text is longer). The prompts are E3's `pastedBetContext` inside
  `buildBetOnlyMessages(..., seenInstruction: null)`.
- The live run passes G1's caps (4,000 tokens, retry 8,000), the same as the product.
- Estimate:

  | Model | Central | High |
  |---|---|---|
  | muse-spark-1.3 (price unpublished; upper bound at Wonder's price) | $3.79 | $7.39 |
  | meta-models/muse-spark-open-1026 | $0.84 | $1.61 |
  | **Total** | **$4.63** | **$9.00** |

- (Superseded: it was then run live once, see "Bench M live result".) First decision: not run, because the high estimate is above the $8 hard stop (D44). The $8 stop is enforced in code: the
  run stops before the next model call. A real run would very likely cost near the central figure. The high figure
  assumes 3,000 completion tokens per call and 5% retries. Spark's real price may be lower than the assumed one.
  Running anyway is Dami's call.

## Bench M live result (2026-10-28, the only live run)

Before the run, a note was committed on its own (`bench/models/NOTE-2026-10-28-live-run.md`). It says the run may
stop at $8, the tests go in the registered order, and a partial result is reported with its n. The run completed all
90 tests, so it is not partial.

- **Setup:** Muse Spark 1.3 and Muse Spark Open each bet once per test, with temperature 0.2, reasoning effort low and
  G1's caps (4,000 tokens, retry 8,000). The prompts are E3's paste-screen text, checked against dry run 3 by
  SHA-256. Answers were checked by the product's own E3 check. Atlas ran each test once (twice internally, R1's double
  run) and judged every bet.
- **Cost, from the usage log** (`results/2026-10-28-usage.jsonl`):
  - Muse Spark: 99 calls, $2.16. This is an upper bound, because Spark's price is not published and Wonder's is assumed.
  - Muse Spark Open: 118 calls, $0.39, at Baseten's published price.
  - Total $2.55. No call ran out of tokens.
- **Repair tries:** 37 answers needed the one repair try (9 for Spark, 28 for Spark Open). None was invalid after it.

**Match rates**, n = checkable questions:
- "among answers" = matched ÷ (matched + didn't match).
- "strict" also counts declines as misses.

| Model | Question | n | matched | didn't match | declined | match among answers | strict | decline rate |
|---|---|---|---|---|---|---|---|---|
| Muse Spark 1.3 | outcome | 90 | 90 | 0 | 0 | 100% | 100% | 0% |
| Muse Spark 1.3 | returnedJson | 74 | 73 | 1 | 0 | 98.6% | 98.6% | 0% |
| Muse Spark 1.3 | virtualMs | 89 | 74 | 5 | 10 | 93.7% | 83.1% | 11.2% |
| Muse Spark 1.3 | calls | 39 | 39 | 0 | 0 | 100% | 100% | 0% |
| Muse Spark 1.3 | **all** | 292 | 276 | 6 | 10 | 97.9% | 94.5% | 3.4% |
| Muse Spark Open | outcome | 90 | 84 | 1 | 5 | 98.8% | 93.3% | 5.6% |
| Muse Spark Open | returnedJson | 74 | 71 | 1 | 2 | 98.6% | 95.9% | 2.7% |
| Muse Spark Open | virtualMs | 89 | 54 | 25 | 10 | 68.4% | 60.7% | 11.2% |
| Muse Spark Open | calls | 39 | 36 | 1 | 2 | 97.3% | 92.3% | 5.1% |
| Muse Spark Open | **all** | 292 | 245 | 28 | 19 | 89.7% | 83.9% | 6.5% |

- **Not checkable: 17 questions per model.** 16 are returnedJson on calls that threw, and 1 is virtualMs on a call
  that never settled. They are outside n.
- **The Spark vs Spark Open gap is mostly one scoring edge case** (final review M3). Most of Spark Open's misses were
  bets of 1 ms (or 0.5 ms) where Atlas measured 0 on code that never waits. The rule is "within 10%", and 10% of 0
  is 0, so only an exact 0 matches. This rule was registered, and both models were told it in the prompt.

  | virtualMs | Spark 1.3 | Spark Open |
  |---|---|---|
  | answered | 79 | 79 |
  | matched, as scored | 74 | 54 |
  | misses that were 0.5-1 ms bets against a measured 0 | 2 (m07b, m25a) | 23 |
  | other misses | 3: m11a, m11c (0 vs 3 ms), m18c (0 vs 4) | 2: m18c (0 vs 4), m23c (200 vs 100) |
  | matched, if a ≤ 1 ms bet against a measured 0 counted as a match | 76 | 77 |

  All questions together, the same two ways:
  - as scored: Spark 276 of 282 answered (97.9%), Spark Open 245 of 273 (89.7%);
  - with that edge case counted as a match: Spark 278 of 282 (98.6%), Spark Open 268 of 273 (98.2%).

  So **the film must not compare the two models.** The setup was the same for both: client settings, repair rule,
  validator and independent calls.
- **What it says, and what it does not:**
  - On 90 calls to 30 small functions, written for this bench by an AI session, the two models' bets usually matched
    **what Atlas measured** for how the call ends, what it returns and how often a stand-in is called.
  - This is agreement with Atlas's measurement, not with an independent truth. Bench T and T2 are what support
    trusting that measurement.
  - The 3 calls to one function are related, so the effective sample is closer to 30 functions than to 90
    independent tests.
  - One answer per model per question. This is no general accuracy claim and no ranking.
- **Logged, not fixed** (final review m1, m2, m6):
  - The result records no `commit` or `startedAt`. Its provenance rests on its 45 tooling hashes, which equal the
    files at `3a30958`, and on the usage log's timestamps (12:30:02Z to 12:43:24Z, after `3a30958`).
  - The first invalid answer and the validator's error are not stored for repaired answers. Spark Open's repaired
    answers missed more often (14 of 95 checkable) than its first-try answers (14 of 192), and that cannot be audited.
  - E3's prompt text was developed with Spark as the main model. That could favour Spark; nothing in the code shows it.

## After R1: commands and counts

```
npx tsx bench/truth/run.ts --bench truth-2   # 17.6 s
npx tsx bench/truth/run.ts                   # 32.5 s
npx tsx bench/models/run.ts --dry-run
npx vitest run --maxWorkers=4
```

Full suite after merging main `233e297`: 116 files (114 passed, 2 skipped), **1,795 passed, 35 skipped**, twice
(`full-suite-after-r1.txt`). tsc clean. The bench tests include the order test (35 tests) and the bench M test
checking that the prompts equal the committed E3 dry run.

---

## Superseded (kept as written): wording and findings before R1

## Where to look first (before R1)

- **Approved wording (the only approved sentences for the README, the result page and the film) is the next
  section.** "Atlas's false-fact count: 0" on its own is NOT approved: it is untrue as a general statement.
- **Bench T (88 tests, 304 compared fields): 0 false facts, confirmed.** The reviewer re-derived all 70 fact tests in
  plain Node and Python with no Atlas code and found no case where the expectation and Atlas agree on something wrong.
- **What I told you before that was too strong.** My first report led with "0 false facts on 88 tests" and said the
  bench shows "the documented contract held". Both are true for these 88 tests, but the review found false facts
  within an hour just outside them. **Bench T2** pre-registers those 22 cases; its "before" run on main's runners:
  **15 FALSE FACTS**, 6 correct facts, 1 correct can't-check (81 fields: 66 correct, 15 false). Atlas reports the
  inner item's type for a list or object holding a non-JSON value (`[1n]` -> `bigint`), CPU time as 0, and orders,
  random values, the host's time zone and unref'd-timer endings as plain facts. Runner fixes are a later batch (after
  E3); T2's "after" run happens then.
- **The order guarantee is hardened.** The review beat the old order test 4 ways; each attack now fails it (table
  below).
- **Bench M estimate went up** once the 32,000-token reasoning retry is counted: $6.28 for Muse Spark + Muse Spark
  Open (high $13.24), $11.43 with Wonder. Above the $3-6 target; with the $8 cap a high-cost run stops partway.

## Approved wording after the review (SUPERSEDED by the section at the top)

Long form, for the README or the result page. The **last clause stays until the runner fixes land AND bench T2's
"after" run has 0 false facts**:

> "We wrote 88 test calls and their answers before running Atlas on them: 70 with an answer you can check, and 18
> where the only honest answer is 'can't check'. On one run, on one laptop, on 28 October 2026, Atlas got none of
> the 70 wrong and said 'can't check' on all 18. The tests were written by the same AI session that built Atlas's
> runner. That shows Atlas keeps its stated rules on these cases; it does not show Atlas can never report a false
> fact, and we have since found cases outside this set where it does."

Short form, for the film, only if the qualifier stays on screen:

> "70 checks we wrote before running. Atlas got 0 wrong, and said 'can't check' on all 18 traps. Our tests, one run."

Never say "Atlas's false-fact count: 0" without "on these tests".

## After the review: bench T2, the found failures (pre-registered, "before" run)

```
npx tsx bench/truth/run.ts --bench truth-2      # 17 s, main's runners (E4 merged into this branch), local executor
```

The 22 cases are the reviewer's, copied unchanged into `bench/truth-2/cases/`. Each expectation says what an
**honest** Atlas should report: a plain fact; or `{ dependsOn: clock | randomness | scheduling | host |
process-lifetime }` on a field, meaning reporting it as a plain measured value is a FALSE FACT and not measuring it
(with a reason in that category) is correct; or a can't-check with a reason category. Committed alone (`0bd3922`)
before the run; result `bench/truth-2/results/2026-10-28.md`.

| Test | What it does | Atlas reported (as a fact) | Honest answer |
|---|---|---|---|
| h01a, q02c | times CPU work with the clock | 0 ms / false | depends on the clock: not a plain fact |
| h03a, h03b | 0 ms timer vs setImmediate; nextTick vs promise | one fixed order | order not fixed: not a plain fact |
| h04a | local hour and time zone | hour 1, Africa/Lagos | depends on the host |
| h04b, h04c, q01a | Math.random, randomUUID, Python set order | one random value | random: not a plain fact |
| h02a, h02b | waits on unref'd timers | returned / threw at 100 ms | depends on what keeps the process alive (the review rated this pair minor) |
| q01c, h06a-d | a list/object holding a tuple, BigInt, NaN, undefined, Date | `tuple`, `bigint`, `number (NaN)`, `undefined`, `object (Date)` | `array` / `object` |
| h01b | busy-wait 50 ms | can't check (real-time limit) | correct can't-check |
| h05a, h05b, q01b, q01d, q02a, q02b | setInterval, refresh(), int keys, 2.0, blocking sleep, wait_for | | correct facts |

How a fix could pass instead of refusing: by pinning the outside thing (fixed time zone, fixed hash seed, seeded
random) AND saying so. The result format has no field for that label yet, so T2's pass rule requires an amendment
defining the label before the "after" run; without one, a pinned value is still counted as a FALSE FACT.

## After the review: the order test, hardened (`tests/unit/bench-order.test.ts`, 32 tests)

The review's attacks, replayed on this branch's current head in throwaway clones:

| Attack (review's clone) | Old test | Now |
|---|---|---|
| clone1: classifier changed to say "correct" for everything | passed | fails (h): a scoring change after a result without a `bench/TOOLING-CHANGES.md` entry; and (g): re-scoring T2's result gives "correct fact" where it stored "FALSE FACT" |
| clone1, variant: the same, with a log entry added | (n/a) | fails (g) |
| clone1: a result's classification hand-edited | passed | fails (e): result files are append-only |
| clone1: `expected-v2.json` added and the runner pointed at it | passed | fails (i) twice (runner map differs from the registration; extra expectations file) and (h) |
| clone2: whole branch squashed | failed (a), (c) | still fails (a), (c) for all three benches |
| clone3: `--depth 1` clone | skipped, reported as passed | fails (j) with "this is a SHALLOW clone ... fails instead of skipping on purpose" |
| clone4: rebased onto a newer main (every SHA changes) | passed, but evidence SHAs dangled | passes 32/32, because registrations, results and tooling are checked by content hash (`bench/REGISTRATIONS.json`) |

What each result now records: the registration's content hash, the corpus path it read (only the registered one), the
SHA-256 of every file under `runners/` plus the bench and `src/` files it uses (checked against the files at the
result's own commit), the reason categories, and the number of fields compared. Bench T's first result predates the
tooling record; it is allowed by name (never extendable) and re-scored instead.

Bench T amendment 1 (`bench/truth/AMENDMENT-2026-10-28.md`): can't-check reasons are checked against reason
categories (assigned after the first result, which the amendment says; the reviewer had checked all 18 by hand; the
re-score is unchanged); "70 tests (304 compared fields)"; the pass rule names the wrong order-test file.

**What this still does not prove:** order is proven by git history, which is local until pushed. Timestamps and
unpushed commits can be rewritten by whoever holds the repo; pushing the registration commits (or a signed tag) before
a run is what makes it checkable by others. I did not push (batch rule).

## After the review: bench M

- **Prompt freeze reads the committed dry run** (`latestCommittedDryRun`: the newest dry run added in git, read from
  HEAD), not the newest file on disk. Dry runs are never overwritten.
- **Overlap check** now compares every function body after removing comments and layout and renaming variables
  (`bench/lib/normalize.ts`): no bench M body equals a bench T or T2 body.
- **Cost estimate includes the overflow retry** (16,000 tokens wasted + up to 32,000 on the second try, assumed for
  2% of calls central, 5% high). New dry run `bench/models/dry-run/2026-10-28-2.json`, same 90 prompts:

  | | Central | High |
  |---|---|---|
  | Muse Spark + Muse Spark Open | **$6.28** | $13.24 |
  | with Muse Wonder | **$11.43** | $24.14 |

  So the first estimate ($4.04) was too low. Spark's price is unpublished; its share is an upper bound.
- **Amendment 1** (`bench/models/AMENDMENT-1-e3-bet-context.md`, committed before any live run): the live run uses
  E3's `pastedBetContext` (`src/paste-context.ts`) inside `buildBetOnlyMessages(..., seenInstruction: null)`, and E3's
  answer check. `--live` refuses until E3 is on the branch, and needs a newly committed dry run built with E3's text.
  Checked in a throwaway merge of `e3-paste`: the dry run switches to `builder: "e3"`, the prompt is the paste
  screen's text, and E3's `validateBetOnlyOutput` accepts a json bet.

## After the review: commands and counts

```
npx vitest run tests/unit/bench-corpus.test.ts tests/unit/bench-order.test.ts tests/unit/bench-classify.test.ts tests/unit/bench-models.test.ts --reporter=verbose
npx vitest run --maxWorkers=4
npx tsc -p .
```

- Bench tests: 265 passed (`test-output-after-review.txt`).
- Full suite, after merging main (E4) into this branch: 96 files (94 passed, 2 skipped), **1,375 passed, 36 skipped**,
  twice in a row (`full-suite-after-review.txt`). The skips are main's (Modal and RPC tests without credentials).
- Type check clean; no-local-paths passes.
- Merged main with a merge commit (no rebase, no squash). Do not squash this branch when merging it.

---

## Before the review (first report, kept as written)

## The commits, in order (the order is the point)

| Commit | What |
|---|---|
| `2eba993` | `.gitignore` allows `bench/`; `tsconfig` type-checks it, except the case files |
| `cbbe579` | **Bench T pre-registration, alone:** `PASS-RULE.md`, `expected.json` (88 hand-written expectations), 48 case files |
| `2cae832` | Bench T runner, classifier, order test, corpus and classifier tests |
| `a71da34` | `--render` (rewrites a result's table from its JSON; no run) |
| `c65715f` | **Bench T result** (run at `2cae832`, clean tree) |
| `df7f2df` | **Bench M pre-registration, alone:** `PASS-RULE.md`, `corpus.json` (30 x 3), 30 case files, `bet-context.ts` |
| `c335524` | Bench M runner (`--dry-run`, gated `--live`), answer check with the json kind, tests with a fake model |
| `d1a8c9f` | **Bench M dry run** (prompt hashes + estimate) |

`tests/unit/bench-order.test.ts` reads the git history and checks, for each bench: (a) the registering commit holds the
pass rule and corpus and nothing else; (b) exactly one commit ever touches them; (c) that commit is a strict ancestor
of every commit adding a result; (d) every result file names the registered corpus by SHA-256.
**Probes** (in a throwaway clone, not committed): editing one expected `virtualMs` after the result fails (b) ("changed
after they were first committed (e20adec, cbbe579)"); a result file committed on a branch from before the rule and
merged fails (c) and (d).
**Merging:** do not squash this branch. One squashed commit would hold the rule and the results together and fail (c).

## Bench T: what was run and what it found

```
npx tsx bench/truth/run.ts        # 66 s, sequential, tsRunner().run (the control runs before every test)
```

| Classification | All | JS/TS | Python |
|---|---|---|---|
| correct fact | 70 | 44 | 26 |
| **FALSE FACT** | **0** | 0 | 0 |
| correct can't-check | 18 | 12 | 6 |
| wrong can't-check (over-refusal) | 0 | 0 | 0 |
| missed can't-check | 0 | 0 | 0 |

Every test's control passed. 0 notes (every not-JSON reason contained the expected words). 0 local paths had to be
removed from the result file.

What the 70 facts cover, with the ones most people would get wrong:
- `setTimeout(fn, 0)` costs **1 ms** of virtual time (Node turns a delay below 1 into 1): measured 1.
- `Math.round(1.005 * 100) / 100` is **1**; `0.1 + 0.2` is 0.30000000000000004: measured.
- A debounced call that fires 200 ms after the function returned is still counted (calls after settle).
- Retry with backoff, a token bucket on `Date.now()`, polling to a deadline, `Promise.all` vs `allSettled` with a
  failing stand-in, event-loop order (sync, microtasks, then the timer): all exact.
- Non-Error throws (a string, a plain object, `null`): thrown type measured, name and message correctly NOT measured.
- NaN, BigInt, a 3,891-character list, 150-deep nesting, a cycle, a class instance, a Python tuple, Decimal, a
  dataclass, an integer past 2^53: all "not JSON" with the right type; `-0` is written `0`, as JSON writes it.
- `AbortSignal.timeout(100)` beats work that answers at 500 ms: `TimeoutError` at 100 ms with Node's own message.
- Python: `KeyError`'s message is `'PENDING'` with quotes; a `TimeoutError` is not a `ConnectionError`; banker's
  rounding (2.665 -> 2.66); `time.time()` is 1767225600 at Atlas's epoch; `ß`.upper() is `SS`.
- Over-refusal bait: a TypeScript file that mentions fetch/require/import only in a comment, a string and an
  `import type` line ran normally; Python code raising its own `PermissionError` was measured as `threw`, and
  `SystemExit` caught by the code was measured as `returned "exit 2"`.

The 18 traps and Atlas's reasons (all whole-run or outcome not measured): an endless synchronous loop (Atlas's 10 s
real-time limit), a hash racing a 10 ms timer, fetch (twice, once caught), `node:fs` import, a lodash import, `eval`,
`new Function`, `process.exit`, a TypeScript enum and a parameter property (Node's own "not supported in strip-only
mode"), an unhandled rejection, an escaping `sys.exit`, `urllib.request` and `sqlite3` (standard-library modules
outside the preload list), a caught `open('/etc/hosts')`, threads, `numpy`.

No FALSE FACT appeared, so there was nothing to investigate and no findings file. The expectations were never edited.

## Bench M: what was built

- `bench/models/PASS-RULE.md`: models (muse-spark-1.3, meta-models/muse-spark-open-1026, optional muse-wonder-1.0),
  settings (Atlas's client unchanged: temperature 0.2, reasoning_effort low, max_tokens 16000 with one retry at
  32000, JSON response format), one answer per model per test, one repair try, sealing before the run, scoring
  (matched / didn't match / declined / invalid / not checkable), reporting (per model per question type: n and both
  match rates side by side, decline rate, cost; split by language), an $8 hard stop, no general accuracy claims.
- Prompt freeze: the live run rebuilds every prompt and stops before any call if one differs from the committed dry
  run's SHA-256 (shared text like the system preamble could change on main).
- `npx tsx bench/models/run.ts --dry-run` wrote `bench/models/dry-run/2026-10-28.json`: 90 prompts, 309 questions,
  2,271 to 4,147 characters each (mean 2,938), and the estimate below. One full sample prompt is in the file.

| Estimate (no call made) | Calls | Central | High |
|---|---|---|---|
| muse-spark-1.3 (price not published; Wonder's used: an upper bound) | 99 | $3.30 | $6.27 |
| meta-models/muse-spark-open-1026 (Baseten's published price) | 99 | $0.74 | $1.37 |
| muse-wonder-1.0 (optional) | 99 | $3.30 | $6.27 |
| **Spark + Spark Open** | | **$4.04** | $7.64 |
| **with Wonder** | | **$7.34** | $13.91 |

Assumptions (in `run.ts`, checked against the live usage log later): prompt tokens = characters / 3.5; 1,500
completion tokens per call central, 3,000 high (earlier live bet-only calls here cost $0.0225 to $0.042 each at
Spark's assumed price, D02-06 and D02-02b); 10% extra calls for repair tries.

**What this decides:** Spark + Spark Open fits the $3-6 target. Adding Wonder on all 90 tests probably does not, and in
the high case the $8 cap would stop the run partway (the result is then marked partial). Options for Dami: run
without Wonder; run Wonder on a subset (needs an amendment file before the run); or raise the cap by amendment.

## Commands and counts

```
pnpm vitest run tests/unit/bench-corpus.test.ts tests/unit/bench-order.test.ts tests/unit/bench-classify.test.ts tests/unit/bench-models.test.ts --reporter=verbose
npx vitest run --maxWorkers=4   # the full suite
npx tsc -p .
```

| | After B1 |
|---|---|
| Test files | 91 (4 new: bench-corpus 181 tests, bench-order 9, bench-classify 12, bench-models 11) |
| Tests | 1,272 passed, 19 skipped, twice in a row (`full-suite.txt`) |
| Type check | 0 errors (`tsc-output.txt`) |
| no-local-paths | passes (in the suite) |

The first full run, with the default worker count while the machine's load average was about 40 (other sessions),
had 2 tests time out at vitest's 5 s limit in files B1 does not touch (`day-gate.test.ts`, `review-day6-b1.test.ts`).
With `--maxWorkers=4` both runs were clean. I did not change any timeout.

## What this does NOT cover

- Bench T ran on the local executor only. Modal (`ATLAS_EXECUTOR=modal`) is wired to look for batch E4's executor
  and refuses to run when it is missing; it was not run.
- Bench T's corpus was written by me after reading the E1/E2 design notes, so many traps are ones the design names.
  It shows the documented contract held on these 88 cases, not that no other false fact exists. I also did not run
  the fact cases in plain Node/Python outside Atlas as an independent cross-check: with 0 disagreements there was
  nothing to adjudicate, but an expectation and Atlas could in principle share the same mistake.
- Each bench T test ran once. Code with randomness is not in the corpus.
- Bench M was not run against any model. Its live path is tested only with a fake model and a fake run.
- `pitch/VIDEO-INDEX.md` is not in this worktree and was not updated; the main session should add the bench T line.
- No adversarial review agent has looked at B1 yet.
