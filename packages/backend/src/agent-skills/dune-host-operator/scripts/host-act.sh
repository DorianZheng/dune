#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: host-act.sh '<json payload without kind>'" >&2
  exit 1
fi

# Validate and forward the JSON payload
PAYLOAD=$(python3 -c '
import json, sys
payload = json.loads(sys.argv[1])
if not isinstance(payload, dict):
    raise SystemExit("payload must be a JSON object")
print(json.dumps(payload, ensure_ascii=True))
' "$1")

# Send request and format the MCP content response
curl -sS -X POST "http://localhost:3200/host/v1/act" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  | python3 -c '
import json, sys
r = json.load(sys.stdin)
content = r.get("content", [])
if r.get("isError"):
    for item in content:
        if item.get("type") == "text":
            print(item["text"])
    sys.exit(1)
for item in content:
    if item.get("type") == "text":
        print(item.get("text", ""))
'
