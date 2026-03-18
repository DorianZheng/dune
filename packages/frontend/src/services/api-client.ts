import type {
  Agent,
  AgentMount,
  AgentMountHostDirectoryPickResponse,
  Channel,
  Message,
  CreateAgent,
  CreateAgentMountRequest,
  CreateChannel,
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

type SandboxActorIdentity = {
  actorType: SandboxActorTypeType
  actorId: string
}

type RequestOptions = RequestInit & {
  actor?: SandboxActorIdentity | null
}

export type AgentLogsPage = {
  entries: AgentLogEntry[]
  nextBeforeSeq: number | null
}

const SANDBOX_ACTOR_STORAGE_KEY = 'dune.sandbox.actor'

let baseUrl = ''
let adminBaseUrl: string | null = null

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
  } catch {
    // ignore invalid or inaccessible storage
  }
  return null
}

function writeSandboxActorToStorage(actor: SandboxActorIdentity): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SANDBOX_ACTOR_STORAGE_KEY, JSON.stringify(actor))
  } catch {
    // ignore storage write failures
  }
}

let defaultSandboxActor: SandboxActorIdentity = readSandboxActorFromStorage() || {
  actorType: 'human',
  actorId: 'admin',
}

export function setBaseUrl(url: string) {
  baseUrl = url
  adminBaseUrl = null
}

export function setSandboxActorIdentity(actor: SandboxActorIdentity) {
  defaultSandboxActor = actor
  writeSandboxActorToStorage(actor)
}

export function getSandboxActorIdentity(): SandboxActorIdentity {
  return { ...defaultSandboxActor }
}

function normalizeErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers = new Headers(options?.headers || {})
  if (!headers.has('Content-Type') && options?.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const actor = options?.actor === undefined ? defaultSandboxActor : options?.actor
  if (actor) {
    headers.set('X-Actor-Type', actor.actorType)
    headers.set('X-Actor-Id', actor.actorId)
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    throw new Error(normalizeErrorMessage(body, `API error: ${res.status}`))
  }

  if (res.status === 204) return undefined as T

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return res.json()
  }
  return (await res.text()) as T
}

async function getAdminBaseUrl(): Promise<string> {
  if (adminBaseUrl) return adminBaseUrl
  const info = await request<{ hostOperatorAdminBaseUrl?: string; hostCommandAdminBaseUrl: string }>('/api/settings/admin-plane', { actor: null })
  adminBaseUrl = info.hostOperatorAdminBaseUrl || info.hostCommandAdminBaseUrl
  return adminBaseUrl
}

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const adminBase = await getAdminBaseUrl()
  const headers = new Headers(options?.headers || {})
  if (!headers.has('Content-Type') && options?.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${adminBase}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    throw new Error(normalizeErrorMessage(body, `API error: ${res.status}`))
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// Channels
export const listChannels = () => request<Channel[]>('/api/channels', { actor: null })
export const createChannel = (data: CreateChannel) => request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(data), actor: null })
export const updateChannel = (id: string, data: Partial<Channel>) => request<Channel>(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(data), actor: null })
export const deleteChannel = (id: string) => request<{ ok: boolean }>(`/api/channels/${id}`, { method: 'DELETE', actor: null })
export const getChannelMessages = (id: string, limit = 50) => request<Message[]>(`/api/channels/${id}/messages?limit=${limit}`, { actor: null })
export const sendMessage = (channelId: string, authorId: string, content: string) => request<Message>(`/api/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ authorId, content }), actor: null })
export const subscribeAgentToChannel = (channelId: string, agentId: string) => request(`/api/channels/${channelId}/subscribe`, { method: 'POST', body: JSON.stringify({ agentId }), actor: null })
export const unsubscribeAgentFromChannel = (channelId: string, agentId: string) => request(`/api/channels/${channelId}/unsubscribe`, { method: 'POST', body: JSON.stringify({ agentId }), actor: null })
export const getChannelSubscribers = (channelId: string) => request<string[]>(`/api/channels/${channelId}/subscribers`, { actor: null })

// Agents
export const listAgents = () => request<Agent[]>('/api/agents', { actor: null })
export const createAgent = (data: CreateAgent) => request<Agent>('/api/agents', { method: 'POST', body: JSON.stringify(data), actor: null })
export const startAgent = (id: string) => request(`/api/agents/${id}/start`, { method: 'POST', actor: null })
export const stopAgent = (id: string) => request(`/api/agents/${id}/stop`, { method: 'POST', actor: null })
export const interruptAgent = (id: string) => request(`/api/agents/${id}/interrupt`, { method: 'POST', actor: null })
export const cancelAgentStart = (id: string) => request(`/api/agents/${id}/cancel-start`, { method: 'POST', actor: null })
export const startAllAgents = () => request('/api/agents/start-all', { method: 'POST', actor: null })
export const stopAllAgents = () => request('/api/agents/stop-all', { method: 'POST', actor: null })
export const deleteAgent = (id: string) => request(`/api/agents/${id}`, { method: 'DELETE', actor: null })
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
) => request<Agent>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(data), actor: null })
export const getAgentSkills = (id: string) => request<Array<{ name: string; description: string; preview: string; scripts: string[]; markdown: string }>>(`/api/agents/${id}/skills`, { actor: null })
export const getAgentSystemPrompt = (id: string) => request<{ prompt: string }>(`/api/agents/${id}/system-prompt`, { actor: null })
export const listAgentMounts = (id: string) => request<AgentMount[]>(`/api/agents/${id}/mounts`, { actor: null })
export const createAgentMount = (id: string, data: CreateAgentMountRequest) =>
  request<AgentMount>(`/api/agents/${id}/mounts`, { method: 'POST', body: JSON.stringify(data), actor: null })
export const updateAgentMount = (id: string, mountId: string, data: UpdateAgentMountRequest) =>
  request<AgentMount>(`/api/agents/${id}/mounts/${encodeURIComponent(mountId)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    actor: null,
  })
