import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type {
  Agent,
  AgentRoleType,
  AgentWorkModeType,
  CreateAgent,
  HostOperatorApprovalModeType,
  Message,
} from '@dune/shared'

const DEFAULT_HOST_OPERATOR_APPROVAL_MODE: HostOperatorApprovalModeType = 'approval-required'
const DEFAULT_AGENT_ROLE: AgentRoleType = 'follower'
const DEFAULT_AGENT_WORK_MODE: AgentWorkModeType = 'normal'
const AGENT_SELECT_COLUMNS = [
  'id',
  'name',
  'personality',
  'role',
  'work_mode as workMode',
  'model_id_override as modelIdOverride',
  'host_operator_approval_mode as hostOperatorApprovalMode',
  'host_operator_apps_json as hostOperatorAppsJson',
  'host_operator_paths_json as hostOperatorPathsJson',
  'status',
  'avatar_color as avatarColor',
  'created_at as createdAt',
].join(', ')

type AgentRow = Agent & {
  hostOperatorAppsJson?: string
  hostOperatorPathsJson?: string
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'))
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item))
  } catch {
    return []
  }
}

function normalizeAgent(row: AgentRow): Agent {
  return {
    ...row,
    hostOperatorApps: parseJsonArray(row.hostOperatorAppsJson),
    hostOperatorPaths: parseJsonArray(row.hostOperatorPathsJson),
  }
}

function getDefaultWorkMode(role: AgentRoleType): AgentWorkModeType {
  return role === 'leader' ? 'plan-first' : DEFAULT_AGENT_WORK_MODE
}

function getDefaultModelIdOverride(role: AgentRoleType): string | null {
  return role === 'leader' ? 'opus' : null
}

export function createAgent(data: CreateAgent): Agent {
  const db = getDb()
  const role = data.role ?? DEFAULT_AGENT_ROLE
  const agent: Agent = {
    id: newId(),
    name: data.name,
    personality: data.personality,
    role,
    workMode: data.workMode ?? getDefaultWorkMode(role),
    modelIdOverride: data.modelIdOverride === undefined ? getDefaultModelIdOverride(role) : data.modelIdOverride,
    hostOperatorApprovalMode: DEFAULT_HOST_OPERATOR_APPROVAL_MODE,
    hostOperatorApps: [],
    hostOperatorPaths: [],
    status: 'stopped',
    avatarColor: data.avatarColor || randomColor(),
    createdAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO agents (id, name, personality, role, work_mode, model_id_override, host_exec_approval_mode, host_operator_approval_mode, host_operator_apps_json, host_operator_paths_json, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    agent.id,
    agent.name,
    agent.personality,
    agent.role,
    agent.workMode,
    agent.modelIdOverride,
    agent.hostOperatorApprovalMode,
    agent.hostOperatorApprovalMode,
    JSON.stringify(agent.hostOperatorApps),
    JSON.stringify(agent.hostOperatorPaths),
    agent.status,
    agent.avatarColor,
    agent.createdAt,
  )
  return agent
}

export function listAgents(): Agent[] {
  const rows = getDb().prepare(`SELECT ${AGENT_SELECT_COLUMNS} FROM agents`).all() as AgentRow[]
  return rows.map(normalizeAgent)
}

export function getAgent(id: string): Agent | undefined {
  const row = getDb().prepare(`SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE id = ?`).get(id) as AgentRow | undefined
  return row ? normalizeAgent(row) : undefined
}

export function updateAgent(
  id: string,
  data: Partial<Pick<Agent, 'name' | 'personality' | 'role' | 'workMode' | 'modelIdOverride' | 'hostOperatorApprovalMode' | 'hostOperatorApps' | 'hostOperatorPaths' | 'status' | 'avatarColor'>>,
): Agent | undefined {
  const agent = getAgent(id)
  if (!agent) return undefined
  const updates: string[] = []
  const values: any[] = []
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
  if (data.personality !== undefined) { updates.push('personality = ?'); values.push(data.personality) }
  if (data.role !== undefined) { updates.push('role = ?'); values.push(data.role) }
  if (data.workMode !== undefined) { updates.push('work_mode = ?'); values.push(data.workMode) }
  if (data.modelIdOverride !== undefined) { updates.push('model_id_override = ?'); values.push(data.modelIdOverride) }
  if (data.hostOperatorApprovalMode !== undefined) {
    updates.push('host_operator_approval_mode = ?')
    values.push(data.hostOperatorApprovalMode)
  }
  if (data.hostOperatorApps !== undefined) { updates.push('host_operator_apps_json = ?'); values.push(JSON.stringify(data.hostOperatorApps)) }
  if (data.hostOperatorPaths !== undefined) { updates.push('host_operator_paths_json = ?'); values.push(JSON.stringify(data.hostOperatorPaths)) }
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
