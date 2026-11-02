# R5: the machine tells the truth, the cold test, the remember loop, the wow

Runs on real code in the real sandbox. Models are mocked ($0) unless a line says otherwise. Numbers are from one machine.

**Where to look first:** `hero-machine.mp4` (the film), `shots/picture-1280.png` (the shareable picture), `truth/` (what is red and what is ringed, case by case), `truth-on-2859dab.txt` (the same cases failing on the old code).

| File | What it shows | How to run it again |
|---|---|---|
| `truth.mjs`, `truth/` | Through the machine view: which part is red, what is ringed, which threads ran, which dial moved | `PW=… CHROME=… BASE=… node tests/evidence/R5/truth.mjs <out>` |
| `truth-on-2859dab.txt` | That driver against the code before the fix: 11 lines fail, then the two-caller case stops it, because that code has no machine there | Same driver, page served from 2859dab |
| `coldtest.mjs`, `coldtest/` | Each cold test item on the real page | Same, plus `BASE_LIMIT=` a page whose server has `ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1` |
| `wow.mjs`, `shots/` | Pencil-in, the ring, the shared picture, the remember loop | Same as truth.mjs |
| `machine/` | `tests/evidence/R4/machine.mjs` rerun: both sizes, accessibility, paste-to-picture time | `AXE=… node tests/evidence/R4/machine.mjs <out>` |
| `wonder-aim.mts`, `wonder-aim.json` | Muse Wonder's tests with and without a person's weak spots. Four real calls, a few cents | `pnpm exec tsx tests/evidence/R5/wonder-aim.mts <out.json>` |
| `hero-machine.mp4` | The film, from the real app | `tests/evidence/R3/film.mjs`, then ffmpeg |

## Numbers

- **Files that draw as a machine:** 11 of 11 realistic files of 5 to 8 parts pass the router and audit. 10 of 11 stay at reading size at 1280 and 1440. The other, one function calling seven, gets the chart. These files were written for the measure, so this is a check, not a survey (`tests/unit/r5-routing.test.ts`). The latency file is rebuilt from the cold tester's chart.
- **Paste to picture:** first marks 30 to 65 ms on the dev server, six pastes.
- **Wonder and weak spots:** told the person was weak on timing, its tests did not visibly change: two calls with, two without, on one file. Too few to prove no effect, enough to not claim one.

## Limits

- The missing bettors in the cold test were reproduced by lowering the hourly limit. The server keeps two such limits: 20 model rounds an hour per address, and 10 per session. Each paste's early Muse Wonder call also takes one of the 20. The server log of that session does not record refusals, so this is the cause that fits, not one read from its log.
- Wonder's sentence fix is checked on the prompt's words. No real call was made to confirm the letter "Y" no longer appears.
- A Python comprehension's call is lit from the separate traced run. If that run is too slow or differs, the part stays dark and no thread is drawn.
