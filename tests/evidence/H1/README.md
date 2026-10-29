# H1: hosting Atlas on Fly.io (D52)

Date: 2026-10-29 (WAT) · $0 (no model call, no Modal sandbox, no Fly command run) · Node 25.8.1 · Docker is not
installed on this Mac, so the image itself was never built here (see "Not verified").

## What this is, in plain words

Atlas now has everything it needs to run as one website on Fly.io, and Dami runs about ten commands to put it there
(`tools/fly-setup.md`). Four parts:

1. **One address for the page and the API.** In development, Vite shows the page and forwards `/api/...` to the
   server. In production the server does both itself: the built page at `/`, the API under `/api`, `/health` for Fly.
   One address matters because the invite cookie is only trusted on requests from Atlas's own page (G1 review B5).
2. **A server that refuses to start in an unsafe state.** With `ATLAS_HOSTED=1` (set in `fly.toml`) it stops, with
   one plain line per problem, unless invite codes are on, the address is https and matches the Fly app, every pasted
   run goes to Modal and the Modal token is there, the codes and spend counters are on the mounted volume, the
   visitor's address is read from Fly's own header, and the built page exists. A second server on the same store is
   still refused by G1's lock.
3. **A setup mode for the very first start.** The full server refuses to start without an invite code, and the code
   has to be made on the machine. So on the first start (every check passes, no code yet) it only answers `/health`
   and refuses everything else (503). Dami makes the owner code over `fly ssh console`, then restarts.
4. **The deploy files.** A Dockerfile Fly builds on its own servers, an allow-list `.dockerignore`, `fly.toml`, a
   secrets script that never prints a value, the setup guide, and a smoke test for after the deploy.

## Where to look

- The server: `server/hosting.ts` (checks, page serving, setup mode, summary line), `server/host.ts` (the container's
  entry: setup mode or the full server), `server/index.ts` (runs the checks first, serves the page when hosted),
  `server/client-ip.ts` (the Fly-Client-IP rule), `server/meta/roles/fixer.ts` (chat directly without sandbox-exec).
- The deploy files: `Dockerfile`, `.dockerignore`, `fly.toml`, `tools/fly-entrypoint.sh`, `tools/atlas-invites.sh`.
- For Dami: `tools/fly-setup.md` (the commands in order), `tools/fly-secrets.sh`, `tools/smoke-hosted.ts`.
- The tests: `tests/unit/h1-hosting.test.ts` (47 tests after the review; output in [test-output.txt](test-output.txt)).
- The local trial of the hosted server: [local-trial/](local-trial/) (below).

## Decisions I made (Dami can change any)

| What | Choice | Why |
|---|---|---|
| Region | `lhr` (London) | Lagos's subsea cables land in Europe, so Europe is the short path; London is also a short hop to the US services every run calls (Meta, Modal, Baseten, the RPC). `jnb` is in Africa but farther from Lagos by network. Not measured. |
| Idle stop | Off (`auto_stop_machines = "off"`, `min_machines_running = 1`) | Sessions, live logs, kept runs and outline jobs live in memory; Modal is warmed at start (D32); the Moonwell PR is read at start. A stop loses all of that. |
| One machine | One volume + `fly deploy --ha=false` + rolling deploys | A machine with a volume needs its own volume, so one volume means one machine. Rolling stops the old process before the new one starts. G1's lock refuses a second process on the same disk. |
| Size | `shared-cpu-1x`, 2 GB, 512 MB swap | An anvil fork plus an outline job is the biggest load; not measured. About $12–14 a month (Fly lists $6.70 for 1 GB in `iad`, about $5 per extra GB, London a little more). 1 GB saves about $5 if it proves enough. |
| Visitor's address | `ATLAS_CLIENT_IP_HEADER=fly-client-ip` | Fly's docs: the right-most `X-Forwarded-For` entry on Fly is the app's own address, so the old rule (`ATLAS_TRUST_PROXY_HOPS=1`) would have counted every visitor as one. `Fly-Client-IP` is the address Fly accepted the connection from. |
| Invite pepper | Made fresh by `tools/fly-secrets.sh` the first time, then kept | The brief said "from the local config files", but this Mac has no pepper file (`~/.config/atlas/` holds no `pepper`; local invites are off). A fresh one is also better: the host's codes share nothing with local ones. Re-running the script keeps the app's pepper, so handed-out codes keep working. |
| Refusal records | `ATLAS_PROOFS_DIR=/data/proofs` | The image's `/app` is read-only to the server's user. `.atlas.json` files stay in memory (publishing is off), and the committed proofs are not served from that folder, so nothing is lost. |
| Muse Code on Linux | The fixer asks the muse-spark-1.3 chat directly | `muse exec` needs macOS sandbox-exec. Before this change the Linux server would first try a muse exec preflight, hold muse exec's worst case against the person's budget, fail, and log "Muse Code gave no answer". Now it goes straight to the chat, and the startup line says so. |
| Linux without Modal | Refused at start | Pasted Python runs only inside macOS sandbox-exec locally, so on Linux `ATLAS_EXECUTOR` must be `modal`. Verified: with Modal, every Python run goes to Modal (`pythonExecutorFor` returns the Modal executor), and nothing else on the server path runs Python. |
| App name | `atlas-dami` | It is the public address. Change `app` and `ATLAS_PUBLIC_ORIGIN` together; the server refuses to start if they disagree. |

