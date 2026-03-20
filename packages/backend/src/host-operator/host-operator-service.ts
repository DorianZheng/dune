import { EventEmitter } from 'node:events'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { config } from '../config.js'
import { broadcastAll } from '../websocket/ws-server.js'
import * as hostOperatorStore from '../storage/host-operator-store.js'
import {
  createDefaultHostOperatorProvider,
  type HostOperatorProvider,
  type HostOperatorProviderResult,
} from './provider.js'
import type {
  Agent,
  HostOperatorActCreateRequest,
  HostOperatorApprovalModeType,
  HostOperatorCreateRequest,
  HostOperatorDecisionType,
  HostOperatorFilesystemCreateRequest,
  HostOperatorOverviewCreateRequest,
  HostOperatorPerceiveCreateRequest,
  HostOperatorRequest,
  HostOperatorRunningApp,
  HostOperatorStatusCreateRequest,
  HostOperatorTarget,
  SandboxActorTypeType,
} from '@dune/shared'

const requestEvents = new EventEmitter()
const HOST_OPERATOR_GUEST_ARTIFACT_ROOT = '/config/.dune/system/host-operator'

/** Grants: auto-approve subsequent requests for the same agent + target within a time window. */
const GRANT_TTL_MS = 30 * 60 * 1000 // 30 minutes
interface Grant { expiresAt: number }
/** Key format: `${agentId}:app:${bundleId}` or `${agentId}:path:${root}` */
const grants = new Map<string, Grant>()

function grantKey(agentId: string, kind: 'app' | 'path', target: string): string {
  return `${agentId}:${kind}:${target}`
}

function recordGrant(agentId: string, kind: 'app' | 'path', target: string): void {
  grants.set(grantKey(agentId, kind, target), { expiresAt: Date.now() + GRANT_TTL_MS })
}

function hasActiveGrant(agentId: string, kind: 'app' | 'path', target: string): boolean {
  const key = grantKey(agentId, kind, target)
  const grant = grants.get(key)
  if (!grant) return false
  if (Date.now() > grant.expiresAt) { grants.delete(key); return false }
  return true
}

function recordGrantsFromRequest(agentId: string, request: HostOperatorRequest): void {
  const target = request.target as HostOperatorTarget | null
  if (target?.bundleId) recordGrant(agentId, 'app', target.bundleId)
  if (target?.path) {
    // Grant the root directory, not the specific file
    const root = target.path
    recordGrant(agentId, 'path', root)
  }
}

function hasGrantForRequest(agentId: string, input: HostOperatorCreateRequest): boolean {
  switch (input.kind) {
    case 'status': return true
    case 'overview': return !input.bundleId || hasActiveGrant(agentId, 'app', input.bundleId.trim())
    case 'perceive': return hasActiveGrant(agentId, 'app', (input.bundleId || '').trim())
    case 'act': {
      if (input.action === 'clipboard_read' || input.action === 'clipboard_write') return false
      return hasActiveGrant(agentId, 'app', (input.bundleId || '').trim())
    }
    case 'filesystem': return false // always require approval for filesystem ops
    default: return false
  }
}

let provider: HostOperatorProvider = createDefaultHostOperatorProvider({
  helperPath: config.hostOperatorHelperPath,
})

