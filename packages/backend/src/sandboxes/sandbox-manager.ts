import { SimpleBox } from '@boxlite-ai/boxlite'
import { createServer } from 'node:net'
import { execSync } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { lookup as lookupMimeType } from 'mime-types'
import type {
  BoxCreateRequest,
  BoxListResponse,
  BoxPatchRequest,
  BoxResource,
  BoxStatusResponse,
  ExecCreateRequest,
  ExecEvent,
  ExecListResponse,
  ExecResource,
  FileDownloadResponse,
  HostImportRequest,
  SandboxFsEntry,
  SandboxFsListResponse,
  SandboxFsMkdirRequest,
  SandboxFsMoveRequest,
  SandboxFsReadResponse,
  SandboxAclEntry,
  SandboxActorTypeType,
} from '@dune/shared'
import { config as appConfig } from '../config.js'
import * as sandboxStore from '../storage/sandbox-store.js'
import * as agentStore from '../storage/agent-store.js'
import * as agentRuntimeStore from '../storage/agent-runtime-store.js'
import {
  destroyRuntimeSandbox,
  listRunningAgentSandboxes,
  stopRuntimeSandbox,
  ensureRuntimeSandboxRunning,
} from '../agents/agent-manager.js'
import { createBoxliteRuntime } from '../boxlite/runtime.js'

type ActorIdentity = {
  actorType: SandboxActorTypeType
  actorId: string
}

type ActiveSandboxRuntime = {
  sandboxId: string
  box: SimpleBox
  hostPortsByGuest: Map<number, number>
}

type AgentManagedSandbox = {
  sandboxId: string
  agentId: string
  status: 'running' | 'stopped'
  startedAt: number
  name: string
}

const activeBySandboxId = new Map<string, ActiveSandboxRuntime>()
const sandboxLocks = new Map<string, Promise<void>>()

let runtime: any = null

function getRuntime() {
  if (!runtime) {
    runtime = createBoxliteRuntime()
  }
  return runtime
}

export function closeSandboxRuntime() {
  if (runtime) {
    runtime.close()
    runtime = null
  }
}

async function withSandboxLock<T>(sandboxId: string, work: () => Promise<T>): Promise<T> {
  const previous = sandboxLocks.get(sandboxId) || Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const chain = previous.then(() => gate)
  sandboxLocks.set(sandboxId, chain)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (sandboxLocks.get(sandboxId) === chain) {
      sandboxLocks.delete(sandboxId)
    }
  }
}

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function isMissingShellError(message: string, shellCmd: string): boolean {
  const shellName = shellCmd.split('/').pop() || shellCmd
  const lower = message.toLowerCase()
  return (
    lower.includes(`failed to spawn '${shellCmd.toLowerCase()}'`)
    || lower.includes(`failed to spawn '${shellName.toLowerCase()}'`)
    || lower.includes(`executable '${shellCmd.toLowerCase()}' not found`)
    || lower.includes(`executable '${shellName.toLowerCase()}' not found`)
    || (lower.includes('no such file') && lower.includes(shellName.toLowerCase()))
    || (lower.includes('not found') && lower.includes(shellName.toLowerCase()) && (lower.includes('spawn') || lower.includes('executable')))
  )
}

const DEFAULT_SANDBOX_EXEC_TIMEOUT_MS = 30_000
const DEFAULT_SANDBOX_EXEC_MAX_RETRIES = 2

function getSandboxExecTimeoutMs(): number {
  const value = Number(appConfig.sandboxExecTimeoutMs)
  if (!Number.isFinite(value)) return DEFAULT_SANDBOX_EXEC_TIMEOUT_MS
  return Math.max(50, Math.floor(value))
}

function getSandboxExecMaxRetries(): number {
  const value = Number(appConfig.sandboxExecMaxRetries)
  if (!Number.isFinite(value)) return DEFAULT_SANDBOX_EXEC_MAX_RETRIES
  return Math.max(0, Math.floor(value))
}

function isTransientExecFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('transport error')
    || lower.includes('timed out')
    || lower.includes('timeout')
    || lower.includes('spawn_failed')
    || lower.includes('notify socket')
    || lower.includes('libcontainer')
  )
}

function isTimeoutExecFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('timed out') || lower.includes('timeout')
}

function summarizeExecError(message: string, max = 180): string {
  const compact = message.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max)}...`
}

async function execWithTimeout(
  box: SimpleBox,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const execPromise = box.exec(cmd, args, env)
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`box.exec timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  try {
    return await Promise.race([execPromise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

async function execWithShellFallback(
  box: SimpleBox,
  command: string,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const attempts: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'bash', args: ['-lc', command] },
    { cmd: '/bin/sh', args: ['-c', command] },
    { cmd: 'sh', args: ['-c', command] },
  ]
  const missingShellErrors: string[] = []
  const timeoutMs = getSandboxExecTimeoutMs()
  const maxRetries = getSandboxExecMaxRetries()

  for (const attempt of attempts) {
    for (let retry = 0; retry <= maxRetries; retry += 1) {
      try {
        const result = await execWithTimeout(box, attempt.cmd, attempt.args, env, timeoutMs)
        const probeText = `${result.stderr || ''}\n${result.stdout || ''}`
        if (result.exitCode !== 0 && isMissingShellError(probeText, attempt.cmd)) {
          missingShellErrors.push(`${attempt.cmd}: ${probeText.trim() || `exit ${result.exitCode}`}`)
          break
        }
        return result
      } catch (err: any) {
        const message = String(err?.message || err || '')
        if (isMissingShellError(message, attempt.cmd)) {
          missingShellErrors.push(`${attempt.cmd}: ${message}`)
          break
        }
        if (!isTransientExecFailure(message)) {
          throw new Error('box_exec_failed')
        }
        if (retry >= maxRetries) {
          throw new Error(isTimeoutExecFailure(message) ? 'box_exec_timeout' : 'box_exec_failed')
        }
        console.warn(
          `[sandboxes] transient exec failure (${retry + 1}/${maxRetries + 1}) via ${attempt.cmd}: ${summarizeExecError(message)}`,
        )
        continue
      }
    }
  }

  if (missingShellErrors.length > 0) {
    console.warn(`[sandboxes] no compatible shell found: ${missingShellErrors.join(' | ')}`)
  }
  throw new Error('no_compatible_shell')
}

function isSystemActor(identity: ActorIdentity): boolean {
  return identity.actorType === 'system'
}

function canAccessManagedRuntime(identity: ActorIdentity, agentId: string | null): boolean {
  if (isSystemActor(identity) || identity.actorType === 'human') return true
  return identity.actorType === 'agent' && !!agentId && identity.actorId === agentId
}

function splitNonEmptyLines(text: string): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

function statusOrder(status: string): number {
  switch (status) {
    case 'running':
      return 0
    case 'creating':
      return 1
    case 'configured':
      return 2
    case 'stopping':
      return 3
    case 'stopped':
      return 4
    case 'unknown':
      return 5
    case 'error':
      return 6
    default:
      return 10
  }
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address() as { port: number } | null
      const port = address?.port
      server.close((err) => {
        if (err) reject(err)
        else if (!port) reject(new Error('Failed to allocate port'))
        else resolvePort(port)
      })
    })
    server.on('error', reject)
  })
}

function ensureContainerPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed.startsWith('/')) throw new Error('path must be an absolute container path')
  if (trimmed.includes('\0')) throw new Error('path contains null byte')
  if (trimmed.split('/').some((part) => part === '..')) {
    throw new Error('path traversal is not allowed')
  }
  return trimmed
}

function normalizeContainerPath(path: string): string {
  const normalized = ensureContainerPath(path)
  if (normalized === '/') return '/'
  return normalized.replace(/\/+$/, '')
}

function ensureNonRootPath(path: string): string {
  const normalized = normalizeContainerPath(path)
  if (normalized === '/') throw new Error('invalid_path')
  return normalized
}

function getContainerParentPath(path: string): string | null {
  const normalized = normalizeContainerPath(path)
  if (normalized === '/') return null
  const parent = dirname(normalized)
  return parent === '' ? '/' : parent
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

async function listAgentManagedBoxes(): Promise<AgentManagedSandbox[]> {
  return listRunningAgentSandboxes()
}

function ensureSandboxMutability(identity: ActorIdentity, box: BoxResource): void {
  if (isSystemActor(identity)) return
  if (identity.actorType === 'human') {
    // Humans can do file ops on managed sandboxes, but not if explicitly readOnly
    if (box._dune.readOnly) {
      throw new Error('managed_by_agent_lifecycle')
    }
    return
  }
  // Agent and other actors: blocked on both managed and readOnly sandboxes
  if (box._dune.managedByAgent || box._dune.readOnly) {
    throw new Error('managed_by_agent_lifecycle')
  }
}

/** Stricter check: blocks humans on managed-by-agent sandboxes (for metadata mutations like patch/stop). */
function ensureSandboxMetadataMutability(identity: ActorIdentity, box: BoxResource): void {
  if (isSystemActor(identity)) return
  if (box._dune.managedByAgent || box._dune.readOnly) {
    throw new Error('managed_by_agent_lifecycle')
  }
}

function canAutoStartRuntime(identity: ActorIdentity, box: BoxResource): boolean {
  return box._dune.managedByAgent && (isSystemActor(identity) || identity.actorType === 'human')
}

function ensureBoxRunning(identity: ActorIdentity, box: BoxResource): void {
  if (canAutoStartRuntime(identity, box)) return
  if (box.status !== 'running') {
    throw new Error('box_not_running')
  }
}

function sandboxToResource(
  sandbox: sandboxStore.StoredSandbox,
  acl: SandboxAclEntry[],
): BoxResource {
  const active = activeBySandboxId.get(sandbox.id)
  const runtimePorts = active
    ? sandbox.ports.map((port) => ({
      ...port,
      hostPort: active.hostPortsByGuest.get(port.guestPort) ?? port.hostPort,
    }))
    : sandbox.ports

  return {
    boxId: sandbox.id,
    name: sandbox.name,
    status: sandbox.status,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
    startedAt: sandbox.startedAt,
    stoppedAt: sandbox.stoppedAt,
    image: sandbox.image,
    cpus: sandbox.cpus,
    memoryMib: sandbox.memoryMib,
    diskSizeGb: sandbox.diskSizeGb,
    workingDir: sandbox.workingDir,
    env: sandbox.env,
    entrypoint: sandbox.entrypoint,
    cmd: sandbox.cmd,
    user: sandbox.user,
    volumes: sandbox.volumes,
    ports: runtimePorts,
    labels: sandbox.labels,
    autoRemove: sandbox.autoRemove,
    detach: sandbox.detach,
    durability: sandbox.durability,
    _dune: {
      ownership: {
        creatorType: sandbox.creatorType,
        creatorId: sandbox.creatorId,
        readOnly: sandbox.readOnly,
        readOnlyReason: sandbox.readOnlyReason,
      },
      sharedWith: acl,
      readOnly: sandbox.readOnly,
      readOnlyReason: sandbox.readOnlyReason,
      managedByAgent: sandbox.managedByAgent,
      agentId: sandbox.managedAgentId,
    },
  }
}

function agentManagedToResource(box: AgentManagedSandbox): BoxResource {
  const now = Date.now()
  return {
    boxId: box.sandboxId,
    name: box.name,
    status: box.status === 'running' ? 'running' : 'stopped',
    createdAt: box.startedAt,
    updatedAt: now,
    startedAt: box.startedAt,
    stoppedAt: box.status === 'running' ? null : now,
    image: 'ghcr.io/boxlite-ai/boxlite-skillbox:0.1.0',
    cpus: 2,
    memoryMib: 2048,
    diskSizeGb: 10,
    workingDir: '/workspace',
    env: {},
    entrypoint: [],
    cmd: [],
    user: null,
    volumes: [],
    ports: [],
    labels: { kind: 'agent-runtime' },
    autoRemove: false,
    detach: false,
    durability: 'persistent',
    _dune: {
      ownership: {
        creatorType: 'system',
        creatorId: 'agents-runtime',
        readOnly: true,
        readOnlyReason: 'managed_by_agent_lifecycle',
      },
      sharedWith: [],
      readOnly: true,
      readOnlyReason: 'managed_by_agent_lifecycle',
      managedByAgent: true,
      agentId: box.agentId,
    },
  }
}

function canReadAgentManaged(identity: ActorIdentity, box: AgentManagedSandbox): boolean {
  return canAccessManagedRuntime(identity, box.agentId)
}

function assertReadPermission(identity: ActorIdentity, sandboxId: string): void {
  if (isSystemActor(identity) || identity.actorType === 'human') return
  if (!sandboxStore.hasSandboxPermission(sandboxId, identity.actorType, identity.actorId, 'read')) {
    throw new Error('forbidden')
  }
}

function assertOperatePermission(identity: ActorIdentity, sandboxId: string): void {
  if (isSystemActor(identity) || identity.actorType === 'human') return
  if (!sandboxStore.hasSandboxPermission(sandboxId, identity.actorType, identity.actorId, 'operate')) {
    throw new Error('forbidden')
  }
}

function canReadPersistedSandbox(identity: ActorIdentity, sandbox: sandboxStore.StoredSandbox): boolean {
  if (isSystemActor(identity)) return true
  return sandboxStore.hasSandboxPermission(sandbox.id, identity.actorType, identity.actorId, 'read')
}

function ensureManagedRuntimeShadow(managed: AgentManagedSandbox): sandboxStore.StoredSandbox {
  const existing = sandboxStore.getSandbox(managed.sandboxId)
  if (existing && existing.managedByAgent) {
    return sandboxStore.upsertManagedRuntimeSandbox({
      sandboxId: managed.sandboxId,
      agentId: managed.agentId,
      status: managed.status,
      startedAt: managed.startedAt,
      stoppedAt: managed.status === 'running' ? null : Date.now(),
      boxliteBoxId: managed.sandboxId,
    })
  }

  return sandboxStore.upsertManagedRuntimeSandbox({
    sandboxId: managed.sandboxId,
    agentId: managed.agentId,
    name: managed.name,
    status: managed.status,
    startedAt: managed.startedAt,
    stoppedAt: managed.status === 'running' ? null : Date.now(),
    boxliteBoxId: managed.sandboxId,
  })
}

async function resolveBox(identity: ActorIdentity, boxId: string): Promise<BoxResource | null> {
  const stored = sandboxStore.getSandbox(boxId)
  if (stored) {
    if (stored.managedByAgent && !canAccessManagedRuntime(identity, stored.managedAgentId)) {
      throw new Error('forbidden')
    }
    if (!stored.managedByAgent) {
      assertReadPermission(identity, boxId)
    } else if (!isSystemActor(identity) && !canReadPersistedSandbox(identity, stored)) {
      // Keep previous behavior: managed runtime boxes are visible to human / owning agent.
      // Read-only operations still require explicit allowance.
    }
    return sandboxToResource(stored, sandboxStore.listSandboxAcl(boxId))
  }

  const managed = (await listAgentManagedBoxes()).find((item) => item.sandboxId === boxId)
  if (managed) {
    if (!canReadAgentManaged(identity, managed)) throw new Error('forbidden')
    const shadow = ensureManagedRuntimeShadow(managed)
    return sandboxToResource(shadow, sandboxStore.listSandboxAcl(shadow.id))
  }

  return null
}

export async function listBoxes(identity: ActorIdentity): Promise<BoxListResponse> {
  const persisted = sandboxStore.listSandboxes()
  const persistedVisible = persisted
    .filter((sandbox) => !sandbox.managedByAgent)
    .filter((sandbox) => canReadPersistedSandbox(identity, sandbox))
    .map((sandbox) => sandboxToResource(sandbox, sandboxStore.listSandboxAcl(sandbox.id)))

  const managedPersisted = sandboxStore.listManagedRuntimeSandboxes(10_000)
  const managedById = new Map<string, AgentManagedSandbox>()
  const managedLive = await listAgentManagedBoxes()
  for (const managed of managedLive) {
    managedById.set(managed.sandboxId, managed)
    ensureManagedRuntimeShadow(managed)
  }

  const managedVisible: BoxResource[] = []
  for (const sandbox of managedPersisted) {
    if (!canAccessManagedRuntime(identity, sandbox.managedAgentId)) continue
    const live = managedById.get(sandbox.id)
    const resource = sandboxToResource(sandbox, sandboxStore.listSandboxAcl(sandbox.id))
    if (live) {
      resource.status = live.status
      resource.startedAt = live.startedAt
      resource.stoppedAt = live.status === 'running' ? null : Date.now()
      if (!resource.name) resource.name = live.name
    }
    managedVisible.push(resource)
  }

  for (const managed of managedLive) {
    if (managedPersisted.some((row) => row.id === managed.sandboxId)) continue
    if (!canReadAgentManaged(identity, managed)) continue
    managedVisible.push(agentManagedToResource(managed))
  }

  const boxes = [...persistedVisible, ...managedVisible]
    .sort((a, b) => {
      const w = statusOrder(a.status) - statusOrder(b.status)
      if (w !== 0) return w
      return b.updatedAt - a.updatedAt
    })

  return {
    boxes,
    nextPageToken: null,
  }
}

export async function createBox(identity: ActorIdentity, req: BoxCreateRequest): Promise<BoxResource> {
  const sandbox = sandboxStore.createSandbox(req, identity.actorType, identity.actorId)
  const acl = sandboxStore.listSandboxAcl(sandbox.id)
  return sandboxToResource(sandbox, acl)
}

export async function getBox(identity: ActorIdentity, boxId: string): Promise<BoxResource | null> {
  return resolveBox(identity, boxId)
}

export async function patchBox(identity: ActorIdentity, boxId: string, patch: BoxPatchRequest): Promise<BoxResource | null> {
  return withSandboxLock(boxId, async () => {
    const existing = await resolveBox(identity, boxId)
    if (!existing) return null
    ensureSandboxMetadataMutability(identity, existing)
    assertOperatePermission(identity, boxId)

    const current = sandboxStore.getSandbox(boxId)
    if (!current) return null

    if (patch.acl) {
      sandboxStore.setSandboxAcl(boxId, [
        { sandboxId: boxId, principalType: current.creatorType, principalId: current.creatorId, permission: 'operate' },
        { sandboxId: boxId, principalType: current.creatorType, principalId: current.creatorId, permission: 'read' },
        ...patch.acl.map((entry) => ({
          sandboxId: boxId,
          principalType: entry.principalType,
          principalId: entry.principalId,
          permission: entry.permission,
        })),
      ])
    }

    const updated = sandboxStore.updateSandbox(boxId, {
      name: patch.name !== undefined ? (patch.name?.trim() || null) : undefined,
      labels: patch.labels,
      autoRemove: patch.autoRemove,
      durability: patch.durability,
    })
    if (!updated) return null
    return sandboxToResource(updated, sandboxStore.listSandboxAcl(boxId))
  })
}

export async function deleteBox(identity: ActorIdentity, boxId: string, force = false): Promise<boolean> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) return false
    if (box._dune.managedByAgent && isSystemActor(identity)) {
      await destroyRuntimeSandbox(boxId)
      sandboxStore.deleteManagedRuntimeSandbox(boxId)
      return true
    }

    ensureSandboxMetadataMutability(identity, box)
    assertOperatePermission(identity, boxId)

    const active = activeBySandboxId.get(boxId)
    if (active && !force) throw new Error('box_running')
    if (active) {
      try { await active.box.stop() } catch {}
      activeBySandboxId.delete(boxId)
    }
    return sandboxStore.deleteSandbox(boxId)
  })
}

