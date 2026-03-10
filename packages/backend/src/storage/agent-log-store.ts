import type { AgentLogEntry } from '@dune/shared'
import { getDb } from './database.js'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const RETENTION_MAX_ROWS_PER_AGENT = 10_000
const RETENTION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000

let retentionSweepTimer: ReturnType<typeof setInterval> | null = null

type AgentLogRow = {
  seq: number
  id: string
  agentId: string
  timestamp: number
  type: AgentLogEntry['type']
  dataJson: string
}

export type AgentLogsPage = {
  entries: AgentLogEntry[]
  nextBeforeSeq: number | null
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit as number)))
}

function mapRow(row: AgentLogRow): AgentLogEntry {
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(row.dataJson || '{}')
  } catch {
    data = {}
  }
  return {
    id: row.id,
    agentId: row.agentId,
    timestamp: row.timestamp,
    type: row.type,
    data,
  }
}

function retentionCutoff(now: number): number {
  return now - RETENTION_MAX_AGE_MS
}

function pruneAgentLogsByAge(agentId: string, cutoffTimestamp: number): void {
  getDb()
    .prepare('DELETE FROM agent_logs WHERE agent_id = ? AND timestamp < ?')
    .run(agentId, cutoffTimestamp)
}

function pruneAgentLogsByCount(agentId: string): void {
  getDb()
    .prepare(
      `DELETE FROM agent_logs
       WHERE agent_id = ?
         AND seq < (
           SELECT seq
           FROM agent_logs
           WHERE agent_id = ?
           ORDER BY seq DESC
           LIMIT 1 OFFSET ?
         )`
    )
    .run(agentId, agentId, RETENTION_MAX_ROWS_PER_AGENT - 1)
}

export function pruneAgentLogsForAgent(agentId: string, now = Date.now()): void {
  const cutoffTimestamp = retentionCutoff(now)
  const db = getDb()
  const tx = db.transaction(() => {
    pruneAgentLogsByAge(agentId, cutoffTimestamp)
    pruneAgentLogsByCount(agentId)
  })
  tx()
}

export function runAgentLogRetentionSweep(now = Date.now()): void {
  const cutoffTimestamp = retentionCutoff(now)
  const db = getDb()
  const sweepTx = db.transaction(() => {
    db.prepare('DELETE FROM agent_logs WHERE timestamp < ?').run(cutoffTimestamp)
    const overloadedAgents = db
      .prepare(
        `SELECT agent_id as agentId
         FROM agent_logs
         GROUP BY agent_id
         HAVING COUNT(*) > ?`
      )
      .all(RETENTION_MAX_ROWS_PER_AGENT) as Array<{ agentId: string }>

    for (const row of overloadedAgents) {
      pruneAgentLogsByCount(row.agentId)
    }
  })
  sweepTx()
}

export function startAgentLogRetentionSweepScheduler(): void {
  if (retentionSweepTimer) return
  runAgentLogRetentionSweep()
  retentionSweepTimer = setInterval(() => {
    try {
      runAgentLogRetentionSweep()
    } catch (err) {
      console.error('Agent log retention sweep failed:', err)
    }
  }, RETENTION_SWEEP_INTERVAL_MS)
  retentionSweepTimer.unref()
}

export function stopAgentLogRetentionSweepScheduler(): void {
  if (!retentionSweepTimer) return
  clearInterval(retentionSweepTimer)
  retentionSweepTimer = null
}

export function addAgentLogs(agentId: string, entries: AgentLogEntry[]): void {
  if (entries.length === 0) return
  const db = getDb()
  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO agent_logs (agent_id, id, timestamp, type, data_json) VALUES (?, ?, ?, ?, ?)'
  )
  const now = Date.now()
  const insertMany = db.transaction((rows: AgentLogEntry[]) => {
    for (const entry of rows) {
      insertStmt.run(agentId, entry.id, entry.timestamp, entry.type, JSON.stringify(entry.data ?? {}))
    }
    pruneAgentLogsByAge(agentId, retentionCutoff(now))
    pruneAgentLogsByCount(agentId)
  })
  insertMany(entries)
}

export function getAgentLogs(
  agentId: string,
  options: { limit?: number; beforeSeq?: number } = {},
): AgentLogsPage {
  const limit = clampLimit(options.limit)
  const beforeSeq = options.beforeSeq
  const queryLimit = limit + 1
  const db = getDb()

  const rows = (beforeSeq == null
    ? db.prepare(
      `SELECT seq, id, agent_id as agentId, timestamp, type, data_json as dataJson
       FROM agent_logs
       WHERE agent_id = ?
       ORDER BY seq DESC
       LIMIT ?`
    ).all(agentId, queryLimit)
    : db.prepare(
      `SELECT seq, id, agent_id as agentId, timestamp, type, data_json as dataJson
       FROM agent_logs
       WHERE agent_id = ? AND seq < ?
       ORDER BY seq DESC
       LIMIT ?`
    ).all(agentId, beforeSeq, queryLimit)) as AgentLogRow[]

  const hasMore = rows.length > limit
  const pageRowsDesc = rows.slice(0, limit)
  const oldestReturnedSeq = pageRowsDesc.length > 0 ? pageRowsDesc[pageRowsDesc.length - 1].seq : null

  return {
    entries: pageRowsDesc.reverse().map(mapRow),
    nextBeforeSeq: hasMore ? oldestReturnedSeq : null,
  }
}

export function clearAgentLogs(agentId: string): void {
  getDb().prepare('DELETE FROM agent_logs WHERE agent_id = ?').run(agentId)
}

export const __retentionConstantsForTests = {
  RETENTION_MAX_ROWS_PER_AGENT,
  RETENTION_MAX_AGE_MS,
}
