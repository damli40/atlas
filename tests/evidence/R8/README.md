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
| The loop's hand wheel turns once | **Passes are not recorded.** It turns for each recorded call to the one fake that is certain to be called once per pass: that fake has exactly one call site in the function, that line holds exactly one call (as the parser counted them), the line is the function's own and sits inside exactly one loop's **body** (`loopSpans`, new: the lines inside the braces, or after a Python header; never the header) | such a fake exists. Example: `fetchIt`, line 14, the only call on that line, inside the body on lines 13–18: 3 turns for 3 passes. Two calls per pass, two on one line, a re-call in `catch`, a nested loop, or a call in the header: the wheel stays still and the act says why. Helper steps never turn it |
| The clock dial sweeps, with "N ms" beside it | a gap between two recorded events on the virtual clock (the example: 100, 200, 400 ms; `clock_moves` says 100, 300, 700), **and** the last helper step before that gap (third traced run, D61 order) is the dial's own part, or a helper whose calls include it | the clock moves only for the code (no scripted delay), that part is the one drawn waiter known to have run, and a helper step of it came just before. Otherwise the caption says "N ms pass" and no dial moves and no number is drawn. One helper step accounts for one gap at most |
| The chute drops (its red shows, a drop slides down it) | `measured.outcome` is `threw` and `endOfRun` placed the end on that chute (the same fact that makes it red at rest) | the end is placed on a chute. The example's end is on `fetchIt`'s port, so no chute drops there; orders.ts drops on `fetchPage`, line 9 |
| The caption under the machine | the same step's fields, in words: "call 2 to fetchIt: threw Error", "waits 200 ms", "threw Error at 1,400 ms, out of line 9" | always, one line per step |

What a run that lacks a field gets is written down by the same code (`Act.quiet`), for example: "No chute drops: plain code could not place the throw on one chute", "The loop wheel stays still: passes are not recorded, and no recorded call sits only inside the loop's lines", "No helper lamps or pipes: Helper order is not shown: …".

## Timing

