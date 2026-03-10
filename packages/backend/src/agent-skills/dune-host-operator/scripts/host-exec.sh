#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: host-exec.sh <scope:workspace|full-host> <cwd> <command> [args...]" >&2
  exit 1
fi

SCOPE="$1"
CWD="$2"
shift 2

python3 - "$SCOPE" "$CWD" "$@" <<'PY' | \
  curl -sS -X POST "http://localhost:3200/host/v1/exec" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
  | python3 -m json.tool
import json
import sys

scope = sys.argv[1]
cwd = sys.argv[2]
command = sys.argv[3] if len(sys.argv) > 3 else ""
args = sys.argv[4:] if len(sys.argv) > 4 else []
print(json.dumps({
  "scope": scope,
  "cwd": cwd,
  "command": command,
  "args": args,
}, ensure_ascii=True))
PY