async function startBoxUnlocked(identity: ActorIdentity, boxId: string): Promise<BoxResource | null> {
  const existing = await resolveBox(identity, boxId)
  if (!existing) return null
  if (existing._dune.managedByAgent && isSystemActor(identity)) {
    await ensureRuntimeSandboxRunning(boxId)
    const refreshed = await resolveBox(identity, boxId)
    return refreshed
  }

  ensureSandboxMetadataMutability(identity, existing)
  assertOperatePermission(identity, boxId)

  if (activeBySandboxId.has(boxId)) {
    const sandbox = sandboxStore.getSandbox(boxId)
    if (!sandbox) return null
    return sandboxToResource(sandbox, sandboxStore.listSandboxAcl(boxId))
  }

  const sandbox = sandboxStore.getSandbox(boxId)
  if (!sandbox) return null
  const runtimeName = `sandbox-${sandbox.id}`

  const hostPortsByGuest = new Map<number, number>()
  const mappedPorts = await Promise.all((sandbox.ports || []).map(async (port) => {
    const hostPort = port.hostPort && port.hostPort > 0 ? port.hostPort : await findAvailablePort()
    hostPortsByGuest.set(port.guestPort, hostPort)
    return { ...port, hostPort }
  }))

  const box = new SimpleBox({
    name: runtimeName,
    reuseExisting: true,
    image: sandbox.image,
    runtime: getRuntime(),
    cpus: sandbox.cpus,
    memoryMib: sandbox.memoryMib,
    diskSizeGb: sandbox.diskSizeGb,
    workingDir: sandbox.workingDir || undefined,
    env: sandbox.env,
    volumes: sandbox.volumes,
    ports: mappedPorts,
    entrypoint: sandbox.entrypoint.length > 0 ? sandbox.entrypoint : undefined,
    cmd: sandbox.cmd.length > 0 ? sandbox.cmd : undefined,
    user: sandbox.user || undefined,
    autoRemove: false,
    detach: sandbox.detach,
  })
  const boxliteBoxId = await box.getId()

  activeBySandboxId.set(boxId, {
    sandboxId: boxId,
    box,
    hostPortsByGuest,
  })
  sandboxStore.updateSandbox(boxId, {
    status: 'running',
    boxliteBoxId,
    startedAt: Date.now(),
    stoppedAt: null,
  })

  const updated = sandboxStore.getSandbox(boxId)
  if (!updated) return null
  return sandboxToResource(updated, sandboxStore.listSandboxAcl(boxId))
}

