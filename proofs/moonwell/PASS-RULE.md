# Moonwell MIP-X43: pass rule (written before any run)

This file is a pre-registration: it fixes, before Atlas forks Base even once, what Atlas will
check, at which blocks, against which numbers, and what counts as a match. It is committed on
its own, ahead of any EVM run, so the git history shows the rule came first and was not fitted
to the results. A test in this repository checks that order.

Plain words first: Moonwell is a lending market on Base. Its price oracle (the contract that
tells the market what each token is worth in US dollars) was re-wired by governance proposal
MIP-X43. Atlas replays that re-wiring on a local copy of Base (a "fork": a private chain that
starts from Base's real state at a chosen block) and reads the prices the oracle then reports.

## What is being tested

- Code: pull request moonwell-fi/moonwell-contracts-v2 #578, "Add MIP-X43: Activate OEV wrappers
  for all remaining markets", at merge commit `9a6738e189fa903bffa0abf10b9dd7ed2fe73a18`.
- Chain: Base, chain id 8453.
- The proposal executed on Base in block 42194663 (timestamp 1771178673, 2026-02-15 18:04:33 UTC),
  transaction `0xd26baf29dcba7bf66db4be17b46a49bb4dacca41ace968c98c8a5b09a03ae812`, emitting 14
  `FeedSet` events.
- A fork "at block N" holds the state after block N.
  - **Level 2 ("before ship")**: fork at block **42194662**, one block before the proposal ran.
    Atlas applies the proposal's oracle-feed actions itself, then reads.
  - **Level 1 ("after the fact")**: fork at block **42194663**, the block in which the proposal
    ran. Atlas only reads. A Level 1 result is a re-run after the fact and is never described
    as caught before shipping.

## Addresses (Base, from `chains/8453.json` in moonwell-contracts-v2 at the merge commit)

| Name | Address |
|---|---|
| Moonwell ChainlinkOracle | `0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0` |
| Oracle admin (TemporalGovernor) | `0x8b621804a7637b781e2BbD58e256a591F2dF7d51` |
| `MOONWELL_cbETH` market | `0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5` |
| `MOONWELL_WETH` market (control) | `0x628ff693426583D9a7FB391E54366292F509D457` |
| Chainlink ETH/USD aggregator (8 decimals) | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` |
| Chainlink cbETH/ETH aggregator (18 decimals) | `0x806b4Ac04501c29769051e42783cF04dCE41440b` |
| cbETH feed before the proposal (`cbETH_ORACLE`) | `0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5` |
| cbETH feed set by the proposal (`cbETHETH_ORACLE_OEV_WRAPPER`, 18 decimals) | `0x67996D1ff7a3711a91E2839d1059Fcb950C0495D` |

Markets whose feed the proposal changes on Base (14): DAI, USDC, USDbC, cbETH, AERO, cbBTC, EURC,
WELL, USDS, tBTC, VIRTUAL, MORPHO, cbXRP, MAMO.

## The bet

- Question: "After this proposal is applied, what will Moonwell's oracle report for 1 cbETH, in USD?"
- Unit: USD. A bet in any other unit (for example the cbETH/ETH ratio) is refused, not judged.
- Human and model bets are sealed (hashed and shown) before the run starts.
- **Tolerance: 10% of the observed value.** A bet matches when
  |observed − bet| ≤ 10% × observed. The tolerance is measured against what the code reported,
  never against the bet.

## The reference price (plain code, same block)

`reference = ETH/USD answer × 10^(18 − 8) × cbETH/ETH answer / 10^18`, in USD with 18 decimals.

- Both answers come from the raw Chainlink aggregators listed above (`latestRoundData()`), read
  at the same fork block as the price being checked.
- Both feeds' `decimals()` are read on-chain and must be 8 (ETH/USD) and 18 (cbETH/ETH). If either
  differs, the reference is recorded as not measured.
- Never from an oracle wrapper (a wrapper can serve a delayed round), never from an off-chain
  price service.

## The rules

1. **Flag rule.** Atlas surfaces cbETH when its post-apply price differs from the reference by
   more than **50%** of the reference.
2. **False-alarm rule.** No other touched market may be surfaced if its post-apply price is within
   **2%** of its pre-apply price read at the same fork block.
3. **Replay rule.** After a proposed change, the same experiment at the same block must read cbETH
   within **2%** of the reference, and the number of distinct aggregators whose `latestRoundData`
   is called while pricing cbETH must be **2** (two feeds multiplied).
4. **Controls.**
   - WETH, exact: `getUnderlyingPrice(MOONWELL_WETH)` must equal the ETH/USD answer × 10^10 at
     the same block, with no tolerance.
   - Stablecoins: the normalised price of each stablecoin market lies between 0.95 and 1.05 USD
     (catches a decimals mistake even when pre and post agree).
   - If any control fails, every verdict on that run is "can't check" and the run is not published.

## Wording

The outcome is stated only as: the bets **matched** / **did not match** what the code did, or
**can't check**. Atlas does not call the proposal wrong. It shows what the code reported and whose
expectation matched it.

## What Level 2 does not do

Level 2 applies only the proposal's oracle-feed actions on Base (`setFeed(symbol, wrapper)` from
the oracle admin, for the 14 pairs derived from the pull request's own files). It does not apply
the proposal's other actions (Morpho wrapper upgrades, mToken whitelists, fee updates).
