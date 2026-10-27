# D19: on Moonwell, Muse Spark gets exactly what the person sees before betting

Date: 2026-10-27 (WAT) · model `muse-spark-1.3` (bet-only) · nothing written to `proofs/`.

Two rounds of live calls, both recorded as they came back:
- **v1 context: 1 line** (commit e7769c9). The context had the level sentence, the block and its time, the question, the unit, the
  tolerance rule and only the chosen line (42). The review then found two gaps: the screen also shows the pull request line and
  the level caption, and lets the person open the whole chosen file. Spark got neither.
- **v2 context: same as screen** (this commit). It adds the PR line (ref, title, merge commit, file count, fingerprint, licences),
  the "Read with this run" caption, and the whole chosen file with line numbers, the chosen line marked `>`. The prompt grew from
  378 to 3,379 tokens.

## Where to look first

- **Spark declined 6 times out of 6** (3 with v1, 3 with v2). All 6 verdicts are **can't check** (the bettor declined).
  Both real runs read cbETH at **$1.12** (reference $2,206.68, control passed).
- v1 reasons (word for word):
  1. "unknown: no feed addresses or market price data provided for cbETH at fork block"
  2. "unknown: cannot determine post-proposal oracle price without executing fork simulation"
  3. "unknown: cannot read fork state or proposal feed addresses to determine reported price"
- v2 reasons (word for word):
  1. "unknown: historical cbETH/USD price at Base block 42194662 requires on-chain oracle read unavailable offline"
  2. "unknown: no oracle price data available for cbETH at that fork block"
  3. "unknown: cbETH USD price at Base block 42194662 (2026-02-15) requires on-chain oracle read after OEV wrapper activation, not available offline"
- What this means: the first decline (D04-04) said the fork block time was missing. Once it had the block, its time, the PR title
  and the whole file, Spark still declined every time. Its reason is now always the live price, which the person does not see before
  the run either. Nothing was tuned after seeing any answer.
- **Cost: v1 $0.0383, v2 $0.0681** ($0.0259, $0.0197, $0.0225), total $0.1064. No repair tries.
- The D04-04 decline stays recorded as it was. No proofs or refusals file was deleted or edited.

## What changed

One function, `moonwellBetContext()` in `src/bet-context.ts`, builds the "what the bettor sees" text.
The web bet screen (`web/screens/Moonwell.tsx`, `data-testid="bet-context"`) renders it after
"Show the question". The server (`seenContextFor()` in `server/app.ts`) passes the same string into
Spark's bet-only prompt (`seenContext` in `server/meta/roles/claimant-bets.ts`). Because both call
the same function on the same inputs, the screen and the prompt cannot drift apart.

The text (v2) holds:
- the pull request line the screen shows: ref, title, merge commit, file count, code fingerprint, and the licence line,
- what will run (the Level 2 or Level 1 sentence already on screen) and the level's caption,
- the fork block and the time it was made: 42194662, **2026-02-15 18:04:31 UTC** (Unix 1771178671),
- the question and its unit (USD), and the tolerance rule (within 10% of what the run reads),
- who chose the lines ("picked by a person" or "found by <model>") and the WHOLE chosen file, numbered like the
  screen's file viewer, with the chosen lines marked `>`.

The screen shows this text in a collapsed "What you know before betting" box under the question. The PR's description is
not on screen, so it is not in the text.

It never holds a model's claim (D18), a live price, a reference value or a feed answer. It has no
input that could carry one.

**Where the block times come from:** read once from Base on 2026-10-27 with `cast block <n> --field timestamp`
through the RPC in `~/.config/atlas/rpc.env`: 42194662 → 1771178671, 42194663 → 1771178673 (this
matches the known timestamp for 42194663). Stored as constants in `src/bet-context.ts`. A test checks
the block numbers equal the runner's `FORK_BLOCK` values.

## Before and after: Spark's prompt

Files: `prompt-before.txt` (the D04-04 prompt, rebuilt with the old code for the same line-42 finding), `prompt-v1.txt`,
`prompt-v2.txt`, `prompt-diff-before-v1.txt`, `prompt-diff-v1-v2.txt`.

