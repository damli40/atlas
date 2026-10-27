# E3: paste any code (JavaScript / TypeScript), end to end

Date: 2026-10-27 (WAT) · live spend $0.047 (one round, three model calls) · Node 25.8.1, local executor.

## Where to look first

- **What now works:** a person pastes one JS or TS file. Plain code reads its language and its exported functions.
  The person picks a function. Muse Wonder (muse-wonder-1.0) proposes up to 3 tests, or the person writes one in a
  form. Atlas's gate checks every test; a refused one is shown with its reason and never runs. The person and the
  betting models (Muse Spark 1.3, Muse Spark Open) seal bets. Atlas runs the function in the sandbox, the judge
  compares, and the page shows the verdicts, a new machine (the **call timeline**) and the proof card.
- **The honest-information rules, and how they are enforced:**
  - D19: the bet screen shows a box "What every bettor sees". The server builds that text once
    (`src/paste-context.ts`), shows it to the page, and puts the same bytes in each betting model's prompt. A test
    compares the prompt to the page's text byte for byte.
  - D18: Muse Wonder's one-sentence claim never reaches a betting model. The server also holds it back from the page
    until the person's bets are sealed (`POST /paste/claim` answers 409 before that), so the person and the models
    bet on the same information. **This is a choice Dami can reverse** (one route; see "Decisions I made").
  - Pasted code goes only to non-contributor Meta models: `server/meta/pasted-guard.ts` refuses a contributor id
    even when `ATLAS_ALLOW_CONTRIBUTOR=1` is set, and the call is never sent, counted or paid.
  - A whole-run "can't check" is shown in plain words, for example
    "Can't check: the code needs axios; Atlas runs one pasted file on its own, with no packages or other modules."
- **The machine:** a timing bench drawn ONLY from the run (trace + measured fields): the ruler is the virtual clock,
  the front rail is the function with its end token, one rail per stand-in with one peg per call. It draws nothing
  when the known-case check did not match or the whole run is "can't check".

## Commands and counts

```
pnpm vitest run tests/unit/paste-server.test.ts tests/unit/call-timeline.test.tsx --reporter=verbose
pnpm test
npx tsc -p .
npx tsx tests/tools/timeline-pages.tsx          # the machine's evidence pages
PORT=8797 pnpm exec tsx tests/evidence/E3/mock-server.ts ; ATLAS_API_PORT=8797 pnpm exec vite --port 5183 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> node tests/evidence/E3/drive.mjs <chromium headless shell> tests/evidence/E3/playwright
E3_LIVE=1 pnpm exec tsx tests/evidence/E3/live-run.ts   # spends money (capped at $2.50)
```

| | Before E3 (5f28a6c) | After E3 |
|---|---|---|
| Test files | 82 | 84 |
| Tests passed | 920 | 954 (+34: 17 server, 17 machine) |
| Skipped | 19 | 19 |
| Type check | 0 errors | 0 errors (`tsc-output.txt`) |
| Browser click-through (`drive.mjs`) | n/a | all checks passed (`playwright/browser-output.txt`) |

Files: `test-output.txt` (the 34 tests by name), `full-suite.txt`, `tsc-output.txt`.

## What was tested

**Server (`tests/unit/paste-server.test.ts`, 17 tests, models mocked, real sandbox):**
- `POST /paste`: language guessed by plain code with the sign it used ("a type annotation on a parameter on line 2"),
  the person's choice wins, exports with lines, fingerprint ref, source never echoed back, the log line has no code.
  Python shows "coming" and nothing is kept. A fake `py` runner plugs in with no other change. Over 64 KB → 413; empty
  and malformed → 400; an import is reported early as "can't check"; another session cannot use the paste; pastes are
  counted per client address.
- Muse Wonder's proposals: 3 shown, the refused one with the gate's reason and no way to run it (422); the allowed
  one becomes an experiment `proposedBy: investigator, muse-wonder-1.0`; the claim is absent from every answer until
  the person's bets are sealed. No proposer → "not asked"; 3 proposal requests per session.
