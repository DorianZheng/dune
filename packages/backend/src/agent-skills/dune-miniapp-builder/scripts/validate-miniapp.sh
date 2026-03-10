#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <slug-or-app-dir> [miniapp-root]" >&2
  exit 1
fi

TARGET="$1"
ROOT_DIR="${2:-/config/miniapps}"

if [[ -d "$TARGET" ]]; then
  APP_DIR="$TARGET"
else
  APP_DIR="${ROOT_DIR}/${TARGET}"
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: ${APP_DIR}" >&2
  exit 1
fi

python3 - "$APP_DIR" <<'PY'
import json
import pathlib
import re
import sys

app_dir = pathlib.Path(sys.argv[1]).resolve()
manifest_path = app_dir / "app.json"
errors = []

if not manifest_path.exists() or not manifest_path.is_file():
  errors.append("Missing app.json")
  print(json.dumps({"ok": False, "appDir": str(app_dir), "errors": errors}, ensure_ascii=True, indent=2))
  sys.exit(1)

try:
  raw = json.loads(manifest_path.read_text(encoding="utf-8"))
except Exception as err:
  errors.append(f"Invalid app.json JSON: {err}")
  print(json.dumps({"ok": False, "appDir": str(app_dir), "errors": errors}, ensure_ascii=True, indent=2))
  sys.exit(1)

if not isinstance(raw, dict):
  errors.append("Manifest root must be an object")
  print(json.dumps({"ok": False, "appDir": str(app_dir), "errors": errors}, ensure_ascii=True, indent=2))
  sys.exit(1)

folder_name = app_dir.name
slug_source = raw.get("slug") if isinstance(raw.get("slug"), str) else folder_name
slug = slug_source.strip() if isinstance(slug_source, str) else ""
if not re.match(r"^[a-zA-Z0-9][a-zA-Z0-9-_]*$", slug):
  errors.append("Invalid slug; expected ^[a-zA-Z0-9][a-zA-Z0-9-_]*$")

entry_raw = raw.get("entry")
if isinstance(entry_raw, str):
  entry = entry_raw.strip()
elif entry_raw is None:
  entry = "index.html"
else:
  entry = "index.html"

entry_valid = True
if not entry:
  entry_valid = False
  errors.append("Invalid entry: empty path")
if entry.startswith("/") or ".." in entry or "\x00" in entry:
  entry_valid = False
  errors.append("Invalid entry: must be a safe relative path")

entry_path = None
if entry_valid:
  entry_path = (app_dir / entry).resolve()
  try:
    entry_path.relative_to(app_dir)
  except ValueError:
    entry_valid = False
    errors.append("Invalid entry: escapes app directory")

statuses = {"published", "building", "archived", "error"}
status_raw = raw.get("status") if isinstance(raw.get("status"), str) else "published"
status = status_raw if status_raw in statuses else "published"

entry_exists = bool(entry_valid and entry_path and entry_path.exists() and entry_path.is_file())
if not entry_exists:
  errors.append(f"Entry file not found: {entry}")

effective_status = status if entry_exists else "error"
openable = entry_exists and effective_status not in {"archived", "error"}

result = {
  "ok": len(errors) == 0,
  "appDir": str(app_dir),
  "manifestPath": str(manifest_path),
  "normalized": {
    "slug": slug,
    "entry": entry,
    "status": status,
    "effectiveStatus": effective_status,
    "entryExists": entry_exists,
    "openable": openable,
  },
  "errors": errors,
}
print(json.dumps(result, ensure_ascii=True, indent=2))
sys.exit(0 if len(errors) == 0 else 1)
PY
