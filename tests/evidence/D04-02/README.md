# D04-02: Level 2 run ("before ship") and the false-alarm table

Date: 2026-10-27 (WAT)

Caption for anything shown from this run: **"fork of Base one block before MIP-X43 ran; Atlas applied the proposal's oracle-feed actions as the governor"**.
These files are development evidence. Nothing was written to `proofs/**/run.json`.

Plain words: Atlas starts a private copy of Base as it was at block 42194662, one block before the
Moonwell proposal MIP-X43 executed. It checks that copy really is "before" (old cbETH feed, cbETH
above $1,000), runs the control, reads the price of all 14 markets the proposal touches, then
pretends to be the oracle's admin (the TemporalGovernor) and makes the proposal's 14 `setFeed`
calls itself. The list of 14 calls comes from the pull request's own files (D04-01), not from the
real transaction. Then it reads the 14 prices again and applies the pre-registered pass rule
(`proofs/moonwell/PASS-RULE.md`) by plain code.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level2-run.ts tests/evidence/D04-02 )` | `level2.json`, `false-alarm-table.md`, `run-output.txt` | control passed; cbETH flagged; 13 others exactly equal pre vs post; bet didn't match |
| same env, `pnpm exec vitest run tests/unit/evm-level2.test.ts tests/unit/evm-level1.test.ts tests/unit/evm-apply.test.ts --reporter=verbose` | `test-output.txt` | 28 passed |
| `pnpm test` with no RPC in the environment | `full-suite-no-rpc.txt` | 335 passed, 16 skipped (fork tests skip, they do not fail) |

Also green: `pnpm exec tsc -p tsconfig.json` (no output), `pnpm gate:day1` (18 matched, 1 didn't match, 1 can't check, as before).

## What the run did, step by step

1. **Guard first** (`assertPreExecution`): `getFeed("cbETH")` = `0xB0Ba…18C5` (the old feed), cbETH = 2206683650838065175827 (≈ $2,206.68). Passed. A test shows the same run at 42194663 stops with "fork is not pre-execution" before applying anything.
2. **Control, pre-apply**: chain id 8453, block 42194662; WETH `getUnderlyingPrice` = 1965580189520000000000 = wired feed answer 196558018952 × 10^10, and the raw ETH/USD aggregator answers the same 196558018952; USDC, USDbC, DAI ≈ $0.9999, USDS ≈ $0.9996 (in 0.95–1.05). After applying, the 4 stablecoins were checked again through their new wrappers: same values, in band.
3. **Pre-apply reads** of the 14 markets (table below).
4. **Apply**: `anvil_impersonateAccount(0x8b62…7d51)` and `anvil_setBalance` (1 ETH) succeeded; 14 `setFeed(symbol, wrapper)` transactions from the admin, all `success`. Each emitted one `FeedSet`; those 14 fork events equal the derived actions, and the derived actions equal the 14 real Base events (set equality, both yes). Fork transaction hashes (local anvil hashes, not Base hashes):

| Market | Fork tx hash | Fork block | Status |
|---|---|---|---|
| DAI | `0xac9fdb8e75f66d90a441a75bbff49693dbd9d1ef3ef33d02d134265b53227fd5` | 42194663 | success |
| USDC | `0x6ab5e5a439057de3ce0650cd0d1d429ec59ceacc9c1043311a3b4dcaadfaa63d` | 42194664 | success |
| USDbC | `0xb2e7e9a2c2fb5f369dc145929a914692041a71e29608b4f8bb544120bcee3c50` | 42194665 | success |
| cbETH | `0xc7f41d2302cc782298da7142147aea46204063a2ae8226592a740e4366403eff` | 42194666 | success |
| AERO | `0xc299ae68b5576259b76f16c1afd1d388b61cf31c68ed0d64e8fc485d498e12a4` | 42194667 | success |
| cbBTC | `0x4d69a8288e4aba124620846300bcc4711952a3ed2ba0377abf5635f41a146540` | 42194668 | success |
| EURC | `0x51007943964d4af7c5df778931d5fdb69997db317c53ed0f28b4de6393d618cc` | 42194669 | success |
| WELL | `0x8eb5a65570e86f88ee5b39d9e4d49605e63d1810e89e2b27382dca2cb2e7b99e` | 42194670 | success |
| USDS | `0x71bb0e24beb8a39ffdd14b9e811e0bab6a4ddb8ed8270472befbbc0e83ef0cf7` | 42194671 | success |
| tBTC | `0xe461810609e7691a11108109132e2c1ee534711f6593c2374abbac2809410c31` | 42194672 | success |
| VIRTUAL | `0x4fec6739556cd42fa0a2e39f80994317dab59462df7fef9e1ba829a0f74f133b` | 42194673 | success |
| MORPHO | `0x2b4ce2f1085ba4ea36ada3ae705c340d66998f68063cfaf63aa8318cceb553e2` | 42194674 | success |
| cbXRP | `0x9007445164a759c62a320438d5ec1f75a0eb0845ebf9b06bf05b6f2f0d87cca6` | 42194675 | success |
| MAMO | `0xc12d277969edd87fad30008da9b2c4366a56cd5edddfd36472cfb6b0679b16a5` | 42194676 | success |

5. **Post-apply reads**, the reference and the call trace.

Note on "same block": every `setFeed` mines one local block, so post-apply reads happen at local
block 42194676. Nothing from Base after 42194662 enters the fork: the 14 extra blocks hold only
Atlas's own `setFeed` transactions. The cbETH reference computed before and after applying is the
same number (2206683650838065175827), from the same Chainlink rounds.

## The false-alarm table

| Market | Feed changed? | Pre-apply (USD) | Post-apply (USD) | Post-apply exact (USD × 1e18) | Diff vs pre | Flag compares against | Diff vs that | Flagged? |
|---|---|---|---|---|---|---|---|---|
| DAI | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDC | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDbC | yes | $1.00 | $1.00 | 999900000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbETH | yes | $2,206.68 | $1.12 | 1122662744874806300 | -99.9491% | raw Chainlink reference $2,206.68 | -99.9491% | **yes** |
| AERO | yes | $0.31 | $0.31 | 310865530000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbBTC | yes | $68,489.74 | $68,489.74 | 68489740000000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| EURC | yes | $1.18 | $1.18 | 1184823110000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| WELL | yes | $0.01 | $0.01 | 5012000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| USDS | yes | $1.00 | $1.00 | 999635870000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| tBTC | yes | $68,265.91 | $68,265.91 | 68265908984780000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| VIRTUAL | yes | $0.63 | $0.63 | 627045790000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| MORPHO | yes | $1.32 | $1.32 | 1323195190000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| cbXRP | yes | $1.49 | $1.49 | 1493697000000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |
| MAMO | yes | $0.01 | $0.01 | 14376590000000000 | 0.0000% (exactly equal) | its pre-apply price | 0.0000% | no |

All 14 feeds changed address; for the 13 markets other than cbETH the price did not move by a
single unit (same Chainlink round, now passed through a wrapper). cbETH's post-apply value
1122662744874806300 is exactly the raw cbETH/ETH ratio answer, and exactly what Level 1 read at
block 42194663 (D03-03).

## cbETH vs the reference

Post-apply cbETH ≈ **$1.12** (1122662744874806300). Reference = ETH/USD 196558018952 (8 decimals,
read) × 10^10 × cbETH/ETH 1122662744874806300 (18 decimals, read) / 10^18 = **$2,206.68**
(2206683650838065175827), from the raw aggregators `0x7104…` and `0x806b…`; recomputing it from the
recorded inputs gives the stored value. Difference: **−99.9491%** of the reference, far past the 50% flag line.

## The call trace (how many price sources cbETH's read touches)

Method: `debug_traceCall` with `callTracer` on `getUnderlyingPrice(MOONWELL_cbETH)`, on anvil 1.8.6.
The response is a nested call tree (`from, gas, gasUsed, to, input, output, calls, value, type`), as
expected. Plain code keeps every call whose input starts with `latestRoundData()` (`0xfeaf968c`) and
counts the distinct addresses that **make no further `latestRoundData()` call themselves**: the
aggregators the numbers actually come from. Wrappers and Chainlink proxies only pass the call on.

| | `latestRoundData()` called on (outermost first) | Price sources counted |
|---|---|---|
| Pre-apply (old feed `0xB0Ba…`) | `0xB0Ba…` → ETH/USD proxy `0x7104…` → `0x57d2…`; cbETH/ETH proxy `0x806b…` → `0x08f9…` | **2** (a multiply: ETH/USD × cbETH/ETH) |
| Post-apply (wrapper `0x6799…`) | `0x6799…` → cbETH/ETH proxy `0x806b…` → `0x08f9…` | **1** (one feed, no multiply) |

**Read this carefully:** a literal "distinct addresses whose `latestRoundData` was called" would give
5 before and 3 after, because it counts every pass-through. The plan expects 1 post-apply and the
pass rule's replay line expects 2 for a composite; the source count gives exactly those numbers,
and the pre-apply trace (a known composite) gives 2, which checks the method on a known case. Both
lists are in `level2.json` (`record.trace`).

## The bet

Human bet: **2200 USD, ±10% of the observed value**, on `priceUsd1e18:cbETH` (the post-apply
price), sealed before the run (`betSealedBeforeRun: true`). Judged by `src/judge.ts`:
**didn't match** (observed $1.12; within 10% would mean $1.01–$1.23).

## PASS-RULE.md, line by line

| Rule | Outcome | Detail |
|---|---|---|
| Control: WETH exact | matched | 1965580189520000000000 = 196558018952 × 10^10 (wired = raw) |
| Control: USD stablecoins 0.95–1.05 (pre and post) | matched | USDC, USDbC, DAI 0.9999; USDS 0.99963587 |
| 1. Flag rule: cbETH > 50% off the reference → surfaced | matched | −99.9491%, flagged |
| 2. False-alarm rule, 13 markets within 2% of pre-apply → not surfaced | matched ×13 | every one exactly equal; USDC and USDbC (shared wrapper) both pass |
| Single-feed trace (D04-02 acceptance) | matched | 1 price source post-apply |
| 3. Replay rule (after a proposed change) | can't check | no change proposed yet; change-and-replay is a later task |

## What Level 2 does NOT apply

Only the proposal's oracle-feed actions (`_wireCoreFeeds` on Base). Not applied: the Morpho oracle
wrapper upgrades (`_upgradeMorphoWrappers`), the mToken whitelists on the OEV fee redeemer
(`_whitelistMTokens`), the fee-split updates on wrappers MIP-X38 had already wired
(`_updateExistingWrapperFees`), and anything on Optimism or Moonbeam. None of them call
`setFeed`, but whether any of them would change a price read here (for example the fee update on
the ETH/USD wrapper WETH reads through) was not tested.

## What it proves

- On Base state one block before execution, the PR's own oracle-feed actions, applied as the
  governor, make Moonwell's oracle report cbETH at ≈ $1.12 while the raw Chainlink feeds give
  ≈ $2,206.68: Atlas surfaces cbETH before the proposal ran on-chain.
- The same actions leave the other 13 markets' prices exactly unchanged, so Atlas raises no false
  alarm on them.
- After the change, cbETH's price touches one price source (no multiply); before it, two.
- The fork-block guard, the control and the derived-vs-real check all ran and passed.

## What it does not prove

- The full proposal: Morpho upgrades, whitelists and fee updates were not applied (see above).
- How the proposal reached execution (Moonbeam governor vote, Wormhole message): Level 2 skips that
  and acts as the governor directly.
- That the wrapper serves the same round as the raw feed at other blocks: it did at this block.
- The replay rule: no change has been proposed or replayed yet.
- That the block was "discovered": 42194662 is an input Atlas takes and shows.