export async function startBox(identity: ActorIdentity, boxId: string): Promise<BoxResource | null> {
  return withSandboxLock(boxId, () => startBoxUnlocked(identity, boxId))
}

export async function stopBox(identity: ActorIdentity, boxId: string): Promise<{ removed: boolean; box: BoxResource | null }> {
  return withSandboxLock(boxId, async () => {
    const existing = await resolveBox(identity, boxId)
    if (!existing) return { removed: false, box: null }
    if (existing._dune.managedByAgent && isSystemActor(identity)) {
      await stopRuntimeSandbox(boxId)
      const refreshed = await resolveBox(identity, boxId)
      return { removed: false, box: refreshed }
    }

    ensureSandboxMetadataMutability(identity, existing)
    assertOperatePermission(identity, boxId)

    const runtimeEntry = activeBySandboxId.get(boxId)
    if (runtimeEntry) {
      try { await runtimeEntry.box.stop() } catch {}
      activeBySandboxId.delete(boxId)
    }

    const sandbox = sandboxStore.getSandbox(boxId)
    if (!sandbox) return { removed: false, box: null }

    if (sandbox.durability === 'ephemeral' || sandbox.autoRemove) {
      sandboxStore.deleteSandbox(boxId)
      return { removed: true, box: null }
    }

    const updated = sandboxStore.updateSandbox(boxId, {
      status: 'stopped',
      stoppedAt: Date.now(),
    })
    if (!updated) return { removed: false, box: null }
    return { removed: false, box: sandboxToResource(updated, sandboxStore.listSandboxAcl(boxId)) }
  })
}