- Contributor guard: refused even with `ATLAS_ALLOW_CONTRIBUTOR=1`, for Wonder and for Spark on a pasted round; the
  mocked chat is never called and the budget counts nothing. The same id still reaches the chat on the public
  fixture, so the guard is scoped to pasted code.
- D18/D19 parity: Spark's and Spark Open's prompts hold `seenContext` byte for byte; neither holds the claim; both
  get identical messages.
- A whole round: bets → run → verdicts (matched / didn't match) → `.atlas.json` that verifies, kept in memory only,
  replay gives the same `measured`. An `import axios` file: every verdict "can't check" with the reason, never "threw".
  A person's refused test: 422, kept, `POST /runs` refuses. Muse Code and the Adversary are never asked about pasted code.

**Machine (`tests/unit/call-timeline.test.tsx`, 17 tests, 7 real runs):**
- `model.ts` imports only the `Run` type and `src/trust.ts`.
- Each real case: rails, pegs, cap marks and end token equal the trace and measured fields (throws-then-returns,
  always-throws 700 ms, never-answers, a late answer drawn as a rib 0→250 ms, still running at a 5,000 ms watch limit
  with the count not claimed, no stand-in at 0 ms, two stand-ins). A held moment hides what had not happened yet.
- `controlPassed: false`, `controlPassed` missing, a whole-run reason, an empty trace: no drawing, no number, the
  reason printed (the day-5 blocker).
- Manifest: every drawn part is listed and every listed part is drawn by some case. A rail with more calls than it
  holds is not drawn, with the reason.

**Anatomy checks (`timeline/`):** `scripts/lines.mjs` prints **`line ends: 0`** on all 19 pages (7 cases × dark and
light, 2 held moments × 2 themes, control failed) — `timeline/lines-output.txt`. Screenshots `timeline/*-760.png`, two
at 390 px. Data-only input and "never a part the code lacks" are the tests above.

**Browser (`drive.mjs`, headless Chromium, real server with models mocked, $0):** the example round at 1920 (light)
and 390 (dark); a person's own test from the form (and a refused one); an `import axios` file at 1920 and 390.
axe-core 4.10.3 (WCAG 2 A/AA + best practice): **0 violations on 8 page states**. Overlap check (from D07-04):
**0 overlapping text pairs, 0 text outside** on every new section at both widths and both proof cards. No horizontal
scroll at 390. No running animation under reduced motion. No page errors.
The first run failed 9 checks; fixed: the bet form was 565 px wide at 390 (a fieldset's minimum width), the readout
overlapped "Space replays" on a phone, the verdict table spilled at 390, the proof card's 4 marks ran past their
column, white text on the dark-mode accent was below 4.5:1 (also fixed for the existing buttons), scroll boxes were
not focusable.

Screenshots (`playwright/`): `paste`, `pick`, `proposals`, `bet`, `run`, `verdict` at `-1920` and `-390`;
`proof-card-1920/390`; `full-round-1920/390`; `own-test-form-1920`, `own-test-run-1920`, `own-test-refused-1920`;
`cant-check-run-1920/390`.

## The live run (`live/`)

`live-run.ts`, one round, real models, `x-atlas-claimant: both`. Code: the paste screen's example
`retryWithBackoff` (written for the hackathon). The "person" was the script: it sealed one bet, outcome `returned`,
fixed in the code before any model answered.

- Muse Wonder proposed 3 tests, all allowed. Test 1: fetchIt always throws `Error("boom")`, 3 attempts, 100 ms base.
- Its claim (revealed only after the seal): "People expect the function to throw immediately after the last failed
  attempt; the code does an extra exponential backoff wait after that final failure before throwing."
- The run (control matched): `outcome threw`, `virtualMs 700`, `calls:fetchIt 3`, thrown `Error: boom`.
- Verdicts: the script's `returned` didn't match. Muse Spark 1.3: outcome, virtualMs 700, calls 3 matched;
  returnedJson declined → can't check. Muse Spark Open: the same three matched; returnedJson `null` → can't check (the
  call threw, so nothing was returned to compare).
- The `.atlas.json` verifies; the replay gave the same measured fields.

| Call | Tokens in + out (reasoning) | Cost |
|---|---|---|
| muse-wonder-1.0 (proposals) | 739 + 853 (535) | $0.0200 |
| muse-spark-1.3 (bets) | 1,041 + 951 (709) | $0.0232 (upper bound: price unverified) |
| muse-spark-open-1026 via Baseten (bets) | 1,174 + 582 (327) | $0.0039 |
| **Total** | | **$0.0471** (cap for this batch: $3) |

Usage lines are in `live/usage.jsonl` (not the shared `tests/evidence/usage/usage.jsonl`, to avoid merge conflicts
between batches). Full facts: `live/live-run.json`; console: `live/live-run-output.txt`.

## Decisions I made (Dami can change any)

1. **The claim is held back until the bets are sealed.** That makes D18 (Spark never sees it) and D19 (Spark sees what
   the person sees) both true. If you want the claim visible at proposal time, `/paste/claim` drops its 409; the
   person then knows one sentence more than the models.
2. **"Investigator" is the proposer's role** in `Experiment.proposedBy` (types + proof-file schema, additive).
3. **Python plugs in by one entry** in `runners/pasted-registry.ts` (`read`, `control`, `run`). No screen or route
   changes; the language picker shows "Python (coming)" until then.
4. **Pasted rounds never write to the public `proofs/` folder**: their `.atlas.json` stays in memory even with
   `ATLAS_PUBLISH_PROOFS=1`, and gate refusals / can't-check records about pasted code are not written as refusal files.
5. **Muse Code and the Adversary are not asked about pasted code** (a `muse exec` call is not behind the guard, and
   change-replay on pasted code is not built).
6. All paste-flow sentences live in `src/paste-words.ts` for your rewrite.

## What this does NOT cover / known limits

- The click-through is a Playwright script run by hand (like D07-04), not part of `pnpm test`: the repo has no
  Playwright dependency. It exits 1 on any failed check.
- Anyone with a pasted round's run id can open its proof card, which contains the pasted source (the share link is the
  point of a proof card). The id is 10 random characters. TS replays of pasted code are not rate-limited (same as the
  fixture's today).
- Memory: pastes are capped (200 sessions × 5 files × 64 KB, 60 pastes per address an hour), but experiments keep a
  reference to their paste, so a determined client could hold more through many experiments. Bounded by the existing
  session and experiment caps; not measured.
- D19 is about the bet section: the page also shows the proposals list (other tests, refusal reasons), which the
  models do not get.
- The timeline draws 22 pegs per rail at most and 6 stand-in rails; a busier run is "not drawn" with the reason.
  It has fewer parts than Anatomy's 40–80 for small runs (it draws only what the run has); the Anatomy geometry audit
  (`--audit`) was not run (it needs the kit's recorder, which the React machines do not use); the line-end check was.
- Language guessing is a heuristic about the language only; a wrong guess gives the runtime's own error as "can't
  check", and the person can choose.
- No separate adversarial review agent has looked at E3 yet.

## Review round 1 (adversarial review: 5 blockers, 6 majors, 9 minors; all fixed except one logged)

**Counts after the fixes:** 976 passed, 19 skipped, 85 files (`review1/full-suite.txt`). Type check clean. The 22
new tests are in `tests/unit/paste-review1.test.tsx` (`review1/test-output.txt`). The browser click-through ran again
and every check passed (`playwright/browser-output.txt`, 48 checks; the screenshots there are the new ones). The
reviewer's attack scripts were run again on the fixed code; their outputs are in `review1/*-after.txt`. No model was
called in this round ($0). The live round above was recorded **before** these fixes. In that run the claim was read
right after the person's seal; that order is now refused (`live-run.ts` now reads the claim after the run).

| Finding | Fix | Proof |
|---|---|---|
| **B1** D19: the bettor text cut values at 60 characters; the person saw them in full | The bettor text gains "The test exactly, as JSON (what Atlas runs): …": the whole test, never cut (`testJson`, canonical JSON with hidden characters escaped). The page's "The test as JSON" view shows the same bytes | test "B1"; `attack1-after`: `seenHasSecretTail`, `sparkPromptHasSecretTail`, `sparkPromptHasHiddenReturn` all true |
| **B2** the claim could be read after one seal, then more bets sealed; a proposal set stayed usable | The claim opens only once the round's bets are frozen for every bettor (its run started). Once read, the set is closed: no experiment (as proposed or edited) and no bet on an open round from it (409). The page asks for the claim after the run | tests "B2" A and B (the review's exact sequences); `attack7-after` (`claim: 409` after the first seal), `attack3-after` |
| **B3** 64 KB of empty lines → 645k-character bettor text per round, 1.3 MB each | Files of at most 2,000 lines (413). Bettor text capped at 150,000 characters (else the test is refused). One text per (file, test, writer), shared by its rounds. All pastes ≤ 32 MB. 200 experiments on pasted code per address per hour | test "B3" (50 rounds → 1 text); `attack2-original-after` (the old attack's file is refused at once); `attack2-capped-memory-after`: the largest allowed file, 60 pastes: 200 experiments, **12.6 MB in all, 63 KB each** (was 1.3 MB each) |
| **B4** 60,000 calls → 120,003 trace events, 7.6 MB answer, 42 MB kept per run | The harness keeps at most 1,000 trace events (endings always kept), then one `trace_cut` event with how many events, and how many calls per stand-in, were not kept. Counts stay exact; proof-file verify adds the dropped calls back; the timeline is not drawn, with the reason | test "B4"; `attack4-after`: trace 1,003 events, answer 0.1 MB, calls 60,000 |
| **B5** 24 parallel replays of pasted code with no session; no cap on TS runs | A pasted round replays only for its own session (403 otherwise). Every sandbox start (TS runs, sweeps, change replays, replays, autonomous TS rounds; fixture too) takes a slot: 2 at once per session and per address, 4 overall, hourly caps (`ATLAS_SANDBOX_*`) | test "B5" (403 ×2, 200 for the owner; 2 parallel runs at a cap of 1 → 200 + 429); `attack2-capped-cpu-after`: no session → 403; 24 parallel with the session → 200/429, **peak 2 worker processes** (was 24) |
| **M1** a re-paste with another language kept the old one | A re-paste replaces the stored file | test "M1"; `attack3-after` `languageRepaste`, `languageRepaste2` |
| **M2** pasted rounds' prompts carried Moonwell's "in USD" instruction | Each round type has its own instruction. Pasted rounds pass none outside the bettor text, which holds the paste instruction the person reads | test "M2"; `attack5-pasted-after` is empty. Moonwell keeps its own: the reviewer's call, which uses Moonwell's default, still prints it |
| **M3** the real server never asked Muse Wonder | The live server's options are built in `server/wiring.ts` (`serverOptions`), which `server/index.ts` uses; the proposer is on unless `ATLAS_PROPOSER=off` | test "M3": the same options, a fake chat, Wonder asked; off → not asked |
| **M4** the privacy sentence was false; anyone with a run id got the source | `GET /proofs` gives the source to the owning session only; others get the card without it (`sourceWithheld`, fingerprint kept). The paste page keeps its session in the tab (sessionStorage), so its own proof card still shows and re-runs. The sentence now names: this session's memory, the sandbox, Meta's API, no contributor model, Baseten when Muse Spark Open bets | test "M4"; `attack1-after` `proofFromB.holdsSource: false` |
| **M5** prompt cost grew with the paste, no check before the call | Lines capped (B3). Every call carrying pasted code is refused, unsent, when its prompt is over 160,000 characters or its upper-bound cost is over $2 (every prompt character counted as a token, plus the largest output the client can ask for) | test "B3 / M5" (the guard) |
| **M6** a new first X-Forwarded-For hop each time beat the per-address limit | With `ATLAS_TRUST_PROXY=1`, the address is the right-most hop (the one the proxy appended); `ATLAS_TRUST_PROXY_HOPS` for proxies in a row. The existing caps test now writes the client as the right-most hop | test "M6"; `attack6-after`: rotating first hop → 60 then 429 |
| minor 1 `__proto__` key accepted | Refused with the reason before zod reads it (`server/paste-keys.ts`) | test |
| minor 2 hidden characters shown raw | Every gate reason and Muse Wonder's sentence pass through `visibleText` | test |
| minor 3 bet labels cut at the wrong place | The page uses `shortQuestionFor` (startsWith) | by reading; covered by the click-through |
| minor 4 the 422 echoed the source | `withoutSource` on the refusal | test; `attack8-after` `badEchoesSource: false` |
| minor 5 Wonder paid for a can't-check file | Not asked, with the reason | test |
| minor 6 `text/plain` pastes | 415 unless `application/json` | test; `attack1-after` `textPlain: 415` |
| minor 7 oversize paste used quota | Counted only after the size and line checks | test |
| minor 8 `Math.random` not seeded | **Logged, not fixed.** The proof card's "clock" line says such code is not seeded and can replay differently, and a replay that differs on a pasted round adds that note | by reading |
| minor 9 an edited Wonder test credited only to the person | `editedFrom` (proposal id + model) is recorded on the experiment and in the proof-file schema; the bettor text says "you (the person), edited from Muse Wonder 1.0 (muse-wonder-1.0)'s test …" | test |

**Chosen, not changed:** the same proposal may start two rounds while its claim is still unread (`attack1-after`
`sameProposalTwice: 200`): no bettor has the claim then, so parity holds; once the claim is read, the set closes.
Moonwell rounds keep their own bet instruction (it is in their bettor text).

**Still not covered:** memory was measured for one address; many addresses together are bounded by the session,
experiment and retained-paste caps, not measured. The reviewer's crash was extrapolated by them and was not run here
either. The sandbox caps are per server process (a hosted Modal setup needs the same caps on its side).

## Review round 2 (3 blockers, 4 majors, 11 minors; rebased onto main b28f9b3 with E2's Python)

**Read this first: it corrects earlier sections.** (1) Python now runs in the paste flow (E2's runner, registered
here), so "Python shows as coming" above is out of date: a language shows "coming" only when no runner is
registered. (2) Round 1's memory figure, "63 KB each, 12.6 MB in all", was measured with ONE test reused. With
400 distinct tests, round 1's code kept 174 KB per round (the reviewer's measure). The fixed code keeps **16 KB per
round** (`review2/mem2-after.txt`: 400 distinct tests on the largest file, 6.3 MB in all, one numbered file shared).
(3) The privacy sentence was changed again; the round-1 wording ("never on disk") was not true.

**Counts:** 1,130 passed, 20 skipped, 91 files, **3 full runs in a row, all clean** (`review2/full-suite-x3.txt`).
Type check clean. The new tests: `tests/unit/paste-review2.test.tsx` (15) and a Python round in
`paste-server.test.ts` (`review2/test-output.txt`). Browser click-through: **59 checks, all pass**, now with a Python
round at 1920 and 390 px (`playwright/python-run-*.png`). The reviewer's round-2 scripts were run again
(`review2/*-after.txt`). $0, no live model call.

| Finding | Fix | Proof |
|---|---|---|
| **B1** a cut trace said "not answered before Atlas stopped watching" | When the trace was cut, the timeline's words give only the exact counts ("f: 1,000 calls · g: 1 call"), no breakdown by answer | test "r2 B1", the reviewer's case at n = 499 and n = 1,000 |
| **B2** the bettor text said JavaScript for a TypeScript round | The cached part is keyed on everything that appears in it (file, language, export line, writer, test, repeat) | test "r2 B2" (re-paste JS → TS; a second session as TS); `attack-r2-after` `languageRepaste` |
| **B3** 174–513 KB per round; texts built and cached before the length check | (1) The gate's 4,096 budget counts every text of a test: JSON values, stand-in names, error names and messages, each after `visibleText` (a hidden character counts as its 6-character escape). (2) The length is checked before anything is cached; a refused text is never kept. (3) The numbered file is kept once per (file, marked line) and joined on when served; rounds keep only their short test part, shared by identical tests. (4) At most 20 pasted rounds per session and 64 MB (characters of text and run) overall; past either, the oldest round that is not running is dropped, the session's own oldest first | test "r2 B3" (the U+0085 messages refused at 15,000 counted characters; 25 distinct tests → 1 numbered file; the 21st round drops the 1st); `mem2-after`: **16 KB per round**; `mem-allowed/refused-after`: the reviewer's message-heavy requests are now refused before any text is built |
| **M1** the privacy sentence was not literally true | It now says: kept in memory at most 2 hours then deleted, never in the repo; written to a temporary file in the sandbox for each run and deleted when it ends (and at server start if a run was cut short); sent to Meta's API (never a contributor model) and to Baseten when Muse Spark Open bets; a shared proof link shows the function's name, the test, the results and the models' bets and explanations, not the code. Made true by: a 2-hour limit on pastes, proposal sets, bettor texts, rounds and proof files (`PASTE_TTL_MS`, swept every 5 minutes); leftover sandbox folders (older than 10 minutes, so another server's live run is never touched) deleted at startup; a stranger's proof view has no source **and no session log** (the test, facts, verdicts and bets stay) | test "r2 M1" (stranger: `agentLog: []`, no source; the owner gets both; the leftover cleaner) |
| **M2** a copied test got past the claim closure | **Coordinator's decision, Dami may revisit:** a test canonically equal to one already run in the session is accepted, said on screen ("a repeat of a test you've already seen run") and in the bettor text, and every bet on it, the person's and the models', is sealed with `repeat: true` (in the seal hash), so a track record can leave it out. The proof card says so too | test "r2 M2" (repeat: true on every bet; removing it breaks the seal) |
| **M3** a 150,000-character text made a 208,178-character prompt that the guard refused | One limit: the bettor text may be at most the prompt cap minus the prompt's fixed part for that round's questions (`pastedSeenCap`, computed from the real prompt builder). A test over it is refused at POST /experiments (413) | test "r2 M3": a text of exactly the cap makes a prompt of exactly 160,000 characters, which the guard sends; one more is refused |
| **M4** a wrong proxy-hop setting was silent | `ATLAS_TRUST_PROXY_HOPS` must be 1–10 or the server refuses to start (createApp throws); the rule in use is printed at startup ("the right-most address in X-Forwarded-For …" or "the socket's remote address") | test "r2 M4" |

**Minors fixed:** 1 a proposer-only server now uses the shared budget (it was asked past the ceiling); 2 a lone CR is
refused with a fix ("save it with LF or CRLF line endings"), and U+2028/U+2029 count toward the 2,000-line cap; 3
"written by you, edited from Muse Wonder 1.0 (muse-wonder-1.0)'s test …" on screen too; 4 the paste screen's verdict
section is numbered 6; 5 the proof route withholds the source unless an owner is on record AND the header names it;
6 hidden and direction characters in the numbered file are escaped in the bettor text (the page shows that same
text); 7 the flaky test now uses 3,000 calls (it still crosses the 1,000-event cap) and the suite runs on half the
cores with a 20-second per-test limit: 3 clean runs; 9 `trace_cut.kept` is the number really kept.

**Logged, not fixed:** 8 the $2 per-call ceiling never binds at today's prompt cap (the prompt cap is what limits
cost); 10 a run with more than 22 calls to one stand-in, or more than 6 stand-ins, is "not drawn" (with exact
counts); 11 only the person sees Muse Wonder's other (unchosen or refused) proposals. Also: a lone CR is refused
rather than supported (Atlas's export scan reads LF); the Python harness's own trace cut records how many events it
dropped but not per stand-in, so proof-file verify then checks only that the kept calls do not exceed the count;
memory was measured for a few addresses, not many at once; the reviewer's `disk.mts` was not re-run (the sentence
now says the file is written during a run).

