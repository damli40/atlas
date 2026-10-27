# D04-00: Level 2 pre-flight at block 42194662

Date: 2026-10-27 (WAT)

Plain words: Level 2 replays MIP-X43's oracle changes on a copy of Base taken one block before the
proposal ran (block 42194662). The proposal points Moonwell's oracle at 14 "OEV wrappers" (small
contracts that pass a Chainlink price through). If a wrapper did not exist yet at that block, the
replay would point the oracle at an empty address and every later number would be meaningless.
This check reads, before anything is applied: does each of the 14 wrapper addresses hold contract
code at 42194662, and is the oracle's `admin()` the TemporalGovernor (the only account allowed to
call `setFeed`)?

The 14 wrapper addresses are not typed in by hand. `runners/evm/apply.ts` parses the uncommented
`_oracleConfigs[BASE_CHAIN_ID].push(OracleConfig(A, B, C))` lines in the PR's
`ChainlinkOracleConfigs.sol` and looks up `A + "_OEV_WRAPPER"` in the PR's `chains/8453.json`
(both are the byte-for-byte copies in `contracts/lib/moonwell/`, checked by D03-04).

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/level2-precheck.ts tests/evidence/D04-00/precheck.json )` | `precheck.json` | passed: 14 wrappers (13 distinct), none without code; admin = `0x8b62…7d51` |
| same env, `pnpm exec vitest run tests/unit/evm-apply.test.ts --reporter=verbose` | `test-output.txt` | 8 passed (7 offline parser tests + the fork pre-flight) |

## Result

- Fork: chain id 8453, block 42194662 (the fork's own block number equals the block asked for).
- All 14 wrapper addresses have code at 42194662; each holds 14,686 bytes. USDC and USDbC use the
  same wrapper (`CHAINLINK_USDC_USD_OEV_WRAPPER`), so there are 13 distinct addresses.
- `admin()` of the oracle `0xEC94…a9d0` = `0x8b621804a7637b781e2BbD58e256a591F2dF7d51`, the TemporalGovernor.
- So the plan's fallback (section 5.5) is not needed: Level 2 can run at 42194662.

## What it proves

- The wrappers the PR's files name were deployed before the proposal executed, so `setFeed` at
  42194662 points at real contracts.
- The account Level 2 will impersonate is the oracle's admin at that block.

## What it does not prove

- That a wrapper answers a price at 42194662 (code present is not the same as a working read):
  D04-02 reads every market after applying.
- That the deployed wrapper code equals any source in the PR (the PR does not hold wrapper source).
