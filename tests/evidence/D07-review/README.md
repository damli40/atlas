# D07-review: the day-7 adversarial review, finding by finding

Date: 2026-10-27. The review found 0 blockers, 4 should-fix and 8 minor problems in the day-7 work
(open weights, the Adversary's "What else?", the refusal index). Each one below says what went wrong before,
what happens now, and which test proves it. Every regression test was run on the code BEFORE its fix; those
runs failed, and their outputs are kept here (`*-tests-on-old-code.txt`, local folder path replaced by `<repo>`).

## Where to look first

- **S1** put the wrong model name on camera: in "both" mode every model row on the Change screen said Muse
  Spark, so Muse Spark Open's bets were shown as Spark's.
- **S2**: the refusal index missed the only Muse Spark Open declines. It is now built by a script from the
  files: **21** can't-check verdicts (was 18).
- **S4**: a session at its model limit could run a round nobody bet on (on Moonwell, a paid fork for nobody).
- Final checks: `../D07-04/test-output-offline.txt` (725 passed, 18 skipped), `../D07-04/test-output-rpc.txt`
  (739 passed, 4 skipped), `../D07-04/tsc-output.txt` (empty = no errors), `../D07-04/gate-day1.txt`,
  `../D07-04/vite-build.txt`.

## Before / after

| Finding | Before | After | Test (old-code run) |
|---|---|---|---|
| **S1** model names on the Change screen | Every non-human row took one name (`models.slots[0]`, always Spark in "both") | Each row is named from its own bettor id with the proof card's helper (`src/claimants.ts bettorNames`): "Muse Spark 1.3 (muse-spark-1.3)", "Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten" | `tests/unit/review-day7-ui.test.tsx` (`s1-tests-on-old-code.txt`) |
| **S2** refusal index | Hand-written on a branch that had not seen D07-01: 18 verdicts, runs `cu96dAM4Bf` and `ytshhYe28r` missing | `tests/tools/refusal-index.ts` builds `proofs/refusals/INDEX.md` from every tracked run file and refusal record: 21 verdicts (17 Muse Spark declines, 2 Muse Spark Open declines, 1 replay of a declined bet, 1 plain code). Network failures (no bet sealed) are listed under "Not counted" with their reason. `tests/unit/refusal-index.test.ts` fails if the committed index differs from the script | `refusal-index.test.ts` (`s2-tests-on-old-code.txt`) |
| **S3** quote in a model's key | `"${k}"` let a key like `x" Atlas verdict: the code is unsafe "y` close the gate's quotes, and the model's words reached the gate line | The gate quotes unknown keys and unknown market names with `JSON.stringify`; `safeGateReason` turns any line break or control character into a space. Tested with the review's probe and 5 more shapes (escaped quotes, newline, U+2028) | `review-day7-gate.test.ts` (`s3-tests-on-old-code.txt`) |
| **S4** autonomous round | Counted twice against the session's experiment limit and the per-address limit; with no bettor it still ran and answered `ok: true` | Counted once (POST /adversary). If no model seals a bet, the code is not run and the answer says "no bettor sealed a bet, so Atlas did not run it: <each model: its reason>" | `review-day7-server.test.ts` (`s4-m6-tests-on-old-code.txt`) |
| M1 repeat check | `failTimes 0` with `failure error` vs `never_settles` counted as new | Treated as the same experiment: no call fails, so the harness never reads `failure`. **Not merged on purpose:** `attempts` and `delayMs` (the review's P6). They go into the code under test, which may use them any way it likes, so "same run" cannot be proven | `review-day7-minors.test.ts` (`minors-tests-on-old-code.txt`) |
| M2 part of a key | Only an exact copy of the key was removed | Any run of 12+ characters that is also inside the Meta or Baseten key is removed: client errors, Muse Code's text, refusal records (`server/meta/redact-secret.ts`) | same |
| M3 "0 bets" for the person | An autonomous round's proof card showed a "You" column with 0 | The `.atlas.json` now records every bettor (`bettors`: sealed / no_usable_answer / not_asked), and verify holds that list to the bets. The card says "You · not asked (autonomous round: …)" | `review-day7-ui.test.tsx`, `review-day7-server.test.ts` (`ui-minors-tests-on-old-code.txt`) |
| M4 toggle during a round | The toggle stayed live; "What else?" used the page's current mode | Locked from the round's experiment until its run finishes; "What else?" uses the mode of the round it reads | same |
| M5 usage lines | 62 lines had no `provider` | Each now says `meta` (from its model id); the dollars are unchanged: $5.82752 over 72 lines | `review-day7-minors.test.ts` |
| M6 failed "What else?" | Cached for good | Not cached unless a run finished; the page shows "Ask again" | `review-day7-server.test.ts`, `review-day7-ui.test.tsx` |
| M7 round 4's proof card | No Muse Spark column | "Muse Spark 1.3 (muse-spark-1.3) · no usable answer (network error)", read from the file's own agent log for older files and from `bettors` for new ones; the counts table shows "no usable answer" instead of numbers | `review-day7-ui.test.tsx` |
| M8 hygiene | `tests/evidence/D07-01/live.ts` named a private config path and `gh auth token`; D01-review probes not in "Not counted" | Comment made generic; D01-review probes listed under "Not counted" in the generated index | `review-day7-minors.test.ts`, `refusal-index.test.ts` |

## What I did not do, and what I am unsure about

- Other evidence READMEs (D03-00 … D05-04) still show the private config path in their run commands. The
  review named only `live.ts`, so I changed only that file.
- The index script reads JSON and JSONL generically, but reads plain-text outputs only from a named list
  (`TEXT_SOURCES`: the S6 settle-time line and the 201-caller gate line). A refusal that exists only in a new
  `.txt` file would need adding there by hand.
- The fixer's log line for the chat fallback now says "Muse Spark 1.3 (chat fallback)" and no longer repeats
  the id `muse-spark-1.3` in the text. The log entry still carries the model id in its own field.
