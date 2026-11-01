# R3: Atlas's in-house visual renderer (D55)

Date: 2026-10-31 (WAT) · branch `r3-renderer` · not merged · Node 25.8.1 · live spend $0.042 (one round) · the rest $0.

## Phase 2: it is the product now

Every drawing in the app comes from the renderer. Atlas writes a RenderSpec; the page draws only that.

### Where to look first
1. `hero-journey-app.mp4` (26 s, the real app, mocked models): paste → the chart draws itself → the bet → the run → the verdict. The first file replaces the preview-page film as the one to show.
2. `app/studio-ts-1920-6-verdict.png` and `app/studio-py-1920-dark-6-verdict.png`: endings in the real app. The dark one is a test of two calls, with each call on the path.
3. `live/4-verdict.png`: the same screen with real models (Muse Wonder, Muse Spark 1.3, Muse Spark Open): $0.042 (`live/usage.json`).
4. `app/explorer-rest-1920.png`, then `app/explorer-picked-1920.png`: `server/meta` without the 20 "imports".

### Honesty fixes from my phase 1 report
| What I reported | What it is now |
|---|---|
| Bet-view wires came from my text search; a string with `fetch(` could draw a false line | They come from U3's `src/call-sites.ts` through the bench model. My search is gone. Test: a string and a comment containing `fetch(` draw no wire; a real call beside them does |
| "waits on" wired `fetchWithRetry`'s abort timer | A clock wire needs a Promise a timer resolves, or a Python sleep, in code with comments and strings removed. Anything else draws no wire. Test: abort timer no; `sleep` helper yes; the same words in a string no |
| "answered 503" read as measured | It now says "answered 503 (scripted)": the trace says call n returned, the test's script says what with |
| Hidden line words went unsaid | A caption counts them and says to hover the line |
| A test of several calls was not shown as such | Each call has its own ticket ("Atlas's call 1 of 2"), its end, and Atlas's scripted wait kept apart from the code's waits. The ending's time is the whole run's clock |

One thing I got wrong in phase 1 and did not flag: my `withRpcRetry` path could have said "never finished" for a pending run, close to the "hangs forever" CLAUDE.md forbids. It now says "still waiting when Atlas stopped", and the retry demo adds viem's 62 s cap for a pending run.

### What changed on screen
- **Studio:** one sheet of paper. Name and words on the left, the chart on the right. On sealing, the chart moves aside (its lamps and clock stay live), the path draws itself, and the answers land. X4's how-sure tap is in the bet pop-up. X3's failure labels are tags on parts, before betting.
- **Explorer:** the live job, the chart, the part card, "Bet on this part".
- **Retry demo, Moonwell, earlier paste screen, proof cards:** all draw from the renderer. Proof cards add "draw this in pencil" where the engine is installed; elsewhere they say the server has none.
- **Every screen:** the same paper palette and Besley, through `web/styles.css`'s tokens. D21's logo caption stays by the scoreboard.
- **Old figures:** no longer in the shipped page (a test walks the imports from `web/main.tsx`; the built bundle has no `iso-plate` or `TooManyToDraw`). Their files and pure model tests are still in the tree; deleting them is a separate step, since the bench and explorer models are still used.

### Dense charts
- One legend line replaces the repeated "imports" (0 of them now; only `calls` and `types only` keep words).
- Several links between two parts are one thicker line.
- Lines into one part gather into a bundle just above it.
- Parts group by folder.
- Lines rest faint; hovering or picking a part brings its own forward.

### Numbers
| What | Result | What it decides |
|---|---|---|
| Paste to the first ticket starting | 61–104 ms after Atlas's reader answers | The first-use goal, "within a few seconds", holds on this Mac with no network delay |
| Clicks paste→verdict | 5 with "Draw it" | Limit is 6; a real paste needs one fewer |
| Click to skip | 23 ms | Never slower than the person wants |
| Browser checks | 74 passed, 0 failed (`app-drive-log.json`) | axe 0 on every state checked, overlap 0, 390 px, reduced motion |
| Full suite | 2,282 passed, 35 skipped, three times (`full-suite.txt`) | tsc clean, no-local-paths passes |
| Live round | 3 model calls, $0.042, under the $0.20 limit | The real flow works end to end |
| Production build | Built page through `server/hosting.ts`: page, CSS and both fonts 200 with the right types, both faces loaded, no console errors, full round to verdict | Served correctly. Real Docker image not built (no Docker here, as in H1) |

