#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: host-perceive.sh <mode> <bundleId> [query]" >&2
  exit 1
fi

MODE="$1"
BUNDLE_ID="$2"
QUERY="${3:-}"

# Build the request payload
PAYLOAD=$(python3 -c '
import json, sys
mode, bundle_id, query = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"mode": mode, "bundleId": bundle_id}
if query:
    payload["query"] = query
print(json.dumps(payload, ensure_ascii=True))
' "$MODE" "$BUNDLE_ID" "$QUERY")

# Send request and format the MCP content response
curl -sS -X POST "http://localhost:3200/host/v1/perceive" \
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
    t = item.get("type", "")
    if t == "text":
        print(item.get("text", ""))
    elif t == "image":
        d = item.get("data", "")
        print("[Image: %s, %d chars base64]" % (item.get("mimeType", "image/png"), len(d)))
'
