# E1: any-code contract and the JavaScript/TypeScript "call-function" runner

Date: 2026-10-27 (WAT) · no model call ($0) · Node 25.8.1, local executor only.

## Where to look first

- **What now works:** a person pastes one JavaScript or TypeScript file. Atlas calls one exported function once, with
  plain JSON arguments and "stand-ins" (fake functions whose answer on each call was fixed before the run), in the
  sandbox, on a virtual clock. It reports how the call ended (`returned`, `threw`, `never_settled`,
  `still_running_at_watch_limit`), the returned value as JSON, the thrown error's name and message, the virtual time
  it took, and how many times each stand-in was called. Anything Atlas could not measure honestly is "can't check"
  with the reason.
- **The rule this batch is built around:** when the code does something Atlas will not allow (loads a package,
  touches the network or files, runs text as code, ends the process), the WHOLE run is "can't check" with a plain
  reason. It is never recorded as `outcome: threw`, because that would turn a sandbox rule into a fake fact about
  the code. 26 sandbox tests check this, each one also judging three bets and finding all three "can't check"
  with the reason; 4 more check it inside the sandbox with the source scan skipped.
- **The control:** before any verdict counts, Atlas runs 9 known cases on a hand-written reference file
  (`runners/ts/call-reference.ts`) through the same sandbox. Two tests break one line of the harness on purpose
  (the clock off by 1 ms; the stand-in count lost). The control then fails and names the case and field, and every
  verdict on a run measured by the broken harness is "can't check".
