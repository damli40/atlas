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

## Unsafe things noticed

- **The older retry harness had the same blind spot.** Fixed in review round 1 (finding 4 below).
- **The older retry worker had the same forgeable marker.** Fixed after review round 1 (see "The retry worker's result channel" below).

## Review round 1 (adversarial review of E1, same day)

The reviewer found 2 confirmed blockers, 1 suspected major and 1 minor. Each one below is listed as the finding,
the fix, and the test that proves the fix. The tests are in `tests/unit/call-function-review1.test.ts` (36 tests) and `tests/unit/runner-integrity.test.ts`
(the retry path, 15 tests). Both files' output is in `review1-test-output.txt`.

**After the fixes:** 909 passed, 20 skipped, 81 files, the same in all 3 full runs (`review1-full-suite.txt`). The
type check is clean. The one extra skip is the live GitHub fetch, which skips by design when GitHub's rate limit is
hit. It is not a test I changed.

### B1 BLOCKER: pasted code could write Atlas's result itself
- **Finding:**
  - `process.report.getReport().header.commandLine` showed the secret result marker, even though it had been
    removed from `process.argv`.
  - `process.reallyExit` was not guarded.
  - Together they let pasted code write its own result line and exit. A call that never settles was recorded as
    `returned "42"` with the control passed.
- **Fix (the design is explained at the top of `runners/ts/call-worker.ts`):**
  - The marker is gone. The parent makes a fresh 32-byte key per run and sends it **on stdin only**. The new
    `stdin` field on the executor request carries it.
  - The worker reads the key before the code under test exists, then closes stdin. So the key is never in argv,
    env, a file or `process.report`.
  - The result line carries HMAC-SHA256(key, json) (a code computed from the key and the result, which cannot be
    made without the key). The parent recomputes it.
  - The parent refuses the run as tampered when: any line mentions ATLAS_RESULT but does not verify; there is a
    second such line; or the result holds run ids other than the ones requested.
  - I chose a key over "the parent works the outcome out by itself". Everything the parent receives comes out of
    the same process as the code, so there is nothing the parent could derive the outcome from.
  - `process.report`, `process.reallyExit` and `process.stdin` are now whole-run "can't check". The worker exits
    through its own copy of `reallyExit`, taken before the code is loaded.
- **Tests:**
  - The reviewer's exact attack.
  - Variant: a line with a guessed key, after which the real line also arrives.
  - Variant: a line through `console.log`, then `reallyExit`.
  - Variant: a line, then an endless loop, so the worker never writes.
  - Variant: argv, execArgv, env, title and argv0 are dumped, and the key is not in them. A spy executor confirms
    the key is in neither the command nor any file.
  - Reading `process.stdin` is refused.
  - Unit tests of the HMAC check: wrong key, wrong run id, body edited after signing, an extra forged line, no line.

### B2 BLOCKER: AbortSignal.timeout ran outside the virtual clock
- **Finding:** `AbortSignal.timeout` uses Node's internal timer. That timer is unref'd (does not keep the process
  alive) and its resource type `Timeout` was on the ignore list. Two wrong results followed:
  - A call woken by it was reported `never_settled`.
  - `Promise.race(abort after 5 ms, setTimeout 1000 ms)` was reported as `"timer"` at 1,000 ms. Real Node gives
    `"abort"`.
- **Fix:**
  - `AbortSignal.timeout` now runs on the virtual clock. It aborts with Node's own TimeoutError and message, and
    rejects bad delays with Node's own `ERR_OUT_OF_RANGE`.
  - `Timeout` and `Immediate` resources are no longer ignored as a type. Only the ones Atlas creates itself (its
    microtask drain and its 1 ms real waits, marked while they are made) are skipped. Every other one counts as
    work Atlas does not control.
- **Tests:**
  - Input 1 now returns `"woke"` at 20 virtual ms.
  - Input 2 now returns `"abort"` at 5 ms.
  - `AbortSignal.any` follows it.
  - A timeout created while the file loads is "can't check".

### MAJOR (suspected): the whole class of "wakes a promise without Atlas's clock"
Each API was either tested to work or refused as whole-run "can't check":

| API | Decision | Why |
|---|---|---|
| queueMicrotask chains, process.nextTick | works (tested) | drained before every timer |
| endless microtask chain | can't check (tested) | never hands control back; Atlas's real-time limit |
| Blob.text, CompressionStream | works (tested) | native jobs are tracked and waited for |
| ReadableStream, Response.json | works (tested) | microtasks only |
| structuredClone, also with an ArrayBuffer transfer | works (tested) | synchronous |
| EventTarget dispatched by the code | works (tested) | synchronous |
| AbortSignal.timeout / AbortSignal.any | works (tested) | moved to the virtual clock (B2) |
| crypto.subtle | works when alone, can't check when it races a timer (tested in E1) | real job time |
| MessageChannel / MessagePort / BroadcastChannel | **refused** (tested) | delivered on real time; an unref'd port is invisible |
| FinalizationRegistry / WeakRef | **refused** (tested) | depend on when garbage collection runs |
| process.on/once(... "beforeExit", "exit", "message", "disconnect", "SIG*") | **refused** (tested) | fired by the process, not the code; "beforeExit" would wake a call Atlas calls never-settled |
| navigator.locks | **refused** (tested) | granted on Node's own schedule |
| Atomics.waitAsync, WebAssembly.compile/instantiate | **refused** (tested in E1) | finish on real time |
| fetch, WebSocket, EventSource, imports, process.getBuiltinModule | **refused** (E1) | network/files/modules |

