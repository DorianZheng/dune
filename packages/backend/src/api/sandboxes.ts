import { Hono } from 'hono'
import type {
  BoxCreateRequest,
  BoxPatchRequest,
  FileUploadRequest,
  HostImportRequest,
  SandboxFsMkdirRequest,
  SandboxFsMoveRequest,
  SandboxActorTypeType,
} from '@dune/shared'
import * as sandboxManager from '../sandboxes/sandbox-manager.js'

export const sandboxesApi = new Hono()

type ActorIdentity = {
  actorType: SandboxActorTypeType
  actorId: string
}

function parseActor(c: any): ActorIdentity {
  const actorTypeRaw = c.req.header('X-Actor-Type')
  const actorIdRaw = c.req.header('X-Actor-Id')
  const actorType = actorTypeRaw === 'human' || actorTypeRaw === 'agent' || actorTypeRaw === 'system'
    ? actorTypeRaw
    : null
  const actorId = typeof actorIdRaw === 'string' ? actorIdRaw.trim() : ''

  if (!actorType || !actorId) {
    throw new Error('missing_actor_identity')
  }

  return { actorType, actorId }
}

function handleSandboxError(c: any, err: any) {
  const message = err?.message || 'Sandbox error'
  const lower = String(message).toLowerCase()
  if (message === 'missing_actor_identity') return c.json({ error: message }, 401)
  if (message === 'forbidden') return c.json({ error: message }, 403)
  if (message === 'managed_by_agent_lifecycle') {
    return c.json({ error: message, reason: 'managed_by_agent_lifecycle' }, 403)
  }
  if (message === 'box_exec_timeout') return c.json({ error: message }, 504)
  if (message === 'box_exec_failed') return c.json({ error: message }, 502)
  if (message === 'not_found') return c.json({ error: message }, 404)
  if (message === 'path_not_found') return c.json({ error: message }, 404)
  if (
    message === 'invalid_path'
    || lower.includes('absolute container path')
    || lower.includes('path traversal')
    || lower.includes('null byte')
  ) {
    return c.json({ error: 'invalid_path' }, 400)
  }
  if (message === 'box_running' || message === 'file_exists' || message === 'box_not_running' || message === 'path_exists' || message === 'dir_not_empty') {
    return c.json({ error: message }, 409)
  }
  if (message === 'not_directory' || message === 'not_file') return c.json({ error: message }, 400)
  return c.json({ error: message }, 400)
}

sandboxesApi.get('/v1/config', (c) => {
  return c.json({
    apiVersion: 'v1',
    product: 'dune-sandboxes',
    runtime: 'boxlite-sdk',
    actorHeaders: ['X-Actor-Type', 'X-Actor-Id'],
  })
})

