# R6: natural names on the machine, and a panel for each part

Dami found the machine's function names confusing: the code was written by an AI, so its names were unfamiliar. R6 does two things.

1. **Natural names.** Meta's AI (Muse Wonder) gives each drawn part a short name for what it is for ("price lookup", "retrying fetch"), in one call per file. Plain code checks every name (1 to 4 words, letters only, no judging words like "safe" or "bug"). The name sits on the part's lid in grey italic with a small star, over the exact function name in code type. A name that fails the check, or doesn't fit, leaves the lid with plain code's own words (the name split at its capitals) or the exact name alone.
2. **A panel per part.** Clicking a part (or Enter on it) opens a panel over the left column: whose words the name is, the exact name, plain sentences from the machine's facts (loops, waits, throws, returns, calls, called by, lines), then the code. After a run, the ringed part's panel also says what broke, in words the result already shows. Hover only marks a part.

Runs are on the real page with every model mocked ($0), except the two recording calls below. Numbers are from one machine.

**Where to look first:** `panel/3-panel-fetchWithRetry-1280.png` (the panel), `panel/5-panel-ringed-example-1280.png` and `panel/7-panel-ringed-orders-1280.png` (the ringed part's panel, ring still visible), `panel/3-panel-fetchWithRetry-390.png` (the phone sheet), `panel/6-proof-1280.png` (the proof card: real names only).

| File | What it shows | How to run it again |
|---|---|---|
| `panel.mjs`, `panel/`, `panel/results.json` | The lids, the panel by click and by keyboard, Esc, hover, the ringed part, the phone sheet, the bettors' text, the proof picture. Every "never covers" line is measured from the page's boxes | `PW=… CHROME=… BASE=… node tests/evidence/R6/panel.mjs <out>` |
| `truth.txt`, `truth/` | `tests/evidence/R5/truth.mjs` rerun with natural names present: what is red, what is ringed, which threads ran | `PW=… CHROME=… BASE=… node tests/evidence/R5/truth.mjs <out>` |
| `visual.txt`, `visual/` | `tests/evidence/R5/visual.mjs` rerun | same, `visual.mjs` |
| `ring-shots.txt`, `ring-shots/` | `tests/evidence/R5/ring-shots.mjs` rerun: the ring lands where it did in R5 | same, `ring-shots.mjs` |

The page for all of these: `tests/evidence/U3/mock-server.ts` on port 18971 (it now also mocks the naming call with "mock … step" names) and `vite --port 18972` with `ATLAS_API_PORT=18971`, and the hourly limits raised as in `truth.mjs`.

## Results

- `panel.mjs`: 23 pass, 0 fail, 1 note (below).
- `truth.mjs`: 32 of 32 pass with names drawn. `visual.mjs`: 21 of 21 pass. `ring-shots.mjs`: the rings land on the same parts as R5 (the example on the fake fetchIt, orders on fetchPage's chute) at 1280 and 1440.
- Unit tests: `tests/unit/r6-panel.test.ts` (splitter, role word, lid fit, panel sentences: a function, a part with no loops or throws, a class, an unnamed default export, the ringed part) and `tests/unit/r6-names.test.ts` (the name check, the prompt holds no sentence or test, the bettors' text carries the same names, a refused name, names that arrive too late, the kept example, no model on the server, the proof picture byte for byte unchanged).
- The proof picture: drawn without name lines, so the same bytes with or without natural names (unit test), and on the page it holds no model words (`panel.mjs`).

## The example's names, recorded

Two real `muse-wonder-1.0` calls on the built-in example (both lines are in `tests/evidence/usage/usage.jsonl`):

1. $0.0045 (497 tokens in, 125 out): "price lookup", "retry with waits", "growing wait calculation", "timed pause helper". Two were too long for a lid at reading size, so those lids fell back to the exact name.
2. After the prompt asked for 16 characters or fewer: $0.0050 (519 in, 146 out): getPrice "price lookup", fetchWithRetry "retrying fetch", backoffMs "retry wait time", sleep "pause execution". These are kept in `src/example-names.ts` and pass the same check as any answer.

## Limits

- **Lids are small.** A lid holds two lines only when both are at least 13 px on the sheet (the size a name alone could already be), so the page's 11 px rule switches to the chart exactly when it did before. Names longer than about 16 characters fall back to the exact name alone on the lid; the panel still shows them. The sheet's smallest words went from 13.5 to 13.4 on the example.
- **The model's name may still mislead.** Plain code checks the form of a name, never whether it is true of the code. The screen marks it as Meta's AI's words, and the panel says "its words, not a check".
- **Late names.** A round's bettor text waits up to 20 s for names already asked for. If they come later they are never shown for that file in that session, so the screen and the bettors always match.
- **Phones show the box chart,** so the boxes there keep their exact names (no natural names), and after a run the ring is on the path drawing, which is not a part: there is no ringed part to click on a phone.
- **At 1024 px the orders file shows the box chart** (the 11 px rule, as before R6), so there is no machine ring to click there. Not tested: the panel on a machine at widths between 761 and 1279.
- The old small card that a click showed (R4's `machine.mjs` checks it) is gone where the panel takes the click; a pipe still shows it.
- While the panel covers the bet's questions, the digit keys still answer the hidden question.
- Names arrive with no pencil-in animation: the lid words simply appear.
