#!/bin/bash
S=<scratch>
cd $S
spend() { python3 -c "
import json
t=0
try:
  for l in open('$S/usage.jsonl'): t+=json.loads(l).get('usd',0) or 0
except FileNotFoundError: pass
print(round(t,4))"; }
mode=$1; shift
for f in "$@"; do
  s=$(spend)
  if python3 -c "import sys; sys.exit(0 if $s > 0.85 else 1)"; then echo "STOP spend $s"; break; fi
  label=in-$(basename "$f" | tr '.' '-')
  node flow.mjs "$label" "$S/inputs/$f" draw $mode 2>&1 | tail -1
  echo "  spend before=$s after=$(spend)"
done
