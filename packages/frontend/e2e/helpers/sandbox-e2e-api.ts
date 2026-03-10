import { Buffer } from 'node:buffer'

type ActorType = 'human' | 'agent' | 'system'

export type ActorIdentity = {
  actorType: ActorType
  actorId: string
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE'
  actor?: ActorIdentity
  body?: unknown
}

function actorHeaders(actor?: ActorIdentity): HeadersInit {
  if (!actor) return {}
  return {
    'X-Actor-Type': actor.actorType,
    'X-Actor-Id': actor.actorId,
  }
}

function stringifyBody(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractError(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const value = (body as { error?: unknown }).error
    if (typeof value === 'string') return value
  }
  return stringifyBody(body)
}

async function apiRequest<T>(baseUrl: string, path: string, options: ApiRequestOptions = {}): Promise<{ status: number; body: T | unknown }> {
  const hasBody = options.body !== undefined
  const headers = new Headers(actorHeaders(options.actor))
  if (hasBody) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })

  const contentType = response.headers.get('content-type') || ''
  let body: unknown = null
  if (contentType.includes('application/json')) {
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } else {
    try {
      body = await response.text()
    } catch {
      body = null
    }
  }
  return { status: response.status, body: body as T | unknown }
}

function assertStatus(status: number, expected: number | number[], context: string, body: unknown): void {
  const expectedList = Array.isArray(expected) ? expected : [expected]
  if (!expectedList.includes(status)) {
    throw new Error(`${context}: expected status ${expectedList.join(' or ')}, received ${status}, body=${stringifyBody(body)}`)
  }
}

type BoxPayload = {
  boxId: string
  name?: string
  status: string
  _dune?: {
    managedByAgent?: boolean
    readOnly?: boolean
    readOnlyReason?: string | null
  }
}

function assertHealthy(baseUrl: string): Promise<void> {
  return apiRequest<{ status: string }>(baseUrl, '/health').then((health) => {
    assertStatus(health.status, 200, 'health check failed', health.body)
    if ((health.body as { status?: string } | null)?.status !== 'ok') {
      throw new Error(`health check returned unexpected payload: ${stringifyBody(health.body)}`)
    }
  })
}

function assertManagedRuntimeBox(box: BoxPayload, context: string): BoxPayload {
  if (box.status !== 'running') {
    throw new Error(`${context}: expected running status, received ${box.status}`)
  }
  if (box._dune?.managedByAgent !== true) {
    throw new Error(`${context}: expected managedByAgent=true, payload=${stringifyBody(box)}`)
  }
  if (box._dune?.readOnly !== true) {
    throw new Error(`${context}: expected readOnly=true, payload=${stringifyBody(box)}`)
  }
  return box
}

async function discoverManagedRuntime(baseUrl: string, humanActor: ActorIdentity): Promise<BoxPayload> {
  const boxesRes = await apiRequest<{ boxes: BoxPayload[] }>(
    baseUrl,
    '/api/sandboxes/v1/boxes',
    { actor: humanActor },
  )
  assertStatus(boxesRes.status, 200, 'sandbox discovery failed', boxesRes.body)

  const boxes = Array.isArray((boxesRes.body as { boxes?: BoxPayload[] } | null)?.boxes)
    ? (boxesRes.body as { boxes: BoxPayload[] }).boxes
    : []
  const managedBoxes = boxes.filter((box) => box.status === 'running' && box._dune?.managedByAgent === true && box._dune?.readOnly === true)
  const discovered = managedBoxes.find((box) => box.name?.toLowerCase().includes('dorian')) || managedBoxes[0]
  if (!discovered) {
    throw new Error('sandbox preflight failed: no running managed sandbox found. Start an agent runtime or set SANDBOX_E2E_BOX_ID.')
  }
  return discovered
}

