#!/bin/bash
# Channel management: create, subscribe, list
# Usage:
#   team-channel.sh create <channel-name>
#   team-channel.sh subscribe <channel-name> <agent-id>
#   team-channel.sh list
set -euo pipefail

PROXY="http://localhost:3200"
ACTION="${1:?Usage: team-channel.sh <create|subscribe|list> [args...]}"

case "$ACTION" in
  create)
    NAME="${2:?Usage: team-channel.sh create <channel-name>}"
    curl -s -X POST "$PROXY/channels" \
      -H "Content-Type: application/json" \
      -d "{\"name\": $(echo "$NAME" | jq -Rs .)}" | jq .
    ;;
  subscribe)
    CHANNEL_NAME="${2:?Usage: team-channel.sh subscribe <channel-name> <agent-id>}"
    AGENT_ID="${3:?Usage: team-channel.sh subscribe <channel-name> <agent-id>}"
    # Resolve channel name to ID
    CHANNEL_ID=$(curl -s "$PROXY/channels" | jq -r ".[] | select(.name == \"$CHANNEL_NAME\") | .id")
    if [ -z "$CHANNEL_ID" ]; then
      echo "Channel '$CHANNEL_NAME' not found" >&2
      exit 1
    fi
    curl -s -X POST "$PROXY/channels/$CHANNEL_ID/subscribe" \
      -H "Content-Type: application/json" \
      -d "{\"agentId\": \"$AGENT_ID\"}" | jq .
    ;;
  list)
    curl -s "$PROXY/channels" | jq -r '.[] | "#\(.name)\t\(.id)"' | column -t -s$'\t'
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    echo "Usage: team-channel.sh <create|subscribe|list> [args...]" >&2
    exit 1
    ;;
esac
