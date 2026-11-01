# The real Moonwell run, round 4 (2026-11-01)

Driven through the new shell with `tests/evidence/R3/moonwell-real.mjs`: Demos, the Moonwell pull request, Run it again, Show the question, Seal, Run it on a fork of Base. Real Muse Spark 1.3 and Muse Spark Open bets, a real Base fork at block 42194662, against a local server. It reads `BASE_RPC_URL` from `~/.config/atlas/rpc.env` since this round.

| | |
|---|---|
| The person's bet (the driver's) | $2,200 |
| The run read | 1 cbETH = $1.12 |
| Muse Spark 1.3 | $2,206.68, didn't match |
| Muse Spark Open | $1.123, matched |
| Pull request read, then question, sealed, finished | 7 s, 10 s, 13 s, 18 s from the page opening |
| Proof file | `mcmqYUk3lI.atlas.json`, passes `verifyAtlasFile` |

**Limits.** One run, so it says nothing about how often the models answer this way. The $2,200 bet is the driver's, not a person's. The 18 s is on this machine with a warm RPC; the page still says 30–90 s.

**Why there are two runs.** The first (`no-models/`) was made with `ATLAS_SPEND_CEILING_USD=1`, but that ceiling counts everything already in the usage log ($9.23), so both models were refused and it cost $0. The fork run itself worked. The second allowed $1 more than the log and is the one above.
