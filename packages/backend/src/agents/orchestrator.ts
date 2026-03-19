import * as agentStore from '../storage/agent-store.js'
import * as channelStore from '../storage/channel-store.js'
import * as messageStore from '../storage/message-store.js'
import * as agentManager from './agent-manager.js'
import * as mailboxService from '../mailbox/mailbox-service.js'
import { sendToChannel as broadcastToChannel } from '../gateway/broadcast.js'
import type { Message } from '@dune/shared'

const MAX_CHAIN_DEPTH = 5

function getAuthorName(agentMap: Map<string, { name: string }>, authorId: string): string {
  return agentMap.get(authorId)?.name || (authorId === 'system' ? 'System' : 'User')
}

export async function onNewMessage(message: Message, chainDepth = 0): Promise<void> {
  const channel = channelStore.getChannel(message.channelId)
  if (!channel) return

  if (chainDepth >= MAX_CHAIN_DEPTH) {
    console.log(`Chain depth ${chainDepth} reached for channel ${channel.name}, stopping`)
    return
  }

  // Broadcast new message to WS clients (only for initial call — recursive calls
  // are already broadcast by the parent at the point of message creation)
  if (chainDepth === 0) {
    broadcastToChannel(message.channelId, { type: 'message:new', payload: message })
  }

  // Only respond to @mentions via push (non-mention messages handled by mailbox daemon polling)
  if (message.mentionedAgentIds.length === 0) return

  const subscribedAgentIds = channelStore.getChannelSubscribers(message.channelId)
  const agents = agentStore.listAgents()
  const agentMap = new Map(agents.map(a => [a.id, a]))

  // Filter to mentioned agents that are subscribed and running, excluding the sender
  const respondingAgentIds = message.mentionedAgentIds.filter(id =>
    id !== message.authorId &&
    subscribedAgentIds.includes(id) &&
    agentManager.isAgentRunning(id)
  )

  // Send feedback for mentioned agents that won't respond
  for (const id of message.mentionedAgentIds) {
    if (respondingAgentIds.includes(id) || id === message.authorId) continue
    const agent = agentMap.get(id)
    if (!agent) continue

    let reason: string
    if (!subscribedAgentIds.includes(id)) {
      reason = `**${agent.name}** is not in this channel.`
    } else if (!agentManager.isAgentRunning(id)) {
      reason = `**${agent.name}** is stopped. Click the agent to open their profile and start them.`
    } else {
      continue
    }

    const sysMsg = messageStore.createMessage(message.channelId, 'system', reason)
    broadcastToChannel(message.channelId, { type: 'message:new', payload: sysMsg })
  }

  for (const agentId of respondingAgentIds) {
    const agent = agentMap.get(agentId)
    if (!agent) continue

    const mentionLease = mailboxService.createMentionLease(agentId, message.channelId)
    if (!mentionLease || mentionLease.channels.length === 0) continue

    const contextMessages = mentionLease.channels.flatMap((channelBatch) =>
      channelBatch.messages.map((channelMessage) => ({
        authorName: getAuthorName(agentMap, channelMessage.authorId),
        content: channelMessage.content,
      })),
    )

    const otherAgents = agents.filter((candidate) => candidate.id !== agentId)
    if (otherAgents.length > 0) {
      const roster = otherAgents.map((candidate) => `${candidate.name} [${candidate.role}] (${candidate.personality.split('.')[0]})`).join(', ')
      contextMessages.push({ authorName: 'System', content: `[Team members: ${roster}]` })
    }

    // Broadcast typing indicator
    broadcastToChannel(message.channelId, {
      type: 'agent:typing',
      payload: { agentId, channelId: message.channelId, isTyping: true },
    })

    try {
      await agentManager.sendMessage(agentId, contextMessages, {
        source: 'channel',
        channels: mentionLease.channels.map((channelBatch) => ({
          name: channelBatch.channelName,
          messages: channelBatch.messages.map((channelMessage) => ({
            author: getAuthorName(agentMap, channelMessage.authorId),
            content: channelMessage.content,
          })),
        })),
      })
      mailboxService.ackMailboxBatch(agentId, mentionLease.batchId)
      // Stop channel typing indicator after completion
      broadcastToChannel(message.channelId, {
        type: 'agent:typing',
        payload: { agentId, channelId: message.channelId, isTyping: false },
      })
    } catch (err) {
      console.error(`Agent ${agent.name} failed to respond:`, err)
      mailboxService.expireMailboxBatch(agentId, mentionLease.batchId)
      broadcastToChannel(message.channelId, {
        type: 'agent:typing',
        payload: { agentId, channelId: message.channelId, isTyping: false },
      })
    }

    // Small delay between agents
    if (respondingAgentIds.length > 1) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }
}
