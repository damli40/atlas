#!/bin/sh
# H1 (D52): sets the hosted Atlas's secrets on Fly.io from the config files on this Mac. Dami runs it:
#
#   sh tools/fly-secrets.sh              # the app named in fly.toml
#   sh tools/fly-secrets.sh other-name   # another app
#   sh tools/fly-secrets.sh --check      # only check that every file and value is there; sends nothing
#
# What it sends (names only here; the values never appear on screen, in a file, or in any command's arguments):
#   META_API_KEY          from ~/.config/meta-model-api/env
#   BASETEN_API_KEY       from ~/.config/baseten/env
#   BASE_RPC_URL          from ~/.config/atlas/rpc.env
#   MODAL_TOKEN_ID        from ~/.modal.toml, profile [damli40] (another profile: ATLAS_MODAL_PROFILE=name sh ...)
#   MODAL_TOKEN_SECRET    from the same profile
#   ATLAS_INVITE_PEPPER   made fresh here (32 random bytes) the FIRST time only. If the app already has one, it is
#                         kept: a new pepper would make every invite code already handed out stop working.
#
# How the values stay hidden: each is read by awk into a shell variable (never exported, so no child process sees it),
# checked, then written with the shell's built-in printf straight into `fly secrets import` through a pipe (stdin).
# Nothing is echoed, nothing is written to disk, tracing is off (set +x). A missing file or value stops the script
# with the file's name, before anything is sent.
#
# The secrets are "staged": they reach the machine on the next `fly deploy` (or `fly secrets deploy`).

set -eu
set +x
# H1 review m8: flyctl's debug logging could print its outgoing requests (which would hold the values). Turn every
# such switch off for this script, whatever the shell had set.
unset LOG_LEVEL FLY_LOG_LEVEL FLYCTL_LOG_LEVEL DEBUG FLY_DEBUG FLYCTL_DEBUG GRPC_TRACE GRPC_VERBOSITY 2>/dev/null || true

fail() {
  printf 'fly-secrets: %s\n' "$1" >&2
  exit 1
}

CHECK_ONLY=""
if [ "${1:-}" = "--check" ]; then CHECK_ONLY=1; shift; fi

