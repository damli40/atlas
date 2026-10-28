# Bench M, "Do models know what code does?": pass rule (written before any run)

This file is a pre-registration: it fixes, before any model is asked anything, which code the models bet on,
exactly what they are shown, how they are called, and how each answer is scored. It is committed in one commit of
its own together with the corpus (`corpus.json`, `cases/`) and the prompt builder (`bet-context.ts`), ahead of
any result. `tests/unit/bench-order.test.ts` checks that order and refuses any later edit to those files.

Decision: D35 in the build decisions ("Do models know what code does?": about 30 JS/Python functions x 3 tests;
Muse Spark, Spark Open (and Wonder) bet; plain code judges; match and decline rates by question type; about $3-6).

## The question, in plain words

A person pastes a function; Atlas says exactly how it will call it. Before the run, a model bets on what the run
will measure: how the call ends, what it returns, how much virtual time passes, how many times each stand-in (a
fake function with fixed answers) is called. Then Atlas runs the code and plain code judges each bet. This bench
counts how often each Meta model's bets match what the code did, per kind of question. It is about these 90
tests only.

## The sample

- `corpus.json`: **30 functions** (18 JavaScript/TypeScript, 12 Python), **3 tests each = 90 tests**. Written fresh
  for this bench (not well-known snippets), with no overlap with bench T (a test checks that no case file's text
  is shared).
- Kinds of code: boundaries and off-by-one, sorting, parsers, money, dates, retry/backoff and budgets, races
  against timers, caching, circuit breakers, zero-delay yields, concurrency limits, throttles, asyncio timeouts,
  blocking sleeps, exceptions.
- No expected answers are written down: the run decides. Every test was chosen to be bettable on all four
  question types; a test whose answer Atlas cannot measure is reported, not scored (below).

## Models and settings

| Bettor | Model id | Served by |
|---|---|---|
| Muse Spark 1.3 | `muse-spark-1.3` | Meta API |
| Muse Spark Open | `meta-models/muse-spark-open-1026` | Baseten |
| Muse Wonder 1.0 (optional, `--with-wonder`) | `muse-wonder-1.0` | Meta API |

- Calls go through Atlas's own client (`server/meta/client.ts`), unchanged: `temperature` 0.2,
  `reasoning_effort` "low", `max_tokens` 16000 (one retry at 32000 when a reasoning model runs out of room),
  `response_format` JSON object. No contributor models.
- One answer per model per test (one sample). If the answer is not valid (not JSON, wrong schema, a missing or
  extra question, wrong answer kind, unit or tolerance), the model gets ONE repair try with the error appended,
  exactly as the product's bet-only Claimant does (`runClaimantBets`). After that it is "invalid".
- Bets are sealed (hashed, `src/seal.ts`) before the run of that test starts. A model never sees another model's
  bets, the person's bets, or any result.

## The exact bet context

Each model gets exactly the text a person sees before betting (D19), built by `bet-context.ts`
(`pastedBetMessages`): the whole pasted file with line numbers, Atlas's sentence describing the call and each
stand-in (`describeCall`, `src/gate.ts`), how Atlas runs code (sandbox, virtual clock starting
2026-01-01T00:00:00Z, the watch limit, the four endings), and the questions written by plain code
(`questionsFor`), each with its answer format. It uses the server's system preamble and seen-context heading.

Main had no bet-context builder for pasted rounds when this was written; the server's seen-context prompt ends
with the Moonwell instruction ("Give your best estimate in USD..."), so this builder swaps only that line for a
unit-free one: "Give your best prediction for every question. Decline only if you cannot form any prediction at
all; if you decline, say why." Batch E3 will provide the canonical pasted-round builder. Switching to it needs an
amendment file (`AMENDMENT-YYYY-MM-DD.md`) committed before the live run.

**Prompt freeze:** the dry run (`run.ts --dry-run`) writes the SHA-256 of every prompt to
`dry-run/<date>.json`. The live run rebuilds every prompt and stops before any model call if one differs from the
committed dry run (shared text such as the system preamble could have changed on main).

## How each answer is scored

Per model, per test, per question (outcome, returnedJson, virtualMs, calls:<stand-in>):

- **matched / didn't match**: Atlas's judge (`src/judge.ts`) on the measured run. outcome: exact option.
  returnedJson: canonical JSON equality. virtualMs: within 10% of the measured value (so a measured 0 needs 0).
  calls: exact integer.
- **declined**: the model bet `declined` (it gave a reason).
- **invalid**: no usable answer after the repair try, or the model call failed. Every question of that test.
- **not checkable**: Atlas did not measure that field (for example returnedJson when the call threw, or virtualMs
  when it never settled), Atlas's control did not pass, or the whole run was "can't check". Reported with
  Atlas's reason; never counted for or against a model.

## How results are reported

- `results/<date>.json` (every prompt hash, every sealed bet, the run, every verdict, usage and cost) and
  `results/<date>.md`.
- For each model and each question type: **n** (checkable questions), matched, didn't match, declined, invalid,
  and two rates, always side by side:
  - **match rate among answers** = matched / (matched + didn't match);
  - **match rate counting declines and invalids as misses** = matched / (matched + didn't match + declined + invalid).
- Decline rate per model = declined / all questions asked.
- Also split by language (JS/TS, Python). The number of not-checkable questions and their reasons.
- Cost: tokens and dollars per model from Atlas's usage log. Muse Spark's price is not published; its cost is an
  upper bound at Wonder's price, labelled as such.
- **Sample size always stated; no general accuracy claims.** The result is "on these 90 tests, Muse Spark matched X
  of N outcome questions", never "Muse Spark understands code X% of the time". No ranking of models beyond the
  counts.
- This bench judges models against what Atlas measured. It is meaningful because bench T found 0 false facts on
  its 88 tests (`bench/truth/results/2026-10-28.md`); that is a small sample too, stated with it.

## Budget

- Estimated before any call by `run.ts --dry-run` (target $3-6 for Spark + Spark Open + Wonder).
- Hard stop: the live run stops before the next model call once the logged cost reaches **$8**. What was finished
  stays in the result, marked partial.
- Real runs need `--live` and are started by Dami, not by a build session.

## What this bench does not show

- One sample per model per test, temperature 0.2: a second run could differ.
- 90 hand-written tests of small functions; nothing here says how a model does on real codebases.
- The functions were written by an AI session (Claude). They are new, but they share its habits.
