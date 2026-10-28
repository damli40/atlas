# X2 prototype: the code explorer, drawn with the Anatomy skill from Atlas's own `server/meta`

Date: 2026-10-28 (WAT) · no model call · built from one saved outline record, offline.

## Where to look first

- **The picture:** `desktop-light.png` (whole machine), `picked-fixer-role-light.png` (one part picked, with its
  lines lit, including one plain-code-only line with tag collars), `picked-fixer-role-card-light.png` (the card
  that names Wonder as the author of the words). Dark: `desktop-dark.png`, `hover-dark.png`.
- **The rule that matters:** the machine draws a box only for a part plain code confirmed, and a steel line only
  for a join plain code found. A join only Wonder states is never a line; it is a chalk tag in the list under the
  card (`chalk-list-dark.png`). Tests prove it (below).
- **Proofs of the drawing:** `audit.txt` ends `audit passed` (every line 0), and the line-end check prints
  `line ends: 0` on the dark page, the light page and with a part picked.

## The object

An instrument skid: a base plate on feet carries one tray per source file. On the trays stand instrument boxes,
one per confirmed part. Where plain code found that one part imports or calls another, a bent steel line runs
from a fitting on one box's lid to a fitting on the other's.

What each physical thing means, and where its number comes from:

| On the machine | In the code | Source in the record |
|---|---|---|
| A box | A part plain code confirmed (its line ranges exist) | `parts[].status == "confirmed"` |
| Box width | Lines the part covers: 10 units + 0.65 per 10 lines | sum of `parts[].ranges` |
| A tray | A source file | the files the boxes' ranges name |
| Two boxes on one tray | Two parts cut from one file (`client.ts`, `roles/fixer.ts`, `roles/claimant.ts`) | `splitFiles` |
| A box standing across two trays | A part covering two files (`claimant-shared`: `roles/claimant.ts` 1–302 + `roles/fixture-finding.ts` whole) | its two ranges |
| A range plate on a box front | One line range of the part | `parts[].ranges` |
| A steel line, thick | A `calls` join plain code found | `joins[].kind`, `status` |
| A steel line, thin | An `imports` join plain code found | same |
| Two tag collars on a line | Found by plain code only; Wonder did not name it (2) | `status == "code-only"` |
| Chalk tag in the list (not on the machine) | Wonder says this; plain code could not check it (2) | `status == "model-only"` |
| An empty tray | A file in no part (none here) | `notInAnyPart` |
| Ruler on the base | Lines at the boxes' scale: a tick per 50 lines | `widthOf` in `build.mjs` |

The height of each line above the boxes is not data: plain code (the build) picks it so that no line passes
through another line's fitting or another line. Lines whose arch would be seen edge-on take a sideways jog so the
bends do not pinch on screen.

## What is drawn, what is not

- **Drawn:** 12 boxes (all 12 parts are confirmed), 10 trays, 21 steel lines: 19 confirmed (Wonder named them and
  plain code found them) and 2 code-only (`claimant-role → client-transport`, `fixer-role → client-transport`).
- **Not drawn as a connection:** 2 Wonder-only joins (`budget → client-pricing-policy`,
  `claimant-shared → client-transport`). They are in the list under the card as dashed chalk tags with the words
  "Wonder says this; plain code could not check it". `Model-call budget` therefore stands alone: no line touches it.
- **Every sentence is Muse Wonder's (D10):** the card shows each part's name and purpose with
  "muse-wonder-1.0 says what this part is for:" and "Name by muse-wonder-1.0", followed by
  "Plain code checked that these lines exist. It did not check the sentence above."
- **Plain code's note** is shown on the two confirmed joins whose Wonder quote did not match the line
  (`wonder:1`, `wonder:3`).

## Size

189 recorded solids (the base plate, 10 trays, 12 boxes with handles, 42 fittings of two parts each, 42 end nuts,
4 tag collars), 21 lines in 25 drawn runs, 258 depth-sorted items. A Hero by the skill's sizing.

## Checks run

