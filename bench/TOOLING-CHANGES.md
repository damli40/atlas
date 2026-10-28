# Bench tooling changes after a result (append-only)

Any commit that changes a bench's scoring code (`bench/truth/classify.ts`, `bench/truth/run.ts`, `bench/lib/`,
`bench/models/run.ts`, `bench/models/validate.ts`) after that bench's first committed result must add an entry here
in the same commit. `tests/unit/bench-order.test.ts` checks this. Earlier entries are never edited.

## 2026-10-28: after the B1 review

- `bench/truth/classify.ts`: checks can't-check reasons against registered reason categories (new name
  "can't-check, wrong reason"); fields expected as `{ dependsOn }` (a value that depends on Atlas's clock,
  randomness, scheduling or the host) are a FALSE FACT when reported as a plain measured value. Re-scoring bench T's
  first result gives the same classification for all 88 tests.
- `bench/truth/run.ts`: serves bench T and T2 from their registered paths only (`BENCH_CORPORA`); `--render` removed
  (results are append-only); refuses a dirty working tree; records `registrationSha256`, `tooling` (SHA-256 of every
  file under `runners/` and the bench and src files it uses), reason categories and fields compared; executor chosen
  by E4's `executorFromEnv`.
- `bench/lib/registration.ts` (new): the registered paths and content hashes.

## 2026-10-28: before bench T2's registration

- `bench/truth/classify.ts`: `outcome` may also be `{ dependsOn }` (bench T2's unref'd-timer cases, where whether the
  call ever ends depends on what keeps the process alive). Type change only; bench T's re-score is unchanged.
- `bench/truth/run.ts`: the table prints such an outcome as "outcome depends on <category>".

## 2026-10-28: bench M after the B1 review (no bench M result exists yet; logged for the record)

- `bench/models/run.ts`: the prompt freeze reads the newest dry run COMMITTED in git (not the working tree); the
  estimate includes the 32,000-token overflow retry; prompts can come from E3's builder, which AMENDMENT-1 makes
  the only one allowed live; `--live` refuses a dirty working tree; a live result records its builder, validator,
  registration content hash and tooling hashes; dry runs are never overwritten.
- `bench/lib/normalize.ts` (new): function bodies normalised for the overlap check.

## 2026-10-28: bench T2 amendment 1 in force (committed alone just before this change)

- `bench/truth/classify.ts`: a measured `{ dependsOn }` field is "correct (labelled)" when T2 amendment 1 is in force
  and the run's conditions label it (randomness / hash-seed with a valid seed, or memory-address; time-zone-or-locale
  with UTC and the language's locale, or a host note naming a read; timed-work; tick-order) and the run's twin
  measured the same value; a `{ dependsOn }` field refused by the double run is correct; process-lifetime is not
  covered. New names "correct (labelled)" (test) and "correct (labelled)" / "correct (double run)" (field). Results
  from before the amendment are re-scored without labels (their `meta.labelsInForce` is absent).
- `bench/truth/run.ts`: stores each run's conditions, seed, time zone, locale and the twin's measured fields; records
  the amendment files' SHA-256, whether labels were in force, conditions counts and double-run refusals; the table
  shows each test's condition kinds.
- `tests/unit/bench-order.test.ts`: (l) amendment files are never edited; a result's recorded amendments match.

## 2026-10-28: table heading order

- `bench/truth/run.ts`: the "Every test" heading now comes after the "Conditions" section (in the two results of
  2026-10-28-2 the heading sits above it; those files are append-only and stay as written). Scoring unchanged.

## 2026-10-28: bench M after G1 and E3 on main (no bench M result yet)

- `bench/models/run.ts`: live bet calls pass G1's caps (`maxTokens` 4,000, `retryMaxTokens` 8,000), as the product's
  bet-only Claimant does; the estimate's overflow extra is now 10,500 completion tokens (was 46,500 with the old
  16,000 / 32,000 caps). With E3 on the branch, prompts come from E3's builder (amendment 1).

## 2026-10-28: bench M live loop keeps sealed bets when a run cannot start

- `bench/models/run.ts`: if Atlas cannot start a test's run, the bets stay in the result and are "not checkable" with
  the reason, instead of the whole live run ending with nothing written.
