#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: host-act.sh '<json payload without kind>'" >&2
  exit 1
fi

python3 - "$1" <<'PY' | \
  curl -sS -X POST "http://localhost:3200/host/v1/act" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
  | python3 -m json.tool
import json
import sys

payload = json.loads(sys.argv[1])
if not isinstance(payload, dict):
  raise SystemExit("payload must be a JSON object")
print(json.dumps(payload, ensure_ascii=True))
PY
