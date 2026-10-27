#!/bin/sh
# D03-00: checks that the Base RPC in $BASE_RPC_URL can serve the archive reads Atlas needs.
# Prints only the RPC's provider domain (last two labels of the host), never the URL or its token.
#
# Usage (load the URL without echoing it):
#   ( set -a; . ~/.config/atlas/rpc.env; set +a; sh tests/tools/rpc-check.sh )
set -u
if [ -z "${BASE_RPC_URL:-}" ]; then echo "BASE_RPC_URL is not set"; exit 2; fi

ORACLE=0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0
host=$(printf '%s' "$BASE_RPC_URL" | sed -E 's#^[a-z]+://##; s#[/:?].*$##' | awk -F. '{ if (NF >= 2) print $(NF-1)"."$NF; else print "?" }')
fail=0
check() { # name, got, want
  if [ "$2" = "$3" ]; then echo "matched  $1 = $2"; else echo "DIFFERS  $1 = $2 (expected $3)"; fail=1; fi
}

echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "rpc host (redacted): $host"
echo "cast: $(cast --version | head -1)"
echo "chain id: $(cast chain-id --rpc-url "$BASE_RPC_URL" 2>&1)"
echo

ts=$(cast block 42194663 -f timestamp --rpc-url "$BASE_RPC_URL" 2>&1)
check "cast block 42194663 -f timestamp" "$ts" "1771178673"
pre=$(cast call "$ORACLE" "getFeed(string)(address)" cbETH --block 42194662 --rpc-url "$BASE_RPC_URL" 2>&1)
check "getFeed(cbETH) at block 42194662" "$pre" "0xB0Ba0C5D7DA4ec400C1C3E5ef2485134F89918C5"
post=$(cast call "$ORACLE" "getFeed(string)(address)" cbETH --block 42194663 --rpc-url "$BASE_RPC_URL" 2>&1)
check "getFeed(cbETH) at block 42194663" "$post" "0x67996D1ff7a3711a91E2839d1059Fcb950C0495D"

echo
echo "50 eth_calls in a row (getFeed(cbETH), blocks 42194613..42194662), no pause:"
ok=0; limited=0; other=0; i=0
start=$(date +%s)
while [ $i -lt 50 ]; do
  b=$((42194613 + i))
  out=$(cast call "$ORACLE" "getFeed(string)(address)" cbETH --block "$b" --rpc-url "$BASE_RPC_URL" 2>&1)
  case "$out" in
    0x*) ok=$((ok + 1)) ;;
    *429*|*"rate limit"*|*"Too Many"*|*"too many"*) limited=$((limited + 1)) ;;
    *) other=$((other + 1)); echo "  call $i error: $(printf '%s' "$out" | sed "s#$BASE_RPC_URL#<redacted>#g" | head -1 | cut -c1-160)" ;;
  esac
  i=$((i + 1))
done
end=$(date +%s)
echo "  answered: $ok  rate-limited (429): $limited  other errors: $other  seconds: $((end - start))"
if [ "$ok" -ne 50 ]; then fail=1; fi

echo
if [ "$fail" -eq 0 ]; then echo "RESULT: all checks matched"; else echo "RESULT: at least one check did not match"; fi
exit $fail
