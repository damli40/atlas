# E4: the Modal executor (hosted runs of pasted code in throwaway cloud containers)

Date: 2026-10-27 (WAT) · no model call · Modal sandbox time for the whole batch ≈ 2.5 minutes (under $0.05).

## Where to look first

- **Read "Review round 1" at the bottom first.** It corrects three things the first version of this page got
  wrong: which Modal backend ran, whether native code from npm loads into the server, and the cost of a stopped
  sandbox. It also adds the daily spend cap, and Dami's decisions D31 (reuse a passed control for 10 minutes) and
  D32 (warm Modal at startup). With those two, a first paste on a warm server needs ONE sandbox: about 3.5–4.5 s,
  not 7–9 s.

- **What it does.** With `ATLAS_EXECUTOR=modal`, every command Atlas runs in a sandbox gets its own Modal
  Sandbox: a small cloud container made for that one command and deleted right after it, also after an error or a
  timeout. Hosted Atlas runs strangers' pasted code this way (D16, D25). Without the variable, nothing changes:
  the local executor runs as before.
- **The live result.** The live suite ran once on real Modal and all 8 tests passed (`live-test-output.txt`):
  - the E1 control passed on Modal;
  - 3 ordinary functions gave exactly the same facts on Modal as on this machine;
  - every attack failed: the network, reading env for secrets, two ways of forging the result, an endless loop,
    and a 20 MB stdout flood.
- **The number that decides the demo.**
  - One warm sandbox for a pasted run takes **3.4–4.5 s** end to end. Locally the same step takes 0.2 s.
  - A first pasted run needs 2 sandboxes, one after the other: the control (Atlas checking its own measuring code)
    and the run itself. So it takes **about 7–9 s**.
  - The first sandbox after the server starts adds about 3 s (5.9 s instead of 2.4–3.2 s).
  - So Modal can run live in the demo, but the page must show progress during the wait. Two cheap
    improvements are listed under "Open choices".
- **Cost.** About **$0.0001–0.0002 per sandbox**, so about $0.0003 per pasted run (pricing explained below).
  Modal's free $30 a month covers roughly 100,000 runs.

## The design choice: Modal's JavaScript SDK, not a Python bridge

There were two ways to drive Modal from the Node server.
- **(a) Modal's own JavaScript SDK** (`modal` on npm).
- **(b) A small Python process** that uses Modal's Python SDK (1.6.2, installed on this machine), called by the
  server for each run.

**Chosen: (a), pinned to `modal@0.11.0`.**

Why:
- **It has everything this batch needs.** I checked its type definitions, not its marketing:
  - sandbox options: `blockNetwork`, `cpu` / `cpuLimit`, `memoryMiB` / `memoryLimitMiB`, `timeoutMs`;
  - `exec` with stdin, stdout and stderr streams;
  - `wait`, `terminate`, and image building (`fromRegistry` + `dockerfileCommands`).
- **It is maintained by Modal itself**, in the same repository as the Python client, with a release every few weeks
  since April 2026.
- **It runs inside the server process.** There is no extra Python process to start for every run (that alone
  costs about a second) and no second language at the boundary.
- **It is not 1.0 yet.** Two things contain that risk:
  - the version is pinned exactly (0.11.0 is 4 weeks old; 0.11.1 is 11 days old and was not taken);
  - the executor touches only a 3-method interface (`ModalBackend` in `runners/executor/modal.ts`), so a
    breaking SDK change is a fix in one function, `sdkBackend`.
- **Supply chain.** The SDK brings 6 dependencies. Two of them ship install scripts (`cbor-extract`, an optional
  native speed-up, and `protobufjs`, a version notice). Both scripts are refused in `pnpm-workspace.yaml`.
  **Corrected in review round 1 (B):** I wrote here that refusing the script meant the native code was not used.
  That was wrong: pnpm installs a PREBUILT native binary for `cbor-extract` without any script, and the SDK
  loaded it into the server process. The fix is a switch, not the script refusal: `loadModalSdk` sets
  `CBOR_NATIVE_ACCELERATION_DISABLED=true` before the SDK loads, and a test proves no `.node` file is loaded
  (and that one IS loaded without the switch, on this machine).
- **Loaded only when needed.** The SDK loads when the first sandbox is made, so a server on the local executor
  never loads it.

## What the boundary is, layer by layer

Each layer would stop pasted code from ESCAPING (reaching the network, a secret or another run) on its own.
Together they are "defence in depth": if one layer has a hole, the next one still holds. They do not protect the
result key from code in the same process if Node's own guard were bypassed (review round 1, D). The file is `runners/executor/modal.ts`.

