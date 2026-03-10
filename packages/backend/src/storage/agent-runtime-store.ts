import { getDb } from './database.js'

export type AgentRuntimeState = {
  agentId: string
  sandboxName: string
  sandboxId: string
  guiHttpPort: number
  guiHttpsPort: number
  createdAt: number
  updatedAt: number
  lastStartedAt: number | null
  lastStoppedAt: number | null
}

type UpsertAgentRuntimeStateInput = {
  agentId: string
  sandboxName: string
  sandboxId: string
  guiHttpPort: number
  guiHttpsPort: number
  now?: number
  lastStartedAt?: number | null
  lastStoppedAt?: number | null
}

function mapRow(row: any): AgentRuntimeState {
  return {
    agentId: row.agentId,
    sandboxName: row.sandboxName,
    sandboxId: row.sandboxId,
    guiHttpPort: Number(row.guiHttpPort),
    guiHttpsPort: Number(row.guiHttpsPort),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    lastStartedAt: row.lastStartedAt == null ? null : Number(row.lastStartedAt),
    lastStoppedAt: row.lastStoppedAt == null ? null : Number(row.lastStoppedAt),
  }
}

export function getAgentRuntimeState(agentId: string): AgentRuntimeState | null {
  const row = getDb().prepare(
    `SELECT
      agent_id as agentId,
      sandbox_name as sandboxName,
      sandbox_id as sandboxId,
      gui_http_port as guiHttpPort,
      gui_https_port as guiHttpsPort,
      created_at as createdAt,
      updated_at as updatedAt,
      last_started_at as lastStartedAt,
      last_stopped_at as lastStoppedAt
    FROM agent_runtime_state
    WHERE agent_id = ?`
  ).get(agentId)

  return row ? mapRow(row) : null
}

export function listAgentRuntimeStates(limit = 500): AgentRuntimeState[] {
  const rows = getDb().prepare(
    `SELECT
      agent_id as agentId,
      sandbox_name as sandboxName,
      sandbox_id as sandboxId,
      gui_http_port as guiHttpPort,
      gui_https_port as guiHttpsPort,
      created_at as createdAt,
      updated_at as updatedAt,
      last_started_at as lastStartedAt,
      last_stopped_at as lastStoppedAt
    FROM agent_runtime_state
    ORDER BY updated_at DESC
    LIMIT ?`
  ).all(limit)

  return rows.map(mapRow)
}

export function upsertAgentRuntimeState(input: UpsertAgentRuntimeStateInput): AgentRuntimeState {
  const now = input.now ?? Date.now()

  getDb().prepare(
    `INSERT INTO agent_runtime_state (
      agent_id,
      sandbox_name,
      sandbox_id,
      gui_http_port,
      gui_https_port,
      created_at,
      updated_at,
      last_started_at,
      last_stopped_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      sandbox_name = excluded.sandbox_name,
      sandbox_id = excluded.sandbox_id,
      gui_http_port = excluded.gui_http_port,
      gui_https_port = excluded.gui_https_port,
      updated_at = excluded.updated_at,
      last_started_at = COALESCE(excluded.last_started_at, agent_runtime_state.last_started_at),
      last_stopped_at = COALESCE(excluded.last_stopped_at, agent_runtime_state.last_stopped_at)`
  ).run(
    input.agentId,
    input.sandboxName,
    input.sandboxId,
    input.guiHttpPort,
    input.guiHttpsPort,
    now,
    now,
    input.lastStartedAt ?? null,
    input.lastStoppedAt ?? null,
  )

  const state = getAgentRuntimeState(input.agentId)
  if (!state) {
    throw new Error(`Failed to upsert runtime state for agent ${input.agentId}`)
  }
  return state
}

export function touchAgentRuntimeStarted(agentId: string, ts: number): void {
  getDb().prepare(
    `UPDATE agent_runtime_state
    SET last_started_at = ?, updated_at = ?
    WHERE agent_id = ?`
  ).run(ts, ts, agentId)
}

export function touchAgentRuntimeStopped(agentId: string, ts: number): void {
  getDb().prepare(
    `UPDATE agent_runtime_state
    SET last_stopped_at = ?, updated_at = ?
    WHERE agent_id = ?`
  ).run(ts, ts, agentId)
}

export function deleteAgentRuntimeState(agentId: string): void {
  getDb().prepare('DELETE FROM agent_runtime_state WHERE agent_id = ?').run(agentId)
}
