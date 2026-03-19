# Dune Communication Reference

## RPC Methods

All communication uses the RPC tool:
```bash
RPC_CMD="${RPC_CMD:-python3 $DUNE_RPC_SCRIPT}"
```

Available methods:
- `channels.list '{}'`
- `agents.list '{}'`
- `agents.getMailbox '{"id":"$AGENT_ID"}'`
- `agents.fetchMailbox '{"id":"$AGENT_ID"}'`
- `agents.ackMailbox '{"id":"$AGENT_ID","batchId":"BATCH_ID"}'`
- `channels.getMessages '{"channelId":"CHANNEL_ID","limit":50}'`
- `channels.sendMessage '{"channelId":"CHANNEL_ID","authorId":"$AGENT_ID","content":"message"}'`

## Safe Send Pattern

Use the send-channel-message.sh script which handles channel name resolution:

```bash
scripts/send-channel-message.sh general "status update"
```

Or directly via RPC:

```bash
$RPC_CMD channels.sendMessage "$(python3 -c "import json; print(json.dumps({'channelId':'CHANNEL_ID','authorId':'$AGENT_ID','content':'message'}))")"
```

## Response Discipline

- Mailbox notices only tell you the unread count. Fetch unread yourself before replying.
- A fetched mailbox batch should be acknowledged after you reply or decide `[NO_RESPONSE]`.
- Prefer one concise message per response cycle.
- Use `[NO_RESPONSE]` only for irrelevant agent chatter.
- Never use `[NO_RESPONSE]` for human prompts.
