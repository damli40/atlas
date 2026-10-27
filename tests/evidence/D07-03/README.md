# D07-03 · Refusal audit (D9: real instances only)

Date: 2026-10-27. Output: [`proofs/refusals/INDEX.md`](../../../proofs/refusals/INDEX.md).

## What was done

Listed every real "can't check" verdict and gate rejection recorded since Oct 27, each with its run id (when
one was recorded), trigger, reason, model id, date and the file that holds it. No new refusal was made for
this audit: no run, no model call ($0).

How the list was found:

1. Every record in `proofs/refusals/` (6 files: 4 declined bets from D02-02b, 2 can't-check verdicts written
   by the live server during D07-02) was read.
2. Every `.json` and `.jsonl` file under `tests/evidence/` was walked for objects with
   `"outcome": "cant_check"` and a `betId`, and for experiments with `"gate": {"allowed": false}`. Hits:
   D04-04 (2 runs), D05-03, D06-01 (2 runs), D20, D07-02 (2 runs).
3. Every `.txt` / `.json` / `.jsonl` under `tests/evidence/` was searched for "can't check", "cant_check",
   "declined", "gate: rejected" and "rejected (". Each hit was read: D01-08 (S6 settle time), D02-02b
   (judged runs), D19 (v1 and v2 live answers, 6 declines), D06-02 (one 422 at 201 callers), PASS-RULE lines
   (D04-02, D06-01), and review probes and unit-test outputs (constructed, not counted).

## Result

| | Count |
|---|---|
| Can't-check verdicts from real runs | 18 (16 Spark declined, 1 replay of a declined bet, 1 plain code: S6 never settles) |
| Gate rejections from real requests | 1 (a scripted 201-caller sweep probe, no model) |
| Gate rejections of a model's proposal | 0 (10 Claimant calls in D02-02/D02-02b, 2 Adversary calls in D07-02: all allowed) |
| Control failures on a judged run | 0 |

Film candidates (Dami decides): run `mwTaxvHFzB` (Spark declines cbETH on Moonwell, verified `.atlas.json`
and proof card; the same "needs a live chain read" reason 6/6 in D19), run `6WcBUBJ1D0` (the same decline in
the D07-02 autonomous round, handoff on the strip, not replayable from a file), and S6 settle time (plain code,
no model; scripted bet, no run id recorded).

## What this does not show

- No model proposal has ever been refused by the gate live, so a "the gate said no to Muse Spark" beat has no
  real instance yet.
- Rows 5–16 of the index exist only in `tests/evidence/`, not as files in `proofs/refusals/` (they predate the
  live server's file writer or ran with an in-memory writer).
- S6 settle time: the run id was not printed by `pnpm gate:day1`, so that row points to the output file only.
- In every model row the model declined; Atlas never refused to run. The index says so for the narration.