### How it was checked
Mock servers and app: see the top of `app-drive.mjs`. `film.mjs` records the film; `prod-server.ts` serves the built page. Four viewports or themes of the Studio, TypeScript and Python.

### What is not real, or not checked
- **Moonwell never ran on a fork here.** No RPC in this click-through. The real screen got recorded run `mwTaxvHFzB` through browser routes. Its numbers are real and recorded; the flow around the run was not exercised.
- **The explorer's mocked Wonder** is its saved answer, pinned to the commit it describes.
- **Mock wording shows in screenshots:** Wonder's sentence says "(mocked…)". The film stops before it matters, but check the frame.
- **axe ran on the states listed** in the log, not during motion.
- **The pencil route's absent-engine answer** is tested by forcing the package to fail, not in a real production image.
- **Old drivers** (`tests/evidence/U2`, `U3`, `X2`, `X4`) rely on old selectors (`data-hit`, lamps, chips) and were not updated; they are records of their rounds. `app-drive.mjs` replaces them for the drawing.

### Still unlike the reference
- No illustrations, so sheets are emptier.
- Live SVG is flatter than the pencil export.
- `server/meta` is much better but still a graph: long routes come from pele.
- The bet panel is dense with four questions: the one screen that does not feel like a plate.
- The proof card's scoreboard is the bold Atlas mark, by design (D21), and sits oddly beside paper and ink.

---

## Phase 1: the renderer on its own

### Where to look first (preview page, before the app)
1. `hero-journey.mp4` (35 s, 1920×1080): one function's journey: the code draws itself → the bet → the run plays → the verdict; a didn't-match, then a matched.
2. `screens/hero-4-verdict-1920-light-didnt-match.png` and `screens/hero-4-verdict-1920-light-matched.png`: the two endings.
3. `export/path-pencil.png`: the same spec in the forked pencil engine. This is the one closest to the reference plate.
4. `screens/meta-1920-light.png`: the hardest real chart (`server/meta`, 12 parts, 23 joins).

## What it is, in plain words
Atlas writes a plain data file (a RenderSpec) saying what to draw. The renderer draws only that and imports nothing from Atlas's runs, models or server. Spec → Mermaid text → pele decides where things go → drawn as SVG in the browser, or as a pencil PNG in Node.

## Numbers
| What | Result | What it decides |
|---|---|---|
| 40 parts + 90 joins, layout and SVG text, page thread | 62–104 ms over 5 loads (first load slowest) | Target was under 1 s, so no Worker is strictly needed; one exists anyway |
| The same, then until it is on screen (two frames) | 26–46 ms more | The browser's own paint is not the cost either |
| The same, in the Web Worker | 57–121 ms across the driver runs | Same order |
| 200 parts | "showing the list" in under 500 ms (test) | Past 150 parts or 420 lines the page never tries. A drawing over 25 parts or 40 lines now runs in the Worker, stopped at 4 s, and then the list is shown |
| Words the font table vs the browser | worst 1.3 px off, on any word of the path and `server/meta` | Layout agrees with what is drawn; tables can be used in Node and the browser alike |
| Click to skip during the entrance / during the run | 49 ms / 18 ms to the finished picture | "Never slower than the person wants" holds |
| Reduced motion | structure in 108 ms; verdict 265 ms after that page load | Arrives finished |
| axe (WCAG 2 A/AA) on the bet stage, 1920 and 390 | 0 violations | Not run on the run or verdict stages, or on the gallery plates |
| Pencil export at full quality | 3 s (`path`, 8 px/mm) to 19 s (`retry`, 10 px/mm) | Fine for cards and the film; never for the live page |

Numbers come from `drive-log.json` and two extra runs on this one Mac. They were not measured on a phone or a slow machine.

