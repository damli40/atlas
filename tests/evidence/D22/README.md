# D22: chain facts before the bet, and one bet instruction

Date: 2026-10-27 (WAT) · nothing written to `proofs/` (proofs kept in memory, copied here as `round-<n>.atlas.json`).

## Where to look first

- **No model declined this time.** In 3 Moonwell Level 2 rounds ("both" mode), Muse Spark and Muse Spark Open each placed
  a dollar bet every round. Earlier Moonwell rounds recorded 15 model declines (plus one replay of a declined bet); they
  stay in `proofs/refusals/INDEX.md`, regenerated after these rounds and unchanged (no new can't-check).
- **Muse Spark Open matched 3 of 3.** It bet **$1.1226627448748063** each round; the run read cbETH at **$1.12**
  (exactly 1.122662744874806300). Its reason, round 3, word for word: "Config line 42 sets cbETH to cbETHETH_ORACLE which is
  the cbETH/ETH feed (1.12266e18) not USD; if wired directly as USD price the oracle will report ~1.12 instead of ~2206".
- **Muse Spark didn't match, 3 of 3.** It bet **$2,206.68** each round (the oracle's price before the proposal, which the
  facts show). Its reason, round 1: "OEV wrapper preserves underlying price; before price equals ETH/USD 1965.58 * cbETH/ETH
  1.12266 = ~2206.68, so after wrapping same."
- **Read this before using the result on camera.** One of the facts shown is the raw cbETH/ETH answer, 1122662744874806300.
  It is chain state before the proposal ran, so D22 allows it. But the proposal wires cbETH to that ratio feed, so the
  number the run reads is the same number. Spark Open did not see the run: it read line 42 and the facts, and worked it out.
  A sceptic can still say "the answer was on the screen". The person sees the same number, so the bet stays fair (D19).
  Also: the oracle's price before the proposal ($2,206.68, raw 2206683650838065175827) equals, to the last digit, the
  reference the judge compares against. That is a coincidence of this block, not a value taken from the run.
- **Fixture S3 unchanged:** both models bet calls 5, total wait 12,000 ms, outcome throws, and all 6 bets matched, the same
  as D07-01.
