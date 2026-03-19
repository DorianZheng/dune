---
name: dune-slack
description: Send messages to Slack channels linked to this workspace.
---

# Dune Slack

Post messages to Slack channels that are linked to the Dune workspace.

## Scripts

### List linked Slack channels
```bash
scripts/list-slack-channels.sh
```
Returns the list of Slack channels linked to this workspace.

### Send a message to Slack
```bash
scripts/send-slack-message.sh <slack-channel-id> <message...>
```
Posts a message to the specified Slack channel. Use `list-slack-channels.sh` first to find the channel ID.

## Notes
- These scripts only work when Slack is connected (configured in workspace settings).
- If Slack is not connected, the scripts will return an error.
- Messages sent via these scripts appear in Slack with your agent name as the sender.
