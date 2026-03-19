#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

BUNDLE_ID="${1:-}"

PAYLOAD=$(python3 -c "
import json,sys
p = {'id': sys.argv[1], 'kind': 'overview'}
bundle_id = sys.argv[2].strip()
if bundle_id:
    p['bundleId'] = bundle_id
print(json.dumps(p))
" "$AGENT_ID" "$BUNDLE_ID")

$RPC_CMD agents.submitHostOperator "$PAYLOAD" | python3 -m json.tool
