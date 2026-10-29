# U1: the drawing is the product; betting is an optional quiz (D47, D48)

Date: 2026-10-29 (WAT) · branch `u1-visual` from main 26f5342 · live spend **$0.047** (one round, real models) · Node 25.8.1

## Where to look first

1. **Film shots**, 1920×1080, light and dark (`screens/`): `film-rest-*` (the drawing, nothing has run),
   `film-bet-*` (the bet pop-up open, three answers tapped), `film-mid-*` (the run playing: a stand-in's lamp lit, the
   dial turning), `film-marked-*` (every answer marked on the drawing). The live round: `live/live-*-1920-light.png` (taken before review round 1, so its pop-up lacks the who-bets picker added by m7).
2. **Click counts** (below): 11 clicks before, **5** now, measured by the browser script.
3. **The before-bet rule** test: `tests/unit/u1-stage.test.tsx`, and `before-bet rule` lines in `screens/browser-output.txt`.

## Review round 1 (an adversarial reviewer, Opus, read-only)

No blocker in the trust path (options from the test only, exact membership judging, kind mismatches refused on both
the person's and the models' path, D19 key covers the quiz). Fixed in e314144:

| Finding | What broke | Fix | Test |
|---|---|---|---|
| M1 | A late answer from an older round (Wonder's tests, an experiment, a run) could land on a new paste or function; an old run could then play on a new test's drawing | Every async answer carries its round; a late one is dropped; the stage only plays a run of the current test | code; stage test |
| M2 | A failed run left sealed bets with no way to run | "Run it again" | code |
| M3 | For a run not shown as fact, the marks still said "The run: returns a value" | Every mark says "can't check: <reason>" | `u1-quiz.test.ts` |
| M4 | The explorer hand-off quietly picked another function when the named one is not exported | Says so plainly and lets the person pick; the title shows the file's source | code |
| m2 | Going back to "Draw a codebase" re-ran the outline job | The explorer stays mounted | code |
| m4 | A value in no option judged "didn't match" | "can't check" | `u1-quiz.test.ts` |
| m5 | Two long values could show the same option words | Length and a number added | `u1-quiz.test.ts` |
| m7 | No way to choose who bets | A picker in the pop-up until sealing (asks again on the same test) | browser run (axe 0) |
| m8 | The dial pegs silently | The clock chip says "past the dial's N ms" | code |

Not fixed, logged: **m1** (the shared model-slots hook does not ignore a slot reply for a test the person already left;
in this screen it only affects the status line), **m3** (time ranges ignore the watch limit, so a scripted wait longer
than the limit gives options no run can reach; never a wrong verdict), **m6** (a hand-edited proof file could swap a
quiz bet for another kind on the same experiment and re-seal it; recording `quiz: true` on the experiment would close
it).

## What changed, in plain words

- **One entry, drawing first.** Paste a file and Atlas reads it at once (no button): plain code finds its functions and
  which one calls which (`src/file-outline.ts`, the explorer's parsers, no model), and the screen fills with an Anatomy
  drawing of it. Each function is an instrument box, as tall as its lines; a steel line joins two boxes where one calls
  the other. Upload one file: the same. Upload several files or give a GitHub folder: the code explorer (X2), full screen.
- **"Bet on your understanding"** is a toggle at the bottom right. Opening it asks Muse Wonder for tests and preselects
  the first one the gate allows, shown as one plain sentence; "change test" is a secondary link (Wonder's other tests,
  edit, or write your own).
- **Once a test is chosen the drawing grows a second deck**: each stand-in (a fake function Atlas passes in) is a small
  device with a signal lamp, wired to the function under test, and a clock housing whose dial is Atlas's simulated clock.
  The dial's longer ticks are the times the test's own scripted waits mark. All of this is the test, not a result.
- **The quiz** (D48): every question has 2–4 tappable options plus "can't tell", written by plain code from the test
  only (`src/quiz.ts`):
  - how it ends: returns / throws / never finishes / still running when Atlas stops watching;
  - how many times it calls each stand-in: 0, 1 (or 1 to N−1), N, more than N, where N is the number of answers the
    stand-in is scripted with;
  - how long it takes: 0 ms; above 0 and below d; d to S; above S, where d is the shortest scripted wait and S all
    scripted waits added up (no scripted wait: 0 ms, or more than 0 ms);
  - what it returns: each value a stand-in is scripted to return, then each plain JSON argument, then "another value".
  Count and time options cover every possible value exactly once (`coverageProblem`, tested). A tap is a `quiz` bet; an
  untapped question or "can't tell" is a declined bet, judged "can't check". One "Seal my answers" button.
- **Models bet on the same options.** The "what every bettor sees" text (D19) now lists every option as
  `(a) …; (b) …; or can't tell`, and that text is the models' prompt. A model answers with the option's letter; the
  server seals it with the question's own options.
- **After sealing the run starts by itself** (once the models have sealed), then plays on the same drawing: each call
  lights its stand-in's lamp with its scripted answer ("call 2: throws TimeoutError"), the dial follows the simulated
  clock, and the function box shows its ending. Then each question is pinned to the part it is about (ending and value
  on the function, calls on the device, time on the clock) with your verdict, and the side panel lists your pick and each
  model's pick with plain code's word: matched / didn't match / can't check. Proof card, "Play the run again" and "Bet on
  another test" are one click away. Muse Wonder's sentence appears only now (D18).
- **Trust rules kept.** The stage gets run data only after sealing (`after` in `BenchStage.tsx`, built in `Studio.tsx`
  only when a result exists and bets are sealed). A run that may not be shown as fact plays nothing; a field the run did
  not measure animates nothing for that field (no lamp, no dial, no ending) (`web/machines/bench/play.ts`).
- **Everything that worked stays reachable** from the top bar: "Draw a codebase" (X2 explorer; "Bet on this part" now
  lands on the drawing with that file and function), "Demos" (the retry machine, the Moonwell pull request, many callers
  at once, the earlier paste screen, each full screen with its own controls), "Agent log" (a collapsible edge), proof
  cards (`?proof=`), invite page links on a 401.
- **For X3:** `BenchStage` takes `extraMarks` (`{ anchor, text }[]`), drawn only after sealing, so failure labels can sit
  on the drawing. `src/judge.ts` gained one additive branch (4a, quiz bets) that calls `src/quiz.ts`; nothing else in
  it changed, so R2's timing rule (D46) applies unchanged to the remaining free-number bets.

## Click counts (paste code → verdict on the drawing)

| Screen | Clicks | Path |
|---|---|---|
| Before (main 26f5342) | **11** + typing 2 numbers | "Paste any code" tab (main opened on the retry machine) · Read it · pick the function · Ask Muse Wonder · Use this test · outcome dropdown (open + choose) · click the calls box · click the time box · Seal · Break it |
| After (U1) | **5** | paste (a keystroke, no click) · Bet on your understanding · 3 taps · Seal my answers (the run starts by itself) |

Measured by `drive.mjs` in both themes and under reduced motion (all 5); the earlier screen by the same script
(`before-earlier-screen-1920-light.png`). The 5 assumes three answers; each extra answer is one more tap, and fewer is
fewer (untapped = "can't tell"). In the jsdom test, which presses "Draw it" instead of pasting, it is 6.

## Checks

| Check | Result | Where |
|---|---|---|
| Anatomy audit (geometry), 4 builds: example at rest, example + mocked test, example + the live test, retry fixture | **audit passed** ×4 | `audit.txt` (`pnpm exec tsx tests/evidence/U1/audit.ts`) |
| Anatomy line ends, live app, rest / selected / mid-run / marked, dark and light | **line ends: 0** ×8 | `lines.txt`, `anatomy/*.png` |
| axe-core (WCAG 2 A/AA + best practice): entry, rest, bet open, marked, both themes, and the live round | **0 violations** ×12 | `screens/browser-output.txt`, `live/browser-output-live.txt` |
| Text overlap (D07-04 method): stage at rest and marked, the pop-up; the mark list at 390 px | **0 pairs** | same |
| Before-bet rule in the browser: no `[data-run]`, no lit lamp, no live line, no mark, no overlay text, no run word in the SVG; at rest and with the pop-up open | **pass** ×8 (+2 live) | same |
| 390 px: no page scroll on entry / rest / bet / marked; zoom changes the drawing's scale | **pass** | same, `phone-*.png` |
| Reduced motion: marked end state shown at once, 0 running animations, no lamp ever lit | **pass**, both themes | same, `reduced-marked-1920-light.png` |
| Unit tests: options built from the test only (the builder's input is gate-checked; a smuggled `run` or `measured` field is refused), coverage and no overlap for N = 1, 2, 3, 7 and three time shapes, membership judging (matched / not / can't check incl. tampered and unit-mismatched options), D19 byte equality with options (page text inside both models' prompts), quiz round end to end through the server, proof verifies, tampered options fail verify | 12 pass | `tests/unit/u1-quiz.test.ts` |
| Stage test (React + real server, models mocked): structure only before sealing (DOM and SVG), run plays, 4 marks with your pick and both models' picks, proof link | 2 pass | `tests/unit/u1-stage.test.tsx` |
| Full suite ×3 (after review round 1), tsc, no-local-paths | **1,881 passed, 0 failed** ×3 (35 skipped); tsc exit 0; no-local-paths passes | `full-suite-1..3.txt`, `tsc-output.txt` |

## The live round (real Muse Wonder, Muse Spark, Muse Spark Open)

`live/` · server `live-server.ts` (spend capped at $1) · usage `live/usage.jsonl`:

| Call | Tokens in / out | Cost |
|---|---|---|
| Muse Wonder 1.0, test proposals | 839 / 859 | $0.0205 |
| Muse Spark 1.3, quiz bets | 1,485 / 722 | $0.0204 |
| Muse Spark Open (Baseten), quiz bets | 1,618 / 907 | $0.0059 |
| **Total** | | **$0.047** |

Wonder's first allowed test: `fetchWithRetry(fetchIt, 3, 100)` where fetchIt always throws `Error("flaky")`. The run threw
at 700 ms of simulated time after 3 calls. Both models answered every question by letter: Spark and Spark Open each
matched 3 of 3 checkable answers ("throws an error", "2 or more times", "more than 0 ms") and said "can't tell" to the
returned value (can't check: the call threw). The person's taps (the script taps the first option of three questions)
matched 0 of 2 checkable ones. Wonder's sentence, shown after the run, is in `live/checks-live.json`.

## What I did not do, and what is weak

- **The dial can peg.** Its scale comes from the test only (before betting nothing else may be used). When the code
  waits by itself (the example's own `sleep`), the run can outlast the scale: the live run took 700 ms on a 100 ms dial,
  so the needle rests on its stop; the chip and the mark still say 700 ms.
- **Returned-value options include the JSON arguments** (e.g. "3 (the same as argument 2)") besides the scripted
  returns. D48 names only the scripted returns; I added the arguments so a pure function (no stand-in) still gets a
  value question. Easy to remove if Dami prefers the strict reading.
- **Call-count options use only the scripted steps**, not loop counts visible in arguments (e.g. `attempts: 3`). Doing
  that well needs knowing which argument is a count; I did not guess.
- **Who bets with you** defaults to both Meta models when the server can ask Muse Spark Open; changing it in the
  pop-up asks the models again on the same test (one more experiment).
- **Pins can sit over engraved plates** of the drawing (they are HTML over the SVG). Text over text is checked (0); pin
  over drawing is not.
- The click-through runs against the mock server with `ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000` (the default 20 per
  hour runs out across 6 rounds from one address).
- Python files draw the same way (the parser exists), but the screenshots and the live round are TypeScript only.

## How to run

```
PORT=18731 ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U1/mock-server.ts
ATLAS_API_PORT=18731 pnpm exec vite --port 18732 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=http://localhost:18732/ node tests/evidence/U1/drive.mjs <chromium headless shell> tests/evidence/U1/screens
pnpm exec tsx tests/evidence/U1/audit.ts
node tests/evidence/U1/lines-actions.mjs dark tests/evidence/U1/anatomy > a.json && node ~/.claude/skills/anatomy/scripts/drive.mjs http://localhost:18732/ --actions a.json --width 1920 --height 1080 --theme dark
```
Live: `PORT=18741 ATLAS_USAGE_PATH=<scratch> pnpm exec tsx tests/evidence/U1/live-server.ts`, a Vite on it, then
`U1_LIVE=1 … drive.mjs … tests/evidence/U1/live`.

Note: one earlier full run (before review round 1, while the reviewer, the line checks and the live run shared the
machine) failed X2's timing test once: the 40-part drawing took 16.0 s against its 15 s bound; alone it takes 5.6 s.
The three runs above were on a quiet machine.