| Layer | What it does | Proven by |
|---|---|---|
| Fresh container per exec | Nothing survives from an earlier run. `terminate` runs in a `finally`. Modal's own timeout (startup + wall clock + 30 s) kills the container if the server dies. | unit: terminate on success, error, timeout and failed setup; live: 14 sandboxes, 14 log lines |
| No network | `blockNetwork: true`. Even a DNS lookup fails. | live: as root, WITHOUT Node's guard, `fetch` fails with `EAI_AGAIN` and a TCP connection to 1.1.1.1 fails |
| No secrets, no env | The sandbox gets no Secrets, no volumes and no env. The command runs under `env -i`, so it sees only the env the request carries. Modal's own `MODAL_*` variables are removed too. | unit: the exact spec keys; live: `process.env` is `{}` |
| Not root | The command runs as `nobody` (uid 65534) through `setpriv --no-new-privs`. The files are owned by root and read-only to it. | live: `uid: 65534` |
| Node's permission model | The same flags as the local executor (`guardedNodeArgs`, shared code): read the run folder only; no writes, network, child processes or add-ons. | unit: the exact command; live: pasted `fetch` is whole-run "can't check" |
| Limits | 0.5 cores reserved, 1 core max; 512 MiB reserved, 1 GiB max. Atlas's own wall-clock kill. stdout and stderr capped at 16 MiB each. At most 4 sandboxes at once (`ATLAS_MODAL_MAX_SANDBOXES`); 16 may wait (`ATLAS_MODAL_MAX_QUEUED`); one more is refused as busy. | unit: caps, queue, busy refusal; live: endless loop, 20 MB flood |
| One log line per sandbox | Id, outcome, exit code, `timedOut`, create / setup / run / total ms, output sizes. Never the code, the output or the key. | unit: the line's exact shape; live: `live-sandboxes.json` |

