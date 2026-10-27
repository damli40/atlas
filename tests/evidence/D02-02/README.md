# D02-02: the Claimant (muse-spark-1.3), schemas and the repair loop

Date: 2026-10-27 (WAT) · Node v25.8.1 · model `muse-spark-1.3`

## What was built

The Claimant is the Meta model that reads one finding and proposes one experiment, then places a
sealed bet on each plain-code question about what the run will show.

- `server/meta/roles/claimant.ts`: builds the prompt (system preamble, the finding, its lines ±20
  with line numbers, the gate's rendered allow-list, the questions with the exact answer JSON each
  needs), calls `chat()` with `response_format` json_object, checks the answer, seals the bets.
- `server/meta/schemas.ts`: zod schemas for the answer `{experiment, bets:[{measures, answer, rationale}]}`.
  Extra keys are refused. The experiment is only checked to be an object; `src/gate.ts` decides it.
- Checks in order: JSON parse → schema → gate → exactly one bet per question (none missing, none
  extra, no duplicates) → answer kind equals the question's kind (or "declined") → whole numbers
  for counts and ms, the question's own options for the outcome, unit "USD" and tolerance 10% for prices.
- Any failure gets **one** repair try with the error appended ("Your previous answer failed: …
  Return only the JSON."). A second failure returns `{ok: false, reason}` and the log event
  "no usable answer (…)". A failed HTTP call returns `{ok: false}` at once (nothing to repair).
- A gate refusal of the model's experiment is kept: returned in `rejected` (with `gate.allowed: false`
  and the reason), emitted as "rejected (<reason>)", and passed to `onRefusal`.
- Sealing happens after validation with `who = "model:muse-spark-1.3"`; the rationale is sealed too.
  The model never sees a nonce or a hash (a test checks the prompt).
- `emit(event)` is a parameter that defaults to doing nothing; the log-strip stream is built elsewhere.
- `server/meta/roles/fixture-finding.ts`: the one finding used today, **a fixture finding, written by
  hand (Investigator arrives Oct 30)**. It points at the retry loop: fixture lines 49–66, which are
  lines 69–86 of the original file (checked: the verbatim block starts at original line 31 on fixture
  line 11). `verified` is computed by plain code: the quoted snippet must be inside those lines.
- `server/proofs/refusals.ts`: writes `proofs/refusals/<date>-<id>.json` with only kind, id, time,
  role, model, experiment, reason (and for a declined bet, the field and question). The live script
  passes it in; unit tests never do.

## Commands and output

| Command | File | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/claimant.test.ts --reporter=verbose` | `test-output.txt` | 24 passed (mocked `chat()`) |
| `pnpm exec tsx tests/evidence/D02-02/claimant-live.ts` | `live-output.txt`, `claimant-5-runs.jsonl`, `judged-runs.json`, `prompt.txt` | 5/5 usable, see below |
| `node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests/unit` | (printed) | `not found` |

Mocked acceptance tests: a valid answer → 3 sealed bets, one call; garbage → exactly one repair,
then `ok: false` and "no usable answer"; `attempts: 1000` → gate rejection kept and reported →
repair with the gate's reason → `ok: true`; plus kind, unit, option, duplicate and missing-bet cases.

## Live result: 5 consecutive real calls

**5 of 5 schema-valid and gate-allowed, all on the first try** (no repair needed, no gate rejection).
Plan bar: at least 4 of 5.

| Run | Experiment Spark chose | Bets: calls / totalWaitMs / outcome | Cost |
|---|---|---|---|
| 1 | `failTimes "always", failure "never_settles", attempts 3, delayMs 1000` | 1 / 0 / pending | $0.032968 |
| 2 | `failTimes "always", failure "never_settles"` | 1 / 0 / pending | $0.022988 |
| 3 | `failTimes "always", failure "never_settles"` | 1 / 0 / pending | $0.046548 |
| 4 | same as run 1 | 1 / 0 / pending | $0.028968 |
| 5 | same as run 1 | 1 / 0 / pending | $0.034008 |

Total **$0.165480**, 5 usage lines in `tests/evidence/usage/usage.jsonl`. This is an upper bound: the
Spark price is unverified and set equal to Wonder's ($4 in / $20 out per 1M). Each call used 1,202
prompt tokens and 909–2,087 completion tokens, most of them hidden reasoning (725–1,890).

## First model bets judged by plain code

Every usable answer's experiment was run for real in the sandbox (control first; the control passed
every time) and `src/judge.ts` compared the sealed bets with what the run measured
(`judged-runs.json`). Run 1:

| Question | Spark bet | Run measured | Verdict |
|---|---|---|---|
| How many times will the function call the RPC? | 1 | 1 | matched |
| How long will it wait in total, in ms? | 0 | 0 | matched |
| How will it end? | pending | pending | matched |

The other four runs gave the same three verdicts: **15 matched, 0 didn't match, 0 can't check.**

## Refusals recorded

**None.** No gate rejection and no declined bet happened in the five live calls, so nothing was
written to `proofs/refusals/` (the folder does not exist yet). Nothing was constructed to fill it.

## What it proves

- Spark returns schema-valid, gate-allowed experiments and bets on this finding 5 times in a row.
- A model bet goes through seal → real run → plain-code judge end to end.
- The repair loop, gate-rejection path and refusal records work, against a mocked model.

## What it does not prove

- **The hand-written claim steers the experiment.** It says the code "sets no time limit of its own on
  a read that never answers", and all five runs chose `never_settles`, the case the claim describes.
  It does not show what Spark picks from a finding the Investigator writes.
- **Spark had an easy case.** For a read that never answers, the code's defaults do not matter
  (1 call, 0 ms, pending), and the prompt shows only lines 29–68, so the attempts=5 / delay=3000
  constants on lines 14–15 were not tested. All 15 matches say nothing about the error path.
- The repair loop and gate rejection were never triggered live; they are tested with a mocked model only.
- Five calls are a small sample; the 5/5 rate could be lower on other findings.
- Spark's rationales say the function stays "pending forever". That is model text about the fixture
  run (no `sleep` timer, no viem timeout in the sandbox); it must stay in the model panel and is not a
  claim about production, where viem's 10 s default caps each read.
