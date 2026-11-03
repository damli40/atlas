# R11: "Bet on a function" from the repo outline left the bet panel blank

**Where to look first:** `1-before-fix/5-bet-panel.png` (the bug: drawing and summary on the right, an empty left column, no button), then `2-after-fix/5-bet-panel.png` (the same click after the fix: the question and "Lock in my bet"), then `3-cant-check/5-bet-panel.png` (a file that needs a sibling file: one sentence saying why it can't be checked, and "Edit this file").

## The bug, in plain words

A tester opened "Repo outline (early)", clicked the "Finding score calculation" box, then "Bet on computeScore". The machine and Muse Wonder's summary drew in about 30 s, but the bet panel on the left stayed empty for minutes, with no error anywhere.

**Root cause:** the first screen is the example, and its bet opens by itself (R7). The bet panel has an "open" switch. Reading a new file reset everything about the round (tests, answers, results) **except that switch**. So a file handed over from the outline arrived with the panel already open, but with nothing in it: no test asked for, nothing loading, no error. While the panel is open the "Bet on what it does" button is hidden, so there was nothing to press either. It stays that way forever.

It was not a slow load and not the import. `score.ts` imports `../types.js` with `import type`, which disappears before the code runs, so Atlas reads and runs the file normally (`/paste` answered `runnable: true`, no can't-check reason; log in `1-before-fix/log.txt`). Muse Wonder's test for computeScore was in fact ready 7 s after the hand-off (`← 200 /paste/proposals` at 37,104 ms); the page just never showed it.

The plain paste flow worked because "Try your own code" closes the bet first. Pasting over the example while its bet is open (paste-anywhere) took the same broken path.

## The fix (`web/screens/Studio.tsx`)

1. **A new file starts with the bet closed.** `read()` now closes the panel along with the rest of the round. The hand-off lands with "Bet on what it does" on screen, as X2 designed it, with the line saying Muse Wonder is already writing a test.
2. **An open bet panel can no longer be empty.** If nothing else would show (no wait, no test, no list, no error), it says "No test is being written for computeScore yet. Ask Muse Wonder for one, or write your own." with both buttons. No path is known to reach it after fix 1; it is there so that any future path ends in a sentence, not a blank.

## A file that needs a file Atlas didn't load

This already worked, and still does: a file with a real (run-time) import of a sibling gets one sentence instead of the bet, for example "the code needs ./lz-config.js; Atlas runs one pasted file on its own, with no packages or other modules", plus "Edit this file" (`3-cant-check/5-bet-panel.png`, sentinel.ts → getWatchlistHealth). The outline's card also warns before the click ("… imports ./lz-config.js …; a run of it may only say can't check"). The bug above did not affect this path: the sentence is drawn outside the bet panel.

Known blemish, not fixed: in that screenshot the can't-check banner sits over the top of the summary area. Pre-existing layout, unrelated to this bug.

## drift.ts drawn as three overlapping boxes

**Intended by the current rules, not a bug, and not changed.** drift.ts has 1,150 lines. The outline rule (`src/outline/verify.ts`, and the same words in Muse Wonder's prompt, `server/meta/roles/outliner.ts`) says a part's range over 400 lines must be the whole file, and parts may overlap. So when Wonder wants a "big picture" part for drift.ts it must take lines 1–1150, and any smaller parts it names inside the file are drawn as extra boxes on the same lines. That reads like three files. Changing it means changing the prompt or the verifier (for example: drop a whole-file part when smaller parts of the same file exist), which moves recorded outlines and their tests. Not small, not safe in this round. In my three outline runs Wonder drew drift.ts as one box each time, so I could not screenshot the three-box case.

## Tests

- `tests/unit/r11-outline-bet.test.tsx` (new, 2 tests, real React screen + real in-process server, models mocked, $0):
  - **regression:** the example's bet opens by itself, then a hand-off of the tester's `score.ts` arrives. The bet panel must not be open-and-empty, the button must be there, and pressing it must fill the panel. **Fails on the old code** ("expected true to be false" on the blank check), passes with the fix.
  - a `score.ts` with a run-time `import { SEVERITIES, type Finding } from "../types.js"` shows the sentence "…needs ../types.js; Atlas runs one pasted file on its own…" and no empty panel.
- `tsc --noEmit`: clean (`tsc.txt`, empty).
- Full vitest: **167 files passed, 2 skipped; 2,732 tests passed, 35 skipped, 0 failed** (`vitest.txt`). No timing flakes this run.

## How the screenshots were made

`outline-bet.mjs` drives a real browser (1280×800): first screen (the example's bet opens) → "Repo outline (early)" → upload six files from github.com/damli40/oft-sentinel `backend/src/services/` (score, drift, chain-registry, multicall, sentinel, snapshot-store; `types.ts` is not in that folder) → walk the boxes with the arrow keys to the one offering `Bet on <FN>` → click it → watch the bet panel, pressing "Bet on what it does" if it shows. Every API request and answer is logged with its time (`log.txt` in each folder).

Real server and page: `ATLAS_INVITES_DIR=<empty dir> ATLAS_USAGE_PATH=<scratch> PORT=18991 pnpm exec tsx server/index.ts`, `ATLAS_API_PORT=18991 pnpm exec vite --port 18992 --strictPort`, then `PW=<playwright-core> CHROME=<headless shell> BASE=http://localhost:18992 [FN=…] node tests/evidence/R11/outline-bet.mjs <out> <files…>`.

| Folder | Code | What it shows |
|---|---|---|
| `1-before-fix/` | d8a63b2 | computeScore: panel open and empty from 34 s to the end of a 125 s watch (`panel: {"popOpen":true,"popText":""…}`) |
| `2-after-fix/` | this commit | computeScore: button shown at once, pressed, Wonder's wait shown, question ready 8 s later |
| `3-cant-check/` | this commit | sentinel.ts getWatchlistHealth: the can't-check sentence |

## Spend

**$0.7284**, 10 paid calls, all appended to `tests/evidence/usage/usage.jsonl`: 3 outline calls ($0.620: $0.231, $0.192, $0.196), 5 other Muse Wonder calls logged as "investigator" (names, summaries and computeScore's tests; $0.095), 2 bettor calls ($0.014). The example on the first screen spent nothing (recorded answers). Under the $1.00 cap. The three outlines were one per browser run; reusing one job across runs was not possible from the page.

## Not done

- The three-box drift.ts outline: explained above, not changed, not reproduced.
- No test reaches the new "nothing is being asked" sentence: no path to it is known after the fix.
- Not re-run in the phone layout.
- Starting the real server printed "deleted 26 leftover sandbox folder(s) from runs that were cut short". That is its normal start-up clean-up of the shared sandbox temp folder; if another Atlas server was running a sandbox at that moment, its folder could have been among them.
