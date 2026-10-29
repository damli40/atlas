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
- **The page says it needs an invite code:** open `/api/invite` on the same address and enter it.

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
