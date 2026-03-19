---
name: dune-host-operator
description: Operate host apps and files through RPC with admin approval.
---

# Dune Host Operator

Use these scripts to interact with host macOS apps and files. Requests require admin approval on first use per app/path — subsequent operations auto-approve for the grant duration.

## Safety rules
- First use of an app or path requires human admin approval
- Once approved, subsequent operations on the same app/path auto-approve until the grant expires
- Use `scripts/host-status.sh` to check current permissions

## Scripts
- `scripts/host-overview.sh [bundleId]` — list visible windows
- `scripts/host-perceive.sh <mode> <bundleId> [query]` — perceive an app
- `scripts/host-act.sh '<json>'` — perform an action on an app
- `scripts/host-status.sh` — check permissions and availability
- `scripts/host-fs.sh '<json>'` — operate on host files

## Perceive modes
- `screenshot` — capture app window image
- `accessibility` — get UI element tree with coordinates
- `composite` — both screenshot + accessibility tree
- `find` — search for UI element by text (requires query argument)

## Act actions (valid values only)
- `click` / `double_click` / `right_click` — click at `point: {x, y}`
- `hover` — hover at `point: {x, y}`
- `drag` — drag from `point` to `toPoint`
- `scroll` — scroll at `point: {x, y}`
- `type` — type `text` into focused element
- `press` — press keyboard `key` (e.g. "Return", "Escape", "cmd+c")
- `select` / `focus` — select or focus an element
- `launch` / `close` — launch or close an app by bundleId
- `clipboard_read` / `clipboard_write` — read or write clipboard (no bundleId needed)
- `url` — open a `url` in default browser

## Filesystem ops (valid values only)
- `list` — list directory contents at `path`
- `read` — read file at `path`
- `write` — write `content` to file at `path`
- `delete` — delete file at `path`
- `search` — search for files matching `query` under `path`

**No other ops are allowed.** Do not invent ops like "exec", "run", "copy", etc.

## Examples
```bash
scripts/host-status.sh
scripts/host-overview.sh com.apple.Safari
scripts/host-perceive.sh screenshot com.apple.Safari
scripts/host-act.sh '{"action":"click","bundleId":"com.apple.Safari","point":{"x":320,"y":240}}'
scripts/host-act.sh '{"action":"url","url":"https://example.com"}'
scripts/host-act.sh '{"action":"type","bundleId":"com.apple.Safari","text":"hello"}'
scripts/host-act.sh '{"action":"press","bundleId":"com.apple.Safari","key":"Return"}'
scripts/host-act.sh '{"action":"launch","bundleId":"com.apple.Safari"}'
scripts/host-fs.sh '{"op":"read","path":"/Users/admin/Documents/note.txt"}'
scripts/host-fs.sh '{"op":"list","path":"/Users/admin/Documents"}'
scripts/host-fs.sh '{"op":"write","path":"/Users/admin/Documents/out.txt","content":"hello"}'
```