cd "$(dirname "$0")/.."
[ -f fly.toml ] || fail "fly.toml not found next to tools/ (run this from the Atlas repo)"
APP="${1:-$(sed -n 's/^app *= *"\([^"]*\)".*$/\1/p' fly.toml | head -n 1)}"
[ -n "$APP" ] || fail "no app name: give one (sh tools/fly-secrets.sh <app>) or set app = \"...\" in fly.toml"
[ -n "$CHECK_ONLY" ] || command -v fly >/dev/null 2>&1 || fail "flyctl is not installed: brew install flyctl, then fly auth login"

PROFILE="${ATLAS_MODAL_PROFILE:-damli40}"
META_FILE="$HOME/.config/meta-model-api/env"
BASETEN_FILE="$HOME/.config/baseten/env"
RPC_FILE="$HOME/.config/atlas/rpc.env"
MODAL_FILE="$HOME/.modal.toml"

for f in "$META_FILE" "$BASETEN_FILE" "$RPC_FILE" "$MODAL_FILE"; do
  [ -f "$f" ] || fail "missing $f"
done

# The value of KEY in a KEY=VALUE file ("export KEY=" allowed; one pair of surrounding quotes removed; an unquoted
# value's trailing " # comment" removed). The first match wins. Printed only into $(...), never to the terminal.
env_value() {
  awk -v k="$2" '
    found { next }
    {
      line = $0
      sub(/^[ \t]*export[ \t]+/, "", line)
      if (match(line, "^[ \t]*" k "[ \t]*=")) {
        v = substr(line, RLENGTH + 1)
        sub(/^[ \t]+/, "", v); sub(/[ \t\r]+$/, "", v)
        if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) v = substr(v, 2, length(v) - 2)
        else sub(/[ \t]+#.*$/, "", v)
        printf "%s", v
        found = 1
      }
    }' "$1"
}

# The value of KEY inside [PROFILE] of a TOML file (key may be quoted; one pair of quotes removed).
toml_value() {
  awk -v p="$2" -v k="$3" '
    /^[ \t]*\[/ { line = $0; gsub(/[ \t]/, "", line); insec = (line == "[" p "]" || line == "[\"" p "\"]"); next }
    insec && !found && match($0, "^[ \t]*\"?" k "\"?[ \t]*=") {
      v = substr($0, RLENGTH + 1)
      sub(/^[ \t]+/, "", v); sub(/[ \t\r]+$/, "", v)
      if (v ~ /^"/) { v = substr(v, 2); sub(/".*$/, "", v) }
      else if (v ~ /^\047/) { v = substr(v, 2); sub(/\047.*$/, "", v) }
      else sub(/[ \t]+#.*$/, "", v)
      printf "%s", v
      found = 1
    }' "$1"
}

# A value must be there and be one plain token (no spaces or line breaks). Only the NAME is ever printed.
check() {
  case "$2" in
    "") fail "$1 is empty or missing in $3" ;;
    *[[:space:]]*) fail "$1 in $3 holds a space or line break; fix the file" ;;
  esac
}

META_API_KEY_V="$(env_value "$META_FILE" META_API_KEY)"
check META_API_KEY "$META_API_KEY_V" "$META_FILE"
BASETEN_API_KEY_V="$(env_value "$BASETEN_FILE" BASETEN_API_KEY)"
check BASETEN_API_KEY "$BASETEN_API_KEY_V" "$BASETEN_FILE"
BASE_RPC_URL_V="$(env_value "$RPC_FILE" BASE_RPC_URL)"
check BASE_RPC_URL "$BASE_RPC_URL_V" "$RPC_FILE"
case "$BASE_RPC_URL_V" in https://*) ;; *) fail "BASE_RPC_URL in $RPC_FILE does not start with https://" ;; esac
MODAL_TOKEN_ID_V="$(toml_value "$MODAL_FILE" "$PROFILE" token_id)"
check MODAL_TOKEN_ID "$MODAL_TOKEN_ID_V" "$MODAL_FILE [$PROFILE]"
MODAL_TOKEN_SECRET_V="$(toml_value "$MODAL_FILE" "$PROFILE" token_secret)"
check MODAL_TOKEN_SECRET "$MODAL_TOKEN_SECRET_V" "$MODAL_FILE [$PROFILE]"

if [ -n "$CHECK_ONLY" ]; then
  printf 'fly-secrets --check: META_API_KEY, BASETEN_API_KEY, BASE_RPC_URL, MODAL_TOKEN_ID, MODAL_TOKEN_SECRET (profile [%s]) are all there; nothing was sent.\n' "$PROFILE"
  exit 0
fi

# Which secrets the app already has (names only; `fly secrets list` never shows values). This also checks that
# flyctl is logged in and the app exists, before anything is sent.
EXISTING="$(fly secrets list --app "$APP" --json 2>/dev/null)" || fail "could not list the secrets of app \"$APP\": is flyctl logged in (fly auth login) and does the app exist (fly apps create $APP)?"
PEPPER_V=""
case "$EXISTING" in
  *'"ATLAS_INVITE_PEPPER"'*) PEPPER_NOTE="kept the app's existing ATLAS_INVITE_PEPPER (codes already handed out keep working)" ;;
  *)
    PEPPER_V="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
    [ "${#PEPPER_V}" -eq 64 ] || fail "could not make a random pepper"
    PEPPER_NOTE="made a new ATLAS_INVITE_PEPPER (first run)"
    ;;
esac

{
  printf 'META_API_KEY=%s\n' "$META_API_KEY_V"
  printf 'BASETEN_API_KEY=%s\n' "$BASETEN_API_KEY_V"
  printf 'BASE_RPC_URL=%s\n' "$BASE_RPC_URL_V"
  printf 'MODAL_TOKEN_ID=%s\n' "$MODAL_TOKEN_ID_V"
  printf 'MODAL_TOKEN_SECRET=%s\n' "$MODAL_TOKEN_SECRET_V"
  if [ -n "$PEPPER_V" ]; then printf 'ATLAS_INVITE_PEPPER=%s\n' "$PEPPER_V"; fi
} | fly secrets import --app "$APP" --stage >/dev/null 2>&1 || fail "fly secrets import failed for app \"$APP\" (nothing printed, to keep the values off screen); run: fly secrets list --app $APP"

printf 'fly-secrets: staged META_API_KEY, BASETEN_API_KEY, BASE_RPC_URL, MODAL_TOKEN_ID, MODAL_TOKEN_SECRET for app "%s" (Modal profile [%s]); %s.\n' "$APP" "$PROFILE" "$PEPPER_NOTE"
printf 'fly-secrets: they reach the machine on the next deploy: fly deploy --remote-only --ha=false (or, if nothing else changed: fly secrets deploy --app %s)\n' "$APP"
