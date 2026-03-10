import { existsSync, statSync } from 'node:fs'
import { isAbsolute, normalize, posix } from 'node:path'
import type {
  AgentMount,
  CreateAgentMountRequest,
  UpdateAgentMountRequest,
} from '@dune/shared'
import { newId } from '../utils/ids.js'
import { getDb } from './database.js'

const WORKSPACE_ROOT = '/workspace'
const RESERVED_GUEST_PATHS = [
  '/config',
  '/config/memory',
  '/config/miniapps',
  '/config/.claude',
  '/config/.claude/skills',
]

type RuntimeVolumeMount = {
  hostPath: string
  guestPath: string
  readOnly: boolean
}

function boolToDb(value: boolean): number {
  return value ? 1 : 0
}

function boolFromDb(value: unknown): boolean {
  return Number(value) === 1
}

function mapRow(row: any): AgentMount {
  return {
    id: String(row.id),
    agentId: String(row.agentId),
    hostPath: String(row.hostPath),
    guestPath: String(row.guestPath),
    readOnly: boolFromDb(row.readOnly),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }
}

function isPathWithin(basePath: string, candidatePath: string): boolean {
  const rel = posix.relative(basePath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !posix.isAbsolute(rel))
}

function pathsOverlap(pathA: string, pathB: string): boolean {
  return isPathWithin(pathA, pathB) || isPathWithin(pathB, pathA)
}

function normalizeHostPath(input: string): string {
  const raw = (input || '').trim()
  if (!raw || !isAbsolute(raw) || raw.includes('\0')) {
    throw new Error('invalid_host_path')
  }
  const normalized = normalize(raw)
  if (!existsSync(normalized)) {
    throw new Error('host_path_not_found')
  }
  const stat = statSync(normalized)
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error('invalid_host_path')
  }
  return normalized
}

function normalizeGuestPath(input: string): string {
  const raw = (input || '').trim()
  if (!raw || raw.includes('\0') || !raw.startsWith('/')) {
    throw new Error('invalid_guest_path')
  }
  const normalized = posix.normalize(raw)
  if (!normalized.startsWith('/')) {
    throw new Error('invalid_guest_path')
  }
  if (normalized.split('/').some((part) => part === '..')) {
    throw new Error('invalid_guest_path')
  }
  if (normalized === '/') {
    throw new Error('guest_path_outside_workspace')
  }
  const withoutTrailingSlash = normalized === '/' ? '/' : normalized.replace(/\/+$/, '')
  if (withoutTrailingSlash !== WORKSPACE_ROOT && !withoutTrailingSlash.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error('guest_path_outside_workspace')
  }
  return withoutTrailingSlash
}

function ensureGuestPathNotReserved(guestPath: string): void {
  for (const reservedPath of RESERVED_GUEST_PATHS) {
    if (pathsOverlap(guestPath, reservedPath)) {
      throw new Error('reserved_guest_path_conflict')
    }
  }
}

function ensureNoGuestPathConflict(
  agentId: string,
  guestPath: string,
  excludeMountId?: string,
): void {
  const mounts = listAgentRuntimeMounts(agentId)
  const conflict = mounts.find((mount) => {
    if (excludeMountId && mount.id === excludeMountId) return false
    return pathsOverlap(mount.guestPath, guestPath)
  })
  if (conflict) {
    throw new Error('guest_path_conflict')
  }
}

function normalizeCreateInput(
  agentId: string,
  input: CreateAgentMountRequest,
): RuntimeVolumeMount {
  const hostPath = normalizeHostPath(input.hostPath)
  const guestPath = normalizeGuestPath(input.guestPath)
  ensureGuestPathNotReserved(guestPath)
  ensureNoGuestPathConflict(agentId, guestPath)
  return {
    hostPath,
    guestPath,
    readOnly: input.readOnly ?? true,
  }
}

