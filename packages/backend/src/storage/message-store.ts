import { getDb } from './database.js'
import { newEventId } from '../utils/ids.js'
import type { Message } from '@dune/shared'

export function createMessage(channelId: string, authorId: string, content: string, mentionedAgentIds: string[] = []): Message {
  const msg: Message = {
    id: newEventId(),
    channelId,
    authorId,
    content,
    timestamp: Date.now(),
    mentionedAgentIds,
  }
  getDb().prepare('INSERT INTO messages (id, channel_id, author_id, content, timestamp, mentioned_agent_ids) VALUES (?, ?, ?, ?, ?, ?)').run(
    msg.id, msg.channelId, msg.authorId, msg.content, msg.timestamp, JSON.stringify(msg.mentionedAgentIds)
  )
  return msg
}

export function getChannelMessages(channelId: string, limit = 50, before?: number): Message[] {
  const db = getDb()
  const cappedLimit = Math.max(1, Math.min(limit, 200))
  if (before !== undefined) {
    return db.prepare('SELECT id, channel_id as channelId, author_id as authorId, content, timestamp, mentioned_agent_ids as mentionedAgentIds FROM messages WHERE channel_id = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?')
      .all(channelId, before, cappedLimit).map(mapMessage).reverse()
  }
  return db.prepare('SELECT id, channel_id as channelId, author_id as authorId, content, timestamp, mentioned_agent_ids as mentionedAgentIds FROM messages WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(channelId, cappedLimit).map(mapMessage).reverse()
}

export function getMessage(id: string): Message | undefined {
  const row = getDb().prepare('SELECT id, channel_id as channelId, author_id as authorId, content, timestamp, mentioned_agent_ids as mentionedAgentIds FROM messages WHERE id = ?').get(id)
  return row ? mapMessage(row as any) : undefined
}

export function updateMessageContent(id: string, content: string): void {
  getDb().prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, id)
}

function mapMessage(row: any): Message {
  return { ...row, mentionedAgentIds: JSON.parse(row.mentionedAgentIds || '[]') }
}
