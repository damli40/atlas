# D07-04: polish, accessibility, phone width, reduced motion

Date: 2026-10-27.

## In plain words

The screens now say "line 42" (not "lines 42–42"), "1 answer" (not "1 answers"), and who proposed a change
the way it happened: "Muse Code (muse-spark-1.3)" when Muse Code ran, "Muse Spark 1.3 (chat fallback)" when
the fallback ran. The proof card, the film's end frame, now opens with the scoreboard (the Atlas mark) large
and centred, then one line per bettor with how it came out, then the table. Every screen was clicked through
in a real browser against the running app and checked for accessibility, phone width and motion.

## How the PNGs were made: models MOCKED, $0

`mock-server.ts` starts the real Atlas server (real gate, real TypeScript sandbox, real Base fork at block
42194662, real judge, real seals, real proof cards) with every model answer **mocked**. No Meta, Baseten or
`muse` call was made. What the mocks answer:

- Muse Spark's bets: withRpcRetry → calls 6, total wait 15000 ms, throws; Moonwell → declined. Each bet's
  rationale on screen says "(mocked for the D07-04 screenshots: no model was called)".
- Muse Code's change: the diff Muse Code proposed live in D06-01 / D20 (`cbETHETH_ORACLE` → `cbETH_ORACLE`),
  reported as model `muse-spark-1.3`. So the Change screen's "Change proposed by Muse Code (muse-spark-1.3)"
  is a **replayed answer**, not a new one. The fork, the replay and every verdict are real.
- Investigator and Adversary: off ("not asked").

`drive.mjs` drives headless Chromium through the app (Vite + that server). The person's bets are typed by the
script: withRpcRetry S3 = calls 5, wait 12000, throws; Moonwell Level 2 = $2,200 on line 42 (picked by the script).

## Results (`browser-output.txt`, `checks.json`)

| Check | Result |
|---|---|
| Accessibility: axe-core 4.10.3, WCAG 2.0/2.1 A + AA + best-practice rules, whole page | **0 violations** on all 8 pages: drop (withRpcRetry, Moonwell), verdict (withRpcRetry, Moonwell), change and replay, proof card (withRpcRetry, Moonwell) |
| 390 px wide: no horizontal scroll | **none** on drop (both), verdict + change (withRpcRetry), Moonwell file picker, many-callers screen, both proof cards |
| prefers-reduced-motion | **0 running animations** on every page above (also a global CSS rule in `web/styles.css`) |
| Overlap check (text boxes of different elements must not intersect; no text outside the card) | **0 overlapping pairs, 0 outside** on both proof cards at 1920 and 390, and on the Moonwell verdict section |
| The mark on the proof card at 1920×1080 | Moonwell (one question): **300×300 px**; withRpcRetry (three questions): **240×240 px** each, in one row. Centred in the left column |
| The claimant toggle | locked while the round is open, unlocked after its run |
| Page errors | none |

Before the fixes the first axe run found: low contrast on the machines' corner labels (`iso.css`),
scroll boxes not reachable by keyboard (code blocks, the log strip), and no `main` landmark on the proof page.
All three are fixed. At 390 px the proof card's tables broke words mid-word ("decline d"); fixed in `proof.css`.

**Lighthouse was not run** (it is not installed here). The score above is axe-core's, run through Playwright,
which the task allowed. axe gives violations, not a 0–100 score.

## Correction: the first proof-card PNGs had overlapping text

The 1920 px proof cards in the previous commit (3c04e64) were wrong, and I reported them as fine. My own
accessibility fix caused it: I made the proof page a `<main>` element, so it picked up the app's
`main { max-width: 760px }` rule. The card shrank to a ~730 px column, and the details block (target, code
fingerprint, fork, control) was drawn over the results table. axe does not check overlap, so it passed.

Now: from 1200 px wide the card is ~1600 px with two columns (mark, bettor lines and table on the left, ~60%;
details, captions and seals on the right). Below 1200 px everything stacks. `drive.mjs` now runs an overlap
check on both proof cards at 1920 and 390 px. On the old CSS it finds exactly the 3 overlaps that were
visible (`overlap-check-on-old-css.txt`: "the bettor declined" × "@ 9a6738e189", "didn't match" × "control",
"outcome" × "target").

## PNGs

| What | File |
|---|---|
| withRpcRetry verdict | `fixture-verdict.png` (`fixture-verdict-full.png` = whole page) |
| retry machine | `fixture-retry-machine.png` |
| Moonwell Level 2 verdict | `moonwell-verdict.png` |
| price pipe | `moonwell-price-pipe.png` |
| market table (false-alarm table) | `moonwell-market-table.png` |
| D20 change and replay ("in theory") | `moonwell-d20-change-replay.png` (`moonwell-full.png` = whole page) |
| proof card, 1920×1080 | `proof-card-fixture-1920.png`, `proof-card-moonwell-1920.png` (`-full` = whole card) |
| proof card, 390 px | `proof-card-fixture-390.png`, `proof-card-moonwell-390.png` |
| other screens at 390 px | `drop-fixture-390.png`, `verdict-fixture-390.png`, `drop-moonwell-390.png`, `scale-390.png` |

## Final checks

`test-output-offline.txt` (725 passed, 18 skipped), `test-output-rpc.txt` (739 passed, 4 skipped),
`tsc-output.txt` (empty = no errors), `gate-day1.txt`, `vite-build.txt`.

## What this does not do

- The market table's rows still say "2 price source(s)". That text is part of the false-alarm table stored in
  each Level 2 `.atlas.json`, and verify rebuilds it and compares; changing it would make every recorded
  Level 2 file fail to verify. The run facts above the table now say "1 price source".
- Agent-log lines inside files recorded before today keep the words they were recorded with ("lines 42–42").
- Re-run: BASE_RPC_URL in the environment, `pnpm exec tsx tests/evidence/D07-04/mock-server.ts` and
  `pnpm exec vite --strictPort`, then `PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> node tests/evidence/D07-04/drive.mjs <chromium headless shell> <out dir>`.
