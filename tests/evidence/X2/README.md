# X2: the code explorer (full build)

Date: 2026-10-28 (WAT) · live spend **$0.996** (three Muse Wonder outline calls, no other paid call) · Node 25.8.1.

## Where to look first

- **What works now.** In the app, "Explore a codebase" takes a public GitHub folder or uploaded files, starts an X1
  outline job, shows each step, then draws the machine from the job's checked outline. Picking a part shows its card.
  "Bet on <function>" on the card opens the existing paste flow (E3) with that file and that function already picked.
  From there it is the same round as any pasted code: the same routes, the same gate, the same sealed bets.
- **The film shots** (1920×1080), in `screens/`:
  - `film-rest-1920-light.png` / `-dark.png`: the whole machine at rest.
  - `film-selected-1920-light.png` / `-dark.png`: one part picked, everything unrelated faded.
  - `card-1920-light.png` / `-dark.png`: the part's card.
  - `film-handoff-1920-light.png`: the bet hand-off, with the paste flow opened and `redactSecret` picked.
  - `film-verdict-1920-light.png`: the verdict that round ends with.
- **Read this before trusting the live run.** I ran out of the $1 live budget before a complete live run that used
  real models end to end. What I have:
  - **Live run 2** drew a real outline ($0.32): 11 of 11 parts, 24 lines. See `live/live2-rest-1920-light.png`.
    Its card shot shows the wrong part, because of a scroll bug described below (now fixed).
  - **Live run 3** found a real bug ($0.35). On a 16-part outline (Wonder splits files differently on every run),
    the first routing rule could not stack the lines. The page said so honestly: "The machine could not be drawn …",
    and the parts and joins stayed listed (`live/live3-not-drawn-1920-light.png`). The router is fixed (below).
    The fix is tested on 200 random outlines, but **not on that exact live outline**: its answer was lost with the
    browser session.
  - **The complete click-through was run with every model mocked** ($0). The outline job, intake, code map, checks,
    paste route, gate, sandbox, judge and seals were all real. It went outline → pick a part → bet → verdict, with
    every check passing (`screens/browser-output.txt`).
- **Two bugs the live runs found, both fixed:**
  1. Scrolling the page under a still mouse pointer changed the picked part. Hover now picks only on a real pointer
     move.
  2. Some outlines could not be drawn at all. The router now tries side jogs and L-shaped routes and breaks every
     stacking conflict. On 200 random outlines: 0 not drawn. On 30 of them under the full Anatomy audit: 28 passed,
     and 2 failed only "crowding" (one bend touching another line on screen, no line passing through anything).

## Commands

```
pnpm tsx web/machines/explorer/build.mjs --audit          # the saved demo page (both themes) + the Anatomy audit
node ~/.claude/skills/anatomy/scripts/lines.mjs web/machines/explorer/explorer.html        # line ends (also -light)
PORT=8798 pnpm exec tsx tests/evidence/X2/mock-server.ts ; ATLAS_API_PORT=8798 pnpm exec vite --port 5184 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> node tests/evidence/X2/drive.mjs <chromium headless shell> tests/evidence/X2/screens
X2_SECTION=<saved X1 section> npx tsx tests/tools/x2-fixture.ts    # rebuild the two fixtures (no model call)
PORT=<free port> ATLAS_USAGE_PATH=<scratch> pnpm exec tsx tests/evidence/X2/live-server.ts   # real Wonder outline, bets mocked (paid)
```

## How the live data reaches the drawing (and why it is drawn in the browser)

- The Anatomy kit modules the drawing uses (`iso-kit`, `lathe`, `tube`, `audit`) are plain JavaScript with no Node-only
  calls, so they run in the browser.
- `web/machines/explorer/figure.mjs` is one function, `buildFigure`. It draws:
  - the saved demo page (`build.mjs`, in Node);
  - the app screen (`ExplorerMachine.tsx`, in the browser).

  So the code the audit proves is the code the screen runs. On this outline it takes about 1.5–1.8 s.
- I chose this over building the SVG on the server. A server build would need a new route, plus more work in the
  child process that X1 keeps for the code map. The page gets the outline from `GET /outline/jobs/:id/outline`,
  which carries no code text, and draws it itself.
- **What this does not do:** the browser does not run the full audit on live outlines (it takes seconds). The audit
  runs in tests on the saved outline, on outlines with joins removed, and on random outlines.

## The machine, and what changed after Dami's critique

An instrument skid:

- One **deck per folder**: `server/meta/` and `roles/`, each with a small engraved folder plate.
- On a deck, **one tray per file**.
- On the trays, **one box per part whose lines plain code confirmed**.
- A **steel line** between box lids for each join plain code found:
  - thick for calls, thin for imports and uses;
  - braided for type-only imports ("no link at run time");
  - two tag collars when Wonder did not name the join.