## What I verified on this Mac

**Tests.** 44 new tests ([test-output.txt](test-output.txt)), among them:
- every startup refusal, one case each, and that `fly.toml`'s own `[env]` plus the secrets passes every check (so the
  shipped config cannot refuse itself);
- setup mode is chosen only when it should be (a revoked code does not count), answers `/health`, and is 503 elsewhere;
- one origin with the real G1 gate: 401 without a code, the invite page and sign-in under `/api`, the cookie Secure +
  HttpOnly + SameSite=Strict, a cross-site POST 403, a same-site other-origin POST 403, and a whole pasted round
  (mocked models) through `/api` with its proof card;
- static files: hashed assets cached, `index.html` never cached, a page path gets the page, and `/.env`, `/.git/config`,
  encoded `..` paths and missing assets are 404; no answer can be framed by another site;
- Fly-Client-IP: read instead of `X-Forwarded-For`, the last value wins if a visitor adds their own, IPv6 grouped by /64;
- the fixer with no OS sandbox only ever asks `muse-spark-1.3` and holds nothing for muse exec;
- the deploy files: the Dockerfile's Node version and SHA-256 equal E4's Modal image, every download is checked, the
  base is pinned by digest, no Python; the entrypoint's privilege drop is also run at build time; `.dockerignore`
  keeps `docs/`, `pitch/`, `CLAUDE.md`, `.git`, `.env` and the store files out;