| | Before (D04-04) | v1 context: 1 line | v2 context: same as screen |
|---|---|---|---|
| PR line (ref, title, commit, files, fingerprint, licences) | no | no | yes ("Add MIP-X43: Activate OEV wrappers for all remaining markets", 6 files) |
| What will run | experiment JSON + shape description + list of 14 markets | the screen's Level 2 sentence | same sentence + the caption |
| Fork block and time | **not given** | 42194662, 2026-02-15 18:04:31 UTC | same |
| Code | lines 22–62 (finding ±20) | line 42 only | the whole file (all lines), line 42 marked `>` |
| Question, unit, tolerance | question + answer JSON | question, USD, 10% rule, answer JSON | same as v1 |
| Prices, reference, feed values, model claims | none | none | none |
| Prompt tokens | 1,067 | 378 | 3,379 |

## The live answers

| Context | Call | Spark's bet | Verdict (src/judge.ts) | Cost |
|---|---|---|---|---|
| v1 context: 1 line | 1 | declined: "no feed addresses or market price data provided for cbETH at fork block" | can't check | $0.0113 |
| v1 context: 1 line | 2 | declined: "cannot determine post-proposal oracle price without executing fork simulation" | can't check | $0.0142 |
| v1 context: 1 line | 3 | declined: "cannot read fork state or proposal feed addresses to determine reported price" | can't check | $0.0129 |
| v2 context: same as screen | 1 | declined: "historical cbETH/USD price at Base block 42194662 requires on-chain oracle read unavailable offline" | can't check | $0.0259 |
| v2 context: same as screen | 2 | declined: "no oracle price data available for cbETH at that fork block" | can't check | $0.0197 |
| v2 context: same as screen | 3 | declined: "cbETH USD price at Base block 42194662 (2026-02-15) requires on-chain oracle read after OEV wrapper activation, not available offline" | can't check | $0.0225 |

Runs: one real Level 2 run per round on a fork of Base at block 42194662 (`v1-live-run.json`, `v2-live-run.json`). Both:
control passed, 14 oracle-feed actions applied as the governor, cbETH read `1122662744874806300` (≈ $1.12), reference
`2206683650838065175827` (≈ $2,206.68, raw Chainlink). Every bet was sealed before its round's run started; the fork block is
fixed, so one run serves all three calls of a round. Files: `v1-live-answers.jsonl`, `v2-live-answers.jsonl` (answers,
rationales, seal hashes, usage, verdicts), `v1-live-summary.json`, `v2-live-summary.json`, `v1-live-output.txt`, `v2-live-output.txt`.
The v2 script reads the PR from GitHub the way the server does (title, file count) and checks the chosen file equals the copy
the runner applies. The v1 run used the script as committed in e7769c9.

## Commands

| Command | Result |
|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/evidence/D19/live.ts )` (v1 at e7769c9, v2 now) | v1: 3 declines, $0.0383; v2: 3 declines, $0.0681 |
| `pnpm test` (no RPC in env) | 32 files, 364 passed, 17 skipped: the RPC tests, plus the GitHub network test, skipped because the v2 script's fetches hit GitHub's 60-an-hour limit without a token |
| `pnpm exec tsc --noEmit` | clean |
| `pnpm gate:day1` | 18 matched / 1 didn't match / 1 can't check (unchanged) |
| `pnpm exec vite build` | built |

New test: `tests/unit/bet-context.test.tsx`. It drives the real Moonwell screen against the real server (GitHub, the fork and the
model are stand-ins), opens the file viewer, picks line 42, shows the question, then checks:
- Spark's prompt begins with the heading followed by exactly the `bet-context` text the screen rendered;
- every line the screen's file viewer (a separate component) renders, with its number, is in the prompt;
- the PR line and the Level 2 caption are in both; the PR description is not; only line 42 is marked;
- no experiment JSON in the prompt, and after a run none of the run's numbers (measured, pre-apply, reference, USDC) and no dollar amount.

## What it proves

- On Moonwell, the screen and Spark's prompt carry the same "what you know before betting" text, from one function, and the prompt
  holds every line of the file the screen lets the person open. A test checks both.
- With v1 context, Spark declined 3 out of 3 times. With v2 context (same as the screen) it also declined 3 out of 3. All 6 were judged "can't check".

## What it does not prove, and what I am unsure about

- Six calls are a small sample. They do not show Spark would never bet with this context.
- The file viewer has a drop-down that can open the PR's other files too (mip-x43.sol, chains/8453.json and the rest). Spark gets
  the chosen file only, as the review asked. If "same as screen" should cover every openable file, that is the remaining gap.
- An Investigator finding shown on screen also shows its claim sentence to the person. Spark never gets it (D18 overrides
  "same as the person").
- The file viewer shows an empty line as one space; the prompt shows it empty. The test allows for exactly that.
- The fixture (withRpcRetry) prompt is unchanged. D19 is about Moonwell only.
