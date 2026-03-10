#!/usr/bin/env bash
set -euo pipefail

BATCH_ID="${1:-}"

if [[ -z "${BATCH_ID}" ]]; then
  echo "usage: $0 <batch-id>" >&2
  exit 1
fi

curl -sS -X POST "http://localhost:3200/mailbox/ack" \
  -H 'Content-Type: application/json' \
  -d "{\"batchId\":\"${BATCH_ID}\"}"
echo
