# D07-02 · Adversary "what else?"

Date: 2026-10-27. Branch `d07-adversary`.

## What was built, in plain words

After a round has run, a **What else?** button (fixture flow and Moonwell flow) asks the server
(`POST /adversary {runId}`). Then, with no further click:

1. **The Adversary** (`muse-spark-1.3`, `server/meta/roles/adversary.ts`) reads the finding's code lines
   (never the Investigator's claim sentence, never any bettor's rationale: D18), the last run's
   `measured`, `notMeasured`, references and trace (first 200 events; the run is over, so values are
   allowed), the verdicts' outcomes, the experiments already run on this target, and the gate's
   allow-list text. It answers `{experiment, why}`.
2. **Plain code checks it**: JSON → zod → `src/gate.ts` → the shape has plain-code questions → it is
   not an experiment already run on this target (`src/experiment-name.ts`: deep-equal after key order,
   market order and `"touched"` are normalised). Any failure: one repair try, then "no usable answer".
   A gate rejection is a real refusal: a plain gate line on the strip and a record in `proofs/refusals/`
   (role `adversary`, model id).
3. **The autonomous round**: plain-code questions, Muse Spark's bets sealed by the server before the
   run, the person's slot "not asked" (their bets and `POST /runs` on that round get 409), the run,
   `src/judge.ts`. The log strip shows each handoff.

Atlas's own voice never carries the model's words: the experiment is named by plain code from its
params (shape id + values; a free JSON value is shown only as its length), gate reasons on screen have
every quoted non-gate word replaced, and the `why` sentence appears only in a model panel labelled
"Model text: not a verdict, not checked by Atlas".

## Live results (real models, real sandbox, real Base fork)

`node drive.mjs <chrome-headless-shell> . fixture|moonwell` against the real server (model bets on,
adversary on, investigator and fixer off). Raw output: [`browser-output-fixture.txt`](browser-output-fixture.txt),
[`browser-output-moonwell.txt`](browser-output-moonwell.txt). Server answers: `run-*.json`, `adversary-*.json`.

| Target | First round (person + Spark) | Adversary proposed | Gate | Autonomous round verdicts |
|---|---|---|---|---|
| withRpcRetry fixture | S3 `retry-scenario · failTimes 5 · failure error`; person 3/3 matched; Spark: no usable answer (network error, `fetch failed`) | `retry-scenario · failTimes 4 · failure error` | allowed | Spark 3 bets (calls 5, wait 12000, returns): **3 matched** (run `eao2x9DujH`) |
| Moonwell PR #578 | Level 2 (`apply-proposal-then-read`, touched), line 42 picked; person $2,200 didn't match ($1.12); Spark declined (can't check) | `price-read · markets cbETH` (Level 1, block 42194663) | allowed | Spark **declined** → **can't check**, observed $1.12 (run `6WcBUBJ1D0`) |

Both proposals were new shapes or values for that target on the first try; no gate rejection happened
live, so no live Adversary refusal exists yet (the rejection path is covered by the mocked tests below).

The log strip at the handoff: [`fixture-strip-handoff.png`](fixture-strip-handoff.png),
[`moonwell-strip-handoff.png`](moonwell-strip-handoff.png); line text in `*-strip-lines.txt`. The section:
[`fixture-what-else.png`](fixture-what-else.png), [`moonwell-what-else.png`](moonwell-what-else.png).
Moonwell order: Person asks what else → Adversary (muse-spark-1.3) proposes price-read · markets cbETH →
Gate allowed → Person not asked → Claimant (muse-spark-1.3) bets → Seal ×2 → Runner forks Base @ 42194663
→ control → reads 1 market → Judge 1 can't check. Page errors: none. "fixed" on the page: no.

Two real can't-check records were written by the live server (Spark declined both Moonwell bets):
`proofs/refusals/2026-10-27--pgWeZFo9d-CAsObyR5nT.json`, `proofs/refusals/2026-10-27-6WcBUBJ1D0-Fv8nnN78rL.json`.

**Read with care:** the Moonwell Adversary's `why` says the Level 1 read would show "the correct
baseline". It did not: block 42194663 is after the proposal ran, so it read $1.12. That is the model's
sentence, shown only in its panel; the run and the judge say what happened.

## Cost

5 billed calls, **$0.166** upper bound (Spark price unverified, priced as Wonder): Adversary $0.041 +
$0.060, Spark bets $0.015 + $0.029 + $0.021 (`tests/evidence/usage/usage.jsonl` lines 58–62). One Spark
call failed with a network error and reported no usage.

## Checks

| Command | Output | Result |
|---|---|---|
| `pnpm test` (offline) | [`test-output-offline.txt`](test-output-offline.txt) | 661 passed, 18 skipped |
| `pnpm test` with BASE_RPC_URL | [`test-output-rpc.txt`](test-output-rpc.txt) | 675 passed, 4 skipped |
| `tsc --noEmit` | [`tsc-output.txt`](tsc-output.txt) | exit 0 |
| `vite build` | [`vite-build.txt`](vite-build.txt) | built |
| `pnpm gate:day1` | [`gate-day1.txt`](gate-day1.txt) | 18 / 1 / 1 |

New tests, `tests/unit/adversary.test.ts` (23): names from params only; repeat check in other spellings;
prompt holds code + run, never the claim or a rationale, 200 of 250 trace events; repeat → repair →
ok, and repeat twice → no usable answer; gate rejection → recorded (role adversary) → repair → gate
rejection → no usable answer, no model text in any log line; 7 hostile gate reasons leak nothing;
server: one autonomous round with the handoff in order, Spark sealed before the run, person's bet and
`POST /runs` refused, second ask returns the same answer with no new call; not-configured → not asked;
the screen shows the `why` only in its model panel.

## What this does not show / limits

- No live gate rejection of an Adversary proposal (both live proposals were allowed first try).
- The repeat check cannot see code defaults: `{failTimes 5}` and `{failTimes 5, attempts 5}` count as different.
- On Moonwell, an EVM autonomous round asks every question of its shape (one per market listed), unlike the
  person's round, which asks cbETH only. Spark's D19 context names the first question only.
- One "what else?" per run, three per session; the autonomous round's run is not offered "what else?" again on screen.
