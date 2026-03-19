#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

$RPC_CMD agents.getMailbox "{\"id\":\"$AGENT_ID\"}"
echo
