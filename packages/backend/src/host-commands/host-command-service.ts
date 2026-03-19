import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { isAbsolute, relative, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { sendToAll as broadcastAll } from '../gateway/broadcast.js'
import * as hostCommandStore from '../storage/host-command-store.js'
import type {
  HostCommandDecisionType,
  HostExecApprovalModeType,
  HostCommandRequest,
  HostCommandScopeType,
  SandboxActorTypeType,
} from '@dune/shared'

const requestEvents = new EventEmitter()
const WORKSPACE_ROOT = resolve(process.cwd())
const OUTPUT_BYTE_LIMIT = 64 * 1024

function isTerminalStatus(status: HostCommandRequest['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'rejected'
}

function isWithin(base: string, target: string): boolean {
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function ensureDirectory(path: string): void {
  try {
    if (!statSync(path).isDirectory()) throw new Error('invalid_cwd')
  } catch {
    throw new Error('invalid_cwd')
  }
}

function resolveWorkspaceScopedCwd(cwd: string | undefined): string {
  const raw = typeof cwd === 'string' ? cwd.trim() : ''
  const resolved = raw
    ? (isAbsolute(raw) ? resolve(raw) : resolve(WORKSPACE_ROOT, raw))
    : WORKSPACE_ROOT

  if (!isWithin(WORKSPACE_ROOT, resolved)) {
    throw new Error('workspace_scope_violation')
  }
  ensureDirectory(resolved)
  return resolved
}

function resolveFullHostCwd(cwd: string | undefined): string {
  const raw = typeof cwd === 'string' ? cwd.trim() : ''
  if (!raw) return WORKSPACE_ROOT
  if (!isAbsolute(raw)) {
    throw new Error('full_host_cwd_must_be_absolute')
  }
  const resolved = resolve(raw)
  ensureDirectory(resolved)
  return resolved
}

export function normalizeHostCommandScope(scope: string | undefined): HostCommandScopeType {
  if (!scope || scope === 'workspace') return 'workspace'
  if (scope === 'full-host') return 'full-host'
  throw new Error('invalid_scope')
}

export function normalizeHostCommandCwd(scope: HostCommandScopeType, cwd: string | undefined): string {
  return scope === 'workspace' ? resolveWorkspaceScopedCwd(cwd) : resolveFullHostCwd(cwd)
}

function notifyRequestUpdate(request: HostCommandRequest): void {
  requestEvents.emit(request.requestId)
  const eventType = request.status === 'pending' ? 'host-command:pending' : 'host-command:updated'
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

function collectLimitedOutput(stream: NodeJS.ReadableStream | null | undefined) {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false

  stream?.on('data', (rawChunk: Buffer | string) => {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    if (truncated) return

    const remaining = OUTPUT_BYTE_LIMIT - size
    if (remaining <= 0) {
      truncated = true
      return
    }

    if (chunk.length <= remaining) {
      chunks.push(chunk)
      size += chunk.length
      return
    }

    chunks.push(chunk.subarray(0, remaining))
    size += remaining
    truncated = true
  })

  return {
    getText: () => Buffer.concat(chunks).toString('utf-8'),
    isTruncated: () => truncated,
  }
}

async function executeHostCommand(request: HostCommandRequest): Promise<void> {
  const execResult = await new Promise<{
    exitCode: number
    stdout: string
    stderr: string
    stdoutTruncated: boolean
    stderrTruncated: boolean
    errorMessage: string | null
  }>((resolveExec) => {
    let child
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        shell: false,
        env: process.env,
      })
    } catch (err: any) {
      resolveExec({
        exitCode: -1,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        errorMessage: err?.message || 'spawn_failed',
      })
      return
    }

    const stdoutCollector = collectLimitedOutput(child.stdout)
    const stderrCollector = collectLimitedOutput(child.stderr)

    child.on('error', (err: any) => {
      resolveExec({
        exitCode: -1,
        stdout: stdoutCollector.getText(),
        stderr: stderrCollector.getText(),
        stdoutTruncated: stdoutCollector.isTruncated(),
        stderrTruncated: stderrCollector.isTruncated(),
        errorMessage: err?.message || 'spawn_failed',
      })
    })

    child.on('close', (code, signal) => {
      const normalizedExitCode = typeof code === 'number' ? code : -1
      const errorMessage = signal
        ? `terminated_by_signal:${signal}`
        : (normalizedExitCode === 0 ? null : `exit ${normalizedExitCode}`)

      resolveExec({
        exitCode: normalizedExitCode,
        stdout: stdoutCollector.getText(),
        stderr: stderrCollector.getText(),
        stdoutTruncated: stdoutCollector.isTruncated(),
        stderrTruncated: stderrCollector.isTruncated(),
        errorMessage,
      })
    })
  })

  const completedAt = Date.now()
  const finished = hostCommandStore.updateHostCommandRequest(request.requestId, {
    status: execResult.exitCode === 0 ? 'completed' : 'failed',
    completedAt,
    exitCode: execResult.exitCode,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    stdoutTruncated: execResult.stdoutTruncated,
    stderrTruncated: execResult.stderrTruncated,
    errorMessage: execResult.errorMessage,
  })

  if (finished) notifyRequestUpdate(finished)
}

type CreateHostCommandRequestInput = {
  agentId: string
  requestedByType: SandboxActorTypeType
  requestedById: string
  command: string
  args: string[]
  cwd: string
  scope: HostCommandScopeType
}

type ApproveHostCommandRequestInput = {
  requestId: string
  approverId: string
  elevatedConfirmed: boolean
}

export function createHostCommandRequest(input: CreateHostCommandRequestInput): HostCommandRequest {
  return hostCommandStore.createHostCommandRequest(input)
}

function rejectHostCommandRequest(input: {
  requestId: string
  approverId: string
}): HostCommandRequest | null {
  const current = hostCommandStore.getHostCommandRequest(input.requestId)
  if (!current) return null
  if (current.status !== 'pending') {
    throw new Error('request_not_pending')
  }

  const now = Date.now()
  const rejected = hostCommandStore.updateHostCommandRequest(current.requestId, {
    status: 'rejected',
    decision: 'reject',
    approverId: input.approverId,
    decidedAt: now,
    completedAt: now,
    elevatedConfirmed: false,
    errorMessage: 'rejected_by_admin',
  })
  if (rejected) notifyRequestUpdate(rejected)
  return rejected
}

function approveHostCommandRequest(input: ApproveHostCommandRequestInput): HostCommandRequest | null {
  const current = hostCommandStore.getHostCommandRequest(input.requestId)
  if (!current) return null
  if (current.status !== 'pending') {
    throw new Error('request_not_pending')
  }
  if (current.scope === 'full-host' && !input.elevatedConfirmed) {
    throw new Error('elevated_confirmation_required')
  }

  const now = Date.now()
  const approved = hostCommandStore.updateHostCommandRequest(current.requestId, {
    decision: 'approve',
    approverId: input.approverId,
    decidedAt: now,
    elevatedConfirmed: input.elevatedConfirmed,
    status: 'running',
    startedAt: now,
    errorMessage: null,
  })

  if (approved) {
    notifyRequestUpdate(approved)
    void executeHostCommand(approved)
  }

  return approved
}

export async function submitHostCommandRequest(input: CreateHostCommandRequestInput & {
  approvalMode: HostExecApprovalModeType
}): Promise<HostCommandRequest> {
  const request = createHostCommandRequest(input)
  if (input.approvalMode === 'dangerously-skip') {
    return approveHostCommandRequest({
      requestId: request.requestId,
      approverId: 'policy:auto',
      elevatedConfirmed: request.scope === 'full-host',
    }) ?? request
  }

  notifyRequestUpdate(request)
  return request
}

export function getHostCommandRequest(requestId: string): HostCommandRequest | null {
  return hostCommandStore.getHostCommandRequest(requestId)
}

export function listPendingHostCommandRequests(limit = 200): HostCommandRequest[] {
  return hostCommandStore.listPendingHostCommandRequests(limit)
}

export async function autoApprovePendingHostCommandRequestsForAgent(agentId: string): Promise<HostCommandRequest[]> {
  const pending = hostCommandStore.listPendingHostCommandRequestsByAgent(agentId, 500)
  const approved: HostCommandRequest[] = []
  for (const request of pending) {
    try {
      const next = approveHostCommandRequest({
        requestId: request.requestId,
        approverId: 'policy:auto',
        elevatedConfirmed: request.scope === 'full-host',
      })
      if (next) approved.push(next)
    } catch (err: any) {
      if (String(err?.message || '') === 'request_not_pending') continue
      throw err
    }
  }
  return approved
}

export async function waitForTerminalHostCommand(requestId: string): Promise<HostCommandRequest | null> {
  while (true) {
    const current = hostCommandStore.getHostCommandRequest(requestId)
    if (!current) return null
    if (isTerminalStatus(current.status)) return current
    await waitForRequestUpdate(requestId)
  }
}

export async function decideHostCommandRequest(input: {
  requestId: string
  decision: HostCommandDecisionType
  approverId: string
  elevatedConfirmed: boolean
}): Promise<HostCommandRequest | null> {
  if (input.decision === 'reject') {
    return rejectHostCommandRequest({
      requestId: input.requestId,
      approverId: input.approverId,
    })
  }

  return approveHostCommandRequest({
    requestId: input.requestId,
    approverId: input.approverId,
    elevatedConfirmed: input.elevatedConfirmed,
  })
}
