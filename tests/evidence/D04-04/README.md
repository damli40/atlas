# D04-04: loop gate, both targets in the browser, each round writes an .atlas.json

Date: 2026-10-27 (WAT) · models `muse-wonder-1.0` (Investigator), `muse-spark-1.3` (bets) · `mida` not run ·
nothing written to the public `proofs/` (the live rounds wrote to a scratch folder; two example files are copied here).

## Where to look first

- **Both rounds ran end to end in headless Chromium** against `pnpm dev:all` (real server, real Meta
  calls, real Base fork). PNGs below; console output in `browser-fixture.txt` and `browser-moonwell.txt`.
- **Spark's Moonwell bet: declined.** Its words: "unknown: fork block time and live Chainlink feed value
  for cbETH are not provided". So its verdict is **can't check** (the bettor declined). The person's
  2200 USD bet **didn't match** (observed $1.12, reference $2,206.68). One call, not re-asked, nothing tuned.
  Plain fact behind it: Spark's prompt holds the code lines, the experiment JSON and the question, but not
  the fork block number, which the person sees on screen. Whether to add it is a decision for Dami, not
  something changed after seeing the answer.
- **The Investigator again pointed elsewhere on PR #578** (lines 44–53, mip-x43.sol 160–169, 142–144).
  The driver script therefore picked line 42 (the cbETH push) as a person, and the file carries the
  caption "the cbETH line was picked by a person; the Investigator pointed elsewhere".
- **Replays deep-equal:** `GET /replay/<runId>` re-ran both from their published `.atlas.json`.
  Fixture: same seed `1431iD0YhA`, `measuredEqual: true`, `resultDiff: []`. Moonwell: same fork block
  42194662, `measuredEqual: true`, `resultDiff: []`. Both `sameOutcomes: true`, control passed.
- **Cost: $0.3246** for 4 calls (Wonder fixture $0.0442, Spark fixture $0.0154, Wonder PR $0.2479,
  Spark PR $0.0171). Running total in `usage.jsonl` ≈ $3.36 of $150.

## The two rounds