function normalizeUpdateInput(
  agentId: string,
  mountId: string,
  current: AgentMount,
  patch: UpdateAgentMountRequest,
): RuntimeVolumeMount {
  const hostPath = patch.hostPath === undefined ? current.hostPath : normalizeHostPath(patch.hostPath)
  const guestPath = patch.guestPath === undefined ? current.guestPath : normalizeGuestPath(patch.guestPath)
  ensureGuestPathNotReserved(guestPath)
  ensureNoGuestPathConflict(agentId, guestPath, mountId)
  return {
    hostPath,
    guestPath,
    readOnly: patch.readOnly ?? current.readOnly,
  }
}

export function listAgentRuntimeMounts(agentId: string): AgentMount[] {
  const rows = getDb().prepare(
    `SELECT
      id,
      agent_id as agentId,
      host_path as hostPath,
      guest_path as guestPath,
      read_only as readOnly,
      created_at as createdAt,
      updated_at as updatedAt
     FROM agent_runtime_mounts
     WHERE agent_id = ?
     ORDER BY created_at ASC, id ASC`
  ).all(agentId)
  return rows.map(mapRow)
}

export function getAgentRuntimeMount(agentId: string, mountId: string): AgentMount | null {
  const row = getDb().prepare(
    `SELECT
      id,
      agent_id as agentId,
      host_path as hostPath,
      guest_path as guestPath,
      read_only as readOnly,
      created_at as createdAt,
      updated_at as updatedAt
     FROM agent_runtime_mounts
     WHERE agent_id = ? AND id = ?`
  ).get(agentId, mountId)
  return row ? mapRow(row) : null
}

export function createAgentRuntimeMount(agentId: string, input: CreateAgentMountRequest): AgentMount {
  const normalized = normalizeCreateInput(agentId, input)
  const now = Date.now()
  const id = newId()
  try {
    getDb().prepare(
      `INSERT INTO agent_runtime_mounts (
        id,
        agent_id,
        host_path,
        guest_path,
        read_only,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, agentId, normalized.hostPath, normalized.guestPath, boolToDb(normalized.readOnly), now, now)
  } catch (err: any) {
    const message = String(err?.message || '')
    if (message.includes('agent_runtime_mounts.agent_id, agent_runtime_mounts.guest_path')) {
      throw new Error('guest_path_conflict')
    }
    throw err
  }
  const created = getAgentRuntimeMount(agentId, id)
  if (!created) throw new Error('mount_create_failed')
  return created
}

export function updateAgentRuntimeMount(
  agentId: string,
  mountId: string,
  patch: UpdateAgentMountRequest,
): AgentMount | null {
  const current = getAgentRuntimeMount(agentId, mountId)
  if (!current) return null

  const normalized = normalizeUpdateInput(agentId, mountId, current, patch)
  const now = Date.now()
  getDb().prepare(
    `UPDATE agent_runtime_mounts
     SET host_path = ?, guest_path = ?, read_only = ?, updated_at = ?
     WHERE agent_id = ? AND id = ?`
  ).run(normalized.hostPath, normalized.guestPath, boolToDb(normalized.readOnly), now, agentId, mountId)

  return getAgentRuntimeMount(agentId, mountId)
}

export function deleteAgentRuntimeMount(agentId: string, mountId: string): boolean {
  const result = getDb().prepare(
    'DELETE FROM agent_runtime_mounts WHERE agent_id = ? AND id = ?'
  ).run(agentId, mountId)
  return result.changes > 0
}

export function resolveAgentRuntimeVolumeMounts(agentId: string): RuntimeVolumeMount[] {
  const mounts = listAgentRuntimeMounts(agentId)
  const validated: RuntimeVolumeMount[] = []

  for (const mount of mounts) {
    let hostPath = mount.hostPath
    let guestPath = mount.guestPath
    try {
      hostPath = normalizeHostPath(mount.hostPath)
      guestPath = normalizeGuestPath(mount.guestPath)
      ensureGuestPathNotReserved(guestPath)
    } catch (err: any) {
      throw new Error(`invalid_runtime_mount:${mount.id}:${String(err?.message || 'invalid_mount')}`)
    }
    for (const previous of validated) {
      if (pathsOverlap(previous.guestPath, guestPath)) {
        throw new Error(`invalid_runtime_mount:${mount.id}:guest_path_conflict`)
      }
    }
    validated.push({
      hostPath,
      guestPath,
      readOnly: mount.readOnly,
    })
  }

  return validated
}
