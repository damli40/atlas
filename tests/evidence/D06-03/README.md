# D06-03: proof card, .atlas.json download and "re-run it"

Date: 2026-10-27 (WAT) · Base RPC loaded at runtime (never printed) · model calls off · `mida` not run.

## Where to look first

- **Both cards replay to the same result.** "Re-run it" on each card called `GET /replay/:id` with the
  page's session header:
  - fixture `eRopGsrp2a`: same seed `tFjD64Wn2K`, `measuredEqual: true`, `resultDiff: []`, 210 ms.
  - Moonwell PR #578 Level 2 `mwTaxvHFzB`: same fork block 42194662, `measuredEqual: true`, `resultDiff: []`,
    control passed, about 4–5 s (anvil fork).
  The card printed "replayed: same result ✓" both times ([`browser-output.txt`](browser-output.txt),
  [`replay-check.txt`](replay-check.txt) from curl).
- **Both files validate** with `src/atlasfile.ts` ([`validate-output.txt`](validate-output.txt)). They are the
  D04-04 example files, not regenerated: they still verify with today's code.
- **Captions come from the file:** fixture shows the pre-existing label; Moonwell shows the Level 2 caption and
  "the cbETH line was picked by a person; the Investigator pointed elsewhere". A test drops that caption from
  the file and the card stops showing it.
- **Wording:** no "fixed / wrong / correct" on either card (browser check + test).

## What the card shows (all read from the .atlas.json)

Scoreboard as the Atlas mark with "who · outcome" per bettor (model id `muse-spark-1.3` visible), a row per
bet (bet, what the code did, outcome), target and code fingerprint, seed or fork block, the control (TS: matched
before the run, control run id; EVM: WETH read equals its feed, 4 of 4 stablecoins in band before and after, read
from the run's trace), the captions, every sealed hash re-hashed in the browser (✓, or ✗ when a field was edited),
"judged by src/judge.ts", a download of the exact file, and "Re-run it". A run whose control did not match shows
the `src/trust.ts` sentence instead of the scoreboard and values.

Open it at `?proof=<runId>`; every finished round links to its card.

## Files

| File | What it is |
|---|---|
| `card-fixture-1080p.png`, `card-moonwell-level2-1080p.png` | 1920×1080, after "Re-run it"; the whole card fits one screen |
| `card-fixture-390.png`, `card-moonwell-level2-390.png` | 390 px, full page, no horizontal scroll |
| [`browser-output.txt`](browser-output.txt), [`drive.mjs`](drive.mjs) | card text, captions, re-run results |
| [`replay-check.txt`](replay-check.txt) | `GET /replay` answers (replay run body left out) |
| [`validate.ts`](validate.ts), [`validate-output.txt`](validate-output.txt) | both files valid |

## Limits

- The card trusts the server's copy of the file for its facts; the browser re-hashes each bet, and `/replay`
  re-verifies the whole file before it runs, but the card does not run `verifyAtlasFile` itself (that module
  reads the Moonwell copy from disk).
- Model names show as ids only (`muse-spark-1.3`), not "Muse Spark 1.3".
- The PNGs show a replay made while capturing; the card itself says "recorded <time>", never "live".
