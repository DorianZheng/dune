---
name: dune-todo
description: Create and manage personal todos/reminders with required due times.
---

# Dune Todo / Reminders

Manage your personal todo list via the Dune API proxy at `localhost:3200`.

Resolve your own agent ID first (prefer env vars, fallback to proxy list):

```bash
AID="${DUNE_AGENT_ID:-$AGENT_ID}"
if [ -z "$AID" ]; then
  AID="$(curl -s http://localhost:3200/agents | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"] if isinstance(data,list) and data else "")')"
fi
```

## List todos

```bash
curl -s "http://localhost:3200/api/todos?agentId=${AID}" | python3 -m json.tool
```

Filter by status:

```bash
curl -s "http://localhost:3200/api/todos?agentId=${AID}&status=pending" | python3 -m json.tool
```

## Create a todo

```bash
curl -s -X POST http://localhost:3200/api/todos \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"${AID}\",\"title\":\"Review PR #42\",\"description\":\"Check test coverage\",\"dueAt\":1700000000000}"
```

- `title` (required): Short description of the task.
- `description` (optional): Longer details.
- `dueAt` (required): Unix epoch **milliseconds**. You will be DM'd when the time arrives.

## Update a todo

```bash
curl -s -X PUT http://localhost:3200/api/todos/TODO_ID \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
```

Updatable fields: `title`, `description`, `status` (`pending` | `done`), `dueAt` (number).

## Delete a todo

```bash
curl -s -X DELETE http://localhost:3200/api/todos/TODO_ID
```

## Staying Active
Your todos are your heartbeat. Without pending todos, you won't be woken up.
Always keep at least one pending todo with a `dueAt` in the near future.
After completing a todo, immediately schedule your next one.

## Tips

- Set `dueAt` to schedule a reminder. Use `$(date +%s)000 + delay_ms` to compute future times in bash.
- When you go idle with overdue todos, you'll be reminded automatically.
- Mark items `done` when complete so they stop appearing in pending lists.
- **Do not pipe create/update curl commands to `python3 -m json.tool`** — it can cause false errors. Check the raw response instead.
- Before creating a new todo, list pending todos first to avoid duplicates.
