# Atlas

Know what your AI-written code does before you trust it.

## Test me (2 minutes)

<!-- DAMI: confirm this address and the invite-code line after the Fly deploy. -->
**Online, nothing to install:** open **https://atlas-dami.fly.dev** and enter the invite code from the submission form.

1. Click **Draw the example**. Atlas draws the file as a machine, one box per function.
2. Click **Bet on what it does**, answer the questions and seal your bets. Meta's AI seals its own bets on the same questions.
3. Atlas runs the code in a sandbox. Each bet shows **matched**, **didn't match** or **can't check**, and the drawing shows what ran.
4. Open **Demos → The Moonwell pull request**: a saved replay of a real oracle bug on a Base fork. It needs no key and costs nothing.

**On your own machine** (Node 22.13 or newer, and pnpm):

```sh
git clone https://github.com/damli40/atlas.git && cd atlas
pnpm install
cp .env.example .env   # put your Meta API key after META_API_KEY=
pnpm dev:all
```

Then open http://localhost:5173.

- **No Meta API key?** You can still draw any file and open the Moonwell replay. The tests and the AI bets need the key.
- `BASETEN_API_KEY` is optional. It adds Muse Spark Open as a second AI bettor.
- Tested on macOS only.

"Matched" means the code did what you bet in this one test. It does not mean the code is correct.

Work in progress: built Oct 27 – Nov 4, 2026. See PRE-EXISTING.md for what existed before.

## Open-weights mode

Atlas can ask Muse Spark Open, Meta's open-weights model, served by Baseten (`meta-models/muse-spark-open-1026`), to bet beside Muse Spark 1.3 or instead of it. The page has a toggle for this ("Who bets with you"). The server reads the `x-atlas-claimant` header: `spark` (the default), `spark-open` or `both`. In `both`, each model gets the same prompt and seals its own bets before the run. The screens show only counts per bettor (matched, didn't match, can't check).

Muse Spark Open needs a Baseten API key (`BASETEN_API_KEY`). Without one, the toggle shows "Muse Spark Open: not available (no Baseten access on this server)" and Atlas never shows a score for it. `ATLAS_SPARK_OPEN=off` turns it off.

## The retry loop in the Muse Code plugin

After `/atlas` runs your code, one of your answers may not match. Atlas does not know which you want: the code, or your answer. If you want your answer, type `my answers are what I want`. Only you can choose this; the coding agent passes your words along and the plugin accepts nothing else.

Muse then edits the file. The new `atlas_rerun` tool re-reads the file, re-hashes it, and runs the same test with the same seed. The server judges the same sealed bets. Nothing is sealed again and no model bets again.

The server allows 3 re-runs per round. After the third miss, Atlas stops and hands back to you with what each try measured. It also stops when your invite's budget runs out or when a whole run is "can't check". The proof file records each try, and `verify` re-judges all of them.

**You review the change.** "Matched" means the code did what you bet on in this one test, nothing more. An edit that deletes or hard-codes the behaviour under test can also match, and plain code cannot know that. So each try shows its size and its changed lines. Atlas never says the code is fixed.

**Limit of this claim:** the loop has never completed inside real Muse Code. It has run live only over the plugin's real MCP program, with scripted edits (`tests/evidence/L1/README.md`). That stays true until Dami's filmed take.

If the plugin's program stops, `last-error.log` in Muse's data folder for the plugin says what happened. Rounds are saved there too, so restarting Muse in the same folder can continue the round, as long as the Atlas server still holds it.

Atlas cannot prove that you typed the words. The agent could pass them without you, and the plugin only lowers that risk (see `tests/evidence/L1/README.md`).
