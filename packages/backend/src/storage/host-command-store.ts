import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type {
  HostCommandDecisionType,
  HostCommandRequest,
  HostCommandScopeType,
  HostCommandStatusType,
  SandboxActorTypeType,
} from '@dune/shared'

type StoredHostCommandRow = {
  requestId: string
  agentId: string
  requestedByType: SandboxActorTypeType
  requestedById: string
  command: string
  args: string[]
  cwd: string
  scope: HostCommandScopeType
  status: HostCommandStatusType
  createdAt: number
  decidedAt: number | null
  startedAt: number | null
  completedAt: number | null
  approverId: string | null
  decision: HostCommandDecisionType | null
  elevatedConfirmed: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  errorMessage: string | null
}

type CreateHostCommandInput = {
  agentId: string
  requestedByType: SandboxActorTypeType
  requestedById: string
  command: string
  args: string[]
  cwd: string
  scope: HostCommandScopeType
}

type UpdateHostCommandPatch = Partial<{
  status: HostCommandStatusType
  decidedAt: number | null
  startedAt: number | null
  completedAt: number | null
  approverId: string | null
  decision: HostCommandDecisionType | null
  elevatedConfirmed: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  errorMessage: string | null
}>

function boolFromDb(value: unknown): boolean {
  return Number(value) === 1
}

function boolToDb(value: boolean): number {
  return value ? 1 : 0
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item))
  } catch {
    return []
  }
}

function mapRow(row: any): StoredHostCommandRow {
  return {
    requestId: String(row.requestId),
    agentId: String(row.agentId),
    requestedByType: row.requestedByType,
    requestedById: String(row.requestedById),
    command: String(row.command),
    args: parseJsonArray(String(row.argsJson || '[]')),
    cwd: String(row.cwd),
    scope: row.scope,
    status: row.status,
    createdAt: Number(row.createdAt),
    decidedAt: row.decidedAt == null ? null : Number(row.decidedAt),
    startedAt: row.startedAt == null ? null : Number(row.startedAt),
    completedAt: row.completedAt == null ? null : Number(row.completedAt),
    approverId: row.approverId == null ? null : String(row.approverId),
    decision: row.decision == null ? null : row.decision,
    elevatedConfirmed: boolFromDb(row.elevatedConfirmed),
    exitCode: row.exitCode == null ? null : Number(row.exitCode),
    stdout: String(row.stdout || ''),
    stderr: String(row.stderr || ''),
    stdoutTruncated: boolFromDb(row.stdoutTruncated),
    stderrTruncated: boolFromDb(row.stderrTruncated),
    errorMessage: row.errorMessage == null ? null : String(row.errorMessage),
  }
}

function toResource(row: StoredHostCommandRow): HostCommandRequest {
  return {
    requestId: row.requestId,
    agentId: row.agentId,
    requestedByType: row.requestedByType,
    requestedById: row.requestedById,
    command: row.command,
    args: row.args,
    cwd: row.cwd,
    scope: row.scope,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    approverId: row.approverId,
    decision: row.decision,
    elevatedConfirmed: row.elevatedConfirmed,
    exitCode: row.exitCode,
    stdout: row.stdout,
    stderr: row.stderr,
    stdoutTruncated: row.stdoutTruncated,
    stderrTruncated: row.stderrTruncated,
    errorMessage: row.errorMessage,
  }
}

