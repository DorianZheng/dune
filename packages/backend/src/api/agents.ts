import { Hono } from 'hono'
import { resolve, join, dirname } from 'node:path'
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, existsSync, unlinkSync, type Dirent } from 'node:fs'
import * as agentStore from '../storage/agent-store.js'
import * as channelStore from '../storage/channel-store.js'
import * as messageStore from '../storage/message-store.js'
import * as agentLogStore from '../storage/agent-log-store.js'
import * as agentRuntimeMountStore from '../storage/agent-runtime-mount-store.js'
import * as miniappStore from '../storage/miniapp-store.js'
import * as agentManager from '../agents/agent-manager.js'
import * as mailboxService from '../mailbox/mailbox-service.js'
import { config } from '../config.js'
import { broadcastAll, broadcastToChannel } from '../websocket/ws-server.js'
import * as sandboxManager from '../sandboxes/sandbox-manager.js'
import { parseMentions } from '../utils/mentions.js'
import * as hostCommandService from '../host-commands/host-command-service.js'
import type {
  CreateAgentMountRequest,
  HostCommandCreateRequest,
  HostExecApprovalModeType,
  SandboxActorTypeType,
  UpdateAgentMountRequest,
} from '@dune/shared'
import {
  HostDirectoryPickerError,
  pickHostDirectory,
  type HostDirectoryPickResult,
} from '../utils/host-directory-picker.js'

export const agentsApi = new Hono()

function isNoResponse(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '[NO_RESPONSE]' || trimmed.endsWith('[NO_RESPONSE]')
}

async function readOptionalJsonBody(c: any): Promise<any> {
  const raw = await c.req.raw.text()
  if (!raw.trim()) return null
  return JSON.parse(raw)
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

function appendTeamRoster(promptParts: string[], allAgents: Array<{ id: string; name: string; personality: string }>, agentId: string): void {
  const otherAgents = allAgents.filter((agent) => agent.id !== agentId)
  if (otherAgents.length === 0) return
  const roster = otherAgents.map((agent) => `${agent.name} (${agent.personality.split('.')[0]})`).join(', ')
  promptParts.push(`[Team members: ${roster}]`)
}

const START_ALL_MAX_CONCURRENCY = 4
const START_ALL_TIMEOUT_GRACE_MS = 2_000

type ActorIdentity = {
  actorType: SandboxActorTypeType
  actorId: string
}

function normalizeHostExecApprovalMode(value: unknown): HostExecApprovalModeType {
  if (value === 'approval-required' || value === 'dangerously-skip') return value
  throw new Error('invalid_host_exec_approval_mode')
}

type EnsureAgentRunningFn = typeof agentManager.ensureAgentRunning
let ensureAgentRunningImpl: EnsureAgentRunningFn = (agentId) => agentManager.ensureAgentRunning(agentId)

type PickHostDirectoryFn = () => Promise<HostDirectoryPickResult>
let pickHostDirectoryImpl: PickHostDirectoryFn = () => pickHostDirectory()

export function __setEnsureAgentRunningForTests(fn: EnsureAgentRunningFn | null): void {
  ensureAgentRunningImpl = fn ?? ((agentId: string) => agentManager.ensureAgentRunning(agentId))
}

export function __setPickHostDirectoryForTests(fn: PickHostDirectoryFn | null): void {
  pickHostDirectoryImpl = fn ?? (() => pickHostDirectory())
}

function mapAgentMountErrorToResponse(c: any, err: any) {
  const message = String(err?.message || 'mount_error')
  if (message === 'invalid_host_path') return c.json({ error: message }, 400)
  if (message === 'host_path_not_found') return c.json({ error: message }, 400)
  if (message === 'invalid_guest_path') return c.json({ error: message }, 400)
  if (message === 'guest_path_outside_workspace') return c.json({ error: message }, 400)
  if (message === 'reserved_guest_path_conflict') return c.json({ error: message }, 400)
  if (message === 'guest_path_conflict') return c.json({ error: message }, 409)
  return c.json({ error: message }, 400)
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

function mapHostCommandErrorToResponse(c: any, err: any) {
  const message = String(err?.message || 'host_command_error')
  if (message === 'missing_actor_identity') return c.json({ error: message }, 401)
  if (message === 'forbidden') return c.json({ error: message }, 403)
  if (message === 'invalid_scope') return c.json({ error: message }, 400)
  if (message === 'workspace_scope_violation') return c.json({ error: message }, 400)
  if (message === 'full_host_cwd_must_be_absolute') return c.json({ error: message }, 400)
  if (message === 'invalid_cwd') return c.json({ error: message }, 400)
  if (message === 'request_not_pending') return c.json({ error: message }, 409)
  if (message === 'elevated_confirmation_required') return c.json({ error: message }, 400)
  return c.json({ error: message }, 400)
}

agentsApi.get('/by-name/:name', (c) => {
  const agent = agentStore.getAgentByName(c.req.param('name'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(agent)
})

agentsApi.get('/', (c) => {
  return c.json(agentStore.listAgents())
})

agentsApi.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Agent name is required' }, 400)
  }
  if (!body.personality || typeof body.personality !== 'string' || !body.personality.trim()) {
    return c.json({ error: 'Agent personality is required' }, 400)
  }
  body.name = body.name.trim()
  body.personality = body.personality.trim()
  const agent = agentStore.createAgent(body)
  // Auto-subscribe new agents to #general
  const general = channelStore.getChannelByName('general')
  if (general) {
    channelStore.subscribeAgent(agent.id, general.id)
  }
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['agents'], reason: 'created' },
  })
  return c.json(agent, 201)
})

