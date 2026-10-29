# R2: code that times its own work (D45) and timing bets near zero (D46)

Date: 2026-10-28 to 2026-10-29 · no model call ($0) · no Modal call · Node 25.8.1, Python 3.14.7, macOS, local executors only.
Branch `r2-timing`, from main `26f5342`.

## Where to look first

- **D45, in plain words.** Atlas's clock stands still while code works, so code that times itself reads 0 ms. Before R2,
  that 0 was reported as a fact, with a warning line. Now Atlas's second run (the double run from R1) plays the code
  as if its work took time. A value that changes then is **"can't check: Atlas's clock is simulated and can't measure
  real work time"**. A value that stays the same is still reported.
- **D45 counts (probes, `probes-before-main-26f5342.txt` → `probes-after.txt`):**
  - **Ordinary functions over-refused: 0 of 30 before, 0 of 30 after.** These are R1's 18 probe functions (the
    reviewer's 15 plus 3 extras) and the 12 extra ordinary functions from R1 review round 2 (`a8`). The brief said
    "15 + 10"; the files hold 18 + 12, and all 30 were run.
  - **Code that reads the clock twice at one moment: 15 cases (T1–T14, plus R1's probe 18).** On main, all 15
    reported a measured value. After R2:
    - **9 are can't check:** T1, T2, T4, T7, T8, T10, T11, T12 and probe 18. Each returns an elapsed time or branches
      on one.
    - **4 are still measured, by design:** T5, a logger that returns its whole-ms stamps; T6, a deadline retry; T13,
      a 5 ms TTL cache; T14, a 60 s TTL cache.
    - **2 are known gaps, still measured:** T3, a "took over a second" check; T9, Python `time_ns` rounded to whole ms.
- **D46, in plain words.** A timing bet (a number in ms) now matches if it is within 10% of the measured value **or
  within 1 ms** of it. Before, only the 10% counted, so near 0 ms almost nothing matched. Each new verdict on a timing
  bet records `timingRule: "d46"`. `verify` re-judges a stored verdict with the rule that verdict recorded. A verdict
  with no rule was judged before D46, so it is re-judged with the old rule.
- **Verdicts that change on existing files:**
  - **Bench M's committed live result** (`bench/models/results/2026-10-28.json`) **would change for 25 of 159 timing
    bets** if it were re-judged: all 25 go from not matched to matched. Each one is a bet of 1 ms or 0.5 ms against a
    measured 0. By model: Spark 74 → 76 of 79, Spark Open 54 → 77 of 80 (`bench-m-timing-rejudge.txt`).
    **The committed result is not changed and stays as it is: it was judged with the rule before D46 (D46: "Old
    proof files keep the rule they recorded").** Nothing under `bench/` was edited.
  - **Retry fixture day gate: 18 matched / 1 didn't match / 1 can't check, unchanged.** Its timing bets
    (`totalWaitMs`, `settledAtMs`) are whole-number bets, which stay exact. D46 covers only free-number ms bets.
  - **Moonwell price bets (USD): unchanged** (tested).
  - **The 15 committed proof files:** 13 verify. The other 2 fail on main too, for reasons unrelated to R2: the
    D04-04 Level 2 file (caption / false-alarm table) and the E5 file (`sourceWithheld` key).
- **Suite:** 3 full runs. One passed clean; in the other two, one X2 drawing-speed test failed while the machine
  was loaded by other batches, and it passes alone. See "Counts" at the end.

## D45: how "depends on it" is decided

**The rule.** The second of the two runs adds time at every repeated clock read at one simulated moment (a repeated
read is what R1 already calls "timed work"). The added time stays for the rest of the run, as real time would:

| clock | added per repeated read | why this size |
|---|---|---|
| stopwatch clocks: `performance.now`, `process.hrtime`, `process.uptime`; Python `perf_counter`, `monotonic` | 10 ms | "took more than 1 ms" checks flip. Bench T2's h01a and q02c test exactly that. |
| calendar clock: `Date.now`, `new Date()`, `Intl`; Python `time.time`, `time_ns`, `datetime` | 1 microsecond | about what two back-to-back reads take on a real machine. A time stamp in whole ms (`toISOString()`) stays the same. `Date.now() - start` no longer reads 0. |

Only the readings move. The simulated clock and its timers do not, so `virtualMs` and timer order are unchanged.
Every field the two runs measured differently is not reported. Its reason is `TIMED_WORK_REASON` in
`src/conditions.ts`. The run's trace names the field in a `clock_differs` event, and the conditions line adds a
`work-time` sentence that lists the fields. When the outcome changes, every field about how the call ended goes with
it. The `timed-work` sentence now explains the second run, and no longer says "Elapsed times read 0 ms here".

**What is conservative about it.** Nothing is guessed from the code's text. A value is reported only if it came out
the same with and without time passing. The outcome is reported only if it, too, stayed the same.

**What I changed my mind on, during the batch.** My first version added 10 ms at every repeated read of any clock,
and started from zero at each new moment. That version was committed as `32b5471`. The full suite then showed
three over-refusals of ordinary code:
- a token bucket, where starting from zero made a later 250 ms wait read as 240 ms;
- an ISO time stamp returned after a `Date.now` deadline loop;
- a test that reads several clocks.

`47504b3` replaced that version with the two sizes and the added time that stays. This README describes the
replacement.

**Known gaps (tests pin each one, so a change shows up):**
- a check past a longer time ("took over a second", T3): reported, as fast work would give it;
- a calendar duration rounded to whole ms (Python `(time_ns() - t) // 1_000_000`, T9) or compared with more than a
  microsecond;
- JavaScript `new Date() - start`: a Date holds whole ms, so the microsecond does not show;
- **accepted over-refusal:** returning two or more raw readings taken at one moment (`[Date.now(), Date.now()]`, or
  Python returning `time.time()` and `monotonic()` together) is can't check. Two Python `datetime.now()` stamps taken
  one after the other also differ by the microsecond. On a real machine they usually differ too.
- **mislabel risk:** when the second run timed work, every difference gets the clock reason, even one caused by a
  process id or a memory address. The value is still not reported; only the reason could be the less precise one.
- Hostile code could undo the nudge. In Python, a changed `NUDGE` is caught as tampering. In JavaScript the drift
  lives in the harness, which the code cannot import (`m6`, hostile-code gaps, as logged in R1).

**Verify** (`src/conditions.ts twinProblems`) checks four things:
- a `clock_differs` event appears only if the second run itself timed work;
- a second run that timed work never names its differences as "changed between runs";
- each named field carries the clock reason;
- no field carries that reason without being named.

Files made before R2 still verify. They carry R1's sentence (`TIMED_WORK_SAYS_R1`), which verify accepts.

**An R1 bug found and fixed here.** When the outcome changed between the two runs, verify flagged the ending fields
that had not themselves changed (for example `virtualMs`). So any such proof file failed verify. Now those fields
count as covered by the outcome. A test covers both reasons.

## D46: the rule, where it lives, what records it

- `src/judge.ts`: for a number bet in ms, matched = within `tolerancePct`% of measured (10% on the `virtualMs`
  question) **or** |bet − measured| ≤ 1 ms, in exact decimals. `judge(bet, run, { timingRule })`: the default is D46;
  `null` gives the old rule. The verdict carries `timingRule: "d46"` only on a matched / not matched timing verdict,
  so every other verdict is byte-identical to before. The change is additive and kept to the free-number ms branch,
  so it should merge cleanly with U1's quiz kind.
- `src/atlasfile.ts`: the verdict schema accepts `timingRule`. Re-judging (original run and replay) uses the
  recorded rule. A judged timing verdict with no rule, on a run that started on or after `TIMING_RULE_SINCE`
  (2026-10-29T00:00Z), is refused, so a new file cannot be relabelled to the stricter old rule. **Gap:** a file from
  2026-10-28 could still be relabelled.
- **Bettor text** (D19: the screen and every model read the same words): `answerHow` now says "a number in ms,
  matched within 10% or 1 ms of what the run measures". The D19 byte-equality tests pass. The same change was made
  in the Muse plugin's question text. Bench M's frozen prompts changed with it, so **a new bench M dry run was
  committed** (`bench/models/dry-run/2026-10-29.json`, no model call, same 90 prompts, estimate unchanged:
  $4.63 central / $9.01 high). It is a new file; no committed file under `bench/` was edited.
- **Display:** the change "toward" text uses the rule its verdict recorded, so older files keep their words. The
  proof card and the verdict / adversary / change tables show "±10% or 1 ms" for timing bets.
- **Wording lint** (`tests/unit/wording.test.ts`): a tolerance sentence may only come from `matchRuleWords` /
  `toleranceShort`. Moonwell's USD screens are allowed to write their own. R1's old timed-work sentence may appear
  only as `TIMED_WORK_SAYS_R1`.

## Tests

- `tests/unit/r2-timed-work.test.ts`: the D45 cases above in JavaScript and Python, verify edits, the old sentence,
  the R1 verify gap.
- `tests/unit/r2-judge-timing.test.ts`: the D46 table (old and new outcome for each case), whole-number and USD
  bets unchanged, bettor text, toward text, and proof files under both rules, including the date check.
- Changed to match D45: in `r1-facts.test.ts`, h01a and q02c are now can't check, and the timed-work table rows gained
  `work-time`. `py-call.test.ts` reads each clock at its own moment, plus a new test of the accepted over-refusal.
- `judge.test.ts`: two tests of the exact-decimal arithmetic now pass `timingRule: null`.

## Files here

- `probe.mts`: the probe script (paths replaced by `<scratch>` / `<repo>`). T13's label still says "cost of 10 ms";
  that came from the first version, where a 5 ms TTL flipped. It no longer does.
- `probes-before-main-26f5342.txt`, `probes-after.txt`: each case run twice (`SAME` = both runs agreed).
- `bench-m-timing-rejudge.txt`: bench M's committed timing bets re-judged under both rules (scratch, read-only).
- `full-suite.txt`: the suite 3×.

## Counts

- **Full suite 3× (`full-suite.txt`): 1,919 passed, 35 skipped in run 2; runs 1 and 3: 1,918 passed, 1 failed.**
  The one failure was the same test both times: X2's "40 parts with 47 joins draw in well under 30 s" timing test.
  Runs 1 and 3 took 290 s and 274 s against 173 s for run 2. The machine's load average was 15 to 20, from other
  batches. That test passes when run alone, and R2 touches none of the outline or drawing code. I did not change
  the test or its limit. **I am not certain it is only load.**
- I did not run main's suite for a count to compare against in this batch.
- tsc clean. Day gate (`tests/gate/six-cases.ts`): 18 / 1 / 1. no-local-paths: passes (part of the suite).
