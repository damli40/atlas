# G1: invite codes and per-code budgets (D33, D34)

Date: 2026-10-28 (WAT) · $0 (every model mocked; no live Meta, Baseten or Modal call) · Node 25.8.1.

## What this is, in plain words

The hosted Atlas spends Dami's money every time someone uses it: Meta models (Muse Wonder, Muse Spark, Muse Code),
Muse Spark Open on Baseten, Modal sandboxes, and paid RPC reads for Moonwell fork runs. D33 lets a few developers use
the hosted site without being able to drain that money. Four parts:

1. **An invite code per developer.** A long random password (`atlas_` + 32 characters). Atlas never stores the code,
   only a fingerprint of it (HMAC-SHA-256 keyed with a server-side secret, the "pepper"), in a folder outside the repo.
2. **A gate in front of the whole server.** With `ATLAS_REQUIRE_INVITE=1`, a request without a valid code gets HTTP
   401 and a plain sentence, and never reaches the app: nothing is spent, nothing is started.
3. **A budget per code** (D34: $3 a UTC day by default). Before every spend, Atlas holds the most it could cost (its
   "worst case"); after, it replaces that with the real cost. Developers together can only use the spend ceiling minus
   $20, which stays for Dami's own "owner" code (filming).
4. **Everything on disk.** Spend per code per day, the global totals and Modal's daily sandbox counters live in a file,
   so a restart no longer resets them (the known limit of the old in-memory daily caps). Every spend gets one line in
   a spend log, by the code's name (never the code).

## Where to look

- The code: `server/access/` (`gate.ts` the gate and invite page, `store.ts` the codes, `ledger.ts` the budgets,
  `metered.ts` sandboxes and EVM runs, `setup.ts` the env, `context.ts` who is spending); one hook in
  `server/meta/budget.ts`; one line in `server/app.ts` (`clientOf`); wiring in `server/index.ts`.
- The tool: `tools/invites.ts`.
- The tests: `tests/unit/g1-invites.test.ts` (24 tests, output in [test-output.txt](test-output.txt)).
- Full suite 3 times: [full-suite-1.txt](full-suite-1.txt), [-2](full-suite-2.txt), [-3](full-suite-3.txt): 1,357
  passed, 35 skipped each time (was 1,333 passed before G1). `tsc --noEmit`: [tsc-output.txt](tsc-output.txt), exit 0.

## Was Baseten (Muse Spark Open) spend counted before G1? Yes.

I checked `server/meta/client.ts` and the wiring. Muse Spark Open goes through the same `chat()` as Meta's models;
`chat()` prices Baseten's reported tokens with Baseten's price ($1.25 in, $0.15 cached in, $4.25 out per 1M), returns
that usage, and writes a `provider: "baseten"` line to `usage.jsonl`. The bets' chat function is wrapped by the model
budget, so the dollars were added to the $100 ceiling, and the startup total read from `usage.jsonl` includes them.
**What was missing was not Baseten but the worst-case hold:** bet calls (Meta and Baseten alike) were added only after
they finished, so calls running at once could pass the ceiling. G1 holds every call's worst case first. The test
"a Spark Open bet through the real client" proves the Baseten dollars now reach the budget, the code's daily total and
the spend log (real client, fake network).

## Every route, and the test that covers it

The gate is an allow-list: only the read-only routes below stay open; every other route, including any route added
later, needs a code. The test "covers every route the app registers" reads the app's own route list and fails if a
route is neither in the open list nor in the spending table. The test "no code: 401 ..." then sends every spending
route (plus `HEAD`, an unknown route and a made-up code) at a real finished round and checks: 401, the plain message,
and zero model calls, zero sandboxes, zero forks, zero ledger lines.

| Route | What it can spend | Needs a code | Budget check (test) |
|---|---|---|---|
| POST /experiments | Muse Spark and Muse Spark Open bets (Meta, Baseten); chain-facts RPC read | yes | daily budget "not asked" before any call; race; owner reserve; Baseten counted |
| POST /investigate | Muse Wonder Investigator (Meta) | yes | the model budget's guard (same path as every chat call) |
| POST /paste/proposals | Muse Wonder test proposals (Meta) | yes | daily budget, owner reserve, race, code-not-address, revoke |
| POST /outline/jobs | Muse Wonder Outliner (Meta), GitHub reads | yes | the guard (same path); revoke refuses its later spend |
| POST /changes | Muse Code `muse exec` or its chat fallback (Meta) + a replay (sandbox or fork) | yes | guard holds $1.50 for `muse exec` (see limits); sandbox / EVM metering |
| POST /adversary | Adversary (Meta) + model bets + a run | yes | guard + `startExperiment` precheck; sandbox / EVM metering |
| POST /runs | a sandbox (Modal) or an EVM fork (RPC) | yes | Modal worst case; used-up code "did not finish"; EVM 3rd run of the day 429 |
| POST /sweeps | a sandbox | yes | sandbox metering |
| GET /replay/:runId | a re-run from a proof card (sandbox or fork) | yes | sandbox / EVM metering |
| POST /targets | a GitHub read (rate limit, no dollars) | yes (closed by default) | none needed |
| POST /paste | nothing itself (holds the code for later spends) | yes (closed by default) | none needed |
| POST /findings, POST /bets, POST /paste/claim, POST /experiments/:id/model-bets | nothing | yes (closed by default) | none needed |
| GET /health, /claimants, /paste/languages, /events/:id, /proofs/:runId, /outline/jobs/:id[...] | nothing (read only) | **no** | test "the read-only routes stay open" |
| GET /invite, GET /invite/status, POST /invite, POST /invite/forget | nothing | **no** | tests "POST /invite sets ...", "a wrong code ..." |

