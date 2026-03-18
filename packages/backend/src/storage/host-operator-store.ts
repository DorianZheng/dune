import { getDb } from './database.js'
import { newId } from '../utils/ids.js'
import type {
  HostOperatorCreateRequest,
  HostOperatorDecisionType,
  HostOperatorRequest,
  HostOperatorRequestKindType,
  HostOperatorRequestStatusType,
  HostOperatorTarget,
  SandboxActorTypeType,
} from '@dune/shared'

type StoredHostOperatorRow = {
  requestId: string
  agentId: string
  requestedByType: SandboxActorTypeType
  requestedById: string
  kind: HostOperatorRequestKindType
  input: HostOperatorCreateRequest
  target: HostOperatorTarget | null
  summary: string
  status: HostOperatorRequestStatusType
  createdAt: number
  decidedAt: number | null
  startedAt: number | null
  completedAt: number | null
  approverId: string | null
  decision: HostOperatorDecisionType | null
  resultJson: unknown | null
  artifactPaths: string[]
  errorMessage: string | null
}

type CreateHostOperatorInput = {
  agentId: string
  requestedByType: SandboxActorTypeType
  requestedById: string
  kind: HostOperatorRequestKindType
  input: HostOperatorCreateRequest
  target: HostOperatorTarget | null
  summary: string
}

type UpdateHostOperatorPatch = Partial<{
  status: HostOperatorRequestStatusType
  decidedAt: number | null
  startedAt: number | null
  completedAt: number | null
  approverId: string | null
  decision: HostOperatorDecisionType | null
  resultJson: unknown | null
  artifactPaths: string[]
  errorMessage: string | null
}>

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    if (!value) return fallback
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapRow(row: any): StoredHostOperatorRow {
  return {
    requestId: String(row.requestId),
    agentId: String(row.agentId),
    requestedByType: row.requestedByType,
    requestedById: String(row.requestedById),
    kind: row.kind,
    input: parseJson<HostOperatorCreateRequest>(String(row.inputJson || '{}'), { kind: 'status' }),
    target: parseJson<HostOperatorTarget | null>(row.targetJson == null ? null : String(row.targetJson), null),
    summary: String(row.summary || ''),
    status: row.status,
    createdAt: Number(row.createdAt),
    decidedAt: row.decidedAt == null ? null : Number(row.decidedAt),
    startedAt: row.startedAt == null ? null : Number(row.startedAt),
    completedAt: row.completedAt == null ? null : Number(row.completedAt),
    approverId: row.approverId == null ? null : String(row.approverId),
    decision: row.decision == null ? null : row.decision,
    resultJson: row.resultJson == null ? null : parseJson(row.resultJson, null),
    artifactPaths: parseJson<string[]>(String(row.artifactPathsJson || '[]'), []),
    errorMessage: row.errorMessage == null ? null : String(row.errorMessage),
  }
}

function toResource(row: StoredHostOperatorRow): HostOperatorRequest {
  return {
    requestId: row.requestId,
    agentId: row.agentId,
    requestedByType: row.requestedByType,
    requestedById: row.requestedById,
    kind: row.kind,
    input: row.input,
    target: row.target,
    summary: row.summary,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    approverId: row.approverId,
    decision: row.decision,
    resultJson: row.resultJson,
    artifactPaths: row.artifactPaths,
    errorMessage: row.errorMessage,
  }
}

function baseSelectSql(whereClause: string): string {
  return `SELECT
      id as requestId,
      agent_id as agentId,
      requested_by_type as requestedByType,
      requested_by_id as requestedById,
      kind,
      input_json as inputJson,
      target_json as targetJson,
      summary,
      status,
      created_at as createdAt,
      decided_at as decidedAt,
      started_at as startedAt,
      completed_at as completedAt,
      approver_id as approverId,
      decision,
      result_json as resultJson,
      artifact_paths_json as artifactPathsJson,
      error_message as errorMessage
    FROM host_operator_requests
    ${whereClause}`
}

export function createHostOperatorRequest(input: CreateHostOperatorInput): HostOperatorRequest {
  const requestId = newId()
  const now = Date.now()

  getDb().prepare(
    `INSERT INTO host_operator_requests (
      id,
      agent_id,
      requested_by_type,
      requested_by_id,
      kind,
      input_json,
      target_json,
      summary,
      status,
      created_at,
      decided_at,
      started_at,
      completed_at,
      approver_id,
      decision,
      result_json,
      artifact_paths_json,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    requestId,
    input.agentId,
    input.requestedByType,
    input.requestedById,
    input.kind,
    JSON.stringify(input.input),
    input.target == null ? null : JSON.stringify(input.target),
    input.summary,
    'pending',
    now,
    null,
    null,
    null,
    null,
    null,
    null,
    '[]',
    null,
  )

  return getHostOperatorRequest(requestId)!
}

export function getHostOperatorRequest(requestId: string): HostOperatorRequest | null {
  const row = getDb().prepare(
    `${baseSelectSql('WHERE id = ?')}`
  ).get(requestId)
  if (!row) return null
  return toResource(mapRow(row))
}

export function listPendingHostOperatorRequests(limit = 200): HostOperatorRequest[] {
  const rows = getDb().prepare(
    `${baseSelectSql("WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")}`
  ).all(limit)
  return rows.map((row: any) => toResource(mapRow(row)))
}

export function listPendingHostOperatorRequestsByAgent(agentId: string, limit = 200): HostOperatorRequest[] {
  const rows = getDb().prepare(
    `${baseSelectSql("WHERE status = 'pending' AND agent_id = ? ORDER BY created_at ASC LIMIT ?")}`
  ).all(agentId, limit)
  return rows.map((row: any) => toResource(mapRow(row)))
}

export function updateHostOperatorRequest(requestId: string, patch: UpdateHostOperatorPatch): HostOperatorRequest | null {
  const current = getHostOperatorRequest(requestId)
  if (!current) return null

  getDb().prepare(
    `UPDATE host_operator_requests
     SET status = ?,
         decided_at = ?,
         started_at = ?,
         completed_at = ?,
         approver_id = ?,
         decision = ?,
         result_json = ?,
         artifact_paths_json = ?,
         error_message = ?
     WHERE id = ?`
  ).run(
    patch.status ?? current.status,
    patch.decidedAt !== undefined ? patch.decidedAt : current.decidedAt,
    patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    patch.approverId !== undefined ? patch.approverId : current.approverId,
    patch.decision !== undefined ? patch.decision : current.decision,
    patch.resultJson !== undefined ? (patch.resultJson == null ? null : JSON.stringify(patch.resultJson)) : (current.resultJson == null ? null : JSON.stringify(current.resultJson)),
    patch.artifactPaths !== undefined ? JSON.stringify(patch.artifactPaths) : JSON.stringify(current.artifactPaths),
    patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
    requestId,
  )

  return getHostOperatorRequest(requestId)
}
