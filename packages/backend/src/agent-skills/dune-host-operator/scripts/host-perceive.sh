#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: host-perceive.sh <mode> <bundleId> [query]" >&2
  exit 1
fi

MODE="$1"
BUNDLE_ID="$2"
QUERY="${3:-}"

python3 - "$MODE" "$BUNDLE_ID" "$QUERY" <<'PY' | \
  curl -sS -X POST "http://localhost:3200/host/v1/perceive" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
  | python3 -m json.tool
import json
import sys

mode = sys.argv[1]
bundle_id = sys.argv[2]
query = sys.argv[3]
payload = {
  "mode": mode,
  "bundleId": bundle_id,
}
if query:
  payload["query"] = query
print(json.dumps(payload, ensure_ascii=True))
PY
