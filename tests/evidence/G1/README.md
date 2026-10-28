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

1. **`muse exec`'s worst case is an assumption.** (Changed in review round 1: it was a fixed $1.50.) The hold is now
   steps × (workspace and prompt bytes + 32,000 tokens in, 16,000 out) at Spark's price, about $3.17 for 6 steps on
   20 KB. That is a guess about muse's insides, not a measurement. A killed run is counted at this hold.
2. **The worst case is pessimistic.** A Muse Spark bet holds about $1.00 while it runs and usually costs about $0.02,
   so a $3 code can have about 3 Spark calls in flight at once, and stops asking when less than $0.96 is left even if
   the next call would have been cheap.
3. **Calls per hour and experiments per session** (the old S5 limits) are still in memory and reset on restart. The
   money limits do not. (Since review round 1 they are counted per code, and the owner has its own.)
4. **One server process per store, one container only.** (Review round 1: now enforced on one disk by a lock file.)
   Two containers on two disks (an autoscaled Modal endpoint with a copied volume) would still each keep their own
   ledger. Host on exactly one process.
5. **Modal spend counts toward the same ceiling as model spend.** It is a different account, but counting it is the
   safe side; it is about $0.0002 a run.
6. **(Fixed in review round 1; it was wrong.)** I wrote that a call that throws is "settled at $0, the same rule as
   before G1". The review showed a dev can cause that on purpose (timeouts) and spend without limit. Such calls are
   now counted at their worst case.
7. **The web page does not yet link to `/invite` or explain a 401** (the X2 batch owns `web/`). Today the page shows
   the server's error text, which says where to enter the code.
8. **(Fixed in review round 1.)** The chain-facts read now counts as one EVM run of the invite, and a failed read is
   cached for 60 s.
9. **Midnight UTC.** Budgets are per UTC day, so across 00:00 UTC one code can spend up to $3 before and $3 after
   within a minute (review m1). Logged, not changed: D34 says "$3/day".
10. **A normal timeout now costs the person.** Since a timed-out call is counted at its worst case (about $1 for a
   Spark bet), a slow Meta day uses up a $3 code after about 3 timeouts. That is the price of the B1 fix.

## Review round 1 (the "drain the credits or block Dami" review): 5 blockers, 5 majors, 7 minors

The review (`review1-poc.mts.txt`; output before: [review1-poc-before.txt](review1-poc-before.txt), after:
[review1-poc-after.txt](review1-poc-after.txt)) found two real ways in: a dev could spend without limit by making
calls time out, and a dev could lock Dami out for hours at a cost of cents. All fixed; tests in
`tests/unit/g1-review1.test.ts` (22 tests; 4 of them fail when the B1 and session fixes are taken out again).