export async function getBoxStatus(identity: ActorIdentity, boxId: string): Promise<BoxStatusResponse | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  return {
    boxId: box.boxId,
    status: box.status,
    startedAt: box.startedAt,
    stoppedAt: box.stoppedAt,
  }
}

async function ensureRuntimeBox(identity: ActorIdentity, boxId: string, options: { locked?: boolean } = {}): Promise<ActiveSandboxRuntime> {
  const existing = await resolveBox(identity, boxId)
  if (existing?._dune.managedByAgent && (isSystemActor(identity) || identity.actorType === 'human')) {
    const runtime = await ensureRuntimeSandboxRunning(boxId)
    return {
      sandboxId: boxId,
      box: runtime.box,
      hostPortsByGuest: new Map<number, number>(),
    }
  }

  const current = activeBySandboxId.get(boxId)
  if (current) return current
  const started = options.locked
    ? await startBoxUnlocked(identity, boxId)
    : await startBox(identity, boxId)
  if (!started) throw new Error('not_found')
  const runtimeEntry = activeBySandboxId.get(boxId)
  if (!runtimeEntry) throw new Error('failed_to_start')
  return runtimeEntry
}

function serializeExecEventLines(events: ExecEvent[]): string {
  return events.map((event) => `id: ${event.seq}\nevent: ${event.eventType}\ndata: ${JSON.stringify({
    executionId: event.executionId,
    seq: event.seq,
    timestamp: event.timestamp,
    data: event.data,
  })}\n`).join('\n') + '\n'
}

export async function createExec(identity: ActorIdentity, boxId: string, req: ExecCreateRequest): Promise<ExecResource | null> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) return null
    ensureSandboxMutability(identity, box)
    assertOperatePermission(identity, boxId)
    ensureBoxRunning(identity, box)

    const runtimeEntry = await ensureRuntimeBox(identity, boxId, { locked: true })
    const created = sandboxStore.createExec(boxId, req)
    const startedAt = Date.now()

    void (async () => {
      try {
        const execResult = await runtimeEntry.box.exec(
          req.command,
          req.args || [],
          req.env || {},
        )

        const stdoutLines = splitNonEmptyLines(execResult.stdout)
        const stderrLines = splitNonEmptyLines(execResult.stderr)
        for (const line of stdoutLines) {
          sandboxStore.appendExecEvent(boxId, created.executionId, 'stdout', line)
        }
        for (const line of stderrLines) {
          sandboxStore.appendExecEvent(boxId, created.executionId, 'stderr', line)
        }

        sandboxStore.appendExecEvent(
          boxId,
          created.executionId,
          'exit',
          JSON.stringify({ exitCode: execResult.exitCode }),
        )

        const completedAt = Date.now()
        sandboxStore.updateExec(boxId, created.executionId, {
          status: execResult.exitCode === 0 ? 'completed' : 'failed',
          completedAt,
          durationMs: completedAt - startedAt,
          exitCode: execResult.exitCode,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          errorMessage: execResult.exitCode === 0 ? null : `exit ${execResult.exitCode}`,
        })
      } catch (err: any) {
        const completedAt = Date.now()
        const message = err?.message || 'Execution failed'
        sandboxStore.appendExecEvent(boxId, created.executionId, 'error', message)
        sandboxStore.updateExec(boxId, created.executionId, {
          status: 'failed',
          completedAt,
          durationMs: completedAt - startedAt,
          errorMessage: message,
        })
      }
    })()

    return created
  })
}

export async function listExecs(identity: ActorIdentity, boxId: string): Promise<ExecListResponse | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  return { execs: sandboxStore.listExecs(boxId) }
}

export async function getExec(identity: ActorIdentity, boxId: string, execId: string): Promise<ExecResource | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  return sandboxStore.getExec(boxId, execId)
}

export async function getExecEvents(identity: ActorIdentity, boxId: string, execId: string, afterSeq = 0, limit = 500): Promise<ExecEvent[] | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  const execution = sandboxStore.getExec(boxId, execId)
  if (!execution) return null
  const safeAfter = Number.isFinite(afterSeq) && afterSeq >= 0 ? Math.floor(afterSeq) : 0
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(1000, Math.floor(limit)) : 500
  return sandboxStore.listExecEvents(execId, safeAfter, safeLimit)
}