// ── Batch operations (must be before /:id routes) ─────────────────────

agentsApi.post('/start-all', async (c) => {
  const agents = agentStore.listAgents()
  // Backfill: ensure all agents are subscribed to #general
  const general = channelStore.getChannelByName('general')
  if (general) {
    for (const agent of agents) {
      channelStore.subscribeAgent(agent.id, general.id)
    }
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
          ensureAgentRunningImpl(agent.id),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              reject(new Error(`startup_timeout: exceeded ${startupTimeoutMs}ms`))
            }, startupTimeoutMs)
            timeoutHandle.unref()
          }),
        ])
        broadcastAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'idle' } })
        results[index] = { id: agent.id, name: agent.name, status: 'idle' }
      } catch (err: any) {
        const errorMessage = err?.message || 'unknown startup failure'
        if (errorMessage.startsWith('startup_timeout:')) {
          agentManager.cancelStartup(agent.id)
        }
        results[index] = { id: agent.id, name: agent.name, status: 'error', error: errorMessage }
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    }
  })

  await Promise.all(workers)
  // BoxLite breaks guest→host networking when new containers start.
  // Redeploy daemons on ALL running agents with fresh network detection.
  void agentManager.redeployAllDaemons().catch((err: any) => {
    console.warn(`[agents/start-all] redeploy daemons failed: ${err?.message || err}`)
  })
  return c.json(results)
})

agentsApi.post('/redeploy-daemons', async (c) => {
  await agentManager.redeployAllDaemons()
  return c.json({ ok: true })
})

agentsApi.post('/stop-all', async (c) => {
  const agents = agentStore.listAgents()
  for (const agent of agents) {
    if (agentManager.isAgentRunning(agent.id)) {
      await agentManager.stopAgent(agent.id)
      broadcastAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'stopped' } })
    }
  }
  return c.json({ ok: true })
})

// ── Host Commands (main plane request/status only) ───────────────────

