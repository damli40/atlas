# D01-05: local executor, Runner interface, TS control

Date: 2026-10-27 (WAT) · Node v25.8.1

**Control**, in plain words: before Atlas trusts a run, it runs two cases whose answers are
already known (oracle rows S1 and S3). They go through the same sandbox and the same harness
as a real run. If either result differs from its row, `controlPassed` is false and the reason
names the row and the field.

**Executor**: runs a `node` command in a child process inside an empty temp folder.
- It always switches on Node's permission model with `--permission`, and the child may read only that folder.
- The child gets no environment variables except the ones the caller passes.
- A hard wall-clock limit kills the child when time runs out.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| a one-off script: `control(target)` on `tests/fixtures/with-rpc-retry.ts` | `control-pass.json` | `controlPassed: true` |
| the same script: `runControl()` on a temp-dir copy with `RPC_RETRY_ATTEMPTS = 3` (copy deleted after) | `control-fail.json` | `controlPassed: false`, reason begins "S3: calls was 3, the oracle row says 5" |
| `pnpm exec vitest run tests/unit/executor.test.ts tests/unit/control.test.ts --reporter=verbose` | `test-output.txt` | 12 passed |
| `node --help` and `node --experimental-permission -e 1` | (below) | `--permission` exists; `--experimental-permission` → "node: bad option" |

## Node permission flag finding

Node 25.8.1 has the permission model as a stable flag, `--permission`. The old name,
`--experimental-permission`, is rejected with "bad option". The build plan's example command
uses the old name and would fail. The executor drops it if a caller passes it and always adds
`--permission` itself. The tests show these blocks inside the child, each throwing `ERR_ACCESS_DENIED`:
- a TCP connection to a port that really is listening on 127.0.0.1
- reading `/etc/hosts`
- writing a file
- starting a child process

## What it proves

- On the real fixture, S1 and S3 run in the sandbox and match their rows exactly, so the control passes.
- With one constant edited (attempts default 5 → 3), the control does not pass. S3 shows 3 calls,
  2 waits (6,000 ms), 2 log lines, and the error from call 3. S1 still matches, which shows the
  control catches a change that only shows up after failures.
- The control also does not pass when the code's SHA-256 isn't the target's, or when the
  sandbox runs out of time.
- `tsRunner().run()` runs an experiment (the S6 shape) in the sandbox after a passing control
  and reports `pending`, 1 call.

## What it does not prove

- **It isn't an OS sandbox.** No container, no seccomp. The boundary is Node's permission
  model, so native code or a security flaw in Node itself could get past it.
- **Only `node` commands run, with no network at all.** A host list
  (`allowNetwork: { hosts }`) is refused: Node can only allow all network or none. The EVM
  runner (anvil needs a network connection) will need its own executor path. This one fails
  closed rather than letting the network through unguarded.
- **`replayWithChange` is not built**, and it throws if called. That belongs to the
  change-and-replay task.
- **The reason is stored in the trace.** `Run` (src/types.ts) has no reason field, so the
  reason sits in the trace event `control_did_not_match`, read with `controlReason(run)`. It
  is also returned by `runControl()`.
- **The control checks two rows only.** A change that S1 and S3 can't see (for example, only to
  how 429 errors are handled) would pass the control. The per-row harness test (D01-04)
  covers more rows, but in-process.
