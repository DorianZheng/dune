#!/bin/bash
# List all agents with their ID, name, and status.
# Usage: team-list.sh
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

$RPC_CMD agents.list '{}' | python3 -c "
import json,sys
agents = json.loads(sys.stdin.read())
for a in agents:
    print(f\"{a['id']}\t{a['name']}\t{a.get('status','unknown')}\")
" | column -t -s$'\t'