export async function streamExecEventsSse(identity: ActorIdentity, boxId: string, execId: string, afterSeq = 0, limit = 500): Promise<Response | null> {
  const events = await getExecEvents(identity, boxId, execId, afterSeq, limit)
  if (!events) return null
  const body = serializeExecEventLines(events)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function ensureHostPath(path: string): string {
  const abs = resolve(path)
  if (!isAbsolute(abs)) {
    throw new Error('hostPath must be absolute')
  }
  const allowedRoots = [...new Set([appConfig.repoRoot, appConfig.dataRoot].map(root => resolve(root)))]
  if (!allowedRoots.some(root => isWithin(root, abs))) {
    throw new Error(`hostPath must be within ${allowedRoots.join(' or ')}`)
  }
  if (!existsSync(abs)) {
    throw new Error('hostPath does not exist')
  }
  return abs
}

export async function uploadFileContent(
  identity: ActorIdentity,
  boxId: string,
  path: string,
  contentBase64: string,
  overwrite: boolean,
): Promise<void> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) throw new Error('not_found')
    ensureSandboxMutability(identity, box)
    assertOperatePermission(identity, boxId)
    ensureBoxRunning(identity, box)

    const runtimeEntry = await ensureRuntimeBox(identity, boxId, { locked: true })
    const containerPath = ensureContainerPath(path)
    const dirPath = ensureContainerPath(dirname(containerPath))
    const safeB64 = shQuote(contentBase64)
    const safePath = shQuote(containerPath)
    const safeDir = shQuote(dirPath)
    const checkOverwrite = overwrite ? '' : `if [ -e ${safePath} ]; then echo 'exists' >&2; exit 17; fi;`

    const cmd = `${checkOverwrite} mkdir -p ${safeDir} && printf '%s' ${safeB64} | base64 -d > ${safePath}`
    let result: { exitCode: number; stdout: string; stderr: string }
    try {
      result = await execWithShellFallback(runtimeEntry.box, cmd, {})
    } catch (err: any) {
      sandboxStore.recordFileOp({
        sandboxId: boxId,
        op: 'upload',
        path: containerPath,
        actorType: identity.actorType,
        actorId: identity.actorId,
        status: 'error',
        error: err?.message || 'upload_failed',
      })
      throw err
    }

    if (result.exitCode !== 0) {
      sandboxStore.recordFileOp({
        sandboxId: boxId,
        op: 'upload',
        path: containerPath,
        actorType: identity.actorType,
        actorId: identity.actorId,
        status: 'error',
        error: result.stderr || `exit ${result.exitCode}`,
      })
      if (!overwrite && result.exitCode === 17) throw new Error('file_exists')
      throw new Error(result.stderr || `Upload failed with exit ${result.exitCode}`)
    }

    sandboxStore.recordFileOp({
      sandboxId: boxId,
      op: 'upload',
      path: containerPath,
      actorType: identity.actorType,
      actorId: identity.actorId,
      status: 'ok',
      error: null,
    })
  })
}

export async function downloadFileContent(
  identity: ActorIdentity,
  boxId: string,
  path: string,
): Promise<FileDownloadResponse | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  ensureBoxRunning(identity, box)
  const runtimeEntry = await ensureRuntimeBox(identity, boxId)

  const containerPath = ensureContainerPath(path)
  const safePath = shQuote(containerPath)
  const result = await execWithShellFallback(runtimeEntry.box, `[ -f ${safePath} ] && base64 < ${safePath}`, {})
  if (result.exitCode !== 0) return null
  const contentBase64 = result.stdout.replace(/\s+/g, '')
  const size = contentBase64 ? Buffer.from(contentBase64, 'base64').length : 0
  return {
    path: containerPath,
    contentBase64,
    size,
  }
}

export async function listFsEntries(
  identity: ActorIdentity,
  boxId: string,
  path: string,
  options: { includeHidden?: boolean; limit?: number } = {},
): Promise<SandboxFsListResponse | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  const containerPath = normalizeContainerPath(path)
  ensureBoxRunning(identity, box)
  const runtimeEntry = await ensureRuntimeBox(identity, boxId)
  const includeHidden = !!options.includeHidden
  const limit = Number.isFinite(options.limit) && (options.limit || 0) > 0
    ? Math.min(5000, Math.floor(options.limit as number))
    : 1000

  const safePath = shQuote(containerPath)
  const listCmd = [
    `if [ ! -e ${safePath} ]; then exit 44; fi`,
    `if [ ! -d ${safePath} ]; then exit 45; fi`,
    'count=0',
    'truncated=0',
    `for entry in ${safePath}/* ${safePath}/.[!.]* ${safePath}/..?*; do`,
    '  [ -e "$entry" ] || continue',
    '  name="$(basename "$entry")"',
    `  if [ "${includeHidden ? '1' : '0'}" != "1" ] && [ "${'$'}{name#.}" != "${'$'}name" ]; then continue; fi`,
    '  type="other"',
    '  if [ -h "$entry" ]; then type="symlink"; elif [ -d "$entry" ]; then type="directory"; elif [ -f "$entry" ]; then type="file"; fi',
    '  size=""',
    '  if [ -f "$entry" ]; then size="$(wc -c < "$entry" 2>/dev/null || true)"; fi',
    '  modified="$(stat -c %Y "$entry" 2>/dev/null || stat -f %m "$entry" 2>/dev/null || true)"',
    '  printf \'%s\\t%s\\t%s\\t%s\\n\' "$name" "$type" "$size" "$modified"',
    `  count=$((${ '$' }count + 1))`,
    `  if [ "${'$'}count" -ge "${limit}" ]; then truncated=1; break; fi`,
    'done',
    'printf \'__TRUNCATED__\\t%s\\n\' "$truncated"',
  ].join('\n')

  const result = await execWithShellFallback(runtimeEntry.box, listCmd, {})
  if (result.exitCode === 44) throw new Error('path_not_found')
  if (result.exitCode === 45) throw new Error('not_directory')
  if (result.exitCode !== 0) throw new Error(result.stderr || `List failed with exit ${result.exitCode}`)

  const entries: SandboxFsEntry[] = []
  let truncated = false
  const lines = result.stdout.split(/\r?\n/g).filter((line) => line.trim().length > 0)
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts[0] === '__TRUNCATED__') {
      truncated = parts[1] === '1'
      continue
    }
    const name = parts[0] || ''
    if (!name) continue
    const typeRaw = parts[1] || 'other'
    const type: SandboxFsEntry['type'] = (
      typeRaw === 'file' || typeRaw === 'directory' || typeRaw === 'symlink' || typeRaw === 'other'
        ? typeRaw
        : 'other'
    )
    const size = parseInteger(parts[2]) ?? null
    const modifiedAtSeconds = parseInteger(parts[3])
    const modifiedAt = modifiedAtSeconds == null ? null : modifiedAtSeconds * 1000
    const fullPath = containerPath === '/' ? `/${name}` : `${containerPath}/${name}`
    entries.push({
      path: fullPath,
      name,
      type,
      size,
      modifiedAt,
      hidden: name.startsWith('.'),
    })
  }

  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })

  return {
    path: containerPath,
    parentPath: getContainerParentPath(containerPath),
    entries,
    truncated,
  }
}

