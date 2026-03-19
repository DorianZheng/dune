// ── Frontend RPC Client ───────────────────────────────────────────────
// Replaces api-client.ts + ws-client.ts.
// Single WebSocket connection, RPC for requests, push for events.

import type {
  Agent,
  AgentMount,
  AgentMountHostDirectoryPickResponse,
  Channel,
  Message,
  CreateAgent,
  CreateChannel,
  CreateAgentMountRequest,
  AgentLogEntry,
  MemoryFile,
  MiniApp,
  MiniAppOpenResponse,
  MiniAppActionResponse,
  Todo,
  CreateTodo,
  UpdateTodo,
  UpdateAgentMountRequest,
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
  FileUploadRequest,
  HostImportRequest,
  SandboxFsListResponse,
  SandboxFsMkdirRequest,
  SandboxFsMoveRequest,
  SandboxFsReadResponse,
  SandboxActorTypeType,
  HostOperatorDecisionRequest,
  HostOperatorRequest,
  HostOperatorRunningApp,
  ClaudeSettings,
  ClaudeSettingsUpdate,
} from '@dune/shared'

// ── Types ─────────────────────────────────────────────────────────────

type EventHandler = (event: any) => void

type PendingCall = {
  resolve: (result: any) => void
  reject: (error: Error) => void
}

export type AgentLogsPage = {
  entries: AgentLogEntry[]
  nextBeforeSeq: number | null
}

type SandboxActorIdentity = {
  actorType: SandboxActorTypeType
  actorId: string
}

// ── RPC Client ────────────────────────────────────────────────────────

class RpcClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingCall>()
  private seq = 0
  private handlers = new Map<string, Set<EventHandler>>()
  private url: string
  private reconnectTimer: number | null = null
  private subscribedChannels = new Set<string>()
  private hasConnectedBefore = false
  private sendBuffer: string[] = []

  constructor(url: string) {
    this.url = url
    this.connect()
  }

  private connect() {
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      const isReconnect = this.hasConnectedBefore
      this.hasConnectedBefore = true
      console.log(isReconnect ? 'WS reconnected' : 'WS connected')

      // Flush buffered messages (calls made before connection was ready)
      for (const msg of this.sendBuffer) {
        this.ws!.send(msg)
      }
      this.sendBuffer = []

      // Re-subscribe to all channels after reconnect
      for (const channelId of this.subscribedChannels) {
        this.send({ type: 'subscribe:channel', channelId })
      }
      if (isReconnect) {
        this.emit('ws:reconnect', undefined)
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // RPC response: { id, result } or { id, error }
        if (typeof data.id === 'string' && this.pending.has(data.id)) {
          const call = this.pending.get(data.id)!
          this.pending.delete(data.id)
          if (data.error) {
            call.reject(new Error(data.error.message || `RPC error: ${data.error.code}`))
          } else {
            call.resolve(data.result)
          }
          return
        }

        // Push event: { type, payload }
        if (typeof data.type === 'string') {
          this.emit(data.type, data.payload)
        }
      } catch { /* ignore parse errors */ }
    }

    this.ws.onclose = () => {
      console.log('WS disconnected, reconnecting...')
      // Reject all pending calls
      for (const [id, call] of this.pending) {
        call.reject(new Error('WebSocket disconnected'))
      }
      this.pending.clear()
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2000)
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = String(++this.seq)
      this.pending.set(id, { resolve, reject })
      this.send({ id, method, params })

      // Timeout after 90s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`RPC timeout: ${method}`))
        }
      }, 90_000)
    })
  }

  on(type: string, handler: EventHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
  }

  off(type: string, handler: EventHandler) {
    this.handlers.get(type)?.delete(handler)
  }

  subscribeChannel(channelId: string) {
    this.subscribedChannels.add(channelId)
    this.send({ type: 'subscribe:channel', channelId })
  }

  unsubscribeChannel(channelId: string) {
    this.subscribedChannels.delete(channelId)
    this.send({ type: 'unsubscribe:channel', channelId })
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  private send(data: object) {
    const msg = JSON.stringify(data)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg)
    } else {
      this.sendBuffer.push(msg)
    }
  }

  private emit(type: string, payload: unknown) {
    const handlers = this.handlers.get(type)
    if (handlers) {
      for (const handler of handlers) handler(payload)
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────
// Lazily initialized when the first API call is made.

let client: RpcClient | null = null

function getClient(): RpcClient {
  if (!client) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/client`
    client = new RpcClient(url)
  }
  return client
}

// ── Public: WsClient-compatible interface ─────────────────────────────
// AppState and app-shell.ts use these to subscribe to push events.

export class WsClient {
  private client: RpcClient

  constructor(_url: string) {
    // Ignore the URL — we always connect to /ws/client
    this.client = getClient()
  }

  on(type: string, handler: EventHandler) {
    this.client.on(type, handler)
  }

  off(type: string, handler: EventHandler) {
    this.client.off(type, handler)
  }

  send(data: object) {
    // For backward compat — subscription commands
    if ((data as any).type === 'subscribe:channel') {
      this.client.subscribeChannel((data as any).channelId)
      return
    }
    if ((data as any).type === 'unsubscribe:channel') {
      this.client.unsubscribeChannel((data as any).channelId)
      return
    }
  }

  subscribeChannel(channelId: string) {
    this.client.subscribeChannel(channelId)
  }

  unsubscribeChannel(channelId: string) {
    this.client.unsubscribeChannel(channelId)
  }

  destroy() {
    // Don't destroy the singleton — other callers may need it
  }
}

// ── Public: API functions ─────────────────────────────────────────────
// Same signatures as the old api-client.ts.

function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return getClient().call<T>(method, params)
}

// Actor identity for sandbox operations
const SANDBOX_ACTOR_STORAGE_KEY = 'dune.sandbox.actor'

function readSandboxActorFromStorage(): SandboxActorIdentity | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SANDBOX_ACTOR_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SandboxActorIdentity>
    const actorType = parsed?.actorType
    const actorId = typeof parsed?.actorId === 'string' ? parsed.actorId.trim() : ''
    if ((actorType === 'human' || actorType === 'agent' || actorType === 'system') && actorId) {
      return { actorType, actorId }
    }
  } catch {}
  return null
}

function writeSandboxActorToStorage(actor: SandboxActorIdentity): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SANDBOX_ACTOR_STORAGE_KEY, JSON.stringify(actor))
  } catch {}
}

let defaultSandboxActor: SandboxActorIdentity = readSandboxActorFromStorage() || {
  actorType: 'human',
  actorId: 'admin',
}

export function setBaseUrl(_url: string) {
  // No-op in WS mode — URL is derived from window.location
}

export function setSandboxActorIdentity(actor: SandboxActorIdentity) {
  defaultSandboxActor = actor
  writeSandboxActorToStorage(actor)
}

export function getSandboxActorIdentity(): SandboxActorIdentity {
  return { ...defaultSandboxActor }
}

// ── Channels ──────────────────────────────────────────────────────────

export const listChannels = () => call<Channel[]>('channels.list')
export const createChannel = (data: CreateChannel) => call<Channel>('channels.create', data)
export const updateChannel = (id: string, data: Partial<Channel>) => call<Channel>('channels.update', { id, ...data })
export const deleteChannel = (id: string) => call<{ ok: boolean }>('channels.delete', { id })
export const getChannelMessages = (id: string, limit = 50) => call<Message[]>('channels.getMessages', { channelId: id, limit })
export const sendMessage = (channelId: string, authorId: string, content: string) => call<Message>('channels.sendMessage', { channelId, authorId, content })
export const subscribeAgentToChannel = (channelId: string, agentId: string) => call('channels.subscribe', { channelId, agentId })
export const unsubscribeAgentFromChannel = (channelId: string, agentId: string) => call('channels.unsubscribe', { channelId, agentId })
export const getChannelSubscribers = (channelId: string) => call<string[]>('channels.getSubscribers', { channelId })

// ── Agents ────────────────────────────────────────────────────────────

export const listAgents = () => call<Agent[]>('agents.list')
export const createAgent = (data: CreateAgent) => call<Agent>('agents.create', data)
export const startAgent = (id: string) => call('agents.start', { id })
export const stopAgent = (id: string) => call('agents.stop', { id })
export const interruptAgent = (id: string) => call('agents.interrupt', { id })
export const cancelAgentStart = (id: string) => call('agents.cancelStart', { id })
export const startAllAgents = () => call('agents.startAll')
export const stopAllAgents = () => call('agents.stopAll')
export const deleteAgent = (id: string) => call('agents.delete', { id })
export const updateAgent = (
  id: string,
  data: Partial<{
    name: string
    personality: string
    role: Agent['role']
    workMode: Agent['workMode']
    modelIdOverride: Agent['modelIdOverride']
    hostOperatorApprovalMode: Agent['hostOperatorApprovalMode']
    hostOperatorApps: Agent['hostOperatorApps']
    hostOperatorPaths: Agent['hostOperatorPaths']
    avatarColor: string
  }>,
) => call<Agent>('agents.update', { id, ...data })
export const getAgentSkills = (id: string) => call<Array<{ name: string; description: string; preview: string; scripts: string[]; markdown: string }>>('agents.getSkills', { id })
export const getAgentSystemPrompt = (id: string) => call<{ prompt: string }>('agents.getSystemPrompt', { id })
export const listAgentMounts = (id: string) => call<AgentMount[]>('agents.listMounts', { id })
export const createAgentMount = (id: string, data: CreateAgentMountRequest) => call<AgentMount>('agents.createMount', { id, ...data })
export const updateAgentMount = (id: string, mountId: string, data: UpdateAgentMountRequest) => call<AgentMount>('agents.updateMount', { id, mountId, ...data })
export const deleteAgentMount = (id: string, mountId: string) => call<void>('agents.deleteMount', { id, mountId })
export const selectAgentMountHostDirectory = (id: string) => call<AgentMountHostDirectoryPickResponse>('agents.selectMountHostDir', { id })
export const getAgentSubscriptions = (id: string) => call<string[]>('agents.getSubscriptions', { id })
export const getAgentLogs = (id: string, options?: { limit?: number; beforeSeq?: number }) =>
  call<AgentLogsPage>('agents.getLogs', { id, ...options })
export const getAgentScreenshot = (id: string) => call<{ data: string; width: number; height: number; format: string }>('agents.getScreenshot', { id })
export const getAgentScreen = (id: string) => call<{ guiHttpPort: number; guiHttpsPort: number; width: number; height: number }>('agents.getScreen', { id })
export const getHostOperatorRequest = (requestId: string, _actor?: SandboxActorIdentity | null) =>
  call<HostOperatorRequest>('agents.getHostOperator', { requestId })
export const listPendingHostOperatorRequestsAdmin = () =>
  call<{ requests: HostOperatorRequest[] }>('admin.listPendingHostOp')
export const decideHostOperatorRequestAdmin = (requestId: string, data: HostOperatorDecisionRequest) =>
  call<HostOperatorRequest>('admin.decideHostOp', { requestId, ...data })
export const listRunningHostOperatorAppsAdmin = () =>
  call<{ apps: HostOperatorRunningApp[] }>('admin.listHostOpApps')
export const sendDirectMessage = (
  agentId: string,
  content: string,
  options?: { clientRequestId?: string },
) => call<{ response: string }>('agents.dm', { agentId, content, clientRequestId: options?.clientRequestId })
export const listAgentApps = (agentId: string) => call<MiniApp[]>('agents.listApps', { agentId })
export const listAllApps = () => call<MiniApp[]>('agents.listAllApps')
export const openAgentApp = (agentId: string, slug: string) => call<MiniAppOpenResponse>('agents.openApp', { agentId, slug })
export const openAppCrossAgent = (agentId: string, slug: string) => call<MiniAppOpenResponse>('agents.openAppCrossAgent', { agentId, slug })
export async function sendAgentAppAction(
  agentId: string,
  slug: string,
  action: string,
  payload?: unknown,
  requestId?: string,
): Promise<MiniAppActionResponse> {
  try {
    return await call<MiniAppActionResponse>('agents.appAction', { agentId, slug, action, payload, requestId })
  } catch (err: any) {
    return { ok: false, error: err?.message || 'RPC error', requestId }
  }
}

// ── Todos ─────────────────────────────────────────────────────────────

export const listTodos = (agentId: string, status?: string) =>
  call<Todo[]>('todos.list', { agentId, status })
export const createTodo = (data: CreateTodo) =>
  call<Todo>('todos.create', data)
export const updateTodo = (id: string, data: UpdateTodo) =>
  call<Todo>('todos.update', { id, ...data })
export const deleteTodo = (id: string) =>
  call<{ ok: boolean }>('todos.delete', { id })

// ── Agent Memory ──────────────────────────────────────────────────────

export const listMemoryFiles = (agentId: string) => call<MemoryFile[]>('agents.listMemory', { agentId })
export const readMemoryFile = (agentId: string, path: string) => call<{ content: string }>('agents.readMemory', { agentId, path })
export const writeMemoryFile = (agentId: string, path: string, content: string) => call('agents.writeMemory', { agentId, path, content })
export const createMemoryFile = (agentId: string, path: string, content = '') => call('agents.createMemory', { agentId, path, content })
export const deleteMemoryFile = (agentId: string, path: string) => call('agents.deleteMemory', { agentId, path })

// ── Settings ──────────────────────────────────────────────────────────

export const getClaudeSettings = () => call<ClaudeSettings>('settings.getClaude')
export const updateClaudeSettings = (patch: ClaudeSettingsUpdate) =>
  call<ClaudeSettings>('settings.updateClaude', patch)

// ── Slack ─────────────────────────────────────────────────────────────

import type { SlackSettings, SlackChannelLink, SlackChannel } from '@dune/shared'

export const getSlackSettings = () => call<SlackSettings>('slack.getSettings')
export const updateSlackSettings = (data: { botToken?: string; appToken?: string }) => call<SlackSettings>('slack.updateSettings', data)
export const disconnectSlack = () => call<{ ok: boolean }>('slack.disconnect')
export const listSlackRemoteChannels = () => call<SlackChannel[]>('slack.listRemoteChannels')
export const listSlackLinks = () => call<SlackChannelLink[]>('slack.listLinks')
export const createSlackLink = (data: { duneChannelId: string; slackChannelId: string; slackChannelName: string; direction?: string }) =>
  call<SlackChannelLink>('slack.createLink', data)
export const deleteSlackLink = (id: string) => call<{ ok: boolean }>('slack.deleteLink', { id })

// ── Sandboxes ─────────────────────────────────────────────────────────

export const listBoxes = (_actor?: SandboxActorIdentity | null) =>
  call<BoxListResponse>('sandboxes.listBoxes')
export const createBox = (data: BoxCreateRequest, _actor?: SandboxActorIdentity | null) =>
  call<BoxResource>('sandboxes.createBox', data)
export const getBox = (boxId: string, _actor?: SandboxActorIdentity | null) =>
  call<BoxResource>('sandboxes.getBox', { boxId })
export const patchBox = (boxId: string, data: BoxPatchRequest, _actor?: SandboxActorIdentity | null) =>
  call<BoxResource>('sandboxes.patchBox', { boxId, ...data })
export const deleteBox = (boxId: string, force = false, _actor?: SandboxActorIdentity | null) =>
  call<void>('sandboxes.deleteBox', { boxId, force })
export const startBox = (boxId: string, _actor?: SandboxActorIdentity | null) =>
  call<BoxResource>('sandboxes.startBox', { boxId })
export const stopBox = (boxId: string, _actor?: SandboxActorIdentity | null) =>
  call<{ removed: boolean; box: BoxResource | null }>('sandboxes.stopBox', { boxId })
export const getBoxStatus = (boxId: string, _actor?: SandboxActorIdentity | null) =>
  call<BoxStatusResponse>('sandboxes.getBoxStatus', { boxId })
export const createExec = (boxId: string, data: ExecCreateRequest, _actor?: SandboxActorIdentity | null) =>
  call<ExecResource>('sandboxes.createExec', { boxId, ...data })
export const listExecs = (boxId: string, _actor?: SandboxActorIdentity | null) =>
  call<ExecListResponse>('sandboxes.listExecs', { boxId })
export const getExec = (boxId: string, execId: string, _actor?: SandboxActorIdentity | null) =>
  call<ExecResource>('sandboxes.getExec', { boxId, execId })
export async function streamExecEvents(
  boxId: string,
  execId: string,
  afterSeq = 0,
  limit = 500,
  _actor?: SandboxActorIdentity | null,
): Promise<ExecEvent[]> {
  // Over WS, streaming is just a regular call — returns all available events
  return call<ExecEvent[]>('sandboxes.getExecEvents', { boxId, execId, afterSeq, limit })
}
export const getExecEvents = (
  boxId: string,
  execId: string,
  afterSeq = 0,
  limit = 500,
  _actor?: SandboxActorIdentity | null,
) => call<ExecEvent[]>('sandboxes.getExecEvents', { boxId, execId, afterSeq, limit })
export const uploadFiles = (boxId: string, data: FileUploadRequest, _actor?: SandboxActorIdentity | null) =>
  call<void>('sandboxes.uploadFiles', { boxId, ...data })
export const downloadFile = (boxId: string, path: string, _actor?: SandboxActorIdentity | null) =>
  call<FileDownloadResponse>('sandboxes.downloadFile', { boxId, path })
export const importHostPathToBox = (boxId: string, data: HostImportRequest, _actor?: SandboxActorIdentity | null) =>
  call<void>('sandboxes.importHostPath', { boxId, ...data })
export const listSandboxFs = (
  boxId: string,
  path: string,
  options?: { includeHidden?: boolean; limit?: number },
  _actor?: SandboxActorIdentity | null,
) => call<SandboxFsListResponse>('sandboxes.listFs', { boxId, path, ...options })
export const readSandboxFsFile = (
  boxId: string,
  path: string,
  maxBytes = 1024 * 1024,
  _actor?: SandboxActorIdentity | null,
) => call<SandboxFsReadResponse>('sandboxes.readFs', { boxId, path, maxBytes })
export const mkdirSandboxFsPath = (boxId: string, data: SandboxFsMkdirRequest, _actor?: SandboxActorIdentity | null) =>
  call<void>('sandboxes.mkdirFs', { boxId, ...data })
export const moveSandboxFsPath = (boxId: string, data: SandboxFsMoveRequest, _actor?: SandboxActorIdentity | null) =>
  call<void>('sandboxes.moveFs', { boxId, ...data })
export const deleteSandboxFsPath = (
  boxId: string,
  path: string,
  recursive = false,
  _actor?: SandboxActorIdentity | null,
) => call<void>('sandboxes.deleteFs', { boxId, path, recursive })

// Terminal — still uses raw WebSocket (not RPC)
export function terminalBoxWs(boxId: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const actor = defaultSandboxActor
  const url = `${protocol}//${window.location.host}/api/sandboxes/v1/boxes/${encodeURIComponent(boxId)}/terminal?actorType=${encodeURIComponent(actor.actorType)}&actorId=${encodeURIComponent(actor.actorId)}`
  return new WebSocket(url)
}

// Admin base URL — not needed in WS mode, but kept for compatibility
export async function getAdminBaseUrl(): Promise<string> {
  const info = await call<{ hostCommandAdminBaseUrl: string; hostOperatorAdminBaseUrl: string }>('settings.getAdminPlane')
  return info.hostOperatorAdminBaseUrl || info.hostCommandAdminBaseUrl
}
