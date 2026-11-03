# Hosting Atlas on Fly.io (D52)

This is the order Dami runs things in, once. Every command runs from the Atlas repo folder on the Mac. Nothing here
prints a key; the only secret that ever appears on screen is the owner invite code, once, in step 7.

**What you end up with:** one Fly machine in London (`lhr`) that serves the page and the API from one address,
`https://atlas-dami.fly.dev`. Every pasted run goes to a throwaway Modal sandbox. Invite codes are required. The codes,
spend counters and track records live on a 1 GB volume that survives deploys and restarts.

## Before you start: pick the app name

The name becomes the public address (`https://<name>.fly.dev`). This guide uses `atlas-dami`. If Fly says the name is
taken, pick another and change it in **two** lines of `fly.toml`: `app = "..."` and `ATLAS_PUBLIC_ORIGIN = "https://....fly.dev"`.
If the two disagree, the server refuses to start and says so (its own-page check would refuse every visitor).

## The commands, in order

```sh
# 1. Install flyctl (Fly's command-line tool).
brew install flyctl

# 2. Make an account (opens the browser), or log in if you already have one.
#    Fly needs a credit card on file after the free trial (2 hours of machine time or 7 days).
fly auth signup        # new account
fly auth login         # existing account

# 3. Create the app (the name is the address).
fly apps create atlas-dami

# 4. Create the ONE volume. One volume means Fly can only ever attach one machine, which is what the spend ledger needs.
fly volumes create atlas_data --app atlas-dami --region lhr --size 1 --yes

# 5. Check, then send, the secrets (Meta, Baseten, Base RPC, Modal token, and a new invite pepper).
#    --check reads the local files and sends nothing. The second command sends them through stdin; no value is printed.
sh tools/fly-secrets.sh --check
sh tools/fly-secrets.sh

# 6. Build on Fly's servers and start. --ha=false: one machine, not Fly's default spare.
#    The first build takes several minutes. The first start is SETUP MODE (there is no invite code yet).
fly deploy --remote-only --ha=false
fly logs --app atlas-dami --no-tail      # look for the line that starts "SETUP MODE"

# 7. Make your owner code ON the machine. It is printed once, here, in your terminal: save it in your password manager.
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites create --name dami --owner"

# 8. Restart, so the full server starts now that a code exists.
fly apps restart atlas-dami
fly logs --app atlas-dami --no-tail      # look for the line that starts "hosted:" and "Modal warm-up"

# 9. Confirm there is exactly one machine.
#    WARNING: never run `fly scale count` above 1, and never `fly machine clone`. A second machine gets its own new
#    volume, so its own spend ledger and its own $100 ceiling, and about half the visitors would land on it (503).
fly status --app atlas-dami

# 10. Smoke test (spends about $0.05 of real model calls). Type the code at the prompt; it stays out of your history.
read -rs "ATLAS_SMOKE_INVITE?Invite code: "; export ATLAS_SMOKE_INVITE; echo   # zsh; in bash: read -rsp 'Invite code: ' ATLAS_SMOKE_INVITE
pnpm exec tsx tools/smoke-hosted.ts https://atlas-dami.fly.dev
# Once, also check that a visitor cannot forge their address (your address then cannot try a WRONG code for an hour):
ATLAS_SMOKE_FORGE_CHECK=1 pnpm exec tsx tools/smoke-hosted.ts https://atlas-dami.fly.dev
unset ATLAS_SMOKE_INVITE
```

Then open `https://atlas-dami.fly.dev/api/invite` in the browser, paste your code, and go to `https://atlas-dami.fly.dev`.

## Codes for developers

Each command runs the invite tool on the machine. A new or revoked code takes effect on the next request; no restart.

```sh
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites create --name ada"     # $3 a UTC day (D34); printed once
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites list"
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites usage"
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites revoke ada"
```

Send each code privately. A developer opens `https://atlas-dami.fly.dev/api/invite` and pastes it.

## The open example, the waitlist and the judge code (R10, D72)

Anyone can play the first screen's example with no code: its AI answers are recorded, so no AI is asked, and only the
example's own code runs in the sandbox. Everything else (their own code, the sample files, "Try another question", the
repo outline) still needs a code, and the page then offers "Join the waitlist" and "I have a code".

