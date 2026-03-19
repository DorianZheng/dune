#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/sandbox-api.sh"
BASE_URL="${DUNE_AGENT_URL:?DUNE_AGENT_URL env var not set}"

usage() {
  cat >&2 <<'USAGE'
Usage:
  sandbox-files.sh upload-b64 <boxId> <containerPath> <contentBase64> [overwrite=true]
  sandbox-files.sh upload-file <boxId> <containerPath> <hostFilePath> [overwrite=true]
  sandbox-files.sh download <boxId> <containerPath>
  sandbox-files.sh import-host <boxId> <hostPath> <destPath>
  sandbox-files.sh attach <boxId>
USAGE
  exit 1
}

url_encode() {
  python3 - "$1" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=''))
PY
}

ACTION="${1:-}"
[[ -n "$ACTION" ]] || usage
shift || true

case "$ACTION" in
  upload-b64)
    [[ $# -ge 3 ]] || usage
    BOX_ID="$1"
    CONTAINER_PATH="$2"
    CONTENT_B64="$3"
    OVERWRITE="${4:-true}"
    PAYLOAD="$(python3 - "$CONTAINER_PATH" "$CONTENT_B64" "$OVERWRITE" <<'PY'
import json
import sys

path = sys.argv[1]
content = sys.argv[2]
overwrite = sys.argv[3].lower() != 'false'
print(json.dumps({"path": path, "contentBase64": content, "overwrite": overwrite}, ensure_ascii=True))
PY
)"
    "$API_SCRIPT" POST "/sandboxes/v1/boxes/${BOX_ID}/files" "$PAYLOAD"
    ;;
  upload-file)
    [[ $# -ge 3 ]] || usage
    BOX_ID="$1"
    CONTAINER_PATH="$2"
    HOST_FILE="$3"
    OVERWRITE="${4:-true}"
    [[ -f "$HOST_FILE" ]] || { echo "File not found: $HOST_FILE" >&2; exit 1; }
    ENCODED_PATH="$(url_encode "$CONTAINER_PATH")"
    curl -sS -X POST \
      -H 'Content-Type: application/octet-stream' \
      -H "X-Actor-Type: system" -H "X-Actor-Id: agent:${AGENT_ID}" \
      --data-binary "@${HOST_FILE}" \
      "${BASE_URL}/sandboxes/v1/boxes/${BOX_ID}/files?path=${ENCODED_PATH}&overwrite=${OVERWRITE}"
    ;;
  download)
    [[ $# -ge 2 ]] || usage
    BOX_ID="$1"
    CONTAINER_PATH="$2"
    ENCODED_PATH="$(url_encode "$CONTAINER_PATH")"
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/${BOX_ID}/files?path=${ENCODED_PATH}"
    ;;
  import-host)
    [[ $# -ge 3 ]] || usage
    BOX_ID="$1"
    HOST_PATH="$2"
    DEST_PATH="$3"
    PAYLOAD="$(python3 - "$HOST_PATH" "$DEST_PATH" <<'PY'
import json
import sys

print(json.dumps({"hostPath": sys.argv[1], "destPath": sys.argv[2]}, ensure_ascii=True))
PY
)"
    "$API_SCRIPT" POST "/sandboxes/v1/boxes/${BOX_ID}/import-host-path" "$PAYLOAD"
    ;;
  attach)
    [[ $# -ge 1 ]] || usage
    echo "Note: backend attach passthrough currently returns 501." >&2
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1/attach"
    ;;
  *)
    usage
    ;;
esac
