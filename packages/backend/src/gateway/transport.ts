import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { createRpcDispatcher } from './protocol.js'
import type { ActorIdentity } from './protocol.js'
import { clientHandlers } from './client-api.js'
import { agentHandlers } from './agent-api.js'
import * as broadcast from './broadcast.js'
import { openTerminal } from './terminal.js'

const HEARTBEAT_INTERVAL_MS = 30_000

function setupHeartbeat(wss: WebSocketServer) {
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if ((ws as any).__alive === false) {
        ws.terminate()
        continue
      }
      ;(ws as any).__alive = false
      ws.ping()
    }
  }, HEARTBEAT_INTERVAL_MS)
  wss.on('close', () => clearInterval(heartbeat))
}

function markAlive(ws: WebSocket) {
  ;(ws as any).__alive = true
  ws.on('pong', () => { (ws as any).__alive = true })
}

// ── Client Gateway (/ws/client) — runs on its own port ────────────────

export function setupClientGateway(server: Server) {
  const wss = new WebSocketServer({ server })
  const clientRpc = createRpcDispatcher(clientHandlers)
  setupHeartbeat(wss)

  wss.on('connection', (ws, req) => {
    markAlive(ws)
    const path = req.url || ''

    if (path === '/ws/client' || path === '/ws') {
      const humanActor: ActorIdentity = { actorType: 'human', actorId: 'admin' }
      const conn = broadcast.addClient(ws)

      ws.on('message', (data) => {
        const raw = data.toString()
        try {
          const msg = JSON.parse(raw)
          if (msg.type === 'subscribe:channel' && typeof msg.channelId === 'string') {
            broadcast.subscribeClientToChannel(conn, msg.channelId)
            return
          }
          if (msg.type === 'unsubscribe:channel' && typeof msg.channelId === 'string') {
            broadcast.unsubscribeClientFromChannel(conn, msg.channelId)
            return
          }
        } catch {}
        clientRpc.onMessage(ws, raw, { actor: humanActor })
      })

      ws.on('close', () => broadcast.removeClient(conn))
      ws.on('error', () => broadcast.removeClient(conn))
      return
    }

    ws.close(1008, `Unknown path: ${path}`)
  })

  return wss
}

// ── Agent Gateway (/ws/agent + terminal) — runs on its own port ───────

export function setupAgentGateway(server: Server) {
  const wss = new WebSocketServer({ server })
  const agentRpc = createRpcDispatcher(agentHandlers)
  setupHeartbeat(wss)

  wss.on('connection', (ws, req) => {
    markAlive(ws)
    const path = req.url || ''

    // Terminal connections
    const terminalMatch = /^\/api\/sandboxes\/v1\/boxes\/([^/]+)\/terminal(?:\?(.*))?$/.exec(path)
    if (terminalMatch) {
      const params = new URLSearchParams(terminalMatch[2] || '')
      openTerminal(ws, terminalMatch[1], params.get('actorType') || 'human', params.get('actorId') || 'admin')
      return
    }

    // Agent WebSocket
    if (path.startsWith('/ws/agent')) {
      const url = new URL(path, 'http://localhost')
      const agentId = url.searchParams.get('agentId')
      if (!agentId) {
        ws.close(1008, 'agentId query parameter required')
        return
      }

      const agentActor: ActorIdentity = { actorType: 'system', actorId: `agent:${agentId}` }
      broadcast.addAgent(agentId, ws)

      ws.on('message', (data) => {
        agentRpc.onMessage(ws, data.toString(), { actor: agentActor })
      })

      ws.on('close', () => broadcast.removeAgent(agentId))
      ws.on('error', () => broadcast.removeAgent(agentId))
      return
    }

    ws.close(1008, `Unknown path: ${path}`)
  })

  return wss
}
