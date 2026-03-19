#!/bin/bash
# Create and start an agent, then wait for it to be ready.
# Usage: team-create-agent.sh "Agent Name" "Personality description"
set -euo pipefail

RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"

NAME="${1:?Usage: team-create-agent.sh <name> <personality>}"
PERSONALITY="${2:?Usage: team-create-agent.sh <name> <personality>}"

# Create agent
PAYLOAD=$(python3 -c "import json,sys; print(json.dumps({'name': sys.argv[1], 'personality': sys.argv[2]}))" "$NAME" "$PERSONALITY")
RESULT=$($RPC_CMD agents.create "$PAYLOAD")

NEW_AGENT_ID=$(echo "$RESULT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('id',''))")
if [ -z "$NEW_AGENT_ID" ]; then
  echo "Failed to create agent: $RESULT" >&2
  exit 1
fi
echo "Created agent: $NAME (id: $NEW_AGENT_ID)"

# Start agent (this blocks until the agent container is fully ready)
echo "Starting agent (this may take 2-3 minutes)..."
START_RESULT=$($RPC_CMD agents.start "{\"id\":\"$NEW_AGENT_ID\"}")
STATUS=$(echo "$START_RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('status', d.get('error', 'unknown')))")
echo "Agent start result: $STATUS"

echo "$NEW_AGENT_ID"
