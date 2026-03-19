import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { channelsApi } from './api/channels.js'
import { agentsApi } from './api/agents.js'
import { messagesApi } from './api/messages.js'
import { sandboxesApi } from './api/sandboxes.js'
import { todosApi } from './api/todos.js'
import { settingsApi } from './api/settings.js'
import { adminHostOperatorApi } from './api/admin-host-operator.js'
import { setupAgentGateway, setupClientGateway } from './gateway/transport.js'
import { reloadTimers } from './todos/todo-timer.js'
import { stopAllAgents, closeRuntime } from './agents/agent-manager.js'
import { stopAllSandboxes, closeSandboxRuntime } from './sandboxes/sandbox-manager.js'
import { config } from './config.js'
import { findFreePort } from './utils/port-finder.js'
import {
  startAgentLogRetentionSweepScheduler,
  stopAgentLogRetentionSweepScheduler,
} from './storage/agent-log-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDistAbsolutePath = resolve(config.frontendDistPath)
const frontendDistRoot = relative(process.cwd(), frontendDistAbsolutePath) || '.'
const hasFrontendBuild = existsSync(join(frontendDistAbsolutePath, 'index.html'))

// ── Agent App (REST + /ws/agent + terminal) ───────────────────────────

export const app = new Hono()
app.use('/*', cors())

app.onError((err, c) => {
  const msg = err.message || 'Internal Server Error'
  if (msg.includes('UNIQUE constraint')) return c.json({ error: 'Already exists' }, 409)
  if (msg.includes('FOREIGN KEY constraint')) return c.json({ error: 'Referenced resource not found' }, 400)
  if (err instanceof SyntaxError && (msg.includes('JSON') || msg.includes('Unexpected'))) return c.json({ error: 'Invalid JSON body' }, 400)
  console.error('Unhandled error:', err)
  return c.json({ error: msg }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

// REST routes (backward compat for sandbox scripts)
app.route('/api/channels', channelsApi)
app.route('/api/agents', agentsApi)
app.route('/api/messages', messagesApi)
app.route('/api/sandboxes', sandboxesApi)
app.route('/api/todos', todosApi)
app.route('/api/settings', settingsApi)

// ── Client App (SPA + /ws/client) ─────────────────────────────────────

export const clientApp = new Hono()
clientApp.use('/*', cors())
clientApp.get('/health', (c) => c.json({ status: 'ok' }))

function isReservedFrontendPath(path: string): boolean {
  return path === '/api'
    || path.startsWith('/api/')
    || path === '/ws'
    || path.startsWith('/ws/')
}

function isSpaRoute(path: string): boolean {
  if (isReservedFrontendPath(path)) return false
  const lastSegment = basename(path)
  return !lastSegment.includes('.')
}

if (hasFrontendBuild) {
  const staticMiddleware = serveStatic({ root: frontendDistRoot })
  const indexMiddleware = serveStatic({ root: frontendDistRoot, path: 'index.html' })

  clientApp.use('*', async (c, next) => {
    if (isReservedFrontendPath(c.req.path)) return next()
    return staticMiddleware(c, next)
  })

  clientApp.get('*', async (c, next) => {
    if (!isSpaRoute(c.req.path)) return next()
    return indexMiddleware(c, next)
  })
}

// ── Admin App ─────────────────────────────────────────────────────────

export const adminApp = new Hono()
adminApp.use('/*', cors())
adminApp.route('/api/admin', adminHostOperatorApi)

// ── Port allocation ───────────────────────────────────────────────────

const PORT_RANGE_START = 20000

async function resolvePort(configured: number): Promise<number> {
  if (configured > 0) return configured
  return findFreePort(PORT_RANGE_START + Math.floor(Math.random() * 30000))
}

// ── Start ─────────────────────────────────────────────────────────────

export async function startServer() {
  const agentPort = await resolvePort(config.port)
  const resolvedClientPort = await resolvePort(config.clientPort)
  const resolvedAdminPort = await resolvePort(config.adminPort)

  // Server A: Agent gateway (REST + /ws/agent + terminal)
  const agentServer = serve({ fetch: app.fetch, port: agentPort }, (info) => {
    console.log(`Dune agent gateway listening on port ${info.port}`)
  })
  ;(agentServer as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') { console.error(`Agent port ${agentPort} is already in use.`); process.exit(1) }
  })
  setupAgentGateway(agentServer as any)

  // Server B: Client gateway (SPA + /ws/client)
  const clientServer = serve({ fetch: clientApp.fetch, port: resolvedClientPort }, (info) => {
    console.log(`Dune client gateway listening on port ${info.port}`)
    if (hasFrontendBuild) console.log(`Serving frontend from ${frontendDistAbsolutePath}`)
  })
  ;(clientServer as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') { console.error(`Client port ${resolvedClientPort} is already in use.`); process.exit(1) }
  })
  setupClientGateway(clientServer as any)

  // Server C: Admin (localhost only)
  const adminServer = serve({
    fetch: adminApp.fetch,
    port: resolvedAdminPort,
    hostname: '127.0.0.1',
  }, (info) => {
    console.log(`Dune admin plane listening on 127.0.0.1:${info.port}`)
  })
  ;(adminServer as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') { console.error(`Admin port ${resolvedAdminPort} is already in use.`); process.exit(1) }
  })

  // Write port file (JSON format) for frontend dev server and agent-manager
  try {
    writeFileSync(
      join(__dirname, '../.port'),
      JSON.stringify({ agentPort, clientPort: resolvedClientPort, adminPort: resolvedAdminPort }),
    )
  } catch {}

  // Notify parent process (Electron sidecar)
  if (process.send) {
    process.send({ type: 'listening', port: agentPort, clientPort: resolvedClientPort, adminPort: resolvedAdminPort })
  }

  reloadTimers()
  startAgentLogRetentionSweepScheduler()

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    agentServer.close()
    clientServer.close()
    adminServer.close()
    stopAgentLogRetentionSweepScheduler()
    await stopAllSandboxes()
    await stopAllAgents()
    closeSandboxRuntime()
    closeRuntime()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  return { server: agentServer, clientServer, adminServer }
}