How each kind of spend is held:

- **Model calls** (all roles): the call's worst case from its prompt (every prompt character counted as a token, plus
  16,000 + 32,000 output tokens at the model's price), checked against the code's day, the code's lifetime total, the
  "at once" limit and the shared ceiling, in one synchronous step, then settled with the usage the API reported.
- **Modal sandboxes**: Modal's own lifetime limit for a sandbox (120 s startup + the run's limit + 30 s) at the capped
  rate, 1 core and 1 GiB: $0.00003942 per core-second + $0.00000667 per GiB-second (modal.com/pricing, "Modal Sandbox
  pricing", read 2026-10-28). A 10 s run holds about $0.0074 and settles at its measured seconds (about $0.0002).
- **Local sandboxes**: $0. Never refused for money; still need a live code.
- **EVM fork runs**: no dollar figure (RPC credits), so counted: 10 per dev code per UTC day by default
  (`ATLAS_INVITE_EVM_RUNS_PER_DAY`), owner unlimited, on top of the existing per-hour gates.

## What the tests prove (24, in `tests/unit/g1-invites.test.ts`)

| Asked for | Test | Result |
|---|---|---|
| Every spending route refuses without a code | "covers every route ..." + "no code: 401 ..." | 15 routes + HEAD + unknown route, with no code and with a made-up code: all 401, nothing spent |
| A code past its budget is refused before the call | "a code past its daily budget is refused BEFORE the call" | proposals and both bet slots "not asked: your invite's daily budget is used up"; 0 calls sent; the person's bet and run still work at $0 (local sandbox, plain-code judge) |
| | "on Modal, a used-up code's run is not started" | 503 "the run did not finish: ... daily budget is used up", no verdicts, 0 sandboxes |
| Owner reserve can't be consumed by devs | "the owner reserve: with $79.50 ..." | dev refused ("the last $20.00 ... is kept for the owner"), owner's call goes through |
| | "the owner reserve holds against many dev codes at once" | 12 calls from 6 dev codes at once on a $5 ceiling with $2 reserve: exactly 3 go through ($2.70 spent ≤ $3); the owner still can |
| Restart keeps counters | "per code per day, the global totals and Modal's daily sandbox counters are read back" | after a new ledger on the same folder: $2.50 still spent, next call refused; Modal 2 of 2 starts still counted |
| | "a spend still open when the server stopped" | counted at its $1.25 worst case after the restart, with a log line saying why |
| Concurrent requests can't overshoot | "race: 20 requests at once on one $3 code" | at most 3 Wonder calls sent, today's spend ≤ $3; an "at once" limit of 2 lets exactly 2 of 5 through |
| IPv6 /64 and X-Forwarded-For don't matter | "new IPv6 /64s and X-Forwarded-For hops give a code nothing extra" | with a code, a new /64 or a made-up first hop gets no new allowance; a second code has its own; with invites off, the old per-address rule is unchanged |
| Revoked code stops immediately | "revoked with the tool ... while the server runs" | the next request is 401 "that invite code was revoked"; a spend queued under it is refused; other codes work |
| Baseten counted | "a Spark Open bet through the real client" | Baseten URL called once; budget, code total and spend log all equal `costUsd(Spark Open, 3000, 1000, 1000 cached)` |
| Spend log per code, never the code | "a whole pasted round on a $3 dev code" | log lines carry label, id, route, model, dollars, hold; no code in any file; files mode 600 |
| The tool | "create shows the code once ...", "a pepper or store file others can read is refused" | code printed once, only its fingerprint stored, folder 700 and files 600, list shows no code or fingerprint, usage sums by name, revoke works |
| Defence behind the gate | "a sandbox or a model call outside any invite is refused" | with invites required, the ledger itself refuses a spend with no code; the server's own warm-up is allowed |

**Do the tests bite?** With the ledger switched off in `server/meta/budget.ts` (one line), 7 of the 24 fail. Re-run,
then restored.

The real server was also started once with `ATLAS_REQUIRE_INVITE=1` and a temporary store: `/health` 200, `POST /paste`
without a code 401 with the message, with the code 200, `/invite` 200 (models off, local executor, $0).

## How to make codes for developers

On the machine that runs the server (the store is read from `ATLAS_INVITES_DIR`, default `~/.config/atlas/`):

```sh
pnpm tsx tools/invites.ts create --name dami --owner          # Dami's own code: no daily cap, may use the $20 reserve
pnpm tsx tools/invites.ts create --name ada                    # a developer: $3 a UTC day
pnpm tsx tools/invites.ts create --name bo --daily-usd 2 --total-usd 10
pnpm tsx tools/invites.ts list                                 # names, budgets, today's spend, revoked or not
pnpm tsx tools/invites.ts usage                                # today's spend per name, by route and model
pnpm tsx tools/invites.ts revoke ada                           # takes effect on the next request
```

`create` prints the code **once**. Send it privately; Atlas cannot show it again (revoke and make a new one). The
first `create` also makes the pepper file (mode 600) unless `ATLAS_INVITE_PEPPER` is set. A developer opens
`/invite` on the API (behind the Vite proxy: `/api/invite`), types the code, and the browser keeps it in an HttpOnly,
SameSite=Strict cookie for 30 days; scripts can send the `x-atlas-invite` header instead.

## How to turn it on for the host

Set on the hosted server:

- `ATLAS_REQUIRE_INVITE=1` (only `1` turns it on; `0` or unset is off; any other value stops the server, so a typo
  can never mean "off").
- `ATLAS_INVITES_DIR=<a private folder that survives restarts>` (for example a mounted volume). The server stops at
  startup if invites are required and there is no pepper or no active code.
- Either copy the pepper file there, or set `ATLAS_INVITE_PEPPER` (32+ characters) as a host secret. Make the codes
  with the tool against the same folder and pepper.
- Optional: `ATLAS_OWNER_RESERVE_USD` (20), `ATLAS_SPEND_CEILING_USD` (100), `ATLAS_INVITE_EVM_RUNS_PER_DAY` (10),
  `ATLAS_INVITE_COOKIE_SECURE=1` to always mark the cookie Secure (by default it is Secure when the request came over
  HTTPS, including `X-Forwarded-Proto: https` with `ATLAS_TRUST_PROXY=1`).
- At startup the server prints "invite codes required: N active". If `ATLAS_EXECUTOR=modal` is set without invites
  it prints a warning that anyone can spend.

## What Dami must still set by hand (Atlas cannot do these)

Atlas's limits only cover spend that goes **through Atlas**. A leaked API key bypasses all of it, so set
account-level limits too:

- **Meta** (api.meta.ai): a spend limit or alert on the key's account below the $150 credit.
- **Baseten**: a billing limit or usage alert on the account the Spark Open key belongs to.
- **Modal**: a workspace budget (modal.com/docs/guide/budgets). Modal's pricing page says a workspace budget limits
  monthly spend; its plan table lists "environment-level budgets" for Team and up only. I did not check which
  Modal plan Dami's workspace is on.
- **The RPC provider** used by `BASE_RPC_URL`: a daily request or credit cap, since EVM runs are counted, not priced.

## Known limits (logged, not fixed)

1. **`muse exec` has no worst case Atlas can compute.** Muse Code runs several steps inside its own CLI, so the
   guard holds a fixed $1.50 and settles with what `muse exec` reports. A run that really costs more than $1.50
   could take a code over its daily budget by the difference. Chat calls are exact upper bounds.
2. **The worst case is pessimistic.** A Muse Spark bet holds about $1.00 while it runs and usually costs about $0.02,
   so a $3 code can have about 3 Spark calls in flight at once, and stops asking when less than $0.96 is left even if
   the next call would have been cheap.
3. **Calls per hour and experiments per session** (the old S5 limits) are still in memory and reset on restart. The
   money limits do not.
4. **One server process per store.** The ledger file is written by one process; two servers sharing one folder could
   each allow a spend the other already held. The hosted setup is one process.
5. **Modal spend counts toward the same ceiling as model spend.** It is a different account, but counting it is the
   safe side; it is about $0.0002 a run.
6. **A spend that throws** (the network dropped after the API billed it) is settled at $0 because Atlas cannot see the
   bill, the same rule as before G1. The account-level limits above are the backstop.
7. **The web page does not yet link to `/invite` or explain a 401** (the X2 batch owns `web/`). Today the page shows
   the server's error text, which says where to enter the code.
8. **POST /experiments reads chain facts over RPC** (once per fork block, cached) for any code; it is not counted per
   code.
