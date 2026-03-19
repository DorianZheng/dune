#!/usr/bin/env bash
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

CHANNEL="${1:-general}"
LIMIT="${2:-10}"
BEFORE="${3:-}"

echo "== Channels =="
$RPC_CMD channels.list '{}'
echo
echo
echo "== Agents =="
$RPC_CMD agents.list '{}'
echo
echo
echo "== Messages ($CHANNEL, limit=$LIMIT) =="

# Resolve channel name to ID
CHANNEL_RESULT=$($RPC_CMD channels.getByName "$(python3 -c "import json; print(json.dumps({'name': '$CHANNEL'}))")")
CHANNEL_ID=$(echo "$CHANNEL_RESULT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['id'])")

if [[ -n "$CHANNEL_ID" ]]; then
  PAYLOAD=$(python3 -c "
import json,sys
p = {'channelId': sys.argv[1], 'limit': int(sys.argv[2])}
if sys.argv[3]:
    p['before'] = sys.argv[3]
print(json.dumps(p))
" "$CHANNEL_ID" "$LIMIT" "$BEFORE")
  $RPC_CMD channels.getMessages "$PAYLOAD"
else
  echo "Channel '$CHANNEL' not found" >&2
fi
echo
