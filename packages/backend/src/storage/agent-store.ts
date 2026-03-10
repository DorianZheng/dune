import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type { Agent, CreateAgent, HostExecApprovalModeType, Message } from '@dune/shared'

const DEFAULT_HOST_EXEC_APPROVAL_MODE: HostExecApprovalModeType = 'approval-required'
const AGENT_SELECT_COLUMNS = [
  'id',
  'name',
  'personality',
  'host_exec_approval_mode as hostExecApprovalMode',
  'status',
  'avatar_color as avatarColor',
  'created_at as createdAt',
].join(', ')

export function createAgent(data: CreateAgent): Agent {
  const db = getDb()
  const agent: Agent = {
    id: newId(),
    name: data.name,
    personality: data.personality,
    hostExecApprovalMode: DEFAULT_HOST_EXEC_APPROVAL_MODE,
    status: 'stopped',
    avatarColor: data.avatarColor || randomColor(),
    createdAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO agents (id, name, personality, host_exec_approval_mode, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    agent.id,
    agent.name,
    agent.personality,
    agent.hostExecApprovalMode,
    agent.status,
    agent.avatarColor,
    agent.createdAt,
  )
  return agent
}

export function listAgents(): Agent[] {
  return getDb().prepare(`SELECT ${AGENT_SELECT_COLUMNS} FROM agents`).all() as Agent[]
}

export function getAgent(id: string): Agent | undefined {
  return getDb().prepare(`SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE id = ?`).get(id) as Agent | undefined
}

export function updateAgent(
  id: string,
  data: Partial<Pick<Agent, 'name' | 'personality' | 'hostExecApprovalMode' | 'status' | 'avatarColor'>>,
): Agent | undefined {
  const agent = getAgent(id)
  if (!agent) return undefined
  const updates: string[] = []
  const values: any[] = []
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.personality !== undefined) { updates.push('personality = ?'); values.push(data.personality) }
  if (data.hostExecApprovalMode !== undefined) {
    updates.push('host_exec_approval_mode = ?')
    values.push(data.hostExecApprovalMode)
  }
  if (data.status !== undefined) { updates.push('status = ?'); values.push(data.status) }
  if (data.avatarColor !== undefined) { updates.push('avatar_color = ?'); values.push(data.avatarColor) }
  if (updates.length > 0) {
    values.push(id)
    getDb().prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }
  return getAgent(id)
}

export function deleteAgent(id: string): boolean {
  const db = getDb()
  // Cascade: delete subscriptions and read cursors (handles both old and new DB schemas)
  db.prepare('DELETE FROM subscriptions WHERE agent_id = ?').run(id)
  db.prepare('DELETE FROM agent_read_cursors WHERE agent_id = ?').run(id)
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  return result.changes > 0
}

export function updateAgentStatus(id: string, status: string): void {
  getDb().prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id)
}

export function resetAllStatuses(): void {
  getDb().prepare("UPDATE agents SET status = 'stopped'").run()
}

// ── Read cursors ──────────────────────────────────────────────────────

export function setReadCursor(agentId: string, channelId: string, timestamp: number): void {
  getDb().prepare(
    `INSERT INTO agent_read_cursors (agent_id, channel_id, last_read_timestamp)
     VALUES (?, ?, ?)
     ON CONFLICT(agent_id, channel_id)
     DO UPDATE SET last_read_timestamp = MAX(agent_read_cursors.last_read_timestamp, excluded.last_read_timestamp)`
  ).run(agentId, channelId, timestamp)
}

export function getReadCursor(agentId: string, channelId: string): number {
  const row = getDb().prepare(
    'SELECT last_read_timestamp FROM agent_read_cursors WHERE agent_id = ? AND channel_id = ?'
  ).get(agentId, channelId) as { last_read_timestamp: number } | undefined
  return row?.last_read_timestamp ?? 0
}

export interface UnreadChannel {
  channelId: string
  channelName: string
  messages: Message[]
}

export function getUnreadMessages(agentId: string): UnreadChannel[] {
  const db = getDb()

  // Get all subscribed channels with their cursor positions
  const channels = db.prepare(`
    SELECT s.channel_id, c.name as channel_name,
           COALESCE(cur.last_read_timestamp, 0) as cursor_ts
    FROM subscriptions s
    JOIN channels c ON c.id = s.channel_id
    LEFT JOIN agent_read_cursors cur
      ON cur.agent_id = s.agent_id AND cur.channel_id = s.channel_id
    WHERE s.agent_id = ?
  `).all(agentId) as Array<{ channel_id: string; channel_name: string; cursor_ts: number }>

  const result: UnreadChannel[] = []

  for (const ch of channels) {
    const rows = db.prepare(`
      SELECT id, channel_id as channelId, author_id as authorId,
             content, timestamp, mentioned_agent_ids as mentionedAgentIds
      FROM messages
      WHERE channel_id = ? AND timestamp > ? AND author_id != ?
      ORDER BY timestamp ASC
      LIMIT 50
    `).all(ch.channel_id, ch.cursor_ts, agentId) as any[]

    if (rows.length > 0) {
      result.push({
        channelId: ch.channel_id,
        channelName: ch.channel_name,
        messages: rows.map(r => ({ ...r, mentionedAgentIds: JSON.parse(r.mentionedAgentIds || '[]') })),
      })
    }
  }

  return result
}

export function getAgentByName(name: string): Agent | undefined {
  return getDb().prepare(
    `SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE name = ?`
  ).get(name) as Agent | undefined
}

function randomColor(): string {
  const colors = ['#5b8af0', '#e94b8a', '#f5a623', '#7ed321', '#bd10e0', '#4a90e2', '#50c878', '#ff6b6b']
  return colors[Math.floor(Math.random() * colors.length)]
}