export async function preflightDorianRuntime(params: {
  baseUrl: string
  boxId?: string | null
  humanActor: ActorIdentity
}): Promise<BoxPayload> {
  const { baseUrl, humanActor } = params
  await assertHealthy(baseUrl)

  const explicitBoxId = params.boxId?.trim()
  if (!explicitBoxId) {
    return discoverManagedRuntime(baseUrl, humanActor)
  }
  const boxRes = await apiRequest<BoxPayload>(
    baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(explicitBoxId)}`,
    { actor: humanActor },
  )
  if (boxRes.status === 404) {
    throw new Error(`sandbox preflight failed: sandbox ${explicitBoxId} not found`)
  }
  assertStatus(boxRes.status, 200, 'sandbox preflight failed', boxRes.body)
  return assertManagedRuntimeBox(boxRes.body as BoxPayload, 'sandbox preflight')
}

export async function cleanupSandboxPath(params: {
  baseUrl: string
  boxId: string
  path: string
  systemActor: ActorIdentity
}): Promise<void> {
  const { baseUrl, boxId, path, systemActor } = params
  const res = await apiRequest(
    baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(boxId)}/fs?path=${encodeURIComponent(path)}&recursive=true`,
    {
      method: 'DELETE',
      actor: systemActor,
    },
  )

  if (res.status === 204 || res.status === 404) return
  const errorCode = extractError(res.body)
  if (errorCode === 'path_not_found' || errorCode === 'not_found') return
  throw new Error(`sandbox cleanup failed for ${path}: status=${res.status}, body=${stringifyBody(res.body)}`)
}

export async function uploadFileContent(params: {
  baseUrl: string
  boxId: string
  path: string
  content: string | Uint8Array
  actor: ActorIdentity
}): Promise<void> {
  const contentBuffer = typeof params.content === 'string'
    ? Buffer.from(params.content, 'utf8')
    : Buffer.from(params.content)

  const res = await apiRequest(
    params.baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(params.boxId)}/files`,
    {
      method: 'POST',
      actor: params.actor,
      body: {
        path: params.path,
        contentBase64: contentBuffer.toString('base64'),
        overwrite: true,
      },
    },
  )
  assertStatus(res.status, 204, 'upload file failed', res.body)
}

export async function importHostPath(params: {
  baseUrl: string
  boxId: string
  hostPath: string
  destPath: string
  actor: ActorIdentity
}): Promise<void> {
  const res = await apiRequest(
    params.baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(params.boxId)}/import-host-path`,
    {
      method: 'POST',
      actor: params.actor,
      body: {
        hostPath: params.hostPath,
        destPath: params.destPath,
      },
    },
  )
  assertStatus(res.status, 204, 'import host path failed', res.body)
}

export async function readSandboxFile(params: {
  baseUrl: string
  boxId: string
  path: string
  maxBytes: number
  actor: ActorIdentity
}): Promise<{
  path: string
  size: number
  contentBase64: string
  truncated: boolean
  mimeType: string | null
}> {
  const res = await apiRequest<{
    path: string
    size: number
    contentBase64: string
    truncated: boolean
    mimeType: string | null
  }>(
    params.baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(params.boxId)}/fs/read?path=${encodeURIComponent(params.path)}&maxBytes=${Math.max(1, Math.floor(params.maxBytes))}`,
    {
      actor: params.actor,
    },
  )
  assertStatus(res.status, 200, 'read sandbox file failed', res.body)
  return res.body as {
    path: string
    size: number
    contentBase64: string
    truncated: boolean
    mimeType: string | null
  }
}

export async function listSandboxPath(params: {
  baseUrl: string
  boxId: string
  path: string
  includeHidden: boolean
  actor: ActorIdentity
}): Promise<{
  path: string
  entries: Array<{ path: string; name: string; type: string }>
  truncated: boolean
}> {
  const res = await apiRequest<{
    path: string
    entries: Array<{ path: string; name: string; type: string }>
    truncated: boolean
  }>(
    params.baseUrl,
    `/api/sandboxes/v1/boxes/${encodeURIComponent(params.boxId)}/fs/list?path=${encodeURIComponent(params.path)}&includeHidden=${params.includeHidden ? 'true' : 'false'}&limit=2000`,
    {
      actor: params.actor,
    },
  )
  assertStatus(res.status, 200, 'list sandbox path failed', res.body)
  return res.body as {
    path: string
    entries: Array<{ path: string; name: string; type: string }>
    truncated: boolean
  }
}