function isTerminalStatus(status: HostOperatorRequest['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'rejected'
}

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function listAllowedApps(agent: Pick<Agent, 'hostOperatorApps'>): string[] {
  return [...new Set(agent.hostOperatorApps.map((item) => item.trim()).filter(Boolean))]
}

function listAllowedRoots(agent: Pick<Agent, 'hostOperatorPaths'>): string[] {
  return [...new Set(agent.hostOperatorPaths.map((item) => {
    const normalized = resolve(item.trim())
    return existsSync(normalized) ? realpathSync(normalized) : normalized
  }).filter(Boolean))]
}

function ensureAllowedBundleId(bundleId: string | undefined, agent: Pick<Agent, 'hostOperatorApps'>, options?: { enforceAllowlist?: boolean }): string {
  const normalized = typeof bundleId === 'string' ? bundleId.trim() : ''
  if (!normalized) throw new Error('bundle_id_required')
  if (options?.enforceAllowlist !== false) {
    const allowed = listAllowedApps(agent)
    if (!allowed.includes(normalized)) throw new Error('bundle_id_not_allowed')
  }
  return normalized
}

function safeResolveExisting(pathValue: string): string {
  const resolved = resolve(pathValue)
  if (!existsSync(resolved)) throw new Error('path_not_found')
  return realpathSync(resolved)
}

function safeResolveWriteTarget(pathValue: string): string {
  const resolved = resolve(pathValue)
  const parent = dirname(resolved)
  if (!existsSync(parent)) throw new Error('parent_path_not_found')
  const realParent = realpathSync(parent)
  return join(realParent, resolved.slice(parent.length).replace(/^\/+/, ''))
}

function ensureAllowedHostPath(pathValue: string | undefined, agent: Pick<Agent, 'hostOperatorPaths'>, options: { allowMissingLeaf?: boolean; enforceAllowlist?: boolean } = {}): string {
  const normalized = typeof pathValue === 'string' ? pathValue.trim() : ''
  if (!normalized) throw new Error('path_required')
  if (!isAbsolute(normalized)) throw new Error('path_must_be_absolute')

  if (options.enforceAllowlist === false) return resolve(normalized)

  const candidate = options.allowMissingLeaf ? safeResolveWriteTarget(normalized) : safeResolveExisting(normalized)
  const allowedRoots = listAllowedRoots(agent)
  if (!allowedRoots.some((root) => isWithin(root, candidate))) {
    throw new Error('path_not_allowed')
  }
  return candidate
}

function buildRequestMetadata(
  agent: Pick<Agent, 'hostOperatorApps' | 'hostOperatorPaths'>,
  input: HostOperatorCreateRequest,
  options?: { enforceAllowlist?: boolean },
): { target: HostOperatorTarget | null; summary: string } {
  const enforce = options?.enforceAllowlist
  switch (input.kind) {
    case 'status':
      return { target: null, summary: 'Check host operator status' }
    case 'overview':
      return {
        target: input.bundleId ? { bundleId: ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce }) } : null,
        summary: input.bundleId ? `Inspect visible windows for ${input.bundleId}` : 'Inspect visible windows for allowed host apps',
      }
    case 'perceive': {
      const bundleId = ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce })
      return {
        target: { bundleId, windowId: input.windowId ?? null },
        summary: `${input.mode} on ${bundleId}`,
      }
    }
    case 'act': {
      const bundleId = input.action === 'clipboard_read' || input.action === 'clipboard_write'
        ? undefined
        : (input.bundleId ? ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce }) : undefined)
      return {
        target: {
          bundleId,
          windowId: input.windowId ?? null,
          point: input.point,
        },
        summary: bundleId ? `${input.action} on ${bundleId}` : `${input.action} on host`,
      }
    }
    case 'filesystem': {
      const isWriteLike = input.op === 'write' || input.op === 'delete'
      const path = ensureAllowedHostPath(input.path, agent, { allowMissingLeaf: isWriteLike && input.op === 'write', enforceAllowlist: enforce })
      return {
        target: { path },
        summary: `${input.op} ${path}`,
      }
    }
    default:
      throw new Error('invalid_host_operator_request')
  }
}

