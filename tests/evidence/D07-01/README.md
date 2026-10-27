# D07-01: open-weights mode (Muse Spark Open on Baseten)

Date: 2026-10-27 (WAT) · `mida` not run · nothing written to `proofs/` (proofs kept in memory, copied here as `round-<n>.atlas.json`).

## Where to look first

- **Baseten works.** Model `meta-models/muse-spark-open-1026` answered every call: go/no-go row is now **GO** (`tests/evidence/D02-03/go-no-go.md`).
- **Fixture S3, 3 rounds, both models:** Muse Spark and Muse Spark Open each bet calls 5, totalWaitMs 12,000, outcome throws, every round. The run measured exactly that. **18 of 18 model bets matched** (9 per model).
- **Moonwell Level 2, both models:** **both declined** in the round where both calls went through (round 5). Both verdicts are **can't check**. The run read cbETH at $1.12 (control passed, fork block 42194662).
- **Round 4 (the first Moonwell try):** Muse Spark's call failed with a network error ("fetch failed"), so it had no bet; Muse Spark Open declined. Kept as it happened. Round 5 is the re-try.
- **Cost of this task:** Meta **$0.0741** (4 Spark calls, price unverified, logged as an upper bound) · Baseten **$0.0210** (6 calls) plus a $0.0002 first probe. Caps were $0.50 and $3.

## The endpoint (checked live, 2026-10-27)

| | |
|---|---|
| Endpoint | `POST https://inference.baseten.co/v1/chat/completions` (OpenAI-compatible Model API) |
| Model id | `meta-models/muse-spark-open-1026` (`GET /v1/models` lists it and `meta-models/muse-spark-open`) |
| Auth | `Authorization: Api-Key <BASETEN_API_KEY>`. Baseten's docs say `Bearer` works too; Atlas sends `Api-Key`, the one the live check used. Docs: https://docs.baseten.co/reference/inference-api/chat-completions |
| Billing | Per token, no dedicated deployment (nothing to start or scale). |
| Price | $1.25 input, $0.15 cached input, $4.25 output per 1M tokens. Source: https://www.baseten.co/library/muse-spark-open (read 2026-10-27; OpenRouter lists the same). |
| Answer shape | Same as Meta's API: `choices[0].message.content`, `finish_reason`. |
| Reasoning | Visible: `choices[0].message.reasoning_content` holds a short thought. Atlas never reads it. Reasoning tokens are counted in `completion_tokens` and billed as output. |
| Usage fields | `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`. |
| JSON mode | `response_format: {type: "json_object"}` and `reasoning_effort: "low"` were accepted. |

First probe (outside the client, so not in `usage.jsonl`): HTTP 200 in 6.9 s, 151 prompt tokens (128 cached), 30 completion (15 reasoning), about $0.0002.

## The bets vs what was measured

"You" here is **the driver script**, not a person: the same fixed bets every round, chosen before any run (calls 3, totalWaitMs 3,000, outcome throws; Moonwell $2,200).

| Round | Question | You (script) | Muse Spark 1.3 | Muse Spark Open (via Baseten) | The code (measured) |
|---|---|---|---|---|---|
| 1–3 fixture S3 (each) | calls | 3 · didn't match | 5 · matched | 5 · matched | 5 |
| 1–3 fixture S3 (each) | totalWaitMs | 3,000 · didn't match | 12,000 · matched | 12,000 · matched | 12,000 |
| 1–3 fixture S3 (each) | outcome | throws · matched | throws · matched | throws · matched | throws |
| 4 Moonwell L2 | cbETH USD | $2,200 · didn't match | no bet (network error) | declined · can't check | $1.12 |
| 5 Moonwell L2 | cbETH USD | $2,200 · didn't match | declined · can't check | declined · can't check | $1.12 |

The declines, word for word:
- Round 4, Muse Spark Open: "unknown: no oracle price data provided and cannot infer post-proposal cbETH USD price without running fork"
- Round 5, Muse Spark: "unknown: no access to fork oracle state to determine cbETH USD price"
- Round 5, Muse Spark Open: "unknown: oracle price depends on on-chain state after proposal execution not provided"

Judged by `src/judge.ts` (plain code). Every seal re-hashed in the browser: ✓ for all bets on both cards.

**Same prompt for both models (D18, D19):** in every round the two models' messages had the same SHA-256 (`prompts.json`, `live-summary.json` → `samePrompt`: identical in all 5 rounds). Token counts differ because the tokenizers differ (Moonwell: 3,379 for Spark, 3,512 for Spark Open).

## Cost, call by call

From `tests/evidence/usage/usage.jsonl` (lines from 10:53 to 10:56 UTC):

| Who | Calls | Dollars |
|---|---|---|
| Muse Spark Open, go/no-go row (investigator check) | 1 | $0.004029 |
| Muse Spark Open, bets (3 fixture + 2 Moonwell) | 5 | $0.016799 |
| Muse Spark 1.3, bets (3 fixture + 1 Moonwell) | 4 | $0.074088 (upper bound: Spark's price is unverified) |

Spark's failed round-4 call returned no usage, so its cost is unknown (it may have been billed).

## What this proves

- Atlas can ask Meta's open-weights model through Baseten, with the same client function, and every call's usage is logged with `provider: "baseten"`.
- With the header `x-atlas-claimant: both`, both models seal their own bets on the same experiment before the run, from an identical prompt, and plain code judges both.
- On the fixture both models' bets matched the run, every time (3 rounds). On Moonwell both declined when asked with only what a person sees (D19).

## What this does not prove

- Not that either model is better: on these 4 experiments their results were the same counts.
- Not a general accuracy figure: 3 runs of one scenario and 1 usable Moonwell round.
- Round 4 does not show Spark declining: its call failed on the network.
- The proof-card and verdict PNGs are static pages drawn by the real components from the round files (`pages.tsx`), not screenshots of the running app.

## Mistake on the way (fixed)

The first pass stopped before the Moonwell round asked any model: the script sent the whole PR answer (with file texts) as the experiment's `target`, and the server refused it (HTTP 413, body over 64 KB). The script was fixed to send only ref and fingerprint, and the Moonwell round was run with `--moonwell-only`. No model was called by the failed request.

## Files

| File | What |
|---|---|
| `live.ts` | The driver: the real HTTP app in process, real client, real runners, header `both`. |
| `live-output.txt` | Console output of the three passes (fixtures, Moonwell try, Moonwell re-try). |
| `live-rounds.json` | Every round: slots before and after the run, each bettor's bet, measured value, verdict, rationale. |
| `live-summary.json`, `prompts.json` | Spend by provider; SHA-256 of each model's prompt per round. |
| `round-1..5.atlas.json` | Each round's .atlas.json, as the server kept it. |
| `pages.tsx`, `shoot.mjs`, `*.html`, `browser-output.txt` | Static pages and the PNG capture (headless Chromium). |
| `proof-card-fixture.png` | Round 1 proof card: scoreboard and the counts table You · Muse Spark 1.3 · Muse Spark Open (via Baseten). |
| `proof-card-moonwell.png` | Round 5 proof card: two can't checks, script didn't match. |
| `verdict-fixture.png` | Round 1 Verdict screen: one column per bettor and the seal check. |

Unit tests: `tests/unit/open-weights.test.tsx` (mocked fetch and chat): Baseten routing and Api-Key auth, key and auth header never in a usage line or reason, provider "baseten" usage line with cached pricing, no-key path makes no request, header parsing, "both" from identical prompts, unavailable path on `/claimants` and in the slot, the toggle's words, three columns and counts.
