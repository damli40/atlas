# Refusal index (D07-03, D9)

Every real "can't check" verdict and every real gate rejection recorded since Oct 27, 2026, each traceable to a
file in this repo. Nothing here was made for this index: it lists what the runs already recorded.
Audit date: 2026-10-27. How it was found: every `.json` / `.jsonl` / `.txt` under `tests/evidence/` and every
record in this folder was searched for `cant_check`, "can't check", "declined", `"allowed": false` and
"gate: rejected"; each hit was read and kept only if it came from a real run.

**Counts:** 18 can't-check verdicts (16 from Muse Spark declining to bet, 1 on a replay of a declined bet, 1
from plain code that had nothing to measure) · 1 gate rejection (a scripted probe, human-proposed) · **0 gate
rejections of a model's proposal** (the Claimant and the Adversary proposed only allowed experiments live) ·
0 control failures on a judged run.

## Can't-check verdicts (src/judge.ts)

| # | Date (UTC) | Run id | Bet | Trigger | Reason (plain code) · bettor's own reason | Model | File |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-27 04:53 | `nivE_hwJis` | `Re2hbNHSHm` (totalWaitMs) | Claimant picked `retry-scenario · failTimes 1 · never_settles` and declined one bet | the bettor declined · "unclear if totalWaitMs counts only sleep calls or virtual elapsed time while pending" | muse-spark-1.3 | [`2026-10-27-Re2hbNHSHm.json`](2026-10-27-Re2hbNHSHm.json), `tests/evidence/D02-02b/judged-runs.json` |
| 2 | 2026-10-27 04:54 | `AflDb9Q3S8` | `CgQ-s5T_8A` (calls) | Claimant picked `retry-scenario · failTimes always · never_settles`, declined 3 of 3 | the bettor declined · "code has no timeout so harness virtual-time accounting for a never-settling call is unclear" | muse-spark-1.3 | [`2026-10-27-CgQ-s5T_8A.json`](2026-10-27-CgQ-s5T_8A.json), D02-02b |
| 3 | 2026-10-27 04:54 | `AflDb9Q3S8` | `TO58tDFURq` (totalWaitMs) | same round | the bettor declined · "unclear whether harness counts sleep only or also pending time toward total wait" | muse-spark-1.3 | [`2026-10-27-TO58tDFURq.json`](2026-10-27-TO58tDFURq.json), D02-02b |
| 4 | 2026-10-27 04:54 | `AflDb9Q3S8` | `P6S9Ur6a0G` (outcome) | same round | the bettor declined · "pending versus can't-check after 30000ms virtual limit cannot be distinguished from code alone" | muse-spark-1.3 | [`2026-10-27-P6S9Ur6a0G.json`](2026-10-27-P6S9Ur6a0G.json), D02-02b |
| 5 | 2026-10-27 05:32 | not recorded | S6 `settledAtMs` (scripted oracle bet, 30000) | `pnpm gate:day1`, S6: a call never answers | "the function never settled: it was still waiting with nothing left that could wake it, so it has no settle time" | none (plain code) | `tests/evidence/D01-08/six-cases.txt` (repeats in every `gate-day1.txt`) |
| 6 | 2026-10-27 06:22 | `fKqHGIIi2_` | `X2HfEm1vdH` (cbETH, Level 2) | Moonwell loop gate; Spark had no block number (before D19) | the bettor declined · "fork block time and live Chainlink feed value for cbETH are not provided" | muse-spark-1.3 | `tests/evidence/D04-04/moonwell-level2-fKqHGIIi2_.atlas.json` |
| 7–9 | 2026-10-27 06:42 | `bkG_en5TYU` | calls 1–3, seals `f2c29c41ca31…`, `09a8bc226ac9…`, `d94b65378dc8…` | D19 v1 context (one line) | the bettor declined ×3 · e.g. "cannot determine post-proposal oracle price without executing fork simulation" | muse-spark-1.3 | `tests/evidence/D19/v1-live-answers.jsonl`, `v1-live-run.json` |
| 10–12 | 2026-10-27 06:46 | `dS5cUFIsJI` | calls 1–3, seals `13220d23abe5…`, `f44b2f39b9c2…`, `32b6bd316aec…` | D19 v2 context (same text as the person's screen, block and date given) | the bettor declined ×3 · e.g. "historical cbETH/USD price at Base block 42194662 requires on-chain oracle read unavailable offline" | muse-spark-1.3 | `tests/evidence/D19/v2-live-answers.jsonl`, `v2-live-run.json` |
| 13 | 2026-10-27 07:29 | `mwTaxvHFzB` | `xui1c_0riH` (cbETH, Level 2) | Moonwell round in the browser (D05-04), person's $2,200 didn't match ($1.12) | the bettor declined · "cbETH USD price at fork block 2026-02-15 is after knowledge cutoff and depends on live orac[le]…" | muse-spark-1.3 | `tests/evidence/D04-04/moonwell-level2-mwTaxvHFzB.atlas.json` (verifies; proof card in D06-03) |
| 14 | 2026-10-27 08:57 | `UQQlK8-2S5` | `hO6kNLeDu7` (cbETH, Level 2) | Moonwell round before the D06-01 change | the bettor declined · "cbETH USD price at specific historical fork block requires on-chain oracle read" | muse-spark-1.3 | `tests/evidence/D06-01/run-evm.json` |
| 15 | 2026-10-27 09:08 | `hhFxiKOUHg` | `P-wy84rsNu` (cbETH, Level 2) | Moonwell round of the D06-01 retry | the bettor declined · "no access to fork state or live cbETH USD price at block 42194662" | muse-spark-1.3 | `tests/evidence/D06-01/retry-evm/run-evm.json`, `tests/evidence/D20/d20.atlas.json` |
| 16 | 2026-10-27 10:33 | `Wb8hBh0WXP` (replay of `hhFxiKOUHg`) | `P-wy84rsNu` again | D20 "in theory" replay: the same sealed bet judged again | the bettor declined (same bet as #15, judged on the replay) | muse-spark-1.3 | `tests/evidence/D20/d20.atlas.json` |
| 17 | 2026-10-27 10:56 | `-pgWeZFo9d` | `CAsObyR5nT` (cbETH, Level 2) | D07-02 Moonwell round, before "What else?" | the bettor declined · "live Chainlink cbETH price at future Base block 42194662 is not knowable in advance" | muse-spark-1.3 | [`2026-10-27--pgWeZFo9d-CAsObyR5nT.json`](2026-10-27--pgWeZFo9d-CAsObyR5nT.json), `tests/evidence/D07-02/run-moonwell.json` |
| 18 | 2026-10-27 10:56 | `6WcBUBJ1D0` | `Fv8nnN78rL` (cbETH, Level 1) | D07-02 autonomous round: the Adversary proposed `price-read · markets cbETH`, no click | the bettor declined · "no reliable cbETH USD price for Base block 42194663 on 2026-02-15" | muse-spark-1.3 | [`2026-10-27-6WcBUBJ1D0-Fv8nnN78rL.json`](2026-10-27-6WcBUBJ1D0-Fv8nnN78rL.json), `tests/evidence/D07-02/adversary-moonwell.json` |

Rows 1–4 were recorded by the D02-02b evidence script as `declined_bet` records (they hold the bet id, not the
run id); the run ids come from `judged-runs.json`, matched by the bettor's reason. Rows 5–16 were run before
the live server wrote refusal files for every can't-check, or by scripts with an in-memory writer, so they live
only in `tests/evidence/`.

## Gate rejections (src/gate.ts)

| # | Date (UTC) | Experiment | Trigger | Reason | Proposed by | File |
|---|---|---|---|---|---|---|
| 1 | 2026-10-27, about 08:42 (the run's distribution.json time) | `concurrency-sweep · callers 201` | D06-02 evidence script probing the waves screen's bound | "callers 201 is outside the allowed range (1 to 200)"; 422, nothing ran | the script (a person's request; no model) | `tests/evidence/D06-02/sweep-output.txt` |

No model proposal has been refused live: D02-02 and D02-02b record "gate rejections 0" on all 10 Claimant
calls, and both D07-02 Adversary proposals were allowed first try. If one happens, the live server writes it
here as `<date>-<experimentId>.json` (role `claimant` or `adversary`).

## Other "can't check" lines (not judge verdicts, listed so nobody mistakes them for one)

- PASS-RULE rule 3 "can't check (no replay ran)": `tests/evidence/D04-02/run-output.txt` (no change proposed
  yet) and `tests/evidence/D06-01/pass-rule-replay.txt` (Muse Code gave no usable change). A rule line, not a bet.
- Not counted: `tests/evidence/D05-03/cases.json` (a run with its control marked as not passed, built for a
  drawing test), the D02-review / D04-review / D05-review probes and unit tests (constructed on purpose),
  and D03-05 (a spike whose control failed; no bet was judged).

## Candidates for the film's "can't check" beat

Dami picks; nothing is staged. In order of how well each holds up on camera:

1. **Row 13, run `mwTaxvHFzB`**: Muse Spark declines Moonwell's cbETH price because it "depends on live
   oracle" data, the judge says can't check, while the run reads $1.12 against a $2,206.68 reference. It has a
   verified `.atlas.json`, a proof card (D06-03) and replays to the same result. Same reason, six more times
   with the screen's own text (rows 7–12: "needs a live chain read"), so it is a pattern, not a fluke.
2. **Row 18, run `6WcBUBJ1D0`**: the same decline inside the autonomous "What else?" round, with the
   handoff on the log strip (`tests/evidence/D07-02/moonwell-strip-handoff.png`). Its `.atlas.json` was kept
   in memory only (not published), so it cannot be replayed from a file today.
3. **Row 5, S6 settle time**: plain code, no model, refuses to give a settle time to a call that never
   settles. The cleanest "Atlas says can't check in its own voice", but the bet is the gate script's own
   (scripted to hit this field) and the run id was not recorded; a person's live S6 bet on settle time
   would give a run id.

Caution for the narration: in every model row, the model chose to decline; Atlas did not refuse to run.
The judge's words are "the bettor declined". Say "Muse Spark wouldn't guess, so Atlas can't check its bet",
never "Atlas couldn't run it".