**The per-run result key** (E1's signed result channel) travels on the run command's stdin ONLY. The files go in
through a separate first command, an unpacker that reads them as JSON on its own stdin. So the key is never in:
- a file;
- a command line;
- the sandbox settings;
- a log line.

Tested both ways:
- **Unit test:** a fake records everything sent to Modal. The key is only in the run's stdin.
- **Live test:** pasted code dumped argv, execArgv, env and title. The key was in none of them, and in no log line.

**The pinned image** is `python:3.14.7-slim-trixie`, pinned by digest, plus the official Node v25.8.1 Linux
binary.
- The Node download is checked against its published SHA-256 while the image is built.
- `libatomic1` is installed from Debian because the Node binary needs it.
- **What gets recorded:** each exec reads Node's version in the container and refuses a mismatch. The first
  exec in a process reads Python's version the same way.
- Both versions go into the run's trace (`runtime`), with the image label and the sandbox id. The live run
  recorded Node `v25.8.1` and `Python 3.14.7`, the same versions as this machine. That keeps E2's Python runner in
  the same version family.

**Choosing the executor:** `runners/executor/select.ts`, called once in `server/index.ts`.
- `ATLAS_EXECUTOR` unset or `local` → the local executor.
- `ATLAS_EXECUTOR=modal` → the Modal executor.
- Any other value stops the server, so a typo never quietly means "local".
- The startup line says which sandbox is in use.
- Every Run records `executor.kind`, the executor that actually ran it.

**When Modal cannot be reached:** no credentials, Modal down, or a sandbox that does not start within 120 s.
- The executor throws with the reason.
- The server turns that into its existing answer for this case (final review S2): **"the run did not finish:
  the sandbox could not start: Modal could not create a sandbox: <reason>"**. The experiment and its sealed
  bets stay as they are, and the person can try again.
- It never falls back to the local executor. A unit test spies on the local executor and confirms it is never
  called. A server test gets the 503 answer with Modal's reason and no verdicts.

## Live results (`ATLAS_LIVE_MODAL=1`, one run, 2026-10-27 21:11 UTC)

Command: `ATLAS_LIVE_MODAL=1 pnpm vitest run tests/unit/modal-live.test.ts --reporter=verbose`.
Files: `live-test-output.txt` (the 8 tests), `live-sandboxes.json` (every sandbox's log line, by test).

| Test | Result |
|---|---|
| E1 control on Modal | passed; `executor: "modal"`; runtime Node v25.8.1, Python 3.14.7, a real `sb-…` id |
| 3 ordinary functions (`add` with JSON args; a TypeScript retry with an async stand-in that throws, then returns after 250 virtual ms; a function that throws RangeError) | the measured result on Modal is deep-equal to the local result, all three |
| Network: pasted `fetch` | whole-run "can't check" (the sandbox refused the access); a bet on it is "can't check" |
| Network: the container itself, as root, without Node's guard | `fetch` failed (`EAI_AGAIN`), TCP to 1.1.1.1:443 failed; nothing printed "OK" |
| Env for secrets | the run command's `process.env` is `{}`, uid 65534; pasted `Object.keys(process.env)` gives `[]` |
| The key | pasted code dumped argv / execArgv / env / title / argv0: the key is in none of them, nor in any log line |
| Forged result line (guessed key, then never settles) | refused as tampering, whole-run "can't check" |
| Forge via `process.report` (E1's B1 attack) | refused (`process.report` is a whole-run reason), "can't check" |
| Endless loop `for(;;){}`, 4 s limit | Atlas stopped it at 4,002 ms; `timedOut: true`; whole-run "can't check" ("ran past Atlas's 4000 ms limit of REAL time"); the sandbox was terminated |
| 20 MB stdout flood | 20,971,999 characters came out of the container; Atlas kept 16 MiB; no result line inside the cap, so whole-run "can't check" |

Modal adds environment variables to every container. Only their NAMES were read, never the values. `env -i`
removes all of them, and none contains "TOKEN":
`BLIS_NUM_THREADS CFLAGS HOME MKL_NUM_THREADS MODAL_CLOUD_PROVIDER MODAL_CONTAINER_ARGUMENTS_PATH MODAL_IMAGE_ID
MODAL_REGION MODAL_SANDBOX_ID MODAL_TASK_ID OMP_NUM_THREADS OPENBLAS_NUM_THREADS ORT_INTER_OP_NUM_THREADS
ORT_INTRA_OP_NUM_THREADS PATH PIP_DEFAULT_TIMEOUT PIP_NO_CACHE_DIR PIP_ROOT_USER_ACTION PWD PYTHONHASHSEED
PYTHONPATH PYTHON_SHA256 PYTHON_VERSION SOURCE_DATE_EPOCH SSL_CERT_DIR TERM UV_BREAK_SYSTEM_PACKAGES`.

## Latency (what it decides: Modal can run live in the demo, with a progress message)

How long each step of one sandbox takes, from the live suite's log lines (`live-sandboxes.json`) and a separate
cold/warm measurement (`latency-cold-warm.json`):

| Step | Time | What it is |
|---|---|---|
| create | 0.23–0.33 s | Modal accepts the sandbox (it is not running yet) |
| setup | 1.5–3.3 s | waiting for the container to boot, plus writing the files in (plus the one-time Python check) |
| run | 0.19–0.62 s | the call-worker itself (locally the whole control takes 0.19–0.26 s) |
| **one warm sandbox, pasted run** | **3.4–4.5 s** | 9 call-function sandboxes in the live suite |
| one warm sandbox, trivial command | 2.4–3.2 s | `latency-cold-warm.json`, execs 2–4 |
| first sandbox in a fresh server process (image already built) | 5.9 s | loading the SDK, looking up the app and the image |
| first sandbox ever for a new image | 29.5 s | building the image (once, then Modal caches it) |

**What a person waits for on a first paste:**
- About 7–9 s with a warm server: the control's sandbox, then the run's sandbox, one after the other. The control
  checks Atlas's own measuring code, not the pasted code.
- About 10–12 s if the server just started.
- A second experiment on the same pasted file reuses the control: about 3.5–4.5 s.

## Cost per run (estimate from Modal's published prices; checked against Modal's bill in review round 1)

Modal bills sandboxes at its "non-preemptible" rate (a sandbox is never stopped early to free the machine for
someone else):
- CPU: $0.00003942 per core per second;
- memory: $0.00000667 per GiB per second.

It charges for whichever is higher: what was reserved, or what was used.

| | Cores × seconds | GiB × seconds | Cost |
|---|---|---|---|
| One warm sandbox at the reservation (0.5 cores, 0.5 GiB, ~3.5 s) | 1.75 | 1.75 | ≈ $0.00008 |
| The same at the caps (1 core, 1 GiB) | 3.5 | 3.5 | ≈ $0.00016 |
| A pasted run (control + run) | | | ≈ $0.0002–0.0003 |
| Worst ordinary case: an endless loop held to the default 10 s limit (~13.5 s at 1 core, 1 GiB) | 13.5 | 13.5 | ≈ $0.0006 |

This batch's own testing used about 25 sandboxes, about 2.5 minutes of sandbox time in total: well under $0.05.
**Review round 1 (I) checked the real bill:** see "Review round 1". The measured figure is about $0.0001 per
sandbox, the same as the estimate above, and the ~30 s a sandbox stays listed after Atlas stops it is not billed.

## Tests and counts

| | Before E4 (5f28a6c) | After E4 |
|---|---|---|
| Test files | 82 | 84 (1 live file, skipped unless `ATLAS_LIVE_MODAL=1`) |
| Tests passed | 920 | 942 (+21 Modal executor, +1 secret scan) |
| Skipped | 19 | 27 (+8 live Modal tests) |
| Type check | 0 errors | 0 errors (`tsc-output.txt` is empty) |

The full suite passed 3 times in a row, then once more for `full-suite.txt`. `no-local-paths.test.ts` passes.
Files: `test-output.txt` (every E4 test by name), `full-suite.txt`, `tsc-output.txt`.

**Unit tests** (`tests/unit/modal-executor.test.ts`, 21 tests). Fake Modal backends in `tests/unit/modal-fakes.ts`:
- **The scripted fake** records everything sent to Modal and answers as the test says. Tests check:
  - the exact sandbox settings, and the exact command;
  - that bad requests are refused before any sandbox exists: a widening Node flag, a network host list,
    NODE_OPTIONS, a non-node command, an odd env name, a path that leaves the folder;
  - where the key goes;
  - the log line;
  - exit code, output and runtime reported faithfully;
  - the 16 MiB cap on a 20 MB fake flood;
  - the wall-clock kill;
  - each failing step named, with the sandbox still terminated;
  - Modal unreachable;
  - a sandbox that starts too late (refused, then terminated when it arrives);
  - Python checked once;
  - the concurrency cap, the queue and the busy refusal;
  - a failed run giving its slot back.
- **The unpacker** runs for real on this machine: it writes the files, and it refuses a path that leaves the folder.
- **Selection:** unset, `local`, `modal`, and 4 bad values that each stop the server. "Modal unreachable" in
  hosted mode never calls the local executor.
- **The emulating fake** runs the executor's commands on this machine with the real call-worker. Tests check:
  - the E1 control passes, and the runs say `modal` with their runtime;
  - an ordinary function is measured;
  - a forged line is refused;
  - through the server, Modal down gives "the run did not finish" with Modal's reason;
  - with Modal up, the retry fixture's control and run go through it, each in its own sandbox.

**Secret scan** (`tests/tools/secret-scan.mjs`):
- `loadRealSecrets()` now also blocks the real Modal token id and token secret.
  - It reads them from every profile in `~/.modal.toml` (or `MODAL_CONFIG_PATH`), and from `MODAL_TOKEN_ID` /
    `MODAL_TOKEN_SECRET`.
  - The values are never printed.
- A new test uses a fake TOML file with two profiles, double- and single-quoted values, a comment, and an empty
  secret.
- The pre-commit hook ran with the real tokens loaded on every commit of this batch.

## Open choices (both decided and built in review round 1: D31 and D32)

1. **Cache the call-function control once per harness, not once per pasted file.** Decided as D31 and built:
   see "Review round 1".
2. **Warm the server at startup.** Decided as D32 and built: see "Review round 1".

## Known limits

- **The fakes test the plumbing, not the isolation.** The isolation (network, env, uid, no secrets) is proven
  only by the one live run above. It should be run again after any change to `modal.ts` or the image.
- **Atlas's wall-clock limit starts when the exec call returns, not when Node starts in the container.** A slow
  network adds to the code's apparent time. With the default 10 s limit and a 0.5 s run that is far away, but a
  very tight limit could time out honest code ("can't check", never a wrong fact).
- **The retry fixture's run on Modal is tested only with the emulating fake.** The live suite covers the
  call-function path only.
- **`libatomic1` comes from Debian's package mirror at image build time and is not pinned to a version.** The base
  image is pinned by digest and Node by SHA-256. A rebuilt image could get a newer libatomic1.
- **The container has no limit on the number of processes**, and its disk is writable by root. Neither is
  reachable here: Node's permission model refuses child processes and file writes, and the code runs as `nobody`.
  But this is defence in depth, not a proof.
- **Corrected in review round 1 (A):** this line used to say Modal's v1 backend runs and V2 "was not tried". That
  was wrong: the SDK picks V2 by default, so every live run was on V2. V2 is now pinned explicitly and recorded in
  each run. V1 has never been live-tested.
- **Modal's own environment variables** (region, task id, image id) exist in the container. `env -i` keeps them
  from the command, and their values were never read.
- **Reviewed:** one adversarial review round (0 blockers, 3 majors, 10 minors), fixed below.

## Review round 1 (adversarial review of E4: 0 blockers, 3 majors, 10 minors)

The reviewer attacked the live boundary, including attacks that assume Node's own guard is already broken. Every
escape attempt failed. The findings were about what this page claimed, about spend, and about wording people see.
Each item below gives the finding, the fix, and the test. The tests are in `tests/unit/modal-review1.test.ts`
(24 tests) unless named otherwise; their output is in `review1-test-output.txt`.

**After the fixes:**
- **Unit and server tests:** 966 passed, 30 skipped, 85 files, the same in 3 full runs plus 1 saved
  (`review1-full-suite.txt`). The type check is clean (`review1-tsc-output.txt` is empty).
- **The 3 new skips** are the 3 new live tests; they run only with `ATLAS_LIVE_MODAL=1`.
- **The live suite** ran once again on real Modal: 11 of 11 passed (`review1-live-test-output.txt`,
  `review1-live-sandboxes.json`).
- **Modal time this round:** about 1.7 sandbox-minutes as Atlas measured it (14 executor sandboxes, 2 raw probes,
  1 probe of how long a stopped sandbox stays listed). Nothing is left running: `sandboxes.list` returned 0.

### A (MAJOR): this page named the wrong Modal backend
- **Finding:** `sandboxes.create` in the SDK picks the V2 backend unless the machine's Modal config says otherwise.
  So every live run was on V2, while this page said V1 ran and V2 was never tried. A host configured for V1 would
  have run an untested backend.
- **Fix:**
  - Sandboxes are now made with `experimentalCreate` (V2) explicitly, whatever the machine's config says.
  - Every run records `backend: "v2"` in its runtime (in the trace).
  - V2 is also part of the executor's fingerprint.
  - The Known limits line is corrected.
- **Tests:**
  - A mocked SDK: `experimentalCreate` is called and `create` never is.
  - Each run's runtime says `v2`.
  - Live: the control's runtime says `backend: "v2"`.

### B (MAJOR): native code from npm loaded into the server process
- **Finding:** pnpm installs `cbor-extract`'s prebuilt native binary with no install script, and the SDK loaded it
  into the server. That is the process that holds the Meta key, the RPC URL and the Modal token. This page said
  refusing the script prevented that.
- **Fix:**
  - Every load of the SDK goes through `loadModalSdk`, which first sets `CBOR_NATIVE_ACCELERATION_DISABLED=true`.
    The CBOR library then uses plain JavaScript.
  - The supply-chain paragraph above is corrected.
- **Tests:**
  - A fresh Node process loads the SDK through `loadModalSdk`. No `.node` file is in `require.cache`, and none is
    in the process's loaded shared libraries.
  - Control case: importing the SDK directly, without the switch, DOES load one on this machine. So the first
    test is not passing by accident.
  - Live: after the whole live suite, the test process has loaded no `.node` file.

### C (MAJOR): nothing capped total Modal spend
- **Finding:** the caps limited how many sandboxes run at once, not how many run in a day. One client keeping
  4 sandboxes busy could cost about $16 a day.
- **Fix:** a daily cap inside the executor, counted per UTC day.
  - Sandbox starts: default 2,000 (`ATLAS_MODAL_MAX_SANDBOXES_PER_DAY`).
  - Sandbox-seconds, from create to terminate as Atlas measures it: default 7,200, which is 2 hours
    (`ATLAS_MODAL_MAX_SANDBOX_SECONDS_PER_DAY`).
  - Past either cap, the exec is refused before any sandbox exists, with "Atlas's daily sandbox budget is used up
    (… today); it resets at 00:00 UTC".
  - The server turns that into "the run did not finish: …", so no verdict is recorded.
  - **What the default costs at most:** 2 hours at the caps (1 core, 1 GiB) is about $0.33 a day, about $10 a month.
  - **Still needed:** the real backstop is a budget limit on the Modal workspace. That is Dami's to set in Modal's
    dashboard.
- **Tests:**
  - The start cap: refused, no sandbox made, the slot given back, and a new UTC day starts afresh.
  - The seconds cap.
  - Through the server: a 503 with the budget reason and no verdicts.
  - The two env settings.

### D (log only): the in-process key
If Node's permission model were bypassed, pasted code could read the result key from its own memory
(`/proc/self/mem`) and sign a fake result. The reviewer showed this by running Node WITHOUT its guard, as nobody,
in a sandbox built like Atlas's: the key was found.
- **What the container does protect:** escape and secrets (no network, no credentials).
- **What it cannot protect:** memory inside one process, so it cannot protect the result's integrity.
- **The real fix is outside E4:** run Atlas's measuring code in a different process from the pasted code.
- Logged in Known limits, and the boundary sentence above now says so.

### E (minor): Modal's internal text reached a person-facing reason
- **Finding:** an out-of-memory run read "…(waiting on pid 10 … in sandbox "ta-…": urpc method
  "containerManager.WaitPID" failed: EOF)".
- **Fix:**
  - `cleanModalText` drops Modal's own lines and masks its ids, in stderr and in every thrown reason.
  - A run killed with exit 137 now says "the sandbox killed the code (exit 137), most likely because it used more
    memory than the sandbox allows".
- **Tests:** the cleaner on its own; an exit-137 run with Modal's real line on stderr; a thrown error carrying a
  task id.
- **Live:** a 2 GiB typed-array bomb was killed after 26 s and gave exactly that reason, with no Modal id or RPC
  name.

### F (minor): a sandbox that died was called "could not start"
- **Fix:**
  - If the command started and the sandbox then went away under it, the result now says `stopped`, in plain
    words, instead of throwing.
    - It counts as "went away" when Modal's error reads "shutting down", NOT_FOUND, terminated,
      FAILED_PRECONDITION, EOF or UNAVAILABLE.
    - The run becomes a whole-run "can't check": "the sandbox stopped while the code ran (…); this usually means the
      code used more than the sandbox's 1024 MiB of memory".
  - The retry runner shows the same reason.
  - Any other error is still a failure of Modal itself.
- **Tests:** a fake whose `wait()` rejects with Modal's shutting-down error, checked through the executor and
  through the call runner (never "could not start"); a different error still throws.

### G (minor): a failed stdin write was blamed on the code
- **Fix:**
  - A failed write of the run's input is remembered.
  - If the run then hits the wall clock, the executor throws "Modal did not deliver the run's input (stdin): …"
    instead of reporting `timedOut`. A timeout would have read "the code ran past Atlas's limit (it may loop)",
    which is false: the code never loaded.
- **Test:** a fake whose stdin write fails.

### H (minor): `ATLAS_EXECUTOR` set but empty meant local
- **Fix:** set but empty, or only spaces, now stops the server ("set but empty"). Unset still means local.
- **Test:** `""`, `" "`, a tab and a newline each stop the server.

### I (minor): stopped sandboxes stay listed, and the cost assumption was not checked
- **Measured lag:** `terminate({ wait: true })` took **30.5 s** to confirm a stopped sandbox (exit 137). It
  disappeared from `sandboxes.list` at 33 s.
- **Is the lag billed? No.** Modal's billing report for this app (`workspace_billing_report`, hourly) shows:
  - **21:00–22:00 UTC:** $0.0061, for about 62 sandboxes and about 410 sandbox-seconds as the clients measured
    them (mine plus the reviewer's).
  - **22:00–23:00 UTC:** $0.0022, for 17 sandboxes and about 100 sandbox-seconds (this round's live suite and probe).
  - At the reserved rate (0.5 core + 0.5 GiB = $0.000023 a second), 100 s is $0.0023: the 22:00 bill matches
    almost exactly.
  - If the ~30 s lag were billed, the 17 sandboxes would add about 510 s (about $0.012), and the 22:00 bill would
    be about $0.014. It is $0.0022.
- **Corrected cost figure:** about **$0.0001 per sandbox** measured (the estimate was $0.00008 at the
  reservation). With D31 a pasted run needs one sandbox on a warm server, so **about $0.0001–0.0002 per run**.
- **Left as it is:**
  - Atlas does not wait the 30 s for confirmation, because it would add 30 s to every run.
  - So during a burst, Modal may show more stopped sandboxes than Atlas's 4-at-once count. They are not running
    code and are not billed.

### J (minor): two waits had no deadline
- **Fix:**
  - Starting the run command now has the startup deadline.
  - Python's version is now read in EACH sandbox, alongside writing the files, under the same deadline. It used
    to be read once, in the first sandbox, and shared. So one slow sandbox can no longer hold other runs, and a
    run's recorded Python version is measured in its own sandbox.
  - This adds no time: the check runs at the same time as the file write.
- **Tests:** the run command never answers; the Python check never answers (both refused at the deadline, with
  the sandbox terminated); Python is read once per sandbox.

### K (minor): secret-scan gaps
- **Fix:**
  - A generic shape for any Modal token (`ak-…` / `as-…` with 20 or more letters and digits), so a token that is
    not on this machine is caught too.
  - Quoted TOML keys (`"token_secret" = "…"`) are read.
- **Tests:** in `tests/unit/secret-scan.test.ts`: a quoted key with CRLF line endings; a foreign token's shape;
  ordinary words such as "as-is" pass.
- **Check:** all tracked files still pass the scan.

### L (log only): `libatomic1` is not pinned
Already in Known limits. The reviewer assessed the risk as low: apt checks Debian's signatures, Modal caches the
image, and every exec refuses a Node other than v25.8.1.

### M (log only): the 16 MiB cap counts differently on Modal and locally
- **On Modal:** exactly 16 Mi UTF-16 characters are kept.
- **Locally:** whole chunks are kept until the string passes that length.
- **Effect:** output near the cap (for example 10 million "é") can be "can't check" on one executor and measured
  on the other. It is never a wrong fact, only a difference in can't-check.
- **Also:** once over the cap, both still read and drop the rest until the process ends.

### D31 (Dami's decision): reuse a passed control for up to 10 minutes
- **What it does:**
  - `callControlFor` (`runners/ts/call-runner.ts`) reuses a call-function control that PASSED for up to 10
    minutes, measured from when it finished.
  - **The reuse key** is a hash of these, together:
    - Atlas's measuring code: the harness and worker files the sandbox runs, the reference file and its known
      answers;
    - the executor kind;
    - the executor's fingerprint: locally the Node version; on Modal the backend, the image digest and the Node
      checksum.
  - A control that did not pass, or that threw, is never kept. Two runs asking at once share one control run.
  - A control made on one executor is refused for a run on another, so a run never claims `modal` when its
    control ran locally.
  - The TS runner uses it. When E3 adds pasted targets to the server, the server must use `callControlFor` too.
- **What a proof file and the proof card show:**
  - Each call-function run names the control it relied on in its `call_checks` trace event: `controlRunId` and
    `controlFinishedAt`.
  - `verify` checks that the control:
    - is the run's own `controlRunId`;
    - finished before the run started;
    - finished at most 11 minutes before the run started (10 minutes of reuse plus 1 minute of slack).

    Older files without these fields still verify.
  - The proof card reads "known-case check of Atlas's measuring code matched at <time> (control run <id>), N s
    before this run".
- **Tests:**
  - Reused within 10 minutes with no new sandbox, and run again after.
  - The key changes with the executor and with the image.
  - Concurrent asks share one run.
  - A failed control and a thrown one are never reused.
  - A `.atlas.json` that relied on a reused control verifies, and the proof-card line says when the control
    matched.
  - Moving the control's time after the run starts, or 12 minutes before it, or naming another control, each
    fails verify.
  - Live: the second ask reused the first control with no new sandbox.
- **What it changes for the demo:** after the warm-up, a pasted run needs ONE sandbox: about 3.5–4.5 s warm,
  instead of 7–9 s.

### D32 (Dami's decision): warm Modal at server start
- **What it does:**
  - With `ATLAS_EXECUTOR=modal`, `server/index.ts` calls `warmUp` (`runners/executor/warm.ts`) once, after it
    starts listening. It does not wait for it.
  - `warmUp` runs the call-function control in one sandbox. That loads the SDK, checks Modal is reachable, and
    fills D31's reuse slot.
  - It logs one line, either "Modal warm-up: Modal is reachable; the known-case check passed in a sandbox in N ms
    and is reused for 10 minutes", or the failure with its reason.
  - Its promise never rejects, so a failure cannot stop the server. The first real run simply tries Modal again.
  - With the local executor it does nothing.
- **Tests:**
  - The warm-up makes one sandbox, and the next control reuses it.
  - A failed warm-up is one log line and resolves.
  - The local executor is never warmed.
- **Not tested end to end:** a real server start on Modal. The unit tests call `warmUp` directly, and the live
  suite covers the control it runs.

### Not done in this round
- The Modal workspace budget limit (Dami's dashboard).
- Running the measuring code in a separate process from the pasted code (D's real fix).
- Pinning `libatomic1` (L).
- Making the output cap count the same way on both executors (M).
- A V1 live test: V1 is no longer used.
- No second reviewer has looked at these fixes yet.

## Rebase onto main, and hosted Python (D24), 2026-10-27

### Rebase
`e4-modal` was rebased onto main at b28f9b3, which carries E2 (Python). Three files had conflicts:
- **`runners/executor/local.ts`:** kept E2's fix, which collects raw bytes and decodes them once, so a multi-byte
  character split across reads stays whole. Also kept E4's shared flag guard, fingerprint and `runtime` field.
- **`runners/ts/control.ts`:** kept E2's Python dispatch, and applied D31 to it.
- **`tests/evidence/README.md`:** both index lines are kept.

All E2 tests pass unchanged on the rebased branch.

### Hosted Python
Judges can paste Python on the hosted site (D24), and before this change hosted Python did not work. Now it does:
- **When the runner's executor is Modal, pasted Python runs in a Modal sandbox too.** The rule is
  `pythonExecutorFor` in `runners/ts/control.ts`, and it never falls back to running locally. On the local
  executor, Python still uses macOS sandbox-exec, as in E2.
- **The command:** `python3 -I -S -B boot.py`, the same flags as the macOS executor, under `env -i`, as nobody with
  no new privileges, with no network.
  - The container, the network block and the non-root user take the place of sandbox-exec.
  - The harness's audit hook and every in-process refusal are unchanged (`runners/py/*.py` was not edited).
  - The Modal executor applies the macOS executor's rules to `python3`: script names only, no interpreter flags,
    an empty environment, no network.
- **What each Python run records in its trace:** the executor and its runtime (Modal backend `v2`, Node, Python
  `Python 3.14.7`, image, sandbox id). It also keeps the harness's own reported Python version (`3.14.7`).
- **The other E4 protections apply to Python too:**
  - the result key travels on stdin only;
  - a sandbox that stops under the code gives "stopped", not "could not start";
  - exit 137 gives the plain out-of-memory reason;
  - Modal's own text is stripped from reasons;
  - E2's redaction of the run folder now also covers the Modal folder (`atlas-exec-`).
- **D31 covers the Python control.**
  - `pyControlFor` reuses a passed Python control for 10 minutes.
  - Its key is: the Python harness files (`boot.py`, `harness.py`, `exposed.py`), `reference.py` and its known
    answers, the executor kind and fingerprint, and the Python version (the pinned image's on Modal, this Mac's
    locally).
  - The macOS executor now has a fingerprint naming its Python.
  - A Python control made on one executor is refused for a run on another.
  - Each Python run names its control and that control's time (`controlFinishedAt`), so `verify` and the proof
    card treat it like a JavaScript run.

**Tests (fake Modal, $0):** `tests/unit/modal-python.test.ts`, 6 tests.
- The exact container command for Python.
- The key on stdin only.
- Which executor runs Python.
- The Python reuse key changes with the executor and the image.
- End to end through the real Python harness, with Modal's plumbing emulated on this Mac:
  - the Python control passes on "modal" and is reused;
  - a run records the executor, the runtime and the control time;
  - a Python control made locally is refused for a Modal run.
- `tests/unit/modal-executor.test.ts` also refuses Python interpreter flags and Python env.

**Live (`ATLAS_LIVE_MODAL=1 pnpm vitest run tests/unit/modal-live-py.test.ts`, one run, 22:37 UTC): 5 of 5
passed.** Files: `python-live-test-output.txt`, `python-live-sandboxes.json`.

| Check | Result on Modal |
|---|---|
| Python control | passed; `executor: "modal"`, backend v2, `Python 3.14.7` (harness and container agree) |
| 2 ordinary functions (a dict total; an async retry with a stand-in that throws, then returns after 250 virtual ms) | the measured result is deep-equal to this Mac's sandbox-exec run, both |
| Network through the harness (`socket.create_connection`, the error caught by the code) | whole-run "can't check" (network/files: socket) |
| A file through the harness (`open('/etc/passwd')`, caught) | whole-run "can't check" (network/files: open(/etc/passwd)) |
| Env through the harness | the code sees only `LC_CTYPE`, which Python sets itself for its locale; no secrets |
| Raw in the container, Python as nobody WITHOUT the harness | uid 65534; DNS fails (`gaierror`); TCP to 1.1.1.1 fails (`OSError`); writing into the run folder fails (`PermissionError`); env only `LC_CTYPE` |
| Forged result line | refused as tampering, "can't check" |
| Endless `while True: pass`, 4 s limit | Atlas stopped it at 4,002 ms: "can't check" (REAL time) |

**Latency:** a warm Python sandbox takes 3.2–4.6 s end to end (the run itself 0.6–0.9 s). The first Python
sandbox in a process took 5.8 s.
- D32's warm-up runs only the JavaScript control. So the first Python paste after a server start needs 2 sandboxes,
  about 9–10 s. Later Python pastes within 10 minutes need one sandbox (D31).
- Warming the Python control as well would cost one more sandbox at startup. Not done; it is a one-line change in
  `runners/executor/warm.ts` if wanted.

**Modal time for this step:** 9 sandboxes, 41.5 s as Atlas measured them (about 0.7 minutes).
- Stopped sandboxes stayed listed for about 30 s, as measured in review round 1 (not billed).
- `sandboxes.list` reached 0 at 22:38:18 UTC. Nothing is left running.

### Full suite after the rebase and hosted Python
- **Result:** 1,111 passed and 35 skipped in clean runs (90 test files plus 2 live-only files that skip). The type
  check is clean (`python-tsc-output.txt` is empty).
- **The skip count moves between 35 and 36:** the GitHub-network test skips when GitHub rate-limits.
- **Some runs hit timeouts, all caused by the machine being overloaded:**
  - The failing tests were the retry-fixture replays, the sweep and the day gate. Each hit vitest's 5-second
    per-test limit.
  - The load average was 44 at the time, from other agents on this machine.
  - The same file passes 10 of 10 on its own, 5 times in a row.
  - None of these tests touch the Python or Modal code.
- See `python-full-suite.txt`. Its count line is in the report to the coordinator.
