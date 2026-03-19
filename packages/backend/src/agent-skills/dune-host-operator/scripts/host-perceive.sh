#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

if [ "$#" -lt 2 ]; then
  echo "Usage: host-perceive.sh <mode> <bundleId> [query]" >&2
  exit 1
fi

MODE="$1"
BUNDLE_ID="$2"
QUERY="${3:-}"

PAYLOAD=$(python3 -c "
import json,sys
p = {'id': sys.argv[1], 'kind': 'perceive', 'mode': sys.argv[2], 'bundleId': sys.argv[3]}
query = sys.argv[4]
if query:
    p['query'] = query
print(json.dumps(p))
" "$AGENT_ID" "$MODE" "$BUNDLE_ID" "$QUERY")

$RPC_CMD agents.submitHostOperator "$PAYLOAD" | python3 -m json.tool