export const deleteAgentMount = (id: string, mountId: string) =>
  request<void>(`/api/agents/${id}/mounts/${encodeURIComponent(mountId)}`, { method: 'DELETE', actor: null })
export const selectAgentMountHostDirectory = (id: string) =>
  request<AgentMountHostDirectoryPickResponse>(`/api/agents/${id}/mounts/select-host-directory`, {
    method: 'POST',
    actor: null,
  })
export const getAgentSubscriptions = (id: string) => request<string[]>(`/api/agents/${id}/subscriptions`, { actor: null })
export const getAgentLogs = (id: string, options?: { limit?: number; beforeSeq?: number }) => {
  const params = new URLSearchParams()
  if (options?.limit != null) params.set('limit', String(options.limit))
  if (options?.beforeSeq != null) params.set('beforeSeq', String(options.beforeSeq))
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return request<AgentLogsPage>(`/api/agents/${id}/logs${query}`, { actor: null })
}
export const getAgentScreenshot = (id: string) => request<{ data: string; width: number; height: number; format: string }>(`/api/agents/${id}/screenshot`, { actor: null })
export const getAgentScreen = (id: string) => request<{ guiHttpPort: number; guiHttpsPort: number; width: number; height: number }>(`/api/agents/${id}/screen`, { actor: null })
export const getHostOperatorRequest = (requestId: string, actor?: SandboxActorIdentity | null) =>
  request<HostOperatorRequest>(`/api/agents/host-operator/${encodeURIComponent(requestId)}`, { actor })
export const listPendingHostOperatorRequestsAdmin = () =>
  adminRequest<{ requests: HostOperatorRequest[] }>('/api/admin/host-operator/pending')
export const decideHostOperatorRequestAdmin = (requestId: string, data: HostOperatorDecisionRequest) =>
  adminRequest<HostOperatorRequest>(`/api/admin/host-operator/${encodeURIComponent(requestId)}/decision`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
export const listRunningHostOperatorAppsAdmin = () =>
  adminRequest<{ apps: HostOperatorRunningApp[] }>('/api/admin/host-operator/apps')
export const sendDirectMessage = (
  agentId: string,
  content: string,
  options?: { clientRequestId?: string },
) => request<{ response: string }>(`/api/agents/${agentId}/dm`, {
  method: 'POST',
  body: JSON.stringify({ content, clientRequestId: options?.clientRequestId }),
  actor: null,
})
export const listAgentApps = (agentId: string) => request<MiniApp[]>(`/api/agents/${agentId}/apps`, { actor: null })
export const listAllApps = () => request<MiniApp[]>('/api/agents/apps/all', { actor: null })
export const openAgentApp = (agentId: string, slug: string) => request<MiniAppOpenResponse>(`/api/agents/${agentId}/apps/${encodeURIComponent(slug)}/open`, { method: 'POST', actor: null })
export const openAppCrossAgent = (agentId: string, slug: string) => request<MiniAppOpenResponse>(`/api/agents/apps/${encodeURIComponent(agentId)}/${encodeURIComponent(slug)}/open`, { method: 'POST', actor: null })
export async function sendAgentAppAction(
  agentId: string,
  slug: string,
  action: string,
  payload?: unknown,
  requestId?: string,
): Promise<MiniAppActionResponse> {
  const res = await fetch(`${baseUrl}/api/agents/${agentId}/apps/${encodeURIComponent(slug)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload, requestId }),
  })

  let body: any = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  if (!res.ok) {
    return {
      ok: false,
      error: body?.error || `API error: ${res.status}`,
      requestId: body?.requestId || requestId,
    }
  }

  return body as MiniAppActionResponse
}

// Todos
export const listTodos = (agentId: string, status?: string) =>
  request<Todo[]>(`/api/todos?agentId=${encodeURIComponent(agentId)}${status ? `&status=${encodeURIComponent(status)}` : ''}`, { actor: null })
export const createTodo = (data: CreateTodo) =>
  request<Todo>('/api/todos', { method: 'POST', body: JSON.stringify(data), actor: null })
export const updateTodo = (id: string, data: UpdateTodo) =>
  request<Todo>(`/api/todos/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data), actor: null })