sandboxesApi.get('/v1/boxes', async (c) => {
  try {
    const actor = parseActor(c)
    const response = await sandboxManager.listBoxes(actor)
    return c.json(response)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json() as BoxCreateRequest
    const box = await sandboxManager.createBox(actor, body)
    return c.json(box, 201)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId', async (c) => {
  try {
    const actor = parseActor(c)
    const box = await sandboxManager.getBox(actor, c.req.param('boxId'))
    if (!box) return c.json({ error: 'not_found' }, 404)
    return c.json(box)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.patch('/v1/boxes/:boxId', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json() as BoxPatchRequest
    const box = await sandboxManager.patchBox(actor, c.req.param('boxId'), body)
    if (!box) return c.json({ error: 'not_found' }, 404)
    return c.json(box)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.delete('/v1/boxes/:boxId', async (c) => {
  try {
    const actor = parseActor(c)
    const force = c.req.query('force') === 'true'
    const ok = await sandboxManager.deleteBox(actor, c.req.param('boxId'), force)
    if (!ok) return c.json({ error: 'not_found' }, 404)
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/start', async (c) => {
  try {
    const actor = parseActor(c)
    const box = await sandboxManager.startBox(actor, c.req.param('boxId'))
    if (!box) return c.json({ error: 'not_found' }, 404)
    return c.json(box)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/stop', async (c) => {
  try {
    const actor = parseActor(c)
    const result = await sandboxManager.stopBox(actor, c.req.param('boxId'))
    return c.json(result)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/status', async (c) => {
  try {
    const actor = parseActor(c)
    const status = await sandboxManager.getBoxStatus(actor, c.req.param('boxId'))
    if (!status) return c.json({ error: 'not_found' }, 404)
    return c.json(status)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/execs', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json()
    const created = await sandboxManager.createExec(actor, c.req.param('boxId'), {
      command: String(body.command || ''),
      args: Array.isArray(body.args) ? body.args.map((item: unknown) => String(item)) : [],
      env: typeof body.env === 'object' && body.env ? body.env as Record<string, string> : {},
      timeoutSeconds: typeof body.timeoutSeconds === 'number' ? body.timeoutSeconds : undefined,
      workingDir: typeof body.workingDir === 'string' ? body.workingDir : undefined,
      tty: !!body.tty,
    })
    if (!created) return c.json({ error: 'not_found' }, 404)
    return c.json(created, 201)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/execs', async (c) => {
  try {
    const actor = parseActor(c)
    const result = await sandboxManager.listExecs(actor, c.req.param('boxId'))
    if (!result) return c.json({ error: 'not_found' }, 404)
    return c.json(result)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/execs/:execId', async (c) => {
  try {
    const actor = parseActor(c)
    const exec = await sandboxManager.getExec(actor, c.req.param('boxId'), c.req.param('execId'))
    if (!exec) return c.json({ error: 'not_found' }, 404)
    return c.json(exec)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/execs/:execId/events', async (c) => {
  try {
    const actor = parseActor(c)
    const afterSeq = Number(c.req.query('afterSeq') || 0)
    const limit = Number(c.req.query('limit') || 500)
    const accept = c.req.header('Accept') || ''
    if (accept.includes('text/event-stream')) {
      const response = await sandboxManager.streamExecEventsSse(actor, c.req.param('boxId'), c.req.param('execId'), afterSeq, limit)
      if (!response) return c.json({ error: 'not_found' }, 404)
      return response
    }
    const events = await sandboxManager.getExecEvents(actor, c.req.param('boxId'), c.req.param('execId'), afterSeq, limit)
    if (!events) return c.json({ error: 'not_found' }, 404)
    return c.json(events)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/files', async (c) => {
  try {
    const actor = parseActor(c)
    const contentType = (c.req.header('Content-Type') || '').toLowerCase()
    let payload: FileUploadRequest

    if (contentType.includes('application/json')) {
      const body = await c.req.json()
      payload = {
        path: String(body.path || ''),
        contentBase64: String(body.contentBase64 || ''),
        overwrite: body.overwrite === undefined ? true : !!body.overwrite,
      }
    } else {
      const path = c.req.query('path')
      if (!path) return c.json({ error: 'path query is required for non-json uploads' }, 400)
      const raw = await c.req.arrayBuffer()
      payload = {
        path,
        contentBase64: Buffer.from(raw).toString('base64'),
        overwrite: c.req.query('overwrite') !== 'false',
      }
    }

    await sandboxManager.uploadFileContent(actor, c.req.param('boxId'), payload.path, payload.contentBase64, payload.overwrite ?? true)
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/files', async (c) => {
  try {
    const actor = parseActor(c)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path query is required' }, 400)
    const file = await sandboxManager.downloadFileContent(actor, c.req.param('boxId'), path)
    if (!file) return c.json({ error: 'not_found' }, 404)
    return c.json(file)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/files/:path', async (c) => {
  try {
    const actor = parseActor(c)
    const pathParam = c.req.param('path')
    const path = pathParam.startsWith('/') ? pathParam : `/${pathParam}`
    const file = await sandboxManager.downloadFileContent(actor, c.req.param('boxId'), path)
    if (!file) return c.json({ error: 'not_found' }, 404)
    return c.json(file)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/files/*', async (c) => {
  try {
    const actor = parseActor(c)
    const pathSuffix = c.req.param('*')
    const path = `/${pathSuffix}`
    const file = await sandboxManager.downloadFileContent(actor, c.req.param('boxId'), path)
    if (!file) return c.json({ error: 'not_found' }, 404)
    return c.json(file)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/fs/list', async (c) => {
  try {
    const actor = parseActor(c)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path query is required' }, 400)
    const includeHidden = c.req.query('includeHidden') === 'true'
    const limit = Number(c.req.query('limit') || 1000)
    const result = await sandboxManager.listFsEntries(actor, c.req.param('boxId'), path, {
      includeHidden,
      limit,
    })
    if (!result) return c.json({ error: 'not_found' }, 404)
    return c.json(result)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/fs/read', async (c) => {
  try {
    const actor = parseActor(c)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path query is required' }, 400)
    const maxBytes = Number(c.req.query('maxBytes') || 1024 * 1024)
    const result = await sandboxManager.readFsFileContent(actor, c.req.param('boxId'), path, maxBytes)
    if (!result) return c.json({ error: 'not_found' }, 404)
    return c.json(result)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/fs/mkdir', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json() as SandboxFsMkdirRequest
    await sandboxManager.mkdirFsPath(actor, c.req.param('boxId'), {
      path: String(body.path || ''),
      recursive: body.recursive === undefined ? true : !!body.recursive,
    })
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/fs/move', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json() as SandboxFsMoveRequest
    await sandboxManager.moveFsPath(actor, c.req.param('boxId'), {
      fromPath: String(body.fromPath || ''),
      toPath: String(body.toPath || ''),
      overwrite: !!body.overwrite,
    })
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.delete('/v1/boxes/:boxId/fs', async (c) => {
  try {
    const actor = parseActor(c)
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path query is required' }, 400)
    const recursive = c.req.query('recursive') === 'true'
    await sandboxManager.deleteFsPath(actor, c.req.param('boxId'), path, recursive)
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.post('/v1/boxes/:boxId/import-host-path', async (c) => {
  try {
    const actor = parseActor(c)
    const body = await c.req.json() as HostImportRequest
    await sandboxManager.importHostPath(actor, c.req.param('boxId'), body)
    return c.body(null, 204)
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})

sandboxesApi.get('/v1/boxes/:boxId/terminal', async (c) => {
  try {
    const actor = parseActor(c)
    const box = await sandboxManager.getBox(actor, c.req.param('boxId'))
    if (!box) return c.json({ error: 'not_found' }, 404)
    return c.json({
      boxId: box.boxId,
      message: 'Use WebSocket connection to /api/sandboxes/v1/boxes/:boxId/terminal for interactive terminal.',
    })
  } catch (err: any) {
    return handleSandboxError(c, err)
  }
})