agentsApi.post('/:id/host-commands', async (c) => {
  try {
    const agentId = c.req.param('id')
    const agent = agentStore.getAgent(agentId)
    if (!agent) return c.json({ error: 'not_found' }, 404)

    const actor = parseActor(c)
    if (actor.actorType !== 'system' || actor.actorId !== `agent:${agentId}`) {
      throw new Error('forbidden')
    }

    const body = await c.req.json() as HostCommandCreateRequest
    const command = typeof body?.command === 'string' ? body.command.trim() : ''
    if (!command) return c.json({ error: 'invalid_command' }, 400)

    const args = Array.isArray(body?.args) ? body.args.map((item) => String(item)) : []
    const scope = hostCommandService.normalizeHostCommandScope(
      typeof body?.scope === 'string' ? body.scope : undefined,
    )
    const cwd = hostCommandService.normalizeHostCommandCwd(
      scope,
      typeof body?.cwd === 'string' ? body.cwd : undefined,
    )

    const created = await hostCommandService.submitHostCommandRequest({
      agentId,
      requestedByType: actor.actorType,
      requestedById: actor.actorId,
      command,
      args,
      cwd,
      scope,
      approvalMode: agent.hostExecApprovalMode,
    })

    const finalState = await hostCommandService.waitForTerminalHostCommand(created.requestId)
    if (!finalState) return c.json({ error: 'not_found' }, 404)
    return c.json(finalState)
  } catch (err: any) {
    return mapHostCommandErrorToResponse(c, err)
  }
})

agentsApi.get('/host-commands/:requestId', async (c) => {
  try {
    const actor = parseActor(c)
    const request = hostCommandService.getHostCommandRequest(c.req.param('requestId'))
    if (!request) return c.json({ error: 'not_found' }, 404)

    const isOwnerAgent = actor.actorType === 'system' && actor.actorId === `agent:${request.agentId}`
    const isAdminHuman = actor.actorType === 'human' && actor.actorId === 'admin'
    if (!isOwnerAgent && !isAdminHuman) {
      throw new Error('forbidden')
    }

    return c.json(request)
  } catch (err: any) {
    return mapHostCommandErrorToResponse(c, err)
  }
})

// ── Centralized Apps endpoint ────────────────────────────────────────

agentsApi.get('/apps/all', (c) => {
  const agents = agentStore.listAgents()
  const allApps = []
  for (const agent of agents) {
    const apps = miniappStore.listMiniApps(agent.id)
    for (const app of apps) {
      allApps.push({ ...app, agentName: agent.name })
    }
  }
  return c.json(allApps)
})

// Cross-agent app access (any caller can open/action any agent's app)
agentsApi.post('/apps/:agentId/:slug/open', async (c) => {
  const agentId = c.req.param('agentId')
  const slug = c.req.param('slug')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) return c.json({ error: 'Miniapp not found' }, 404)
  if (!app.openable) return c.json({ error: app.error || 'Miniapp is not openable' }, 400)

  try {
    // Cross-sandbox deployment: app specifies sandboxId + port
    if (app.sandboxId && app.port != null) {
      const systemActor = { actorType: 'system' as const, actorId: 'agent-apps' }
      let box = await sandboxManager.getBox(systemActor, app.sandboxId)
      if (!box) return c.json({ error: `Sandbox "${app.sandboxId}" not found` }, 404)

      // Auto-start the sandbox if stopped
      if (box.status === 'stopped') {
        box = await sandboxManager.startBox(systemActor, app.sandboxId)
        if (!box) return c.json({ error: `Failed to start sandbox "${app.sandboxId}"` }, 500)
      }

      // Find the host port mapping for the app's guest port
      const portMapping = box.ports?.find((p: any) => p.guestPort === app.port)
      if (!portMapping?.hostPort) {
        return c.json({ error: `Port ${app.port} not mapped on sandbox "${app.sandboxId}"` }, 400)
      }

      const url = `http://localhost:${portMapping.hostPort}${app.path || '/'}`
      return c.json({ app, url })
    }

    // Default: SkillBox-based deployment via agent runtime
    const screen = await agentManager.ensureAgentRunning(agent.id)
    await agentManager.ensureMiniappNginxConfigured(agent.id)
    const encodedEntry = app.entry.split('/').map((segment: string) => encodeURIComponent(segment)).join('/')
    const url = `http://localhost:${screen.guiHttpPort}/miniapps/${encodeURIComponent(app.slug)}/${encodedEntry}`
    return c.json({ app, url })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.post('/apps/:agentId/:slug/action', async (c) => {
  const agentId = c.req.param('agentId')
  const slug = c.req.param('slug')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ ok: false, error: 'Not found' }, 404)

  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) return c.json({ ok: false, error: 'Miniapp not found' }, 404)
  if (!app.openable) return c.json({ ok: false, error: app.error || 'Miniapp is not openable' }, 400)

  const body = await c.req.json()
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
  const payload = body.payload

  if (!action) return c.json({ ok: false, error: 'action required', requestId }, 400)

  try {
    await agentManager.ensureAgentRunning(agent.id)
    const actionPrompt = [
      'Miniapp action request from Dune host:',
      `App slug: ${app.slug}`,
      `App name: ${app.name}`,
      `Action: ${action}`,
      `Request ID: ${requestId || 'none'}`,
      `Payload JSON: ${JSON.stringify(payload ?? null)}`,
      'Return only the action result for the host. Prefer a concise JSON string when structure is useful.',
      'Do not post this result to any channel.',
    ].join('\n')

    const response = await Promise.race([
      agentManager.sendMessage(
        agent.id,
        [{ authorName: 'System', content: actionPrompt }],
        {
          source: 'app_action',
          appAction: { slug: app.slug, action, payload, requestId },
        },
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('[TIMEOUT]'), 90_000)),
    ])

    if (response === '[TIMEOUT]') {
      return c.json({ ok: false, error: 'Action timed out', requestId }, 504)
    }
    if (isNoResponse(response)) {
      return c.json({ ok: false, error: 'Agent returned no response', requestId }, 502)
    }
    return c.json({ ok: true, response, requestId })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message, requestId }, 500)
  }
})