| Step | Fixture (`withRpcRetry`, pre-existing label shown) | Moonwell PR #578, Level 2 |
|---|---|---|
| Link / target | fixture loads, label "Pre-existing: written before the hackathon (listed in PRE-EXISTING.md)" | link typed in; server read 6 files at merge commit `9a6738e1…`, fingerprint `6c431aae…` = the copy the runner applies |
| Findings (PNG 1) | Wonder: 2 places (59–61, 50–65), 1 removed by plain code (quote not in 55–63); "checked against the file ✓"; claims only in the model panel. Script used 59–61 | Wonder: 3 places, none on the cbETH lines 41–43; script picked line 42 itself (`moonwell-2-chosen.png`) |
| Sealed before the run (PNG 2/3) | person 5 / 15000 / throws; Spark "has sealed 3 bets", hashes only; 0 pre-run responses carried a model answer, rationale or nonce | person 2200 USD; Spark "has sealed 1 bet", hash only; caption for Level 2 shown; 0 leaks |
| Run | sandbox, seed `1431iD0YhA`, control passed: calls 5, wait 12000 ms, throws | fork of Base @ 42194662; progress lines from the agent-log SSE (`moonwell-4-run-progress.png`); control passed; cbETH $1.12; 1 price source. The fork took ~4 s (anvil's local fork cache was warm) |
| Verdicts (last PNG) | You: 5 matched, 15000 didn't match, throws matched. Spark: 5 / 12000 / throws, all matched. 6 seal checks ✓ | Columns You / Muse Spark 1.3 / observed / reference: You 2200 didn't match; Spark declined → can't check; observed $1.12; reference $2,206.68. 2 seal checks ✓ |
| False-alarm table | n/a | 14 markets: 13 unchanged (0.0000%), cbETH flagged (−99.9491% vs raw Chainlink) |
| .atlas.json | `fixture-GFNRq1eJx7.atlas.json` | `moonwell-level2-fKqHGIIi2_.atlas.json` |

## Commands

| Command | Output | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; ATLAS_PUBLISH_PROOFS=1 ATLAS_PROOFS_DIR=<scratch>/proofs pnpm dev:all )` | server log (not kept) | publishing on, into a scratch folder only |
| `node drive.mjs <chrome-headless-shell> tests/evidence/D04-04 fixture` then `… moonwell` | `browser-*.txt`, 8 PNGs | both rounds complete, page errors: none |
| `curl localhost:8787/replay/GFNRq1eJx7`, `…/replay/fKqHGIIi2_` | `replay-*.json` | both `measuredEqual: true`, `resultDiff: []` |
| `pnpm exec tsx tests/evidence/D04-04/validate.ts` | `validate-output.txt` | both files valid |
| `pnpm test` (no RPC in env) | | 31 files, 362 passed, 16 skipped (RPC tests skip) |
| `pnpm exec tsc --noEmit`, `pnpm gate:day1`, `pnpm exec vite build` | | clean; 18 matched / 1 didn't / 1 can't check; built |

New tests: `tests/unit/loop-gate.test.ts` (fixture round through the real sandbox → file validates →
replay deep-equal; tampered verdict / bet / caption / seed rejected; Moonwell round with GitHub and the
fork as stand-ins: only PR #578 with the copy's fingerprint accepted, human-picked finding, one cbETH
question, Spark's prompt has the code but not Wonder's claim, fork block 42194662 / 42194663 by shape,
captions, false-alarm rows, file written only to the given folder, replay). `tests/unit/claimant-blind.test.ts` (D18).

## What changed in the code

- `src/atlasfile.ts`: build / parse / verify with zod. Verify re-checks every seal, that each bet was
  sealed before its run, re-judges every verdict with `src/judge.ts`, checks fingerprint / fork block /
  seed agree, and that required captions are present (pre-existing label; Level 2 caption; Level 1
  "re-run after the fact, on a fork of Base at block N").
- `src/types.ts` (plan section 3.1 changed, noted here): `Finding.proposedBy` may be
  `{ role: "human", model: "none: picked by a person" }`; `AtlasFile.findings?` records the round's finding.
- Server: `POST /targets` takes `github-pr` (refused unless it is PR #578 at the merge commit with the
  copy's fingerprint); `POST /investigate {target}` on it; `POST /findings` (lines a person picks);
  `POST /experiments` with `findingId`, EVM gate context (apply-proposal-then-read, price-read; 14 markets),
  one cbETH question; Spark bet-only on the same experiment; `POST /runs` runs the EVM runner with
  progress lines; `GET /proofs/:runId`; `GET /replay/:runId`. Files are written only with
  `ATLAS_PUBLISH_PROOFS=1` (`ATLAS_PROOFS_DIR` moves them and the refusal records).
- Web: target switcher, findings panel with model panel, "pick the lines yourself", Moonwell bet
  screen, run progress line, verdict table with a reference column, false-alarm table, captions.

## What it proves

- A person can go link → finding → sealed bet (beside Spark's) → real run → verdict in the browser on
  both targets, and each round leaves a file that validates and replays to the same measured values.
- On Base state one block before MIP-X43, applying its feed actions makes Moonwell report cbETH at
  $1.12 (reference $2,206.68) while the 13 other markets stay exactly the same, now from the app.

## What it does not prove

- Spark's Moonwell bet says nothing about whether it "knew": it declined. One call only.
- The Moonwell finding on cbETH came from a person (the driver script), not from the Investigator.
- The replay ran on the same machine with a warm fork cache; a cold replay goes back to the RPC.
- Only PR #578 can run; any other PR link is read but refused for running.
- The file's agent log is the whole session's log (a second round in one session would include the first's lines).
- The fixture flow has no "pick the lines yourself" (only the PR flow does).
- The server holds sealed answers in memory and is trusted (as in D02-06).
