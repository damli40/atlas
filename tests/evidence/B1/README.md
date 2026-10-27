# B1: two benchmarks (D35), "Does Atlas tell the truth?" and "Do models know what code does?"

Date: 2026-10-27/28 (WAT) · no model call ($0) · Node 25.8.1, CPython 3.14.7, macOS (Darwin 25), local executor only.

## Where to look first

- **Bench T result: 0 false facts on 88 tests.** Atlas's any-code runner was given 88 calls (48 small files: 30
  JavaScript/TypeScript, 18 Python) whose facts were worked out by hand and committed before the run. It measured
  all 70 measurable ones exactly as written (outcome, returned JSON, thrown name/type/message, virtual time, stand-in
  counts) and said "can't check" on all 18 traps. Table: `bench/truth/results/2026-10-28.md`. This is 88 hand-picked
  tests on one machine; it is not a claim that Atlas never reports a false fact.
- **Bench M is built, not run.** 30 new functions x 3 tests = 90 prompts. The dry run (no model call) estimates
  **$4.04** for Muse Spark + Muse Spark Open (high case $7.64) and **$7.34** with Muse Wonder too (high case
  $13.91). The live run needs `--live` and is Dami's to start.
- **A finding for E3 (not fixed here):** the product's model-bet check (`server/meta/schemas.ts` `betAnswerSchema`,
  used by `validateBetOnlyOutput`) has no `json` answer kind. Every model bet on `returnedJson` (the question pasted
  rounds ask) is refused as "does not match the schema". So, today, no model can bet on what pasted code returns
  through the server. Bench M uses its own check (`bench/models/validate.ts`) that adds the `json` kind with the same
  limits a person's json bet has. Test: `bench-models.test.ts` "FINDING for E3".
- **A second gap for E3:** main has no bet-context builder for pasted rounds, and the server's "what the person sees"
  prompt ends with the Moonwell sentence "Give your best estimate in USD". Bench M's builder (`bench/models/bet-context.ts`)
  keeps the server's prompt frame and swaps only that sentence for a unit-free one.

## The commits, in order (the order is the point)

