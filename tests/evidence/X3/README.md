# X3: per-person track record (D27) and common-failure labels (D28)

Date: 2026-10-28 (WAT) · live spend **$0.0892** (one check, 4 model calls, cap $0.30) · Node 25.8.1, local executor.

## Where to look first

- **Track record (D27).** After every judged round, plain code adds the person's own sealed bets and the judge's
  verdicts to their record. It groups them by what the question was about: outcome, returned value, timing, call
  counts, Moonwell price. It shows "matched / didn't match / can't check" with n. A percentage appears only when
  n ≥ 5, and always next to n. Bets sealed as repeats (E3 `repeat: true`) are left out, and the panel says how many.
  - Shown on a small "Your track record" panel on the paste screen, and under the proof card as "Your record before
    this round".
  - Wording: "Where your guesses matched what the code did". A test scans every sentence for learn, teach, score,
    skill, right and wrong.
- **Wonder aims at weak spots.** When the person asks Muse Wonder for tests, its prompt gets one extra paragraph:
  the question types where this person's bets most often didn't match, with counts. No code, no question text, no one
  else's data. The page shows the person exactly what Wonder was told. A person with no misses gets the prompt
  byte-for-byte as before X3.
- **The bettors' text did not change (D19).** A test runs the same round with and without a long track record: the bet
  screen's text and both betting models' prompts (Muse Spark, Muse Spark Open) are byte-identical.
- **Common-failure labels (D28).** A short curated list in `src/failure-labels.ts`. Each failure shown on the paste
  screen and on an explorer part's card gets exactly one label, decided by plain code:
  - **reproduced**: a sealed Atlas run of this function showed it. Links to that run's proof card.
  - **inconclusive**: a run that set the failure up came back "can't check".
  - **found in this code**: plain code's marker matched in the part's own lines. Links to those lines (shown under it).
  - **common pattern**: only the list says this kind of code often fails this way. Never shown as present in the code.
  Muse Wonder's outline tags (X1) can make a kind appear on a part. They never decide a label.
- **Live check:** label "no overall timeout" went from "found in this code" to "reproduced" on a real round
  (below). Wonder's real prompt carried the weak-spot summary.

## Who "the person" is

- Hosted (invite codes on): the invite code, by its id.
- Local: **this browser**. The page keeps a random id in localStorage and sends it as `x-atlas-browser`. I chose this
  over the session id because the page uses a different session for each mode (fixture, PR, paste), and the paste
  session lives only in one tab. With the session id, one person would have had several records. A request with no
  browser id falls back to the session.
- On disk, each person is a file named by SHA-256 of "kind:id". No session id, browser id or invite id is stored.

## Where it is kept (G1's pattern)

`<ATLAS_INVITES_DIR>/track-record/<hash>.json`: folder mode 700, files mode 600, written atomically (temp file, then
rename) after each judged round. A restart reads it back (tested). An entry holds only: run id, bet id, seal hash,
question type, verdict outcome, repeat flag, and for numbers whether the guess was lower or higher than the run. A
file edited by hand cannot add other fields: only entries of exactly that shape are read (tested). Limits: 1,000
entries per person (oldest drop), 2,000 people (the file written longest ago is deleted).

What counts: every human bet judged by `POST /runs` (paste, the fixture, Moonwell). What does not: the models' bets,
autonomous rounds (no person), and the re-judging after a change replay (that is the same bet again).

## The curated list and each marker's plain-code rule

Before any check, comments are blanked out. For most checks, string contents are too, so a word in a comment or a log
message never counts. "A retry loop" below means: a `for`/`while` loop whose body contains `catch` (JS/TS) or
`except` (Python). A loop's body is its braces (JS/TS) or the lines indented under it (Python).

