import { resolve, join, dirname } from 'node:path'
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync, unlinkSync, type Dirent } from 'node:fs'
import type { HandlerMap, Handler, CallContext } from './protocol.js'
import * as broadcast from './broadcast.js'
import * as channelStore from '../storage/channel-store.js'
import * as messageStore from '../storage/message-store.js'
import * as agentStore from '../storage/agent-store.js'
import * as agentLogStore from '../storage/agent-log-store.js'
import * as agentRuntimeMountStore from '../storage/agent-runtime-mount-store.js'
import * as miniappStore from '../storage/miniapp-store.js'
import * as todoStore from '../storage/todo-store.js'
import * as claudeSettingsStore from '../storage/claude-settings-store.js'
import * as agentManager from '../agents/agent-manager.js'
import * as mailboxService from '../mailbox/mailbox-service.js'
import * as hostOperatorService from '../host-operator/host-operator-service.js'
import * as hostGrantStore from '../storage/host-grant-store.js'
import * as sandboxManager from '../sandboxes/sandbox-manager.js'
import * as todoTimer from '../todos/todo-timer.js'
import { parseAndValidateDueAt } from '../todos/due-at.js'
import { onNewMessage } from '../agents/orchestrator.js'
import { parseMentions } from '../utils/mentions.js'
import { config } from '../config.js'
import {
  HostDirectoryPickerError,
  pickHostDirectory,
} from '../utils/host-directory-picker.js'
import type {
  CreateAgentMountRequest,
  AgentRoleType,
  AgentWorkModeType,
  HostOperatorCreateRequest,
  HostOperatorApprovalModeType,
  ClaudeSettingsUpdate,
  SelectedModelProvider,
  UpdateAgentMountRequest,
} from '@dune/shared'

// ── Validation helpers (from api/agents.ts) ───────────────────────────

const CLAUDE_MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const START_ALL_MAX_CONCURRENCY = 4
const START_ALL_TIMEOUT_GRACE_MS = 2_000

function normalizeAgentRole(value: unknown): AgentRoleType {
  if (value === 'leader' || value === 'follower') return value
  throw new Error('invalid_agent_role')
}

function normalizeAgentWorkMode(value: unknown): AgentWorkModeType {
  if (value === 'normal' || value === 'plan-first') return value
  throw new Error('invalid_agent_work_mode')
}

function normalizeClaudeModelId(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('invalid_model_id')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!CLAUDE_MODEL_ID_PATTERN.test(trimmed)) throw new Error('invalid_model_id')
  return trimmed
}

function normalizeHostOperatorApprovalMode(value: unknown): HostOperatorApprovalModeType {
  if (value === 'approval-required' || value === 'dangerously-skip') return value
  throw new Error('invalid_host_operator_approval_mode')
}

function normalizeStringArray(value: unknown, errorMessage: string): string[] {
  if (!Array.isArray(value)) throw new Error(errorMessage)
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

function isNoResponse(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '[NO_RESPONSE]' || trimmed.endsWith('[NO_RESPONSE]')
}

function getAgentMaps() {
  const allAgents = agentStore.listAgents()
  return {
    allAgents,
    agentMap: new Map(allAgents.map((agent) => [agent.id, agent])),
  }
}

function getAuthorName(agentMap: Map<string, { name: string }>, authorId: string): string {
  return agentMap.get(authorId)?.name || (authorId === 'system' ? 'System' : 'User')
}

function buildChannelInputMetadata(
  agentMap: Map<string, { name: string }>,
  channels: mailboxService.MailboxChannelMessages[],
): agentManager.InputMetadata {
  return {
    source: 'channel',
    channels: channels.map((channel) => ({
      name: channel.channelName,
      messages: channel.messages.map((message) => ({
        author: getAuthorName(agentMap, message.authorId),
        content: message.content,
      })),
    })),
  }
}

function buildMailboxPrompt(unreadCount: number): string {
  const label = unreadCount === 1 ? 'message' : 'messages'
  return [
    `You have ${unreadCount} unread ${label} in your mailbox.`,
    'Use the mailbox endpoints on the local Dune proxy to inspect the unread batch yourself.',
    'After you respond, or decide nothing needs a reply, acknowledge the fetched batch.',
    'Do not fetch channel history unless you intentionally want older context.',
  ].join('\n')
}

function appendTeamRoster(promptParts: string[], allAgents: Array<{ id: string; name: string; personality: string; role: AgentRoleType }>, agentId: string): void {
  const otherAgents = allAgents.filter((agent) => agent.id !== agentId)
  if (otherAgents.length === 0) return
  const roster = otherAgents.map((agent) => `${agent.name} [${agent.role}] (${agent.personality.split('.')[0]})`).join(', ')
  promptParts.push(`[Team members: ${roster}]`)
}

function getMemoryDir(agentId: string): string {
  return join(config.agentsRoot, agentId, '.dune', 'memory')
}

function safeRelativePath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) return null
  return normalized
}

const CLAUDE_SETTINGS_KEYS = new Set([
  'selectedModelProvider',
  'defaultModelId',
  'anthropicApiKey',
  'claudeCodeOAuthToken',
  'anthropicAuthToken',
  'anthropicBaseUrl',
  'claudeCodeDisableNonessentialTraffic',
])
const SELECTED_MODEL_PROVIDERS = new Set<SelectedModelProvider | null>(['claude', null])