Changes:

| Critique | Change |
|---|---|
| Boxes have no names | One engraved name plate per box (Wonder's name, fitted to the plate, cut with "…" only when too long; the full name is on the card and in the box's label for screen readers). To fit names, a box's **width now follows its name** and its **height follows its lines** (7 units + 1 per 45 lines). The prototype used width for lines. |
| Spaghetti at full view | At rest the lines sit back (opacity 0.62), so the boxes and names lead. When a part is picked, every unrelated line fades to 0.14 and every unrelated box loses its ink. Its own lines and box are lit. The boxes at the other ends stay plain. Fills stay opaque, so nothing behind shows through. |
| Group trays by folder | One deck per folder; the box covering two files stands across the joint of their two trays. |
| Reads at 1920×1080 | In explore mode the page widens (up to 1560 px; the agent log takes 26% of the width). The figure and the card sit side by side once the space is at least 1080 px wide. The film shots are at 1920×1080. |

## Every X1 status, rendered honestly

| X1 field | On screen |
|---|---|
| part `confirmed` | A box. The card's label is **"Part · lines confirmed"**, then "Plain code checked that these lines exist, on whole definitions. It did not check the sentence above." The word "purpose confirmed" appears nowhere (a test reads the source). |
| `wholeFile` span | "redact-secret.ts · whole file (lines 1–36)" |
| join `confirmed` / `code-only` | A steel line; code-only lines carry two tag collars. The card says "confirmed: Wonder named it and plain code found it" or "found by plain code; Wonder did not name it". |
| `typeOnly` | A braided, thinner line, and "(type-only: no link at run time)" on the card. |
| `model-only` | **Never a line.** A dashed chalk tag under "Not drawn as lines": "Wonder says this; plain code could not check it", plus plain code's reason (said once). |
| `noLinkFound` | The chalk tag says "Atlas found no import or call for this" instead. |
| `cantCheck`, `codeMap.cantMap`, no Wonder outline | Nothing is drawn; the card states the reason (`Can't check: …`). |
| unconfirmed part | No box; listed with plain code's reasons; no line lands on it. |
| names and purposes | Always shown as Muse Wonder's: "Name by muse-wonder-1.0" and "muse-wonder-1.0 says what this part is for:", as real text (not CSS). |
| the commit | "damli40/atlas · server/meta at commit 058ab2a29634dc0b8c092fe7816a6fd57ce9b74c" on the card. It is never called "verified" (X1 Limits: the proof file shows the outline is internally consistent, not where the code came from). |

## "Bet on this part"

- The card lists the part's exported functions, read from the code map (top-level, exported, inside its confirmed
  lines).
- A function is **not offered**, and the card says why, when:
  - the file is not JavaScript, TypeScript or Python;
  - the file is over 64 KB;
  - the file is over 2,000 lines.
- When the file imports other modules, the card warns that a run of one file on its own may only say "can't check".
  The hand-off still goes through, and the paste flow then says "can't check" itself.
- Picking a function reads that one file's text from the job's own `GET /outline/jobs/:id/atlas` (only the session
  that ran the job can read it). It then switches to the paste flow, which sends the text through **`POST /paste`**,
  the same route as a paste.
  - The paste reader's own export scan decides. If it does not find the function, the page says so and picks nothing.
  - Everything after that is unchanged E3: Wonder's proposals (gate-checked), D18/D19 (one shared text for bettors;
    Wonder's claim held back), seals, run, judge, proof card.
- **The saved demo outline has no code on the server**, so its buttons are disabled with the reason.

## Checks

| Check | Result |
|---|---|
| Anatomy audit, saved outline at 058ab2a (`audit.txt`) | `audit passed`: 220 solids, 36 tube runs, 349 items, every line 0 |
| Anatomy audit in tests | saved outline; every second join; only code-only joins; one random outline: all pass |
| Line ends (`lines.txt`, `anatomy/lines-*.png`) | `line ends: 0` at rest and with a part picked, dark and light |
| 4× close-ups (`anatomy/zoom-*.png`) | crossings, fittings, name plates, folder plate, both themes |
| axe-core, WCAG 2 A/AA + best practice (`screens/browser-output.txt`) | 0 violations on every screen: rest and picked in both themes, the hand-off, the verdict, 390 px in both themes |
| D07-04 text-overlap check | 0 overlapping pairs, 0 text outside its box: form, card and lists in both themes, card at 390 px |
| 390 px | no sideways scroll (scrollWidth 390), at rest and with a part picked, both themes (`screens/phone-390-*.png`) |
| Reduced motion | 0 running animations; no idle tour |
| Click-through ($0, every model mocked) | outline (4 s) → machine → pick → card → hand-off with `redactSecret` picked → Wonder's 2 tests (1 refused by the gate) → bet → run → verdict: outcome and returned value matched for you and Muse Spark (mocked), the time bet declined → "can't check" |
| Tests | 13 model/figure tests, 7 server and React tests, 3 stress tests (below); full suite 1356 passed ×3, tsc clean |