| Kind (plain-code sign) | Failure | Marker: "found in this code" when… | Reproduced when a sealed run… |
|---|---|---|---|
| **retry** (a retry loop) | retry storm | a retry loop has no wait in it: no `sleep`, `setTimeout`, `delay`, `wait`, `backoff…` | set a stand-in to fail on every call, and it was called **20 or more** times |
| | duplicate side effect | no marker (plain code cannot see whether a call is safe to repeat) | (no run rule) |
| | no overall timeout | a retry loop, and **nowhere** in the lines a deadline: `timeout`/`deadline…` names, `AbortSignal`/`AbortController`, `signal`, `Promise.race`, `wait_for`, `asyncio.timeout`, or a clock read (`Date.now`, `performance.now`, `time.time`, `monotonic`, `perf_counter`) | set a stand-in to never answer, and the function never settled or was still running at the watch limit |
| **RPC or network call** (a call to `fetch…`, `axios`, `rpc…`, `provider`, `urlopen`, `requests`, `httpx`, `aiohttp`, `eth_…`, `getBlock…`) | timeout | a network-style call and no deadline (same list) | same as "no overall timeout" |
| | rate limit | a network-style call inside a retry loop, and nowhere (strings included) `429`, rate limit, `Retry-After`, too many | (no run rule) |
| | provider outage | no marker | (no run rule) |
| **concurrency** (`Promise.all/allSettled/race/any`, `asyncio.gather/create_task/wait`, threads, worker pools, locks) | race | one line writes `this.x`/`self.x` from an expression with `await` that reads the same value (or `+=` with `await`) | (no run rule) |
| | lost update | a local set from `this.x`/`self.x`, then a later `await`, then a later assignment to that same `this.x`/`self.x` | (no run rule) |
| **queue** (queue, enqueue, consume, ack, publish, subscribe, SQS, Kafka, AMQP, …) | duplicate delivery | an ack call (`ack`, `deleteMessage`, `basic_ack`, `commitOffsets`) after other calls, and no duplicate check (`seen`, `processed`, `dedupe`, `idempot…`, `messageId`, `already…`, `isDuplicate`) | (no run rule) |
| **database write** (`.insert…/.update…/.upsert…/.save…/.execute…/.delete…(` or an INSERT/UPDATE/DELETE string) | partial commit | two or more writes and no `transaction`, `BEGIN`, `commit`, `rollback`, `atomic`, `savepoint` | (no run rule) |
| **time** (`Date.now`, `new Date`, `performance.now`, `time.time`, `datetime.now`, …) | clock skew | a duration made by subtracting wall-clock reads (`Date.now() - …`, `time.time() - …`) | (no run rule) |
| | time zone | a local-time method (`getHours`, `getDate`, `toLocaleString`, …), or Python `datetime.now()` with no time zone, `fromtimestamp(x)` with no time zone, `date.today()`, `time.localtime()`, `time.mktime()` | (no run rule) |

How a label is chosen: if any run showed it → reproduced. Otherwise the newest run that set it up decides: if it came
back can't check (known-case check failed, whole run can't check, or the fact not measured) → inconclusive. If that run
measured that it did not happen, the label comes from the code, with a note naming that run. Then marker → found in
this code. Else → common pattern. Only runs of the same function (same code fingerprint, same export) whose proof card
exists count. For an explorer part: runs of any exported function inside the part's lines.

## Commands and counts

```
pnpm vitest run tests/unit/x3-*.test.ts* --reporter=verbose          # 42 X3 tests (test-output.txt)
pnpm test                                                              # full suite, 3 times (full-suite-1/2/3.txt)
npx tsc --noEmit -p .                                                  # tsc-output.txt
PORT=<port> X3_TRACK_DIR=<scratch> pnpm exec tsx tests/evidence/X3/mock-server.ts ; ATLAS_API_PORT=<port> pnpm exec vite --port <port2> --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=<vite url> node tests/evidence/X3/drive.mjs <chromium headless shell> tests/evidence/X3/screens
X3_LIVE=1 pnpm exec tsx tests/evidence/X3/live-run.ts                  # spends money (budget $0.30)
```

| | Before X3 (main 75428ba) | After X3 |
|---|---|---|
| Tests passed | 1,557 (35 skipped) | **1,598 passed, 36 skipped, 3 runs in a row, all exit 0** (`full-suite-1/2/3.txt`). +42 X3 tests; the one extra skip is the online GitHub test (`github-target.test.ts`), which skips itself when GitHub rate-limits, not an X3 test |
| Type check | 0 errors | 0 errors (`tsc-output.txt`) |
| Browser click-through | n/a | all checks passed (`screens/browser-output.txt`) |

## What the tests prove

- `x3-track-record.test.ts` (10): question types; only the person's bets whose seal still verifies; repeats kept but
  left out of the counts and counted; lower/higher for numbers; no percentage under n = 5, and n beside it at 5+;
  record before a round; weak-spot summary is types and counts only; the banned-words scan; the disk store survives a
  restart, has modes 700/600, holds no raw id, ignores hand-added fields, and keeps its caps.
- `x3-failure-labels.test.ts` (18): every marker positive and negative, in JS/TS and Python; a deadline in a comment or
  string does not count; Wonder's tag alone gives only "common pattern"; on six snippets with every kind tagged, no
  "found in this code" without its marker's lines, and no marker-less failure is ever "found"; run evidence:
  reproduced, inconclusive (three ways), "did not show it", newest-run rule, the storm threshold, a test that does not
  set the failure up is never evidence.
- `x3-server.test.ts` (9, real sandbox, models mocked): a round's bets land in the browser's record; before/after in the
  run answer; repeats left out; identity by browser, session, invite; restart on disk, no code or ids in the folder;
  Wonder's prompt has the summary and none of the earlier code; a person with no record gets the exact pre-X3 prompt;
  **bettor text and both models' prompts byte-identical with and without a record**; paste labels flip to reproduced
  after a never-answers round (proof card 200); an `import axios` file gives "inconclusive"; an explorer part's labels
  flip too; other sessions get 404.
- `x3-ui.test.tsx` (5): the panel's words; "record before" only for one's own round; the "found" link reaches its
  lines; "reproduced" links to `?proof=<runId>`; the explorer card shows labels with Wonder's tag named as Wonder's.
- `g1-invites.test.ts`: the three new routes are in its table and need an invite code when codes are required.

## Browser click-through (`screens/`, models mocked, $0)

