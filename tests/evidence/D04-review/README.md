# D04-review: fixes for the days 3–4 adversarial review

Date: 2026-10-27 (WAT) · Node v25.8.1 · no live Meta call (every model answer is a mocked `chat()`), nothing written to `proofs/`, `mida` not run. The Base RPC was loaded only for the RPC test run and the concurrent probe, and it appears in no file here (checked by script: 0 pieces of the URL, host, subdomain or key).

The review found 1 blocker (B1), 6 should-fix items (S1–S6) and 10 minors (M1–M10). All 7 main items are fixed, and 9 of the 10 minors. Every fix has a regression test. Each test was also run on the code before the fixes ([`regression-tests-on-old-code.txt`](regression-tests-on-old-code.txt)).

## Where to look first

- **B1** is the one that could put a false claim on screen. Before: a run whose control failed still showed cbETH as **flagged** ("13 unchanged, 1 flagged", with "yes" in the cbETH row). After: every flag cell says **can't check**, the table says the control did not pass and why, and the `.atlas.json` holds the same table. `verify` rebuilds that table from the run, so a stored "flagged" that the run does not support is refused.
- **S3** changes what "the file verifies" means. Before, it meant "the file agrees with itself where that was easy to check". All five tampers the review tried verified. Now `verify` recomputes the file from its own run and refuses all five (see the probe table below).
- **One limit to know**: `verify` proves the file agrees with itself. It cannot prove the chain said those numbers. A forger who edits a price in both the measured values and the trace, and then also rebuilds the verdicts and the table, still gets a file that verifies. Only `GET /replay` catches that, because it re-runs the fork.

## What each fix does, before → after

| Item | What was wrong (before) | What happens now (after) | Test |
|---|---|---|---|
| **B1** | `falseAlarmFromRun` never read `controlPassed`: a failed-control run flagged cbETH in the server answer and on the page | Every flag is `null` ("can't check") with the control's reason. The same gate is in `falseAlarmTable`, the `/runs` answer, the `.atlas.json` (new `falseAlarm` field, rebuilt by `verify`) and the page | `review-day34.test.ts` B1, `review-day34-ui.test.tsx` B1 |
| **S1** | Raw viem/anvil messages (setFeed, pre-execution check, symbol reads, trace, block number after apply) carried the RPC host into the SSE, 500 bodies (also `/replay`) and the `.atlas.json` | One function, `runners/evm/redact.ts`, removes the full URL, the host, the endpoint subdomain, path and query tokens, and user:password, ignoring case. Every runner error path uses it, the runner scrubs every string of a finished Run, and the server applies it again on `/runs`, `/replay`, the log line and `onError` | `review-day34-redact.test.ts`: a made-up URL on host `abc-def.base-mainnet.quiknode.pro` with a token path, pushed through each path |
| **S2** | Every not-flagged market was counted as "unchanged", even one 40% up | Each row says what PASS-RULE.md's rules say: cbETH flagged or not against raw Chainlink (rule 1); every other market "within 2% (not flagged)", "moved more than 2% (not flagged)", "flagged", or "unchanged" only when before = after exactly. The summary counts per rule | `review-day34-ui.test.tsx` S2 |
| **S3** | Five tampers verified ok (below) | `verify` also requires: measured = trace (each price read, pre and post), the reference = its trace event and recomputed from its recorded Chainlink inputs, the source and action counts = trace, one control event agreeing with `controlPassed`, the fork block fixed by the shape, captions exactly the earned set, and `runs[0]` = the run of `experiments[0]` | `review-day34.test.ts` S3: one test per tamper |
| **S4** | The order test looked only at `proofs/**/run.json`, where no EVM run has ever been committed, so it passed trivially. It also passed when PASS-RULE.md was edited later | It finds EVM runs where they are committed (any `run.json`, `*.atlas.json` or `level*.json` under `proofs/` or `tests/evidence/` with runner "evm" or a forkBlock): 4 today. PASS-RULE.md's first commit must be an ancestor of each one. Exactly one commit may touch PASS-RULE.md, and the failure says amendments go in a new dated file | `pass-rule-order.test.ts`. Proof in throwaway clones: [`s4-clone-proof.txt`](s4-clone-proof.txt) (the new test fails both cases; the old test passes both) |
| **S5** | `GET /replay` of an EVM run had no limit: N requests started N forks and N sets of paid reads | Caps at once and per rolling hour, for each session and for the whole server. Defaults: 1 at once and 10 an hour for the server, 1 at once and 3 an hour per session. Env `ATLAS_REPLAY_MAX_CONCURRENT`, `ATLAS_REPLAY_MAX_PER_HOUR`, `ATLAS_REPLAY_SESSION_MAX_CONCURRENT`, `ATLAS_REPLAY_SESSION_MAX_PER_HOUR`. Over a cap: 429 and the reason. An EVM replay must send `x-atlas-session`, so the session cap cannot be skipped by leaving it out | `review-day34-replay.test.ts` |
| **S6** | The quote check was `slice.includes(quote)` with a 10-character minimum, so `"}\n}\n}\n}\n}\n}"` and `"ction f() pu"` were VERIFIED | The quote needs at least 12 letters, digits or underscores, and must equal a run of whole lines in the range (it starts where a line starts, after indentation, and ends where a line ends). A refused quote gets a plain reason. All 39 findings the live D04-03 runs verified still verify ([`s6-live-findings-recheck.txt`](s6-live-findings-recheck.txt)) | `review-day34.test.ts` S6, `investigator.test.ts` (2 tests now quote whole lines) |

## Minors

