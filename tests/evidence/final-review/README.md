# Final review: the cross-cutting adversarial review, finding by finding

Date: 2026-10-27 (WAT). Node v25.8.1. No live model call: every model answer in the new tests is mocked. The
Base RPC was loaded at runtime only, for the RPC test run and the Playwright click-through; it appears in no
file here (secret scan: 0 hits; the GitHub token: 0 files).

The review found 0 blockers, 7 should-fix and 13 minor problems. This README says, for each one I was asked
to fix, what happened before, what happens now, and which test proves it. Every new regression test was run
on the code BEFORE the fixes (`tests-on-old-code.txt`, the local folder replaced by `<repo>`): 19 tests
failed, and `review-final-hygiene.test.ts` could not even load, because the modules it tests
(`server/load-env.ts`, `server/startup-check.ts`) did not exist. The 2 that passed on old code are the
pattern self-check of the path test and one S7 case (a Wonder cost was already shown plainly).

## Where to look first

- **S2** was the demo-day risk: one fork hiccup ended the round and the page then said the experiment
  "already ran". Now the round says "the run did not finish: <reason>" and offers **Try the run again**,
  which runs the same experiment with the same sealed bets. Proven offline with a fake `anvil` that exits 1,
  and on a real Base fork (first attempt forced to fail, second attempt the real fork at 42194662).
- **S1**: in "both" mode a model with no usable answer showed `0 · 0 · 0 · bets placed 0`. It now shows
  "no usable answer" or "network error", and "-" for each outcome.
- Final checks, all green: `test-output-offline.txt` (753 passed, 18 skipped), `test-output-rpc.txt`
  (768 passed, 3 skipped), `tsc-output.txt` (empty = no errors), `gate-day1.txt`, `vite-build.txt`,
  `playwright/browser-output.txt` (0 overlapping text boxes, 0 accessibility violations, no horizontal
  scroll at 390 px).

## Before / after

