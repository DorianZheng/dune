import { getDb } from './database.js'

export type HostGrant = {
  agentId: string
  kind: 'app' | 'path'
  target: string
  expiresAt: number | null
  createdAt: number
}

export function listGrantsForAgent(agentId: string): HostGrant[] {
  const db = getDb()
  const now = Date.now()
  // Delete expired grants first
  db.prepare(`DELETE FROM agent_host_grants WHERE agent_id = ? AND expires_at IS NOT NULL AND expires_at < ?`).run(agentId, now)
  const rows = db.prepare(`SELECT agent_id, kind, target, expires_at, created_at FROM agent_host_grants WHERE agent_id = ?`).all(agentId) as any[]
  return rows.map((r) => ({
    agentId: r.agent_id,
    kind: r.kind,
    target: r.target,
    expiresAt: r.expires_at ?? null,
    createdAt: r.created_at,
  }))
}

export function hasGrant(agentId: string, kind: 'app' | 'path', target: string): boolean {
  const db = getDb()
  const now = Date.now()
  const row = db.prepare(
    `SELECT 1 FROM agent_host_grants WHERE agent_id = ? AND kind = ? AND target = ? AND (expires_at IS NULL OR expires_at > ?)`,
  ).get(agentId, kind, target, now)
  return !!row
}

export function upsertGrant(agentId: string, kind: 'app' | 'path', target: string, expiresAt: number | null): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO agent_host_grants (agent_id, kind, target, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, kind, target) DO UPDATE SET expires_at = excluded.expires_at, created_at = excluded.created_at
  `).run(agentId, kind, target, expiresAt, Date.now())
}

export function deleteGrant(agentId: string, kind: 'app' | 'path', target: string): boolean {
  const db = getDb()
  const result = db.prepare(`DELETE FROM agent_host_grants WHERE agent_id = ? AND kind = ? AND target = ?`).run(agentId, kind, target)
  return result.changes > 0
}

export function clearGrantsForAgent(agentId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM agent_host_grants WHERE agent_id = ?`).run(agentId)
}

export function clearExpiredGrants(): void {
  const db = getDb()
  db.prepare(`DELETE FROM agent_host_grants WHERE expires_at IS NOT NULL AND expires_at < ?`).run(Date.now())
}
