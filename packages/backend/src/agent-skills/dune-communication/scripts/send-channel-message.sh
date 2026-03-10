#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <channel> <message...>" >&2
  exit 1
fi

CHANNEL="$1"
shift
CONTENT="$*"
PAYLOAD_FILE="${TMP_JSON_PATH:-/tmp/msg.json}"

python3 - "$CHANNEL" "$CONTENT" "$PAYLOAD_FILE" <<'PY'
import json
import pathlib
import sys

channel, content, path = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {"channel": channel, "content": content}
pathlib.Path(path).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
PY

curl -sS -X POST "http://localhost:3200/send" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD_FILE"