**Worst case per dev code per UTC day, now:** $3.00 of model and sandbox spend (chat calls are exact upper bounds:
prompt bytes + full output room), plus at most $3 more across the midnight boundary (m1), plus whatever `muse exec`
costs above its assumed hold (limit 1). On the review's attack the code stopped at **$2.40 recorded, 2 requests sent**
(it was $0.00 recorded and 200 sent). Before: no limit (about $90-550 a day by the review's estimate).

| Finding | What was wrong | Fix | Test |
|---|---|---|---|
| **B1** | A timed-out call was recorded at $0 and its hold released; a dev could repeat it all day | A call sent but with no reported usage (timeout, network error, 5xx/408, non-JSON body, 200 without usage, a throw) is counted at its full hold, in the code's ledger AND the global ceiling. Only a call proven not sent is $0; a 4xx is $0 | "the review's attack ... stops at about $3", "per outcome", "a call that THROWS" |
| **B2** | One global "60 calls an hour" counter; a dev used it up for $0.18 and Dami was refused | Calls an hour per spender: each dev code a quarter (15), devs together the 60, the owner its own 60. Experiments per session counted per spender AND session (a dev sending Dami's session id uses only its own) | "a dev uses up its share of calls ...", "a dev who sends the owner's session id" |
| **B3** | Modal's daily starts and seconds were global; a dev used them up for $0.33 | Per dev code: 150 starts and 900 sandbox-seconds a day; devs together 80% of the caps; the owner and the warm-up may use the rest; devs together hold at most 3 sandboxes at once (the executor runs 4). The Modal executor's own in-memory daily cap is lifted in `server/index.ts`; the ledger's on-disk caps rule | "a dev uses up its own daily seconds (the review's 720-run attack)", "devs together stop at 80%", "devs together hold at most 3", "restart" |
| **B4** | Prompts counted in UTF-16 characters; CJK and emoji undercount | Prompt tokens counted as UTF-8 bytes (`promptTokensUpperBound`), a true upper bound, in every hold and in the $2 / $2.50 per-call cost caps. The investigator's and outliner's token estimates still use characters, but only for "low/medium" effort and the outline size cap; the money bound is the byte-based guard | "CJK and emoji count by bytes" |
| **B5** | A cookie-only `text/plain` POST reached the app; only SameSite=Strict stood in the way, which fails on a shared parent domain like `*.modal.run` | A cookie-signed POST, or a cookie-signed `GET /replay`, must carry `Sec-Fetch-Site: same-origin` or an `Origin` equal to `ATLAS_PUBLIC_ORIGIN`, else 403. Every spending POST must be `application/json` (else 415). The server refuses to start with invites required and no `ATLAS_PUBLIC_ORIGIN` | "cookie-only POSTs and GET /replay are refused cross-site", "spending POSTs must be JSON", "required but no code set up" |
| **M1** | A killed `muse exec` recorded $0; $1.50 was not a real bound | A killed or failed run is counted at its hold; the hold is computed from the workspace size and the step limit (an assumption, limit 1); the fixer's chat fallback holds its exact worst case | "a killed muse exec ..." |
| **M2** | 4 outline slots for the whole server, the owner not exempt | One running job per dev code; devs together leave the last slot for the owner | "a dev's second running job is refused ... the owner's job still starts" |
| **M3** | EVM run and replay gates and the sandbox gate were shared; one held replay slot blocked Dami | The owner's code goes through its own copy of each gate | "devs use up the shared hourly runs ...", "the sandbox gate too" |
| **M4** | 30 bad codes from anyone locked every new sign-in for an hour | The code is checked first; only failures are limited (30 per address, 300 overall, an hour); a correct code is never refused | "a wrong code ... a correct code still works" |
| **M5** | Two processes on one store multiply every budget | `server.lock` with the pid: a second server on the same store refuses to start; a lock left by a dead process is taken over. Docs: one container only | "a second lock on the same store is refused" |
| m1 | Midnight UTC doubles a burst | Logged (limit 9) | |
| m2 | Chain-facts reads not counted; failures retried every time | Counted as an EVM run of the invite; failure cached 60 s | "a chain-facts read counts as one EVM run" |
| m3 | Cross-site sign-in and sign-out | Same own-page check on POST /invite and /invite/forget | "sign-in and sign-out from another site are refused" |
| m4 | Secure cookie flag only "auto" | Always Secure when `ATLAS_PUBLIC_ORIGIN` is https | "with an https public origin the cookie is Secure" |
| m5 | `!/tools/` published the whole folder; the store could sit in the repo | Only `tools/invites.ts` is public; `pepper`, `invites.json`, `spend.json`, `spend-log.jsonl`, `server.lock` ignored anywhere; server and tool refuse a store inside the repo | "a store folder inside the repo is refused" |
| m6 | A deleted `spend.json` silently restarted every counter | The tool writes `spend.json` with the first code; the server refuses codes without a ledger; `tools/invites.ts ledger-init` makes one only on purpose | "codes but no spend.json" |
| m7 | Split host: the cookie never reaches the API | Now a rule: one origin for the page and the API (below) | |

**PoC5 after:** "the owner's correct POST /invite → 403" is the new own-page rule (the script sends no
`Sec-Fetch-Site`), not the lockout. A browser on Atlas's page sends `Sec-Fetch-Site: same-origin`; the M4 test shows a
correct code passes after 30 failures.

**Changed on the host (adds to "How to turn it on"):**
- `ATLAS_PUBLIC_ORIGIN=https://<the one origin>`: required with `ATLAS_REQUIRE_INVITE=1`. **Serve the page and the API
  from this one origin** (the API under a path such as `/api`), never from two hosts, and never on a shared parent
  domain that is not on the Public Suffix List, such as `*.modal.run`: another tenant there counts as the "same site".
  Use your own domain, or a host whose domains are on the list.
- **Run exactly one server process** (on Modal: one container, `min_containers=1`, `max_containers=1`). The lock file
  stops a second process on the same disk, not one on another disk.

Full suite 3 times after review round 1: [review1-full-suite-1.txt](review1-full-suite-1.txt),
[-2](review1-full-suite-2.txt), [-3](review1-full-suite-3.txt): 1,379 passed, 35 skipped each time.
`tsc --noEmit`: [review1-tsc-output.txt](review1-tsc-output.txt), exit 0. Tests: [review1-test-output.txt](review1-test-output.txt). $0.

**Not done / unsure:** the server's wiring of the lifted Modal executor caps, the owner gates and the chain-facts meter
is in `server/index.ts`, which no test starts (the same pieces are tested one by one). I did not re-check the reviewer's
one extra skipped test (1,356 / 36 on their machine). The review's dollar figures for the old attack are its own
estimates; I did not measure what Meta bills for an abandoned request.
