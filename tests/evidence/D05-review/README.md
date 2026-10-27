# D05-review: fixes for the day-5 adversarial review

Date: 2026-10-27 (WAT) · Node v25.8.1 · no live Meta call (every model answer is a mocked `chat()`), nothing written to `proofs/`, `mida` not run. The Base RPC was loaded only for the RPC test run; the saved output was scrubbed and then checked by script: the host appears 0 times.

The review found 1 blocker (B1), 6 should-fix items (S1–S6) and 9 minors (m1–m9). All 7 main items are fixed. Of the minors, m1–m4, m6 and m7 are fixed, m5 and m8 in part, and m9 is left (reasons below). Every fix has a regression test, and each test was also run on the code before its fix.

The rule behind all of it: a drawing or a sentence may only show what plain code measured. When the control failed, nothing from that run is shown as fact.

## Where to look first

- **B1** could have put a false picture on camera. Before, a run whose known-case check failed still animated the retry machine with "calls 5 · waits 4 × 3,000 ms · threw the 5th error", while the verdicts right above said "can't check". After, the machine draws nothing and prints *"Atlas's known-case check did not match, so this run is not shown as fact: tampered: result rewritten"*. "Ask why", the Run facts and the Moonwell facts follow the same rule (one function, `src/trust.ts`).
- **S2** changes what "Ask why" shows. A model's words are never linked to run evidence any more. Spark's rationale is sealed before the run, so a "trace #N" inside it is a guess about a trace that did not exist yet. Model words now sit in their own panel, whole and unlinked, labelled as the model's words. One effect for the film: the log strip's "dropped: no run evidence (1 sentence)" line from D05-05 will now usually not appear, because model sentences are no longer counted as dropped.
- **S5 numbers are my choice, not decided.** One client address gets 8 EVM runs an hour (2 at once), and the last 4 of the server's 20 runs an hour are kept for addresses that have not run yet. A room of judges behind one network address would share those 8. Every number can be set from the environment.

## What each fix does, before → after

