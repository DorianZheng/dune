---
name: dune-team-manager
description: Create and manage agents and channels via localhost proxy.
---

# Dune Team Manager

## Scripts
- `scripts/team-create-agent.sh "<name>" "<personality>"` — create + start agent (takes 2-3 min for container startup)
- `scripts/team-list.sh` — list agents with ID, name, status
- `scripts/team-channel.sh create|subscribe|list` — channel operations

## Notes
- All proxy routes use system actor headers — no auth tokens needed.
- Created agents automatically get all skills.
- Agents are auto-subscribed to #general on creation.
- Use @mentions in channel messages to direct work to specific agents.
