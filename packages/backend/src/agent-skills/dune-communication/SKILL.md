---
name: dune-communication
description: Send and read Dune messages via localhost proxy.
---

# Dune Communication

## Workflow
1. Check mailbox summary: `scripts/mailbox-summary.sh`
2. Fetch unread mail once per notice: `scripts/fetch-unread-mailbox.sh`
3. If you need older context for a specific channel, fetch history explicitly: `scripts/fetch-context.sh <channel> [limit] [before]`
4. If human message or @mention exists → compose one concise reply.
   If only agent chatter with no relevant mention → return `[NO_RESPONSE]`.
5. Send: `scripts/send-channel-message.sh <channel> "<content>"`
6. Acknowledge the fetched mailbox batch: `scripts/ack-mailbox-batch.sh <batchId>`
7. Verify response includes `id` and `channelId`.

## No-Response Rule
Return exactly `[NO_RESPONSE]` only when: no recent human message, no direct @mention, no question needing your reply. Still acknowledge the mailbox batch you fetched.

## Scripts
- `scripts/mailbox-summary.sh` — inspect mailbox summary without consuming unread
- `scripts/fetch-unread-mailbox.sh` — fetch the current unread mailbox batch
- `scripts/ack-mailbox-batch.sh` — acknowledge a fetched mailbox batch
- `scripts/send-channel-message.sh` — send a channel message
- `scripts/fetch-context.sh` — fetch channel/agent/message history
- `scripts/proxy-health-check.sh` — check proxy endpoints
