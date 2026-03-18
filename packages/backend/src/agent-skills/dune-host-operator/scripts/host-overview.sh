#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ID="${1:-}"

python3 - "$BUNDLE_ID" <<'PY' | \
  curl -sS -X POST "http://localhost:3200/host/v1/overview" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
  | python3 -m json.tool
import json
import sys

bundle_id = sys.argv[1].strip()
payload = {}
if bundle_id:
    payload["bundleId"] = bundle_id
print(json.dumps(payload, ensure_ascii=True))
PY