- **Cost: $0.128.** Meta $0.1074 (4 Spark calls; an upper bound, because Spark's price is not verified) and Baseten
  $0.0208 (4 Spark Open calls). 8 calls in all, no repair tries. The cap was $2.

## What changed

Plain words: before anyone bets on a Moonwell round, Atlas now reads a few facts from the chain, as it stood one block
before the proposal ran, and shows them to every bettor.

- `runners/evm/chain-facts.ts` opens a short-lived fork of Base at **block 42194662** and reads, with every call pinned to
  that block: the oracle's `getUnderlyingPrice` for the cbETH market (normalised to USD), `getFeed("cbETH")` and that
  feed's `description()`, the raw Chainlink ETH/USD and cbETH/ETH `latestRoundData` answers with `decimals()`, and the
  block's timestamp. It sends nothing to the fork. It refuses any other block, a fork whose head has moved, and a cbETH
  feed that is already the proposal's. It caches the answer per block: the 3 rounds above opened one fork for the facts
  (the first `POST /experiments` took 2.0 s; the next two took about 1 ms).
- `src/chain-facts.ts` turns the facts into lines, under the label **"Chain facts read by Atlas at block 42194662, before
  the proposal ran"**. It refuses facts from any other block. A Level 1 round (whose run forks at 42194663) still shows
  facts from 42194662.
- `src/bet-context.ts` puts those lines, and the line "How to bet: Give your best estimate in USD. Decline only if you
  cannot form any estimate at all; if you decline, say why.", into the one "what the bettor sees" text. The page renders
  it (the facts are also shown open, above the question); the server puts the same text in every model's prompt.
- `server/app.ts` reads the facts in `POST /experiments` (and in the Adversary's autonomous round) **before** asking any
  model, and returns them to the page in the same answer. If the read fails, everyone sees "Atlas could not read them
  (reason)". Tests that pass a stand-in runner get no facts unless they pass a stand-in reader.
- The Moonwell prompt's task now uses the D22 instruction instead of "If you do not know an answer, bet declined instead
  of guessing". The fixture prompt is unchanged.

## The chain facts shown (all 3 rounds, read once)

From `chain-facts-shown.txt` (the lines exactly as the screen and the prompts showed them):

```
Chain facts read by Atlas at block 42194662, before the proposal ran:
- Block 42194662 timestamp: 1771178671 (2026-02-15 18:04:31 UTC).
- Moonwell's oracle, getUnderlyingPrice(MOONWELL_cbETH 0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5), normalised: $2,206.68 per cbETH (raw 2206683650838065175827).
- The feed the oracle is wired to for cbETH, getFeed("cbETH"): 0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5, no description().
- Chainlink ETH/USD aggregator 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70, description "ETH / USD": latestRoundData answer 196558018952 with 8 decimals (1965.58018952).
- Chainlink cbETH/ETH aggregator 0x806b4Ac04501c29769051e42783cF04dCE41440b, description "CBETH / ETH": latestRoundData answer 1122662744874806300 with 18 decimals (1.122662744874806300).
Nothing after the proposal is applied is shown here.
```

The cbETH feed before the proposal (`0xB0Ba…`, `cbETH_ORACLE` in the PR's chains/8453.json) has no `description()`; the
screen says so instead of leaving the field blank.

## Each model's bet and verdict, per round

"You" is this script, not a person: fixed bets chosen before any run ($2,200 on Moonwell; calls 3, total wait 3,000 ms,
outcome throws on the fixture), the same as D07-01. Verdicts are by `src/judge.ts` (plain code), 10% tolerance.

| Round | Run | Muse Spark 1.3 (muse-spark-1.3) | Muse Spark Open (meta-models/muse-spark-open-1026) · via Baseten | You (script) | The code |
|---|---|---|---|---|---|
| 1 Moonwell L2 | `7hIZWPA7DY` | $2,206.68 · didn't match | $1.1226627448748063 · matched | $2,200 · didn't match | $1.12 |
| 2 Moonwell L2 | `BVw4a3vqLF` | $2,206.68 · didn't match | $1.1226627448748063 · matched | $2,200 · didn't match | $1.12 |
| 3 Moonwell L2 | `GeyY4SlMRr` | $2,206.68 · didn't match | $1.1226627448748063 · matched | $2,200 · didn't match | $1.12 |
| 4 fixture S3 | `YFTm3w1mqx` | calls 5, wait 12,000, throws · 3 matched | calls 5, wait 12,000, throws · 3 matched | 3, 3,000, throws · 1 matched, 2 didn't match | 5, 12,000, throws |

Every Moonwell run: fork block 42194662, control passed, reference $2,206.68. Each model's reason, every round, is in
`live-rounds.json` (`rationale`). Muse Spark's three reasons all say the OEV wrapper keeps the price the same; Muse Spark
Open's three all say line 42 wires the cbETH/ETH ratio feed, so the oracle will report about 1.12.

**Parity (D19):** for every Moonwell round the script rebuilt the screen's text from the HTTP answers alone (as
`web/screens/Moonwell.tsx` does) and checked that each model's prompt starts with exactly that text: true for both models
in all 3 rounds (`live-rounds.json` → `parity`). The two models' messages had the same SHA-256 in all 4 rounds
(`live-summary.json` → `samePrompt`). The full Moonwell prompt is `prompt-moonwell.txt`.

**Not tuned after seeing answers:** the D22 code and this script were committed in `1a24f64` at 12:59:29 UTC; the first
answer came back at 12:59:48 UTC. Nothing was changed after that, and each round ran once.

## Cost, call by call (tests/evidence/usage/usage.jsonl, 12:59:48 to 13:00:14 UTC)

| Who | Calls | Dollars |
|---|---|---|
| Muse Spark 1.3 (3 Moonwell + 1 fixture) | 4 | $0.033548 + $0.028688 + $0.030308 + $0.014896 = $0.107440 (upper bound) |
| Muse Spark Open via Baseten (3 Moonwell + 1 fixture) | 4 | $0.007467 + $0.004600 + $0.004834 + $0.003913 = $0.020814 |

The browser click-through in `tests/evidence/D21/playwright` mocked every model call ($0).

## Tests

`tests/unit/d22-chain-facts.test.tsx` (offline unless noted):
- parity in "both" mode: the real React bet screen and both models' prompts hold the identical facts, and after the run no
  run number is in any prompt;
- no post-apply value can enter: after a fake run with its own numbers, a second round (Level 1) in the same session gets
  the same facts, read once (one fork), and none of the run's numbers;
- block 42194662 only: Level 1 and Level 2 both ask for 42194662; the reader refuses 42194663, 42194661 and 42195500
  before opening a fork; the renderer refuses facts from 42194663; the fork read pins every call to 42194662 and refuses a
  moved head or the proposal's feed;
- a failed read is shown in words to everyone and is not cached;
- the Moonwell task carries the D22 instruction and no longer says "instead of guessing";
- with BASE_RPC_URL and anvil: the real read at 42194662 (pre-proposal feed, decimals 8 and 18, timestamp 1771178671,
  cached on the second read).

`tests/unit/bet-context.test.tsx` (D19) still passes unchanged: screen text equals prompt text.

## What this proves

- Every Moonwell bettor now sees the same facts from block 42194662, labelled, and the same instruction; the screen and
  both models' prompts were byte-identical in the live rounds.
- With those facts, both Meta models placed a bet instead of declining (6 of 6 Moonwell bets), and their reasons differ:
  Spark assumed the wrapper keeps the price, Spark Open read line 42 as wiring a ratio feed.
- Nothing from the run, and nothing after the proposal is applied, can reach the bettors' text (unit tests above).

## What this does not prove

- That the models would do the same on other blocks, other PRs or other days: 3 rounds, one block, one line.
- That Spark Open would find it without the raw cbETH/ETH answer on screen. It used that number; no round without it was run.
- That Muse Spark is "worse": it bet what the code would do if the wrapper were a pass-through. Atlas says only that its bet
  didn't match.
- The facts are not recorded inside each `.atlas.json` (the file format has no field for them). They are in this folder:
  `chain-facts.json`, `chain-facts-shown.txt`.

## Files

- `live.ts` (the driver), `live-output.txt`, `live-rounds.json`, `live-summary.json`, `prompts.json` (hashes),
  `prompt-moonwell.txt` (one full Moonwell prompt), `chain-facts.json`, `chain-facts-shown.txt`, `round-1..4.atlas.json`.
- `tsc-output.txt`, `gate-day1.txt`, `vite-build.txt`.
- Re-run: BASE_RPC_URL and GITHUB_TOKEN in the environment, `pnpm exec tsx tests/evidence/D22/live.ts` (spends real money).
