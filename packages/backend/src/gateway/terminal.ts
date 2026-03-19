import { WebSocket } from 'ws'
import * as sandboxManager from '../sandboxes/sandbox-manager.js'

export async function openTerminal(
  ws: WebSocket,
  boxId: string,
  actorType: string,
  actorId: string,
) {
  if (actorType !== 'human' && actorType !== 'agent' && actorType !== 'system') {
    ws.close(1008, 'invalid actor type')
    return
  }

  let nativeBox: any
  try {
    nativeBox = await sandboxManager.getTerminalBox({ actorType, actorId }, boxId)
  } catch (err: any) {
    ws.close(1011, err?.message || 'Failed to get terminal box')
    return
  }

  let sandboxExecution: any
  let stdin: any
  let stdout: any
  let closed = false

  // Try bash first, fall back to sh
  try {
    sandboxExecution = await nativeBox.exec('bash', [], undefined, true)
    stdin = await sandboxExecution.stdin()
    stdout = await sandboxExecution.stdout()
  } catch {
    try {
      sandboxExecution = await nativeBox.exec('/bin/sh', [], undefined, true)
      stdin = await sandboxExecution.stdin()
      stdout = await sandboxExecution.stdout()
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
    try {
      const text = message.toString('utf-8')
      const parsed = JSON.parse(text)
      if (parsed && parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
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
