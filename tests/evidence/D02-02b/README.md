# D02-02b: the Claimant re-run with a neutral claim and the whole function in view

Date: 2026-10-27 (WAT) · model `muse-spark-1.3` · 5 live calls

## Why this re-run

D02-02 got 5 of 5 usable answers and 15 of 15 matched bets. That result was too easy to trust,
for two reasons found in D02-02:

1. The hand-written finding's claim described one scenario (a read that never answers), and
   Spark tested exactly that scenario all 5 times.
2. Spark saw only lines 29–68. The retry settings (5 attempts, 3000 ms apart, fixture lines 14–15)
   were never in view, and the never-answers case does not depend on them.

## What changed (and what did not)

- **Claim, now neutral** (`server/meta/roles/fixture-finding.ts`), about the loop as a whole and
  naming no scenario: *"People expect withRpcRetry to turn a flaky chain read into a dependable one
  within a short, predictable time; the code repeats the read in a loop whose number of calls, waits
  between them and final result depend on its attempt and delay settings and on how each call
  behaves."* A unit test refuses the words never / hang / settle / pending / forever / time limit in it.
  Still labelled "fixture finding, written by hand (Investigator arrives Oct 30)".
- **Code in view**: the whole verbatim block, fixture lines 11–66 with line numbers (the settings on
  14–15, the options, and the whole function). The range is found from the BEGIN/END VERBATIM
  markers, not hard-coded. Other findings still get their lines ±20.
- **Pick rule** added to the prompt: "Choose the experiment whose result you are LEAST sure about:
  the one most likely to surprise a reader of this code. Do not choose the experiment that is
  easiest to predict." It does not say which experiment or what result.
- **Not changed**: the allow-list and the questions (plain code, `src/gate.ts`). They still name
  `never_settles` as one of two failure kinds and ask "returns, throws, or pending (never settles)?".
- The prompt was written once, before the run, and not touched after. Full prompt: `prompt.txt`.

## Commands

| Command | File | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/claimant.test.ts --reporter=verbose` | `test-output.txt` | 28 passed |
| `pnpm exec tsx tests/evidence/D02-02b/claimant-live.ts` | `live-output.txt`, `claimant-5-runs.jsonl`, `judged-runs.json`, `prompt.txt` | 5/5 schema-valid, see below |
| `node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests/unit proofs` | (printed) | `not found` |

## Result: Spark still chose a read that never answers, 5 times out of 5

| Run | Experiment Spark chose | calls / totalWaitMs / outcome bets | Measured | Verdicts | Cost |
|---|---|---|---|---|---|
| 1 | `failTimes 1, failure never_settles` | 1 / 0 / pending | 1 / 0 / pending | 3 matched | $0.026712 |
| 2 | `failTimes 1, failure never_settles` | 1 / declined / pending | 1 / 0 / pending | 2 matched, 1 can't check | $0.051892 |
| 3 | `failTimes "always", failure never_settles` | declined / declined / declined | 1 / 0 / pending | 3 can't check | $0.041792 |
| 4 | `failTimes 1, failure never_settles` | 1 / 0 / pending | 1 / 0 / pending | 3 matched | $0.049612 |
| 5 | `failTimes 1, failure never_settles` | 1 / 0 / pending | 1 / 0 / pending | 3 matched | $0.039152 |

- **Verdicts: 11 matched, 0 didn't match, 4 can't check** (all 4 are bets Spark declined; the
  control passed on every run).
- **Schema-valid answers: 5 of 5, all on the first try** (no repair, no gate rejection). Counting
  only answers with at least one real (not declined) bet: 4 of 5.
- **Cost: $0.209160** for 5 calls (1,488 prompt tokens each, 1,038–2,297 completion tokens, of which
  836–2,088 hidden reasoning). Upper bound: Spark's price is unverified and set equal to Wonder's.
  5 lines added to `tests/evidence/usage/usage.jsonl`.

## Before and after, side by side

| | D02-02 (before) | D02-02b (after) |
|---|---|---|
| Claim | named the never-answers case | neutral, names no case |
| Lines shown | 29–68 (no settings) | 11–66 (settings + whole function) |
| Pick rule | none | "least sure, most likely to surprise" |
| Shapes chosen | 5 × never_settles (all failTimes "always"; 3 also set attempts 3, delay 1000) | 5 × never_settles (4 × failTimes 1, 1 × always) |
| Schema-valid | 5/5 first try | 5/5 first try |
| Verdicts | 15 matched / 0 / 0 | 11 matched / 0 didn't match / 4 can't check |
| Declined bets | 0 | 4 (recorded as refusals) |
| Cost | $0.165480 | $0.209160 |

**What this means, plainly:** removing the hint from the claim did not move Spark off the
never-answers case. With the settings in view and told to pick what it is least sure of, it still
picked it, now usually with one failing call first. So the hint in the claim was not the only
cause. What is left that points at that case is plain-code text: the allow-list offers only two
failure kinds and the outcome question spells out "pending (never settles)". Spark's own
rationales say it sees "the first await never returns" as the surprising part. This is a finding
about the model's choice, not a reason to rewrite the prompt until it picks something else; no
prompt was tuned after seeing these answers.

The error path (5 calls, 12000 ms of waiting, throws) is **still untested by any model bet**. The
day-1 oracle cases (D01-08) cover it with known answers, not with model bets.

## Refusals recorded (real, from these live calls)

Four declined bets, written by the refusal writer to `proofs/refusals/`:

| File | Run | Question | Spark's reason |
|---|---|---|---|
| `2026-10-27-Re2hbNHSHm.json` | 2 | totalWaitMs | unclear if totalWaitMs counts only sleep calls or virtual elapsed time while pending |
| `2026-10-27-CgQ-s5T_8A.json` | 3 | calls | code has no timeout so harness virtual-time accounting for a never-settling call is unclear |
| `2026-10-27-TO58tDFURq.json` | 3 | totalWaitMs | unclear whether harness counts sleep only or also pending time toward total wait |
| `2026-10-27-P6S9Ur6a0G.json` | 3 | outcome | pending versus can't-check after 30000ms virtual limit cannot be distinguished from code alone |

Each file holds only kind, id, time, role, model, experiment, reason, measures and question. Checked
by reading all four and by the key scan: no key, no URL, no header. The reasons are Spark's own
words about the sandbox run; they are not claims about production code.

Run 3's last reason points at a real wording gap in the rendered allow-list: it says a run still
going after 30000 ms is "can't check", while a run that provably can never finish (no timers left)
is measured as "pending". Both are true and the judge handles both, but the text does not say the
second one. Logged as a follow-up; not changed here.

## Rationale text stays in the model panel

Spark's rationales say things like "stuck awaiting the first hanging read" and "never returns or
throws". These live only in `Bet.rationale` (sealed with the bet). A new unit test
(`tests/unit/claimant.test.ts`, "rationale text stays model-panel data") gives every bet the
rationale "It stays pending forever and hangs." and checks that no verdict (matched, didn't match,
can't check from a declined bet, a failed control, a wrong experiment), no log event and no refusal
record contains it. The judge never reads the rationale. Captions do not exist in code yet; whoever
builds them must take text from verdicts, never from `rationale`.

## What it does not prove

- What Spark picks from a finding the Investigator writes (arrives Oct 30).
- That Spark would bet well on the error path: it never chose it.
- Five calls are a small sample.
