# Atlas

Know what your AI-written code does before you trust it.

## Test me (about 3 minutes)

**Online, nothing to install:** open **https://atlas-dami.fly.dev**. The example on the first screen plays with no code (steps 1 to 3). For your own files, press **Try your own code**, enter the judge code from the submission's project description and press **Use this code**. The paste box opens with three sample files under it: that is step 4. The judge code has its own budget, so visitors without a code never use up your limits. Press **Back to the example** under the paste box to return to steps 1 to 3.

1. **Meta's AI explains the file.** The page opens on an example drawn as a machine, one box per function. Above the drawing, Muse Wonder (Meta's AI) usually says in plain words what the file is for, and "What each part does" opens one line per box. Atlas labels these as the AI's words, not a check. Atlas asks Wonder for each part's role, never for how a run ends: you bet on that.
2. **You and Meta's AI bet.** Read the one question, pick an answer and press **Lock in my bet**. Muse Spark and Muse Spark Open answer the same question from the same text, summary included when there is one. For the example, their answers were recorded on Nov 2, and the page says so.
3. **The sandbox decides.** Atlas runs the code and the machine plays what happened. Your bet shows **matched**, **didn't match** or **can't check**, with each AI's mark beside it. Press **Share proof card** to get the card.
4. **Your own code.** Press **Try your own code** and paste a JavaScript, TypeScript or Python file. No file handy? Press one of the samples under the paste box: a fetch with retry, a price parser or a cached lookup. From here the calls are live. Meta's AI usually explains the file, writes a test and bets with you. Click any box to bet on that part, and once your bet is locked, ask Muse Wonder about a part.
5. **A real case (optional).** At the foot of the page, open **Demos: Moonwell**: a saved replay of a real oracle setting on a Base fork. It needs no key and costs nothing.

**On your own machine** (Node 25 or newer, and pnpm; on older Node the local sandbox can't block the network):

```sh
git clone https://github.com/damli40/atlas.git && cd atlas
pnpm install
cp .env.example .env   # put your Meta API key after META_API_KEY=
pnpm dev:all
```

Then open http://localhost:5173.

- **No Meta API key?** You can still draw any file and open the Moonwell replay. The tests and the AI bets need the key.
- `BASETEN_API_KEY` is optional. It adds Muse Spark Open as a second AI bettor. You choose who bets under **More options for this bet**.
- The local server answers this machine only (127.0.0.1).
- Tested on macOS only.

"Matched" means the code did what you bet in this one test. It does not mean the code is correct.

Built Oct 27 to Nov 4, 2026. PRE-EXISTING.md lists what existed before.

## Open-weights mode

Atlas can ask Muse Spark Open, Meta's open-weights model served by Baseten (`meta-models/muse-spark-open-1026`), to bet beside Muse Spark 1.3 or instead of it. The page has a toggle for this ("Who bets with you"). The server reads the `x-atlas-claimant` header: `spark` (the default), `spark-open` or `both`. In `both`, each model gets the same prompt and seals its own bets before the run. The screens show counts per bettor only (matched, didn't match, can't check).

Muse Spark Open needs a Baseten API key (`BASETEN_API_KEY`). Without one, the toggle shows "Muse Spark Open: not available (no Baseten access on this server)" and Atlas shows no score for it. `ATLAS_SPARK_OPEN=off` turns it off.

## The retry loop in the Muse Code plugin

After `/atlas` runs your code, one of your answers may not match. Atlas can't know which you want: the code, or your answer. If you want your answer, type `my answers are what I want`. You make this choice; the coding agent passes your words along, and the plugin accepts nothing else.

Muse then edits the file. The `atlas_rerun` tool re-reads the file, re-hashes it and runs the same test with the same seed. The server judges the same sealed bets. Nothing gets sealed again, and no model bets again.

The server allows 3 re-runs per round. After the third miss, Atlas stops and hands back to you with what each try measured. It also stops when your invite's budget runs out or when a whole run is "can't check". The proof file records each try, and `verify` re-judges all of them.

**You review the change.** "Matched" means the code did what you bet on in this one test. An edit that deletes or hard-codes the behaviour under test can also match, and plain code can't tell. So each try shows its size and its changed lines, and Atlas makes no claim that the code is now right.

**Limit of this claim:** the loop has completed once inside real Muse Code 1.4.14. Muse made the edit itself, the server re-judged the same sealed bets, and every answer matched on the first re-run (`tests/evidence/L2/README.md`). That was one run, the build agent typed as the person, and the 3-try stop has not yet run inside Muse.

If the plugin's program stops, read `last-error.log` in Muse's data folder for the plugin. Atlas saves rounds there too, so you can restart Muse in the same folder and continue the round while the Atlas server still holds it.

Atlas can't prove that you typed the words. The agent could pass them without you; the plugin lowers that risk (see `tests/evidence/L1/README.md`).

## Pictures of your code in the Muse Code plugin

Type `/atlas-draw <file> [function]` in Muse Code, or ask Muse for "a picture of <file> with Atlas". The `atlas_draw` tool sends that one file to your Atlas server, which draws it with the same plain code as the web page. You get the machine (one box per function, pipes where one calls another, loops, waits, throws, returns) for up to 8 parts and the box chart past that. Past 16 parts, for very long names, or when the picture would be too big to send, you get the parts as a list in words. The plugin writes the picture into your project at `.atlas/drawings/<file>-<short fingerprint>[-<function>].svg`. Naming a function marks it as where a call starts.

**SVG or PNG:** the hosted Atlas server returns SVG only; open the `.svg` in a browser. A server with the optional PNG converter (`@napi-rs/canvas`, a dev dependency, so a local `pnpm server` has it) also returns a `.png`, which the plugin writes and hands to Muse as an image.

Nothing runs, and no AI draws the picture. It shows the code's shape, not what the code does. `names: true` asks Muse Wonder (Meta's AI) for short names on the lids: one paid call per file, each name marked with a star and labelled as its words, not a check. Each invite code gets a set number of drawings an hour (`ATLAS_DRAWINGS_PER_CLIENT_PER_HOUR`, default 60).

Muse Code 1.4.14 shows a PNG as a "1 image" line, not as pixels, and passes it to its model, which can describe it (`tests/evidence/R13/README.md`). That costs model tokens in a paid session. The web page has no link to a drawing yet: it draws a file when you paste it there.