- `tools/fly-secrets.sh` with fake config files and a fake `fly`: the right values reach `fly secrets import` through
  stdin only (never in a command's arguments, never on screen), the wrong Modal profile is skipped, an existing pepper
  is kept, a missing file stops it before `fly` is called at all.

Full suite: **2,060 passed, 0 failed, 35 skipped** ([full-suite.txt](full-suite.txt)). `tsc --noEmit`: exit 0
([tsc-output.txt](tsc-output.txt)).

**The build steps, without Docker.** I copied exactly what the Docker build context holds (checked with
`@balena/dockerignore`, a port of Docker's own matcher: [docker-context.txt](docker-context.txt), 0 forbidden files),
then ran the Dockerfile's steps on that copy: `pnpm install --frozen-lockfile` + `vite build` (the page stage) and
`pnpm install --frozen-lockfile --prod` (only `hono`, `@hono/node-server`, `modal`, `nanoid`, `react`, `react-dom`,
`tsx`, `typescript-api`, `viem`, `zod`; no vite or vitest). The Foundry tarball's SHA-256 matched three ways (my
download, the release's `.sha256` file, GitHub's asset digest); Node's is E4's; pnpm's sha512 is the npm registry's.

**The hosted server, started locally from that copy** ([local-trial/](local-trial/)). Hosted mode on this Mac, with a
small disk image mounted as the "volume" (macOS has no other writable mount point), a fake Modal token, a scratch
pepper and store, every model role off, and a scratch HOME so no real key file was found. $0.
1. Setup mode: `/health` 200 with `setup: true`; `/` and `/api/paste` 503; nothing written to the volume
   ([1](local-trial/1-setup-mode-log.txt), [2](local-trial/2-setup-mode-probes.txt)).
2. Owner code made with the invite tool against the same store ([3](local-trial/3-owner-code-created.txt), code
   redacted).
3. Full start: the one-line summary, the Fly-Client-IP rule, the page from `dist/`, and Modal's warm-up failing as
   expected with the fake token without stopping the server ([4](local-trial/4-hosted-start-log.txt)).
4. `tools/smoke-hosted.ts` against it ([5](local-trial/5-smoke-local-trial.txt)): checks 1–9 PASS (health, the page and
   its script, no framing, 401 without a code, the invite page, sign-in, the Secure cookie, cross-site 403, Modal
   executor). Two FAIL, as they must here: the real-model round (models were off) and the forge check (there is no Fly
   proxy locally, so a forged `Fly-Client-IP` IS believed; this shows the check can tell the two apart).
5. Probes ([6](local-trial/6-probes.txt)): 30 wrong codes from one `Fly-Client-IP` with a different
   `X-Forwarded-For` each → the 31st is 429 (so `X-Forwarded-For` is ignored); another address still gets 401; the
   path table above; the live log streams through `/api` as `text/event-stream`; a second server on the same store is
   refused; after SIGINT the lock file is gone.
   The invite code never appears in any output (checked with a pattern search).

## Not verified (only after the deploy, or not at all)

- **The image was never built.** Docker is not installed here, so the first real build is Fly's remote builder. Steps
  that only run there: `apt-get`, the checksum checks, `setpriv` (the build runs the exact drop once and fails if the
  user id is wrong), and the copied `node` binary on Debian. If the build fails, `fly deploy` prints which step.
- **`fly ssh console` sessions see the app's env and secrets.** A Fly community thread says they do; I did not test it.
  If not, `atlas-invites` refuses with "ATLAS_INVITE_PEPPER is not set" instead of making a code that would not work.
- **Fly replaces a visitor's `Fly-Client-IP`.** Fly's docs say the proxy sets it; I could not test a real Fly proxy.
  The smoke test's opt-in forge check (`ATLAS_SMOKE_FORGE_CHECK=1`) tests exactly this after the deploy.
- **Memory.** 2 GB is a guess for an anvil fork of Base plus an outline job.
- **Latency from `lhr`.** Not measured, for visitors or for the calls to Meta, Modal and Baseten.
- **One real round on Modal from Fly** (E4 measured Modal from this Mac). The smoke test does it, for about $0.05.
- (`fly.dev` on the Public Suffix List: confirmed by the review, line 13718 of the list.)

## Host rules this adds (to G1's "How to turn it on")

`ATLAS_HOSTED=1`, `ATLAS_VOLUME_DIR` (default `/data`), `ATLAS_USAGE_PATH` on the volume, `ATLAS_CLIENT_IP_HEADER=fly-client-ip`
with `ATLAS_TRUST_PROXY=1`, and `ATLAS_EXECUTOR=modal` on any machine without macOS sandbox-exec. All are set in
`fly.toml`; the secrets come from `tools/fly-secrets.sh`. `ATLAS_SERVE_PAGE=1` serves the built page locally too (the same code path; not started on its own).

## Review round 1: 0 blockers, 0 majors, 9 minors

Fixed (4, the cheap security-adjacent ones):

| # | What broke | Fix | Test |
|---|---|---|---|
| m1 | A symbolic link inside `dist/` served the file it points to, even outside `dist/` (not reachable today: `vite build` makes no links) | The file's REAL path must also be inside `dist/`; a link that stays inside still works | "review m1: a symbolic link inside dist/ never serves a file or folder outside it" |
| m2 | `TRACE /api/...` gave 500 and a stack trace in the logs (anyone could fill `fly logs`) | Any method other than GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS gets 405 with an `Allow` header, on `/api`, `/health` and page paths, before anything else runs | "review m2: TRACE and other unusual methods get 405 ..." (over a real socket: in-process, `new Request` itself refuses TRACE) |
| m5 | Nothing stops Dami from starting a second machine (its own volume, ledger and $100 ceiling) | A warning in `tools/fly-setup.md` step 9: never `fly scale count` above 1, never `fly machine clone` | (docs) |
| m8 | `tools/fly-secrets.sh` relied on flyctl staying quiet; with debug logging on, flyctl might print its requests | The script unsets `LOG_LEVEL`, `FLY_LOG_LEVEL` and the other debug switches (names only) before calling flyctl, and drops flyctl's stderr on the import; a failure prints one plain line | "review m8: flyctl's debug switches are turned off, and its stderr never reaches the screen" (a fake flyctl that echoes its input to stderr and fails) |

After the fixes: full suite **2,063 passed, 0 failed, 35 skipped** ([review1-full-suite.txt](review1-full-suite.txt)); `tsc --noEmit` exit 0 ([review1-tsc-output.txt](review1-tsc-output.txt)); the H1 tests: [review1-test-output.txt](review1-test-output.txt). $0.

## Known limits (logged, not fixed)

1. **(m3) The security policy header only blocks framing.** `Content-Security-Policy` is `frame-ancestors 'none'`.
   The cookie is HttpOnly, so an injected script could not read the code, but it could spend with it (a same-origin
   request carries the cookie). The review found no injection point. A fuller policy (`default-src 'self'` and so on)
   would need a check that the built page and the invite page still load under it.
2. **(m4) A full volume fails closed but can get stuck.** If the disk is full, a reservation throws before any money
   moves (good), but the reservation stays in memory until a restart, and a failing settle in a background job could
   end the process; the restart might then fail on the same full disk. An outage, never extra spend. 1 GB holds the
   JSON lines for a very long time. From reading the code; not tested.
3. **(m6) The entrypoint runs `chown`/`chmod` as root on the store folder.** If something running as `atlas` swapped
   `/data/atlas` for a symbolic link, the next boot would change the permissions of wherever it points. It needs code
   already running as `atlas` on the host; no visitor code runs there (it all goes to Modal).
4. **(m7) Debian packages are not pinned to versions.** The base image is pinned by digest and every download by
   checksum, but `apt-get install` takes the current `ca-certificates`, `curl`, `xz-utils` and `libatomic1`. They come
   from Debian's signed repository, so this affects reproducibility, not trust.
5. **(m9) The guide's hidden prompt for the code is zsh syntax.** Dami's shell is zsh. The line now also shows the bash
   form in a comment.
