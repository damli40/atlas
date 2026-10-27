# D02-01: the experiment gate

Date: 2026-10-27 (WAT) · Node v25.8.1

## What was built

`src/gate.ts` is the allow-list of experiments Atlas will run. It is plain code with no I/O.
A model or a person proposes an experiment; the gate either allows it or refuses it with a
plain reason. A refused experiment is kept and returned, and never run.

- **One table, two uses.** `SHAPES` and `BOUNDS` hold every shape from `src/types.ts` with its
  fields and limits. The same table drives the check (`gate()`) and the text shown to the
  Claimant (`renderAllowList()`), so the model is never told a limit the gate does not enforce.
- **Bounds.** retry-scenario: failTimes 0..10 or "always", attempts 1..10, delayMs 0..60000,
  resolveAfterMs 0..60000, failure "error" | "never_settles", errorKind "seeded" | "429",
  resolvesWith any JSON up to 1,000 characters. concurrency-sweep: callers 1..200, failure "error".
  price-read and apply-proposal-then-read: markets must be in the target's touched-markets list
  (no duplicates; "touched" allowed only for apply-proposal-then-read). liquidatable-at-price:
  one touched market, price a whole-number USD 1e18 string above 0 and at most $1,000,000.
- **Refused:** not an object, unknown shape, a shape the target's runner cannot run, any extra
  or misspelt field, a missing required field, a value outside its range, a fraction or text
  where a whole number belongs. The gate never throws.
- **Questions live in one place.** `QUESTION_TEXT` and `questionsFor()` moved here. The day-1
  gate script (`tests/gate/six-cases.ts`) now imports the same object instead of its own copy
  (a test checks it is the same object, not equal text). Each question carries the answer kind
  a bet must use, the field's unit from `src/units.ts`, enum options, and for prices a fixed 10%
  tolerance. Shapes that no runner measures yet (concurrency-sweep, liquidatable-at-price) get
  no questions: nothing is asked that nothing measures.
- **Server wired.** `POST /runs` now sends every experiment's params through `gate()` instead of
  marking everything allowed. On a TS fixture only `retry-scenario` is allowed (there is no
  concurrency-sweep runner yet). A refusal answers **422** with
  `{ error: "gate: rejected (<reason>); nothing ran", experiment: {..., gate: {allowed: false, reason}} }`.
  The old zod bounds in `server/app.ts` were removed so there is one set of limits.

## Changed on purpose

- Misspelt or out-of-bounds params on `POST /runs` were **400** before; they are now **422** from
  the gate, with the refused experiment in the body. The day-gate test was split accordingly
  (unknown target or wrong runner stay 400) and now also checks that nothing reached the executor.
- Tighter limits than the day-1 stand-in: failTimes and attempts were capped at 20, now 10;
  resolveAfterMs was capped at 120000, now 60000.

## Commands and output

| Command | File | Result |
|---|---|---|
| `pnpm exec vitest run tests/unit/gate.test.ts tests/unit/day-gate.test.ts --reporter=verbose` | `test-output.txt` | 61 passed |
| `pnpm exec tsc --noEmit` | `tsc-output.txt` | no errors |
| `pnpm gate:day1` | `gate-day1.txt` | 18 matched, 1 didn't match, 1 can't check (same as day 1) |

The plan's acceptance cases are the "refusals carry plain reasons" block: `callers: 201`,
unknown shape, `attempts: 1000`, markets not in the touched list. Every shape inside its bounds
is allowed, and a test checks the inside list covers all five shapes.

## What it proves

- Every shape in `src/types.ts` is allowed inside its bounds and refused outside them, with a reason a person can read.
- The server never runs a refused experiment (a counting executor stays at 0 calls).
- The day-1 gate gives the same verdicts with the gate in place.

## What it does not prove

- The bounds are judgement calls, not measured limits. A retry-scenario inside them can still
  outlast Atlas's 30,000 ms watch limit (for example attempts 10 with delayMs 60000), and that
  run is "can't check". The gate does not try to predict it, because the code's own defaults are
  what is being tested and the gate must not assume them.
- The EVM shapes are checked by the gate but no EVM runner exists yet; their questions are untested against real runs.