## After E4 (rebased onto main 8b17ccf)

- **Rebase:** conflicts in `server/index.ts` (kept E4's executor selection from `ATLAS_EXECUTOR`, its Modal warm-up and
  startup line; added the E3 wiring from `server/wiring.ts`, the proxy-hop check and the leftover-folder cleanup) and in
  `tests/evidence/README.md` (both lines kept). The `vite.config.ts` change (half the cores, 20-second test limit) stays.
- **Routing:** the paste registry now gets its known-case checks from E4's `callControlFor` / `pyControlFor` (D31:
  a passed check is reused for up to 10 minutes per harness and executor; each run records the control it relied on)
  and runs on the executor the server chose: with `ATLAS_EXECUTOR=modal`, JavaScript, TypeScript and Python all run on
  Modal; with the local executor, JavaScript on Node and Python on sandbox-exec (E4's `pythonExecutorFor`). Nothing is
  hard-wired to a local executor any more, and the paste flow's own control cache is gone (E4's reuse replaces it).
- **Warm-up (D32):** `runners/executor/warm.ts` warms the Python control too, in one more sandbox. E4's two warm-up
  tests were updated to expect two lines and two sandboxes.
- **Test:** "after E4" in `tests/unit/paste-review2.test.tsx`: with a fake Modal executor (E4's emulating backend), a
  pasted JS round and a pasted Python round both run on it; the local Node executor and sandbox-exec are never called;
  each proof file names `modal`, a passed control, and the control run its `call_checks` line relied on.
- **Counts:** 1,184 passed, 35 skipped, 96 files, **3 full runs in a row, all clean**
  (`review2/full-suite-x3-after-e4.txt`). One earlier attempt failed once: E1's "under 5 s" timing assertion in
  `day-gate.test.ts` during a run that took 120 s overall (the machine was busy); I did not loosen that assertion.
  Browser click-through on the local executor: 59 checks, all pass. $0.

## Model bets on the returned value, and the benchmark's builder

- **The `json` answer kind for model bets** has been in `server/meta/schemas.ts` (`betAnswerSchema`) on this branch since
  the first E3 commit. Each model json bet goes through the same plain-code check as a person's json bet
  (`jsonBetValueProblem`: depth ≤ 98, plain JSON, ≤ 2,048 characters), in `server/meta/roles/claimant.ts`. `main` before
  E3 did not have it. New tests (in `paste-review2.test.tsx`):
  - Muse Spark and Muse Spark Open (mocked) both bet `{"sum":3}` on a function that returns it: sealed, seal verified,
    judged matched.
  - A model json bet nested 99 levels deep, or over 2,048 characters: "no usable answer", "not a JSON value Atlas can
    compare".
- **The one bet-context builder for pasted rounds** is `pastedBetContext` in `src/paste-context.ts`: a pure function
  with no I/O and no Moonwell "in USD" line. A test checks that the server's bettor text equals its output byte for
  byte. The models' prompt around it is `buildBetOnlyMessages({ seenContext, questions, seenInstruction: null })` in
  `server/meta/roles/claimant-bets.ts`; `null` means no extra instruction, because the paste instruction is already
  inside the text.
- Full suite after this: 1,187 passed, 35 skipped.

## Review round 3 (final: 1 blocker, 2 majors, 7 minors; every round-2 fix held)

**Counts:** 1,195 passed, 36 skipped, 96 files, **3 full runs in a row, all clean** (`review3/full-suite-x3.txt`).
Type check clean. Browser click-through (local executor): 59 checks, all pass. The reviewer's round-3 scripts were run
again (`review3/*-after.txt`). $0, mocked models only.

| Finding | Fix | Proof |
|---|---|---|
| **B1** the privacy sentence left out Modal; "at most 2 hours" was really up to 2 h 5 min; the restart clause overstated the cleaner | The sentence is now built by the server from its own configuration (`PASTE_WORDS.notStored(executor)`, served by `GET /paste/languages`). On Modal it says the code is "sent to Modal (a cloud company that runs sandboxes) and written into a throwaway Modal container that has no network and is shut down when the run ends". Locally it says a temporary folder on this server, deleted when the run ends, and that a folder left by a cut-short run "is deleted at the next server start at least 10 minutes later" (what the cleaner does; I reworded rather than track folders across processes, because another server's live run on the same machine must not be touched). The time rule is now exact and stated as such: "until 2 hours after you last pasted it, then deleted (checked every minute)". The sweep runs every minute AND before every request, so nothing expired is ever served. It also names error messages, which can quote names from the code (minor 5) | test "r3 B1": the sentence for local and for Modal; a source just under 2 hours old is served, just over is gone with its round and its proof file |
| **M1** a Python run past 5,000 events lost its ending: no proof, nothing said | Python harness (E2's code, minimal change): the start and every ending are always kept past the cap, as in the JavaScript harness; dropped stand-in calls are tallied per name in `trace_cut.droppedCalls`, so verify recounts exactly. Server: a pasted run whose record does not hold together is never judged silently: its verdicts become "can't check" with the reason; when only the proof failed, the page says "No proof card for this run: <reason>" | test "r3 M1" at n = 2,498 and n = 3,000 (ending kept, counts exact, proof verifies, replay equal); `pycut-after` (every n now has its ending and a proof) |
| **M2** each round kept its own copy of the source, outside the budget | One copy of each source per (fingerprint, language), shared by every paste entry, round and proof file. Proof files are stored without the source and re-attach the shared copy when read. The round budget counts each distinct source once. All sources together are capped at 64 MB (the one pasted longest ago drops first, with its rounds, unless a protected round uses it) | test "r3 M2" (two sessions, 20 rounds: the source counted once); `mem3-40x20-after`: 800 rounds on 800 distinct 63 KB files, 64.6 MB; `mem3-120x20-after`: **2,400 distinct files (151 MB pasted): 88 MB heap growth**, held by the caps |

**The real memory bound now (corrects round 2's "64 MB overall"):** pasted sources ≤ 64 MB, round test parts and runs ≤
64 MB, pasted proof files ≤ 64 MB (stored without source), per-session paste entries share the sources. So roughly
200 MB of pasted-code state at most, all of it dropped 2 hours after the last paste.

**Minors fixed:** 1 over either cap, the session that went over gives up its own oldest round first, then others'; a round that is running or holds the person's sealed bets is never dropped (the models' bets do not protect a round: they seal on every round by themselves); the budget is enforced again after a run's size is added; a proof link lives as long as its source (2 hours), within the 64 MB proof budget, not "until 200 later runs" (test "r3 M2 and minor 1"). 2 verify (E4's `callRunControlProblems`) now refuses all four tampers: a missing `call_checks` line or missing control time, `controlPassed` disagreeing with the run, a runtime executor disagreeing with the run, and a run that says "modal" with no Modal runtime (test "minor 2"). 3 the repeat check fills the defaults first (`watchLimitMs` 30,000, `afterMs` 0) (test). 4 a json bet holding a whole number beyond 2^53 is refused ("cannot be compared exactly"), for people and models (test). 5 the sentence names error messages.

**Logged, not fixed:** 6 a local Python run records no `runtime` in `call_checks` (E2/E4's runner; a local run's
executor is still named on the run). 7 empty `atlas-adv-usage-*` folders left in the temp folder by another test (not
E3's). The reviewer's `track.mts` uses the old `trackRound` signature and no longer runs; the unit test above covers
it.
