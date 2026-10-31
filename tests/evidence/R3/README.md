# R3 phase 1: Atlas's in-house visual renderer (D55)

Date: 2026-10-31 (WAT) · branch `r3-renderer` from main 5f238cd · $0, no model asked · Node 25.8.1 · not merged; `web/` not touched.

## Where to look first
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
| 200 parts | "showing the list" in under 500 ms (test) | Past 150 parts or 420 lines the page never tries, and the Worker is stopped at 4 s |
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
- **The bet view finds call sites by text search** (comments cut). U3's logic is not on main; a string containing `fetch(` would wire a false line. Phase 2 should swap it in.
- **A wired "waits on" is any function whose lines call `setTimeout` or `sleep`**, including a timeout that aborts rather than waits: `fetchWithRetry`'s abort timer counts.
- **"answered 503" comes from the test's script plus the trace.** The trace says call n returned; the script says what with. The harness does not record the status itself.
- **Non-Latin names** draw in a fallback font, measured by a fair guess, so their overlap check is an estimate.
- **Word hiding:** when no clean spot exists, words beside a line stay in its tooltip and the list (1 of about 27 on `stress`). No caption says so yet.
- **Tests:** browser behaviour (motion, skip, keyboard, pan) is checked by `drive.mjs`, not in the vitest suite, because vitest here has no browser.
- **Docker:** `.dockerignore` is an allow-list and does not name `renderer/`, so phase 2 must add it before `web/` can import it. pele is a dev dependency, available in the image's page-build stage only.

## Licences
statechart-art MIT (Kevin T. Ngo), pele 1.12.0 MIT (1.13.0 was published today, so not pinned; no network or eval in either build), Besley SIL OFL 1.1, @napi-rs/canvas 1.0.13 MIT (dev only). Every reused file is in `renderer/NOTICE.md`; `PRE-EXISTING.md` names each source.

## Tests
`tests/unit/renderer-{spec,draw,authors,boundaries}.test.ts`: refusals, hostile names, 0 and 200 nodes, cycles, self-loops, the checks on five random 40+90 charts, every author's honesty rules, import fences. Suite results: `full-suite.txt`.
