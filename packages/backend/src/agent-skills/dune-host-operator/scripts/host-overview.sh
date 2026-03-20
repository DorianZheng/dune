#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ID="${1:-}"

# Build the request payload
PAYLOAD=$(python3 -c '
import json, sys
bundle_id = sys.argv[1].strip()
payload = {}
if bundle_id:
    payload["bundleId"] = bundle_id
print(json.dumps(payload, ensure_ascii=True))
' "$BUNDLE_ID")

# Send request and format the MCP content response
curl -sS -X POST "http://localhost:3200/host/v1/overview" \
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