export async function readFsFileContent(
  identity: ActorIdentity,
  boxId: string,
  path: string,
  maxBytes = 1024 * 1024,
): Promise<SandboxFsReadResponse | null> {
  const box = await resolveBox(identity, boxId)
  if (!box) return null
  assertReadPermission(identity, boxId)
  const containerPath = normalizeContainerPath(path)
  ensureBoxRunning(identity, box)
  const runtimeEntry = await ensureRuntimeBox(identity, boxId)
  const safePath = shQuote(containerPath)
  const safeMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0
    ? Math.min(10 * 1024 * 1024, Math.floor(maxBytes))
    : 1024 * 1024
  const readCmd = [
    `if [ ! -e ${safePath} ]; then exit 44; fi`,
    `if [ -d ${safePath} ]; then exit 45; fi`,
    `if [ ! -f ${safePath} ]; then exit 46; fi`,
    `size="$(wc -c < ${safePath} 2>/dev/null || echo 0)"`,
    `printf '__SIZE__\\t%s\\n' "${'$'}size"`,
    `head -c ${safeMaxBytes} ${safePath} | base64`,
  ].join('; ')

  const result = await execWithShellFallback(runtimeEntry.box, readCmd, {})
  if (result.exitCode === 44) throw new Error('path_not_found')
  if (result.exitCode === 45) throw new Error('not_file')
  if (result.exitCode === 46) throw new Error('not_file')
  if (result.exitCode !== 0) throw new Error(result.stderr || `Read failed with exit ${result.exitCode}`)

  const lines = result.stdout.split(/\r?\n/g)
  const sizeLine = lines.find((line) => line.startsWith('__SIZE__\t')) || ''
  const size = parseInteger(sizeLine.split('\t')[1]) ?? 0
  const contentBase64 = lines
    .filter((line) => !line.startsWith('__SIZE__\t'))
    .join('')
    .replace(/\s+/g, '')
  const mime = lookupMimeType(containerPath)
  return {
    path: containerPath,
    size,
    contentBase64,
    truncated: size > safeMaxBytes,
    mimeType: typeof mime === 'string' ? mime : null,
  }
}

export async function mkdirFsPath(
  identity: ActorIdentity,
  boxId: string,
  req: SandboxFsMkdirRequest,
): Promise<void> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) throw new Error('not_found')
    ensureSandboxMutability(identity, box)
    assertOperatePermission(identity, boxId)
    const containerPath = ensureNonRootPath(req.path)
    ensureBoxRunning(identity, box)
    const runtimeEntry = await ensureRuntimeBox(identity, boxId, { locked: true })
    const safePath = shQuote(containerPath)
    const recursive = req.recursive !== false
    const cmd = [
      `if [ -e ${safePath} ]; then exit 17; fi`,
      `mkdir ${recursive ? '-p ' : ''}${safePath}`,
    ].join('; ')

    const result = await execWithShellFallback(runtimeEntry.box, cmd, {})
    if (result.exitCode === 17) throw new Error('path_exists')
    if (result.exitCode !== 0) {
      if ((result.stderr || '').toLowerCase().includes('no such file')) {
        throw new Error('invalid_path')
      }
      throw new Error(result.stderr || `mkdir failed with exit ${result.exitCode}`)
    }
  })
}

export async function moveFsPath(
  identity: ActorIdentity,
  boxId: string,
  req: SandboxFsMoveRequest,
): Promise<void> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) throw new Error('not_found')
    ensureSandboxMutability(identity, box)
    assertOperatePermission(identity, boxId)
    const fromPath = ensureNonRootPath(req.fromPath)
    const toPath = ensureNonRootPath(req.toPath)
    ensureBoxRunning(identity, box)
    const runtimeEntry = await ensureRuntimeBox(identity, boxId, { locked: true })
    const safeFrom = shQuote(fromPath)
    const safeTo = shQuote(toPath)
    const parent = shQuote(getContainerParentPath(toPath) || '/')
    const overwrite = !!req.overwrite

    const cmd = [
      `if [ ! -e ${safeFrom} ]; then exit 44; fi`,
      `if [ ! -d ${parent} ]; then exit 47; fi`,
      `${overwrite ? '' : `if [ -e ${safeTo} ]; then exit 17; fi`}`,
      `${overwrite ? `rm -rf ${safeTo};` : ''} mv ${safeFrom} ${safeTo}`,
    ].join('; ')

    const result = await execWithShellFallback(runtimeEntry.box, cmd, {})
    if (result.exitCode === 44) throw new Error('path_not_found')
    if (result.exitCode === 47) throw new Error('invalid_path')
    if (result.exitCode === 17) throw new Error('path_exists')
    if (result.exitCode !== 0) throw new Error(result.stderr || `move failed with exit ${result.exitCode}`)
  })
}

