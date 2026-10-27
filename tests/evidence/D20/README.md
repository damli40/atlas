# D20: the Moonwell change, replayed "in theory"

Date: 2026-10-27. Decision D20 (Dami): make the Moonwell change-and-replay work in theory, and label it.

## In plain words

Both models proposed pointing cbETH at the feed named `cbETH_ORACLE`. The real proposal can only wire
"OEV wrapper" contracts (`<name>_OEV_WRAPPER`), and the pull request's address book has no
`cbETH_ORACLE_OEV_WRAPPER`. So before D20 this was "no usable change". The address book DOES hold
`cbETH_ORACLE` itself. In the new, separately named mode `theoretical-direct-wire`, Atlas wires that address
directly on the fork, and every place the replay appears says:

> In theory: Atlas wired cbETH_ORACLE directly; the real proposal would first need a new cbETH_ORACLE_OEV_WRAPPER contract deployed.

This shows what the change would do on the chain. It does not show how the real proposal would behave.
No address is invented: a name with neither entry is still "no usable change".

## Where to look first

`live-output.txt`. The live round, real Base fork at block **42194662** (one block before the proposal ran):

| | Before the change (run hhFxiKOUHg) | After the change (theoretical replay) |
|---|---|---|
| cbETH price Moonwell reports | **$1.12** | **$2,206.68** |
| Reference (raw Chainlink ETH/USD × cbETH/ETH, same block) | $2,206.68 | $2,206.68 |
| Price sources counted by the call trace | 1 | **2** (the gear appears in the price pipe) |
| Control (WETH exact, stablecoins in band) | passed | passed |
| Person's sealed bet: $2,200 ±10% | didn't match | **matched** |
| Muse Spark's sealed bet: declined | can't check | can't check |

PASS-RULE.md replay lines, evaluated on this theoretical replay (about the replay, not the real proposal):
same block **matched**; 3a cbETH within 2% of the reference **matched** (0.0000%); 3b two price sources
**matched**.

So, in theory: wiring the composite feed directly gives the price the reference gives, from two feeds
multiplied. That is what the person expected.

## Files

| File | What it is |
|---|---|
| `live-replay.ts`, `live-output.txt` | The script and its output (RPC read at run time, never printed) |
| `d20.atlas.json` | The round's proof file with the change and replay; it verifies (mode, wired feed and captions recomputed) |
| `change-answer.json`, `replay-run.json`, `progress.txt` | The before / after answer, the replay run, the runner's steps |
| `change-screen.png` | The Change screen (real component, static page `change.html`): theory caption, diff, before / after, pass-rule lines labelled "in theory", the price pipe |
| `price-pipe-replay.png` | The price pipe for the replay (`pipe-replay.html`): multiply gear drawn, theory caption first |
| `proof-card.png`, `proof-card-after-rerun.png` | The real proof card from the running app (`?proof=hhFxiKOUHg`); after "Re-run it", both runs re-ran: "same result ✓ · same fork block 42194662" |
| `pages.tsx`, `shoot.mjs`, `browser-output.txt` | How the pages and PNGs were made, and what the browser read |

## How it was run

- No model was called. The change is Muse Code's real proposal from Oct 27 (`../D06-01/retry-evm/replay-evm.json`,
  attempt 1, `muse exec`, reported model `muse-spark-1.3`), taken out by the same `extractDiff` the Fixer uses.
- The sealed bets are the original ones (`../D06-01/retry-evm/run-evm.json`), never re-made.
- Plain code (`runners/change.ts planChangedConfig`) decides the mode: the proposal's own rule fails, the
  direct wire succeeds, so the Change records `mode: theoretical-direct-wire` and the wired feed. The EVM
  runner refuses a replay whose Change does not declare the mode plain code derives.
- Where the caption appears: the Change screen, the proof card, the `.atlas.json` captions, the price pipe's
  caption, the replay run's `replay_checks` event, and one log-strip line (POST /changes; covered by
  `tests/unit/d20-theory.test.tsx`).

## Limits

- The original round's `.atlas.json` was rebuilt from the stored POST /runs answer (same run, same bets,
  same verdicts; the person's line-42 finding; an empty agent log, so "the Investigator was not asked").
- The Change screen PNG is a static page from the real component, not a click-through of a live session
  (the live session would have needed a new round and new sealed bets). The proof card PNGs are the real app.
- The log-strip line was not captured live in a browser; a unit test checks it.
- Cost: $0 in model calls; RPC reads only (three forks: the replay, and the two re-runs behind "Re-run it").
