#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <METHOD> <PATH> [BODY_OR_AT_FILE] [curl args...]" >&2
  echo "Example: $0 GET /sandboxes/v1/boxes" >&2
  exit 1
fi

METHOD="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
PATH_PART="$2"
shift 2

BASE_URL="${SANDBOX_PROXY_URL:-http://localhost:3200}"
URL="${BASE_URL}${PATH_PART}"

BODY_ARG=""
if [[ $# -gt 0 ]]; then
  case "$METHOD" in
    GET|DELETE)
      ;;
    *)
      BODY_ARG="$1"
      shift
      ;;
  esac
fi

CURL_ARGS=("-sS" "-X" "$METHOD" "$URL")

if [[ -n "$BODY_ARG" ]]; then
  if [[ "$BODY_ARG" == @* ]]; then
    FILE_PATH="${BODY_ARG#@}"
    CURL_ARGS+=("-H" "Content-Type: application/json" "--data-binary" "@${FILE_PATH}")
  elif [[ -f "$BODY_ARG" ]]; then
    CURL_ARGS+=("-H" "Content-Type: application/json" "--data-binary" "@${BODY_ARG}")
  else
    CURL_ARGS+=("-H" "Content-Type: application/json" "-d" "$BODY_ARG")
  fi
fi

if [[ $# -gt 0 ]]; then
  CURL_ARGS+=("$@")
fi

curl "${CURL_ARGS[@]}"
