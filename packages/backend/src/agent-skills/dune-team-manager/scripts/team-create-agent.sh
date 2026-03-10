#!/bin/bash
# Create and start an agent, then wait for it to be ready.
# Usage: team-create-agent.sh "Agent Name" "Personality description"
set -euo pipefail

PROXY="http://localhost:3200"
NAME="${1:?Usage: team-create-agent.sh <name> <personality>}"
PERSONALITY="${2:?Usage: team-create-agent.sh <name> <personality>}"

# Create agent
RESULT=$(curl -s -X POST "$PROXY/agents" \
  -H "Content-Type: application/json" \
  -d "{\"name\": $(echo "$NAME" | jq -Rs .), \"personality\": $(echo "$PERSONALITY" | jq -Rs .)}")

AGENT_ID=$(echo "$RESULT" | jq -r '.id // empty')
if [ -z "$AGENT_ID" ]; then
  echo "Failed to create agent: $RESULT" >&2
  exit 1
fi
echo "Created agent: $NAME (id: $AGENT_ID)"

# Start agent (this blocks until the agent container is fully ready)
echo "Starting agent (this may take 2-3 minutes)..."
START_RESULT=$(curl -s -X POST "$PROXY/agents/$AGENT_ID/start" --max-time 300)
STATUS=$(echo "$START_RESULT" | jq -r '.status // .error // "unknown"')
echo "Agent start result: $STATUS"

echo "$AGENT_ID"
