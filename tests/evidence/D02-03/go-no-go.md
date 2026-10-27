# D02-03: model go/no-go

Written by `tests/tools/go-no-go.ts` (plain code) at 2026-10-27T04:56:35.305Z. Each row is decided by the rule in its "Check" column.

| Model | Where | Check | Result | Detail | Cost |
|---|---|---|---|---|---|
| `muse-wonder-1.0` | api.meta.ai | 1 live investigator-style call, 8-line input; GO if schema-valid JSON | **GO** | schema-valid JSON, 3 finding(s), finish_reason stop | $0.022932 |
| `muse-spark-1.3` | api.meta.ai | cites D02-02b (5 live Claimant calls); GO if at least 4/5 schema-valid | **GO** | 5/5 schema-valid (tests/evidence/D02-02b/claimant-5-runs.jsonl); no new call | — |
| `meta-models/muse-spark-open-1026` | Baseten (endpoint path UNVERIFIED) | 1 live call if a key exists; GO only if schema-valid | **pending** | pending: no Baseten key on this machine (credits not yet claimed); open-weights mode shows "not available" | — |

Costs are upper bounds where the price is unverified (Spark, Baseten); every real call's usage line is in `tests/evidence/usage/usage.jsonl`.

## Fallback chain (from the build plan, D02-03)

- Wonder fails → Spark investigates.
- Spark fails → Wonder claims.
- Both fail → D0 option B shape: human bets only, still live runs.
- Spark Open not available → the open-weights mode switch shows "not available"; never faked.
