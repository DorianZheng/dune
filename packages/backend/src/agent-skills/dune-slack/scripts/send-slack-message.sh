#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <slack-channel-id> <message...>" >&2
  exit 1
fi

SLACK_CHANNEL_ID="$1"
shift
CONTENT="$*"

PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'slackChannelId': sys.argv[1], 'content': sys.argv[2], 'agentName': sys.argv[3]}))" "$SLACK_CHANNEL_ID" "$CONTENT" "${AGENT_NAME:-Agent}")

$RPC_CMD slack.send "$PAYLOAD"
