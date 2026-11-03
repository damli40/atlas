#!/bin/bash
# R15 local mirror of the hosted server: invites required, $0 spend ceiling, local sandbox, no keys (HOME is a scratch folder).
# Set SCRATCH to an empty folder; make one invite code first (tools/invites.ts create) with the same pepper and invites dir.
: "${SCRATCH:?set SCRATCH to a scratch folder}"; mkdir -p "$SCRATCH/home" "$SCRATCH/inv" "$SCRATCH/proofs"
cd "$(dirname "$0")/../../../.."
env -i PATH="$PATH" HOME=$SCRATCH/home PORT=${PORT:-8851} ATLAS_SERVE_PAGE=1 ATLAS_REQUIRE_INVITE=1 ATLAS_INVITE_PEPPER="${PEPPER:?set PEPPER to any local value}" ATLAS_INVITES_DIR=$SCRATCH/inv ATLAS_USAGE_PATH=$SCRATCH/usage.jsonl ATLAS_PROOFS_DIR=$SCRATCH/proofs ATLAS_SPEND_CEILING_USD=0 ATLAS_EXAMPLE_RUNS_PER_IP_PER_HOUR=1000 ATLAS_EXAMPLE_RUNS_PER_HOUR=1000 ATLAS_PUBLIC_ORIGIN=http://localhost:${PORT:-8851} $EXTRA ./node_modules/.bin/tsx server/index.ts > $SCRATCH/server${PORT:-8851}.log 2>&1 &
echo $! > $SCRATCH/server${PORT:-8851}.pid