// ── Agent Miniapps (must be before /:id routes) ─────────────────────

agentsApi.get('/:id/apps', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(miniappStore.listMiniApps(agent.id))
})

agentsApi.post('/:id/apps/:slug/open', async (c) => {
  const agentId = c.req.param('id')
  const slug = c.req.param('slug')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) return c.json({ error: 'Miniapp not found' }, 404)
  if (!app.openable) return c.json({ error: app.error || 'Miniapp is not openable' }, 400)

  try {
    // Cross-sandbox deployment: app specifies sandboxId + port
    if (app.sandboxId && app.port != null) {
      const systemActor = { actorType: 'system' as const, actorId: 'agent-apps' }
      let box = await sandboxManager.getBox(systemActor, app.sandboxId)
      if (!box) return c.json({ error: `Sandbox "${app.sandboxId}" not found` }, 404)

      if (box.status === 'stopped') {
        box = await sandboxManager.startBox(systemActor, app.sandboxId)
        if (!box) return c.json({ error: `Failed to start sandbox "${app.sandboxId}"` }, 500)
      }

      const portMapping = box.ports?.find((p: any) => p.guestPort === app.port)
      if (!portMapping?.hostPort) {
        return c.json({ error: `Port ${app.port} not mapped on sandbox "${app.sandboxId}"` }, 400)
      }

      const url = `http://localhost:${portMapping.hostPort}${app.path || '/'}`
      return c.json({ app, url })
    }

    // Default: SkillBox-based deployment via agent runtime
    const screen = await agentManager.ensureAgentRunning(agent.id)
    await agentManager.ensureMiniappNginxConfigured(agent.id)
    const encodedEntry = app.entry.split('/').map((segment: string) => encodeURIComponent(segment)).join('/')
    const url = `http://localhost:${screen.guiHttpPort}/miniapps/${encodeURIComponent(app.slug)}/${encodedEntry}`
    return c.json({ app, url })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.post('/:id/apps/:slug/action', async (c) => {
  const agentId = c.req.param('id')
  const slug = c.req.param('slug')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ ok: false, error: 'Not found' }, 404)

  const app = miniappStore.getMiniApp(agent.id, slug)
  if (!app) return c.json({ ok: false, error: 'Miniapp not found' }, 404)
  if (!app.openable) return c.json({ ok: false, error: app.error || 'Miniapp is not openable' }, 400)

  const body = await c.req.json()
  const action = typeof body.action === 'string' ? body.action.trim() : ''
  const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
  const payload = body.payload

  if (!action) return c.json({ ok: false, error: 'action required', requestId }, 400)

  try {
    await agentManager.ensureAgentRunning(agent.id)
    const actionPrompt = [
      'Miniapp action request from Dune host:',
      `App slug: ${app.slug}`,
      `App name: ${app.name}`,
      `Action: ${action}`,
      `Request ID: ${requestId || 'none'}`,
      `Payload JSON: ${JSON.stringify(payload ?? null)}`,
      'Return only the action result for the host. Prefer a concise JSON string when structure is useful.',
      'Do not post this result to any channel.',
    ].join('\n')

    const response = await Promise.race([
      agentManager.sendMessage(
        agent.id,
        [{ authorName: 'System', content: actionPrompt }],
        {
          source: 'app_action',
          appAction: { slug: app.slug, action, payload, requestId },
        },
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('[TIMEOUT]'), 90_000)),
    ])

    if (response === '[TIMEOUT]') {
      return c.json({ ok: false, error: 'Action timed out', requestId }, 504)
    }
    if (isNoResponse(response)) {
      return c.json({ ok: false, error: 'Agent returned no response', requestId }, 502)
    }
    return c.json({ ok: true, response, requestId })
  } catch (err: any) {
    return c.json({ ok: false, error: err.message, requestId }, 500)
  }
})

