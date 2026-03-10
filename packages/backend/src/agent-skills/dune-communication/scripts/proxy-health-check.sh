#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3200}"

check() {
  local path="$1"
  local code
  code="$(curl -sS -o /tmp/dune-health.out -w "%{http_code}" "${BASE_URL}${path}")"
  if [[ "$code" -ge 200 && "$code" -lt 300 ]]; then
    echo "OK  ${path} (${code})"
  else
    echo "ERR ${path} (${code})"
    cat /tmp/dune-health.out
    return 1
  fi
}

check "/channels"
check "/agents"
check "/mailbox"
check "/messages?channel=general&limit=1"
