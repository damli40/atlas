# D04-01: MIP-X43's oracle-feed actions, derived from the PR files by plain code

Date: 2026-10-27 (WAT)

Plain words: before Atlas can replay the proposal, it needs the exact list of changes the proposal
makes to Moonwell's price oracle on Base. Atlas does not ask a model for that list and does not
copy it from the real transaction. It reads the pull request's own files the way the proposal's
code does, and only afterwards compares the result with what really happened on Base.

How the proposal builds the list (`mip-x43.sol`, `_wireCoreFeeds`, lines 207-232 at the merge commit):
for each config `(A, B, C)` in `ChainlinkOracleConfigs.sol`, it calls
`setFeed(ERC20(addresses[B]).symbol(), addresses[A + "_OEV_WRAPPER"])`. The key is the token's
`symbol()` read on-chain, **not** the text B. `runners/evm/apply.ts` follows that code:

1. Parse the uncommented `_oracleConfigs[BASE_CHAIN_ID].push(OracleConfig("A", "B", "C"))` lines.
   The push and the `OracleConfig(...)` sit on separate lines; comments (`//` and `/* */`) are
   removed first, with string literals left alone. A Base push in any other shape throws.
2. Look up `A + "_OEV_WRAPPER"`, `B` and `C` in the PR's `chains/8453.json`. A missing name throws.
3. On a fork at 42194662, read `symbol()` of the token at `addresses[B]`.

The real list: the 14 `FeedSet(address feed, string symbol)` events the oracle emitted in tx
`0xd26baf29…ae812` (block 42194663), fetched once from the transaction receipt and stored as test
data in `tests/oracle/mipx43-feedset-42194663.json`. Atlas never derives anything from that file.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/fetch-feedset.ts tests/oracle/mipx43-feedset-42194663.json )` | `tests/oracle/mipx43-feedset-42194663.json` | 14 FeedSet events, block 42194663, tx status success |
| same env, `pnpm exec tsx tests/tools/level2-derive.ts tests/evidence/D04-01/derived-vs-real.json` | `derived-vs-real.json` | derived 14, real 14, **set equal: yes**; 0 only-derived, 0 only-real |
| same env, `pnpm exec vitest run tests/unit/evm-apply.test.ts --reporter=verbose` | `test-output.txt` | 10 passed |

## Result: 14 of 14 matched

| Config line | Config B (token name) | `symbol()` on-chain | Wrapper |
|---|---|---|---|
| 28 | DAI | DAI | `0x4916…89a2` |
| 31 | USDC | USDC | `0x7600…236d` |
| 34 | **USDBC** | **USDbC** | `0x7600…236d` (same as USDC) |
| 41 | cbETH | cbETH | `0x6799…495D` |
| 54 | AERO | AERO | `0xdC79…Ef98` |
| 57 | cbBTC | cbBTC | `0x6a3c…E119` |
| 60 | EURC | EURC | `0xd566…cbEC` |
| 66 | **xWELL_PROXY** | **WELL** | `0xBA52…09db` |
| 69 | USDS | USDS | `0x6621…F405` |
| 72 | **TBTC** | **tBTC** | `0xBfAa…21ab` |
| 78 | VIRTUAL | VIRTUAL | `0x12EC…B6e3` |
| 81 | MORPHO | MORPHO | `0x0979…53F0` |
| 84 | cbXRP | cbXRP | `0xf2Ac…8d49` |
| 87 | MAMO | MAMO | `0xfbA8…120D` |

The derived order also equals the event order, though only set equality is required.

**Why following the code mattered:** in 3 of 14 rows the config's text is not the symbol
(USDBC, xWELL_PROXY, TBTC). A parser that used the text as the `setFeed` key would have produced 3
wrong pairs; a probe test shows exactly those 3 fail the comparison.

## What it proves

- Plain code over the PR's own files reproduces the proposal's 14 Base `setFeed` actions exactly,
  as a set, with the symbols read on a fork one block before execution.
- None of the 6 commented-out Base configs (WETH, wstETH, rETH, weETH, wrsETH, LBTC) leaks in.

## What it does not prove

- Nothing about the proposal's other Base actions (Morpho wrapper upgrades, mToken whitelists, fee
  updates): the parser reads only the oracle-feed configs.
- That the parser handles other Solidity shapes (e.g. configs built in a loop or from variables): it
  refuses those with an error instead of guessing.
