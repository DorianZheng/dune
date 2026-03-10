import { newId, newEventId } from '../utils/ids.js'
import type {
  BoxCreateRequest,
  BoxStatusType,
  ExecCreateRequest,
  ExecEvent,
  ExecEventTypeType,
  ExecResource,
  ExecStatusType,
  PortSpec,
  SandboxAclEntry,
  SandboxActorTypeType,
  SandboxDurabilityType,
  VolumeSpec,
} from '@dune/shared'
import { getDb } from './database.js'

export type StoredSandbox = {
  id: string
  name: string | null
  status: BoxStatusType
  image: string
  cpus: number
  memoryMib: number
  diskSizeGb: number
  workingDir: string | null
  env: Record<string, string>
  entrypoint: string[]
  cmd: string[]
  user: string | null
  volumes: VolumeSpec[]
  ports: PortSpec[]
  labels: Record<string, string>
  autoRemove: boolean
  detach: boolean
  durability: SandboxDurabilityType
  creatorType: SandboxActorTypeType
  creatorId: string
  managedByAgent: boolean
  managedAgentId: string | null
  readOnly: boolean
  readOnlyReason: string | null
  boxliteBoxId: string | null
  createdAt: number
  updatedAt: number
  startedAt: number | null
  stoppedAt: number | null
}

type StoredExecRow = {
  id: string
  sandboxId: string
  status: ExecStatusType
  command: string
  args: string[]
  env: Record<string, string>
  timeoutSeconds: number | null
  workingDir: string | null
  tty: boolean
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  durationMs: number | null
  exitCode: number | null
  errorMessage: string | null
  stdout: string
  stderr: string
}

