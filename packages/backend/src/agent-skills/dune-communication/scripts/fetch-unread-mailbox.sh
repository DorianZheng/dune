#!/usr/bin/env bash
set -euo pipefail

curl -sS -X POST "http://localhost:3200/mailbox/fetch"
echo
