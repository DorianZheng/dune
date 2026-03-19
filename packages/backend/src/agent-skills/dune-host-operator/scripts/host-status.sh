#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

$RPC_CMD agents.submitHostOperator "{\"id\":\"$AGENT_ID\",\"kind\":\"status\"}" | python3 -m json.tool
