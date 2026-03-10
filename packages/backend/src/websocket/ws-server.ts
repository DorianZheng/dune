import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import * as sandboxManager from '../sandboxes/sandbox-manager.js'

interface WsClient {
  ws: WebSocket
  subscribedChannels: Set<string>
}

const clients = new Set<WsClient>()

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws, req) => {
    const path = req.url || ''
    const terminalMatch = /^\/api\/sandboxes\/v1\/boxes\/([^/]+)\/terminal(?:\?(.*))?$/.exec(path)

    if (terminalMatch) {
      handleTerminalConnection(ws, terminalMatch[1], terminalMatch[2] || '')
      return
    }

    const client: WsClient = { ws, subscribedChannels: new Set() }
    clients.add(client)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'subscribe:channel') {
          client.subscribedChannels.add(msg.channelId)
        } else if (msg.type === 'unsubscribe:channel') {
          client.subscribedChannels.delete(msg.channelId)
        }
      } catch {}
    })

    ws.on('close', () => {
      clients.delete(client)
    })

    ws.on('error', () => {
      clients.delete(client)
    })
  })

  return wss
}

async function handleTerminalConnection(ws: WebSocket, boxId: string, queryString: string) {
  const params = new URLSearchParams(queryString)
  const actorType = params.get('actorType') || 'human'
  const actorId = params.get('actorId') || 'admin'

  if (actorType !== 'human' && actorType !== 'agent' && actorType !== 'system') {
    ws.close(1008, 'invalid actor type')
    return
  }

  let nativeBox: any
  try {
    nativeBox = await sandboxManager.getTerminalBox({ actorType, actorId }, boxId)
  } catch (err: any) {
    const msg = err?.message || 'Failed to get terminal box'
    ws.close(1011, msg)
    return
  }

  let execution: any
  let stdin: any
  let stdout: any
  let closed = false

  try {
    // Start PTY shell via native box API (4th arg = true enables PTY)
    execution = await nativeBox.exec('bash', [], undefined, true)
    stdin = await execution.stdin()
    stdout = await execution.stdout()
  } catch {
    try {
      execution = await nativeBox.exec('/bin/sh', [], undefined, true)
      stdin = await execution.stdin()
      stdout = await execution.stdout()
    } catch {
      ws.close(1011, 'Failed to start shell')
      return
    }
  }

  // Forward stdout → WS
  void (async () => {
    try {
      while (!closed) {
        const chunk = await stdout.next()
        if (chunk === null) break
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(typeof chunk === 'string' ? chunk : Buffer.from(chunk))
        }
      }
    } catch {
      // stream ended
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Shell exited')
    }
  })()

  // Forward WS → stdin
  ws.on('message', async (data) => {
    if (closed) return
    const message = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer)
    // Check if it's a JSON resize message
    try {
      const text = message.toString('utf-8')
      const parsed = JSON.parse(text)
      if (parsed && parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
        // Resize not supported by native PTY API — ignore gracefully
        return
      }
    } catch {
      // Not JSON, treat as raw terminal input
    }
    try {
      await stdin.write(message)
    } catch {
      // stdin closed
    }
  })

  ws.on('close', () => {
    closed = true
    try { stdin?.close?.() } catch {}
  })

  ws.on('error', () => {
    closed = true
    try { stdin?.close?.() } catch {}
  })
}

export function broadcastToChannel(channelId: string, event: object) {
  const data = JSON.stringify(event)
  for (const client of clients) {
    if (client.subscribedChannels.has(channelId) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data)
    }
  }
}

export function broadcastAll(event: object) {
  const data = JSON.stringify(event)
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data)
    }
  }
}