type ManagedRuntimeSandboxUpsertInput = {
  sandboxId: string
  agentId: string
  name?: string | null
  status: BoxStatusType
  startedAt?: number | null
  stoppedAt?: number | null
  boxliteBoxId?: string | null
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function boolFromDb(value: unknown): boolean {
  return Number(value) === 1
}

function boolToDb(value: boolean): number {
  return value ? 1 : 0
}

function mapSandboxRow(row: any): StoredSandbox {
  return {
    id: row.id,
    name: row.name ?? null,
    status: row.status,
    image: row.image,
    cpus: Number(row.cpus),
    memoryMib: Number(row.memoryMib),
    diskSizeGb: Number(row.diskSizeGb),
    workingDir: row.workingDir ?? null,
    env: parseJson<Record<string, string>>(row.envJson || '{}', {}),
    entrypoint: parseJson<string[]>(row.entrypointJson || '[]', []),
    cmd: parseJson<string[]>(row.cmdJson || '[]', []),
    user: row.userValue ?? null,
    volumes: parseJson<VolumeSpec[]>(row.volumesJson || '[]', []),
    ports: parseJson<PortSpec[]>(row.portsJson || '[]', []),
    labels: parseJson<Record<string, string>>(row.labelsJson || '{}', {}),
    autoRemove: boolFromDb(row.autoRemove),
    detach: boolFromDb(row.detach),
    durability: row.durability,
    creatorType: row.creatorType,
    creatorId: row.creatorId,
    managedByAgent: boolFromDb(row.managedByAgent),
    managedAgentId: row.managedAgentId ?? null,
    readOnly: boolFromDb(row.readOnly),
    readOnlyReason: row.readOnlyReason ?? null,
    boxliteBoxId: row.boxliteBoxId ?? null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    startedAt: row.startedAt == null ? null : Number(row.startedAt),
    stoppedAt: row.stoppedAt == null ? null : Number(row.stoppedAt),
  }
}

function mapExecRow(row: any): StoredExecRow {
  return {
    id: row.id,
    sandboxId: row.sandboxId,
    status: row.status,
    command: row.command,
    args: parseJson<string[]>(row.argsJson || '[]', []),
    env: parseJson<Record<string, string>>(row.envJson || '{}', {}),
    timeoutSeconds: row.timeoutSeconds == null ? null : Number(row.timeoutSeconds),
    workingDir: row.workingDir ?? null,
    tty: boolFromDb(row.tty),
    createdAt: Number(row.createdAt),
    startedAt: row.startedAt == null ? null : Number(row.startedAt),
    completedAt: row.completedAt == null ? null : Number(row.completedAt),
    durationMs: row.durationMs == null ? null : Number(row.durationMs),
    exitCode: row.exitCode == null ? null : Number(row.exitCode),
    errorMessage: row.errorMessage ?? null,
    stdout: row.stdout || '',
    stderr: row.stderr || '',
  }
}

export function createSandbox(
  input: BoxCreateRequest,
  actorType: SandboxActorTypeType,
  actorId: string,
): StoredSandbox {
  const now = Date.now()
  const id = newId()
  const durability = (input.durability || 'ephemeral') as SandboxDurabilityType
  const autoRemove = input.autoRemove ?? (durability === 'ephemeral')

  const row = {
    id,
    name: input.name?.trim() || null,
    status: 'configured' as BoxStatusType,
    image: input.image?.trim() || 'alpine:latest',
    cpus: input.cpus ?? 1,
    memoryMib: input.memoryMib ?? 512,
    diskSizeGb: input.diskSizeGb ?? 10,
    workingDir: input.workingDir?.trim() || null,
    envJson: JSON.stringify(input.env || {}),
    entrypointJson: JSON.stringify(input.entrypoint || []),
    cmdJson: JSON.stringify(input.cmd || []),
    userValue: input.user?.trim() || null,
    volumesJson: JSON.stringify(input.volumes || []),
    portsJson: JSON.stringify(input.ports || []),
    labelsJson: JSON.stringify(input.labels || {}),
    autoRemove: boolToDb(autoRemove),
    detach: boolToDb(input.detach ?? false),
    durability,
    creatorType: actorType,
    creatorId: actorId,
    managedByAgent: 0,
    managedAgentId: null as string | null,
    readOnly: 0,
    readOnlyReason: null as string | null,
    boxliteBoxId: null as string | null,
    createdAt: now,
    updatedAt: now,
    startedAt: null as number | null,
    stoppedAt: null as number | null,
  }

  const db = getDb()
  db.prepare(
    `INSERT INTO sandboxes (
      id, name, status, image, cpus, memory_mib, disk_size_gb, working_dir,
      env_json, entrypoint_json, cmd_json, user_value, volumes_json, ports_json, labels_json,
      auto_remove, detach, durability, creator_type, creator_id,
      managed_by_agent, managed_agent_id, read_only, read_only_reason, boxlite_box_id,
      created_at, updated_at, started_at, stopped_at
    ) VALUES (
      @id, @name, @status, @image, @cpus, @memoryMib, @diskSizeGb, @workingDir,
      @envJson, @entrypointJson, @cmdJson, @userValue, @volumesJson, @portsJson, @labelsJson,
      @autoRemove, @detach, @durability, @creatorType, @creatorId,
      @managedByAgent, @managedAgentId, @readOnly, @readOnlyReason, @boxliteBoxId,
      @createdAt, @updatedAt, @startedAt, @stoppedAt
    )`
  ).run(row)

  setSandboxAcl(id, [
    { sandboxId: id, principalType: actorType, principalId: actorId, permission: 'operate' },
    { sandboxId: id, principalType: actorType, principalId: actorId, permission: 'read' },
    ...((input.acl || []).map((entry) => ({
      sandboxId: id,
      principalType: entry.principalType,
      principalId: entry.principalId,
      permission: entry.permission,
    }))),
  ])

  return getSandbox(id)!
}

export function listSandboxes(limit = 200): StoredSandbox[] {
  const rows = getDb().prepare(
    `SELECT
      id,
      name,
      status,
      image,
      cpus,
      memory_mib as memoryMib,
      disk_size_gb as diskSizeGb,
      working_dir as workingDir,
      env_json as envJson,
      entrypoint_json as entrypointJson,
      cmd_json as cmdJson,
      user_value as userValue,
      volumes_json as volumesJson,
      ports_json as portsJson,
      labels_json as labelsJson,
      auto_remove as autoRemove,
      detach,
      durability,
      creator_type as creatorType,
      creator_id as creatorId,
      managed_by_agent as managedByAgent,
      managed_agent_id as managedAgentId,
      read_only as readOnly,
      read_only_reason as readOnlyReason,
      boxlite_box_id as boxliteBoxId,
      created_at as createdAt,
      updated_at as updatedAt,
      started_at as startedAt,
      stopped_at as stoppedAt
    FROM sandboxes
    ORDER BY updated_at DESC
    LIMIT ?`
  ).all(limit)

  return rows.map(mapSandboxRow)
}

export function getSandbox(sandboxId: string): StoredSandbox | null {
  const row = getDb().prepare(
    `SELECT
      id,
      name,
      status,
      image,
      cpus,
      memory_mib as memoryMib,
      disk_size_gb as diskSizeGb,
      working_dir as workingDir,
      env_json as envJson,
      entrypoint_json as entrypointJson,
      cmd_json as cmdJson,
      user_value as userValue,
      volumes_json as volumesJson,
      ports_json as portsJson,
      labels_json as labelsJson,
      auto_remove as autoRemove,
      detach,
      durability,
      creator_type as creatorType,
      creator_id as creatorId,
      managed_by_agent as managedByAgent,
      managed_agent_id as managedAgentId,
      read_only as readOnly,
      read_only_reason as readOnlyReason,
      boxlite_box_id as boxliteBoxId,
      created_at as createdAt,
      updated_at as updatedAt,
      started_at as startedAt,
      stopped_at as stoppedAt
    FROM sandboxes
    WHERE id = ?`
  ).get(sandboxId)

  return row ? mapSandboxRow(row) : null
}

export function getManagedRuntimeSandboxByAgentId(agentId: string): StoredSandbox | null {
  const row = getDb().prepare(
    `SELECT
      id,
      name,
      status,
      image,
      cpus,
      memory_mib as memoryMib,
      disk_size_gb as diskSizeGb,
      working_dir as workingDir,
      env_json as envJson,
      entrypoint_json as entrypointJson,
      cmd_json as cmdJson,
      user_value as userValue,
      volumes_json as volumesJson,
      ports_json as portsJson,
      labels_json as labelsJson,
      auto_remove as autoRemove,
      detach,
      durability,
      creator_type as creatorType,
      creator_id as creatorId,
      managed_by_agent as managedByAgent,
      managed_agent_id as managedAgentId,
      read_only as readOnly,
      read_only_reason as readOnlyReason,
      boxlite_box_id as boxliteBoxId,
      created_at as createdAt,
      updated_at as updatedAt,
      started_at as startedAt,
      stopped_at as stoppedAt
    FROM sandboxes
    WHERE managed_by_agent = 1 AND managed_agent_id = ?
    LIMIT 1`
  ).get(agentId)

  return row ? mapSandboxRow(row) : null
}

export function listManagedRuntimeSandboxes(limit = 500): StoredSandbox[] {
  const rows = getDb().prepare(
    `SELECT
      id,
      name,
      status,
      image,
      cpus,
      memory_mib as memoryMib,
      disk_size_gb as diskSizeGb,
      working_dir as workingDir,
      env_json as envJson,
      entrypoint_json as entrypointJson,
      cmd_json as cmdJson,
      user_value as userValue,
      volumes_json as volumesJson,
      ports_json as portsJson,
      labels_json as labelsJson,
      auto_remove as autoRemove,
      detach,
      durability,
      creator_type as creatorType,
      creator_id as creatorId,
      managed_by_agent as managedByAgent,
      managed_agent_id as managedAgentId,
      read_only as readOnly,
      read_only_reason as readOnlyReason,
      boxlite_box_id as boxliteBoxId,
      created_at as createdAt,
      updated_at as updatedAt,
      started_at as startedAt,
      stopped_at as stoppedAt
    FROM sandboxes
    WHERE managed_by_agent = 1
    ORDER BY updated_at DESC
    LIMIT ?`
  ).all(limit)

  return rows.map(mapSandboxRow)
}

export function upsertManagedRuntimeSandbox(input: ManagedRuntimeSandboxUpsertInput): StoredSandbox {
  const now = Date.now()
  const existingByAgent = getManagedRuntimeSandboxByAgentId(input.agentId)
  if (existingByAgent && existingByAgent.id !== input.sandboxId) {
    deleteSandbox(existingByAgent.id)
  }

  const existing = getSandbox(input.sandboxId)
  const row = {
    id: input.sandboxId,
    name: input.name !== undefined
      ? (input.name?.trim() || null)
      : (existing?.name ?? `${input.agentId} runtime`),
    status: input.status,
    image: existing?.image ?? 'ghcr.io/boxlite-ai/boxlite-skillbox:0.1.0',
    cpus: existing?.cpus ?? 2,
    memoryMib: existing?.memoryMib ?? 2048,
    diskSizeGb: existing?.diskSizeGb ?? 10,
    workingDir: existing?.workingDir ?? '/workspace',
    envJson: JSON.stringify(existing?.env ?? {}),
    entrypointJson: JSON.stringify(existing?.entrypoint ?? []),
    cmdJson: JSON.stringify(existing?.cmd ?? []),
    userValue: existing?.user ?? null,
    volumesJson: JSON.stringify(existing?.volumes ?? []),
    portsJson: JSON.stringify(existing?.ports ?? []),
    labelsJson: JSON.stringify(existing?.labels ?? { kind: 'agent-runtime' }),
    autoRemove: boolToDb(existing?.autoRemove ?? false),
    detach: boolToDb(existing?.detach ?? false),
    durability: existing?.durability ?? 'persistent',
    creatorType: 'system' as SandboxActorTypeType,
    creatorId: `agent:${input.agentId}`,
    managedByAgent: 1,
    managedAgentId: input.agentId,
    readOnly: boolToDb(existing?.readOnly ?? true),
    readOnlyReason: existing?.readOnlyReason ?? 'managed_by_agent_lifecycle',
    boxliteBoxId: input.boxliteBoxId !== undefined
      ? input.boxliteBoxId
      : (existing?.boxliteBoxId ?? input.sandboxId),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    startedAt: input.startedAt !== undefined ? input.startedAt : existing?.startedAt ?? null,
    stoppedAt: input.stoppedAt !== undefined ? input.stoppedAt : existing?.stoppedAt ?? null,
  }

  getDb().prepare(
    `INSERT INTO sandboxes (
      id, name, status, image, cpus, memory_mib, disk_size_gb, working_dir,
      env_json, entrypoint_json, cmd_json, user_value, volumes_json, ports_json, labels_json,
      auto_remove, detach, durability, creator_type, creator_id,
      managed_by_agent, managed_agent_id, read_only, read_only_reason, boxlite_box_id,
      created_at, updated_at, started_at, stopped_at
    ) VALUES (
      @id, @name, @status, @image, @cpus, @memoryMib, @diskSizeGb, @workingDir,
      @envJson, @entrypointJson, @cmdJson, @userValue, @volumesJson, @portsJson, @labelsJson,
      @autoRemove, @detach, @durability, @creatorType, @creatorId,
      @managedByAgent, @managedAgentId, @readOnly, @readOnlyReason, @boxliteBoxId,
      @createdAt, @updatedAt, @startedAt, @stoppedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      image = excluded.image,
      cpus = excluded.cpus,
      memory_mib = excluded.memory_mib,
      disk_size_gb = excluded.disk_size_gb,
      working_dir = excluded.working_dir,
      env_json = excluded.env_json,
      entrypoint_json = excluded.entrypoint_json,
      cmd_json = excluded.cmd_json,
      user_value = excluded.user_value,
      volumes_json = excluded.volumes_json,
      ports_json = excluded.ports_json,
      labels_json = excluded.labels_json,
      auto_remove = excluded.auto_remove,
      detach = excluded.detach,
      durability = excluded.durability,
      creator_type = excluded.creator_type,
      creator_id = excluded.creator_id,
      managed_by_agent = excluded.managed_by_agent,
      managed_agent_id = excluded.managed_agent_id,
      read_only = excluded.read_only,
      read_only_reason = excluded.read_only_reason,
      boxlite_box_id = excluded.boxlite_box_id,
      updated_at = excluded.updated_at,
      started_at = excluded.started_at,
      stopped_at = excluded.stopped_at`
  ).run(row)

  setSandboxAcl(input.sandboxId, [
    { sandboxId: input.sandboxId, principalType: 'system', principalId: `agent:${input.agentId}`, permission: 'operate' },
    { sandboxId: input.sandboxId, principalType: 'system', principalId: `agent:${input.agentId}`, permission: 'read' },
  ])

  const stored = getSandbox(input.sandboxId)
  if (!stored) {
    throw new Error(`Failed to upsert managed runtime sandbox ${input.sandboxId}`)
  }
  return stored
}

export function deleteManagedRuntimeSandbox(sandboxId: string): boolean {
  const sandbox = getSandbox(sandboxId)
  if (!sandbox || !sandbox.managedByAgent) return false
  return deleteSandbox(sandboxId)
}

export function updateSandbox(
  sandboxId: string,
  patch: Partial<{
    name: string | null
    status: BoxStatusType
    labels: Record<string, string>
    autoRemove: boolean
    durability: SandboxDurabilityType
    boxliteBoxId: string | null
    startedAt: number | null
    stoppedAt: number | null
    readOnly: boolean
    readOnlyReason: string | null
  }>,
): StoredSandbox | null {
  const current = getSandbox(sandboxId)
  if (!current) return null

  const next = {
    name: patch.name !== undefined ? patch.name : current.name,
    status: patch.status ?? current.status,
    labelsJson: JSON.stringify(patch.labels ?? current.labels),
    autoRemove: boolToDb(patch.autoRemove ?? current.autoRemove),
    durability: patch.durability ?? current.durability,
    boxliteBoxId: patch.boxliteBoxId !== undefined ? patch.boxliteBoxId : current.boxliteBoxId,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : current.startedAt,
    stoppedAt: patch.stoppedAt !== undefined ? patch.stoppedAt : current.stoppedAt,
    readOnly: boolToDb(patch.readOnly ?? current.readOnly),
    readOnlyReason: patch.readOnlyReason !== undefined ? patch.readOnlyReason : current.readOnlyReason,
    updatedAt: Date.now(),
  }

  getDb().prepare(
    `UPDATE sandboxes
     SET name = ?, status = ?, labels_json = ?, auto_remove = ?, durability = ?,
         boxlite_box_id = ?, started_at = ?, stopped_at = ?,
         read_only = ?, read_only_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.status,
    next.labelsJson,
    next.autoRemove,
    next.durability,
    next.boxliteBoxId,
    next.startedAt,
    next.stoppedAt,
    next.readOnly,
    next.readOnlyReason,
    next.updatedAt,
    sandboxId,
  )

  return getSandbox(sandboxId)
}

export function deleteSandbox(sandboxId: string): boolean {
  const result = getDb().prepare('DELETE FROM sandboxes WHERE id = ?').run(sandboxId)
  return result.changes > 0
}

export function listSandboxAcl(sandboxId: string): SandboxAclEntry[] {
  return getDb().prepare(
    `SELECT
      sandbox_id as sandboxId,
      principal_type as principalType,
      principal_id as principalId,
      permission
    FROM sandbox_acl
    WHERE sandbox_id = ?`
  ).all(sandboxId) as SandboxAclEntry[]
}

export function setSandboxAcl(sandboxId: string, entries: SandboxAclEntry[]): void {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sandbox_acl WHERE sandbox_id = ?').run(sandboxId)
    const insert = db.prepare(
      `INSERT OR IGNORE INTO sandbox_acl (sandbox_id, principal_type, principal_id, permission)
       VALUES (?, ?, ?, ?)`
    )
    for (const entry of entries) {
      insert.run(sandboxId, entry.principalType, entry.principalId, entry.permission)
    }
  })
  tx()
}

export function hasSandboxPermission(
  sandboxId: string,
  actorType: SandboxActorTypeType,
  actorId: string,
  permission: 'operate' | 'read',
): boolean {
  const sandbox = getSandbox(sandboxId)
  if (!sandbox) return false

  if (sandbox.creatorType === actorType && sandbox.creatorId === actorId) return true

  const perms = permission === 'read' ? ['read', 'operate'] : ['operate']
  const placeholders = perms.map(() => '?').join(', ')
  const row = getDb().prepare(
    `SELECT 1 as ok
     FROM sandbox_acl
     WHERE sandbox_id = ? AND principal_type = ? AND principal_id = ?
       AND permission IN (${placeholders})
     LIMIT 1`
  ).get(sandboxId, actorType, actorId, ...perms) as { ok: number } | undefined
  return !!row
}

export function createExec(sandboxId: string, req: ExecCreateRequest): ExecResource {
  const now = Date.now()
  const id = newId()
  getDb().prepare(
    `INSERT INTO sandbox_execs (
      id, sandbox_id, status, command, args_json, env_json, timeout_seconds, working_dir, tty,
      created_at, started_at, completed_at, duration_ms, exit_code, error_message, stdout, stderr
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sandboxId,
    'running',
    req.command,
    JSON.stringify(req.args || []),
    JSON.stringify(req.env || {}),
    req.timeoutSeconds ?? null,
    req.workingDir ?? null,
    boolToDb(req.tty ?? false),
    now,
    now,
    null,
    null,
    null,
    null,
    '',
    '',
  )

  return getExec(sandboxId, id)!
}

export function getExec(sandboxId: string, executionId: string): ExecResource | null {
  const row = getDb().prepare(
    `SELECT
      id,
      sandbox_id as sandboxId,
      status,
      command,
      args_json as argsJson,
      env_json as envJson,
      timeout_seconds as timeoutSeconds,
      working_dir as workingDir,
      tty,
      created_at as createdAt,
      started_at as startedAt,
      completed_at as completedAt,
      duration_ms as durationMs,
      exit_code as exitCode,
      error_message as errorMessage,
      stdout,
      stderr
    FROM sandbox_execs
    WHERE sandbox_id = ? AND id = ?`
  ).get(sandboxId, executionId)

  if (!row) return null
  const mapped = mapExecRow(row)
  return {
    executionId: mapped.id,
    boxId: mapped.sandboxId,
    status: mapped.status,
    command: mapped.command,
    args: mapped.args,
    env: mapped.env,
    timeoutSeconds: mapped.timeoutSeconds,
    workingDir: mapped.workingDir,
    tty: mapped.tty,
    createdAt: mapped.createdAt,
    startedAt: mapped.startedAt,
    completedAt: mapped.completedAt,
    durationMs: mapped.durationMs,
    exitCode: mapped.exitCode,
    errorMessage: mapped.errorMessage,
    stdout: mapped.stdout,
    stderr: mapped.stderr,
  }
}

export function listExecs(sandboxId: string, limit = 100): ExecResource[] {
  const rows = getDb().prepare(
    `SELECT
      id,
      sandbox_id as sandboxId,
      status,
      command,
      args_json as argsJson,
      env_json as envJson,
      timeout_seconds as timeoutSeconds,
      working_dir as workingDir,
      tty,
      created_at as createdAt,
      started_at as startedAt,
      completed_at as completedAt,
      duration_ms as durationMs,
      exit_code as exitCode,
      error_message as errorMessage,
      stdout,
      stderr
    FROM sandbox_execs
    WHERE sandbox_id = ?
    ORDER BY created_at DESC
    LIMIT ?`
  ).all(sandboxId, limit)

  return rows.map((row: any) => {
    const mapped = mapExecRow(row)
    return {
      executionId: mapped.id,
      boxId: mapped.sandboxId,
      status: mapped.status,
      command: mapped.command,
      args: mapped.args,
      env: mapped.env,
      timeoutSeconds: mapped.timeoutSeconds,
      workingDir: mapped.workingDir,
      tty: mapped.tty,
      createdAt: mapped.createdAt,
      startedAt: mapped.startedAt,
      completedAt: mapped.completedAt,
      durationMs: mapped.durationMs,
      exitCode: mapped.exitCode,
      errorMessage: mapped.errorMessage,
      stdout: mapped.stdout,
      stderr: mapped.stderr,
    }
  })
}

export function updateExec(
  sandboxId: string,
  executionId: string,
  patch: Partial<{
    status: ExecStatusType
    completedAt: number | null
    durationMs: number | null
    exitCode: number | null
    errorMessage: string | null
    stdout: string
    stderr: string
  }>,
): ExecResource | null {
  const current = getExec(sandboxId, executionId)
  if (!current) return null

  getDb().prepare(
    `UPDATE sandbox_execs
     SET status = ?, completed_at = ?, duration_ms = ?, exit_code = ?, error_message = ?, stdout = ?, stderr = ?
     WHERE sandbox_id = ? AND id = ?`
  ).run(
    patch.status ?? current.status,
    patch.completedAt !== undefined ? patch.completedAt : current.completedAt,
    patch.durationMs !== undefined ? patch.durationMs : current.durationMs,
    patch.exitCode !== undefined ? patch.exitCode : current.exitCode,
    patch.errorMessage !== undefined ? patch.errorMessage : current.errorMessage,
    patch.stdout !== undefined ? patch.stdout : current.stdout,
    patch.stderr !== undefined ? patch.stderr : current.stderr,
    sandboxId,
    executionId,
  )

  return getExec(sandboxId, executionId)
}

export function appendExecEvent(
  sandboxId: string,
  executionId: string,
  eventType: ExecEventTypeType,
  data: string,
): ExecEvent {
  const db = getDb()
  const seqRow = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq
     FROM sandbox_exec_events
     WHERE execution_id = ?`
  ).get(executionId) as { nextSeq: number }

  const event: ExecEvent = {
    executionId,
    seq: seqRow.nextSeq,
    timestamp: Date.now(),
    eventType,
    data,
  }

  db.prepare(
    `INSERT INTO sandbox_exec_events (execution_id, seq, sandbox_id, timestamp, event_type, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(event.executionId, event.seq, sandboxId, event.timestamp, event.eventType, event.data)

  return event
}

export function listExecEvents(executionId: string, afterSeq = 0, limit = 500): ExecEvent[] {
  return getDb().prepare(
    `SELECT
      execution_id as executionId,
      seq,
      timestamp,
      event_type as eventType,
      data
    FROM sandbox_exec_events
    WHERE execution_id = ? AND seq > ?
    ORDER BY seq ASC
    LIMIT ?`
  ).all(executionId, afterSeq, limit) as ExecEvent[]
}

export function recordFileOp(data: {
  sandboxId: string
  op: string
  path: string
  actorType: SandboxActorTypeType
  actorId: string
  status: string
  error: string | null
}): void {
  getDb().prepare(
    `INSERT INTO sandbox_file_ops (
      id, sandbox_id, op, path, actor_type, actor_id, status, error, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(newEventId(), data.sandboxId, data.op, data.path, data.actorType, data.actorId, data.status, data.error, Date.now())
}