| Commit | What |
|---|---|
| `2eba993` | `.gitignore` allows `bench/`; `tsconfig` type-checks it, except the case files |
| `cbbe579` | **Bench T pre-registration, alone:** `PASS-RULE.md`, `expected.json` (88 hand-written expectations), 48 case files |
| `2cae832` | Bench T runner, classifier, order test, corpus and classifier tests |
| `a71da34` | `--render` (rewrites a result's table from its JSON; no run) |
| `c65715f` | **Bench T result** (run at `2cae832`, clean tree) |
| `df7f2df` | **Bench M pre-registration, alone:** `PASS-RULE.md`, `corpus.json` (30 x 3), 30 case files, `bet-context.ts` |
| `c335524` | Bench M runner (`--dry-run`, gated `--live`), answer check with the json kind, tests with a fake model |
| `d1a8c9f` | **Bench M dry run** (prompt hashes + estimate) |

`tests/unit/bench-order.test.ts` reads the git history and checks, for each bench: (a) the registering commit holds the
pass rule and corpus and nothing else; (b) exactly one commit ever touches them; (c) that commit is a strict ancestor
of every commit adding a result; (d) every result file names the registered corpus by SHA-256.
**Probes** (in a throwaway clone, not committed): editing one expected `virtualMs` after the result fails (b) ("changed
after they were first committed (e20adec, cbbe579)"); a result file committed on a branch from before the rule and
merged fails (c) and (d).
**Merging:** do not squash this branch. One squashed commit would hold the rule and the results together and fail (c).

## Bench T: what was run and what it found

```
npx tsx bench/truth/run.ts        # 66 s, sequential, tsRunner().run (the control runs before every test)
```

| Classification | All | JS/TS | Python |
|---|---|---|---|
| correct fact | 70 | 44 | 26 |
| **FALSE FACT** | **0** | 0 | 0 |
| correct can't-check | 18 | 12 | 6 |
| wrong can't-check (over-refusal) | 0 | 0 | 0 |
| missed can't-check | 0 | 0 | 0 |

Every test's control passed. 0 notes (every not-JSON reason contained the expected words). 0 local paths had to be
removed from the result file.

What the 70 facts cover, with the ones most people would get wrong:
- `setTimeout(fn, 0)` costs **1 ms** of virtual time (Node turns a delay below 1 into 1): measured 1.
- `Math.round(1.005 * 100) / 100` is **1**; `0.1 + 0.2` is 0.30000000000000004: measured.
- A debounced call that fires 200 ms after the function returned is still counted (calls after settle).
- Retry with backoff, a token bucket on `Date.now()`, polling to a deadline, `Promise.all` vs `allSettled` with a
  failing stand-in, event-loop order (sync, microtasks, then the timer): all exact.
- Non-Error throws (a string, a plain object, `null`): thrown type measured, name and message correctly NOT measured.
- NaN, BigInt, a 3,891-character list, 150-deep nesting, a cycle, a class instance, a Python tuple, Decimal, a
  dataclass, an integer past 2^53: all "not JSON" with the right type; `-0` is written `0`, as JSON writes it.
- `AbortSignal.timeout(100)` beats work that answers at 500 ms: `TimeoutError` at 100 ms with Node's own message.
- Python: `KeyError`'s message is `'PENDING'` with quotes; a `TimeoutError` is not a `ConnectionError`; banker's
  rounding (2.665 -> 2.66); `time.time()` is 1767225600 at Atlas's epoch; `ß`.upper() is `SS`.
- Over-refusal bait: a TypeScript file that mentions fetch/require/import only in a comment, a string and an
  `import type` line ran normally; Python code raising its own `PermissionError` was measured as `threw`, and
  `SystemExit` caught by the code was measured as `returned "exit 2"`.

The 18 traps and Atlas's reasons (all whole-run or outcome not measured): an endless synchronous loop (Atlas's 10 s
real-time limit), a hash racing a 10 ms timer, fetch (twice, once caught), `node:fs` import, a lodash import, `eval`,
`new Function`, `process.exit`, a TypeScript enum and a parameter property (Node's own "not supported in strip-only
mode"), an unhandled rejection, an escaping `sys.exit`, `urllib.request` and `sqlite3` (standard-library modules
outside the preload list), a caught `open('/etc/hosts')`, threads, `numpy`.

No FALSE FACT appeared, so there was nothing to investigate and no findings file. The expectations were never edited.

## Bench M: what was built

- `bench/models/PASS-RULE.md`: models (muse-spark-1.3, meta-models/muse-spark-open-1026, optional muse-wonder-1.0),
  settings (Atlas's client unchanged: temperature 0.2, reasoning_effort low, max_tokens 16000 with one retry at
  32000, JSON response format), one answer per model per test, one repair try, sealing before the run, scoring
  (matched / didn't match / declined / invalid / not checkable), reporting (per model per question type: n and both
  match rates side by side, decline rate, cost; split by language), an $8 hard stop, no general accuracy claims.
- Prompt freeze: the live run rebuilds every prompt and stops before any call if one differs from the committed dry
  run's SHA-256 (shared text like the system preamble could change on main).
- `npx tsx bench/models/run.ts --dry-run` wrote `bench/models/dry-run/2026-10-28.json`: 90 prompts, 309 questions,
  2,271 to 4,147 characters each (mean 2,938), and the estimate below. One full sample prompt is in the file.

| Estimate (no call made) | Calls | Central | High |
|---|---|---|---|
| muse-spark-1.3 (price not published; Wonder's used: an upper bound) | 99 | $3.30 | $6.27 |
| meta-models/muse-spark-open-1026 (Baseten's published price) | 99 | $0.74 | $1.37 |
| muse-wonder-1.0 (optional) | 99 | $3.30 | $6.27 |
| **Spark + Spark Open** | | **$4.04** | $7.64 |
| **with Wonder** | | **$7.34** | $13.91 |

Assumptions (in `run.ts`, checked against the live usage log later): prompt tokens = characters / 3.5; 1,500
completion tokens per call central, 3,000 high (earlier live bet-only calls here cost $0.0225 to $0.042 each at
Spark's assumed price, D02-06 and D02-02b); 10% extra calls for repair tries.

**What this decides:** Spark + Spark Open fits the $3-6 target. Adding Wonder on all 90 tests probably does not, and in
the high case the $8 cap would stop the run partway (the result is then marked partial). Options for Dami: run
without Wonder; run Wonder on a subset (needs an amendment file before the run); or raise the cap by amendment.

## Commands and counts

```
pnpm vitest run tests/unit/bench-corpus.test.ts tests/unit/bench-order.test.ts tests/unit/bench-classify.test.ts tests/unit/bench-models.test.ts --reporter=verbose
npx vitest run --maxWorkers=4   # the full suite
npx tsc -p .
```

| | After B1 |
|---|---|
| Test files | 91 (4 new: bench-corpus 181 tests, bench-order 9, bench-classify 12, bench-models 11) |
| Tests | 1,272 passed, 19 skipped, twice in a row (`full-suite.txt`) |
| Type check | 0 errors (`tsc-output.txt`) |
| no-local-paths | passes (in the suite) |

The first full run, with the default worker count while the machine's load average was about 40 (other sessions),
had 2 tests time out at vitest's 5 s limit in files B1 does not touch (`day-gate.test.ts`, `review-day6-b1.test.ts`).
With `--maxWorkers=4` both runs were clean. I did not change any timeout.

## What this does NOT cover

- Bench T ran on the local executor only. Modal (`ATLAS_EXECUTOR=modal`) is wired to look for batch E4's executor
  and refuses to run when it is missing; it was not run.
- Bench T's corpus was written by me after reading the E1/E2 design notes, so many traps are ones the design names.
  It shows the documented contract held on these 88 cases, not that no other false fact exists. I also did not run
  the fact cases in plain Node/Python outside Atlas as an independent cross-check: with 0 disagreements there was
  nothing to adjudicate, but an expectation and Atlas could in principle share the same mistake.
- Each bench T test ran once. Code with randomness is not in the corpus.
- Bench M was not run against any model. Its live path is tested only with a fake model and a fake run.
- `pitch/VIDEO-INDEX.md` is not in this worktree and was not updated; the main session should add the bench T line.
- No adversarial review agent has looked at B1 yet.
