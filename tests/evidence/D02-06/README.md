# D02-06 · Day gate: Muse Spark bets on the SAME experiment as the person, sealed beside them

Date: 2026-10-27 (WAT) · model `muse-spark-1.3` · Node v25.8.1

## What changed, in plain words

Before: Spark only bet when it chose its own experiment, and it always chose a read that never
answers (D02-02b, 5 of 5). The person and Spark never bet on the same thing.

Now there is a **bet-only mode** (`server/meta/roles/claimant-bets.ts`). The person picks the
scenario; the server creates the experiment and, at once, asks Spark to bet on that same experiment
and the same plain-code questions. Spark's prompt holds the finding, the code, the experiment and
the questions, and nothing about the person's bets (there is no input for them). Its answer goes
through the same checks as before (JSON, schema, one bet per question of the right kind; one repair
try; "declined" allowed and judged "can't check"). The server seals Spark's bets at its own clock
with a hidden nonce, exactly like the person's, with `who = "model:muse-spark-1.3"` and the
rationale inside the seal.

Before the run the page shows only "Muse Spark 1.3 (muse-spark-1.3) has sealed 3 bets" and the
hashes: the server sends no answer, rationale or nonce for Spark's bets until `POST /runs`.
`POST /runs` freezes the person's bets, waits for Spark's, checks every seal and every
`sealedAt < run.startedAt`, runs, judges both, and reveals both. The verdict table has one column
per bettor ("You", "Muse Spark 1.3 (muse-spark-1.3)") and the page re-checks every seal, Spark's
included. Spark's rationale shows only in the model panel, never in a verdict. If Spark gives no
usable answer, its slot and column say "no usable answer (<reason>)" and the person's bets are
still judged. The "Spark chooses the experiment" mode is unchanged.

Routes: `POST /experiments` now returns `model` (slot status); new `POST /experiments/:id/model-bets`
→ `{model: {status, display, sealed: [hashes only]}}`. `server/index.ts` turns model bets on
(`ATLAS_MODEL_BETS=off` turns them off); `createApp()` without `modelBets` asks no model (tests).

Also in this task:
- **Prompt wording gap from D02-02b closed** (`src/gate.ts` `renderAllowList`): the allow-list now
  says a run where the function provably can never finish is measured with outcome "pending", and a
  run Atlas's watch limit cuts off before the end is "can't check". It names no scenario or answer.
- **D02-05 `events.jsonl` regenerated** with the current log order (see its README).

## Later change: D18 (2026-10-27), Spark no longer sees the claim sentence

