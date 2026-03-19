#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

BATCH_ID="${1:-}"

if [[ -z "${BATCH_ID}" ]]; then
  echo "usage: $0 <batch-id>" >&2
  exit 1
fi

$RPC_CMD agents.ackMailbox "{\"id\":\"$AGENT_ID\",\"batchId\":\"$BATCH_ID\"}"
echo