### MINOR: real-clock reads
- **Faked:** `performance.timeOrigin` is now the virtual epoch, so `timeOrigin + now()` is the virtual time.
  `Intl.DateTimeFormat#format()` and `formatToParts()` with no date now use the virtual date. Tested: after
  1,500 ms they read 2026-01-01T00:00:01.500Z.
- **Refused, because no honest fake exists:** `process.cpuUsage`, `process.resourceUsage`,
  `process.threadCpuUsage`, `performance.eventLoopUtilization`, `mark`, `measure`, `timerify`, `getEntries*`,
  `toJSON` and `nodeTiming`. Five of these are tested one by one.

### 4. The old retry harness's blind spot (reported in E1)
- **Fix:** `runners/ts/harness.ts` got the same background-work tracker. `worker.ts` installs it before the code is
  imported, so tests that call the harness directly, outside the sandbox, behave exactly as before.
  - Real timers the code starts through Atlas's wrapped globals are still handled by the old real-timer check,
    with the old wording.
- **Proof the fixture's results did not change:**
  - Every existing retry test passes, including the oracle rows, control, sweep and executor tests.
  - The day-1 gate script (`tests/gate/six-cases.ts`) again gives **18 matched, 1 didn't match, 1 can't check**,
    as in D01-08 (`review1-retry-gate-day1.txt`).
- **Proof the blind spot is fixed:** a changed `withRpcRetry` that awaits a hash first.
  - On the old harness (commit 429fed4) its row S1 read `pending`. I ran this by hand: the old harness files were
    put back for one run, then restored.
  - Now S1 reads `returns` with 1 call.
  - The same hash racing the code's sleep is "can't check".

### Still not covered after round 1
- Math.random / crypto randomness is real, as before.
- An internal Node *interval* (a repeating timer) is tracked only until its first firing. I found no global API
  that creates one on the code's behalf.
- The reviewer did not reach: json-bet edge cases (-0, unicode normalisation, large numbers), question text built
  from odd export names, and seal/verify changes.

### Found while squashing: console.log looked like outside work
- **Finding:** Node creates the stdout stream lazily, the first time code writes to it. The background-work tracker
  saw that stream being created and counted it as pending work that never finished. So code that called
  `console.log` or `process.stdout.write`:
  - waited 2 s for nothing;
  - and, after the call settled, had its stand-in counts left unclaimed.
  - The reviewer's "guessed key" forge test hit this and timed out under load.
- **Fix:** both workers create stdout and stderr before the tracker starts.
- **Test:** "console.log and process.stdout.write do not count as outside work". It fails with the fix removed
  (checked) and passes with it. This fix is folded into the squashed round-1 commit, so that commit passes on its own.

### The retry worker's result channel (asked for after round 1)
- **Finding:** the retry worker (`runners/ts/worker.ts`) still had the argv marker. The code it runs includes Fixer
  changes, which are AI-written. I confirmed the forge works there: a changed `withRpcRetry` that read the marker from
  `process.report`, wrote a line holding the oracle's answers for S1, S3 and S6, and called `reallyExit`, **passed the
  control** on the old channel. I checked this by putting the old worker and control back for one run.
- **Fix:** the same channel as call-function.
  - A per-run 32-byte key goes on stdin only. The worker reads it, closes stdin, and signs its result with
    HMAC-SHA256.
  - The parent (`parseWorkerOutput`, `runners/ts/control.ts`) counts only lines whose signature verifies. An unsigned
    or wrongly signed line is the code's own output and is ignored, as before.
  - Two signed lines, or a signed line that does not parse, still count as tampering.
  - Nothing else in the retry worker changed. Its process exit, its guards and its harness behave as before.
- **Tests** (`tests/unit/runner-integrity.test.ts`):
  - The forge above, with complete oracle values. The control now fails with "no result".
  - A guessed-key line written from an exit handler, after the real result: ignored, and the control still passes
    with S3 = 5 calls.
  - A `withRpcRetry` that returns its own argv, execArgv, env and title: the returned text holds `worker.ts` but not
    the key.
  - The parser unit test, rewritten for signed lines: one signed line counts; two are tampering; bad JSON is
    tampering; unsigned, guessed or wrong-key lines are ignored.
- **Fixture results unchanged:**
  - Every retry test passes.
  - The day-1 gate script again gives **18 matched, 1 didn't match, 1 can't check**, with the control passed on
    every run (`review1-retry-gate-day1.txt`).
- **Counts:** 909 passed, 20 skipped, 81 files, 3 of 3 full runs. Type check clean.
