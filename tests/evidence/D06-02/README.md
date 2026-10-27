# D06-02: waves slider (`concurrency-sweep`, 1 to 200 callers)

Date: 2026-10-27 (WAT) · Node v25.8.1 · headless Chromium (chrome-headless-shell) · no model calls · `mida` not run.

## Where to look first

- **The measured waves, 200 callers.** Every caller runs the real `withRpcRetry` (pre-existing) with the same
  failure pattern, on one virtual clock in the sandbox:
  - first 3 calls fail, the 4th answers: calls at **0, 3,000, 6,000, 9,000 ms**, 200 each, **100%** of 800 calls
    in those 4 buckets (acceptance: at least 95%).
  - every call fails: **5 waves, at 0, 3,000, 6,000, 9,000 and 12,000 ms**, 200 each (1,000 calls); every caller
    throws at 12,000 ms. Five calls, four 3 s waits between them. So the plan's "4 spikes at 0 to 9,000" holds
    for the 3-failures pattern; with every call failing, the real function makes a 5th wave at 12,000 and only
    80% of calls land in the first four. The screen offers both patterns and defaults to the 3-failures one.
- **Real time:** 94 to 217 ms per sweep through the server (control included), well under 5 s.
- **Rules held:** the gate allows only `concurrency-sweep` on this route, 1 to 200 callers (201 → 422, recorded
  as a refusal, nothing runs); the control runs first and the run carries `controlPassed`; the chart draws only
  when `src/trust.ts` says the run may be shown as fact (otherwise the reason, no bars).
- **Caption in the DOM:** "mechanism, not an incident: every caller retries on the same fixed schedule". No
  outage, no "hangs". (The wording lint bans "fixed"; this one line carries `wording-lint: allow`, since
  "fixed" here means unchanging, not a verdict.)

## Files

| File | What it is |
|---|---|
| [`distribution.json`](distribution.json) | 12 real sweeps (1, 10, 50, 100, 150, 200 callers × both patterns): measured call times, share at 0/3,000/6,000/9,000, real ms, plus the 201 refusal |
| [`sweep-output.txt`](sweep-output.txt) | the same, one line per sweep |
| [`sweep-distribution.mjs`](sweep-distribution.mjs) | the script (POST /sweeps on a running server) |
| `waves-200-fail3-1080p.png`, `waves-200-fail3-390.png` | the screen at a 1920×1080 viewport and at 390 px |
| `waves-200-always-1080p.png`, `waves-20-always-1080p.png` | every call fails, 200 callers; then the slider moved to 20 |
| [`browser-output.txt`](browser-output.txt), [`drive.mjs`](drive.mjs) | what the browser read off the page; no horizontal scroll, no page errors |

## What changed in the code

- `runners/ts/harness.ts` `runSweep`: N callers, one virtual clock, the same failure pattern; writes
  `callTimesMs` ("t:count,…"), `waveCount`, `largestWave`, `sameScheduleCallers`, settle counts. A sweep
  Atlas stops watching (watch limit, real timer) is "can't check", never a made-up schedule.
- `runners/ts/worker.ts`, `shapes.ts` (`harnessInputFromShape`), `control.ts` `runExperiment`: a sweep goes
  through the same sandbox and control as a single call, so `/replay` works on it too.
- `src/gate.ts` `SWEEP_GATE_CONTEXT`; `server/app.ts` `POST /sweeps` (one sweep at a time per session).
- `web/screens/Scale.tsx` + `scale-model.ts`: slider, pattern picker, bar chart (250 ms buckets), a table of
  the exact moments, the caption. The page queues slider moves so only the newest runs next.
- **Found on the way (pre-existing since D19):** `src/bet-context.ts` imported `src/atlasfile.ts`, which
  imports `node:fs`, so `vite` dev rendered a blank page. The level captions moved to `src/captions.ts`
  (re-exported by atlasfile), and `tests/unit/web-imports.test.ts` fails if any module the page loads
  imports a Node built-in. `vite build` never showed it.

Tests: `tests/unit/sweep.test.ts` (sandbox + route), `tests/unit/proofcard.test.tsx` (chart and screen).
`pnpm test`: 538 passed / 16 skipped offline; 550 / 4 with the RPC loaded. `tsc`, `pnpm gate:day1`, `vite build` clean.
