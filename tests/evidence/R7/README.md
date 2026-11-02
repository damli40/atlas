# R7: one flow for a brand-new person (D69)

Dami: "too many confusing buttons… I should just be able to see my code and make a bet to prove I understand… leave all other details in fine print." The council's decision, built on branch `r7-simple`. Nothing was deleted: every hidden control is one fold away and still works.

**Where to look first:** `shots/1-first-screen-1280.png` (what a new person sees), `shots/3-result-1280.png` (the verdict and the two AI marks), `shots/6-fine-print-bet-1280.png` and `shots/4-fine-print-more-1280.png` (the fine print opened), then the `390` versions.

## What changed, in plain words

1. **The first screen is the example, already drawn, with one question ready.** No "Draw the example" click and no "Bet" click. The headline stays above the question. Under it, in small print: the consent line (unchanged, always visible), "Try your own code" (which opens the paste box, Upload and GitHub; pasting anywhere still works), "More options for this bet", and "ⓘ Details".
2. **One question, picked by plain code.** The round opens on Atlas's default test (Muse Wonder's first allowed test). The server keeps only one question for that round (`src/quiz.ts` `oneQuestion`): "how it ends" (returns, throws, never finishes, still running) when the test has it, else the first question. Why that one: every run has an ending, so any answer but "can't tell" is judged matched or didn't match; it is also the question the result already leads with when it is missed (D64), and it never asks for a count or a time. The server cuts the questions **before** the bettors' text is written, so the person and both AIs get exactly the same one question (D19; `tests/unit/r7-one-question.test.ts` checks the models' prompts). The button says "Lock in my bet".
3. **Both Meta models bet by default** where the server can ask Muse Spark Open; if it can't, Spark Open drops out quietly (no "did not bet" line on the result; the reason is still under "More options for this bet").
4. **The example's AI answers are recorded, and say so.** One real recording run (`record-example.mts`, 3 calls, $0.0312, lines in `tests/evidence/usage/usage.jsonl`): Muse Wonder's tests, then Muse Spark and Muse Spark Open betting on the one question, with nobody's answer in sight. The server replays a recorded bet **only** when the prompt it would send now is byte for byte the recorded prompt (its sha256), and then the slot carries `recorded: "2026-11-02"`. Any other text (all questions, a label from an earlier run, names left off) asks the model live, unmarked. On screen: "Also betting: Muse Spark's recorded answer (Nov 2) and Muse Spark Open's recorded answer (Nov 2)… Recorded on Nov 2 from this same text, before anyone answered. Not live." The result's marks and the proof card say the same. The example's run itself is a real sandbox run.
5. **The result:** "Your bet: matched / didn't match / can't check" in large type with its shape (filled tick, open cross, dashed square), so colour is never the only signal; each AI's labelled mark under it; one button, "Share proof card"; three text links: "Try another question", "Try your own code", "Try the Moonwell example". Everything else (Change the code and bet again, Bet on another test, Play the run again, Test this claim, Next things to try, the felt record, the trace note, the weakest count) is under "More".
6. **The proof card credits Meta's tools:** "Test written by Muse Wonder · bet by Muse Spark (its answer recorded Nov 2) and Muse Spark Open (its answer recorded Nov 2)". Built by plain code from the proof file alone (`creditLine`).
7. **The bar:** the logo and "Your record". In small print at the foot: "Demos: Moonwell", "Agent log", "Repo outline (early)" (the codebase explorer; its route still works), "Earlier screens".
8. **Keys:** C (code), M (box chart), E, B and R answer only while their control is on screen. Esc, P (the visible proof card button), Enter and the bet's digit keys work as before.
9. **The remember loop** ("Last time…", the weakest kind of question, the count change) moved to fine print: "More options for this bet" before a bet, "More" after it. It is still the person's only; the proof card never has it (checked in `shots.mjs`).

## Measurements

**Visible clickable controls per screen**, counted on the page by `count.mjs` (buttons, links, folds' summaries, inputs; disabled ones and anything inside a closed fold left out). The machine's own parts are clickable too (they open the R6 panel); they are counted apart because they are the drawing, not controls around it. Models mocked, $0. Lists: `count/count-before.json`, `count/count-after.json`.

| Screen | Before (main 1314c62), 1280 | After, 1280 | Before, 390 | After, 390 |
|---|---|---|---|---|
| First screen | 9, and no question: 2 clicks to reach one | **15, and it is the bet**: 5 answers + "Lock in my bet" are the only full-size controls; the other 9 are small print (2 in the bar, 3 under the bet, 4 at the foot) | 8 | 15 (same) |
| The bet | 21 (question 1 of 3, a stepper) | the same 15 as the first screen: one question | 19 | 15 |
| The result | 15 | **12**: one button, three text links, "More", "Details", and the same bar and foot | 12 | 12 |
| Clicks from opening the page to a result | 6 on the example (Draw the example, Bet, 3 answers, Seal) | **2** (one answer, Lock in my bet); `tests/unit/u1-stage.test.tsx` holds it at 2 or fewer | | |

Before, the drawing on the first screen was the entry page's decoration (inert). After, it is the real machine: 16 to 18 parts can be clicked at 1280 (4 to 9 on a phone's box chart).

**What `shots.mjs` checks on the page** (42 of 42 pass, `shots.txt`, `shots/checks.json`): the question is there with no click; the headline and the consent line are visible; both AIs' answers say "recorded answer (Nov 2)" and "Not live"; the button says "Lock in my bet"; C and M do nothing while Details is closed; the example's default question lands on **didn't match** for "returns a value" (the run threw after 3 calls at 700 ms), never can't check; each AI's mark on the result is labelled recorded and dated; exactly one primary button, "Share proof card"; the three links are there; Change the code, Bet on another test and Play again are folded; E and B do nothing while More is closed; More shows them; the proof card says "Test written by Muse Wonder · bet by Muse Spark (its answer recorded Nov 2) and Muse Spark Open (its answer recorded Nov 2)"; no remember line on the proof card. At 1280 and at 390.

**The example lands on matched or didn't match.** The recorded test makes `fetchIt` always throw; the run throws `Error: flaky source failed` after 3 calls at 700 ms of simulated time. So every answer but "can't tell" is judged: "throws" matched, the other three didn't. Both recorded AIs said "throws".

## Files

| File | What it is | How to run it again |
|---|---|---|
| `record-example.mts`, `example-recorded.json` | The one recording run of the example (real calls) | `pnpm exec tsx tests/evidence/R7/record-example.mts <out.json>` (spends about $0.03) |
| `count.mjs`, `count/` | Visible clickable controls per screen, measured on the page, before (main 1314c62) and after | `PW=… CHROME=… BASE=… node tests/evidence/R7/count.mjs <out> before|after` |
| `shots.mjs`, `shots/` | The screenshots Dami asked for at 1280 and 390, with checks | `PW=… CHROME=… BASE=… node tests/evidence/R7/shots.mjs <out>` |
| `truth.txt`, `truth/` | `tests/evidence/R5/truth.mjs` on the new flow | `PW=… CHROME=… BASE=… node tests/evidence/R5/truth.mjs <out>` |
| `visual.txt`, `visual/` | `tests/evidence/R5/visual.mjs` | same, `visual.mjs` |
| `ring-shots.txt`, `ring-shots/` | `tests/evidence/R5/ring-shots.mjs` | same, `ring-shots.mjs` |
| `panel.txt`, `panel/` | `tests/evidence/R6/panel.mjs` | same, `R6/panel.mjs` |

The page for every driver: `tests/evidence/U3/mock-server.ts` (every model mocked, $0) on port 18991 and `vite --port 18992` with `ATLAS_API_PORT=18991`, with the hourly limits raised as in `truth.mjs`. On that mock the example's tests and bets are the recorded ones (the server replays them, no call).

## Test and driver results (final run)

- `tsc --noEmit`: clean (`tsc.txt`). `npx vitest run`: 163 files, **2,658 passed**, 35 skipped, 0 failed (`vitest.txt`). The two 50 ms timing tests did not flake on this run.
- Tests changed because they clicked controls that moved (no truth or parity test was weakened): `u1-stage.test.tsx` (the first screen is now the example with its question; one question, so one mark; clicks to a result now held at 2 or fewer, was 6), `d60-first-screen.test.ts` (the example now asks Muse Wonder 0 times, was 1). New: `r7-one-question.test.ts` (one question for every bettor, checked in the models' prompts; the recorded example asks no model and is marked recorded; any other text is asked live and is not marked; the proof card's credit line).
- Drivers on the new page, all passing: `truth.txt` 32 of 32, `visual.txt` 21 of 21, `panel.txt` 53 of 53, `ring-shots.txt` rings where R5 and R6 had them (example: on the fake `fetchIt`'s port; orders: on `fetchPage`'s chute), `shots.txt` 42 of 42.
- Driver changes, each keeping its check: open "Try your own code" before pasting; the example needs no "Draw the example" or "Bet" click; open "More" before Change the code, E, or the trace-note measurement; open "Details" before M; open "More options" before "How sure"; in `visual.mjs`'s cut-value check, ask every question so the typed-value question is still checked; in `panel.mjs`, the recorded test reads `fetchWithRetry(fetchIt, 3, 100)`.

## Fixes found while running the drivers

- The part panel under the verdict could sit on the taller action bar (R6 review M3). It now fits itself at once and again whenever the panel or the bar changes size.
- The folds ("More", "More options for this bet", "Details") opened on screen while the page's own state still said closed, so E did nothing after "More" was opened (orders file). The folds now open from the page's state, so the screen and the keys agree.
- "Try your own code" clicked while the example was still loading now cancels it.

## Limits and what was not done

- **Item 9, zooming the first view onto the function, was skipped.** The machine has no camera to move; building one and pulling back when the ink runs would take more than the hour allowed. The first view already draws the machine large (the R6 anatomy drawing).
- **"Try the Moonwell bug" became "Try the Moonwell example"**, and the foot says "Demos: Moonwell": the codebase's wording test refuses "bug" (Atlas never judges code). Dami may choose other words.
- **Paid-call lines are behind "Details"**, as asked. So "Try another question", "Try your own code" and, on your own code, "Bet on what it does" no longer say next to them that they start paid AI calls. "Try another question" on the example asks both AIs live (its text was not recorded). The consent line stays visible.
- **Only the example's first round is recorded.** Any change (all questions, another test, a label from an earlier run) is asked live and is not labelled recorded. If the bettors' text template ever changes, the recording stops matching and the example is asked live (unlabelled); `r7-one-question.test.ts` fails in that case, so it can't drift silently.
- The one-question rule picks the ending. On the example, Muse Wonder's flaw is about time (700 ms, not 300 ms); the ending question does not test that. It is behind "Answer more questions on this test".
- "Seal" is replaced on the main flow. The earlier screens (behind "Earlier screens") and the proof card's hash section ("Sealed before the run") keep "seal": the first are kept as they were; the second names the cryptographic seal.
- The AI line before the bet says "Muse Spark"; the result's marks say "Muse Spark 1.3" (the model's display name).
- A phone still shows the box chart, not the machine (R6's limit), and the first screen's question sheet covers the lower 58%.
- `pitch/VIDEO-INDEX.md` is not updated: this branch is unmerged and unreviewed.