At 1920×1080 (light): Explore → upload `retry.ts` → pick "Retry helper" (labels: "found in this code") → "Bet on
retryWithBackoff" → paste screen (empty panel, labels; the "found" link lands on its lines) → round 1 → the panel shows
the record by type → start again → Wonder's tests: "Muse Wonder … was told only this about your earlier rounds" → round 2
(stand-in never answers) → "no overall timeout" flips to **reproduced** with a proof link → back to the explorer: the
card says reproduced with the same link → click it → proof card with "Your record before this round" (round 1 only).
At 390 px (dark): one round in the paste flow, then its proof card.

**Result: all checks passed.** axe-core 0 violations on 8 page states; overlap check 0 overlapping pairs and 0 text
outside on 11 sections; no horizontal scroll at 390 px; no running animation under reduced motion; no page errors. The
first run failed 2 checks (heading order on the proof page: the new section used an h3 after the h1); fixed to h2.

Screenshots: `explorer-card-found-1920`, `paste-labels-found-1920`, `track-panel-1920`, `wonder-aimed-1920`,
`paste-labels-reproduced-1920`, `explorer-card-reproduced-1920`, `proof-card-1920`, `record-before-1920`,
`track-panel-390-dark`, `paste-labels-390-dark`, `proof-card-390-dark`.

## The live check (`live/`)

Real Muse Wonder (muse-wonder-1.0) and Muse Spark 1.3; sandbox, judge, store and labels real. Code: a 13-line
`withRetry` written for this check (a retry with a fixed 200 ms wait and no overall deadline). The "person" is the
script: its bets were fixed in the code before any model answered.

1. Labels before any run: "no overall timeout" **found in this code**, lines 4–11.
2. Round 1 (the script's test: `call` fails once, then answers): the run measured returned, 200 ms, 2 calls. The
   script's three bets (threw, 500 ms, 1 call) didn't match; Muse Spark matched all four.
3. Muse Wonder's real prompt carried: "outcome (1 of 1 didn't match); timing (1 of 1 …, higher 1); call counts (1 of 1
   …, lower 1)". It did not hold round 1's test values. Wonder proposed 3 allowed tests: two "fails every time" and
   one "returns at once". **None used a stand-in that never answers**, so round 2 used the script's own such test (the
   script said so before running it).
4. Round 2: outcome `never_settled`, 1 call. Labels after: **reproduced**, run `h6YOQJsMos`, "a stand-in never answered
   and the function never settled". Its proof card: 200.

| Call | Tokens in + out | Cost |
|---|---|---|
| muse-spark-1.3 (round 1 bets) | 1,097 + 473 | $0.0138 (price not verified: upper bound) |
| muse-wonder-1.0 (proposals) | 852 + 1,135 | $0.0261 |
| muse-spark-1.3 (round 2 bets, call 1) | 1,001 + 1,336 | $0.0307 (upper bound) |
| muse-spark-1.3 (round 2 bets, call 2: a second try; I did not record why the first answer was not used) | 1,245 + 675 | $0.0185 (upper bound) |
| **Total** | | **$0.0892** |

Files: `live/live-run.json`, `live/usage.jsonl`, `live/live-run-output.txt` (copied from the terminal: the folder for
the tee did not exist yet on the run, and I did not run again to save money).

## Decisions I made (Dami can change any)

1. **Local identity = this browser** (localStorage id), not the session (see "Who the person is").
2. **Precedence reproduced > inconclusive > found > common.** An inconclusive failure whose marker also matched still
   shows the marker's lines as a note, but its one label is "inconclusive".
3. **"Reproduced" may appear without a marker.** The rule says a known failure must never be shown as present without
   the plain-code marker. I read "reproduced" as the stronger proof: the run's facts showed it, and the label links to
   that proof card. If you want "reproduced" only where a marker also matched, it is one condition in `labelFailures`.
4. **Run rules exist for three failures only** (no overall timeout, timeout, retry storm). The others can only be
   found / common: a single call-function run cannot show a race or a partial commit honestly.
5. **The "rate limit" marker is an absence check** (a network call retried with no 429 handling anywhere). It fires on
   most simple retries around a fetch. Say if it is too eager.
6. **The panel lives on the paste screen** (and under the proof card), not on the fixture or Moonwell screens, though
   their rounds count in the record.
7. **The explorer stays mounted while another screen is shown**, so its outline survives "Bet on this part" and its
   labels refresh when you come back (before, switching screens dropped the outline).
8. **Wonder does not suggest failure patterns in a new call.** It already tags parts in the X1 outline; those tags
   list kinds. On pasted code nothing is tagged; plain code's signs alone list kinds.

## What this does NOT cover / unsure

- The markers read text line by line after blanking comments and strings; they are not a parser. A marker written in
  an unusual way can be missed (then the label says "common pattern", the safe side). JS regex literals are not
  blanked; a quote inside one could confuse the blanking of that line.
- A browser id is not a login: locally, anyone who copies the id sees that record. Hosted, the invite code decides.
- The live check had one person and one function; Wonder did not propose a never-answers test this time, so "Wonder
  aims at weak spots" is shown in its prompt, not in a change of what it proposed.
- No separate adversarial review agent has looked at X3 yet.
