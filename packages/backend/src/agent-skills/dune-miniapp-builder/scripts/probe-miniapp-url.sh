#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <url> [expected_marker]" >&2
  exit 1
fi

URL="$1"
EXPECTED_MARKER="${2:-}"
HEADERS_FILE="/tmp/miniapp-probe-headers.txt"
BODY_FILE="/tmp/miniapp-probe-body.html"

STATUS="$(curl -sS -L -o "$BODY_FILE" -D "$HEADERS_FILE" -w "%{http_code}" "$URL")"

echo "HTTP status: ${STATUS}"
if [[ "$STATUS" != "200" ]]; then
  echo "Probe failed: non-200 status" >&2
  tail -n 20 "$HEADERS_FILE" >&2 || true
  exit 1
fi

if grep -q "404 Not Found" "$BODY_FILE"; then
  echo "Probe failed: body contains 404 marker" >&2
  exit 1
fi

if [[ -n "$EXPECTED_MARKER" ]]; then
  if grep -q "$EXPECTED_MARKER" "$BODY_FILE"; then
    echo "Marker found: ${EXPECTED_MARKER}"
  else
    echo "Probe failed: expected marker not found: ${EXPECTED_MARKER}" >&2
    exit 1
  fi
fi

echo "Probe OK"