## How to run it again
```
npx tsx renderer/preview/make-fixtures.ts           # specs from the saved runs; add --record to record the runs again
npx vite build --config renderer/preview/vite.config.ts
npx vite preview --config renderer/preview/vite.config.ts --port 18941 --strictPort
PW=<playwright-core 1.62.1 index.mjs> CHROME=<chrome-headless-shell> AXE=<axe.min.js> node tests/evidence/R3/drive.mjs <out dir>
npx tsx renderer/export/cli.ts path out.png 10
```
The hero is at `/hero.html` (`?theme=dark`, `?reduced=1`); plates at `/index.html?view=path|always500|bet|chart|meta|retry|moonwell|stress`.

`hero-journey.mp4` is Chromium's screencast through Playwright, encoded by ffmpeg. `hero-journey-playwright.webm` is Playwright's own recorder, as asked; its low fixed bitrate tints the flat paper in patches for the first seconds, so it is not the one to show anyone.

## Honest comparison with the reference plate (`order.jpg`)
**Close:** paper, title and italic pairing, the ticket (cream pencil border, red rule, tiny red words, zigzag bottom, hatched shadow, glossy pin), red thread, arrows stopping short, words on clean paper beside each step. The pencil export is close enough that it reads as the same hand.

**Unlike it, and why:**
- **No illustrations.** The plate is half characters and objects. Those were never to be copied, and Atlas has nothing true to illustrate beyond its devices and clocks, so large areas of the sheet stay empty. This is the biggest difference.
- **The live SVG is flatter than the pencil export.** Fills are hatch lines over flat colour, not deposited pigment. There is no paper tooth showing through the ink.
- **The font is Besley, not theirs.** Nearest open match found among six tried; slightly more formal.
- **No start bullet.** The plate's ringed red dot and short arrow are not drawn: every line must map to a spec edge, and adding a "start" to the spec was cut.
- **Dense charts are flowcharts in a nice pen.** `server/meta` and `stress` read well but do not feel like plates: long parallel routes come straight from pele. The look lands for paths and small charts. At 40+90 there is no pretending.

## What was cut to do fewer things well
- Parent-state drawing: regions are a plain inked outline with an italic label, no fold or wash.
- The deck kind has one simple drawing and is used by no author yet.
- Motion was tuned on the hero only. Big charts get a fast stagger with no pen beat per line.
- The dark theme is a paper swap: checked on stills, and pencil colours are only roughly tuned.
- The hero's film shows one bettor. Model bettors appear as marks on `retry` and `moonwell` only.

## Known limits, logged not fixed
- **Moonwell and `server/meta` at 390 px need panning.** They are wider than a phone at a readable size; the view opens top left. The path and the hero fit.
- **Text is clipped by pan only.** There is no scrollbar or pan hint on a phone.
- **Non-Latin names** draw in a fallback font, measured by a fair guess, so their overlap check is an estimate.
- **Tests:** browser behaviour (motion, skip, keyboard, pan) is checked by `drive.mjs`, not in the vitest suite, because vitest here has no browser.
- **Docker:** pele is a dev dependency, available in the image's page-build stage only. That is enough, since only the built page uses it.

## Licences
statechart-art MIT (Kevin T. Ngo), pele 1.12.0 MIT (1.13.0 was published today, so not pinned; no network or eval in either build), Besley SIL OFL 1.1, @napi-rs/canvas 1.0.13 MIT (dev only). Every reused file is in `renderer/NOTICE.md`; `PRE-EXISTING.md` names each source.

## Tests
`tests/unit/renderer-{spec,draw,authors,boundaries}.test.ts`: refusals, hostile names, 0 and 200 nodes, cycles, self-loops, the checks on five random 40+90 charts, every author's honesty rules, import fences. Phase 1 suite results were replaced by phase 2's in `full-suite.txt`.

## Review round (phase 3): truth first

Plain words: the review found the drawing's account of the run was false on ordinary code. This round fixed that. The film and the screenshots above are from before it, and are redone after the design verdict.

- `journey-a.mjs` drives the real app: speed, helper steps, change the code and bet again, test this claim. Results: `journey-a/journey.json`.
- `journey-a/live-result.png`, `live-claim.png`: one live round with real models, $0.0653 (`journey-a/live-usage.json`).
- Pencil: draws in its own process. Retry demo 2,025 ms; longest stall of the server's thread during it, 7 ms (it was 2,100 ms).
- Real-run tests: `tests/unit/r3-wires`, `r3-truth-runs`, `r3-helpers`, `r3-pencil`, `r3-bench-verdict`, `r3-honesty-moved`.
