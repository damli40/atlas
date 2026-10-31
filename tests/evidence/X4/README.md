# X4: "how sure" and "something failed" (D56)

Date: 2026-10-31 (WAT) · branch `x4-felt` from main 8b7b21e · every model mocked, **$0** · local sandboxes only

## Where to look first

1. **The result on screen:** `screens/1366-light-1b-tapped.png` (the tap beside the seal button), `screens/390-light-2-marked.png` (the verdict's line), `screens/1366-light-3-record.png` (the record).
2. **Tampering:** `tests/unit/x4-felt.test.ts`, "X4 proof file", and `probe-tap-out-of-hash.txt`.
3. **Known limits**, below. Two of them are decisions for Dami: the 7-click case and what counts as a failure.

## What it does

- **One optional tap per round.** "How sure are you overall?" (sure / think so / guess) sits beside "Seal my answers". Nothing is preselected, and a second tap takes the answer back.
- **It can't change after the run.** The tap goes into the seal hash of each of the person's bets, so editing it no longer matches the hash shown before the run.
- **The verdict counts it.** "You said 'sure' and matched 1 of 4." The 4 is the answers plain code could compare with the run. Answers it couldn't compare are named separately, because counting them would make someone look further off than they were.
- **Each test gets a tag from its own spec, before it runs.** "Something failed" means a stand-in (a fake function Atlas passes in) or the fake network is scripted to throw, answer with an error status, or never answer. Otherwise "nothing failed". No model is involved, and it costs no clicks.
- **The record adds both.** It shows counts per level, with a percentage only at 10 or more rounds at that level. "When nothing failed you matched 6 of 7. When something failed, 2 of 7." stays hidden until each side has 3 answers Atlas could check, with a note saying so.

It makes no claim about understanding: a test bans those words from every sentence here, and the panel says a match can be luck.

## Results

| Check | Result | File |
|---|---|---|
| Full suite | 2,206 passed, 0 failed, 35 skipped (live tests needing keys) | `full-suite.txt` |
| TypeScript check | 0 errors | `tsc-output.txt` (empty) |
| Local-paths test and wording lint | pass (both are in the full suite) | `tests/unit/no-local-paths.test.ts`, `tests/unit/wording.test.ts` |
| Tests for this batch | 61 (server and plain code) + 5 (components) | `tests/unit/x4-felt.test.ts`, `tests/unit/x4-felt-ui.test.tsx` |
| Betting models' text and prompts, with and without the tap | byte-identical, for every model call in the round (D19) | "X4 (D19)" in the test file |
| Tap changed on one bet, on all bets, or removed, after the run | refused by verify | "X4 proof file" |
| Tap on a model's bet; two values in one round; marker removed | refused, even with the hash recomputed for the first two | same |
| All 15 proof files committed before X4 | still verify, with no marker | same |
| Probe: take the tap out of the hash | 4 tests fail, so the tamper tests do test the hash | `probe-tap-out-of-hash.txt` |
| Browser: axe (accessibility scan) | 15 runs, 0 violations (quiz, tap selected, verdict; 3 sizes, light and dark) | `browser-output.txt` |
| Browser: text overlap | 10 runs, 0 hits | same |
| Browser: 390 px | no sideways scroll, 4 of 4 | same |
| Every answer visible without scrolling, with the taller seal bar | pass at 1920x1080 and 1366x768 | same |

## Clicks from paste to verdict (limit 6)

| What the person does | Clicks |
|---|---|
| Fewest possible (open the bet, seal) | 2 |
| 3 answers and the tap | **6** |
| All 4 answers, no tap | **6** |
| All 4 answers and the tap | **7** |

**The last row is over the limit.** It only happens on a 4-question test when someone answers everything and also taps. Nothing makes them do either: the required path did not change. Getting it to 6 would mean removing a click somewhere else, so it is left for Dami to decide.

## Known limits

- **What counts as a failure is my reading of the brief.**
  - Running out of script (`then: "throw_exhausted"`) alone does not count, because only a run can show whether the code gets that far. So a test can be tagged "nothing failed" and still end in that throw.
  - "Error status" means a `status`, `statusCode` or `status_code` field of 400 to 599, or the words error / failed / failure / fail, at the top of a scripted value or directly under `response`. `{"ok": false}` does not count.
  - A failing step the code never reaches still counts, because the tag is about what the test sets up.
- **Moonwell and other chain runs get no tag.** The brief's rule would call them "nothing failed", because they have no stand-ins. That sentence would be false about a mispriced oracle, so they are left out, and the record says how many answers are left out.
- **The file alone can't catch a whole-round rewrite.** After the run the nonces (the random values in each hash) are public, so someone can edit the tap on every bet and recompute every hash, and verify passes. Comparing with the hash shown before the run catches it. The same is true of an edited answer, so this is not new. A test writes the limit down.
- **Records from before X4 have no tag and no tap.** They are outside both new lines, and the record says how many.
- **Small numbers.** The new lines are counts from one person, and a harder test can look like a worse result. The comparison says what happened on these tests, not why.
- **The older per-question lines keep their rule** (a percentage from n = 5). D56's 10-round rule is applied to the new lines only.
- **The tap can nudge how people bet.** The research note warns about this; nothing here measures it.

## Not done

- The tap is only on the drawing screen and the "Paste your own code" demo screen. The retry demo and Moonwell screens have no picker, so those rounds have no tap.
- The comparison line appearing was checked on the real server (`x4-felt.test.ts`, "from real rounds") and in components, not in a browser. The browser check covers only the hidden state.
- No real-model run, and no independent adversarial review.
- `docs/build/DECISIONS.md` and `pitch/VIDEO-INDEX.md` are untouched, as the brief says.

## For R3

The picker, the verdict's line and the record are in `web/screens/FeltPanel.tsx` with their own `felt.css`. They take plain data and import nothing from the drawing (a test checks this). `Studio.tsx` passes the line and the record through `BenchStage`'s `headnote` and `footnote` slots, so a new stage needs those two slots, or a place to render them. The picker is in the seal bar, which is outside the stage.

## How to run

```
PORT=18971 U3_WONDER_DELAY_MS=100 ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U3/mock-server.ts
ATLAS_API_PORT=18971 pnpm exec vite --port 18972 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=http://localhost:18972/ node tests/evidence/X4/drive.mjs <chromium> <outDir>
```
