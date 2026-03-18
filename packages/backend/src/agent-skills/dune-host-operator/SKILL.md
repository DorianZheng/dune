---
name: dune-host-operator
description: Operate allowed host apps and files through the localhost host-operator proxy.
---

# Dune Host Operator

Use the localhost host-operator proxy at `http://localhost:3200/host/v1/...`.

## Safety rules
- Host operator requests require human admin approval by default.
- Agents configured to dangerously skip permissions may run host operator requests immediately after backend allowlist checks.
- App interaction is limited to the bundle IDs configured on the agent.
- Filesystem ops are limited to the host paths configured on the agent.
- Use `scripts/host-status.sh` first when permissions or platform support are unclear.

## Script
- `scripts/host-overview.sh` — list visible windows for allowed apps
- `scripts/host-perceive.sh` — request accessibility, screenshot, composite, or find perception
- `scripts/host-act.sh` — perform a structured host action
- `scripts/host-status.sh` — check host helper availability and permissions
- `scripts/host-fs.sh` — operate on allowed host paths

## Quick Examples
```bash
scripts/host-status.sh
scripts/host-overview.sh com.apple.Safari
scripts/host-perceive.sh composite com.apple.Safari
scripts/host-act.sh '{"action":"click","bundleId":"com.apple.Safari","point":{"x":320,"y":240}}'
scripts/host-fs.sh '{"op":"read","path":"/Users/admin/Documents/note.txt"}'
```