export const deleteTodo = (id: string) =>
  request<{ ok: boolean }>(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE', actor: null })

// Agent Memory
export const listMemoryFiles = (agentId: string) => request<MemoryFile[]>(`/api/agents/${agentId}/memory`, { actor: null })
export const readMemoryFile = (agentId: string, path: string) => request<{ content: string }>(`/api/agents/${agentId}/memory/file?path=${encodeURIComponent(path)}`, { actor: null })
export const writeMemoryFile = (agentId: string, path: string, content: string) => request(`/api/agents/${agentId}/memory/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: JSON.stringify({ content }), actor: null })
export const createMemoryFile = (agentId: string, path: string, content = '') => request(`/api/agents/${agentId}/memory/file?path=${encodeURIComponent(path)}`, { method: 'POST', body: JSON.stringify({ content }), actor: null })
export const deleteMemoryFile = (agentId: string, path: string) => request(`/api/agents/${agentId}/memory/file?path=${encodeURIComponent(path)}`, { method: 'DELETE', actor: null })

// Workspace Settings
export const getClaudeSettings = () => request<ClaudeSettings>('/api/settings/claude', { actor: null })
export const updateClaudeSettings = (patch: ClaudeSettingsUpdate) =>
  request<ClaudeSettings>('/api/settings/claude', {
    method: 'PUT',
    body: JSON.stringify(patch),
    actor: null,
  })

const SANDBOX_BASE = '/api/sandboxes/v1'

export const listBoxes = (actor?: SandboxActorIdentity | null) =>
  request<BoxListResponse>(`${SANDBOX_BASE}/boxes`, { actor })

export const createBox = (data: BoxCreateRequest, actor?: SandboxActorIdentity | null) =>
  request<BoxResource>(`${SANDBOX_BASE}/boxes`, { method: 'POST', body: JSON.stringify(data), actor })

export const getBox = (boxId: string, actor?: SandboxActorIdentity | null) =>
  request<BoxResource>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}`, { actor })

export const patchBox = (boxId: string, data: BoxPatchRequest, actor?: SandboxActorIdentity | null) =>
  request<BoxResource>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}`, { method: 'PATCH', body: JSON.stringify(data), actor })

export const deleteBox = (boxId: string, force = false, actor?: SandboxActorIdentity | null) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}?force=${force ? 'true' : 'false'}`, { method: 'DELETE', actor })

export const startBox = (boxId: string, actor?: SandboxActorIdentity | null) =>
  request<BoxResource>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/start`, { method: 'POST', actor })

export const stopBox = (boxId: string, actor?: SandboxActorIdentity | null) =>
  request<{ removed: boolean; box: BoxResource | null }>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/stop`, { method: 'POST', actor })

export const getBoxStatus = (boxId: string, actor?: SandboxActorIdentity | null) =>
  request<BoxStatusResponse>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/status`, { actor })

export const createExec = (boxId: string, data: ExecCreateRequest, actor?: SandboxActorIdentity | null) =>
  request<ExecResource>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/execs`, { method: 'POST', body: JSON.stringify(data), actor })

export const listExecs = (boxId: string, actor?: SandboxActorIdentity | null) =>
  request<ExecListResponse>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/execs`, { actor })

export const getExec = (boxId: string, execId: string, actor?: SandboxActorIdentity | null) =>
  request<ExecResource>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/execs/${encodeURIComponent(execId)}`, { actor })