function parseClaudeSettingsUpdate(body: unknown): { value: ClaudeSettingsUpdate | null; error: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, error: 'Invalid JSON body' }
  }
  const patch: ClaudeSettingsUpdate = {}
  for (const [key, rawValue] of Object.entries(body as Record<string, unknown>)) {
    if (!CLAUDE_SETTINGS_KEYS.has(key)) return { value: null, error: `Unknown field: ${key}` }
    if (rawValue !== null && typeof rawValue !== 'string') return { value: null, error: `Field ${key} must be a string or null` }
    if (key === 'selectedModelProvider') {
      const normalized = rawValue == null ? null : (rawValue as string).trim() || null
      if (!SELECTED_MODEL_PROVIDERS.has(normalized as SelectedModelProvider | null)) return { value: null, error: `Field ${key} must be one of: claude` }
      ;(patch as Record<string, string | null>)[key] = normalized
      continue
    }
    if (key === 'defaultModelId') {
      const normalized = rawValue == null ? null : (rawValue as string).trim() || null
      if (normalized && !CLAUDE_MODEL_ID_PATTERN.test(normalized)) return { value: null, error: `Field ${key} must be a valid Claude model alias or id` }
      ;(patch as Record<string, string | null>)[key] = normalized
      continue
    }
    ;(patch as Record<string, string | null>)[key] = rawValue as string | null
  }
  return { value: patch, error: null }
}

// ── Handler Map ───────────────────────────────────────────────────────

export const clientHandlers: HandlerMap = new Map<string, Handler>()

function h(method: string, fn: Handler) {
  clientHandlers.set(method, fn)
}

// ── Channels ──────────────────────────────────────────────────────────

h('channels.list', async () => {
  return channelStore.listChannels()
})

h('channels.create', async (params) => {
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  if (!name) throw new Error('Channel name is required')
  const channel = channelStore.createChannel({ name, description: params.description as string | undefined })
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['channels'], reason: 'created' } })
  return channel
})

h('channels.get', async (params) => {
  const channel = channelStore.getChannel(params.id as string)
  if (!channel) throw new Error('not_found')
  return channel
})

h('channels.getByName', async (params) => {
  const channel = channelStore.getChannelByName(params.name as string)
  if (!channel) throw new Error('not_found')
  return channel
})

h('channels.update', async (params) => {
  const { id, ...data } = params as Record<string, unknown>
  if (data.name !== undefined) {
    if (typeof data.name !== 'string' || !(data.name as string).trim()) throw new Error('Channel name cannot be empty')
    data.name = (data.name as string).trim()
  }
  const channel = channelStore.updateChannel(id as string, data)
  if (!channel) throw new Error('not_found')
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['channels'], reason: 'updated' } })
  return channel
})

h('channels.delete', async (params) => {
  const ok = channelStore.deleteChannel(params.id as string)
  if (!ok) throw new Error('not_found')
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['channels'], reason: 'deleted' } })
  return { ok: true }
})

h('channels.getMessages', async (params) => {
  const limit = Number(params.limit || 50)
  const before = params.before ? Number(params.before) : undefined
  return messageStore.getChannelMessages(params.channelId as string, limit, before)
})

h('channels.sendMessage', async (params) => {
  const channelId = params.channelId as string
  const content = typeof params.content === 'string' ? params.content.trim() : ''
  const authorId = params.authorId as string
  if (!content) throw new Error('Message content is required')
  if (!authorId) throw new Error('Author ID is required')

  const channel = channelStore.getChannel(channelId)
  if (!channel) throw new Error('not_found')

  const authorAgent = agentStore.getAgent(authorId)
  if (authorAgent && !channelStore.isAgentSubscribed(authorAgent.id, channelId)) {
    throw new Error(`Agent "${authorAgent.name}" is not in this channel.`)
  }

  const agents = agentStore.listAgents()
  const mentionedIds = parseMentions(content, agents)
  const message = messageStore.createMessage(channelId, authorId, content, mentionedIds)
  onNewMessage(message).catch(err => console.error('Orchestrator error:', err))
  return message
})

h('channels.subscribe', async (params) => {
  const agentId = params.agentId as string
  const channelId = params.channelId as string
  if (!agentId) throw new Error('agentId is required')
  if (!agentStore.getAgent(agentId)) throw new Error('not_found')
  if (!channelStore.getChannel(channelId)) throw new Error('not_found')
  channelStore.subscribeAgent(agentId, channelId)
  return { ok: true }
})

h('channels.unsubscribe', async (params) => {
  channelStore.unsubscribeAgent(params.agentId as string, params.channelId as string)
  return { ok: true }
})

h('channels.getSubscribers', async (params) => {
  return channelStore.getChannelSubscribers(params.channelId as string)
})

// ── Agents ────────────────────────────────────────────────────────────

h('agents.list', async () => {
  return agentStore.listAgents()
})

