# D03-05: dump-state spike (1-hour box)

Date: 2026-10-27 (WAT)

**Result: no.** `anvil --dump-state` after a Level 1 read, then `anvil --load-state` with no
`--fork-url`, does **not** reproduce D03-03's reads. The RPC fork stays the only replay path;
nothing was made default.

Plain words: anvil (the local copy of Base) fetches each contract's code and storage from the
remote node the first time a read needs it and keeps it in a cache. The question was whether
"save state to a file" includes that cache, so a replay could run with no network. It does not:
the file holds the block settings and almost no accounts.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/dump-state-spike.ts 42194663 tests/evidence/D03-05 )` | `summary-42194663.json`, `forked-reads-42194663.json`, `loaded-reads-42194663.json` | not identical |
| a one-off probe (not committed): fork at 42194663, run the control, then call `anvil_dumpState` over RPC | printed `control true anvil_dumpState hex length 1318` | same: about 650 bytes of state |

From `summary-42194663.json`:

- State file after the forked run: **2,158 bytes** (all of Moonwell, Chainlink and the tokens would be far larger).
- Forked run: control passed, every read present (1.4 s).
- Loaded run (no network): it reports chain id 8453 and block 42194663, but every contract call
  returns empty: `underlying()` on MOONWELL_WETH "returned no data (0x)", the same on the four
  stablecoin markets and cbETH, and the reference's `decimals()` too. Control did not pass.
- `identicalByteForByte: false`.

## A safety note this spike found

A loaded state looks like the right chain at the right block (chain id and block number match)
while holding none of the contracts. Atlas's control catches it (the WETH read fails, so
`controlPassed` is false and every verdict would be "can't check"), so it fails safe. But a chain
id plus block number check alone would not have caught it.

## What it proves

- With Foundry 1.8.6 defaults, neither `--dump-state` on exit nor `anvil_dumpState` includes the
  accounts fetched from the fork, so a no-network replay of Level 1 from them is not possible.

## What it does not prove

- Other routes were not tried inside the box: `--preserve-historical-states`, warming the state by
  copying each touched account with `anvil_setCode` / `anvil_setStorageAt`, or pointing anvil's
  `--fork-url` at a local cache. Any of these might work; none is needed for the demo while the
  RPC fork works.
- Speed: the forked runs used anvil's disk cache under ~/.foundry/cache (warm), which is why they
  take about 1.4 s.
