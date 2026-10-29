#!/bin/sh
# H1 (D52): the hosted container's entrypoint (installed as /usr/local/bin/atlas-entrypoint).
#
# Plain words: a fresh Fly volume is owned by root, and the server runs as the non-root user "atlas". So this script
# starts as root only long enough to make the invite store's folder on the volume and hand it (and the volume's top
# folder, where the usage log lives) to "atlas". Then it drops to "atlas" for good, with no way back to root
# (--no-new-privs, every capability cleared), and runs the server. No secret is read or printed here.
set -eu

VOLUME="${ATLAS_VOLUME_DIR:-/data}"
STORE="${ATLAS_INVITES_DIR:-}"

if [ "$(id -u)" = "0" ]; then
  if [ -d "$VOLUME" ] && [ -n "$STORE" ]; then
    mkdir -p "$STORE"
    chown atlas:atlas "$VOLUME"
    # -R: a file made by mistake as root (an invites tool run without the atlas-invites wrapper) is handed back too.
    chown -R atlas:atlas "$STORE"
    chmod 700 "$STORE"
  fi
  exec setpriv --reuid=atlas --regid=atlas --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all \
    env HOME=/home/atlas "$@"
fi
exec "$@"