agentsApi.get('/:id/mounts', (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(agentRuntimeMountStore.listAgentRuntimeMounts(agentId))
})

agentsApi.post('/:id/mounts/select-host-directory', async (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  try {
    const result = await pickHostDirectoryImpl()
    return c.json(result, 200)
  } catch (err: any) {
    if (err instanceof HostDirectoryPickerError) {
      if (err.code === 'picker_unavailable') {
        return c.json({ error: 'folder_picker_unavailable' }, 503)
      }
      return c.json({ error: 'folder_picker_failed' }, 500)
    }
    return c.json({ error: 'folder_picker_failed' }, 500)
  }
})

agentsApi.post('/:id/mounts', async (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (agentManager.isAgentRunning(agentId)) {
    return c.json({ error: 'agent_running_stop_required' }, 409)
  }

  try {
    const body = await c.req.json() as CreateAgentMountRequest
    const created = agentRuntimeMountStore.createAgentRuntimeMount(agentId, {
      hostPath: String(body.hostPath || ''),
      guestPath: String(body.guestPath || ''),
      readOnly: body.readOnly === undefined ? true : !!body.readOnly,
    })
    await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
    return c.json(created, 201)
  } catch (err: any) {
    if (String(err?.message || '').startsWith('Failed to reset runtime sandbox')) {
      return c.json({ error: err.message }, 500)
    }
    return mapAgentMountErrorToResponse(c, err)
  }
})

agentsApi.patch('/:id/mounts/:mountId', async (c) => {
  const agentId = c.req.param('id')
  const mountId = c.req.param('mountId')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (agentManager.isAgentRunning(agentId)) {
    return c.json({ error: 'agent_running_stop_required' }, 409)
  }

  try {
    const body = await c.req.json() as UpdateAgentMountRequest
    const updated = agentRuntimeMountStore.updateAgentRuntimeMount(agentId, mountId, {
      hostPath: body.hostPath === undefined ? undefined : String(body.hostPath || ''),
      guestPath: body.guestPath === undefined ? undefined : String(body.guestPath || ''),
      readOnly: body.readOnly === undefined ? undefined : !!body.readOnly,
    })
    if (!updated) return c.json({ error: 'not_found' }, 404)
    await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
    return c.json(updated)
  } catch (err: any) {
    if (String(err?.message || '').startsWith('Failed to reset runtime sandbox')) {
      return c.json({ error: err.message }, 500)
    }
    return mapAgentMountErrorToResponse(c, err)
  }
})

agentsApi.delete('/:id/mounts/:mountId', async (c) => {
  const agentId = c.req.param('id')
  const mountId = c.req.param('mountId')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (agentManager.isAgentRunning(agentId)) {
    return c.json({ error: 'agent_running_stop_required' }, 409)
  }

  const deleted = agentRuntimeMountStore.deleteAgentRuntimeMount(agentId, mountId)
  if (!deleted) return c.json({ error: 'not_found' }, 404)
  try {
    await agentManager.resetStoppedAgentRuntimeSandbox(agentId)
    return c.body(null, 204)
  } catch (err: any) {
    if (String(err?.message || '').startsWith('Failed to reset runtime sandbox')) {
      return c.json({ error: err.message }, 500)
    }
    return c.json({ error: err?.message || 'mount_error' }, 500)
  }
})