function validateInput(agent: Pick<Agent, 'hostOperatorApps' | 'hostOperatorPaths'>, input: HostOperatorCreateRequest, options?: { enforceAllowlist?: boolean }): HostOperatorCreateRequest {
  const enforce = options?.enforceAllowlist
  switch (input.kind) {
    case 'status':
      return input
    case 'overview':
      if (input.bundleId) ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce })
      return input
    case 'perceive':
      ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce })
      if (input.mode === 'find' && (!input.query || !input.query.trim())) throw new Error('query_required')
      return input
    case 'act': {
      const requiresBundle = input.action !== 'clipboard_read' && input.action !== 'clipboard_write'
      if (requiresBundle) ensureAllowedBundleId(input.bundleId, agent, { enforceAllowlist: enforce })
      if (['click', 'double_click', 'right_click', 'hover', 'drag', 'scroll', 'select'].includes(input.action) && !input.point) {
        throw new Error('point_required')
      }
      if (input.action === 'drag' && !input.toPoint) throw new Error('to_point_required')
      if ((input.action === 'type' || input.action === 'clipboard_write') && typeof input.text !== 'string') {
        throw new Error('text_required')
      }
      if (input.action === 'press' && (!input.key || !input.key.trim())) throw new Error('key_required')
      if (input.action === 'url' && (!input.url || !input.url.trim())) throw new Error('url_required')
      if (input.action === 'navigate' && (!input.url || !input.url.trim())) throw new Error('url_required')
      return input
    }
    case 'filesystem':
      if (input.op === 'search' && (!input.query || !input.query.trim())) throw new Error('query_required')
      if (input.op === 'write' && typeof input.content !== 'string') throw new Error('content_required')
      ensureAllowedHostPath(input.path, agent, { allowMissingLeaf: input.op === 'write', enforceAllowlist: enforce })
      return input
    default:
      throw new Error('invalid_host_operator_request')
  }
}

function getArtifactHostDir(agentId: string): string {
  return join(config.agentsRoot, agentId, '.dune', 'system', 'host-operator')
}

function toGuestArtifactPath(fileName: string): string {
  return `${HOST_OPERATOR_GUEST_ARTIFACT_ROOT}/${fileName}`
}

function writeArtifacts(agentId: string, requestId: string, artifacts: Array<{ name: string; contentBase64: string }> | undefined): string[] {
  if (!artifacts || artifacts.length === 0) return []
  const hostDir = getArtifactHostDir(agentId)
  mkdirSync(hostDir, { recursive: true })

  return artifacts.map((artifact, index) => {
    const baseName = artifact.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `artifact-${index + 1}.bin`
    const fileName = `${requestId}-${index + 1}-${baseName}`
    writeFileSync(join(hostDir, fileName), Buffer.from(artifact.contentBase64, 'base64'))
    return toGuestArtifactPath(fileName)
  })
}

function filterOverviewResultForAllowedApps(resultJson: unknown, agent: Pick<Agent, 'hostOperatorApps'>): unknown {
  const allowedApps = new Set(listAllowedApps(agent))
  if (allowedApps.size === 0) return { windows: [] }
  if (!resultJson || typeof resultJson !== 'object') return resultJson
  const record = resultJson as Record<string, unknown>
  const windows = Array.isArray(record.windows) ? record.windows : []
  return {
    ...record,
    windows: windows.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false
      const bundleId = typeof (entry as Record<string, unknown>).bundleId === 'string'
        ? String((entry as Record<string, unknown>).bundleId)
        : ''
      return allowedApps.has(bundleId)
    }),
  }
}

async function executeRequest(request: HostOperatorRequest, agent: Agent): Promise<void> {
  let result: HostOperatorProviderResult
  switch (request.kind) {
    case 'overview':
      result = await provider.overview(request.input as HostOperatorOverviewCreateRequest)
      result.resultJson = filterOverviewResultForAllowedApps(result.resultJson, agent)
      break
    case 'perceive':
      result = await provider.perceive(request.input as HostOperatorPerceiveCreateRequest)
      // Embed image artifacts inline as MCP-style content (matching rescreen format)
      if (result.artifacts && result.artifacts.length > 0) {
        const content: Array<Record<string, unknown>> = []
        for (const artifact of result.artifacts) {
          if (/\.(png|jpe?g|gif|webp)$/i.test(artifact.name)) {
            const ext = artifact.name.split('.').pop()?.toLowerCase() ?? 'png'
            const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
            content.push({ type: 'image', data: artifact.contentBase64, mimeType: mime })
          }
        }
        const existing = result.resultJson as Record<string, unknown> | null
        if (existing?.result) {
          content.push({ type: 'text', text: typeof existing.result === 'string' ? existing.result : JSON.stringify(existing.result) })
        }
        if (content.length > 0) {
          result.resultJson = { content }
        }
      }
      break
    case 'act':
      result = await provider.act(request.input as HostOperatorActCreateRequest)
      break
    case 'status':
      result = await provider.status(request.input as HostOperatorStatusCreateRequest)
      break
    case 'filesystem':
      result = await provider.filesystem(request.input as HostOperatorFilesystemCreateRequest)
      break
    default:
      throw new Error('invalid_host_operator_request')
  }

  const finished = hostOperatorStore.updateHostOperatorRequest(request.requestId, {
    status: 'completed',
    completedAt: Date.now(),
    resultJson: result.resultJson,
    artifactPaths: writeArtifacts(request.agentId, request.requestId, result.artifacts),
    errorMessage: null,
  })

  if (finished) notifyRequestUpdate(finished)
}

