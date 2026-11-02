# R8: the run plays the real trace

Dami asked "the machine is static?" and chose "Run plays the real trace". Before R8, the first screen at 1280 had about 0.3 s of pencil-in and then nothing moving; during the run there was one red-ink pass and the ring. Now, after "Lock in my bet", the machine acts out what the code really did, one recorded step at a time: ink drops in at "starts here", each call to the faked part flashes its lamp and inks its pipe, the loop's hand wheel turns, the clock dial sweeps with "100 ms" beside it, the chute drops at the throw. A line under the machine says the step in plain words. Then the red ink, the ring and the verdict land exactly as before.

**Where to look first:** `frames/example-1-0.9s.png` to `frames/example-8-6.5s.png` (eight frames of the act at 1280, cut from `example-act.webm`), then `frames/orders-*.png` (the chute drops on `fetchPage` at the end), then the table below.

## What moves, and the recorded field behind it

Built by plain code in `renderer/authors/run-act.ts` from fields the run already recorded. Nothing new is measured, and no model is involved. If a field is missing for a run, that motion does not play.

| Motion | Recorded field that drives it | Plays only when |
|---|---|---|
| Ink drops into "starts here", the tested part's lamp lights | the run's trace has its `start` event | the tested function is drawn on the machine |
| A faked part's lamp bursts, **once per call** | one `stand_in_call` / `call` event in the sealed trace (the example: 3, the same as `calls:fetchIt`) | the fake is drawn as a port |
| That call's pipe inks, with the wet head running along it | the same event, plus the file's call sites (plain code) | only one function's own lines call that fake, so the true caller is known (the resting drawing already used this rule) |
| A helper's lamp lights and its pipe pulses | one step of the third traced run (`helpers.steps`, D61: names and order only) | the third run answered and matched the sealed run; else no helper step at all |
| The loop's hand wheel turns once | **Passes are not recorded.** It turns for each recorded call to a fake whose every call site sits inside that loop's lines (new: `loopSpans` from the parser), and only for the earliest such call in the loop body, so a pass with three calls turns it once | such a call exists. In the example: `fetchIt`, line 14, inside the loop on lines 12–19, so 3 turns for 3 calls. Helper steps never turn it (see Limits) |
| The clock dial sweeps, with "N ms" beside it | a gap between two recorded events on the virtual clock (the example: 100, 200, 400 ms; `clock_moves` says 100, 300, 700) | nothing but the code moves the clock (the test scripts no delay) and exactly one function that waits is known to have run: the rule the resting drawing already had |
| The chute drops (its red shows, a drop slides down it) | `measured.outcome` is `threw` and `endOfRun` placed the end on that chute (the same fact that makes it red at rest) | the end is placed on a chute. The example's end is on `fetchIt`'s port, so no chute drops there; orders.ts drops on `fetchPage`, line 9 |
| The caption under the machine | the same step's fields, in words: "call 2 to fetchIt: threw Error", "waits 200 ms", "threw Error at 1,400 ms, out of line 9" | always, one line per step |

What a run that lacks a field gets is written down by the same code (`Act.quiet`), for example: "No chute drops: plain code could not place the throw on one chute", "The loop wheel stays still: passes are not recorded, and no recorded call sits only inside the loop's lines", "No helper lamps or pipes: Helper order is not shown: …".

## Timing