```sh
# 1. The waitlist link: your Tally or Google Form. It must start with https:// (anything else stops the server at start;
#    unset means no link is shown). Atlas only links to it and stores no email.
fly secrets set ATLAS_WAITLIST_URL="https://tally.so/r/XXXXXX" --app atlas-dami   # setting a secret restarts the machine

# 2. One shared judge code, made ON the machine and printed once here. Put it in the submission form (Testing
#    instructions) and say in README "Test me" where it is. The owner's $20 is kept.
#    R12 (D73): $10 a UTC day, not the $3 of a dev code. Every model call in flight HOLDS its worst case (about $0.33 for a
#    pasted file) until it settles, and one file asks for a summary, names and a test at once (about $1 held). Several
#    judges sharing one code at $3 would be refused "budget used up" while far less was really spent. Real spend is a few
#    cents a file. It comes out of the developers' share of the ceiling, never your $20 reserve.
#    R16 (review B2): --max-concurrent 20, not the default 4. One code may have only that many model calls and sandboxes
#    running at once, counted for everyone on the code: one pasted file starts a summary, names and a test together, so
#    two judges pasting at the same moment hit 4 and saw "this invite code is at its "at once" limit". Each judge's
#    browser is still its own person for questions, picks and the track record; money and limits stay per code.
#    One code still holds at most 2 sandboxes at once; all codes together hold ATLAS_DEV_SANDBOXES_AT_ONCE (fly.toml: 6).
#    The code is public, so anyone could make up browser ids: only the first 50 browsers on a code get a record of their
#    own (ATLAS_BROWSERS_PER_CODE, default 50; kept on the volume, so a restart keeps the count). Later browsers on that
#    code share one overflow record, and the record page says so. Other codes' records are never pushed out by it.
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites create --name judges --daily-usd 10 --max-concurrent 20"
#    Watch it with:
fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites usage --name judges"

# 3. Check: open https://atlas-dami.fly.dev in a private window (no code): the example plays to a verdict.
fly logs --app atlas-dami --no-tail      # look for the line that starts "open example:"
```

Limits on the no-code example (optional; the defaults are shown). Set them the same way (`fly secrets set ...`); an
invalid value falls back to the default.
- `ATLAS_EXAMPLE_RUNS_PER_IP_PER_HOUR=10`: runs an hour per visitor address (Fly-Client-IP).
- `ATLAS_EXAMPLE_RUNS_PER_HOUR=200`: runs an hour for all no-code visitors together.
- `ATLAS_EXAMPLE_SANDBOX_STARTS_PER_DAY=600` and `ATLAS_EXAMPLE_SANDBOX_SECONDS_PER_DAY=3600`: the no-code example's OWN
  Modal allowance per UTC day. It is kept apart from Modal's daily caps (2,000 starts, 7,200 s), so no-code visitors can
  never use up your sandboxes or the developers'. When it runs out, no-code visitors are told so (with the waitlist and
  "I have a code") until 00:00 UTC; anyone with a code is not affected.

No-code visitors may hold 2 sandboxes at once, and their spend is booked in the ledger as "the open example (no invite
code)" under the developers' share of the ceiling, never the owner's reserve. **Cost:** one example run starts 3 Modal
sandboxes (4 on the first run after a start, when the known-case check runs too), about $0.0001 each (E4's billed
figure), so about **$0.0003 a run**. The daily allowance of 600 starts is about 200 runs, about **$0.06 a day** at most.

## Later

- **Deploy new code** (after a merge to main): `fly deploy --remote-only --ha=false`. The old process stops before the
  new one starts, so two servers never share the store.
- **Rotate a key:** change the local file, run `sh tools/fly-secrets.sh`, then `fly secrets deploy --app atlas-dami`.
  The invite pepper is kept, so codes already handed out keep working.
- **Look at the logs:** `fly logs --app atlas-dami`.
- **Stop paying:** `fly apps destroy atlas-dami` removes the machine and the volume (and every code and spend record).

## If something goes wrong

- **The server refuses to start:** `fly logs` shows one `refusing to start: ...` line per problem, each saying what to
  fix. The checks are in `server/hosting.ts`.
- **Step 7 says `ATLAS_INVITE_PEPPER is not set`:** step 5 did not reach the machine. Run `sh tools/fly-secrets.sh`
  then `fly secrets deploy --app atlas-dami`, and try step 7 again.
- **The page says it needs an invite code:** open `/api/invite` on the same address and enter it. The example on the
  first screen needs none; if the example itself says its recorded answers "no longer match", the example's text changed
  after the answers were recorded: re-record them (tests/evidence/R9/record-example.mts) before deploying.

## Why these choices

- **Region `lhr` (London).** Lagos to Europe is the shortest well-connected path (West Africa's subsea cables land in
  Europe), and London is a short hop to the US services every run calls (Meta's API, Modal, Baseten, the Base RPC).
  Johannesburg (`jnb`) is in Africa but is farther from Lagos by network and from those services. I did not measure
  the latencies.
- **Never stopped when idle (`auto_stop_machines = "off"`).** Sessions, live logs, kept runs and outline jobs are in
  memory, Modal is warmed once at start (D32), and the Moonwell PR is read once at start. A stop would lose all of
  that and make the next visitor wait. It costs about $12–14 a month (estimate below).
- **Size `shared-cpu-1x`, 2 GB.** An anvil fork of Base plus an outline job is the biggest load; I did not measure its
  memory. Fly lists $6.70 a month for 1 GB in `iad` and about $5 per extra GB; London costs a little more. 1 GB would
  save about $5 a month if it proves enough (`fly scale memory 1024`, and change `[[vm]]` in fly.toml).
- **The visitor's address comes from `Fly-Client-IP`.** Fly's proxy puts the app's own address last in
  `X-Forwarded-For`, so the old rule (the last entry) would have counted every visitor as one. Fly sets
  `Fly-Client-IP` to the address it accepted the connection from.

## Also set by hand (from G1; Atlas cannot do these)

Spend limits in the Meta, Baseten and Modal dashboards, and a request cap at the RPC provider. Atlas's own limits only
cover spend that goes through Atlas.
