#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <channel> <message...>" >&2
  exit 1
fi

CHANNEL="$1"
shift
CONTENT="$*"

# Resolve channel name to ID
CHANNEL_RESULT=$($RPC_CMD channels.getByName "$(python3 -c "import json; print(json.dumps({'name': '$CHANNEL'}))")")
CHANNEL_ID=$(echo "$CHANNEL_RESULT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['id'])")

if [[ -z "$CHANNEL_ID" ]]; then
  echo "Channel '$CHANNEL' not found" >&2
  exit 1
fi

# Build payload with proper escaping
PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'channelId': sys.argv[1], 'authorId': sys.argv[2], 'content': sys.argv[3]}))" "$CHANNEL_ID" "$AGENT_ID" "$CONTENT")

$RPC_CMD channels.sendMessage "$PAYLOAD"
