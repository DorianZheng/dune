---
name: dune-todo
description: Create and manage personal todos/reminders with required due times.
---

# Dune Todo / Reminders

Manage your personal todo list via the Dune RPC tool.

```bash
RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"
AID="${DUNE_AGENT_ID:-$AGENT_ID}"
```

## List todos

```bash
$RPC_CMD todos.list "{\"agentId\":\"${AID}\"}"
```

Filter by status:

```bash
$RPC_CMD todos.list "{\"agentId\":\"${AID}\",\"status\":\"pending\"}"
```

## Create a todo

```bash
$RPC_CMD todos.create "{\"agentId\":\"${AID}\",\"title\":\"Review PR #42\",\"description\":\"Check test coverage\",\"dueAt\":1700000000000}"
```

- `title` (required): Short description of the task.
- `description` (optional): Longer details.
- `dueAt` (required): Unix epoch **milliseconds**. You will be DM'd when the time arrives.
- On create, the backend snapshots `originalTitle` and `originalDescription` from this initial request.

## Update a todo

```bash
$RPC_CMD todos.update "{\"id\":\"TODO_ID\",\"status\":\"done\"}"
```

Updatable fields: `title`, `description`, `status` (`pending` | `done`), `dueAt` (number).
- `nextPlan` is also updatable and is the preferred place for leader handoff planning.
- `originalTitle` and `originalDescription` are immutable snapshots owned by the backend. Do not try to rewrite them.

## Delete a todo

```bash
$RPC_CMD todos.delete "{\"id\":\"TODO_ID\"}"
```

## Staying Active
Followers use todos as their heartbeat. Keep at least one pending todo with a `dueAt` in the near future.
Leaders should use follower-owned todos for delegated work and leader-owned todos only for coordination, follow-up, escalation, check-ins, and review.

## Tips

- Set `dueAt` to schedule a reminder. Use `$(date +%s)000 + delay_ms` to compute future times in bash.
- When you go idle, you'll be reminded automatically to either plan the next step or preserve the original request, depending on your role.
- Mark items `done` when complete so they stop appearing in pending lists.
- Before creating a new todo, list pending todos first to avoid duplicates.
- Leaders should assign work through a follower-owned todo plus a concise message.
- Leaders should keep `nextPlan` current only as an optional operational note after a `dune-leader` PDCA cycle.
- If a leader goes idle, use `dune-leader` and end with the required `Leader PDCA` footer.
- Leaders do not create implementation todos for themselves.
- Followers should preserve the original request snapshot and keep progress in working fields or memory.
