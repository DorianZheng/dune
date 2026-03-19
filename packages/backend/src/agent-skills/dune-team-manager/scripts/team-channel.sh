#!/bin/bash
# Channel management: create, subscribe, list
# Usage:
#   team-channel.sh create <channel-name>
#   team-channel.sh subscribe <channel-name> <agent-id>
#   team-channel.sh list
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

ACTION="${1:?Usage: team-channel.sh <create|subscribe|list> [args...]}"

case "$ACTION" in
  create)
    NAME="${2:?Usage: team-channel.sh create <channel-name>}"
    PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'name': sys.argv[1]}))" "$NAME")
    $RPC_CMD channels.create "$PAYLOAD"
    ;;
  subscribe)
    CHANNEL_NAME="${2:?Usage: team-channel.sh subscribe <channel-name> <agent-id>}"
    TARGET_AGENT_ID="${3:?Usage: team-channel.sh subscribe <channel-name> <agent-id>}"
    # Resolve channel name to ID
    CHANNEL_RESULT=$($RPC_CMD channels.getByName "$(python3 -c "import json; print(json.dumps({'name': '$CHANNEL_NAME'}))")")
    CHANNEL_ID=$(echo "$CHANNEL_RESULT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))")
    if [ -z "$CHANNEL_ID" ]; then
      echo "Channel '$CHANNEL_NAME' not found" >&2
      exit 1
    fi
    $RPC_CMD channels.subscribe "{\"channelId\":\"$CHANNEL_ID\",\"agentId\":\"$TARGET_AGENT_ID\"}"
    ;;
  list)
    $RPC_CMD channels.list '{}' | python3 -c "
import json,sys
channels = json.loads(sys.stdin.read())
for c in channels:
    print(f\"#{c['name']}\t{c['id']}\")
" | column -t -s$'\t'
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Usage: team-channel.sh <create|subscribe|list> [args...]" >&2
    exit 1
    ;;
esac
