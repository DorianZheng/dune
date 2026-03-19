#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

if [ "$#" -ne 1 ]; then
  echo "Usage: host-fs.sh '<json payload without kind>'" >&2
  exit 1
fi

PAYLOAD=$(python3 -c "
import json,sys
inner = json.loads(sys.argv[1])
if not isinstance(inner, dict):
    raise SystemExit('payload must be a JSON object')
inner['id'] = sys.argv[2]
inner['kind'] = 'filesystem'
print(json.dumps(inner, ensure_ascii=True))
" "$1" "$AGENT_ID")

$RPC_CMD agents.submitHostOperator "$PAYLOAD" | python3 -m json.tool