agentsApi.get('/:id/skills', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(agentManager.listSkills())
})

agentsApi.get('/:id/system-prompt', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  try {
    const prompt = agentManager.assembleSystemPrompt(agent.id)
    return c.json({ prompt })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.get('/:id', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(agent)
})

agentsApi.put('/:id', async (c) => {
  const body = await c.req.json()
  const existing = agentStore.getAgent(c.req.param('id'))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const normalizedBody = body && typeof body === 'object' ? body : {}
  const nextBody = { ...normalizedBody }
  if (Object.prototype.hasOwnProperty.call(normalizedBody, 'hostExecApprovalMode')) {
    try {
      nextBody.hostExecApprovalMode = normalizeHostExecApprovalMode((normalizedBody as Record<string, unknown>).hostExecApprovalMode)
    } catch (err: any) {
      return c.json({ error: String(err?.message || 'invalid_host_exec_approval_mode') }, 400)
    }
  }

  const agent = agentStore.updateAgent(c.req.param('id'), nextBody)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (
    existing.hostExecApprovalMode !== 'dangerously-skip'
    && agent.hostExecApprovalMode === 'dangerously-skip'
  ) {
    await hostCommandService.autoApprovePendingHostCommandRequestsForAgent(agent.id)
  }
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['agents'], reason: 'updated' },
  })
  return c.json(agent)
})

agentsApi.delete('/:id', async (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)

  await agentManager.destroyAgentRuntimeSandbox(agentId)
  const ok = agentStore.deleteAgent(agentId)
  if (!ok) return c.json({ error: 'Not found' }, 404)
  broadcastAll({
    type: 'workspace:invalidate',
    payload: { resources: ['agents'], reason: 'deleted' },
  })
  return c.json({ ok: true })
})

