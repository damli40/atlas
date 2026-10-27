# D02-03: model go/no-go

Date: 2026-10-27 (WAT)

The table is `go-no-go.md`, written by `tests/tools/go-no-go.ts` (plain code); the raw rows are in
`go-no-go.json`. Command: `pnpm exec tsx tests/tools/go-no-go.ts`.

Each row follows one fixed rule:

- **muse-wonder-1.0: GO.** One real call with an 8-line retry function and the Investigator
  instruction from the build plan. The answer parsed as JSON and matched the investigator schema
  (3 findings). Cost $0.022932 (258 prompt, 1,095 completion tokens). The answer's text was not
  saved, only its pass/fail; quality was not judged.
- **muse-spark-1.3: GO.** No new call. 5 of 5 schema-valid in D02-02b (rule: at least 4 of 5).
- **Spark Open on Baseten (`meta-models/muse-spark-open-1026`): pending.** No `BASETEN_API_KEY` in
  the environment and no `~/.config/baseten/env` on this machine, so no call was made. The script
  will make one real call (to `https://inference.baseten.co/v1/chat/completions`, path UNVERIFIED,
  Bearer auth UNVERIFIED) once a key exists, and mark GO only on a schema-valid answer.

The fallback chain from the build plan is printed under the table.

Key scan (`node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests proofs`): `not found`.