function notifyRequestUpdate(request: HostOperatorRequest): void {
  requestEvents.emit(request.requestId)
  const eventType = request.status === 'pending' ? 'host-operator:pending' : 'host-operator:updated'
  broadcastAll({
    type: eventType,
    payload: request,
  })
}

function waitForRequestUpdate(requestId: string): Promise<void> {
  return new Promise((resolveWait) => {
    const listener = () => {
      requestEvents.removeListener(requestId, listener)
      resolveWait()
    }
    requestEvents.on(requestId, listener)
  })
}

function rejectHostOperatorRequest(input: {
  requestId: string
  approverId: string
}): HostOperatorRequest | null {
  const current = hostOperatorStore.getHostOperatorRequest(input.requestId)
  if (!current) return null
  if (current.status !== 'pending') throw new Error('request_not_pending')

  const rejected = hostOperatorStore.updateHostOperatorRequest(current.requestId, {
    status: 'rejected',
    decision: 'reject',
    approverId: input.approverId,
    decidedAt: Date.now(),
    completedAt: Date.now(),
    errorMessage: 'rejected_by_admin',
  })
  if (rejected) notifyRequestUpdate(rejected)
  return rejected
}

function markRequestFailed(request: HostOperatorRequest, message: string): HostOperatorRequest | null {
  const failed = hostOperatorStore.updateHostOperatorRequest(request.requestId, {
    status: 'failed',
    completedAt: Date.now(),
    errorMessage: message,
  })
  if (failed) notifyRequestUpdate(failed)
  return failed
}

async function runApprovedRequest(request: HostOperatorRequest, agent: Agent): Promise<HostOperatorRequest | null> {
  try {
    await executeRequest(request, agent)
  } catch (err: any) {
    return markRequestFailed(request, String(err?.message || 'host_operator_execution_failed'))
  }
  return hostOperatorStore.getHostOperatorRequest(request.requestId)
}

export function __setHostOperatorProviderForTests(nextProvider: HostOperatorProvider | null): void {
  provider = nextProvider ?? createDefaultHostOperatorProvider({ helperPath: config.hostOperatorHelperPath })
}

export async function listRunningHostOperatorApps(): Promise<HostOperatorRunningApp[]> {
  return provider.listApps()
}

export function getHostOperatorRequest(requestId: string): HostOperatorRequest | null {
  return hostOperatorStore.getHostOperatorRequest(requestId)
}

export function listPendingHostOperatorRequests(limit = 200): HostOperatorRequest[] {
  return hostOperatorStore.listPendingHostOperatorRequests(limit)
}