h('agents.create', async (params) => {
  const name = typeof params.name === 'string' ? params.name.trim() : ''
  const personality = typeof params.personality === 'string' ? params.personality.trim() : ''
  if (!name) throw new Error('Agent name is required')
  if (!personality) throw new Error('Agent personality is required')

  const body: Record<string, unknown> = { name, personality }
  if (params.role !== undefined) body.role = normalizeAgentRole(params.role)
  if (params.workMode !== undefined) body.workMode = normalizeAgentWorkMode(params.workMode)
  if (params.modelIdOverride !== undefined) body.modelIdOverride = normalizeClaudeModelId(params.modelIdOverride)
  if (params.avatarColor !== undefined) body.avatarColor = params.avatarColor

  const agent = agentStore.createAgent(body as any)
  const general = channelStore.getChannelByName('general')
  if (general) channelStore.subscribeAgent(agent.id, general.id)
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['agents'], reason: 'created' } })
  return agent
})

h('agents.get', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return agent
})

h('agents.getByName', async (params) => {
  const agent = agentStore.getAgentByName(params.name as string)
  if (!agent) throw new Error('not_found')
  return agent
})

h('agents.update', async (params) => {
  const { id, ...body } = params as Record<string, unknown>
  const existing = agentStore.getAgent(id as string)
  if (!existing) throw new Error('not_found')

  const nextBody: Record<string, unknown> = { ...body }
  if ('hostOperatorApprovalMode' in body) nextBody.hostOperatorApprovalMode = normalizeHostOperatorApprovalMode(body.hostOperatorApprovalMode)
  if ('hostOperatorApps' in body) nextBody.hostOperatorApps = normalizeStringArray(body.hostOperatorApps, 'invalid_host_operator_apps')
  if ('hostOperatorPaths' in body) nextBody.hostOperatorPaths = normalizeStringArray(body.hostOperatorPaths, 'invalid_host_operator_paths')
  if ('role' in body) nextBody.role = normalizeAgentRole(body.role)
  if ('workMode' in body) nextBody.workMode = normalizeAgentWorkMode(body.workMode)
  if ('modelIdOverride' in body) nextBody.modelIdOverride = normalizeClaudeModelId(body.modelIdOverride)

  const agent = agentStore.updateAgent(id as string, nextBody as any)
  if (!agent) throw new Error('not_found')
  if (existing.hostOperatorApprovalMode !== 'dangerously-skip' && agent.hostOperatorApprovalMode === 'dangerously-skip') {
    await hostOperatorService.autoApprovePendingHostOperatorRequestsForAgent(agent)
  }
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['agents'], reason: 'updated' } })
  return agent
})

h('agents.delete', async (params) => {
  const agentId = params.id as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  await agentManager.destroyAgentRuntimeSandbox(agentId)
  const ok = agentStore.deleteAgent(agentId)
  if (!ok) throw new Error('not_found')
  broadcast.sendToAll({ type: 'workspace:invalidate', payload: { resources: ['agents'], reason: 'deleted' } })
  return { ok: true }
})

h('agents.start', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  await agentManager.ensureAgentRunning(agent.id)
  broadcast.sendToAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'idle' } })
  return { ok: true, status: 'idle' }
})

h('agents.stop', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  await agentManager.stopAgent(agent.id)
  broadcast.sendToAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'stopped' } })
  return { ok: true, status: 'stopped' }
})

h('agents.interrupt', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const interrupted = await agentManager.interruptAgentWorkflow(agent.id)
  const status = agentStore.getAgent(agent.id)?.status || agent.status
  return { ok: true, interrupted, status }
})

h('agents.cancelStart', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const cancelled = agentManager.cancelStartup(agent.id)
  if (!cancelled) throw new Error('No startup in progress')
  return { ok: true }
})

h('agents.startAll', async () => {
  const agents = agentStore.listAgents()
  const general = channelStore.getChannelByName('general')
  if (general) {
    for (const agent of agents) channelStore.subscribeAgent(agent.id, general.id)
  }
  const results: Array<{ id: string; name: string; status: string; error?: string }> = new Array(agents.length)
  const startupTimeoutMs = Math.max(1_000, config.agentStartupTimeoutMs) + START_ALL_TIMEOUT_GRACE_MS
  const startQueue: Array<{ index: number; agent: (typeof agents)[number] }> = []

  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index]
    if (agent.status !== 'stopped') {
      results[index] = { id: agent.id, name: agent.name, status: agent.status }
      continue
    }
    startQueue.push({ index, agent })
  }

  let cursor = 0
  const workerCount = Math.min(START_ALL_MAX_CONCURRENCY, startQueue.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = cursor
      cursor += 1
      if (currentIndex >= startQueue.length) break
      const { index, agent } = startQueue[currentIndex]
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          agentManager.ensureAgentRunning(agent.id),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error(`startup_timeout: exceeded ${startupTimeoutMs}ms`)), startupTimeoutMs)
            ;(timeoutHandle as any).unref()
          }),
        ])
        broadcast.sendToAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'idle' } })
        results[index] = { id: agent.id, name: agent.name, status: 'idle' }
      } catch (err: any) {
        const errorMessage = err?.message || 'unknown startup failure'
        if (errorMessage.startsWith('startup_timeout:')) agentManager.cancelStartup(agent.id)
        results[index] = { id: agent.id, name: agent.name, status: 'error', error: errorMessage }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    }
  })
  await Promise.all(workers)
  void agentManager.reconcileAllRunningCommunicationDaemons().catch((err: any) => {
    console.warn(`[agents/start-all] reconcile daemons failed: ${err?.message || err}`)
  })
  return results
})

