# Bench M, amendment 1 (written 2026-10-28, before any model call): the bet context comes from E3

`PASS-RULE.md`, `corpus.json`, `cases/` and `bet-context.ts` stay as registered. This amendment changes which code
writes the prompt and checks the answers in the LIVE run. It is committed before any live run, as the pass rule
requires for this switch.

## The switch

When batch E3 is on main, the live run uses the product's own paste-round text, not this bench's builder:

- **Bet context:** `pastedBetContext` from `src/paste-context.ts` (E3): the exact text the paste screen shows the
  person (the numbered file with the called function's line marked, "What will run", the questions, the test as
  JSON, E3's `PASTE_BET_INSTRUCTION`).
- **Prompt frame:** `buildBetOnlyMessages(...)` from `server/meta/roles/claimant-bets.ts` with that text as
  `seenContext` and `seenInstruction: null`, so no Moonwell "in USD" line is added and the model reads exactly the
  words the person reads.
- **Answer check:** the product's `validateBetOnlyOutput`, which on E3 accepts `json` bets. If it still refused them,
  the run falls back to `bench/models/validate.ts` and the result says so.

This also settles the review's M-4: with E3's text, "the model sees what the person sees" holds by construction
(the same function renders the screen and the prompt) instead of being asserted.

## What enforces it

- `run.ts --live` refuses to start unless `src/paste-context.ts` is on the branch (no model is called).
- The prompt freeze: a NEW dry run, built with E3's text (`meta.builder: "e3"`), must be committed before the live
  run. `--live` refuses when the newest committed dry run was built by another builder or any prompt's SHA-256
  differs from it.
- The live result records the builder, the validator, the registration's content hash and the SHA-256 of the files
  that produced it.

## Two wording corrections to the pass rule (B1 review)

- "Written fresh (not well-known snippets)" is too strong: m24 `to_roman`, m20 `merge_intervals`, m17 `percentile`
  and m06 `compareVersions` are textbook exercises. Read it as "written for this bench; some are textbook tasks".
- The no-overlap check now also compares every function body after removing comments and layout and renaming
  variables (`bench/lib/normalize.ts`), not only whole-file hashes.

## Cost

The estimate now includes the reasoning-overflow retry (a 32,000-token second try). See the newest dry run.