function parseSseEvents(input: string): ExecEvent[] {
  const blocks = input
    .split('\n\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const events: ExecEvent[] = []
  for (const block of blocks) {
    const dataLine = block
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data: '))
    if (!dataLine) continue
    try {
      const parsed = JSON.parse(dataLine.slice(6)) as Omit<ExecEvent, 'eventType'> & { data: string }
      const typeLine = block
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('event: '))
      const eventType = (typeLine?.slice(7) || 'info') as ExecEvent['eventType']
      events.push({ ...parsed, eventType })
    } catch {
      // ignore malformed event chunk
    }
  }
  return events
}

export async function streamExecEvents(
  boxId: string,
  execId: string,
  afterSeq = 0,
  limit = 500,
  actor?: SandboxActorIdentity | null,
): Promise<ExecEvent[]> {
  const headers = new Headers({ Accept: 'text/event-stream' })
  const identity = actor === undefined ? defaultSandboxActor : actor
  if (identity) {
    headers.set('X-Actor-Type', identity.actorType)
    headers.set('X-Actor-Id', identity.actorId)
  }
  const res = await fetch(
    `${baseUrl}${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/execs/${encodeURIComponent(execId)}/events?afterSeq=${afterSeq}&limit=${limit}`,
    { headers },
  )
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return parseSseEvents(await res.text())
}

export const getExecEvents = (
  boxId: string,
  execId: string,
  afterSeq = 0,
  limit = 500,
  actor?: SandboxActorIdentity | null,
) => request<ExecEvent[]>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/execs/${encodeURIComponent(execId)}/events?afterSeq=${afterSeq}&limit=${limit}`, { actor })

export const uploadFiles = (boxId: string, data: FileUploadRequest, actor?: SandboxActorIdentity | null) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/files`, { method: 'POST', body: JSON.stringify(data), actor })

export const downloadFile = (boxId: string, path: string, actor?: SandboxActorIdentity | null) =>
  request<FileDownloadResponse>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/files?path=${encodeURIComponent(path)}`, { actor })

export const importHostPathToBox = (boxId: string, data: HostImportRequest, actor?: SandboxActorIdentity | null) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/import-host-path`, {
    method: 'POST',
    body: JSON.stringify(data),
    actor,
  })

export const listSandboxFs = (
  boxId: string,
  path: string,
  options?: { includeHidden?: boolean; limit?: number },
  actor?: SandboxActorIdentity | null,
) =>
  request<SandboxFsListResponse>(
    `${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/fs/list?path=${encodeURIComponent(path)}`
    + `&includeHidden=${options?.includeHidden ? 'true' : 'false'}`
    + `&limit=${Number.isFinite(options?.limit) ? String(Math.max(1, Math.floor(options?.limit as number))) : '1000'}`,
    { actor },
  )

export const readSandboxFsFile = (
  boxId: string,
  path: string,
  maxBytes = 1024 * 1024,
  actor?: SandboxActorIdentity | null,
) =>
  request<SandboxFsReadResponse>(
    `${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/fs/read?path=${encodeURIComponent(path)}&maxBytes=${Math.max(1, Math.floor(maxBytes))}`,
    { actor },
  )

export const mkdirSandboxFsPath = (boxId: string, data: SandboxFsMkdirRequest, actor?: SandboxActorIdentity | null) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/fs/mkdir`, {
    method: 'POST',
    body: JSON.stringify(data),
    actor,
  })

export const moveSandboxFsPath = (boxId: string, data: SandboxFsMoveRequest, actor?: SandboxActorIdentity | null) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/fs/move`, {
    method: 'POST',
    body: JSON.stringify(data),
    actor,
  })

export const deleteSandboxFsPath = (
  boxId: string,
  path: string,
  recursive = false,
  actor?: SandboxActorIdentity | null,
) =>
  request<void>(`${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/fs?path=${encodeURIComponent(path)}&recursive=${recursive ? 'true' : 'false'}`, {
    method: 'DELETE',
    actor,
  })

export function terminalBoxWs(boxId: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const actor = defaultSandboxActor
  const url = `${protocol}//${window.location.host}${SANDBOX_BASE}/boxes/${encodeURIComponent(boxId)}/terminal?actorType=${encodeURIComponent(actor.actorType)}&actorId=${encodeURIComponent(actor.actorId)}`
  return new WebSocket(url)
}
