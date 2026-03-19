import { WebSocket } from 'ws'

// ── Client tracking ───────────────────────────────────────────────────

interface ClientConnection {
  ws: WebSocket
  subscribedChannels: Set<string>
}

const clients = new Set<ClientConnection>()

export function addClient(ws: WebSocket): ClientConnection {
  const conn: ClientConnection = { ws, subscribedChannels: new Set() }
  clients.add(conn)
  return conn
}

export function removeClient(conn: ClientConnection) {
  clients.delete(conn)
}

export function subscribeClientToChannel(conn: ClientConnection, channelId: string) {
  conn.subscribedChannels.add(channelId)
}

export function unsubscribeClientFromChannel(conn: ClientConnection, channelId: string) {
  conn.subscribedChannels.delete(channelId)
}

// ── Agent tracking ────────────────────────────────────────────────────

const agents = new Map<string, WebSocket>()

export function addAgent(agentId: string, ws: WebSocket) {
  agents.set(agentId, ws)
}

export function removeAgent(agentId: string) {
  agents.delete(agentId)
}

// ── Delivery ──────────────────────────────────────────────────────────

export function sendToChannel(channelId: string, event: object) {
  const data = JSON.stringify(event)
  for (const client of clients) {
    if (client.subscribedChannels.has(channelId) && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data)
    }
  }
}

export function sendToAll(event: object) {
  const data = JSON.stringify(event)
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data)
    }
  }
}

export function sendToAgent(agentId: string, event: object) {
  const ws = agents.get(agentId)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event))
  }
}

export function sendToAgentRaw(agentId: string, data: string) {
  const ws = agents.get(agentId)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data)
  }
}
