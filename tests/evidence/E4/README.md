# E4: the Modal executor (hosted runs of pasted code in throwaway cloud containers)

Date: 2026-10-27 (WAT) · no model call · Modal sandbox time for the whole batch ≈ 2.5 minutes (under $0.05).

## Where to look first

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
  native speed-up, and `protobufjs`, a version notice). Both scripts are refused in `pnpm-workspace.yaml`. The SDK
  works without them; the live suite ran that way.
- **Loaded only when needed.** The SDK loads when the first sandbox is made, so a server on the local executor
  never loads it.

## What the boundary is, layer by layer

Each layer would stop pasted code on its own. Together they are "defence in depth": if one layer has a hole,
the next one still holds. The file is `runners/executor/modal.ts`.

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

## Cost per run (estimate from Modal's published prices, not from a bill)

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
Modal's dashboard bill was not checked.

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

## Open choices (not done here; each one changes the demo)

1. **Cache the call-function control once per harness, not once per pasted file.**
   - **Why it is safe:** the control checks Atlas's own measuring code (its run names the reference file, not the
     pasted code). So the same result is valid for every paste.
   - **What it saves:** one sandbox per paste. A first pasted run on Modal would take about 3.5–4.5 s instead of
     7–9 s.
   - **Why not done here:** it changes the server's control rule, so the decision belongs outside E4.
2. **Warm the server at startup with one throwaway exec**: it loads the SDK and checks Modal is reachable. That
   moves the ~3 s first-run cost off the first visitor, and the startup line can say "Modal reachable" or why not.

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
- **Modal's v1 sandbox backend is used** (`sandboxes.create`). The SDK's "experimental V2 backend" was not tried.
- **Modal's own environment variables** (region, task id, image id) exist in the container. `env -i` keeps them
  from the command, and their values were never read.
- **No separate adversarial reviewer has looked at E4 yet.** The spec plans one per batch.
