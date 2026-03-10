#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SCRIPT="${SCRIPT_DIR}/sandbox-api.sh"

usage() {
  cat >&2 <<'USAGE'
Usage:
  sandbox-box.sh list
  sandbox-box.sh create <json-or-json-file>
  sandbox-box.sh get <boxId>
  sandbox-box.sh patch <boxId> <json-or-json-file>
  sandbox-box.sh delete <boxId> [force]
  sandbox-box.sh start <boxId>
  sandbox-box.sh stop <boxId>
  sandbox-box.sh status <boxId>
  sandbox-box.sh attach <boxId>
USAGE
  exit 1
}

json_arg() {
  local value="$1"
  if [[ -f "$value" ]]; then
    printf '@%s' "$value"
  else
    printf '%s' "$value"
  fi
}

ACTION="${1:-}"
[[ -n "$ACTION" ]] || usage
shift || true

case "$ACTION" in
  list)
    "$API_SCRIPT" GET /sandboxes/v1/boxes
    ;;
  create)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" POST /sandboxes/v1/boxes "$(json_arg "$1")"
    ;;
  get)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1"
    ;;
  patch)
    [[ $# -ge 2 ]] || usage
    "$API_SCRIPT" PATCH "/sandboxes/v1/boxes/$1" "$(json_arg "$2")"
    ;;
  delete)
    [[ $# -ge 1 ]] || usage
    PATH_PART="/sandboxes/v1/boxes/$1"
    if [[ "${2:-}" == "force" || "${2:-}" == "true" ]]; then
      PATH_PART="${PATH_PART}?force=true"
    fi
    "$API_SCRIPT" DELETE "$PATH_PART"
    ;;
  start)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" POST "/sandboxes/v1/boxes/$1/start" '{}'
    ;;
  stop)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" POST "/sandboxes/v1/boxes/$1/stop" '{}'
    ;;
  status)
    [[ $# -ge 1 ]] || usage
    "$API_SCRIPT" GET "/sandboxes/v1/boxes/$1/status"
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
