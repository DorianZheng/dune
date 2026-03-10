---
name: dune-miniapp-builder
description: Build and validate Dune miniapps under /config/miniapps.
---

# Dune Miniapp Builder

## App Layout
Each app lives at `/config/miniapps/<slug>/` with an `app.json` manifest and entry file.

## Manifest (`app.json`)
Fields: `slug`, `name`, `description`, `collection`, `status` (published|building|archived|error), `entry` (relative path, defaults to index.html), `order`, `tags`.
- slug must match `^[a-zA-Z0-9][a-zA-Z0-9-_]*$`
- `entry` must be relative and inside app directory

## Host-Bridge Protocol
Miniapp sends: `window.parent.postMessage({ type: 'dune:miniapp-action', requestId, action, payload }, '*')`
Host replies: `window.postMessage({ type: 'dune:miniapp-action-result', requestId, ok, response }, origin)`
Always handle `ok:false` with user-visible error state.

## Workflow
1. Scaffold: `scripts/scaffold-miniapp.sh <slug> "<name>" [entry] [collection]`
2. Implement UI and assets.
3. Validate: `scripts/validate-miniapp.sh <slug>`
4. Probe URL (if available): `scripts/probe-miniapp-url.sh <url> [expected_marker]`
5. Tell user about the app using `[app:<slug>]` syntax so they see a clickable button, or they can find it in the Apps sidebar.

## Scripts
- `scripts/scaffold-miniapp.sh` — create folder, manifest, starter entry
- `scripts/validate-miniapp.sh` — validate manifest/path safety/openability
- `scripts/probe-miniapp-url.sh` — HTTP probe for runtime app URL
