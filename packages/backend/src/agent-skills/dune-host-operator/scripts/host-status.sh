#!/usr/bin/env bash
set -euo pipefail

printf '{}' | \
  curl -sS -X POST "http://localhost:3200/host/v1/status" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
  | python3 -m json.tool
