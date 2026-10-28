# Bench T, "Does Atlas tell the truth?": pass rule (written before any run)

This file is a pre-registration: it fixes, before Atlas runs a single case, what is tested, what the true
facts are, and how a mismatch is named. It is committed together with the corpus (`expected.json` and
`cases/`) in one commit of its own, ahead of any result file, so the git history shows the expectations came
first and were not fitted to the results. A test in this repository (`tests/unit/bench-truth-order.test.ts`)
checks that order and refuses any later edit to these files.

Decision: D35 in the build decisions ("Does Atlas tell the truth?": about 40 functions with known behaviour,
traps included; Atlas's false-fact count, target 0, and its can't-check rate; about $0).

## What is being tested, in plain words

Atlas's any-code runner (`call-function`) calls one function of a pasted file once, inside a sandbox, on a
virtual clock (a fake clock: waits cost no real time), and reports facts about the call: how it ended, what it
returned, what it threw, how much virtual time passed and how often each stand-in (a fake function Atlas passes
in, whose answers are fixed in advance) was called. When it cannot measure honestly (the code needs the network,
files, a package, runs text as code, ends the process...) it must say "can't check" instead of reporting a fact.

This bench checks those facts against facts worked out **by hand from the code**, before any run.

## The sample

- `expected.json` lists **48 case files** (30 JavaScript/TypeScript, 18 Python) and **88 tests** (one call each):
  **70 tests** where the facts are measurable and written down, **18 tests** that are traps where the right answer
  is "can't check".
- Coverage: ordinary code (a CSV parser, a duration formatter, a query-string parser, retry with backoff,
  debounce, a token-bucket rate limiter, money in integer cents, in floats and in Python's Decimal, an LRU cache,
  dataclasses and enums), timing on the virtual clock (a 0 ms timer, polling with a deadline, event-loop order,
  a blocking `time.sleep`), never-settling and still-running calls, background work (`crypto.subtle`,
  `AbortSignal.timeout`), throws of non-Errors, huge / deep / cyclic returns, NaN, -0, BigInt, integers past 2^53,
  unicode, and traps (fetch, `node:fs`, a package import, `eval` / `new Function`, `process.exit`, an endless
  synchronous loop, a background hash racing a timer, an unhandled rejection, TypeScript syntax Node cannot strip,
  Python `urllib.request`, a caught file read, threads, `sqlite3` (a standard-library module outside Atlas's
  preload list), `numpy`, an escaping `sys.exit`).
- Two "bait" tests check over-refusal on purpose: a TypeScript file whose only mentions of fetch / require /
  import are in a comment, a string and an `import type` line, and a Python function that raises its own
  `PermissionError` without touching any file.

## Which fields are compared, and how

Only the fields written in a test's `expect` are compared. A field not written down is not compared.

| Field | Written as | Matches when |
|---|---|---|
| `outcome` | one of `returned`, `threw`, `never_settled`, `still_running_at_watch_limit` | exactly equal |
| `returnedJson` | the value | Atlas's measured text equals the canonical JSON of the value (keys sorted, JavaScript number forms: `-0` is written `0`, `1.0` is `1`) |
| `returnedType` | text, e.g. `array`, `object (Lru)` | exactly equal |
| `returnedNotJson` | `{ type, reasonMentions }` | `returnedJson` is NOT measured and `returnedType` equals `type` |
| `thrownName`, `thrownType`, `thrownMessage` | text, or `null` | text: exactly equal. `null`: the field must NOT be measured (a thrown string has no name) |
| `virtualMs` | a number, or `null` | number: exactly equal (the clock is virtual, so there is no jitter and no tolerance). `null`: must NOT be measured |
| `calls` | stand-in name -> count, or `null` | count: exactly equal. `null`: the final count must NOT be claimed |

`reasonMentions` (the words a not-JSON reason should contain) is a note, not a fact: a reason without those words
is listed for a look but does not change the classification. The reason is Atlas's explanation, not a measured
value.

## How each test is named (exactly one of these)

- **correct fact**: every compared field matches.
- **FALSE FACT**: any compared field was measured with a different value, or a field that must not be measured
  was measured (for example a settle time on a call that never settled). This is the result the bench exists to
  catch. Target: **0**.
- **correct can't-check**: the test is a trap and Atlas measured nothing about how the call ended (a whole-run
  "can't check", or every outcome field not measured with a reason).
- **wrong can't-check (over-refusal)**: the facts were measurable, but Atlas did not measure the outcome, or did
  not measure one or more of the compared fields. Safe, but unhelpful; reported with the field and Atlas's reason.
- **missed can't-check**: the test is a trap, but Atlas reported how the call ended (it should have refused).
- **control failed** (not one of the five): Atlas's known-case control did not pass before that run, so none of
  its verdicts count. Any control failure makes the whole bench run invalid; it is reported, not scored.

When a test has several field problems, FALSE FACT outranks over-refusal.

## When a FALSE FACT appears

1. The expectations are **never edited**. Not `expected.json`, not a case file.
2. Work out who is wrong: the hand-written expectation or Atlas. The proof is a separate check outside Atlas (for
   example plain Node or Python running the same function), recorded with its command and output.
3. Write it up in a findings file next to the result (`results/<date>-findings.md`): the test, what was expected,
   what Atlas measured, what the outside check showed, and the verdict ("expectation error" or "Atlas finding").
4. The raw counts in the result file stay as measured. A findings file may add a second line, "after expectation
   errors are set aside", but never replaces the raw line.
5. An Atlas finding is reported to Dami. Runner code is not changed in the batch that found it.
6. A corrected expectation, if ever needed, goes in a NEW dated file (`AMENDMENT-YYYY-MM-DD.md` plus a new
   expectations file), committed before the run that uses it. The original stays as it is.

## How results are reported

- One result file per run: `results/<date>.json` (every test: expected, measured, not-measured reasons, the field
  checks, the classification, the control run it relied on) and `results/<date>.md` (the table).
- The header always states: the sample size (88 tests in 48 files, 70 fact tests and 18 traps), the executor
  (local: Node `--permission` for JS/TS, macOS `sandbox-exec` for Python; Modal only when `ATLAS_EXECUTOR=modal`),
  the Node and Python versions, the date, the git commit, and the SHA-256 of `expected.json`.
- Counts per classification, split by language. The false-fact count is stated first.
- **Sample size always stated; no general claims.** The result is "on these 88 hand-picked tests, run on <date> on
  <executor>, Atlas reported N false facts", never "Atlas never lies" or "Atlas is X% accurate".

## What this bench does not show

- It is a small, hand-picked sample. The corpus was written by someone who had read Atlas's runner design notes
  (E1, E2), so many traps are ones the design already names. It shows the documented contract holds on these
  cases; it does not show there is no other way to make Atlas report a false fact.
- It is not a security audit of the sandbox.
- Every test runs once. Code with real randomness is not in the corpus.
