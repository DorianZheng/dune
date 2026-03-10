import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type { Channel, CreateChannel } from '@dune/shared'

export function createChannel(data: CreateChannel): Channel {
  const db = getDb()
  const channel: Channel = {
    id: newId(),
    name: data.name,
    description: data.description || '',
    createdAt: Date.now(),
  }
  db.prepare('INSERT INTO channels (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
    channel.id, channel.name, channel.description, channel.createdAt
  )
  return channel
}

export function listChannels(): Channel[] {
  return getDb().prepare('SELECT id, name, description, created_at as createdAt FROM channels').all() as Channel[]
}

export function getChannel(id: string): Channel | undefined {
  const row = getDb().prepare('SELECT id, name, description, created_at as createdAt FROM channels WHERE id = ?').get(id)
  return row ? (row as Channel) : undefined
}

export function getChannelByName(name: string): Channel | undefined {
  const row = getDb().prepare('SELECT id, name, description, created_at as createdAt FROM channels WHERE name = ?').get(name)
  return row ? (row as Channel) : undefined
}

export function updateChannel(id: string, data: Partial<Pick<Channel, 'name' | 'description'>>): Channel | undefined {
  const ch = getChannel(id)
  if (!ch) return undefined
  const db = getDb()
  if (data.name !== undefined) {
    db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(data.name, id)
  }
  if (data.description !== undefined) {
    db.prepare('UPDATE channels SET description = ? WHERE id = ?').run(data.description, id)
  }
  return getChannel(id)
}

export function deleteChannel(id: string): boolean {
  const db = getDb()
  // Cascade: delete messages, subscriptions, and read cursors (handles both old and new DB schemas)
  db.prepare('DELETE FROM messages WHERE channel_id = ?').run(id)
  db.prepare('DELETE FROM subscriptions WHERE channel_id = ?').run(id)
  db.prepare('DELETE FROM agent_read_cursors WHERE channel_id = ?').run(id)
  const result = db.prepare('DELETE FROM channels WHERE id = ?').run(id)
  return result.changes > 0
}

// Subscriptions
export function subscribeAgent(agentId: string, channelId: string): void {
  const db = getDb()
  db.prepare('INSERT OR IGNORE INTO subscriptions (agent_id, channel_id) VALUES (?, ?)').run(agentId, channelId)
  // Set read cursor to now so agent only sees messages posted after joining (like Slack)
  db.prepare(
    'INSERT OR IGNORE INTO agent_read_cursors (agent_id, channel_id, last_read_timestamp) VALUES (?, ?, ?)'
  ).run(agentId, channelId, Date.now())
}

export function unsubscribeAgent(agentId: string, channelId: string): void {
  getDb().prepare('DELETE FROM subscriptions WHERE agent_id = ? AND channel_id = ?').run(agentId, channelId)
}

export function isAgentSubscribed(agentId: string, channelId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 as ok FROM subscriptions WHERE agent_id = ? AND channel_id = ? LIMIT 1')
    .get(agentId, channelId) as { ok: number } | undefined
  return !!row
}

export function getChannelSubscribers(channelId: string): string[] {
  return getDb().prepare('SELECT agent_id FROM subscriptions WHERE channel_id = ?').all(channelId).map((r: any) => r.agent_id)
}

export function getAgentSubscriptions(agentId: string): string[] {
  return getDb().prepare('SELECT channel_id FROM subscriptions WHERE agent_id = ?').all(agentId).map((r: any) => r.channel_id)
}
