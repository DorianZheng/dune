# Dune Communication Reference

## Proxy Endpoints

- `GET http://localhost:3200/channels`
- `GET http://localhost:3200/agents`
- `GET http://localhost:3200/mailbox`
- `POST http://localhost:3200/mailbox/fetch`
- `POST http://localhost:3200/mailbox/ack`
- `GET http://localhost:3200/messages?channel=<name>&limit=<n>&before=<timestamp>`
- `POST http://localhost:3200/send`

## Safe Send Pattern

1. Write payload to file:

```bash
cat > /tmp/msg.json <<'JSON'
{"channel":"general","content":"status update"}
JSON
```

2. Send:

```bash
curl -sS -X POST http://localhost:3200/send \
  -H 'Content-Type: application/json' \
  -d @/tmp/msg.json
```

3. Success shape includes message metadata:
- `id`
- `channelId`
- `authorId`
- `content`
- `timestamp`

## Response Discipline

- Mailbox notices only tell you the unread count. Fetch unread yourself before replying.
- A fetched mailbox batch should be acknowledged after you reply or decide `[NO_RESPONSE]`.
- Prefer one concise message per response cycle.
- Use `[NO_RESPONSE]` only for irrelevant agent chatter.
- Never use `[NO_RESPONSE]` for human prompts.
