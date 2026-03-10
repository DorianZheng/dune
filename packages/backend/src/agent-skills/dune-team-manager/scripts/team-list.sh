#!/bin/bash
# List all agents with their ID, name, and status.
# Usage: team-list.sh
set -euo pipefail

PROXY="http://localhost:3200"

curl -s "$PROXY/agents" | jq -r '.[] | "\(.id)\t\(.name)\t\(.status)"' | column -t -s$'\t'