agentsApi.post('/:id/start', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  try {
    await agentManager.ensureAgentRunning(agent.id)
    broadcastAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'idle' } })
    return c.json({ ok: true, status: 'idle' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.post('/:id/stop', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  try {
    await agentManager.stopAgent(agent.id)
    broadcastAll({ type: 'agent:status', payload: { agentId: agent.id, status: 'stopped' } })
    return c.json({ ok: true, status: 'stopped' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.post('/:id/cancel-start', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  const cancelled = agentManager.cancelStartup(agent.id)
  if (!cancelled) return c.json({ error: 'No startup in progress' }, 400)
  return c.json({ ok: true })
})

agentsApi.get('/:id/subscriptions', (c) => {
  return c.json(channelStore.getAgentSubscriptions(c.req.param('id')))
})

agentsApi.get('/:id/logs', (c) => {
  const rawLimit = Number(c.req.query('limit') ?? 200)
  const limit = Number.isFinite(rawLimit) ? rawLimit : 200

  const beforeSeqQuery = c.req.query('beforeSeq')
  let beforeSeq: number | undefined
  if (beforeSeqQuery !== undefined) {
    const parsed = Number(beforeSeqQuery)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json({ error: 'beforeSeq must be a positive number' }, 400)
    }
    beforeSeq = Math.trunc(parsed)
  }

  return c.json(agentLogStore.getAgentLogs(c.req.param('id'), { limit, beforeSeq }))
})

agentsApi.get('/:id/screenshot', async (c) => {
  try {
    const screenshot = await agentManager.takeScreenshot(c.req.param('id'))
    return c.json(screenshot)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.post('/:id/exec', async (c) => {
  try {
    const body = await c.req.json()
    const result = await agentManager.debugExec(c.req.param('id'), body.cmd, body.args || [])
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

agentsApi.get('/:id/screen', (c) => {
  const screen = agentManager.getAgentScreen(c.req.param('id'))
  if (!screen) return c.json({ error: 'Agent not running' }, 404)
  return c.json(screen)
})

// ── Agent Communication ────────────────────────────────────────────────

agentsApi.get('/:id/mailbox', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(mailboxService.getMailboxSummary(agent.id))
})

agentsApi.post('/:id/mailbox/fetch', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(mailboxService.fetchMailbox(agent.id))
})

agentsApi.post('/:id/mailbox/ack', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json()
  const batchId = typeof body.batchId === 'string' ? body.batchId.trim() : ''
  if (!batchId) return c.json({ error: 'batchId required' }, 400)
  const result = mailboxService.ackMailboxBatch(agent.id, batchId)
  if (!result.found) return c.json({ error: 'Batch not found' }, 404)
  return c.json({ ok: true })
})

agentsApi.get('/:id/unread', (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(mailboxService.listLegacyUnreadChannels(agent.id))
})

agentsApi.post('/:id/ack', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)
  const { channelId, timestamp } = await c.req.json()
  if (!channelId || typeof timestamp !== 'number') return c.json({ error: 'channelId and numeric timestamp required' }, 400)
  agentStore.setReadCursor(agent.id, channelId, timestamp)
  return c.json({ ok: true })
})

agentsApi.post('/:id/respond', async (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (!agentManager.isAgentRunning(agentId)) return c.json({ error: 'Agent not running' }, 400)

  const body = await readOptionalJsonBody(c)

  if (body && !Array.isArray(body) && body.mode === 'mailbox') {
    const lease = mailboxService.ensureMailboxLease(agentId)
    if (!lease) return c.json({ ok: true, response: '' })

    try {
      const response = await agentManager.sendMessage(
        agentId,
        [{ authorName: 'System', content: buildMailboxPrompt(lease.messageCount) }],
        {
          source: 'mailbox',
          mailbox: {
            unreadCount: lease.messageCount,
            batchId: lease.batchId,
            expiresAt: lease.expiresAt,
          },
        },
      )
      return c.json({ ok: true, response })
    } catch (err: any) {
      mailboxService.expireMailboxBatch(agentId, lease.batchId)
      return c.json({ error: err.message }, 500)
    }
  }

  const unreadChannels = Array.isArray(body) ? body as mailboxService.MailboxChannelMessages[] : null
  if (!unreadChannels || unreadChannels.length === 0) return c.json({ ok: true, response: '' })

  // Format unread messages as a prompt for the agent
  const { allAgents, agentMap } = getAgentMaps()
  const allAgentIds = new Set(allAgents.map((agentRow) => agentRow.id))

  // Filter out channels where ALL messages are agent-to-agent chatter (no user input)
  // and none @mention this agent — avoids endless agent conversation loops
  const relevantChannels = unreadChannels.filter((channel) => {
    const hasUserMessage = channel.messages.some((message) => !allAgentIds.has(message.authorId) && message.authorId !== 'system')
    const mentionsMe = channel.messages.some((message) =>
      Array.isArray(message.mentionedAgentIds) && message.mentionedAgentIds.includes(agentId)
    )
    return hasUserMessage || mentionsMe
  })

  if (relevantChannels.length === 0) {
    // Still ack cursors to avoid re-processing these messages
    for (const channel of unreadChannels) {
      const lastMessage = channel.messages[channel.messages.length - 1]
      if (lastMessage) agentStore.setReadCursor(agentId, channel.channelId, lastMessage.timestamp)
    }
    return c.json({ ok: true, response: '[NO_RESPONSE]' })
  }

  const promptParts: string[] = ['You have new messages in your channels:\n']

  for (const channel of relevantChannels) {
    promptParts.push(`--- #${channel.channelName} ---`)
    for (const message of channel.messages) {
      promptParts.push(`${getAuthorName(agentMap, message.authorId)}: ${message.content}`)
    }
    promptParts.push('')
  }

  // Include teammate roster so agent knows who to @mention
  appendTeamRoster(promptParts, allAgents, agentId)

  promptParts.push('Read the messages above. If any are directed at you or relevant, respond using curl to send a message. If nothing requires your attention, reply with exactly: [NO_RESPONSE]')

  const contextMessages = [{ authorName: 'System', content: promptParts.join('\n') }]

  // Ack all channels up to their latest message BEFORE calling CLI.
  // This prevents infinite retry loops if the agent consistently fails on a message.
  for (const channel of unreadChannels) {
    const lastMessage = channel.messages[channel.messages.length - 1]
    if (lastMessage) {
      agentStore.setReadCursor(agentId, channel.channelId, lastMessage.timestamp)
    }
  }

  try {
    const response = await agentManager.sendMessage(
      agentId,
      contextMessages,
      buildChannelInputMetadata(agentMap, relevantChannels),
    )

    // If agent responded (not [NO_RESPONSE]), the response was sent via curl through the proxy
    // The CLI's text output here is just the agent's "thinking" — actual messages go through the proxy
    return c.json({ ok: true, response })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── Agent Memory (flat file operations) ──────────────────────────────

function getMemoryDir(agentId: string): string {
  return join(config.agentsRoot, agentId, 'memory')
}

function safeRelativePath(filePath: string): string | null {
  // Prevent path traversal — must be a relative path without ..
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('\0')) return null
  return normalized
}

// List all memory files
agentsApi.get('/:id/memory', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)

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
        try {
          stat = statSync(fullPath)
        } catch {
          continue
        }
        if (!stat.isFile()) continue
        files.push({ path: rel, size: stat.size, modifiedAt: stat.mtimeMs })
      }
    }
  }
  walk(memDir, '')
  files.sort((a, b) => a.path.localeCompare(b.path))
  return c.json(files)
})

// Read a single memory file
agentsApi.get('/:id/memory/file', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const filePath = safeRelativePath(c.req.query('path') || '')
  if (!filePath) return c.json({ error: 'Invalid path' }, 400)

  const fullPath = join(getMemoryDir(agent.id), filePath)

  try {
    const content = readFileSync(fullPath, 'utf-8')
    return c.json({ content })
  } catch {
    return c.json({ error: 'File not found' }, 404)
  }
})

// Create a new memory file
agentsApi.post('/:id/memory/file', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const filePath = safeRelativePath(c.req.query('path') || '')
  if (!filePath) return c.json({ error: 'Invalid path' }, 400)

  const fullPath = join(getMemoryDir(agent.id), filePath)

  if (existsSync(fullPath)) return c.json({ error: 'File already exists' }, 409)

  const body = await c.req.json()
  const content = typeof body.content === 'string' ? body.content : ''
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
  return c.json({ ok: true }, 201)
})