h('agents.stopAll', async () => {
  const agents = agentStore.listAgents()
  for (const agent of agents) {
    if (agentManager.isAgentRunning(agent.id)) {
      await agentManager.stopAgent(agent.id)
      broadcast.sendToAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'stopped' } })
    }
  }
  return { ok: true }
})

h('agents.redeployDaemons', async () => {
  await agentManager.redeployAllDaemons()
  return { ok: true }
})

h('agents.getSubscriptions', async (params) => {
  return channelStore.getAgentSubscriptions(params.id as string)
})

h('agents.getSkills', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return agentManager.listSkills(agent)
})

h('agents.getSystemPrompt', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return { prompt: agentManager.assembleSystemPrompt(agent.id) }
})

h('agents.getLogs', async (params) => {
  const rawLimit = Number(params.limit ?? 200)
  const limit = Number.isFinite(rawLimit) ? rawLimit : 200
  let beforeSeq: number | undefined
  if (params.beforeSeq !== undefined) {
    const parsed = Number(params.beforeSeq)
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('beforeSeq must be a positive number')
    beforeSeq = Math.trunc(parsed)
  }
  return agentLogStore.getAgentLogs(params.id as string, { limit, beforeSeq })
})

h('agents.getScreenshot', async (params) => {
  return agentManager.takeScreenshot(params.id as string)
})

h('agents.getScreen', async (params) => {
  const screen = agentManager.getAgentScreen(params.id as string)
  if (!screen) throw new Error('not_found')
  return screen
})

h('agents.exec', async (params) => {
  return agentManager.debugExec(params.id as string, params.cmd as string, (params.args as string[]) || [])
})

h('agents.dm', async (params) => {
  const agentId = params.agentId as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  if (!agentManager.isAgentRunning(agentId)) throw new Error('Agent not running')
  const content = typeof params.content === 'string' ? params.content.trim() : ''
  if (!content) throw new Error('content required')
  const clientRequestId = typeof params.clientRequestId === 'string' ? params.clientRequestId.trim() : ''
  const response = await agentManager.sendMessage(agentId, [{ authorName: 'User', content }], {
    source: 'dm',
    content,
    clientRequestId: clientRequestId || undefined,
  })
  return { response }
})

// ── Agent Mounts ──────────────────────────────────────────────────────

h('agents.listMounts', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return agentRuntimeMountStore.listAgentRuntimeMounts(agent.id)
})

h('agents.createMount', async (params) => {
  const agentId = params.id as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  if (agentManager.isAgentRunning(agentId)) throw new Error('agent_running_stop_required')
  const created = agentRuntimeMountStore.createAgentRuntimeMount(agentId, {
    hostPath: String(params.hostPath || ''),
    guestPath: String(params.guestPath || ''),
    readOnly: params.readOnly === undefined ? true : !!params.readOnly,
  })
  await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
  return created
})

h('agents.updateMount', async (params) => {
  const agentId = params.id as string
  const mountId = params.mountId as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  if (agentManager.isAgentRunning(agentId)) throw new Error('agent_running_stop_required')
  const updated = agentRuntimeMountStore.updateAgentRuntimeMount(agentId, mountId, {
    hostPath: params.hostPath === undefined ? undefined : String(params.hostPath || ''),
    guestPath: params.guestPath === undefined ? undefined : String(params.guestPath || ''),
    readOnly: params.readOnly === undefined ? undefined : !!params.readOnly,
  })
  if (!updated) throw new Error('not_found')
  await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
  return updated
})

h('agents.deleteMount', async (params) => {
  const agentId = params.id as string
  const mountId = params.mountId as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  if (agentManager.isAgentRunning(agentId)) throw new Error('agent_running_stop_required')
  const deleted = agentRuntimeMountStore.deleteAgentRuntimeMount(agentId, mountId)
  if (!deleted) throw new Error('not_found')
  await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
})

h('agents.selectMountHostDir', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  try {
    return await pickHostDirectory()
  } catch (err: any) {
    if (err instanceof HostDirectoryPickerError) {
      throw new Error(err.code === 'picker_unavailable' ? 'folder_picker_unavailable' : 'folder_picker_failed')
    }
    throw new Error('folder_picker_failed')
  }
})

// ── Agent Memory ──────────────────────────────────────────────────────

h('agents.listMemory', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  const memDir = getMemoryDir(agent.id)
  mkdirSync(memDir, { recursive: true })
  const files: Array<{ path: string; size: number; modifiedAt: number }> = []
  function walk(dir: string, prefix: string) {
    let entries: Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel)
      } else if (entry.name.endsWith('.md')) {
        const fullPath = join(dir, entry.name)
        let stat
        try { stat = statSync(fullPath) } catch { continue }
        if (!stat.isFile()) continue
        files.push({ path: rel, size: stat.size, modifiedAt: stat.mtimeMs })
      }
    }
  }
  walk(memDir, '')
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
})

