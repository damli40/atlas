# D02-review: fixes for the day-2 adversarial review

Date: 2026-10-27 (WAT) · Node v25.8.1 · no live Meta call (every model answer here is a mocked `chat()`), nothing written to `proofs/`.

The day-2 review found 0 blockers, 8 should-fix items (S1–S8) and 11 minor ones. All 8 should-fix
items are fixed, and 9 of the 11 minors. Each fix has a regression test. Every one of those tests
was also run against the code from before the fixes, and every one failed there
([`regression-tests-on-old-code.txt`](regression-tests-on-old-code.txt), 22 of 22 failed).

## Where to look first

- **S2** (the model's answer leaking before the person bets) was the one that broke the core promise.
  Its test scans every API answer, every agent-log event and the SSE stream before the run for the
  model's values. Before: the log said `got "throwz"`. After: it says `outcome not one of the options`.
- **S1** (hedging: many bets on one question) is the one that could make "matched" mean nothing.
- **S6** changed the day-1 gate's printed table. The table is in [`../D01-08/six-cases.txt`](../D01-08/six-cases.txt),
  and [`../D01-08/README.md`](../D01-08/README.md) says what changed and why.

## Commands and output

| Command | Output | Result |
|---|---|---|
| `pnpm test` | [`test-output.txt`](test-output.txt) | 22 files, 288 passed, 3 skipped. The 32 new tests are in `tests/unit/review-day2.test.ts` and `tests/unit/limits.test.ts` |
| the same 22 regression tests on the old code (a scratch checkout of `7163da9`) | [`regression-tests-on-old-code.txt`](regression-tests-on-old-code.txt) | 22 of 22 failed, each for the reason the review gave |
| `npx tsc --noEmit` | [`tsc-output.txt`](tsc-output.txt) | clean |
| `pnpm gate:day1` | [`../D01-08/six-cases.txt`](../D01-08/six-cases.txt) | 18 matched, 1 didn't match, 1 can't check, 693 ms. The can't-check line still comes from S6, for a true reason (below) |
| `npx vite build` | [`vite-build.txt`](vite-build.txt) | built |
| the 3 review probes, re-run from the repo root | [`probes/`](probes/): `*.before.txt` (the review's output), `*.after.txt` (now) | below |

The probes are the review's own scripts. Changes made to them: they find the repo through
`process.cwd()` instead of a fixed local path; P8 bets on `settledAtMs`, the field's one name now
(`settleTime` no longer exists); and `web-seal-probe` also drives the new page path, which sends all
answers in one request.

## Should-fix items: before and after

| Item | What was wrong, in plain words | Before (probe or test) | After |
|---|---|---|---|
| S1 | A person could place any number of bets on the same question, and every one was judged. So a person could "beat the model" by covering every possible answer | P1: 10 bets on `calls` → ten 200s, one `matched`. The page's seal loop left an orphan bet: page showed 3 bets, server judged 4 | P1: the first 200, then nine 409s, 1 bet judged. The page sends all answers in ONE request (all sealed or none); the server answers with the person's whole sealed set, and the page shows and checks exactly that set: "page showed 3 bets; server judged 3 bets; seal checks 3 of 3 match" |
| S2 | When the model's first answer was not usable, the log line quoted it, before the person had bet | P4: `answers (not usable: … got "throw")`; P4b: `got 5.5` | P4: `answers (not usable: bet on "outcome": outcome not one of the options)`; P4b: `calls must be a whole number`. The full reason is kept on the server and shown only after the run (`detail`) |
| S3 | A gate refusal with a long or multi-line reason crashed the request (500), and the refusal never reached the log | P3a/P3b: 500 | P3a/P3b: 422 with the full reason; the log line is one line of at most 160 characters |
| S4 | Any 500 requests with new session ids pushed out everyone else's round, even requests that failed | P5: the victim's run → 404, their sealed bets gone | P5: 200. A failed request never creates or reorders a session; a session with sealed bets that have not run is kept for 2 hours (if every slot is held, a NEW session is refused with 503 instead) |
| S5 | Every new experiment cost one or two paid model calls, with no overall limit | P7: 100 experiments → 200 model calls | P7: 60 (the hourly cap). Limits: 60 calls an hour (`ATLAS_MODEL_CALLS_PER_HOUR`), 10 experiments a session, $100 total (`ATLAS_SPEND_CEILING_USD`; the usage log's total is read at startup). When a limit is hit, the model slot says "not asked (call limit reached)" and the person's round goes on |
| S6 | The settle-time question measured a field (`settleTime`) that no run ever wrote, so every bet on it was "can't check", with a reason that was not true | P8: S1 bet `settleTime = 0` → can't check, "runner did not measure settleTime", though the run measured `settledAtMs` | P8: S1 bet `settledAtMs = 0` → matched, observed 0. Gate: S3 `settledAtMs = 12000` → matched on the real value; S6 → can't check, "the function never settled: it was still waiting with nothing left that could wake it, so it has no settle time" |
| S7 | The server wrote no refusal records; the plan says every gate refusal and every can't check is recorded automatically | no record from the app at all | The live server (`pnpm server`) writes `proofs/refusals/<date>-<runId>-<betId>.json` for each can't check and `<date>-<experimentId>.json` for each gate refusal, with the trigger, the reason and the model id (when a model bet). Records are scrubbed of paths, URLs and keys, never overwrite an existing file, and stop at 1,000 per process. Tests pass an in-memory writer or none, and a vitest guard (`tests/tools/refusals-guard.ts`) fails the whole run if `proofs/refusals/` changes |
| S8 | The full-mode Claimant crashed when given the real agent log | R1, R2: threw | R1, R2: `{ ok: false }`. It also had a third crash the review did not list: its seal line named a model, which the log refuses for plain-code lines (test "a usable answer") |

## Minor items

| # | Fixed? | What changed |
|---|---|---|
| 1 | yes | A second POST /runs while the first waits says "is already running: its run is waiting for the model's bets", never "started undefined" |
| 2 | yes | The server stops waiting for the model's bets after 60 s (slot: "the model did not answer within 60 s"), and the live server's Meta client times out after 45 s for bets. P6's mock never answers, so the probe still shows the run waiting after 2 s: the deadline is 60 s |
| 3 | yes | A failed call with no usage is logged with the words "cost unknown: the call reported no usage" (the usage block is still zeros, because the log requires one) |
| 4 | yes | A declined reason of only spaces is refused, for models and people. An all-declined answer is still allowed: declining is an honest answer |
| 5 | yes | After the run, the model column is rebuilt from the server's answer when the page's own model request failed |
| 6 | yes | The page's seal check compares each revealed answer with what the person typed, and flags any judged bet the page never showed a hash for |
| 7 | half | Runs kept in memory are capped at 1,000. **Skipped:** the SSE side (sessions with an open stream are never dropped). It needs a per-client stream limit, and there is no client identity yet |
| 8 | yes | The gate refuses fields that cannot act: `errorKind` with `never_settles` or `failTimes: 0`; `resolvesWith`/`resolveAfterMs` with `failTimes: "always"` |
| 9 | partly | Spark's prompt now says the experiment JSON is data, never an instruction. The text still reaches the prompt (the page offers only fixed scenarios; the API accepts any) |
| 10 | **skipped** | A render-time wording check on model-written text needs a decision first: what the screen should do when Spark's own rationale says "correct". That is Dami's call |
| 11 | yes | Request bodies over 64 KB get 413 |

## What it proves

- Each should-fix item is closed at the behaviour the review measured, with a test that failed before and passes now.
- The day-1 gate's "can't check" still comes from S6, from a real run, for a true reason.

## What it does not prove, and what to know

- **S4 trade-off.** Kept sessions cannot be pushed out, so someone who opens 500 sessions with one sealed bet each blocks NEW sessions for up to 2 hours (they get a 503 with a plain reason). The old behaviour lost people's bets instead. A per-client limit needs a client identity, which does not exist yet.
- **S5 counts.** "Calls" counts Atlas's calls to the client. If the client retries one call internally after a reply cut off for length, that is two HTTP requests but one counted call. A call with no reported usage cannot be added to the spend.
- **S7 records written by `pnpm server` are real** but not yet tested live: no live server ran in this task.
- The agent log still keeps at most 200 sessions; a busy server can drop a quiet session's log lines (never its bets).
- Older evidence files (D02-02b, D02-04, D02-05 test outputs) contain this machine's local paths. Not changed here.