export function createHostCommandRequest(input: CreateHostCommandInput): HostCommandRequest {
  const requestId = newId()
  const now = Date.now()

  getDb().prepare(
    `INSERT INTO host_command_requests (
      id,
      agent_id,
      requested_by_type,
      requested_by_id,
      command,
      args_json,
      cwd,
      scope,
      status,
      created_at,
      decided_at,
      started_at,
      completed_at,
      approver_id,
      decision,
      elevated_confirmed,
      exit_code,
      stdout,
      stderr,
      stdout_truncated,
      stderr_truncated,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    requestId,
    input.agentId,
    input.requestedByType,
    input.requestedById,
    input.command,
    JSON.stringify(input.args),
    input.cwd,
    input.scope,
    'pending',
    now,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    '',
    '',
    0,
    0,
    null,
  )

  return getHostCommandRequest(requestId)!
}

export function getHostCommandRequest(requestId: string): HostCommandRequest | null {
  const row = getDb().prepare(
    `SELECT
      id as requestId,
      agent_id as agentId,
      requested_by_type as requestedByType,
      requested_by_id as requestedById,
      command,
      args_json as argsJson,
      cwd,
      scope,
      status,
      created_at as createdAt,
      decided_at as decidedAt,
      started_at as startedAt,
      completed_at as completedAt,
      approver_id as approverId,
      decision,
      elevated_confirmed as elevatedConfirmed,
      exit_code as exitCode,
      stdout,
      stderr,
      stdout_truncated as stdoutTruncated,
      stderr_truncated as stderrTruncated,
      error_message as errorMessage
    FROM host_command_requests
    WHERE id = ?`
  ).get(requestId)

  if (!row) return null
  return toResource(mapRow(row))
}

export function listPendingHostCommandRequests(limit = 200): HostCommandRequest[] {
  const rows = getDb().prepare(
    `SELECT
      id as requestId,
      agent_id as agentId,
      requested_by_type as requestedByType,
      requested_by_id as requestedById,
      command,
      args_json as argsJson,
      cwd,
      scope,
      status,
      created_at as createdAt,
      decided_at as decidedAt,
      started_at as startedAt,
      completed_at as completedAt,
      approver_id as approverId,
      decision,
      elevated_confirmed as elevatedConfirmed,
      exit_code as exitCode,
      stdout,
      stderr,
      stdout_truncated as stdoutTruncated,
      stderr_truncated as stderrTruncated,
      error_message as errorMessage
    FROM host_command_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?`
  ).all(limit)

  return rows.map((row: any) => toResource(mapRow(row)))
}

export function listPendingHostCommandRequestsByAgent(agentId: string, limit = 200): HostCommandRequest[] {
  const rows = getDb().prepare(
    `SELECT
      id as requestId,
      agent_id as agentId,
      requested_by_type as requestedByType,
      requested_by_id as requestedById,
      command,
      args_json as argsJson,
      cwd,
      scope,
      status,
      created_at as createdAt,
      decided_at as decidedAt,
      started_at as startedAt,
      completed_at as completedAt,
      approver_id as approverId,
      decision,
      elevated_confirmed as elevatedConfirmed,
      exit_code as exitCode,
      stdout,
      stderr,
      stdout_truncated as stdoutTruncated,
      stderr_truncated as stderrTruncated,
      error_message as errorMessage
    FROM host_command_requests
    WHERE status = 'pending' AND agent_id = ?
    ORDER BY created_at ASC
    LIMIT ?`
  ).all(agentId, limit)

  return rows.map((row: any) => toResource(mapRow(row)))
}

export function updateHostCommandRequest(requestId: string, patch: UpdateHostCommandPatch): HostCommandRequest | null {
  const current = getHostCommandRequest(requestId)
  if (!current) return null

  getDb().prepare(
    `UPDATE host_command_requests
     SET status = ?,
         decided_at = ?,
         started_at = ?,
         completed_at = ?,
         approver_id = ?,
         decision = ?,
         elevated_confirmed = ?,
         exit_code = ?,
         stdout = ?,
         stderr = ?,
         stdout_truncated = ?,
         stderr_truncated = ?,
         error_message = ?
     WHERE id = ?`
  ).run(
    patch.status ?? current.status,
    patch.decidedAt !== undefined ? patch.decidedAt : current.decidedAt,
    patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    patch.approverId !== undefined ? patch.approverId : current.approverId,
    patch.decision !== undefined ? patch.decision : current.decision,
    patch.elevatedConfirmed !== undefined
      ? boolToDb(patch.elevatedConfirmed)
      : boolToDb(current.elevatedConfirmed),
    patch.exitCode !== undefined ? patch.exitCode : current.exitCode,
    patch.stdout !== undefined ? patch.stdout : current.stdout,
    patch.stderr !== undefined ? patch.stderr : current.stderr,
    patch.stdoutTruncated !== undefined
      ? boolToDb(patch.stdoutTruncated)
      : boolToDb(current.stdoutTruncated),
    patch.stderrTruncated !== undefined
      ? boolToDb(patch.stderrTruncated)
      : boolToDb(current.stderrTruncated),
    patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
    requestId,
  )

  return getHostCommandRequest(requestId)
}
