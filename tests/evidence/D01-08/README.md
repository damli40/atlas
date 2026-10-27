# D01-08: day gate, the six known cases end to end over HTTP

Date: 2026-10-27 (WAT) · Node v25.8.1

**In plain words:** a script sends six test setups for `withRpcRetry` (oracle rows S1–S6) to
the Atlas server over real HTTP. Each setup goes with human bets on what will happen. Each
bet is sealed first: it gets a hash that changes if any part of the bet changes. The server checks
every seal, runs the control once (rows S1 and S3, whose answers are known), runs the real
function in the sandbox, and lets `src/judge.ts` compare each bet to what the run measured.

## Commands and output

| Command | Output | Result |
|---|---|---|
| `pnpm gate:day1` | [`six-cases.txt`](six-cases.txt) | 18 oracle bets matched; the deliberate S3 `calls = 4` bet didn't match (the run made 5 calls); the S6 settle-time bet can't be checked ("the function never settled…"); **690 ms** total real time |
| `ATLAS_URL=http://localhost:8799 pnpm gate:day1` against a server started with `pnpm server` | (not saved; same table) | same verdicts, 694 ms |
| `pnpm test` | 11 files, 106 tests passed | includes `tests/unit/day-gate.test.ts` (5 tests) |
| `pnpm exec tsc --noEmit` | no output | clean |

By default the script starts the server on a free port on 127.0.0.1 and talks to it with
`fetch`, so the requests go over real HTTP. The vitest test runs the same flow through
`app.request` (no port), so CI keeps it.

## Routes added (server/app.ts)

- `POST /targets {kind: "ts-fixture", ref}` returns the Target: the path, the SHA-256 of the
  file's exact bytes, and the label "Pre-existing: written before the hackathon". The label is
  added only when `PRE-EXISTING.md` names that path, and today that is only the withRpcRetry fixture.
- `POST /runs {experiment, bets?}` returns `{run, verdicts}`.
  - It runs the control once per code SHA-256 and reuses it. A control that did not pass is
    not reused, so the next request tries again.
  - Bodies are checked with zod. Bad input gets a 400 with a plain reason, for example a
    misspelt params field, an out-of-range number, `runner: "evm"`, or a target that wasn't
    registered with POST /targets.
  - If any bet's seal does not verify, the server answers 409 before anything runs, and no bet is judged.
- Runs are kept in memory only. Nothing is written to `proofs/`.

## Interface change: `retry-scenario` gained two optional fields (src/types.ts)

| Field | Values | Why |
|---|---|---|
| `errorKind?` | `"seeded"` (default) or `"429"` | Oracle row S4, "rejects with a 429 error", had no way to ask for a 429 error. |
| `resolvesWith?` | any JSON value (new `JsonValue` type) | Oracle row S5, "resolves with `{status: 429}`", had no way to set what a successful call returns. |

The existing fields are unchanged, and leaving the new ones out gives the same behaviour as
before. The harness already supported both, through `RetryScenario` in `runners/ts/shapes.ts`.
The only thing missing was a way to send them over HTTP. `scenarioFromShape` now passes them
through. The table's last two lines show they reach the sandbox: S4's first call rejects with
"Status: 429 Too Many Requests", and S5 returns `{"status":429}`. Calls, wait and outcome alone
could not show this, because S4 and S5 give the same counts with or without the new fields.

## Other code changes, and why

- `runners/ts/control.ts`: added `runExperiment(exp, controlRun, opts)`. Before this,
  `tsRunner().run()` ran the control again on every run. That made a per-code cache
  impossible without a second control. `tsRunner().run()` now calls `runExperiment`, and its
  behaviour is the same with one stricter rule. The code is read twice, once for the control
  and once for the run. If the bytes differ between the two reads, or differ from the target's
  SHA-256, the run's `controlPassed` is false and every verdict is "can't check".
- No `--experimental-permission` anywhere: the sandbox command is still `--permission`.

## What it proves

- The real withRpcRetry runs in the sandbox behind an HTTP route. All 18 bets equal to the
  oracle's calls, total wait and outcome for S1–S6 come back **matched**.
- The judge can return the other two verdicts on real runs, not only in unit tests: a bet
  that's off by one gets **didn't match**, and a bet on a field the run cannot measure gets
  **can't check**, with the runner's reason.
- One control run served all six experiments: they all share the same `controlRunId`.
- A tampered bet (answer changed after sealing) gets 409, and the sandbox is never called (test).

## What it does not prove

- **The questions are not the plan's templates word for word.** The plan's calls question
  begins "Every call fails with an error", which is untrue for S1, S2, S4, S5 and S6. The
  script uses "How many times will the function call the RPC?" Question generation from the
  shape belongs to D02.
- **No real gate yet.** The zod bounds stand in for `src/gate.ts`, and the server sets
  `gate: {allowed: true}` itself. A gate value sent by the client is dropped.
- **`sealedAt` is not checked against the run start.** The client writes that time, so the seal
  shows the bet was not changed. It does not show the bet was placed before the run. That
  ordering needs the server to seal or timestamp bets itself (POST /bets, D02).
- **Memory only.** If the server restarts, its targets, controls and runs are lost.
- **The pre-existing label checks only whether the path is named in PRE-EXISTING.md.** A new
  fixture that isn't listed gets no label. There is only one fixture today, so the "no
  label" case isn't exercised by a test.
- The 5-second limit was measured on this machine (about 0.7 s). A cold machine or the modal
  executor will be slower.
