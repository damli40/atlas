# D05-04: the agent log strip (D11), readable at 1920×1080

Date: 2026-10-27 (WAT) · Node v25.8.1 · headless Chromium (chrome-headless-shell 1208).
Live models: `muse-wonder-1.0` (Investigator, Moonwell) and `muse-spark-1.3` (bets, both rounds). Base fork live.
The RPC URL, its host and the Meta key appear in no file here (checked by script: 0 pieces found in D04-04, D05-04, D05-05).

## What the strip is, in plain words

Every step of a round writes one short line to the session's agent log on the server: a Meta model reading
the code, the gate allowing the experiment, the seal check, each step of the fork run, the judge. The strip
(`web/logstrip/LogStrip.tsx`) shows those lines as they happen, over the SSE route that already existed
(`GET /events/:sessionId`, one long HTTP answer the server keeps writing to). Each row is: time (UTC), who
acted, the Meta model's id when a model acted (D10), and the action in the present tense. Plain-code rows
say "plain code". Nothing else from the event is shown: no token counts, no cost, no ids beyond what the
action text itself says.

## Where to look first

- **[`strip-1080p.png`](strip-1080p.png)**: the real Moonwell round (PR #578, Level 2) after the run and
  after "Ask why", at 1920×1080. Measured in the page (from [`browser-output.txt`](browser-output.txt)):

  | Check (acceptance) | Measured |
  |---|---|
  | font ≥ 22 px at 1920×1080 | smallest row font **22 px** |
  | one line per event | every row one line (21 rows: 20 events + the "Ask why" dropped line) |
  | model id on every model line | `muse-wonder-1.0` on the Investigator row, `muse-spark-1.3` on the Claimant row |
  | 12 most recent visible without scrolling, newest at the bottom | 24 rows fit in the panel; all 21 fully visible; the newest is visible |
  | role label + time | on every row |

- **8 of the 21 rows end in "…"** at this width: actions longer than the panel (for example the gate's
  "verifies finding … quoted snippet found there"). The full text is in the row's hover title and in the
  round's `.atlas.json`. Keeping one line per event was the rule; the cost is that long actions are cut.
- **Before the run** ([`strip-1080p-before-run.png`](strip-1080p-before-run.png)): 10 rows. Neither the
  person's 2200 nor any model bet value is on the strip (checked in the browser and by two unit tests).
  Spark's line reads "bets on Tu6JFyOQKF (1 answers, hidden until the run)".
- **On a 390 px phone** ([`strip-390.png`](strip-390.png)): the strip sits under the flow and each row
  wraps (time and who, then the action). This screenshot is from a **second Moonwell round with the models
  off** (no Meta call; same fork block), so its strip has no model rows. The page is no wider than the
  screen: the 14-market table was widening the page to 532 px (a D04-04 layout, not the strip); it now
  scrolls inside its card (one CSS rule).
- **Toggle**: the "Hide" button closes the side panel; "Show the agent log" opens it again. Open by default.

## The live round (Oct 27, 07:29 UTC)

| Step | What happened |
|---|---|
| Investigator | Wonder read the 6 PR files and proposed 3 places: ChainlinkOracleConfigs.sol 44–53 and 142–144, mip-x43.sol 147–169. Plain code verified all 3, removed 0. None is the cbETH line (41–43): the same as D04-03 and D04-04 |
| Finding | The driver picked line 42 (the cbETH config line) as a person, as it always does in this script |
| Bets | Person: 2200 USD. Spark (D19 context: fork block and its date, no prices): **declined**, "unknown: cbETH USD price at fork block 2026-02-15 is after knowledge cutoff and depends on live oracle state" |
| Run | Fork of Base at 42194662, control passed, cbETH read $1.12, reference $2,206.68. The fork took ~5 s (anvil's cache was warm) |
| Verdicts (src/judge.ts) | Person: didn't match. Spark: can't check (the bettor declined) |
| Caption (M7, plain code) | "the cbETH line was picked by a person; the Investigator pointed elsewhere": true for this file, whose 3 verified Investigator places are recorded in it |
| `.atlas.json` | [`../D04-04/moonwell-level2-mwTaxvHFzB.atlas.json`](../D04-04/moonwell-level2-mwTaxvHFzB.atlas.json), verifies |

The session's 20 events are saved in [`moonwell-session-events.json`](moonwell-session-events.json) (taken from
that round's `.atlas.json`) and drive the unit-test snapshot.

**Cost of this task: $0.3032**, 3 calls (Spark fixture $0.0290, Wonder PR $0.2499, Spark PR $0.0243), logged in
`tests/evidence/usage/usage.jsonl`. The run had a spend ceiling of $4.40 on the server (the log's total before was $3.47).

## Tests

`tests/unit/logstrip.test.tsx` (7 tests):
- snapshot of the strip's rows for the real Moonwell events (`__snapshots__/logstrip.test.tsx.snap`), 20 rows;
- every model row names its model, no other row does; rows in the server's order, newest last;
- each row's text is exactly time + who + model id or "plain code" + action (no usage, no cost);
- toggled off: no rows, one button;
- **no bet value before the run**: the recorded real events up to the run's start (no 2200, no "declined"),
  and a round through the real server (in-process) with a mocked Spark answering 1987.65 with a marked
  rationale: the events streamed before the fork returned carry neither, while the run's answer reveals the value.

## Commands

| Command | Output | Result |
|---|---|---|
| `( set -a; . ~/.config/atlas/rpc.env; set +a; ATLAS_SPEND_CEILING_USD=4.40 ATLAS_PUBLISH_PROOFS=1 ATLAS_PROOFS_DIR=<scratch>/proofs-live pnpm exec tsx server/index.ts )` and `pnpm exec vite --strictPort` | not kept | live server, files written to a scratch folder only |
| `PW=<playwright-core> node drive.mjs <chrome-headless-shell> .` | [`browser-output.txt`](browser-output.txt), 3 PNGs here + `../D05-05/fixture-why-1080p.png` | both rounds complete, page errors: none |
| the 390 px round (models off) | `strip-390.png` | page width 390 = screen |
| `pnpm test` | [`test-output.txt`](test-output.txt) | 41 files, 441 passed, 16 skipped (RPC tests skip) |
| `pnpm test` with the RPC loaded | [`test-output-rpc.txt`](test-output-rpc.txt) | 41 files, 454 passed, 3 skipped |
| `npx tsc -p .` | [`tsc-output.txt`](tsc-output.txt) | clean |
| `pnpm gate:day1` | [`gate-day1.txt`](gate-day1.txt) | 18 matched, 1 didn't match, 1 can't check (unchanged) |
| `npx vite build` | [`vite-build.txt`](vite-build.txt) | built |

## What I did not do, and what I am unsure about

- The 22 px and "12 lines visible" were measured in headless Chromium at 1920×1080 with device scale 1. A
  real screen recording at another zoom level was not tried.
- The "dropped: no run evidence" line lives in the page only. It is not an agent event on the server and is
  not in the `.atlas.json` (the event shape has no role for the linker). A replay of the file will not show it.
- The fixture's stand-in line "uses a fixture finding, written by hand (Investigator arrives Oct 30)" is
  older server text (`server/log/round.ts`), shown as written; the Investigator already exists. Not changed here.
- The strip finds the session id by asking the page's API client every 300 ms until the first answer arrives.
- Times are UTC (the header says so), not WAT.
