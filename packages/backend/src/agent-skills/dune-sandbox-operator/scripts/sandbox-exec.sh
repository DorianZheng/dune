#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/sandbox-api.sh"
BASE_URL="${SANDBOX_PROXY_URL:-http://localhost:3200}"

usage() {
  cat >&2 <<'USAGE'
Usage:
  sandbox-exec.sh create <boxId> <command> [args...]
  sandbox-exec.sh list <boxId>
  sandbox-exec.sh get <boxId> <execId>
  sandbox-exec.sh events <boxId> <execId> [afterSeq] [limit]
  sandbox-exec.sh sse <boxId> <execId>
USAGE
  exit 1
}

ACTION="${1:-}"
[[ -n "$ACTION" ]] || usage
shift || true

case "$ACTION" in
  create)
    [[ $# -ge 2 ]] || usage
    BOX_ID="$1"
    COMMAND="$2"
    shift 2
    PAYLOAD="$(python3 - "$COMMAND" "$@" <<'PY'
import json
import sys

command = sys.argv[1]
args = sys.argv[2:]
print(json.dumps({"command": command, "args": args, "env": {}}, ensure_ascii=True))
PY
)"
    "$API_SCRIPT" POST "/sandboxes/v1/boxes/${BOX_ID}/execs" "$PAYLOAD"
    ;;
  list)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1/execs"
    ;;
  get)
    [[ $# -ge 2 ]] || usage
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1/execs/$2"
    ;;
  events)
    [[ $# -ge 2 ]] || usage
    AFTER_SEQ="${3:-0}"
    LIMIT="${4:-500}"
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1/execs/$2/events?afterSeq=${AFTER_SEQ}&limit=${LIMIT}"
    ;;
  sse)
    [[ $# -ge 2 ]] || usage
    curl -sS -N \
      -H 'Accept: text/event-stream' \
      "${BASE_URL}/sandboxes/v1/boxes/$1/execs/$2/events"
    ;;
  *)
    usage
    ;;
esac
