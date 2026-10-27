# D04-03: the Investigator on the fixture and on Moonwell PR #578

Date: 2026-10-27 (WAT) · model `muse-wonder-1.0` (fallback `muse-spark-1.3`, never needed) · `mida` not run · nothing written to `proofs/`.

## Where to look first

- **PR #578: 0 of 5 runs** put a verified finding on the `cbETHETH_ORACLE` push line
  (`proposals/ChainlinkOracleConfigs.sol` line 42). The target was 3 of 5. It stayed 0 in 5 more
  runs (3 more at effort "low", 2 at "medium"): **0 of 10 in all**. So the demo cannot count on the
  Investigator pointing at the cbETH line. The UI keeps working with a person picking the line.
- **Fixture: 3 of 3 runs** had verified findings inside `withRpcRetry` (fixture lines 49–66,
  found by plain code from the declaration to its closing `}`). In fact all 9 of 9 findings were inside it.
- **Nothing was dropped.** Every one of the 39 places Wonder proposed passed the plain-code checks
  (file exists, lines exist, at most 41 lines, quoted snippet inside those lines, kind in the list).
  No repair try and no fallback to Spark was needed. The dropping path is covered by unit tests only.
- **Cost: $2.55** for 13 calls (usage.jsonl total went from $0.4905 to $3.0386). Most expensive call: $0.2658.

## What Wonder pointed at on PR #578 (all verified against the file)

| Place | Runs (of 10) | What the claim says, shortened |
|---|---|---|
| `ChainlinkOracleConfigs.sol` 44–53 | 10 | "all remaining markets" leaves wstETH, rETH and weETH commented out |
| `mip-x43.sol` 306–321 | 7 | the 3000 fee value is the liquidator's 30%, not the protocol's |
| `mip-x43.sol` 147–169 / 160–169 | 6 | configs sharing one oracle (USDC/USDbC) reuse one wrapper |
| `ChainlinkOracleConfigs.sol` 31–36 | 3 | USDC and USDbC both priced by the USDC feed |
| `ChainlinkOracleConfigs.sol` 139–144 / 142–144 | 2 | stkWELL's wrapper is fed by the WELL/USD feed |
| `ChainlinkOracleConfigs.sol` 130–132 | 1 | USDT0 priced through the USDT feed |
| `mip-x43.sol` 215–217 | 1 | the feed is keyed by the token's on-chain `symbol()` |

Lines 44–53 start two lines below the cbETH push (41–43). Wonder read that exact block every time
and pointed at the commented-out lines under it, never at the live cbETH line. No claim mentions
cbETH, the ETH multiplication, or Moonwell's loss.

The claims are the model's words and are kept here as data. They are not Atlas's judgement.

## Files

| File | What it holds |
|---|---|
| [`investigator-5-runs.jsonl`](investigator-5-runs.jsonl) | **The acceptance series.** PR #578, 5 runs at effort "low": findings, dropped places, each call's usage, the log lines |
| [`investigator-low-extra-3-runs.jsonl`](investigator-low-extra-3-runs.jsonl) | 3 more PR runs. Meant to be "medium"; see "A mistake" below |
| [`investigator-medium-2-runs.jsonl`](investigator-medium-2-runs.jsonl) | 2 PR runs at effort "medium" |
| [`fixture-runs.jsonl`](fixture-runs.jsonl) | 3 fixture runs |
| `summary*.json`, `live-output*.txt` | counts, usage before/after, console output of each series |
| [`prompt-fixture.txt`](prompt-fixture.txt), [`prompt-pr578.txt`](prompt-pr578.txt) | the exact prompts (the PR's 6 files at merge commit `9a6738e1…`, its title and description) |
| [`investigator-live.ts`](investigator-live.ts) | the script: `GITHUB_TOKEN=… pnpm exec tsx tests/evidence/D04-03/investigator-live.ts 3 5` |
| [`test-output.txt`](test-output.txt), [`tsc-output.txt`](tsc-output.txt) | `pnpm test` (27 files, 340 passed, 11 skipped) and `tsc --noEmit` (clean) |

`pnpm gate:day1`: 18 matched, 1 didn't match, 1 can't check, 704 ms (unchanged).

## A mistake, and what changed

The plan says: effort "low", "medium" only when the input is over 50k tokens. The code estimated
tokens as characters ÷ 4, said 37,406, and ran PR #578 at "low". The API then billed **51,150**
prompt tokens: the PR is over the line, so by the plan's rule the 5 acceptance runs should have been
"medium". I then changed the estimate to ÷ 3, which said 49,874, still under 50k, so the next 3
runs were also "low" ($0.73, kept as extra low runs, not counted as medium). The estimate is now
÷ 2.8 (53,437 → "medium"), and the last 2 runs ran at "medium". Both efforts gave 0 hits.

## What it proves

- The Investigator answers in one call, in the schema, on both targets, at about $0.04 (fixture)
  and $0.24 (PR) a call.
- Every finding it returned was checked by plain code against the bytes Atlas read; none had to be removed.
- On the fixture it points inside `withRpcRetry` every time.
- On PR #578 it does **not** single out the cbETH line, at either effort, in 10 runs.

## What it does not prove

- **The incident is public.** Wonder may have read Moonwell's post-mortem. The run is the evidence,
  not the model's memory. (Here the memory did not show up: no run mentioned cbETH.)
- 10 runs is a small sample. A rate of 0/10 says the hit rate is low, not that it is zero.
- No prompt was tuned toward cbETH, on purpose: a prompt that hints at the answer would make any hit worthless.
- The dropping, repair and Spark-fallback paths ran only with a mocked model (tests/unit/investigator.test.ts).
- POST /investigate was tested with a mocked model and a mocked GitHub fetch, not on a live server.
- The token estimate (÷ 2.8) is fitted to one PR. Other code may tokenise differently.