Dami decided D18 = A: a model guessing on its own is the honest version of the bet. So since this
change Spark's prompt (both modes: bet-only here, and "Spark chooses the experiment") holds the
finding's file, line range and kind plus the numbered code lines, and **no longer** the `claim:` line
(the Investigator's "People expect X; the code does Y" sentence). The live calls above were made
before the change, with the hand-written fixture claim in the prompt; they were not re-run.
Test: `tests/unit/claimant-blind.test.ts` builds a session with a (mocked) Wonder finding, then
asserts Spark's prompt holds `lines 55-56` and the numbered code but not the claim text, any part of
it, or a `claim:` line; and that both prompt builders leave the claim out.

## Commands and results

| Command | Output | Result |
|---|---|---|
| `pnpm exec tsx tests/evidence/D02-06/spark-on-s3.ts` | `live-output.txt`, `spark-on-s3.jsonl`, `prompt.txt` | 3 of 3 usable on the first try, 9 of 9 matched |
| `pnpm dev:all` + `node drive.mjs <chrome-headless-shell> tests/evidence/D02-06` | `browser-run.txt`, `s3-before-run.png`, `s3-after-run.png` | one live S3 round, all 6 seals ✓ |
| `pnpm test` | 20 files, 256 passed, 3 skipped | new: `tests/unit/model-bets.test.ts` (11), `tests/unit/model-bets-ui.test.tsx` (2) |
| `pnpm exec tsc --noEmit` | no output | clean |
| `pnpm gate:day1` | 18 matched, 1 didn't match, 1 can't check, 721 ms | unchanged |
| `pnpm exec vite build` | built | green |
| `node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests/unit proofs web` | `not found` | no key in the repo's public folders |

Unit tests (mocked `chat()`): bet-only valid answer; garbage → exactly one repair → no usable
answer, the person's 3 bets still judged; Spark's values (and rationale) in no pre-run API response
and no log line; Spark's prompt never contains a person's bet placed while Spark was still thinking;
"Break it" pressed while Spark thinks: the run waits, then freezes both sets; wrong options refused,
declined accepted; a failed model call is "no usable answer" and its log line still names the model.

## Spark's live bets on S3 (every call fails with an error, 5 times in a row)

| Where | calls bet / measured | totalWaitMs bet / measured | outcome bet / measured | Verdicts | Cost |
|---|---|---|---|---|---|
| script call 1 | 5 / 5 | 12000 / 12000 | throws / throws | 3 matched | $0.030240 |
| script call 2 | 5 / 5 | 12000 / 12000 | throws / throws | 3 matched | $0.019340 |
| script call 3 | 5 / 5 | 12000 / 12000 | throws / throws | 3 matched | $0.023780 |
| browser round | 5 / 5 | 12000 / 12000 | throws / throws | 3 matched (person: 3 matched) | $0.016500 |

- **12 of 12 Spark bets matched; 0 didn't match; 0 can't check; 0 declined; 0 repairs.** The control
  run passed every time. Spark's rationales all say the same thing: 5 default attempts, a 3000 ms
  sleep after every failed attempt except the last (4 × 3000), then the last error is rethrown.
- **Cost: $0.089860** for 4 calls (1,495 prompt tokens each; 526–1,213 completion tokens, of which
  352–1,044 hidden reasoning). Upper bound: Spark's price is unverified and set equal to Wonder's.
  4 lines added to `tests/evidence/usage/usage.jsonl`.
- Nothing was tuned. The prompt was written before the first live call and not touched after.

**What this means, plainly:** given the error path that it never chose for itself, Spark read the
retry settings and bet exactly what the code does, 4 times out of 4. So on S3 the "model vs person"
moment is a tie when the person also bets 5 / 12000 / throws. That is the honest result; a miss by
Spark on this scenario is not something the demo can count on.

## PNGs

- `s3-before-run.png`: after both sealed, before "Break it". Your three hashes under your answers;
  the model card says "Muse Spark 1.3 (muse-spark-1.3) has sealed 3 bets" with its three hashes and
  no values.
- `s3-after-run.png`: the run facts, the table with columns question / You / Muse Spark 1.3
  (muse-spark-1.3) / observed, six seal checks all "✓ match · sealed before the run started", and
  the model panel with Spark's answers and its own reasons.

## What it proves

- The person and Spark bet on one experiment with the same plain-code questions, and both sets are
  sealed by the server before the run and judged by `src/judge.ts`.
- Spark's answers are not sent to the browser before the run (browser log: 7 pre-run responses, 0
  holding a model answer, rationale or nonce; unit test checks every pre-run response).
- The page recomputes every revealed hash, Spark's included, and all six matched.
- A Spark failure leaves the person's round intact (unit + UI test).

## What it does not prove

- The server is trusted: it holds Spark's answers before the run, and someone controlling it could
  peek. This hides them from the page, not from the operator.
- 4 live calls on one scenario. Spark on S1, S2, S4, S5, S6 in bet-only mode was not run live.
- The live "no usable answer" path was not seen (every live call answered); it is covered by mocked tests.
- Bets and slots still live in memory; a restart loses them. No log strip UI yet (D05-04).
- Whether the new pending / can't-check sentence changes Spark's choices in the full Claimant mode
  was not re-run (D02-02b's 5 calls used the old text).