What the new tests prove:

- `tests/unit/x2-explorer.test.ts`:
  - `model.ts` imports types only.
  - The route's answer type is exactly the explorer's input.
  - Boxes are exactly the confirmed parts. Lines are exactly the confirmed and code-only joins, and the drawn SVG
    carries `data-line` for exactly those.
  - A model-only join is never a line, with the right words for "could not check" vs "found no link".
  - whole-file, type-only, cantMap, cantCheck and no-outline cases.
  - An unconfirmed part gets no box and no line.
  - Folder decks.
  - Which functions are offered for betting, and the reasons.
  - Name markup is escaped.
  - The audit passes.
- `tests/unit/x2-explorer-server.test.tsx`:
  - **Server round-trip with a mocked Wonder:** upload `server/meta` → outline job → `/outline` → the figure draws
    exactly the confirmed and code-only joins → the file from `/atlas` goes through `POST /paste`, and the paste
    reader finds `redactSecret` with no "can't check".
  - Another session gets 404 on the job.
  - **A 3,000-call function handed off from the explorer:** the run measures `calls:f = 3000` exactly, the trace is
    cut at the cap, and the call timeline says "more events than Atlas keeps" instead of drawing.
  - **React hand-off:** the paste flow sends the file once and picks the export. A missing export is said and not
    picked. The explorer hands over the file text and function from `/atlas`. The saved outline's bet buttons are
    disabled with the reason.
- `tests/unit/x2-explorer-stress.test.ts`: 50 random outlines are all drawn with every line, one random outline passes
  the audit, and the chalk wording is said once.

## Live spend ($0.996 of the $1 limit)

| Call | When (UTC) | Result | Cost |
|---|---|---|---|
| Muse Wonder outline, real server, run 1 | 07:43 | 11 of 11 parts, 24 lines; the click-through stopped on my test script's hard-coded part name | $0.320 |
| Muse Wonder outline, run 2 | 07:44 | drawn (`live/live2-rest-1920-light.png`); the card showed the wrong part because of the scroll bug | $0.321 |
| Muse Wonder outline, run 3 (bets mocked) | 07:47 | 16 parts; **not drawn**, honestly reported; led to the router fix | $0.355 |

`live/usage.jsonl` is the server's own billed-usage log for these three calls (tokens and dollars, no key).
**No complete live run with real models end to end was made.** The bet half had real models only through the real
gate, sandbox and judge, with the models mocked. Finishing it needs one more outline call (about $0.33) plus about
$0.05 for real proposals and bets. That is Dami's call.

## Limits and what I am unsure about

- **Line heights and routes are drawing choices**, not data: lines are stacked so none passes through another, and some
  take a side jog or an L. On 2 of 30 random outlines the audit found one "crowding" pair (two lines touch on screen).
- **The router fix is not proven on the exact outline that failed live** (it was not saved). If a new outline cannot
  be stacked, the page still says "could not be drawn" and lists everything; it never draws a line through another.
- Names longer than about 25 characters are cut on the plate with "…" (full name on the card).
- The `roles/` deck sits beside the top folder's deck; deeper folders each get their own deck in path order, wrapping
  into new rows. More than ~10 folders has not been tried.
- A part covering files in two folders stands on the deck of its first file (its second tray is drawn there too).
- Uploads keep relative paths; a picked folder's single top folder is dropped. Not tried with a whole repo.
- The explorer shares the paste flow's session, so the agent log strip shows both.
- Starting the real server removes sandbox folders that are at least 10 minutes old (E3's rule). On this shared
  machine, that removed 13 old folders that may have come from other builders' servers.
- The X2 prototype's evidence (`tests/evidence/X2-proto/`) is kept as it was. Its fixture (r2, 5f28a6c) is no longer
  what the page draws.

## Full suite

Three runs after the last change, all identical: **1356 passed, 35 skipped (107 files), 0 failed**
(`full-suite-1.txt`, `full-suite-2.txt`, `full-suite-3.txt`; the 35 skips are main's own RPC, Modal and network
checks). Before X2 the merged main had 1333 passed. tsc is clean (`tsc-output.txt` is empty).

An earlier batch of three runs failed 2 house wording checks (`d07-04-wording.test.ts`): my code had written
"lines 1–36" and "13 files" by hand instead of with `lineSpan` and `plural`. Both now use the house helpers.