| Check | Command | Result |
|---|---|---|
| Geometry audit | `pnpm tsx web/machines/explorer/build.mjs --audit` | `audit passed`: clearance 0, terminals 0, folds 0, support 0, depth order 0, self-overlap 0, crowding 0, stand-in shapes 0 (`audit.txt`) |
| Line ends, dark | `node ~/.claude/skills/anatomy/scripts/lines.mjs web/machines/explorer/explorer.html --out lines-dark.png` | `line ends: 0 of 106 ends on 100 lines float` |
| Line ends, light | same on `explorer-light.html` | `line ends: 0 of 106 ends on 100 lines float` |
| Line ends, part picked | `drive.mjs … ["key","ArrowRight"] … ["lines", …]` | `line ends: 0` (`lines-picked-light.png`) |
| Desktop 1440 | `capture.mjs` | `desktop-light.png`, `desktop-dark.png`; console clean; no sideways scroll |
| Phone 390 | `capture.mjs --width 390` | `phone-390-light.png`, `phone-390-dark.png`; no sideways scroll |
| 4× close-ups | `capture.mjs --zoom …` | `zoom-a/b/c/d-{light,dark}.png`: crossings, fittings, a jogged line, tag collars, ruler and file tags |
| Reduced motion | `capture.mjs --reduced --times 5000` | readout unchanged after 5 s: no idle tour (`reduced-dark-5000.png`) |
| Keyboard | `drive.mjs` with Tab focus + ← → + Escape | `picked-*.png` |
| Tests | `npx vitest run tests/unit/x2-explorer.test.ts` | 13 passed |
| Full suite | `npx vitest run` | 1209 passed, 35 skipped, 0 failed |
| Types | `npx tsc -p .` | clean |

What the tests prove (`tests/unit/x2-explorer.test.ts`): `model.ts` imports types only; boxes are exactly the
confirmed parts; lines are exactly the confirmed and code-only joins; model-only joins are never lines (also when
every join is model-only, and when one confirmed join is turned model-only); an unconfirmed part gets no box and no
line lands on it; nothing is drawn when the outline could not be checked; the built page carries `data-line` for
exactly the drawn joins and `data-chalk` for the Wonder-only ones; a part name that looks like HTML is written as
text.

## What it does not show, and what I am unsure about

- **Per-join evidence lines are not in the record.** The fixture keeps how many code-map links show a join
  (`codeEdges`), not the lines. The card says "8 code links", not "client.ts 241, 255…". Plain code's note on
  `wonder:1`/`wonder:3` says "the code map's own edges are listed instead"; this page lists only their count.
- **The layout is made for this record.** Rows break only between files; a box covering two files is placed
  before its second file's tray. A part covering two files that are both also covered by other split parts would
  get a second tray piece for one file (it is drawn, but the tray is in two pieces). Not exercised here.
- **Line heights are a build choice,** not data (see above). A different record could make the tier ordering
  impossible; the build then stops with "tier cycle among lines" instead of drawing lines through each other.
- **No `roles/` subfolder grouping** on the base: the 6 `roles/*` trays are mixed with the 4 top-level ones.
- **The idle tour** (a new box every 4 s when nobody touches the figure) was not filmed; it is off under reduced
  motion and while offscreen.

## What X2 still needs

1. **Live data from the server:** the page reads one saved record through `build.mjs`. X2 needs the server's
   outline job (X1) to hand the verified outline to the page, and the machine to be built per codebase, in the
   browser or as a server route. The model (`model.ts`) already takes the record as its only input.
2. **"Bet on this part":** a bet button on the card of a picked part, sealed the way bets are sealed today, so the
   explorer leads into a round.
3. Evidence lines per join in the record, so the card can show the real calls, not only their count.
4. A React wrapper in the house style (`web/machines/*`), if the explorer moves into the app shell.

## Files

- `web/machines/explorer/outline-data.ts`: the record's shape (types only, narrowed from X1's `src/outline/types.ts`).
- `web/machines/explorer/model.ts`: pure model, types-only imports.
- `web/machines/explorer/build.mjs`: geometry, audit hook, page. `explorer.html` (dark), `explorer-light.html`.
- `web/machines/explorer/live.js`, `explorer.css`: picking, card, idle tour.
- `web/machines/iso/{iso-kit,lathe,tube,audit}.mjs`: Anatomy kit modules (MIT, same LICENSE as `iso-kit.ts`).
- `tests/fixtures/outline/atlas-server-meta.r2.json`: the input.
