# Atlas

Know what your AI-written code does before you trust it.

## Test me (about 3 minutes)

<!-- DAMI: draft wording. Finish it with /stop-slop and /copywriting before it goes public; the final strings are yours. -->
<!-- DAMI: confirm this address and the invite-code line after the Fly deploy. -->
**Online, nothing to install:** open **https://atlas-dami.fly.dev** and enter the invite code from the submission form.

1. **Meta's AI explains the file.** The page opens on an example drawn as a machine, one box per function. Above the drawing, Muse Wonder (Meta's AI) says in plain words what the file is for and what goes in and comes out. "What each part does" opens one line per box. These are the AI's words, labelled so, not a check.
2. **You and Meta's AI bet.** Read the one question, pick an answer and press **Lock in my bet**. Muse Spark and Muse Spark Open answer the same question from the same text, summary included. For the example their answers were recorded on Nov 2 and are labelled so.
3. **The sandbox decides.** Atlas runs the code and the machine plays what really happened. Your bet shows **matched**, **didn't match** or **can't check**, with each AI's mark beside it. Press **Share proof card** to get the card.
4. **Your own code.** Press **Try your own code** and paste any JavaScript, TypeScript or Python file. No file handy? Press one of the samples under the paste box (a fetch with retry, a price parser, a cached lookup). From here the calls are live: Meta's AI explains the file, writes a test, and bets with you.
5. **A real case (optional).** At the foot of the page, open **Demos: Moonwell**: a saved replay of a real oracle setting on a Base fork. It needs no key and costs nothing.

**On your own machine** (Node 25 or newer, and pnpm; on older Node the local sandbox cannot block the network):

```sh
git clone https://github.com/damli40/atlas.git && cd atlas
pnpm install
cp .env.example .env   # put your Meta API key after META_API_KEY=
pnpm dev:all
```

Then open http://localhost:5173.

- **No Meta API key?** You can still draw any file and open the Moonwell replay. The tests and the AI bets need the key.
- `BASETEN_API_KEY` is optional. It adds Muse Spark Open as a second AI bettor. Who bets is under **More options for this bet**.
- The local server answers only this machine (127.0.0.1).
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

**Limit of this claim:** the loop has completed once inside real Muse Code 1.4.14. Muse made the edit itself, the server re-judged the same sealed bets, and every answer matched on the first re-run (`tests/evidence/L2/README.md`). It was one run, the build agent typed as the person, and the 3-try stop has not yet run inside Muse.

If the plugin's program stops, `last-error.log` in Muse's data folder for the plugin says what happened. Rounds are saved there too, so restarting Muse in the same folder can continue the round, as long as the Atlas server still holds it.

Atlas cannot prove that you typed the words. The agent could pass them without you, and the plugin only lowers that risk (see `tests/evidence/L1/README.md`).
