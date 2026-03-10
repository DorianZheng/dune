---
name: dune-host-operator
description: Request host command execution via localhost proxy with agent-configured approval policy.
---

# Dune Host Operator

Use `http://localhost:3200/host/v1/exec` to request host command execution.

## Safety rules
- Host exec requires human admin approval by default.
- Agents configured to dangerously skip permissions may run host exec immediately without approval.
- Use structured command + args only.
- Default scope is `workspace`.
- Use `full-host` only when explicitly needed.

## Script
- `scripts/host-exec.sh` — send host command request and wait for final result.

## Quick Examples
```bash
scripts/host-exec.sh workspace /workspace pwd
scripts/host-exec.sh workspace /workspace ls -la
scripts/host-exec.sh full-host /Users/admin uname -a
```