- Real time is about 3 to 6 s whatever the virtual time: `n × 330 ms`, kept between 3,000 and 6,000 ms. No step is shorter than 250 ms. Half the spare time is shared evenly; half goes to waits in proportion to their virtual ms, so "waits 400 ms" stays on screen longer than "waits 100 ms" (`actTimes`).
- A long run folds its middle so it has at most 24 steps. A folded step says the exact counts ("steps 7–18: fetchIt 6 times, 6 waits (1,200 ms)"). In a folded step a fake flashes once, not once per call (see Limits).
- Any key or click skips to the end state (the page's existing skip). "Play the run again" (R), still under "More" where R7 put it, plays the act again.
- With reduced motion nothing moves: the end state shows at once, and the steps are listed as text in the result column ("What the run did, step by step (14)").
- The box chart (phones, windows too small for 11 px words, more than 16 parts, or M) keeps today's story unchanged. No new motion there.

## Measurements (1280 × 800, headless Chrome 145, models mocked, $0)

| File | Steps | Act, first caption to last | Playing to verdict | Worst frame during the act | Worst frame overall | Motions seen on the page |
|---|---|---|---|---|---|---|
| Example (`fetchWithRetry`) | 14 | 4.3 s | 5.2 s | **17.7 ms** (p95 17.2) | 33.6 ms | 3 wheel turns, 3 lamp bursts, dial labels 100 / 200 / 400 ms |
| orders.ts (`fetchAllOrders`) | 13 | 4.0 s | 4.9 s | **17.8 ms** (p95 17.3) | 17.8 ms | 4 lamp bursts, dial 200 / 400 / 800 ms, chute drop, no wheel turn |
| plan_cache.py (`get_user_plan`) | 4 | 2.5 s (4 steps × 750 ms) | 3.5 s | **17.6 ms** (p95 17.2) | 17.6 ms | dial 500 ms |

Frame times are every `requestAnimationFrame` gap from "Lock in" to the verdict, with no screenshot taken meanwhile (a screenshot stalls frames). "During the act" means frames while the caption is showing. No frame in any act went past 18 ms, so it held 60 frames a second. The one slow frame overall (33.6 ms here; 34 to 50 ms in three earlier runs) is always about 0.5 s **before** the act's first step, while the run's hidden path drawing is set up. It is not the act. I did not measure main for the same frame. At most 29 animations ran at once on the example and 51 on orders.ts (`document.getAnimations()`).

## End state is unchanged

- **Page, against main.** The machine's SVG markup after the run lands, hashed on main (3203228, served from `git archive` with the same mock) and on this branch, for the example, orders.ts and plan_cache.py, each with and without reduced motion: **all six identical** (`endstate.txt`, `endstate.mjs`). The act draws its ink with motions and overlays it removes, then rewinds. The resting state is then set by the same beats as before (`runBeats`, untouched in what it returns).
- **Inside the branch.** Played, skipped with a key 1.2 s in, and reduced motion leave the same threads, lamps, needle, red, ring and markup length, with no overlay and no running animation 1.5 s later (`act/*-checks.json`, 8 of 8 for each file).
- **The shared proof picture.** Its machine SVG, built as `ProofImage` builds it, for all six fixture runs and both ring kinds: **12 of 12 hashes identical** on main and this branch (`proof-picture-sha.txt`, `proof-picture-sha.mts`).
- Earlier drivers on this branch's page: see "Drivers and tests" below.

## Drivers and tests (final run)

- `tsc --noEmit`: clean (`tsc.txt`).
- `npx vitest run`: 166 files, **2,682 passed**, 35 skipped, 0 failed (`vitest.txt`). The two 50 ms timing tests did not flake on this run.
- Run again on this branch's page, unchanged: R5 `truth.mjs` 32 of 32, R5 `visual.mjs` 21 of 21, R5 `ring-shots.mjs` rings where R7 had them (example on `fetchIt`'s port, orders.ts on `fetchPage`'s chute, at 1440 and 1280), R6 `panel.mjs` 53 of 53, R7 `shots.mjs` 56 of 56.
- `act.mjs`: 8 of 8 checks for each of the example, orders.ts and plan_cache.py.

## Files

| File | What it is | How to run it again |
|---|---|---|
| `act.mjs`, `act/` | The act on the page: captions in order, timing, frame times, overlays gone, key skip, reduced motion, plus a film | `PW=… CHROME=… BASE=… node tests/evidence/R8/act.mjs <out> example\|orders\|py` |
| `example-act.webm`, `orders-act.webm`, `py-act.webm` | The films (Playwright video, 1280 × 800) | from `act.mjs` |
| `frames/` | 8 frames per act, cut from the films with ffmpeg; the name says seconds after "Lock in" | `ffmpeg -ss <t> -i example-act.webm -frames:v 1 …` |
| `endstate.mjs`, `endstate.txt` | End-state markup hashes, main vs this branch | `BASE=… node tests/evidence/R8/endstate.mjs <label>` |
| `proof-picture-sha.mts`, `proof-picture-sha.txt` | The shared picture's hashes, main vs this branch | `ROOT=<checkout> FIX=… pnpm exec tsx tests/evidence/R8/proof-picture-sha.mts` |
| `capture-fixtures.mts`, `../../unit/fixtures/r8-runs/` | Six real sandbox runs with their third traced run (example throws / returns / never finishes, orders.ts throws / returns, plan_cache.py), used by the unit tests | `BASE=… pnpm exec tsx tests/evidence/R8/capture-fixtures.mts <out>` |
| `truth.txt`, `visual.txt`, `ring-shots.txt`, `panel.txt`, `shots.txt` (+ folders) | R5, R6 and R7 drivers rerun on this branch | as in R5/R6/R7 |
| `tsc.txt`, `vitest.txt` | Type check and the whole unit suite | `npx tsc --noEmit`, `npx vitest run` |

The page for every driver: `tests/evidence/U3/mock-server.ts` (every model mocked, $0) on port 18981 and `vite --port 18982` with `ATLAS_API_PORT=18981`, limits raised as in `truth.mjs`.

## Code

- `renderer/authors/run-act.ts`: the trace-to-steps builder (`runAct`), the fold (`fitAct`), the timing (`actTimes`). Pure.
- `renderer/machine/player.ts`: `act()` plays the steps; `stopAct()` takes every motion and overlay off and rewinds. `skip()` stops the act first.
- `web/machines/bench/BenchStage.tsx`: in machine view, the act replaces the old per-step loop; the hidden path drawing goes straight to its end; the caption line; the reduced-motion list.
- `src/outline/parse-js.ts`, `src/outline/py-bodies.ts`, `src/outline/types.ts`: `loopSpans`, each loop's first and last line (new, optional). `web/u1-example-outline.json` regenerated to match the parser (its test checks that).
- Tests: `tests/unit/r8-run-act.test.ts` (20): the example's 14 steps in order, 3 bursts, 3 wheel turns tied to `fetchIt`, dial 100 / 200 / 400 ms, no chute; a returning run; a run that never finishes; a run with no helper trace and with no helper answer at all (no helper step, lamp or pipe invented, and the dial stays still because which part waited is no longer known); orders.ts's chute at line 9 and no wheel turn; a returning orders run with no wait made up; the Python file; timing bounds; the fold's exact counts; loop spans in JS and Python.

## Limits and what I'm unsure of

- **The wheel counts calls, not passes.** Passes are not recorded. When the earliest call in the loop sits under an `if`, the wheel can turn fewer times than the loop went round. It never turns more often than that call was really made.
- **Helper steps never turn the wheel.** On orders.ts the third traced run lists `fetchPage` at 200, 600 and 1,400 ms, which are its calls to itself. The first call at 0 ms is missing. That run doesn't say reliably who made each call, so counting the loop by those steps would have turned `fetchAllOrders`'s wheel 4 times for one pass. I found this on the page and removed it. The same data still pulses the pipe `fetchAllOrders → fetchPage` for those steps, the same way the resting drawing has always threaded helper steps (D61). That pre-existing behaviour may be wrong for recursive code. I did not change it.
- **A folded step** (runs of more than 24 steps) flashes each fake once and turns each wheel once. The caption carries the exact counts.
- **Pipes that the resting drawing doesn't ink** (in the example: `fetchWithRetry → backoffMs`, `→ sleep`) only pulse and fade during the act, so nothing vanishes at the land. The resting drawing still shows only the `fetchIt` thread, as before (that collapse is today's, kept byte for byte).
- **The dial's needle** goes back to rest after each wait, and stays at rest at the end in the example, as it did before R8.
- **The dial's "N ms" label** can overlap a nearby part's pipe or wheel. On orders.ts it touches "calls itself". It shows for at most one step.
- **A server older than this branch** sends outlines without `loopSpans`. The wheel then simply doesn't turn: it fails quiet, not wrong. I saw this while my own mock server was still running from before the parser change.
- **Reduced-motion list:** in a short window it scrolls inside the result column, under the action bar.
- **Box chart, phones, more than 16 parts:** no new motion (by design, as asked).
- The worst overall frame (34 to 50 ms, before the act starts) was not compared with main.
- Not done: `pitch/VIDEO-INDEX.md` is not updated, because this branch is unmerged and unreviewed. There has been no adversarial review of this branch yet.