h('agents.readMemory', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  const filePath = safeRelativePath(params.path as string || '')
  if (!filePath) throw new Error('Invalid path')
  const fullPath = join(getMemoryDir(agent.id), filePath)
  try {
    return { content: readFileSync(fullPath, 'utf-8') }
  } catch {
    throw new Error('not_found')
  }
})

h('agents.writeMemory', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  const filePath = safeRelativePath(params.path as string || '')
  if (!filePath) throw new Error('Invalid path')
  const fullPath = join(getMemoryDir(agent.id), filePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, typeof params.content === 'string' ? params.content : '', 'utf-8')
  return { ok: true }
})

h('agents.createMemory', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  const filePath = safeRelativePath(params.path as string || '')
  if (!filePath) throw new Error('Invalid path')
  const fullPath = join(getMemoryDir(agent.id), filePath)
  if (existsSync(fullPath)) throw new Error('file_exists')
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, typeof params.content === 'string' ? params.content : '', 'utf-8')
  return { ok: true }
})

h('agents.deleteMemory', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  const filePath = safeRelativePath(params.path as string || '')
  if (!filePath) throw new Error('Invalid path')
  try {
    unlinkSync(join(getMemoryDir(agent.id), filePath))
    return { ok: true }
  } catch {
    throw new Error('not_found')
  }
})

// ── Agent Mailbox ─────────────────────────────────────────────────────

h('agents.getMailbox', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return mailboxService.getMailboxSummary(agent.id)
})

h('agents.fetchMailbox', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return mailboxService.fetchMailbox(agent.id)
})

h('agents.ackMailbox', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const batchId = typeof params.batchId === 'string' ? params.batchId.trim() : ''
  if (!batchId) throw new Error('batchId required')
  const result = mailboxService.ackMailboxBatch(agent.id, batchId)
  if (!result.found) throw new Error('not_found')
  return { ok: true }
})

h('agents.getUnread', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return mailboxService.listLegacyUnreadChannels(agent.id)
})

h('agents.ack', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const channelId = params.channelId as string
  const timestamp = params.timestamp as number
  if (!channelId || typeof timestamp !== 'number') throw new Error('channelId and numeric timestamp required')
  agentStore.setReadCursor(agent.id, channelId, timestamp)
  return { ok: true }
})

h('agents.respond', async (params) => {
  const agentId = params.id as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  if (!agentManager.isAgentRunning(agentId)) throw new Error('Agent not running')

  if (params.mode === 'mailbox') {
    const lease = mailboxService.ensureMailboxLease(agentId)
    if (!lease) return { ok: true, response: '' }
    try {
      const response = await agentManager.sendMessage(
        agentId,
        [{ authorName: 'System', content: buildMailboxPrompt(lease.messageCount) }],
        { source: 'mailbox', mailbox: { unreadCount: lease.messageCount, batchId: lease.batchId, expiresAt: lease.expiresAt } },
      )
      return { ok: true, response }
    } catch (err: any) {
      mailboxService.expireMailboxBatch(agentId, lease.batchId)
      throw err
    }
  }

  const unreadChannels = Array.isArray(params.channels) ? params.channels as mailboxService.MailboxChannelMessages[] : null
  if (!unreadChannels || unreadChannels.length === 0) return { ok: true, response: '' }

  const { allAgents, agentMap } = getAgentMaps()
  const allAgentIds = new Set(allAgents.map((a) => a.id))
  const relevantChannels = unreadChannels.filter((channel) => {
    const hasUserMessage = channel.messages.some((m) => !allAgentIds.has(m.authorId) && m.authorId !== 'system')
    const mentionsMe = channel.messages.some((m) => Array.isArray(m.mentionedAgentIds) && m.mentionedAgentIds.includes(agentId))
    return hasUserMessage || mentionsMe
  })

  if (relevantChannels.length === 0) {
    for (const channel of unreadChannels) {
      const lastMessage = channel.messages[channel.messages.length - 1]
      if (lastMessage) agentStore.setReadCursor(agentId, channel.channelId, lastMessage.timestamp)
    }
    return { ok: true, response: '[NO_RESPONSE]' }
  }

  const promptParts: string[] = ['You have new messages in your channels:\n']
  for (const channel of relevantChannels) {
    promptParts.push(`--- #${channel.channelName} ---`)
    for (const message of channel.messages) {
      promptParts.push(`${getAuthorName(agentMap, message.authorId)}: ${message.content}`)
    }
    promptParts.push('')
  }
  appendTeamRoster(promptParts, allAgents, agentId)
  promptParts.push('Read the messages above. If any are directed at you or relevant, respond using curl to send a message. If nothing requires your attention, reply with exactly: [NO_RESPONSE]')

  for (const channel of unreadChannels) {
    const lastMessage = channel.messages[channel.messages.length - 1]
    if (lastMessage) agentStore.setReadCursor(agentId, channel.channelId, lastMessage.timestamp)
  }

  const response = await agentManager.sendMessage(
    agentId,
    [{ authorName: 'System', content: promptParts.join('\n') }],
    buildChannelInputMetadata(agentMap, relevantChannels),
  )
  return { ok: true, response }
})

