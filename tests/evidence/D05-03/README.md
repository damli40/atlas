# D05-03 · The price pipe (an Anatomy "Figure", 53 parts)

**What this is, in plain words.** After a Moonwell run, the run screen shows a small machine on a bench. It is drawn from that run alone:
- **Feed canisters at the inlets** stand for the price feeds the oracle's read actually came through. Each inlet duct is engraved with the feed's name: the feed's own on-chain description (`feedDescription`), or, when the feed has none, the raw Chainlink pair found by matching the call trace to the feeds the reference read.
- Both inlet ducts run into a **gear housing** with a round **slot** on top. A **multiply gear** sits in the slot only when the run's call trace counted **2 price sources** (`priceSources:<symbol>` = 2). With **1** source there is no gear and the unused inlet is blanked. The slot then shows a **dashed empty outline**, drawn from `Bet[]`: it is the bettors' expectation (each bet asked for a USD price), not a statement about the code. When the count was **not measured**, the slot is drawn plain, with "not measured" under the card: no gear and no dashed outline.
- The **gauge** is a log dial from $0.01 to $10,000. The long needle shows `priceUsd1e18` (the text comes from `src/units.ts`'s `formatUsd1e18`). The smaller needle is the **reference (raw Chainlink, same block)**. If the known-case control did not pass, the dial is engraved "can't check" and no needle is drawn.
- **Bet marks on the rim** come from `Bet[]` only: a solid dot for the person and a ring for a model. A matched bet's mark turns strong at the end. A declined model bet gets no mark, and the caption says "declined".
- The readout is built from data, for example `cbETH read $1.12 · reference $2,206.68 · 1 price source`. The caption under the card opens with the Level caption the run earns: Level 2 if its trace applied the proposal's feed actions, otherwise Level 1 (`re-run after the fact, on a fork of Base at block …`). It never says "caught before shipping".

The files follow the D05-02 split, in `web/machines/pricepipe/`: `model.ts` (pure; it imports the input types and `formatUsd1e18` only), `geometry.ts` (layout, every static path, `PARTS`), `art.tsx` (static parts), `live.tsx` (the parts the run decides, plus one loop that moves the lit part, flow beads, gear and needles through refs), `PricePipe.tsx` (the card). It is wired into the Moonwell screen (`web/screens/Moonwell.tsx`) for every EVM run, between the run facts and the verdicts. The plain market table stays where it was.

## The four data cases (`tests/tools/pipe-cases.ts`, drawn from in `cases.json`)
| Case | Source | Drawn |
|---|---|---|
| `level2-count1` | **Real**: D04-04 Level 2 run `mwTaxvHFzB` | 1 price source → no gear, dashed slot, inlet 2 blanked; `cbETH read $1.12 · reference $2,206.68 · 1 price source`; person $2,200 (didn't match); Spark declined (no mark) |
| `pre-apply-count2` | **Fixture built from the same run**: its own pre-apply read, reference and pre-apply call trace (`preApplyPriceSources:cbETH` = 2), lifted into a Run; bets re-judged | gear present, inlets `ETH / USD` and `cbETH / ETH`; `cbETH read $2,206.68 · reference $2,206.68 · 2 price sources` |
| `control-failed` | **Fixture**: the same run with `controlPassed: false`; verdicts re-judged by `src/judge.ts` (all can't check) | dial engraved "can't check", no needles; readout `cbETH: can't check (the control did not pass) · 1 price source` |
| `level1-not-measured` | **Real**: D03-03 Level 1 run `U6Gk6cu_i0` (block 42194663), with its bet | Level 1 never traced its sources → plain slot, "Gear slot: not measured"; Level 1 caption |

The two fixtures say so in their caption on the card (`captionOverride`, used for evidence only).

## What this proves
- `test-output.txt` (`tests/unit/machines-pricepipe.test.tsx`, 8 tests):
  - `model.ts`'s imports are exactly `import type { Bet, Run, Verdict }` and `import { formatUsd1e18 }`. No fetch, clock or randomness.
  - **Manifest** (`manifest.txt`): 53 parts. Every `data-part` drawn is in the list, and across the four cases every listed part gets drawn. No part or class name contains bug, missing, broken, wrong, error, fault, fix or correct.
  - Count 1 (real run): the test counts the sources straight from the trace's post-apply `call_trace` (1, equal to the measured value). No `multiply-gear` or `gear-hub` is drawn; a `data-dashed` ghost outline and the blank plate are. Both needles sit at their values, there is 1 person mark and 0 model marks, the caption says "muse-spark-1.3: declined (no mark)", and the Level caption equals `LEVEL2_CAPTION`.
  - Count 2 (fixture): its price and count equal the real run's `preApply*` fields. Gear, hub, spokes and both canisters are drawn; there is no ghost outline. The gear turns a third of a turn during the story.
  - Control failed: no needle parts, the dial says "can't check", and every verdict is can't check.
  - Not measured (real Level 1): no gear, no dashed path anywhere, "Gear slot: not measured", the caption equals `level1Caption(42194663)`, and no case's page contains "caught before shipping".
  - An explicit `notMeasured` count shows the runner's reason. A count of 1 with no bets gives an empty slot, not a dashed one.
  - Reduced motion: the first paint is the end state (final readout, needles at their values, no flow bead showing).
- `bet-context.test.tsx` now also checks that the Moonwell screen shows the price pipe after a run (fake EVM runner, real server routes).
- `lines-output.txt`: Anatomy `scripts/lines.mjs` prints **`line ends: 0`** on all 14 built pages: 4 end states and 3 held moments of the count-2 story (mid-inlets, mid-gear, mid-needles), each in dark and light.
- PNGs from Anatomy `scripts/capture.mjs`: `pipe-<case>{,-light}-{desktop,390}.png` for all four cases (16), plus `pipe-pre-apply-count2-mid-gear-light-desktop.png` (gear lit while it turns).
- `live-contact-sheet.png`: the real component running in headless Chrome, on a throwaway Vite page (deleted, not committed) that mounted `PricePipe` with the D04-04 run. 12 frames, 420 ms apart. The readout went from "cbETH reading · 1 price source" to the final line, `line ends: 0` held at the end state and again 2 s into a replay, and the console stayed clean.
- Also green: `pnpm test` without RPC (`test-output-no-rpc.txt`: 461 passed, 16 skipped) and with the RPC loaded at runtime (`test-output-rpc.txt`: 474 passed, 3 skipped; output checked for the RPC host before saving); `tsc` (`tsc-output.txt`, empty); `pnpm gate:day1` (`gate-day1.txt`: 18 matched, 1 didn't match, 1 can't check, as before); `vite build` (`vite-build.txt`).

## What this does not prove, and where it differs from the brief
- **No real count-2 run exists yet.** The gear case is a fixture lifted from the real run's pre-apply phase: same block, same numbers, same trace event. The replay-after-a-change run (D06) will be the first real count-2 run.
- **No real EVM run has failed its control.** That case is a fixture too.
- The inlet labels for count 2 come from matching the call trace to the reference's recorded raw feeds, through a two-entry name table in `model.ts` (`ethUsd` → "ETH / USD", `cbEthEth` → "cbETH / ETH"). It does not use the PR config parser, because a Run does not carry that parser's output. A source that matches nothing is labelled with its short address.
- The Level caption comes from the trace: `feed_set` events mean Level 2, otherwise Level 1 with the run's fork block. A replay run without `feed_set` events would get the Level 1 wording. Check this when D06 lands.
- The engraved feed name and the dial numerals are text drawn on faces (Anatomy's "one tiny engraved label" rule is stretched: the dial carries decade numerals and one engraving).
- The Anatomy geometry audit (`kit/audit.mjs`) was not run. As in D05-02, only upright prisms and cylinders are used and painter's order is set by hand. The gear's teeth are sorted far/near against its disc on every frame.
- The flow beads take a straight route along the duct tops. They are story only: the run has no timing for a price read.
- The machine was checked in jsdom, on static pages and on the throwaway live page. It was not checked in a full browser round against the running server with a live fork.
- `PricePipe.tsx` imports `src/atlasfile.ts` for the caption constants. The Moonwell screen already pulled that module into the bundle, so the bundle does not grow from it.