export async function submitHostOperatorRequest(input: {
  agent: Agent
  requestedByType: SandboxActorTypeType
  requestedById: string
  request: HostOperatorCreateRequest
  approvalMode: HostOperatorApprovalModeType
}): Promise<HostOperatorRequest> {
  const enforceAllowlist = input.approvalMode === 'dangerously-skip'
  const validated = validateInput(input.agent, input.request, { enforceAllowlist })
  const metadata = buildRequestMetadata(input.agent, validated, { enforceAllowlist })
  const created = hostOperatorStore.createHostOperatorRequest({
    agentId: input.agent.id,
    requestedByType: input.requestedByType,
    requestedById: input.requestedById,
    kind: validated.kind,
    input: validated,
    target: metadata.target,
    summary: metadata.summary,
  })

  if (validated.kind === 'status') {
    const running = hostOperatorStore.updateHostOperatorRequest(created.requestId, {
      decision: 'approve',
      approverId: 'policy:status',
      decidedAt: Date.now(),
      startedAt: Date.now(),
      status: 'running',
    }) ?? created
    notifyRequestUpdate(running)
    await runApprovedRequest(running, input.agent)
    return hostOperatorStore.getHostOperatorRequest(created.requestId) ?? running
  }

  if (input.approvalMode === 'dangerously-skip') {
    const running = hostOperatorStore.updateHostOperatorRequest(created.requestId, {
      decision: 'approve',
      approverId: 'policy:auto',
      decidedAt: Date.now(),
      startedAt: Date.now(),
      status: 'running',
      errorMessage: null,
    }) ?? created
    notifyRequestUpdate(running)
    await runApprovedRequest(running, input.agent)
    return hostOperatorStore.getHostOperatorRequest(created.requestId) ?? running
  }

  // Auto-approve if a recent grant exists for this agent + target (e.g., app already approved within 30min)
  if (hasGrantForRequest(input.agent.id, validated)) {
    const running = hostOperatorStore.updateHostOperatorRequest(created.requestId, {
      decision: 'approve',
      approverId: 'policy:grant',
      decidedAt: Date.now(),
      startedAt: Date.now(),
      status: 'running',
      errorMessage: null,
    }) ?? created
    notifyRequestUpdate(running)
    await runApprovedRequest(running, input.agent)
    return hostOperatorStore.getHostOperatorRequest(created.requestId) ?? running
  }

  notifyRequestUpdate(created)
  return created
}

export async function autoApprovePendingHostOperatorRequestsForAgent(agent: Agent): Promise<HostOperatorRequest[]> {
  const pending = hostOperatorStore.listPendingHostOperatorRequestsByAgent(agent.id, 500)
  const approved: HostOperatorRequest[] = []
  for (const request of pending) {
    const running = hostOperatorStore.updateHostOperatorRequest(request.requestId, {
      decision: 'approve',
      approverId: 'policy:auto',
      decidedAt: Date.now(),
      startedAt: Date.now(),
      status: 'running',
      errorMessage: null,
    })
    if (!running) continue
    notifyRequestUpdate(running)
    approved.push(running)
    await runApprovedRequest(running, agent)
  }
  return approved
}

export async function waitForTerminalHostOperatorRequest(requestId: string): Promise<HostOperatorRequest | null> {
  while (true) {
    const current = hostOperatorStore.getHostOperatorRequest(requestId)
    if (!current) return null
    if (isTerminalStatus(current.status)) return current
    await waitForRequestUpdate(requestId)
  }
}

export async function decideHostOperatorRequest(input: {
  requestId: string
  decision: HostOperatorDecisionType
  approverId: string
  agentLookup: (agentId: string) => Agent | undefined
}): Promise<HostOperatorRequest | null> {
  if (input.decision === 'reject') {
    return rejectHostOperatorRequest({
      requestId: input.requestId,
      approverId: input.approverId,
    })
  }

  const current = hostOperatorStore.getHostOperatorRequest(input.requestId)
  if (!current) return null
  if (current.status !== 'pending') throw new Error('request_not_pending')

  const running = hostOperatorStore.updateHostOperatorRequest(current.requestId, {
    decision: 'approve',
    approverId: input.approverId,
    decidedAt: Date.now(),
    startedAt: Date.now(),
    status: 'running',
    errorMessage: null,
  })
  if (!running) return null

  notifyRequestUpdate(running)
  recordGrantsFromRequest(running.agentId, running)
  const agent = input.agentLookup(running.agentId)
  if (!agent) {
    return markRequestFailed(running, 'agent_not_found')
  }
  await runApprovedRequest(running, agent)
  return hostOperatorStore.getHostOperatorRequest(running.requestId)
}
