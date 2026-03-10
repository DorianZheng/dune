type EventHandler = (event: any) => void

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private url: string
  private reconnectTimer: number | null = null
  private subscribedChannels = new Set<string>()
  private hasConnectedBefore = false

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
      // Re-subscribe to all channels after reconnect
      for (const channelId of this.subscribedChannels) {
        this.send({ type: 'subscribe:channel', channelId })
      }
      if (isReconnect) {
        const handlers = this.handlers.get('ws:reconnect')
        if (handlers) {
          for (const handler of handlers) handler(undefined)
        }
      }
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const handlers = this.handlers.get(data.type)
        if (handlers) {
          for (const handler of handlers) handler(data.payload)
        }
      } catch { /* ignore parse errors */ }
    }

    this.ws.onclose = () => {
      console.log('WS disconnected, reconnecting...')
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2000)
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  on(type: string, handler: EventHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
  }

  off(type: string, handler: EventHandler) {
    this.handlers.get(type)?.delete(handler)
  }

  send(data: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
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
}