// ── Agent Apps ────────────────────────────────────────────────────────

h('agents.listApps', async (params) => {
  const agent = agentStore.getAgent(params.agentId as string)
  if (!agent) throw new Error('not_found')
  return miniappStore.listMiniApps(agent.id)
})

h('agents.listAllApps', async () => {
  const agents = agentStore.listAgents()
  const allApps = []
  for (const agent of agents) {
    const apps = miniappStore.listMiniApps(agent.id)
    for (const app of apps) allApps.push({ ...app, agentName: agent.name })
  }
  return allApps
})

async function openAppImpl(agentId: string, slug: string) {
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) throw new Error('not_found')
  if (!app.openable) throw new Error(app.error || 'Miniapp is not openable')

  if (app.sandboxId && app.port != null) {
    const systemActor = { actorType: 'system' as const, actorId: 'agent-apps' }
    let box = await sandboxManager.getBox(systemActor, app.sandboxId)
    if (!box) throw new Error(`Sandbox "${app.sandboxId}" not found`)
    if (box.status === 'stopped') {
      box = await sandboxManager.startBox(systemActor, app.sandboxId)
      if (!box) throw new Error(`Failed to start sandbox "${app.sandboxId}"`)
    }
    const portMapping = box.ports?.find((p: any) => p.guestPort === app.port)
    if (!portMapping?.hostPort) throw new Error(`Port ${app.port} not mapped on sandbox "${app.sandboxId}"`)
    return { app, url: `http://localhost:${portMapping.hostPort}${app.path || '/'}` }
  }

  const screen = await agentManager.ensureAgentRunning(agent.id)
  await agentManager.ensureMiniappNginxConfigured(agent.id)
  const encodedEntry = app.entry.split('/').map((segment: string) => encodeURIComponent(segment)).join('/')
  return { app, url: `http://localhost:${screen.guiHttpPort}/miniapps/${encodeURIComponent(app.slug)}/${encodedEntry}` }
}

h('agents.openApp', async (params) => {
  return openAppImpl(params.agentId as string, params.slug as string)
})

h('agents.openAppCrossAgent', async (params) => {
  return openAppImpl(params.agentId as string, params.slug as string)
})

h('agents.appAction', async (params) => {
  const agentId = params.agentId as string
  const slug = params.slug as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')
  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) throw new Error('not_found')
  if (!app.openable) throw new Error(app.error || 'Miniapp is not openable')

  const action = typeof params.action === 'string' ? params.action.trim() : ''
  const requestId = typeof params.requestId === 'string' ? params.requestId : undefined
  if (!action) throw new Error('action required')

  await agentManager.ensureAgentRunning(agent.id)
  const actionPrompt = [
    'Miniapp action request from Dune host:',
    `App slug: ${app.slug}`,
    `App name: ${app.name}`,
    `Action: ${action}`,
    `Request ID: ${requestId || 'none'}`,
    `Payload JSON: ${JSON.stringify(params.payload ?? null)}`,
    'Return only the action result for the host. Prefer a concise JSON string when structure is useful.',
    'Do not post this result to any channel.',
  ].join('\n')

  const response = await Promise.race([
    agentManager.sendMessage(agentId, [{ authorName: 'System', content: actionPrompt }], {
      source: 'app_action',
      appAction: { slug: app.slug, action, payload: params.payload, requestId },
    }),
    new Promise<string>((resolve) => setTimeout(() => resolve('[TIMEOUT]'), 90_000)),
  ])
  if (response === '[TIMEOUT]') throw new Error('Action timed out')
  if (isNoResponse(response)) throw new Error('Agent returned no response')
  return { ok: true, response, requestId }
})

// ── Agent Host Operator ───────────────────────────────────────────────

h('agents.submitHostOperator', async (params, ctx) => {
  const agentId = params.id as string
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error('not_found')

  if (ctx.actor.actorType !== 'system' || ctx.actor.actorId !== `agent:${agentId}`) {
    throw new Error('forbidden')
  }

  const { id: _id, ...requestBody } = params
  const created = await hostOperatorService.submitHostOperatorRequest({
    agent,
    requestedByType: ctx.actor.actorType,
    requestedById: ctx.actor.actorId,
    request: requestBody as HostOperatorCreateRequest,
    approvalMode: agent.hostOperatorApprovalMode,
  })
  const finalState = await hostOperatorService.waitForTerminalHostOperatorRequest(created.requestId)
  if (!finalState) throw new Error('not_found')
  return finalState
})

h('agents.getHostOperator', async (params, ctx) => {
  const request = hostOperatorService.getHostOperatorRequest(params.requestId as string)
  if (!request) throw new Error('not_found')
  const isOwnerAgent = ctx.actor.actorType === 'system' && ctx.actor.actorId === `agent:${request.agentId}`
  const isAdminHuman = ctx.actor.actorType === 'human' && ctx.actor.actorId === 'admin'
  if (!isOwnerAgent && !isAdminHuman) throw new Error('forbidden')
  return request
})

// ── Host Grants (unified allowlist) ───────────────────────────────────

h('agents.listGrants', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  return hostGrantStore.listGrantsForAgent(agent.id)
})