| Item | Fix | Test |
|---|---|---|
| M1 | If the trace reads a feed with `latestAnswer`, `getRoundData` or `getAnswer`, the price-source count is recorded as not measured. Before, the count could come out low | minors M1 |
| M2 | The 1-source line is labelled "Observed, not part of the pre-registered rule" in the pass-rule lines and on the page. PASS-RULE.md counts sources only in rule 3, after a proposed change (2 expected), so the label says that | minors M2 |
| M3 | The cbETH reference is read at the fork block its method names. On the real Level 2 run the values are unchanged (concurrent probe: measured and references deep-equal to the D04-04 file) | minors M3, RPC suite |
| M4 | anvil binds port 0 itself, and Atlas reads the port from its "Listening on" line. Before, Atlas picked a free port first, and another process could take it in between. The port is parsed from the raw output, so a local RPC URL cannot redact it away | minors M4 |
| M5 | Level 2 stops if the actions derived from the PR are not the 14 PASS-RULE markets. `verify` refuses a Level 2 file with no `proposal_derived` event, which would otherwise give an empty table | minors M5 |
| M6 | The findings panel lists each removed place with its real reason | minors M6 |
| M8 | The two private-plan references are removed (`control.ts`, `investigator.ts`) | none: comment only |
| M9 | Level 1 no longer sets a `controlRunId` that points at nothing. The control is in the run's own trace | none: a field removed |
| M10 | The signal hook exits only when no other handler owns shutdown (exit 130 for SIGINT, 143 for SIGTERM). Query-string keys are now redacted (S1) | none |
| **M7, skipped** | The caption "the cbETH line was picked by a person; the Investigator pointed elsewhere" can also appear when the Investigator did point at cbETH but plain code dropped that place. Fixing it means changing a caption the demo shows, or storing the dropped places. That is a wording decision for Dami (pitch), so it is not done here | — |

## Probes (the review's own scripts, re-run)

The scripts are in [`probes/`](probes/), with their paths made relative to this folder. [`probes.before.txt`](probes/probes.before.txt) is the output on the old code, and [`probes.after.txt`](probes/probes.after.txt) is the output now.

| Probe | Before | After |
|---|---|---|
| fa: control failed → cbETH | flagged `true` | `null`, words "can't check" |
| fa: AERO +40% | flagged `false`, counted as "unchanged" | flagged `false`, words "moved more than 2% (not flagged)", counted under "moved more than 2%" |
| fa: `"}\n}\n}\n}\n}\n}"` / `"1\| contract A {"` / `"ction f() pu"` | VERIFIED / VERIFIED / VERIFIED | removed: 0 / 9 / 8 letters or digits (12 needed) |
| leak: trace reason / pre-execution / applyFeedActions | host shown | host removed |
| tamper T1 price edited + re-judged | verifies | refused: measured is not what the trace read |
| tamper T2 Level 1 caption on Level 2 | verifies | refused: caption not earned |
| tamper T3 trace says control failed | verifies | refused: trace and `controlPassed` disagree |
| tamper T4 Level 2 at 42194663 | verifies | refused: Level 2 must fork at 42194662 |
| tamper T5 experiments[0] ≠ runs[0]'s | verifies | refused: runs[0] is another experiment's run |
| concurrent (RPC): Level 2 + Level 1 at once | deep-equal, 0 anvils left | deep-equal again (with M3 and M4), 0 anvils left, 4 s |

The tamper probe after uses [`tamper-probe-rebuilt.mts`](probes/tamper-probe-rebuilt.mts). The committed D04-04 Level 2 file predates the `falseAlarm` field, so `verify` now refuses it as-is ("a Level 2 file must carry its false-alarm table"). The probe rebuilds the file from its own run first, and the rebuilt file verifies. Nothing else about that file failed the new checks. The old file is kept unchanged as the D04-04 record. Note: the live run had 13 other markets exactly unchanged, so its old summary "13 unchanged" was true for that run. The label was wrong only for a market that moved.

## Commands and output

| Command | Output | Result |
|---|---|---|
| `pnpm test` | [`test-output.txt`](test-output.txt) | 36 files, 409 passed, 16 skipped (RPC tests skip) |
| `pnpm test` with the RPC loaded at runtime | [`test-output-rpc.txt`](test-output-rpc.txt) | 36 files, 422 passed, 3 skipped (fixture-source tests). Real Level 1 and Level 2 forks pass |
| new regression tests on the old code (scratch checkout of `2ff03b6`) | [`regression-tests-on-old-code.txt`](regression-tests-on-old-code.txt) | as written: 22 failed, 3 passed. The 3 that pass check behaviour that was already right: the rebuilt live file verifies, a changed bet's seal is refused, and whole-line quotes are kept. Three files import a module the fix added, so they fail at import. They were run again with those imports stubbed: 15 of the 16 S1 tests fail (the one that passes: anvil's own output was already redacted), and all 9 S5 and page tests fail |
| `npx tsc -p .` | [`tsc-output.txt`](tsc-output.txt) | clean |
| `pnpm gate:day1` | [`gate-day1.txt`](gate-day1.txt) | 18 matched, 1 didn't match, 1 can't check (unchanged) |
| `npx vite build` | [`vite-build.txt`](vite-build.txt) | built |

## What I did not do, and what I am unsure about

- The `/runs` route still has no cap on concurrent EVM runs. The review mentioned it, but S5 asked only for `/replay`. A round needs an experiment and a sealed bet first, so `/runs` is harder to abuse, but it is still uncapped.
- The page text "Anyone can replay it at /replay/…" is still true, but an EVM replay now needs the `x-atlas-session` header. A plain browser link answers 400 with that reason.
- No live Investigator call was made. The S6 rule was checked against the 39 recorded live findings, and none was dropped. A future model answer that quotes a partial line will now be dropped, and the model gets one repair try with the reason.
