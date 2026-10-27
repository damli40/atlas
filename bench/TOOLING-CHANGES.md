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
