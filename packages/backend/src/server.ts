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
import { adminHostCommandsApi } from './api/admin-host-commands.js'
import { adminHostOperatorApi } from './api/admin-host-operator.js'
import { setupWebSocket } from './websocket/ws-server.js'
import { reloadTimers } from './todos/todo-timer.js'
import { stopAllAgents, closeRuntime } from './agents/agent-manager.js'
import { stopAllSandboxes, closeSandboxRuntime } from './sandboxes/sandbox-manager.js'
import { config } from './config.js'
import {
  startAgentLogRetentionSweepScheduler,
  stopAgentLogRetentionSweepScheduler,
} from './storage/agent-log-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const frontendDistAbsolutePath = resolve(config.frontendDistPath)
const frontendDistRoot = relative(process.cwd(), frontendDistAbsolutePath) || '.'
const hasFrontendBuild = existsSync(join(frontendDistAbsolutePath, 'index.html'))

export const app = new Hono()
app.use('/*', cors())

export const adminApp = new Hono()
adminApp.use('/*', cors())

// Global error handler — catches JSON parse errors, DB constraint violations, etc.
app.onError((err, c) => {
  const msg = err.message || 'Internal Server Error'
  if (msg.includes('UNIQUE constraint')) {
    return c.json({ error: 'Already exists' }, 409)
  }
  if (msg.includes('FOREIGN KEY constraint')) {
    return c.json({ error: 'Referenced resource not found' }, 400)
  }
  if (err instanceof SyntaxError && (msg.includes('JSON') || msg.includes('Unexpected'))) {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: msg }, 500)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

// Mount API routes
app.route('/api/channels', channelsApi)
app.route('/api/agents', agentsApi)
app.route('/api/messages', messagesApi)
app.route('/api/sandboxes', sandboxesApi)
app.route('/api/todos', todosApi)
app.route('/api/settings', settingsApi)
adminApp.route('/api/admin', adminHostCommandsApi)
adminApp.route('/api/admin', adminHostOperatorApi)

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

  app.use('*', async (c, next) => {
    if (isReservedFrontendPath(c.req.path)) {
      return next()
    }
    return staticMiddleware(c, next)
  })

  app.get('*', async (c, next) => {
    if (!isSpaRoute(c.req.path)) {
      return next()
    }
    return indexMiddleware(c, next)
  })
}

export async function startServer() {
  const mainPort = config.port
  const adminPortResolved = config.adminPort

  const server = serve({ fetch: app.fetch, port: mainPort }, (info) => {
    console.log(`Dune backend listening on port ${info.port}`)
    if (hasFrontendBuild) {
      console.log(`Serving frontend from ${frontendDistAbsolutePath}`)
    }
    // Write port file so frontend dev server can proxy to us
    try {
      writeFileSync(join(__dirname, '../.port'), String(info.port))
    } catch {}
    // Notify parent process (Electron sidecar) that we're ready
    if (process.send) {
      process.send({ type: 'listening', port: info.port, adminPort: adminPortResolved })
    }
  })

  // Handle port-in-use errors (common with --watch restarts)
  ;(server as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${mainPort} is already in use.`)
      process.exit(1)
    }
  })

  const adminServer = serve({
    fetch: adminApp.fetch,
    port: adminPortResolved,
    hostname: '127.0.0.1',
  }, (info) => {
    console.log(`Dune admin plane listening on 127.0.0.1:${info.port}`)
  })

  ;(adminServer as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Admin port ${adminPortResolved} is already in use.`)
      process.exit(1)
    }
  })

  setupWebSocket(server as any)
  reloadTimers()
  startAgentLogRetentionSweepScheduler()

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    server.close()
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

  return { server, adminServer }
}