| Item | Before | After | Test (old code → new code) |
|---|---|---|---|
| **B1** | Control failed: the machine animated 5 calls, the caption said "Drawn from run …'s trace only", and "Ask why" said "call 5 threw; no more attempts (trace #23)". A sandbox failure read "calls 0 · waits 0" as if measured | `src/trust.ts` decides from the run alone: only `controlPassed === true`, with a trace and no sandbox failure, may be shown. Otherwise: no drawing, no readout numbers, no "Ask why" sentence, and the Run/Moonwell facts print the reason. The scoreboard was already all "can't check" (verified: no dot filled, no line on the bar) | `review-day5-b1.test.tsx`: 4 failed / 3 passed → 7 passed |
| **S1** | Only some reference forms were read. `"traces #999 and trace #1"`, `"#1 or #999"`, `"#2; #77"`, `"Event #999"`, `"Lines 42—99"`, `"lines 42 to 99"` and file names other than right before "lines" all got through | Every `#N` anywhere, `trace N`, trace ranges, line ranges in any dash or "to", line lists, bare ranges and file names anywhere are parsed. All must resolve. A backwards range, an unknown file, two files, or lines that fit findings in two files drop the sentence | `review-day5-why.test.tsx` (S1, S2, m4): 12 failed / 1 passed → 13 passed |
| **S2** | `"Trace #0 proves the code is wrong…"` from Spark was shown, linked to trace #0 (`start`) | Only plain-code sentences are linked. A model's words are shown apart, whole, unlinked, labelled "the model's own words, written before the run. Not linked to run evidence, not checked, not a verdict" | same file |
| **S3** | A person picks lines 30–60 (holding line 42). Wonder's verified place is 55–58. Caption: "…; the Investigator **also pointed here**" | The cbETH line is found inside the person's snippet by plain code, and places are compared with that line only. Same input: "the person picked lines 30–60, which hold the cbETH line (line 42); the Investigator pointed elsewhere". A one-line pick keeps the old wording. Earlier cases unchanged | `review-day5-m7.test.ts` (S3, m5, m6): 8 failed / 2 passed → 10 passed |
| **S4** | The rack had 8 slots and the counters 8 holes. With attempts 10: 8 distinct capsule positions, 8 of 9 pulls lit, 8 of 9 turns lit, a bet of 10 drawn on slot 8 | 10 slots, a 10-slot ruler, 10 pull holes, 10 turn holes (two columns of 5), all resized to fit their parts. The test reads the gate's max from `src/gate.ts`. A run with more calls than slots is not drawn, and the card says why | `review-day5-machine.test.tsx`: 4 failed → 4 passed |
| **S5** | 22 runs, a new session each time: 20 × 200, then 429. A new user afterwards: 429 for the rest of the hour | Caps are also counted per client address (`server/client-ip.ts`: the socket address, or X-Forwarded-For's first hop only with `ATLAS_TRUST_PROXY=1`; IPv6 grouped by /64). Runs: 2 at once, 8 an hour per address; replays: 1 and 4. The last 4 of 20 runs (2 of 10 replays) an hour are kept for new addresses. Model rounds (20) and investigations (6) are counted per address an hour too. Same probe with one address: 8 × 200, then 429; a user from another address: 200 | `review-day5-caps.test.ts`: 7 failed / 1 passed → 8 passed |
| **S6** | The scoreboard's visible text was only the question. Names and outcomes were in `aria-label` only | One visible line per bettor under each mark: "You · didn't match", "Muse Spark 1.3 (muse-spark-1.3) · matched". A model's line always carries its Meta model id (D10) | `review-day5-scoreboard.test.tsx` (S6, m7): 4 failed → 4 passed |
| m1 | A wait the watch limit cut off was drawn and said as finished: "waits 2 × 20,000 ms", drum turned twice, "it waited 2 times" | Only a wait with its `wake` counts. The cut-off one turns the drum half way, lights no mark, reads "+ 1 cut off", and "Ask why" says it apart | `review-day5-minors.test.tsx` (m1–m3): 3 failed / 1 passed → 4 passed |
| m2 | "Still pending at Atlas's watch limit" ("pending" is also a bet outcome) | "Still running at Atlas's watch limit" | same file |
| m3 | "…no timers were left and nothing was pending" | "…nothing outside it was left to run" | same file |
| m4 | The hand-written fixture finding read "none: written by hand chose …", and its claim was offered as a model's words | "… lines 49–66 were chosen for this round by hand (a fixture finding written by hand, not a model)"; its claim is not offered as model words | `review-day5-why.test.tsx` |
| m5 | "had no checked place on this code" also when the Investigator was never asked | When the file's agent log shows no Investigator call: "the Investigator was not asked". Server and verify read the same log | `review-day5-m7.test.ts` |
| m6 | A copy of a real Investigator finding moved onto lines 41–43, with the caption flipped to "also pointed here", verified | `verify` requires the gate's "verifies finding <id>" log line and a call to that model. For MIP-X43 it re-reads the lines from the committed copy (`contracts/lib/moonwell`): a person's quote must be exactly those lines, an Investigator's must sit inside them. The forgery is refused on both counts | `review-day5-m7.test.ts` |
| m7 | Two experiments' "calls" bets merged into one mark | One mark per experiment and question | `review-day5-scoreboard.test.tsx` |
| m8 | The page's log list grew without limit | Keeps the last 500, as the server does | `review-day5-logstrip.test.tsx`: 1 failed → 1 passed |

"Old code" means the commit before each fix, with the new test file added. A few tests pass on old code because a new helper file (`src/trust.ts`, `server/client-ip.ts`) was present, or because the test checks something that was already right (the trusted run still draws, the scoreboard was already "can't check", the trace has 2 sleeps).

## Existing tests changed on purpose

- `why.test.tsx`: the two screen tests that expected a model sentence to be linked now expect the S2 behaviour. The parser test feeds plain-code sentences (S2 drops every model sentence before parsing).
- `machines-retry.test.tsx`: the import test also allows `src/trust.ts` (and checks that file imports only types); the off-ruler ghost sits on slot 10 (was 8); the watch-limit caption reads "Still running".
- `runs-cap.test.ts`, `review-day34-replay.test.ts`: the defaults objects list the three new S5 fields.
- `__snapshots__/machines-scoreboard.test.tsx.snap`: the two D05-01 snapshots gain only the new visible list.

## Probes, re-run on the new code

The review's five probes are copied to [`probes/`](probes/) with local paths made relative. [`probes.before.txt`](probes/probes.before.txt) is their output on the old code, [`probes.after.txt`](probes/probes.after.txt) on the new code. One probe was added: `p3b-caps-by-address.mts`.

| Probe | Before | After |
|---|---|---|
| p1 attempts 10 | 8 distinct capsule positions, 8 pull marks, 8 turn marks, ghost at slot 8 | 10, 9, 9, ghost at slot 10 |
| p1 watch cut | "waits 2 × 20,000 ms", drum 2 turns, 2 marks | "waits 1 × 20,000 ms + 1 cut off", drum 1.5 turns, 1 mark, "Still running" |
| p1 two experiments | one mark | two marks |
| p2 M7 wide pick | "also pointed here" | "the person picked lines 30–60" (the probe's snippet has 3 lines for 31 picked lines, so the cbETH line cannot be placed; with the real lines the test gets "…pointed elsewhere") |
| p2 forged finding | verifies: true | verifies: false |
| p2 linker | 9 of 10 model sentences shown | all dropped (S2; the same texts as plain code are tested in `review-day5-why.test.tsx`) |
| p2 templated cut / pending | sentences printed | none: the probe's hand-made runs have no `controlPassed`, so B1 shows nothing. The new wording is tested in `review-day5-minors.test.tsx` |
| p3 one actor, in-process | 20 × 200, then 429; new user 429 | 8 × 200, then 429; "new user" 429. In-process requests have no address, so all of them are one "unknown" client |
| p3b one address, then another | (new) | 8 × 200, then 429; a user from another address 200 |
| p4 real files | fixture finding "none: written by hand chose …"; Spark's sentences counted as dropped | "… chosen for this round by hand (… not a model)"; Spark's words listed as model words, unlinked |
| p5 control failed | machine animated, "calls 5 · …" | reason card, no numbers |
| p5 sandbox failed | "calls 0 · waits 0" | reason card, no numbers |

All four committed `.atlas.json` files were checked against the new `verify`: three pass; `moonwell-level2-fKqHGIIi2_` fails exactly as it did before these fixes (the D04-04 README already says it no longer verifies; it is kept as recorded).

## Checks

| Check | File | Result |
|---|---|---|
| `pnpm test` | [`test-output.txt`](test-output.txt) | 51 files, 504 passed, 16 skipped (RPC tests skip) |
| `pnpm test` with the RPC loaded at runtime | [`test-output-rpc.txt`](test-output-rpc.txt) | 51 files, 517 passed, 3 skipped |
| `tsc --noEmit` | [`tsc-output.txt`](tsc-output.txt) | exit 0 |
| `pnpm gate:day1` | [`gate-day1.txt`](gate-day1.txt) | exit 0, control passed on every run |
| `vite build` | [`vite-build.txt`](vite-build.txt) | exit 0 |

## Not done, and why

- **m5, second half**: a place that covered the cbETH line but failed its quote check still counts as "pointed elsewhere". The file does not record dropped places, so verify could not check that wording. That needs a schema change (record dropped places in the `.atlas.json`).
- **m9**: whether the scoreboard (which is the Oct 26 logo, listed in PRE-EXISTING.md) needs a "Pre-existing" label on camera is Dami's call. A replay button for touch and 390 px screens is UI work and was not done.
- **m8, second half**: the "Ask why" dropped line keeps its first timestamp when the count stays the same. Left as is.
- **m6 limit**: the file is not signed. Someone who forges the matching agent-log lines and quotes the real line still gets a file that verifies. The quote check runs only for MIP-X43, the one target whose files Atlas has a committed copy of.
- The D05-01 and D05-02 evidence pages and PNGs show the machine and scoreboard as they were on those days (8 slots, no visible names). They were not regenerated.
- `web/screens/Moonwell.tsx` got a two-line change only (the cbETH read and price-source rows print the reason on an untrusted run). The price-pipe machine being built elsewhere must apply the same `notShownAsFact(run)` rule before it draws anything.
