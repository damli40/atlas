# D21: the pre-existing-logo caption under the scoreboard

Date: 2026-10-27 (WAT) · no model call ($0).

## Where to look first

- Under the scoreboard, everywhere it is drawn, the page now says: **"Mark: the Atlas logo, designed Oct 26
  (pre-existing). The scoreboard that draws it from the verdicts was built during the hackathon."**
- The caption lives inside the `Scoreboard` component (`web/machines/scoreboard/Scoreboard.tsx`), so no screen can draw the
  scoreboard without it. Places it renders today: the verdict screen (shared by the fixture flow and the Moonwell flow) and
  the proof card, which is the end frame.
- **Overlap check: 0 overlapping text pairs, 0 text outside the card** on both proof cards at 1920 and 390 px, the Moonwell
  verdict section, and the Moonwell bet section (new: it now holds the D22 chain facts) at full width and 390 px. 0 axe
  violations; no horizontal scroll at 390 px; no page errors (`playwright/browser-output.txt`).
- **One correction to the checker, said plainly:** the first re-run reported 19 (full width) and 23 (390 px) overlaps in the
  bet section. The screenshot (`playwright/moonwell-bet-chain-facts.png`) shows none: every pair involved text inside the
  collapsed "What you know before betting" box. Chrome gives text in a closed `<details>` layout boxes even though it is not
  shown, and the checker counted it. `tests/evidence/D07-04/drive.mjs` now skips text in a closed `<details>` (its summary
  line is still checked). The first output is kept: `playwright/browser-output-before-checker-fix.txt`. No other section
  changed result between the two runs.

## Tests

`tests/unit/d21-mark-caption.test.tsx`:
- the caption is word for word D21's text;
- verdict screen and proof card, each from a real recorded fixture round and a real Moonwell round: the caption is the
  element right after the scoreboard, visible (not `hidden`, not `aria-hidden`); on the proof card it is inside the hero
  section with the mark;
- no file under `web/` draws the mark (`<Mark>`), computes the marks, or builds a `.sb` block except the Scoreboard
  component itself (and `marks.ts`, which only computes the geometry).

On the old Scoreboard the 4 render checks fail and the 2 others pass (`test-on-old-code.txt`). The two D05-01 snapshots
were updated: the only change is the caption paragraph after the marks.

## What this proves

- Wherever the scoreboard renders in the app today, the caption is under it, and a new screen that uses the component gets
  it too.

## What this does not prove

- Frames made outside the app (a video edit, a deck slide, an X image) are not covered: they must carry the caption by hand.
- The overlap check covers the sections listed above, not every screen at every width.

## Files

- `test-on-old-code.txt`
- `playwright/`: the D07-04 click-through re-run (`tests/evidence/D07-04/drive.mjs` against `mock-server.ts` and Vite;
  models mocked, real fork, real judge): `browser-output.txt`, `checks.json`, PNGs including
  `proof-card-*-1920.png` (the caption under the mark), `moonwell-bet-chain-facts.png`, and
  `browser-output-before-checker-fix.txt`.
- Re-run: BASE_RPC_URL in the environment, `pnpm exec tsx tests/evidence/D07-04/mock-server.ts` and
  `pnpm exec vite --strictPort`, then `PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> node tests/evidence/D07-04/drive.mjs <chromium headless shell> <out dir>`.
