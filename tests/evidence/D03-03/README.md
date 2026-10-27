# D03-03: Level 1 run (price-read) with its control and the cbETH reference

Date: 2026-10-27 (WAT)

Caption for anything shown from this run: **"re-run after the fact, on a fork of Base at block 42194663"**.
These files are development evidence. They are not a published proof card: nothing was written
to `proofs/**/run.json`. The published Moonwell run comes later, through the app.

Plain words: the EVM Runner (`runners/evm/runner.ts`) starts a private copy of Base at a block it
is given (a "fork"), runs a control on that same copy (`runners/evm/control.ts`: checks whose answer
is known in advance), reads Moonwell's price for cbETH, and computes a reference price for cbETH
from Chainlink's raw feeds at the same block. The judge (`src/judge.ts`) then compares a sealed bet
with the price the code reported. The fork block is a required input; a run without one throws.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level1-run.ts tests/evidence/D03-03 )` | `level1-after.json`, `level1-before.json`, `verdict.json` | control passed at both blocks; bet didn't match |
| same env, `pnpm exec vitest run tests/unit/evm-level1.test.ts --reporter=verbose` | `test-output.txt` | 10 passed |
| `pnpm test` with no RPC in the environment | `full-suite-no-rpc.txt` | 301 passed, 11 skipped (the RPC tests skip, they do not fail) |

## The numbers (all read on the fork)

| | Block 42194663 (proposal ran) | Block 42194662 (one before) |
|---|---|---|
| `getFeed("cbETH")` | `0x67996D1f…495D` (the OEV wrapper over cbETH/ETH), 18 decimals, description "CBETH / ETH" | `0xB0Ba0C5D…18C5`, 18 decimals, description reverts (recorded `null`) |
| cbETH `priceUsd1e18` | 1122662744874806300 (**≈ $1.12**) | 2206683650838065175827 (≈ $2,206.68) |
| Reference `refUsd1e18:cbETH` | 2206683650838065175827 (**≈ $2,206.68**) | same value |
| Reference inputs | ETH/USD `0x7104…` answer 196558018952, decimals 8 (read); cbETH/ETH `0x806b…` answer 1122662744874806300, decimals 18 (read) | same rounds |
| WETH control | 1965580189520000000000 = feed answer × 10^10, exact | same |
| Stablecoins | USDC 0.9999, USDbC 0.9999, DAI 0.9999, USDS 0.99963587 (all inside 0.95–1.05) | same |
| controlPassed | true | true |

So at the block the proposal ran, Moonwell's oracle reported cbETH at $1.12 while the reference
(what ETH/USD × cbETH/ETH gives at the same block) was $2,206.68: the reported price is 99.95%
below the reference. One block earlier, the old feed reported exactly the reference value.

The plan expected "≈ 2.24e21" at 42194662. That figure was read at block 42194000; at 42194662 the
value is 2.2067e21 (ETH had moved). The test asserts 2.0e21–2.5e21 and the old feed address.

**The bet.** A human bet of 2200 USD, tolerance 10% of the observed value, on
`priceUsd1e18:cbETH`, sealed (`sealedAt` before the run's `startedAt`). The judge returned
**`not_matched`**: observed $1.12, so the bet would have to be within $0.11 of $1.12.

## Plan correction (found by D03-02, applied here)

The plan said the WETH market is "wired straight to ETH/USD". It is not: `getFeed("WETH")` returns
the ETH/USD **OEV wrapper** `0xeb083d23…1547`, not the raw aggregator `0x7104…`. So the control
is written against the feed the oracle itself is wired to:

`getUnderlyingPrice(MOONWELL_WETH) == latestRoundData().answer of getFeed("WETH") × 10^(18 − its decimals)`, exactly,
with the decimals read on-chain (8 here) and WETH's own decimals asserted to be 18.

Recorded separately, as data and not as the control (`wiredVsRaw` in the control record): does the
wrapper's answer equal the raw ETH/USD aggregator's answer at the block? At both blocks: **yes**,
both 196558018952 (8 decimals). `proofs/moonwell/PASS-RULE.md` still words the WETH control as
"the ETH/USD answer × 10^10"; it was not edited (it is the pre-registration). At these two blocks
both readings give the same number, so the control's result does not depend on the wording.

The cbETH **reference** still comes only from the two raw Chainlink aggregators, never a wrapper,
with `decimals()` read on-chain and required to be 8 and 18 (otherwise the reference is recorded as
not measured, under `notMeasured["refUsd1e18:cbETH"]`).

The stablecoin control covers USDC, USDbC, DAI and USDS. EURC is a touched market but a euro coin,
so a 0.95–1.05 **USD** band does not apply to it; it is left out on purpose.

## Guard for Level 2: the fork must really be before the proposal

`assertPreExecution(fork)` in `runners/evm/control.ts` checks that `getFeed("cbETH")` is the old
feed `0xB0Ba…` and that cbETH reads above 1e21 (USD 1e18). Tested on real forks: at 42194662 it
passes (feed `0xB0Ba…`, 2.2067e21); at 42194663 it throws "fork is not pre-execution: getFeed("cbETH")
is 0x6799…, not the pre-proposal feed 0xB0Ba…". Level 2 will call it before applying anything.

## What the run records

Per market read: `feedAddress`, `feedDecimals`, `feedDescription` (`null` when it reverts),
`tokenDecimals`, raw `getUnderlyingPrice`, and `priceUsd1e18` (via `src/units.ts`), in
`result.measured` as `<field>:<symbol>` and in the `price_read` trace event. The control record
(fork chain id and block, WETH, wrapper vs raw, each stablecoin) is in the `control_matched` trace
event. If the control fails, `controlPassed` is false and `notMeasured.control` holds the reasons,
so every verdict on the run is "can't check" (tested offline).

## What it proves

- At block 42194663 Moonwell's oracle reported cbETH at ≈ $1.12 while ETH/USD × cbETH/ETH at the
  same block gave ≈ $2,206.68; one block earlier it reported the reference value exactly.
- The control passed at both blocks: the fork is Base at the asked block, WETH matched its wired
  feed exactly, and four USD stablecoins read about $1 after the units conversion.
- A sealed 2200 USD bet is judged `not_matched` by plain code against this run.

## What it does not prove

- Nothing about "before shipping": this is a re-run after the fact. Level 2 (applying the
  proposal on the fork one block earlier) is a later task.
- That the WETH wrapper always serves the raw round: it did at these two blocks only.
- The PR's code hash: Level 1 reads chain state only; `codeSha256` in these files says so in words.
  The PR files are fetched and hashed by D03-04.
- The aggregator call count (the "multiply gear" trace): not done here.