h('agents.upsertGrant', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const kind = params.kind as 'app' | 'path'
  if (kind !== 'app' && kind !== 'path') throw new Error('kind must be app or path')
  const target = typeof params.target === 'string' ? params.target.trim() : ''
  if (!target) throw new Error('target required')
  const expiresAt = typeof params.expiresAt === 'number' ? params.expiresAt : null
  hostGrantStore.upsertGrant(agent.id, kind, target, expiresAt)
  return { ok: true }
})

h('agents.deleteGrant', async (params) => {
  const agent = agentStore.getAgent(params.id as string)
  if (!agent) throw new Error('not_found')
  const kind = params.kind as 'app' | 'path'
  const target = params.target as string
  const deleted = hostGrantStore.deleteGrant(agent.id, kind, target)
  if (!deleted) throw new Error('not_found')
  return { ok: true }
})

// ── Todos ─────────────────────────────────────────────────────────────

h('todos.list', async (params) => {
  const agentId = params.agentId as string
  if (!agentId) throw new Error('agentId required')
  return todoStore.listTodos(agentId, params.status as string | undefined)
})

h('todos.create', async (params) => {
  const { agentId, title, description, dueAt } = params as Record<string, unknown>
  if (!agentId || !title) throw new Error('agentId and title required')
  const parsedDueAt = parseAndValidateDueAt(dueAt)
  if (!parsedDueAt.ok) throw new Error(parsedDueAt.error!)
  const todo = todoStore.createTodo({ agentId: agentId as string, title: title as string, description: description as string | undefined, dueAt: parsedDueAt.value! })
  todoTimer.armTimer(todo.id, todo.dueAt)
  broadcast.sendToAll({ type: 'todo:change', payload: todo })
  return todo
})

h('todos.update', async (params) => {
  const { id, ...body } = params as Record<string, unknown>
  if (body.dueAt !== undefined) {
    const parsedDueAt = parseAndValidateDueAt(body.dueAt)
    if (!parsedDueAt.ok) throw new Error(parsedDueAt.error!)
    body.dueAt = parsedDueAt.value
  }
  const updated = todoStore.updateTodo(id as string, body)
  if (!updated) throw new Error('not_found')
  if (body.dueAt !== undefined || body.status !== undefined) {
    todoTimer.clearTimer(id as string)
    if (updated.status === 'pending' && updated.dueAt) todoTimer.armTimer(id as string, updated.dueAt)
  }
  broadcast.sendToAll({ type: 'todo:change', payload: updated })
  return updated
})

h('todos.delete', async (params) => {
  const id = params.id as string
  const deleted = todoStore.deleteTodo(id)
  if (!deleted) throw new Error('not_found')
  todoTimer.clearTimer(id)
  broadcast.sendToAll({ type: 'todo:delete', payload: { id, agentId: deleted.agentId } })
  return { ok: true }
})

// ── Settings ──────────────────────────────────────────────────────────

h('settings.getClaude', async () => {
  return claudeSettingsStore.getClaudeSettingsSummary()
})

h('settings.updateClaude', async (params) => {
  const parsed = parseClaudeSettingsUpdate(params)
  if (!parsed.value) throw new Error(parsed.error || 'Invalid JSON body')
  const summary = claudeSettingsStore.patchClaudeSettings(parsed.value)
  await agentManager.syncClaudeSettingsForRunningAgents()
  return summary
})

h('settings.getAdminPlane', async () => {
  return {
    hostCommandAdminBaseUrl: `http://127.0.0.1:${config.adminPort}`,
    hostOperatorAdminBaseUrl: `http://127.0.0.1:${config.adminPort}`,
  }
})

// ── Admin Host Operator ───────────────────────────────────────────────

h('admin.listPendingHostOp', async () => {
  return { requests: hostOperatorService.listPendingHostOperatorRequests(500) }
})

h('admin.decideHostOp', async (params) => {
  const decision = params.decision as string
  if (decision !== 'approve' && decision !== 'reject') throw new Error('invalid_decision')
  const grantTtlMs = typeof params.grantTtlMs === 'number' && params.grantTtlMs > 0 ? params.grantTtlMs : undefined
  const decided = await hostOperatorService.decideHostOperatorRequest({
    requestId: params.requestId as string,
    decision: decision as 'approve' | 'reject',
    approverId: 'admin',
    grantTtlMs,
    agentLookup: (agentId) => agentStore.getAgent(agentId),
  })
  if (!decided) throw new Error('not_found')
  return decided
})

h('admin.listHostOpApps', async () => {
  return { apps: await hostOperatorService.listRunningHostOperatorApps() }
})

// ── Sandboxes ─────────────────────────────────────────────────────────

function sandboxActor(ctx: CallContext) {
  return { actorType: ctx.actor.actorType, actorId: ctx.actor.actorId }
}

h('sandboxes.listBoxes', async (_params, ctx) => {
  return sandboxManager.listBoxes(sandboxActor(ctx))
})

h('sandboxes.createBox', async (params, ctx) => {
  return sandboxManager.createBox(sandboxActor(ctx), params as any)
})

h('sandboxes.getBox', async (params, ctx) => {
  const box = await sandboxManager.getBox(sandboxActor(ctx), params.boxId as string)
  if (!box) throw new Error('not_found')
  return box
})

