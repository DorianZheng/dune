#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <slug> <name> [entry] [collection]" >&2
  exit 1
fi

SLUG="$1"
NAME="$2"
ENTRY="${3:-index.html}"
COLLECTION="${4:-Published}"
STATUS="building"
ORDER="100"
ROOT_DIR="${MINIAPP_ROOT:-/config/miniapps}"
APP_DIR="${ROOT_DIR}/${SLUG}"
MANIFEST_PATH="${APP_DIR}/app.json"

if [[ ! "$SLUG" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Invalid slug: ${SLUG}" >&2
  exit 1
fi

if [[ -z "$ENTRY" || "$ENTRY" == /* || "$ENTRY" == *".."* ]]; then
  echo "Invalid entry path: ${ENTRY}" >&2
  exit 1
fi

if [[ -e "$MANIFEST_PATH" ]]; then
  echo "Refusing to overwrite existing manifest: ${MANIFEST_PATH}" >&2
  exit 1
fi

mkdir -p "$APP_DIR"
mkdir -p "${APP_DIR}/$(dirname "$ENTRY")"

python3 - "$MANIFEST_PATH" "$SLUG" "$NAME" "$COLLECTION" "$STATUS" "$ENTRY" "$ORDER" <<'PY'
import json
import pathlib
import sys

manifest_path, slug, name, collection, status, entry, order = sys.argv[1:]
manifest = {
    "slug": slug,
    "name": name,
    "description": "",
    "collection": collection,
    "status": status,
    "entry": entry,
    "order": int(order),
    "tags": [],
}
pathlib.Path(manifest_path).write_text(json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
PY

ENTRY_PATH="${APP_DIR}/${ENTRY}"
if [[ ! -f "$ENTRY_PATH" ]]; then
  cat > "$ENTRY_PATH" <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${NAME}</title>
  </head>
  <body>
    <main>
      <h1>${NAME}</h1>
      <p>Miniapp scaffold created. Implement your UI here.</p>
    </main>
  </body>
</html>
HTML
fi

echo "Created miniapp scaffold at ${APP_DIR}"
echo "Manifest: ${MANIFEST_PATH}"
echo "Entry: ${ENTRY_PATH}"
