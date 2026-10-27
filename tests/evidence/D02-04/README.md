# D02-04 · Human bets UI + sealed hash before the run

Date: 2026-10-27 (WAT build day 2 work). Branch `d02-betsui`.

## What changed, in plain words

Before: the browser sealed its own bets and wrote its own time on them. A seal proved a bet was not
edited, but not that it was placed before the run.

Now: the **server** seals every bet when it arrives, with its own clock and a 16-byte nonce it keeps
to itself. The hash goes back to the page and is shown at once; the nonce stays on the server, so
nobody can test guesses against the hash. `POST /runs` freezes the bets first (any later bet gets 409),
checks every `sealedAt` is earlier than the run's start, runs, judges, and then reveals each bet in
full. The page recomputes `sha256(canonicalJson(bet))` itself with `src/seal.ts` and compares it with
the hash it showed before the run.

Routes (server/app.ts, store in server/bets.ts): `POST /experiments {target, params, id?}` →
gate decision + plain-code questions; `POST /bets {experimentId, measures, answer, who:"human"}` →
sealed bet without nonce; `POST /runs {experimentId}` → `{run, verdicts, bets (revealed), betsFrozenAt}`.
The old `POST /runs {experiment, bets}` (client-sealed) is gone (400). The day-1 gate script now uses
the new flow and also re-checks every revealed seal and `sealedAt < run.startedAt`.

## Commands and results

- `seal-proof.txt`: verbose run of `tests/unit/bets-ui.test.tsx` (React screens + real server in one
  process, jsdom page) and `tests/unit/bets-server.test.ts`, plus `pnpm test`, `tsc`, `pnpm gate:day1`,
  `vite build`. All green; gate still prints `verdicts: 18 matched, 1 didn't match, 1 can't check`.
- `browser-run.txt` + `s3-round-1-sealed.png` (after sealing, before Break it) + `s3-round.png` (after
  the run): real headless Chromium against `pnpm dev:all`, one S3 round, driven by `drive.mjs`.

## What the checks prove

- Hash is in the DOM before the "Break it" click, and no `/runs` request has been made yet.
- Bet inputs are disabled after sealing.
- After the run, `sha256(canonicalJson(revealed)) === displayed hash` for every bet (test + browser).
- A bet posted after the run started gets 409, including one posted while the sandbox is still running.
- `sealedAt < run.startedAt` is asserted by the server; a stored bet sealed in the future stops the
  run with 409 and nothing runs.
- The browser's seal check can fail: an edited revealed bet shows "✗ mismatch".

## What it does not prove

- The server's clock is trusted. A person who controls the server could still lie; this closes the
  browser-time gap, not a hostile-server one.
- Bets live in memory per session; a server restart loses them. Model bets are not wired into this
  flow yet (D02-06).
- Only the S3 round was driven in a real browser; other scenarios are covered by the day-1 gate over HTTP.