export async function deleteFsPath(
  identity: ActorIdentity,
  boxId: string,
  path: string,
  recursive = false,
): Promise<void> {
  return withSandboxLock(boxId, async () => {
    const box = await resolveBox(identity, boxId)
    if (!box) throw new Error('not_found')
    ensureSandboxMutability(identity, box)
    assertOperatePermission(identity, boxId)
    const containerPath = ensureNonRootPath(path)
    ensureBoxRunning(identity, box)
    const runtimeEntry = await ensureRuntimeBox(identity, boxId, { locked: true })
    const safePath = shQuote(containerPath)
    const cmd = recursive
      ? [
          `if [ ! -e ${safePath} ]; then exit 44; fi`,
          `rm -rf ${safePath}`,
        ].join('; ')
      : [
          `if [ ! -e ${safePath} ]; then exit 44; fi`,
          `if [ -d ${safePath} ]; then rmdir ${safePath}; else rm -f ${safePath}; fi`,
        ].join('; ')

    const result = await execWithShellFallback(runtimeEntry.box, cmd, {})
    if (result.exitCode === 44) throw new Error('path_not_found')
    if (!recursive && result.exitCode !== 0) {
      const stderr = (result.stderr || '').toLowerCase()
      if (stderr.includes('directory not empty') || stderr.includes('not empty')) {
        throw new Error('dir_not_empty')
      }
    }
    if (result.exitCode !== 0) throw new Error(result.stderr || `delete failed with exit ${result.exitCode}`)
  })
}

export async function importHostPath(identity: ActorIdentity, boxId: string, req: HostImportRequest): Promise<void> {
  const hostPath = ensureHostPath(req.hostPath)
  const destPath = ensureContainerPath(req.destPath)

  const box = await resolveBox(identity, boxId)
  if (!box) throw new Error('not_found')
  ensureSandboxMutability(identity, box)
  assertOperatePermission(identity, boxId)
  ensureBoxRunning(identity, box)
  const stat = statSync(hostPath)

  if (stat.isFile()) {
    const contentBase64 = readFileSync(hostPath).toString('base64')
    const target = destPath.endsWith('/') ? `${destPath}${hostPath.split('/').pop()}` : destPath
    await uploadFileContent(identity, boxId, target, contentBase64, true)
    return
  }

  if (!stat.isDirectory()) {
    throw new Error('hostPath must be a file or directory')
  }

  const parent = dirname(hostPath)
  const base = hostPath.split('/').pop() || '.'
  const tarBase64 = execSync(
    `tar -cf - -C ${shQuote(parent)} ${shQuote(base)} | base64`,
    { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 },
  ).replace(/\s+/g, '')

  const runtimeEntry = await ensureRuntimeBox(identity, boxId)
  const safeDest = shQuote(destPath)
  const safeB64 = shQuote(tarBase64)
  const cmd = [
    `mkdir -p ${safeDest}`,
    `printf '%s' ${safeB64} | base64 -d > /tmp/dune-import.tar`,
    `tar -xf /tmp/dune-import.tar -C ${safeDest}`,
    'rm -f /tmp/dune-import.tar',
  ].join(' && ')

  const result = await execWithShellFallback(runtimeEntry.box, cmd, {})
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Import failed with exit ${result.exitCode}`)
  }
}

export async function getTerminalBox(identity: ActorIdentity, boxId: string): Promise<any> {
  const box = await resolveBox(identity, boxId)
  if (!box) throw new Error('not_found')
  assertReadPermission(identity, boxId)
  ensureBoxRunning(identity, box)
  const runtimeEntry = await ensureRuntimeBox(identity, boxId)
  const nativeBox = await runtimeEntry.box['_ensureBox']()
  return nativeBox
}

export async function reconcileSandboxesOnStartup(): Promise<void> {
  const now = Date.now()
  const sandboxes = sandboxStore.listSandboxes(10_000)
  for (const sandbox of sandboxes) {
    if (sandbox.managedByAgent) continue
    if (sandbox.status === 'running' || sandbox.status === 'stopping' || sandbox.status === 'creating') {
      if (sandbox.durability === 'ephemeral' || sandbox.autoRemove) {
        sandboxStore.deleteSandbox(sandbox.id)
      } else {
        sandboxStore.updateSandbox(sandbox.id, {
          status: 'stopped',
          stoppedAt: now,
        })
      }
    }
  }

  const runtimeStates = agentRuntimeStore.listAgentRuntimeStates(10_000)
  const desiredManaged = new Set<string>()
  for (const runtimeState of runtimeStates) {
    if (!runtimeState.sandboxId) continue
    const agent = agentStore.getAgent(runtimeState.agentId)
    if (!agent) continue

    const sandboxId = runtimeState.sandboxId
    if (sandboxId.startsWith('pending:')) continue
    desiredManaged.add(sandboxId)

    sandboxStore.upsertManagedRuntimeSandbox({
      sandboxId,
      agentId: runtimeState.agentId,
      name: `${agent.name} runtime`,
      status: 'stopped',
      startedAt: runtimeState.lastStartedAt ?? runtimeState.createdAt,
      stoppedAt: runtimeState.lastStoppedAt ?? now,
      boxliteBoxId: sandboxId,
    })
  }

  const managedRows = sandboxStore.listManagedRuntimeSandboxes(10_000)
  for (const managed of managedRows) {
    if (!desiredManaged.has(managed.id)) {
      sandboxStore.deleteManagedRuntimeSandbox(managed.id)
    }
  }
}

export async function stopAllSandboxes(): Promise<void> {
  const ids = Array.from(activeBySandboxId.keys())
  await Promise.all(ids.map(async (id) => {
    await withSandboxLock(id, async () => {
      const active = activeBySandboxId.get(id)
      if (!active) return
      try { await active.box.stop() } catch {}
      activeBySandboxId.delete(id)
      const sandbox = sandboxStore.getSandbox(id)
      if (!sandbox) return
      if (sandbox.durability === 'ephemeral' || sandbox.autoRemove) {
        sandboxStore.deleteSandbox(id)
      } else {
        sandboxStore.updateSandbox(id, { status: 'stopped', stoppedAt: Date.now() })
      }
    })
  }))
}
