# X2: the code explorer (full build)

Date: 2026-10-28 (WAT) · live spend: **$0.996** in the first version, **$0.506** in review round 1 · Node 25.8.1 · main merged at 878deeb (G1 invite codes).


## Review round 1 (read this first)

The review found 4 blockers, 4 majors and 6 minors (report: `scratchpad/review-X2.md`, not in the repo). The core trust
rules held. Everything below is fixed. "Where to look first" further down describes the first version; where it
disagrees with this section, this section is right.

### What changed, in one paragraph each

- **B1 (the idle tour could swap the bet button under a still pointer).** The live screen has **no idle tour at all**
  now: the picked part changes only when the reader picks. The saved demo page keeps its tour, but it stops for good on
  any pointer, click, focus, key, wheel or touch anywhere in the figure, card or lists. Tested with motion ALLOWED: a
  unit test (30 s of fake time, card unchanged), and the browser harness (13 s with the pointer resting on "Bet on
  redactSecret", card unchanged).
- **B2 (a "data" join showed a direction plain code never checked).** A data join now shows **↔** and says "plain code
  found a use between these parts (it did not check the direction)". Joins are drawn **one line per code link**: a join
  whose code links are all shown by a line between the same two parts shares that line ("same line as the imports
  join"), and a second copy of the same join is not drawn again (also minor 2).
- **B3 (a part spanning folders swallowed other folders' decks).** Every file's tray sits on its own folder's deck. A part
  whose files lie in several folders is drawn as **one box per folder** ("1/6 Spans many folders" …). The boxes are one
  part: one hit target, picked and lit together. Lines land on the box with the most lines. The screen-reader label
  counts folders, files, parts and boxes truthfully. The reviewer's 6-folder fixture now gives 6 decks, 12 trays, and
  13 parts drawn as 18 boxes.
- **B4 (a 40-part, 156-join outline froze the tab for 65 s).**
  1. The router was rebuilt: which fittings each candidate route passes over is computed once, and heights use one
     crossing table. 156 joins: 41 s → 4.5 s in Node.
  2. A size budget: past 90 joins or 40 parts, or 24 stacked heights, the page says "Too many joins to draw: … Showing
     the list instead" and lists everything. That takes under 1 ms (tested). A counted router budget backs it up.
  3. The live screen builds the figure in a **Web Worker** (`figure.worker.ts`), shows "Drawing the machine for N parts
     and M joins… s" meanwhile, and gives up with the list after 30 s. The page stays responsive.
- **M1 (names 6.6 px at 1920).**
  - In explore mode the agent log moves under the figure, and the figure takes three quarters of the width.
  - Plate text is 4.4 units (was 2.8). Rows are wider (150 units, was 92), so decks no longer stack into a long
    diagonal.
  - **Measured in the browser at 1920×1080: name plates 12.3 px tall, folder plates 8.5 px**, in both themes
    (`screens/browser-output.txt`, `screens/checks.json`). Measured as font size × the screen scale of the text's own
    vertical axis, the reviewer's method.
  - Long names are still cut with "…" (for example "Claimant and fixtur…"); the card has the full name.
- **M2 (stale "From the explorer" note).** It clears on any edit of the code box, on "Read it" when the code changed,
  and on restart.
- **M3 (local paths in evidence; stress test timing).** The suite outputs are regenerated with the repo path replaced
  by `<repo>`. The stress test draws 25 random outlines (was 50) plus the audit on seed 7.
- **M4 (expired job read as a bug).** A 404 on the job now says "This outline expired (outlines are kept 30 minutes).
  Run it again." with a **Run it again** button that repeats the same request, and the bet buttons are disabled with
  that reason.
- **G1 (merged main 878deeb).** When the invite gate answers 401 ("Atlas needs an invite code …"), the explorer and the
  paste flow show the server's sentence with a link, **Enter your invite code** (`/api/invite`, the gate's own page
  through the dev proxy). The explorer and the hand-off use the same routes, so they need a code exactly where G1 says.
- **Minors.**
  1. The ruler strip is gone. Its long ticks floated on large figures, and box width no longer measures lines.
  2. Duplicate joins: see B2.
  3. The readout says "N joins drawn", not "lines".
  4. The caption says Wonder proposed the parts and wrote the names; plain code found the joins (N of them Wonder did
     not name); a box "grows taller" (7 + 1 per 45 lines), not "as tall as".
  5. Unconfirmed parts are named by Wonder's name ("Secret redaction (not confirmed)"), never a raw id. The saved page
     now also lists "Joins found but not drawn".
  6. Seed 7's crowding: a line whose bend or end lands on another line on screen is lifted to a higher height and the
     figure drawn again (at most 3 times). Seed 7 now passes the audit (a test).

### Checks after the fixes

| Check | Result |
|---|---|
| Reviewer's `check.mjs` with `AUDIT=1` (`review1/check-mjs-output.txt`) | 0 problems and **audit passed** on saved, hostileNames, circular, spanFolders, dataReversed and unconfirmed, and on **random seeds 1–30 (30 of 30, seed 7 included)**. big40x10pct (152 joins after de-duplication), big20all (190) and big40all (780): "too many joins to draw clearly", instantly. |
| Anatomy audit, saved outline (`audit.txt`) | `audit passed` |
| Line ends (`lines.txt`) | 0 on the saved page at rest and picked, both themes; 0 on the reviewer's hostileNames, circular, spanFolders and dataReversed pages (were 4, 3, 0 and 10) |
| Browser harness, every model mocked (`screens/browser-output.txt`) | 41 checks passed, 0 failed: axe 0 violations on every screen, overlap 0, no sideways scroll at 390 px in both themes, reduced motion still, names 12.3 px, no tour with motion allowed, outline → pick → hand-off → verdict |
| Tests | `x2-review1.test.tsx` 14 new (one per finding), plus the earlier X2 tests updated; full suite: see "Full suite" |

### The live run (real models, $0.506)

One run on the merged code after the fixes. It went from outlining Atlas's `server/meta` at 058ab2a, to picking a part,
to betting on `redactSecret` with Muse Spark and Muse Spark Open, to the verdict. Screenshots are in
`live-review1/` (`film-rest`, `film-selected`, `card`, `film-handoff`, `film-verdict`). The billed usage is in
`live-review1/usage.jsonl`.

- **Outline:** a real Muse Wonder answer, 12 of 12 parts with lines confirmed. 23 lines drawn and 1 chalk tag, so this
  run had one join only Wonder named. Drawn in the browser; outline job to drawn machine about 30 s.
- **Pick and hand-off:** Wonder named the part holding `redactSecret` "Meta API client and secret redaction" (a part
  spanning `client.ts` and `redact-secret.ts`). "Bet on redactSecret" opened the paste flow with `redact-secret.ts` and
  `redactSecret` picked.
- **Proposals:** Muse Wonder proposed 3 tests, and the gate allowed all 3. Test 1 was
  `redactSecret("leak: abcdefghijklYYYYYYYYYYY end", "abcdefghijklXXXXXXXXXXXXabcdefghijklYYYYYYYYYYY")`.
- **Bets:** the person (my script) and both models. Muse Spark 1.3's first answer was not usable, and its one repair
  try was.
- **Verdict:** the judge judged 8 bets: **6 matched, 2 didn't match**.
  - The code returned `"leak: [redacted]YYYYYYYYYYY end"`.
  - Muse Spark matched all 3 questions.
  - Muse Spark Open matched 2: outcome and returned value. Its time bet did not match.
  - My script's fixed guess for the returned value did not match.
- **Cost: $0.5064, over the $0.50 limit by $0.0064.** Outline $0.3233, Wonder's proposals $0.1064, Muse Spark Open
  $0.0066, Muse Spark $0.0409 + $0.0292 (its repair try). I expected about $0.40. The proposals call and Spark's repair
  cost more than I allowed for.
- **What this run changed on this machine:**
  - My first two attempts to start the live server used the default invite store, `~/.config/atlas/`, before I pointed
    `ATLAS_INVITES_DIR` at a scratch folder. They created an empty ledger there (`spend.json`, all zeros, 13:23 WAT).
    I left it in place.
  - Starting the server also removed sandbox folders older than 10 minutes in the temp folder (E3's startup rule).

## First version: where to look first

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

## Full suite (after review round 1)

Three runs on the final code: **1435 passed, 35 skipped (111 files), 0 failed, all three identical**
(`full-suite-1.txt`, `full-suite-2.txt`, `full-suite-3.txt`; the repo's path is written `<repo>`). Main at 878deeb had
1397 passed. tsc is clean (`tsc-output.txt` is empty).

The first batch of three runs after the fixes failed once in runs 2 and 3. The M4 React test timed out at vitest's
20 s default while the whole suite loaded the machine (it builds the figure twice). Every X2 test that builds a figure
now has a 120 s limit.