h('sandboxes.patchBox', async (params, ctx) => {
  const { boxId, ...body } = params as Record<string, unknown>
  const box = await sandboxManager.patchBox(sandboxActor(ctx), boxId as string, body as any)
  if (!box) throw new Error('not_found')
  return box
})

h('sandboxes.deleteBox', async (params, ctx) => {
  const ok = await sandboxManager.deleteBox(sandboxActor(ctx), params.boxId as string, !!params.force)
  if (!ok) throw new Error('not_found')
})

h('sandboxes.startBox', async (params, ctx) => {
  const box = await sandboxManager.startBox(sandboxActor(ctx), params.boxId as string)
  if (!box) throw new Error('not_found')
  return box
})

h('sandboxes.stopBox', async (params, ctx) => {
  return sandboxManager.stopBox(sandboxActor(ctx), params.boxId as string)
})

h('sandboxes.getBoxStatus', async (params, ctx) => {
  const status = await sandboxManager.getBoxStatus(sandboxActor(ctx), params.boxId as string)
  if (!status) throw new Error('not_found')
  return status
})

h('sandboxes.createExec', async (params, ctx) => {
  const { boxId, command, args, env, timeoutSeconds, workingDir, tty, ...rest } = params as Record<string, unknown>
  const created = await sandboxManager.createExec(sandboxActor(ctx), boxId as string, {
    command: String(command || ''),
    args: Array.isArray(args) ? args.map((item: unknown) => String(item)) : [],
    env: typeof env === 'object' && env ? env as Record<string, string> : {},
    timeoutSeconds: typeof timeoutSeconds === 'number' ? timeoutSeconds : undefined,
    workingDir: typeof workingDir === 'string' ? workingDir : undefined,
    tty: !!tty,
  })
  if (!created) throw new Error('not_found')
  return created
})

h('sandboxes.listExecs', async (params, ctx) => {
  const result = await sandboxManager.listExecs(sandboxActor(ctx), params.boxId as string)
  if (!result) throw new Error('not_found')
  return result
})

h('sandboxes.getExec', async (params, ctx) => {
  const result = await sandboxManager.getExec(sandboxActor(ctx), params.boxId as string, params.execId as string)
  if (!result) throw new Error('not_found')
  return result
})

h('sandboxes.getExecEvents', async (params, ctx) => {
  const afterSeq = Number(params.afterSeq || 0)
  const limit = Number(params.limit || 500)
  const events = await sandboxManager.getExecEvents(sandboxActor(ctx), params.boxId as string, params.execId as string, afterSeq, limit)
  if (!events) throw new Error('not_found')
  return events
})

h('sandboxes.uploadFiles', async (params, ctx) => {
  await sandboxManager.uploadFileContent(
    sandboxActor(ctx),
    params.boxId as string,
    String(params.path || ''),
    String(params.contentBase64 || ''),
    params.overwrite === undefined ? true : !!params.overwrite,
  )
})

h('sandboxes.downloadFile', async (params, ctx) => {
  const file = await sandboxManager.downloadFileContent(sandboxActor(ctx), params.boxId as string, params.path as string)
  if (!file) throw new Error('not_found')
  return file
})

h('sandboxes.importHostPath', async (params, ctx) => {
  const { boxId, ...body } = params as Record<string, unknown>
  await sandboxManager.importHostPath(sandboxActor(ctx), boxId as string, body as any)
})

h('sandboxes.listFs', async (params, ctx) => {
  const path = params.path as string
  if (!path) throw new Error('path required')
  const result = await sandboxManager.listFsEntries(sandboxActor(ctx), params.boxId as string, path, {
    includeHidden: !!params.includeHidden,
    limit: Number(params.limit || 1000),
  })
  if (!result) throw new Error('not_found')
  return result
})

h('sandboxes.readFs', async (params, ctx) => {
  const path = params.path as string
  if (!path) throw new Error('path required')
  const result = await sandboxManager.readFsFileContent(sandboxActor(ctx), params.boxId as string, path, Number(params.maxBytes || 1024 * 1024))
  if (!result) throw new Error('not_found')
  return result
})

h('sandboxes.mkdirFs', async (params, ctx) => {
  await sandboxManager.mkdirFsPath(sandboxActor(ctx), params.boxId as string, {
    path: String(params.path || ''),
    recursive: params.recursive === undefined ? true : !!params.recursive,
  })
})

h('sandboxes.moveFs', async (params, ctx) => {
  await sandboxManager.moveFsPath(sandboxActor(ctx), params.boxId as string, {
    fromPath: String(params.fromPath || ''),
    toPath: String(params.toPath || ''),
    overwrite: !!params.overwrite,
  })
})

h('sandboxes.deleteFs', async (params, ctx) => {
  const path = params.path as string
  if (!path) throw new Error('path required')
  await sandboxManager.deleteFsPath(sandboxActor(ctx), params.boxId as string, path, !!params.recursive)
})

// ── Messages ──────────────────────────────────────────────────────────

h('messages.get', async (params) => {
  const msg = messageStore.getMessage(params.id as string)
  if (!msg) throw new Error('not_found')
  return msg
})