- **A bug I found in my own first version:** a call waiting on `crypto.subtle.digest` was reported as
  `never_settled`. That was false: the hash finishes and wakes it. Node's list of live resources does not show such
  background jobs. Atlas now tracks them (Node's `async_hooks`), waits for them for real when nothing else is
  pending, and says "can't check" when one races a timer. See "Unsafe things noticed" for what this means for the
  older retry harness.

## The command and the counts

```
pnpm vitest run tests/unit/call-contract.test.ts tests/unit/call-function.test.ts --reporter=verbose
pnpm test          # the full suite
npx tsc -p .       # the type check
```

| | Before E1 (commit 7207fde) | After E1 |
|---|---|---|
| Test files | 78 | 80 |
| Tests passed | 766 | 871 (+105: 39 contract, 64 sandbox, 2 more gate cases) |
| Skipped | 19 | 19 (unchanged: RPC and private-file checks) |
| Type check | 0 errors | 0 errors |

The full suite ran clean 5 times in a row after the last fix, then 3 more times for `full-suite.txt`.
`no-local-paths.test.ts` passes.

Files: `test-output.txt` (every E1 test by name), `full-suite.txt` (3 full runs), `tsc-output.txt`.

## What was tested

**Contract (pure plain code, `tests/unit/call-contract.test.ts`, 39 tests)**
- Pasted target: ref is `pasted:<first 12 hex of SHA-256>`; empty code, an unknown language and more than 64 KB
  (counted in bytes) are refused; a changed source no longer matches its fingerprint.
- Source scan: exports with line numbers (`function`, `async function`, `const`/`let` lists with TypeScript types,
  `class`, `export { a as b }`, `export default`); every way of loading code is named (`import`, `import()`,
  `require()`, `export ... from`, `import { type A, b }`); words inside comments, strings, regexes and template
  text are ignored; a type-only import is allowed; CommonJS exports are refused; text the scanner cannot read is
  refused, not guessed.
- Gate: one allowed experiment, 18 refusals each with its reason (unknown export, 9 args, non-JSON value, afterMs or
  never_settle on a plain stand-in, 0 or 51 steps, duplicate stand-in names, bad error name, 501-character message,
  watch limit 0 or 600 001, JSON over 4 KB, ...), the 4 KB edge exactly.
- Questions: the call description matches the spec's example; outcome / returnedJson / virtualMs / calls:<name>
  with the right answer kinds and units; the same params always give the same text.
- Judge: json bets match by canonical JSON (key order ignored, the text "1" is not the number 1); a json bet on a
  count field, or a number bet on returnedJson, is "can't check"; outcome bets must take all options from one list
  (call words or retry words); a whole-run reason makes every bet "can't check" with that reason.
- Seal: a json bet seals and verifies; a value that is not plain JSON cannot be sealed.

**Sandbox (`tests/unit/call-function.test.ts`, 64 tests, the real local executor)**
- End to end: JavaScript with a retrying stand-in (returned at 1,200 virtual ms, 2 calls, JSON matched by a sealed
  bet); TypeScript with type annotations runs; a TypeScript enum is "can't check" in Node's own words
  ("TypeScript enum is not supported in strip-only mode"), with the sandbox path removed; a `.atlas.json` of a
  pasted round verifies, and fails when the source or a measured value is edited; the TS runner sends pasted
  targets down this path.
- Returned values that are not JSON (undefined, NaN, a BigInt, a function, a cycle, a 10 KB string, a Map, a getter
  that throws, a list with holes): `returned`, `returnedType` measured, `returnedJson` not measured with why.
- Thrown values that are not Errors (a string, null, an object whose `name` getter throws): `threw`, and only what
  could be read is measured. A stand-in's TypeError is a real TypeError.
- Stand-ins: `throw_exhausted` throws AtlasStandInExhausted into the code; calls made after the call settled are
  counted (the code went quiet later); a stand-in still being called by an interval at the watch limit has no
  claimed final count; a stand-in that never answers gives `never_settled`.
- Time: an empty promise never settles; a 10-minute setTimeout with a 30 s watch limit gives
  `still_running_at_watch_limit` and nothing else; a delay past 2^31-1 ms fires after 1 ms (as in Node);
  `Date.now()` follows the virtual clock (a 5 s deadline loop ends at exactly 5,000 virtual ms); a timer started
  while the file loads is "can't check"; an infinite synchronous loop hits a 1.5 s real-time limit and is "can't
  check" (the test does not hang); a zero-delay timer loop hits the step limit and the outcome is not claimed;
  background hashing is waited for; hashing raced against a timer is "can't check", the same way every time;
  hashing then a timer, in sequence, is measured; `Atomics.waitAsync` and `WebAssembly.compile` are "can't check".
- Reaching outside (all whole-run "can't check", most while the code tries to catch the error): fetch,
  `process.getBuiltinModule("fs")`, `process.loadEnvFile("/etc/hosts")` (a real ERR_ACCESS_DENIED from the
  sandbox, caught by the code), `process.report.writeReport`, `process.exit`, `process.binding`, `eval`,
  `new Function`, the async function constructor, `Atomics.wait`, `require`, an uncaught rejection, a timer
  callback that throws.
- Imports refused twice: by the scan before any sandbox starts, and by the module hook inside the sandbox when the
  scan is skipped (a static import, a caught dynamic `import("node:fs")`, `require` at run time, importing Atlas's
  own harness file from the sandbox folder).
- Built-ins changed by the code (Promise, JSON, a setter on Object.prototype, globalThis.setTimeout): whole run
  "can't check" with the existing BUILTINS_CHANGED_REASON.
- The export: missing, not a function, CommonJS, or the file throws while loading: whole run "can't check".
- The control fails loudly with a broken clock or lost counts, and with a sandbox that gives no result.

## Spec deviations (the conservative choice each time)

1. **`outcome` is shared by two shapes.** The spec gives call-function its own outcome words under the field name
   `outcome`, which retry-scenario already uses with `returns / throws / pending`. The judge now accepts an outcome
   bet only when ALL its options come from ONE of the two lists (`ENUM_FIELD_OPTION_SETS`, `src/units.ts`).
2. **Whole-run reasons live in `notMeasured.wholeRun`**, a new key, not in `control` (that would say "the known-case
   check did not match", which is untrue) or `run` (older files use it; changing its meaning could change the
   verdicts of stored proof files). The judge and `src/trust.ts` read it first.
3. **More whole-run reasons than the spec lists:** code from text (eval / new Function), ending or signalling the
   process, `process.binding`, Atomics.wait / waitAsync, WebAssembly background compile, a failure nobody caught, a
   timer callback that throws, a timer started while the file loads, CommonJS exports, Atlas's real-time limit, and
   no result from the sandbox.
4. **The virtual clock covers more than timers:** setTimeout, setInterval, setImmediate, Date, performance.now,
   process.hrtime and process.uptime all read it. It starts at 2026-01-01T00:00:00Z. Otherwise a "wait until 5 s
   have passed" loop would run forever on virtual time and be reported as still running, a false fact. Delays
   follow Node's rule (outside 1..2^31-1 ms becomes 1 ms; fractions are cut).
5. **Background work** (a hash, a compression step) takes real time but no virtual time. Atlas waits for it for
   real only when nothing else is pending; when it overlaps a timer, how the call ends is "can't check".
6. **`calls:<name>` after the call settles:** Atlas keeps running leftover timers (up to the watch limit) so a
   stand-in called later is counted. If timers are still left at the limit, the final count is not claimed. In a
   still-running run the counts so far are not claimed either (they are in the reason text).
7. **Extra measured field `thrownType`** ("Error", "string", "null", "object"). `thrownName`, `thrownMessage`,
   `returnedType` and `thrownType` have no unit, so a bet on them is "can't check" until a later batch defines how
   to compare them. A thrown non-Error has no measured name or message.
8. **The control runs in its own sandbox run**, before the target, on the reference file through identical files.
   It checks the harness, not the pasted code, so its Run names the reference file's SHA-256. The TS runner runs
   it before every pasted run.
9. **Proof files:** a pasted round must carry one new caption,
   "pasted code, run once in Atlas's sandbox on a virtual clock that starts at 2026-01-01T00:00:00Z" (the file schema
   needs at least one caption, and a replayer should say the clock is virtual). Call-function runs carry the seed
   `"none"` (nothing is random on Atlas's side), so the existing seed checks still apply.
10. **Bounds the spec did not set:** a stand-in step's `afterMs` 0..600 000; stand-in names 40 characters, error
    names 60, messages 500, export names 100. The 4 KB limit counts the JSON values only (json args and stand-in
    return values).
11. **Question text** cuts any JSON value or message longer than 60 characters with "…". E3 owns the final wording.
12. **Not built here:** replaying a change on pasted code (the runner refuses), Python (accepted as a language by
    the target, refused by this runner), the server endpoint and the paste screen.

## What this does NOT cover

- Randomness is real: `Math.random()` and `crypto.randomUUID()` differ between runs, so a replay of such code may
  differ. Nothing marks such a run.
- Some clocks stay real: `Intl.DateTimeFormat().format()` with no date, `performance.mark/measure`,
  `performance.timeOrigin`.
- A caught ERR_ACCESS_DENIED is seen only from `process.*` functions and the guarded globals. Every other route to
  files or the network I found is either guarded or unreachable without an import, but I have not proven there is
  no other.
- If two background jobs overlap and one's callback sets a timer, whether that counts as a race can depend on
  which job finishes first.
- Callbacks run by the garbage collector (FinalizationRegistry) are not modelled.
- The control runs the TypeScript path; the JavaScript path (`target.mjs`) differs only in the file name and is
  covered by the sandbox tests, not by the control.
- The scanner tells `/` (division) from a regular expression by the token before it. A misread can only refuse
  more code, never let an import through: the module hook inside the sandbox refuses every import at run time.
- Not an OS sandbox: the boundary is still Node's permission model (`runners/executor/local.ts`). Modal (E4) is not
  touched.
- `async_hooks` (used to see background work) slows code that makes many promises. The step limit (20,000 timer
  firings) and the 10 s real-time limit bound it.
- No separate adversarial review agent has looked at this yet. The spec plans one per batch.

## Unsafe things noticed (not fixed here, outside E1's scope)

- **The older retry harness has the same blind spot.** `runners/ts/harness.ts` decides "pending (never settles)"
  from Node's live-resource list. Changed code that awaits `crypto.subtle.digest` (or another background job) while
  no timer is set would be reported as `pending` though it finishes. The fixture never does this. A Fixer change
  could. E1 left that harness untouched, as instructed.
