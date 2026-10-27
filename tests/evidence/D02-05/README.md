# D02-05: agent event stream (data only, no log strip yet)

Date: 2026-10-27 (WAT) · Node v25.8.1

**In plain words:** every step of a round now writes one short line to an in-memory log, kept
per session (a session is one browser tab's round, named by the `x-atlas-session` header; the
server makes one up and returns it if the client sends none). `GET /events/<session>` streams
those lines as SSE (one long HTTP response the server keeps writing to): first everything kept so
far, then each new line as it happens. The bus refuses any line from a Meta model role
(investigator, claimant, adversary, fixer) that lacks the model's name or its token usage and cost,
so a model line can never reach the screen without them (D10).

## Commands and output

| Command | Output | Result |
|---|---|---|
| `pnpm exec tsx tests/tools/agentlog-round.ts > tests/evidence/D02-05/events.jsonl` | [`events.jsonl`](events.jsonl) | one real S3 round (5 failures in a row) through `/targets` and `/runs`: 8 events, human ×3 → investigator stand-in (role human) → gate → seal → runner → judge "judges 3 bets: 2 matched, 1 didn't match" |
| `pnpm exec vitest run tests/unit/agentlog.test.ts --reporter=verbose` | [`agentlog-tests.txt`](agentlog-tests.txt) | 8 tests passed |
| `pnpm test` | 14 files, 148 passed, 3 skipped | the skips are the existing ones |
| `pnpm exec tsc --noEmit` | no output | clean |
| `pnpm gate:day1` | 18 matched, 1 didn't match, 1 can't check, 720 ms | day-1 gate unchanged |

A one-off check over real HTTP (node server on 127.0.0.1, `fetch`, then abort) received the
replayed event and saw the subscriber count go 1 → 0 after the client disconnected. Not saved as a file.

## What this proves

- One full round over `app.request` emits, in this order: human (one line per sealed human bet) →
  "uses a fixture finding, written by hand (Investigator arrives Oct 30)" (role human) → gate →
  seal → runner → judge. Each event passes the zod check; none carries a model, because no model acted.
- A claimant or investigator event without `model`, or without `usage`, is refused. A plain-code
  role (gate, seal, runner, judge) or the human naming a model is refused too. So are empty,
  multi-line or over-160-character actions, unknown roles and extra fields.
- A tampered seal is logged ("refuses bet …") and nothing runs (409, no runner or judge line).
- SSE replays the kept history in order with ids 1, 2, 3 …, then delivers a live event, and drops
  the subscription when the client disconnects. `Last-Event-ID` resumes after that id.
- History is capped (500 per session by default); idle sessions beyond 200 are dropped, oldest first.

## What this does not prove

- No Meta model emitted anything yet. The Claimant will call `sessionEmitter(log, sessionId).model({...})`
  (server/log/agentlog.ts); that wiring is not done here.
- The gate line is a stub ("allowed (stub: request bounds only, until src/gate.ts)"). It says
  allowed for every experiment that passed the request schema; src/gate.ts replaces it.
- The Investigator is skipped: its line is a hand-written stand-in with role human.
- "Present tense" for actions is a writing rule, not checked by code (only length and one line are).
- The log is in memory only: a server restart loses it, and it is not written to an `.atlas.json`.
- No log strip UI (D05-04).
