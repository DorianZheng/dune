#!/usr/bin/env bash
set -euo pipefail

CHANNEL="${1:-general}"
LIMIT="${2:-10}"
BEFORE="${3:-}"

echo "== Channels =="
curl -sS "http://localhost:3200/channels"
echo
echo
echo "== Agents =="
curl -sS "http://localhost:3200/agents"
echo
echo
echo "== Messages ($CHANNEL, limit=$LIMIT) =="
QUERY="channel=${CHANNEL}&limit=${LIMIT}"
if [[ -n "${BEFORE}" ]]; then
  QUERY="${QUERY}&before=${BEFORE}"
fi
curl -sS "http://localhost:3200/messages?${QUERY}"
echo