| Finding | Before | After | Test |
|---|---|---|---|
| **S1** zero score on the verdict screen | The counts table printed 0 for a model that sealed nothing | Each model column that sealed nothing shows its plain status in "bets placed" ("no usable answer", "network error", or "not asked" for a named column with no reason) and "-" for each outcome, as the proof card already did | `review-final-ui.test.tsx` (3 tests) |
| **S2** a run that did not finish | The round was set to "stopped"; a 500 said "the server could not finish the request"; a second POST /runs got 409 "already ran"; new bets got 409 | The runner's error becomes one plain, redacted sentence (`server/run-failure.ts`). POST /runs answers **503** "the run did not finish: <reason>". Nothing is judged. The round is open again, its bets frozen (POST /bets: 409 "frozen … try the run again"). POST /runs runs the SAME experiment with the SAME sealed bets: hashes unchanged, every `sealedAt` earlier than the successful run's `startedAt`. Each attempt is a runner line in the agent log ("the run did not finish (attempt 1): …; nothing was judged") and an entry in the `.atlas.json` `attempts` list, never a verdict. Verify now checks that every bet was sealed before the first attempt and every attempt stopped before the run started. The page shows the reason and a **Try the run again** button (withRpcRetry and Moonwell); the proof card lists earlier attempts as "Not verdicts" | `review-final-server.test.ts` (TS sandbox that cannot start; fake anvil that exits 1; the same on a real fork), `review-final-ui.test.tsx` (the page, end to end) |
| **S3** fresh clone | `.env.example` said "copy to .env" but nothing read `.env`; no Node version pinned; no startup warning | `server/index.ts` imports `server/load-env.ts` first: it reads the repo's `.env`, never overrides a variable already set, skips empty values, and prints key NAMES only. `.env.example` lists `BASE_RPC_URL`, `META_API_KEY`, `BASETEN_API_KEY`, `GITHUB_TOKEN`, and says Muse Code needs macOS `sandbox-exec` (chat fallback elsewhere). `package.json`: `"engines": {"node": ">=22.13"}`. At startup the server prints one plain sentence when Node is older than 22.13 or lacks `--permission` ("every verdict would be can't check") and when there is no macOS sandbox for Muse Code. README.md was not touched (it is Dami's to write) | `review-final-hygiene.test.ts` (6 tests); a startup smoke run printed no note on this Mac (Node 25.8.1, sandbox-exec present) |
| **S5** Level 2 header | "Level 2: fork one block before the proposal ran, proposal applied" | "Level 2: fork one block before the proposal ran; the proposal's 14 oracle-feed actions applied" on the proof card and on the Moonwell run facts. The 14 is read from the run (`appliedFeedActions`), not typed in. **No caption version was needed:** this header is drawn from the run each time and is not stored in the `.atlas.json`; the stored Level 2 caption already said "Atlas applied the proposal's oracle-feed actions as the governor" and is unchanged, so every existing file verifies as before (the full suite re-verifies them) | `review-final-ui.test.tsx`; `playwright/proof-card-moonwell-1920.png` |
| **S6** public polish | 11 evidence READMEs carried a line saying a private tool was not run; D01-01 and `.gitignore` named that tool's folder; 5 "plan section N" pointers; 6 test-output headers still named the repo's folder under the home folder (or a private worktree folder) | Fragments removed, pointers rewritten as plain sentences, headers say `<repo>`. D01-01's `git-ignored.txt` lost one line (the tool folder), noted in its README | `review-final-hygiene.test.ts`, `no-local-paths.test.ts` |
| **S7** costs | "Cost $0.1234." for any model | Muse Spark's price is not published, so a cost that includes it reads "≤ $0.1234 (upper bound: price not confirmed)". Wonder and Spark Open (published prices) are shown plainly. `src/cost.ts` holds the list of confirmed prices; `server/meta/client.ts` reads the same list for `priceVerified` in the usage log. The Findings panel was the only screen that shows a dollar figure | `review-final-ui.test.tsx` |
| M1 failed replay | The accepted diff showed with no D20 caption | The "in theory" caption shows above the diff when the replay did not finish | `review-final-ui.test.tsx` |
| M2 "block 0" | `level1Caption(run.forkBlock ?? 0)` | No block number when the run has none (and no "undefined") | same |
| M3 Investigator "not asked" | Decided from the whole session's log | Each Investigator log line now names the code it read (`ref: { kind: "target", id: codeSha256 }`); the caption asks whether the Investigator read THIS round's code. A log with no such ref (every file written before today) keeps the old rule, so older files still verify | `review-final-server.test.ts` |
| M4 (D18) | Spark's prompt said "FINDING (found by muse-wonder-1.0; …)" and "kind: retry" | "PLACE IN THE CODE", then `file: …, lines A-B`, then the code. No model name, no kind, no claim | `review-final-server.test.ts`; `investigator.test.ts` updated |
| M5 fork events | `forkEventsEqualDerived` was measured and never shown | When it is false, the proof card and the Moonwell run facts show "warning: the oracle-feed changes the fork recorded are not the ones Atlas derived from the proposal's files, …" | `review-final-ui.test.tsx` |
| M6 "withRpcRetry" | Hard-coded on the proof card title, the Run screen and the runner's log line | `src/target-name.ts` names the code from the target: a PR by its reference, a TypeScript file by the export the runner calls (the runner reads the same table). An unknown file is named by its path | same |
| M7 budget | A call refused before it was sent (no key, refused model id) used up the hourly call limit | The client marks those `notSent`; the budget does not count them | `review-final-server.test.ts`; `open-weights.test.tsx` updated |
| M8 contributor model | One line in D06-01, no plain summary | One plain sentence added to `tests/evidence/D06-01/README.md`: two Muse Code calls on Oct 27, $0.34, lines 44–45 of `usage.jsonl`, sent the public fixture to `muse-spark-1.3-contributor`; Atlas has refused contributor ids since. The author e-mail and the usage line are unchanged | - |
| M12 strip words | Role label "Fixer"; lines "one repair try" | Label "Proposes a change"; lines "asks again" (Spark's bets, the Adversary, the Investigator) | `review-final-ui.test.tsx`, `review-final-server.test.ts`; `adversary.test.ts` updated |
| M13 prompt wording | "most likely wrong" in the Investigator's instruction | "most likely to differ from what it does" (the `wording-lint: allow` exemption is gone) | full suite |

Tests changed because the behaviour changed on purpose: `adversary.test.ts` ("asks again"),
`investigator.test.ts` (D18 prompt), `open-weights.test.tsx` (`notSent`), `review-day34-redact.test.ts` and
`runs-cap.test.ts` (503 instead of 500 for a run that did not finish).

## The "23 lines" in S6

I found 6 lines, not 23: the `RUN v5.0.5 …` headers of six `test-output*.txt` files (D06-review, D07-02,
D07-02/merge). They were already half-redacted: the user name was replaced by a `home` placeholder, but the
folders under it (the documents folder and the repo or worktree name) were still there. The path test's pattern
needs the literal users folder plus a name, so it did not match them; it did read `.txt` and `.json` files. I could
not reproduce the count of 23 (it may have included history, which keeps everything). The test now also
catches the half-redacted form, home-relative private folders, Windows and JSON-escaped home paths and the
worktree folder name (the exact patterns are in `tests/unit/no-local-paths.test.ts`), and
reads every tracked file without a NUL byte instead of skipping by extension.

## What I did not do, and what I am unsure about

- **S4** (the logo label) is untouched: Dami decides it.
- **README.md** is untouched. The run steps, the env list and "Muse Code is macOS only" belong there; the
  same facts are now in `.env.example` and in the startup notes.
- A TypeScript run that STARTED and then hit Atlas's wall-clock limit is still a result ("can't check"),
  not "did not finish": with a virtual clock only the code itself can make that happen, and it is a real
  can't-check instance. Only "the sandbox could not start" counts as did-not-finish on the TS runner.
- Each retry of a Moonwell run takes one more EVM run slot from the per-hour cap (one slot per fork).
- An autonomous ("What else?") round whose run does not finish stops, as before; "Ask again" starts a new one.
- New `.atlas.json` files with `attempts`, or with Investigator lines that carry a `target` ref, do not
  verify with the code before these commits (its schema is strict). Files written before verify with the new code.
- Older evidence captures (D06-03, D07-01, D07-04) still show the old Level 2 header; they are records of
  what the screen said then. The new header is in `playwright/proof-card-moonwell-1920.png`.
- The strip now reads "Proposes a change · muse-spark-1.3 · Muse Code (muse-spark-1.3) proposes a change …",
  which repeats the verb. Plain, but not elegant.
- M9, M10 (author e-mail, left as asked), M11 were not in this task.
- **One flaky RPC run.** After the evidence commit I ran the RPC suite 7 more times: 6 green (768 passed),
  1 with one failed test. I printed only the totals of that run, so I do not know which test it was; the
  offline suite was green every time. Most likely a Base RPC or fork timing hiccup, but that is a guess.

## Files

- `tests-on-old-code.txt`: the new tests on the code before the fixes (19 failed, 2 passed, the hygiene file did not load).
- `test-output-offline.txt`, `test-output-rpc.txt`, `tsc-output.txt`, `gate-day1.txt`, `vite-build.txt`.
- `playwright/`: the D07-04 click-through re-run (`tests/evidence/D07-04/drive.mjs`, models mocked, fork,
  sandbox and judge real): `browser-output.txt`, `checks.json`, and three proof-card PNGs.
