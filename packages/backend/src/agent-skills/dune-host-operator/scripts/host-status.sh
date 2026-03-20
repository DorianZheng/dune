#!/usr/bin/env bash
set -euo pipefail

# Send request and format the MCP content response
printf '{}' | \
  curl -sS -X POST "http://localhost:3200/host/v1/status" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
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
