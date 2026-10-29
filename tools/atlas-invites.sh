#!/bin/sh
# H1 (D52): the invite tool on the hosted machine (installed as /usr/local/bin/atlas-invites). Dami runs it through
#   fly ssh console -C "/usr/local/bin/atlas-invites create --name dami --owner"
# It is tools/invites.ts (create, list, revoke, usage) with three guards:
# - It refuses to run without ATLAS_INVITE_PEPPER in the environment. Otherwise the tool would make its own pepper file,
#   and the codes it prints would never match the server's (which uses the Fly secret): a silent lock-out.
# - It refuses to run without ATLAS_INVITES_DIR (the folder on the volume), so a code never lands in the wrong place.
# - `fly ssh console` logs in as root; the tool then runs as the "atlas" user, so the files it writes stay readable by
#   the server (they are mode 600).
# The new code is printed once, to the terminal that ran the command. Nothing else here prints a secret.
set -eu

if [ -z "${ATLAS_INVITE_PEPPER:-}" ]; then
  echo "atlas-invites: ATLAS_INVITE_PEPPER is not set in this shell, so a code made here would not match the server's. Run tools/fly-secrets.sh on your Mac first (it sets the pepper as a Fly secret), then try again." >&2
  exit 1
fi
if [ -z "${ATLAS_INVITES_DIR:-}" ]; then
  echo "atlas-invites: ATLAS_INVITES_DIR is not set (fly.toml [env] sets it to the folder on the volume)." >&2
  exit 1
fi

cd /app
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$ATLAS_INVITES_DIR"
  chown atlas:atlas "$ATLAS_INVITES_DIR"
  chmod 700 "$ATLAS_INVITES_DIR"
  exec setpriv --reuid=atlas --regid=atlas --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all \
    env HOME=/home/atlas node --import tsx tools/invites.ts "$@"
fi
exec node --import tsx tools/invites.ts "$@"
