# D03-02: anvil fork wrapper, price reads, units

Date: 2026-10-27 (WAT)

Plain words: `runners/evm/anvil.ts` starts a private copy of Base on this machine (an anvil
"fork") at a chosen block and always kills it afterwards. `runners/evm/reads.ts` reads prices
from that local copy only. `runners/evm/moonwell-base.ts` holds every address, each with its key
in Moonwell's public `chains/8453.json` at the MIP-X43 merge commit `9a6738e1…`.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; pnpm exec tsx tests/tools/evm-read-check.ts 42195500 tests/evidence/D03-02/reads-42195500.json )` | `reads-42195500.json` | fork at 42195500, chain 8453, control matched |
| same env, `pnpm exec vitest run tests/unit/evm-reads.test.ts tests/unit/pass-rule-order.test.ts --reporter=verbose` | `test-output.txt` | 11 passed |
| `pnpm test` with no RPC in the environment | `full-suite-no-rpc.txt` | 262 passed, 8 skipped (the RPC tests skip, they do not fail) |

Acceptance values at block 42195500 (all read on the fork):

- Control: `getUnderlyingPrice(MOONWELL_WETH)` = 1964111776590000000000; ETH/USD answer 196411177659 × 10^10 = 1964111776590000000000. Equal, exact.
- USDC: token decimals 6; raw price 999900000000000000000000000000 (about 1e30); normalised by `src/units.ts` to 999900000000000000 = $0.9999, inside 0.98–1.02.
- Feed decimals read on-chain: ETH/USD aggregator 8, cbETH/ETH aggregator 18.
- cbETH (for D03-03, not judged here): oracle feed `0x6799…495D`, 18 decimals, price 1122662744874806300 ≈ $1.1227, the same number as the cbETH/ETH ratio.

## A fact the plan had slightly wrong

The plan expected WETH to be "wired straight to ETH/USD". It is not: `getFeed("WETH")` at this
block is `0xeb083d23…1547`, the ETH/USD **OEV wrapper** (`CHAINLINK_ETH_USD_OEV_WRAPPER` in
chains/8453.json), not the raw aggregator `0x7104…`. The control still matched exactly here because
the wrapper served the same round. At another block a wrapper can lag a round; then the control
fails, and every verdict on that run becomes "can't check". It fails safe (no wrong number), but
the control can fail for a reason that is not a bug. Worth knowing before D03-03.

Also: both OEV wrappers answer `description()` ("ETH / USD", "CBETH / ETH"), so `null` was not needed here.

## Safety of the secret

- The RPC URL is passed to anvil as a command-line argument (anvil has no environment variable
  for it), so it is visible in this machine's process list while a fork runs. It is never logged:
  anvil's output is kept in memory with the URL, its path and its host replaced, and appears only
  in an error message. A test starts anvil with a fake URL that cannot connect and checks the
  error text does not contain the fake token.
- `reads.ts` refuses any URL that is not `http://127.0.0.1` or `localhost`.

## What it proves

- A fork at block 42195500 can be started, read and stopped; no anvil process was left behind
  (also after an error inside the fork, and `pgrep anvil` was empty after the runs).
- The WETH control matches exactly at this block; the units conversion turns USDC's 1e30-scale
  raw price into about $1, so a USD bet is compared with dollars, not with the raw number.
- On-chain decimals of the two raw feeds are 8 and 18, as the reference method assumes.

## What it does not prove

- Anything at the Moonwell blocks 42194662 / 42194663: that is D03-03 and later.
- That the control holds at every block (see the wrapper note above).
- Speed: the first fork took about 11 s, a repeat about 1.3 s, because anvil caches fetched state
  under ~/.foundry/cache. A cold machine will be slower.
- That killing on SIGKILL of the test runner itself cleans up: an exit hook kills forks on normal
  exit, Ctrl-C and SIGTERM, but nothing can run when the parent is SIGKILLed.
