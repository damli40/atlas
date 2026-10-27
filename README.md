# Atlas

Know what your AI-written code does before you trust it.

Work in progress: built Oct 27 – Nov 4, 2026. See PRE-EXISTING.md for what existed before.

## Open-weights mode

Atlas can ask Muse Spark Open, Meta's open-weights model, served by Baseten (`meta-models/muse-spark-open-1026`), to bet beside Muse Spark 1.3 or instead of it. The page has a toggle for this ("Who bets with you"). The server reads the `x-atlas-claimant` header: `spark` (the default), `spark-open` or `both`. In `both`, each model gets the same prompt and seals its own bets before the run. The screens show only counts per bettor (matched, didn't match, can't check).

Muse Spark Open needs a Baseten API key (`BASETEN_API_KEY`). Without one, the toggle shows "Muse Spark Open: not available (no Baseten access on this server)" and Atlas never shows a score for it. `ATLAS_SPARK_OPEN=off` turns it off.