- Real time is about 3 to 6 s whatever the virtual time: `n × 330 ms`, kept between 3,000 and 6,000 ms. No step is shorter than 250 ms. Half the spare time is shared evenly; half goes to waits in proportion to their virtual ms, so "waits 400 ms" stays on screen longer than "waits 100 ms" (`actTimes`).
- A long run folds its middle so it has at most 24 steps. A folded step says the exact counts ("steps 7–18: fetchIt 6 times, 6 waits, 1,200 ms in all", and "time passes 2 times (not reported)" when the run did not report time). Its dial's label says "6 waits", never one long "1,200 ms". In a folded step a fake flashes once, not once per call (see Limits).
- Any key or click skips to the end state (the page's existing skip). "Play the run again" (R), still under "More" where R7 put it, plays the act again.
- With reduced motion nothing moves: the end state shows at once, and the steps are listed as text in the result column ("What the run did, step by step (14)").
- The box chart (phones, windows too small for 11 px words, more than 16 parts, or M) keeps today's story unchanged. No new motion there.

## Measurements (1280 × 800, headless Chrome 145, models mocked, $0)

| File | Steps | Act, first caption to last | Playing to verdict | Worst frame during the act | Worst frame overall | Motions seen on the page |
|---|---|---|---|---|---|---|
| Example (`fetchWithRetry`) | 14 | 4.3 s | 5.2 s | **18.7 ms** (p95 17.9) | 50 ms | 3 wheel turns, 3 lamp bursts, dial labels 100 / 200 / 400 ms |
| orders.ts (`fetchAllOrders`) | 13 | 4.0 s | 4.9 s | **18.4 ms** (p95 17.8) | 33.3 ms | 4 lamp bursts, "200 ms pass" with no dial, then dial 400 / 800 ms, chute drop, no wheel turn |
| plan_cache.py (`get_user_plan`) | 4 | 2.5 s (4 steps × 750 ms) | 3.5 s | **18.7 ms** (p95 18.3) | 18.7 ms | dial 500 ms |

Frame times are every `requestAnimationFrame` gap from "Lock in" to the verdict, with no screenshot taken meanwhile (a screenshot stalls frames). "During the act" means frames while the caption is showing. These are the numbers after the review fixes. No frame in any act went past 19 ms, so it held 60 frames a second. The one slow frame overall (33 to 50 ms) is always about 0.5 s **before** the act's first step, while the run's hidden path drawing is set up. It is not the act: the reviewer measured the same ~33 ms frame on main in 2 of 8 runs. At most 29 animations ran at once on the example and 51 on orders.ts (`document.getAnimations()`).

## End state against main

- **Page, against main.** The machine's SVG markup after the run lands, hashed on main (3203228, served from `git archive` with the same mock) and on this branch, each with and without reduced motion (`endstate.txt`, `endstate.mjs`). The example and plan_cache.py: **identical** (4 of 4). **orders.ts differs, on purpose, after the review:** on main the resting needle of `fetchPage`'s dial swept for the first 200 ms gap. That gap came straight after a call to `fetch`, with no helper step of `fetchPage` before it, so under the review's MAJOR-1 rule (now also in `machine-script.ts`) no dial claims it, and the needle rests. The ring, the red chute, the threads and the lamps are unchanged (`ring-shots.txt`, `truth.txt`). The act's ink is drawn with motions and overlays it removes; the resting state is set by the beats (`runBeats`).
- **Inside the branch.** Played, skipped with a key 1.2 s in, and reduced motion leave the same threads, lamps, needle, red, ring and markup length, with no overlay and no running animation 1.5 s later (`act/*-checks.json`, 8 of 8 for each file).
- **The shared proof picture.** Its machine SVG, built as `ProofImage` builds it, for the 6 R8 fixture runs and the review's 26 runs, both ring kinds: **64 of 64 hashes identical** on main and this branch (`proof-picture-sha.txt`, `proof-picture-sha.mts`). The picture never draws a needle, so the dial rule cannot change it.
- Earlier drivers on this branch's page: see "Drivers and tests" below.

## Drivers and tests (final run, after the review fixes)

- `tsc --noEmit`: clean (`tsc.txt`).
- `npx vitest run`: 167 files (165 passed, 2 skipped), **2,704 passed**, 35 skipped, 0 failed (`vitest.txt`). The two 50 ms timing tests did not flake. One earlier full run failed `x4-felt`'s "every committed proof file still verifies" on a 20 s timeout. The cause was a stray symlink loop, `node_modules/node_modules` → the worktree's own `node_modules` (1.7 million paths to walk), made while setting up main's exported tree for comparison. I unlinked it; the test then passed.
- Run again on this branch's page: R5 `truth.mjs` 32 of 32, R5 `visual.mjs` 21 of 21, R5 `ring-shots.mjs` rings where R7 had them (example on `fetchIt`'s port, orders.ts on `fetchPage`'s chute, at 1440 and 1280), R6 `panel.mjs` 53 of 53, R7 `shots.mjs` 56 of 56.
- `act.mjs`: 8 of 8 checks for each of the example, orders.ts and plan_cache.py (`act/*.txt`).
- `repro-timeout.mjs` (the review's MAJOR-1 file on the real page): pass, no dial moves and no "1,000 ms" label during the timeouts (`review-fixes/`).
- Unit tests for R8: `r8-run-act.test.ts` 37, `r8-player-act.test.ts` 5. Two older tests changed to the new dial rule, each keeping a case where the dial does move: `r4-machine.test.ts` ("a wait moves a dial only on a function that waits") and `r5-final-review.test.ts` (M2).

## After the adversarial review (round 2)

The review: `scratchpad/r8/review-R8.md` (coordinator's copy), with 26 real sandbox runs made to break the act. They are now unit-test fixtures in `tests/unit/fixtures/r8-review/`. No blocker; two majors, both "something moves that didn't happen". Fixed:

- **MAJOR-1, a dial claimed a wait it didn't make.** Before: every gap on the clock went to the one drawn waiter. A retry loop with `withTimeout(fetchIt(), 1000)` and `sleep` showed "waits 1,000 ms" with "1,000 ms" beside **sleep's** dial; a class method's `wait(300)` and a Python `Pause.wait` did the same. Now a gap goes to that dial only when the last helper step before it is that part (or a helper that called it). Otherwise the caption says "1,000 ms pass" and nothing on the machine moves or shows a number. The same rule now holds in the resting script (`machine-script.ts`), which on main could sweep that dial with no number. That changes one resting drawing of the three demo files: orders.ts's needle now rests (see "End state against main" above); the example and plan_cache.py are identical to main. Page proof: `review-fixes/timeout.txt` and `review-fixes/timeout-gap-1.png` (the real retry-with-timeout run on the page: "1,000 ms pass", no label, needle still), `review-fixes/sleep-100.png` (sleep's own "100 ms").
- **MAJOR-2, the wheel turned per call, not per pass.** Before: two calls to one fake in a pass turned it twice (`two-sites-one-loop` 4 turns for 2 passes, `one-line-two-calls` 4, `catch-recall` 3, `py-two-sites` 4). Now the strict rule in the table above. All of those, plus nested loops, two loops, if/else sites and a loop around `Promise.all`, keep the wheel still and say why; `retry-timeout-backoff` and `py-generator` still turn 3 times for 3 passes.
- **Minor 1–2, folds.** "6 waits, 1,200 ms in all"; the dial's label says "6 waits"; unreported time is counted in the caption.
- **Minor 4.** After the act, nothing more runs if the run was replaced meanwhile (`if (!live) return` before the path player's skip).
- **Minor 6, screen readers.** The line under the machine is now `aria-live="off"`. One polite sentence is announced when the act ends: "The run played 14 steps on the machine, ending: threw Error at 700 ms."
- **Minor 7.** `tests/unit/r8-player-act.test.ts` (5): captions in order at their times; nothing of the act left after it ends, is stopped or is skipped; skip leaves the resting beats' state; the dial label; reduced motion plays nothing.
- **Also found on the page:** a dial's label could linger a frame into the next step. Its motion now ends inside its own step (the repro log shows no label outside a "waits" step).
- Not changed: minor 3 (helper steps on recursive code, older D61 data), minor 5 (a frozen tab bunches the remaining captions; end state correct), the two implementation-shaped assertions minor 7 named (kept; the new tests cover behaviour).

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
| `repro-timeout.mjs`, `review-fixes/` | The review's retry-with-timeout file on the page: captions, dial labels and needles per step, frames of a 1,000 ms gap and of sleep's 100 ms | `PW=… CHROME=… BASE=… node tests/evidence/R8/repro-timeout.mjs <out>` |
| `../../unit/fixtures/r8-review/` | The review's 26 real runs, used by `r8-run-act.test.ts` | made by the reviewer on the same mock |

The page for every driver: `tests/evidence/U3/mock-server.ts` (every model mocked, $0) on port 18981 and `vite --port 18982` with `ATLAS_API_PORT=18981`, limits raised as in `truth.mjs`.

## Code

- `renderer/authors/run-act.ts`: the trace-to-steps builder (`runAct`), the fold (`fitAct`), the timing (`actTimes`). Pure.
- `renderer/machine/player.ts`: `act()` plays the steps; `stopAct()` takes every motion and overlay off and rewinds. `skip()` stops the act first.
- `web/machines/bench/BenchStage.tsx`: in machine view, the act replaces the old per-step loop; the hidden path drawing goes straight to its end; the caption line; the reduced-motion list.
- `src/outline/parse-js.ts`, `src/outline/py-bodies.ts`, `src/outline/types.ts`: `loopSpans`, each loop body's first and last line (new, optional; the header is never in it).
- `renderer/authors/machine-script.ts`: the resting dial follows the same rule as the act (after review). `web/u1-example-outline.json` regenerated to match the parser (its test checks that).
- Tests: `tests/unit/r8-run-act.test.ts` (37, with the review's cases) and `tests/unit/r8-player-act.test.ts` (5). Among them: the example's 14 steps in order, 3 bursts, 3 wheel turns tied to `fetchIt`, dial 100 / 200 / 400 ms, no chute; a returning run; a run that never finishes; a run with no helper trace and with no helper answer at all (no helper step, lamp or pipe invented, and the dial stays still because which part waited is no longer known); orders.ts's chute at line 9 and no wheel turn; a returning orders run with no wait made up; the Python file; timing bounds; the fold's exact counts; loop spans in JS and Python.

## Limits and what I'm unsure of

- **The wheel counts calls, not passes.** Passes are not recorded. When the one call that marks a pass sits under an `if` in the body, the wheel turns fewer times than the loop went round (review fixture `conditional-first`: 1 turn for 3 passes). After the review's fix it never turns more often than the loop went round on any of the 26 review runs.
- **Helper steps never turn the wheel.** On orders.ts the third traced run lists `fetchPage` at 200, 600 and 1,400 ms, which are its calls to itself. The first call at 0 ms is missing. That run doesn't say reliably who made each call, so counting the loop by those steps would have turned `fetchAllOrders`'s wheel 4 times for one pass. I found this on the page and removed it. The same data still pulses the pipe `fetchAllOrders → fetchPage` for those steps, the same way the resting drawing has always threaded helper steps (D61). That pre-existing behaviour may be wrong for recursive code. I did not change it.
- **A folded step** (runs of more than 24 steps) flashes each fake once and turns each wheel once. The caption carries the exact counts.
- **Pipes that the resting drawing doesn't ink** (in the example: `fetchWithRetry → backoffMs`, `→ sleep`) only pulse and fade during the act, so nothing vanishes at the land. The resting drawing still shows only the `fetchIt` thread, as before (that collapse is today's, kept byte for byte).
- **The dial's needle** goes back to rest after each wait, and stays at rest at the end in the example, as it did before R8.
- **The dial's "N ms" label** can overlap a nearby part's pipe or wheel. On orders.ts it touches "calls itself". It shows for at most one step.
- **The dial rule costs true sweeps.** A function that waits in its own lines with no helper step of it just before (the tested function itself; orders.ts's first backoff) keeps its dial still and the caption says "N ms pass". It fails quiet, never wrong; the cost is a less lively dial.
- **A server older than this branch** sends outlines without `loopSpans`. The wheel then simply doesn't turn: it fails quiet, not wrong. I saw this while my own mock server was still running from before the parser change.
- **Reduced-motion list:** in a short window it scrolls inside the result column, under the action bar.
- **Box chart, phones, more than 16 parts:** no new motion (by design, as asked).
- The worst overall frame (34 to 50 ms, before the act starts) was not compared with main.
- Not done: `pitch/VIDEO-INDEX.md` is not updated, because this branch is unmerged and unreviewed. There has been no adversarial review of this branch yet.