// Update a memory file
agentsApi.put('/:id/memory/file', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const filePath = safeRelativePath(c.req.query('path') || '')
  if (!filePath) return c.json({ error: 'Invalid path' }, 400)

  const fullPath = join(getMemoryDir(agent.id), filePath)

  const body = await c.req.json()
  const content = typeof body.content === 'string' ? body.content : ''
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
  return c.json({ ok: true })
})

// Delete a memory file
agentsApi.delete('/:id/memory/file', async (c) => {
  const agent = agentStore.getAgent(c.req.param('id'))
  if (!agent) return c.json({ error: 'Not found' }, 404)

  const filePath = safeRelativePath(c.req.query('path') || '')
  if (!filePath) return c.json({ error: 'Invalid path' }, 400)

  const fullPath = join(getMemoryDir(agent.id), filePath)

  try {
    unlinkSync(fullPath)
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'File not found' }, 404)
  }
})

// Direct message — send a prompt directly to an agent (from DM chat view)
agentsApi.post('/:id/dm', async (c) => {
  const agentId = c.req.param('id')
  const agent = agentStore.getAgent(agentId)
  if (!agent) return c.json({ error: 'Not found' }, 404)
  if (!agentManager.isAgentRunning(agentId)) return c.json({ error: 'Agent not running' }, 400)

  const body = await c.req.json()
  const content = body.content?.trim()
  if (!content) return c.json({ error: 'content required' }, 400)

  try {
    const response = await agentManager.sendMessage(agentId, [{ authorName: 'User', content }], {
      source: 'dm',
      content,
    })
    return c.json({ response })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})
