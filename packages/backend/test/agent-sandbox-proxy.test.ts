import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type CapturedRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

async function findAvailablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address() as { port: number } | null
      const port = address?.port
      server.close((err) => {
        if (err) reject(err)
        else if (!port) reject(new Error('Failed to allocate port'))
        else resolvePort(port)
      })
    })
    server.on('error', reject)
  })
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function fetchStep(label: string, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchWithTimeout(url, init)
  } catch (err: any) {
    throw new Error(`${label} failed: ${err?.message || 'unknown error'}`)
  }
}

function findCaptured(
  captured: CapturedRequest[],
  method: string,
  pathPrefix: string,
): CapturedRequest | undefined {
  return captured.find((entry) => entry.method === method && entry.path.startsWith(pathPrefix))
}

test('dune proxy forwards sandbox APIs with system actor headers and keeps existing routes', async () => {
  const captured: CapturedRequest[] = []

  const backend = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks)
    const path = req.url || '/'
    captured.push({
      method: req.method || 'GET',
      path,
      headers: req.headers,
      body,
    })

    if (req.method === 'GET' && path === '/api/channels') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 'chan-1', name: 'general' }]))
      return
    }

    if (req.method === 'GET' && path === '/api/channels/by-name/general') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'chan-1', name: 'general' }))
      return
    }

    if (req.method === 'GET' && path === '/api/agents') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 'agent-proxy-test', name: 'Proxy Test' }]))
      return
    }

    if (req.method === 'GET' && path === '/api/agents/agent-proxy-test/mailbox') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        unreadCount: 2,
        activeLease: null,
      }))
      return
    }

    if (req.method === 'POST' && path === '/api/agents/agent-proxy-test/mailbox/fetch') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        batchId: 'batch-1',
        unreadCount: 2,
        expiresAt: Date.now() + 60_000,
        channels: [
          {
            channelId: 'chan-1',
            channelName: 'general',
            messages: [{ id: 'msg-1', channelId: 'chan-1', authorId: 'admin', content: 'hello', timestamp: 1, mentionedAgentIds: [] }],
          },
        ],
      }))
      return
    }

    if (req.method === 'POST' && path === '/api/agents/agent-proxy-test/mailbox/ack') {
      const payload = JSON.parse(body.toString('utf-8') || '{}')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: Boolean(payload.batchId) }))
      return
    }

    if (req.method === 'POST' && path === '/api/agents/agent-proxy-test/host-operator') {
      const payload = JSON.parse(body.toString('utf-8') || '{}')
      if (payload.kind === 'overview' && payload.bundleId === 'sleep-proxy') {
        await delay(700)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        requestId: 'req-1',
        agentId: 'agent-proxy-test',
        requestedByType: 'system',
        requestedById: 'agent:agent-proxy-test',
        kind: payload.kind || 'status',
        input: payload,
        target: payload.bundleId ? { bundleId: payload.bundleId } : null,
        summary: `${payload.kind || 'status'} request`,
        status: 'completed',
        createdAt: Date.now(),
        decidedAt: Date.now(),
        startedAt: Date.now(),
        completedAt: Date.now(),
        approverId: 'admin',
        decision: 'approve',
        resultJson: { ok: true },
        artifactPaths: [],
        errorMessage: null,
      }))
      return
    }

    if (req.method === 'GET' && path.startsWith('/api/channels/chan-1/messages')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 'msg-1', content: 'hello' }]))
      return
    }

    if (req.method === 'POST' && path === '/api/channels/chan-1/messages') {
      const payload = JSON.parse(body.toString('utf-8'))
      if (payload.content === 'membership blocked') {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Agent is not in this channel.' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'msg-2',
        channelId: 'chan-1',
        authorId: payload.authorId,
        content: payload.content,
      }))
      return
    }

    if (req.method === 'GET' && path.startsWith('/api/sandboxes/v1/boxes?')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ boxes: [], nextPageToken: null }))
      return
    }

    if (req.method === 'PATCH' && path === '/api/sandboxes/v1/boxes/box-1') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ boxId: 'box-1', name: 'patched' }))
      return
    }

    if (req.method === 'DELETE' && path === '/api/sandboxes/v1/boxes/box-1') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && path.startsWith('/api/sandboxes/v1/boxes/box-1/files')) {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && path === '/api/sandboxes/v1/boxes/box-1/execs/exec-1/events') {
      const accept = String(req.headers.accept || '')
      if (accept.includes('text/event-stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        res.end('id: 1\nevent: stdout\ndata: {"line":"ok"}\n\n')
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([]))
      return
    }

    if (req.method === 'GET' && path === '/api/sandboxes/v1/boxes/box-1/terminal') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ boxId: 'box-1', message: 'Use WebSocket connection for interactive terminal.' }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found', path }))
  })

  backend.listen(0)
  await once(backend, 'listening')
  const backendPort = (backend.address() as { port: number }).port

  const proxyPort = await findAvailablePort()
  const proxyPath = resolve('src/agent-mcp/dune_proxy.py')
  const proxy = spawn('python3', [proxyPath], {
    env: {
      ...process.env,
      DUNE_API_URL: `http://127.0.0.1:${backendPort}`,
      DUNE_AGENT_ID: 'agent-proxy-test',
      DUNE_AGENT_NAME: 'Proxy Test',
      DUNE_PROXY_PORT: String(proxyPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const deadline = Date.now() + 10_000
    let ready = false
    while (Date.now() < deadline) {
      try {
        const ping = await fetchWithTimeout(`http://127.0.0.1:${proxyPort}/channels`)
        if (ping.status === 200) {
          ready = true
          break
        }
      } catch {
        // keep polling
      }
      await delay(100)
    }
    assert.equal(ready, true, 'proxy did not become ready in time')

    const channelsRes = await fetchStep('channels', `http://127.0.0.1:${proxyPort}/channels`)
    assert.equal(channelsRes.status, 200)
    const channels = await channelsRes.json() as Array<{ id: string }>
    assert.equal(channels[0]?.id, 'chan-1')

    const agentsApiRes = await fetchStep('agents-api', `http://127.0.0.1:${proxyPort}/api/agents`)
    assert.equal(agentsApiRes.status, 200)
    const agentsViaApi = await agentsApiRes.json() as Array<{ id: string }>
    assert.equal(agentsViaApi[0]?.id, 'agent-proxy-test')

    const agentsCompatRes = await fetchStep('agents-compat', `http://127.0.0.1:${proxyPort}/agents`)
    assert.equal(agentsCompatRes.status, 200)
    const agentsViaCompat = await agentsCompatRes.json() as Array<{ id: string }>
    assert.equal(agentsViaCompat[0]?.id, 'agent-proxy-test')

    const mailboxRes = await fetchStep('mailbox', `http://127.0.0.1:${proxyPort}/mailbox`)
    assert.equal(mailboxRes.status, 200)
    const mailboxBody = await mailboxRes.json() as { unreadCount: number }
    assert.equal(mailboxBody.unreadCount, 2)

    const mailboxFetchRes = await fetchStep('mailbox-fetch', `http://127.0.0.1:${proxyPort}/mailbox/fetch`, {
      method: 'POST',
    })
    assert.equal(mailboxFetchRes.status, 200)
    const mailboxFetchBody = await mailboxFetchRes.json() as { batchId: string }
    assert.equal(mailboxFetchBody.batchId, 'batch-1')

    const mailboxAckRes = await fetchStep('mailbox-ack', `http://127.0.0.1:${proxyPort}/mailbox/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: 'batch-1' }),
    })
    assert.equal(mailboxAckRes.status, 200)
    const mailboxAckBody = await mailboxAckRes.json() as { ok: boolean }
    assert.equal(mailboxAckBody.ok, true)

    const sendRes = await fetchStep('send', `http://127.0.0.1:${proxyPort}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'general', content: 'proxy hello' }),
    })
    assert.equal(sendRes.status, 201)
    const sent = await sendRes.json() as { authorId: string; content: string }
    assert.equal(sent.authorId, 'agent-proxy-test')
    assert.equal(sent.content, 'proxy hello')

    const blockedRes = await fetchStep('send-membership-blocked', `http://127.0.0.1:${proxyPort}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'general', content: 'membership blocked' }),
    })
    assert.equal(blockedRes.status, 403)
    const blockedBody = await blockedRes.json() as { error: string }
    assert.equal(blockedBody.error, 'Agent is not in this channel.')

    const hostExecRes = await fetchStep('host-overview', `http://127.0.0.1:${proxyPort}/host/v1/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundleId: 'com.apple.Safari',
      }),
    })
    assert.equal(hostExecRes.status, 200)
    const hostExecBody = await hostExecRes.json() as { content: Array<{ type: string; text?: string }> }
    assert.ok(Array.isArray(hostExecBody.content), 'response should have MCP content array')
    assert.equal(hostExecBody.content[0]?.type, 'text')

    const longHostRequest = fetchStep('host-overview-long', `http://127.0.0.1:${proxyPort}/host/v1/overview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundleId: 'sleep-proxy',
      }),
    })
    await delay(120)

    const duringLongChannels = await fetchStep('channels-during-long-host', `http://127.0.0.1:${proxyPort}/channels`)
    assert.equal(duringLongChannels.status, 200)

    const longHostResponse = await longHostRequest
    assert.equal(longHostResponse.status, 200)

    const historyRes = await fetchStep('messages-with-before', `http://127.0.0.1:${proxyPort}/messages?channel=general&limit=2&before=123`)
    assert.equal(historyRes.status, 200)

    const boxesRes = await fetchStep('boxes-list', `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes?limit=5`, {
      headers: { Accept: 'application/json' },
    })
    assert.equal(boxesRes.status, 200)

    const patchRes = await fetchStep('boxes-patch', `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes/box-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'patched' }),
    })
    assert.equal(patchRes.status, 200)

    const deleteRes = await fetchStep('boxes-delete', `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes/box-1`, {
      method: 'DELETE',
    })
    assert.equal(deleteRes.status, 204)

    const uploadRes = await fetchStep(
      'files-upload',
      `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes/box-1/files?path=%2Ftmp%2Ffrom-proxy.txt&overwrite=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('raw-upload-content', 'utf-8'),
      },
    )
    assert.equal(uploadRes.status, 204)

    const sseRes = await fetchStep('exec-events-sse', `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes/box-1/execs/exec-1/events`, {
      headers: { Accept: 'text/event-stream' },
    })
    assert.equal(sseRes.status, 200)
    assert.match(String(sseRes.headers.get('content-type') || ''), /text\/event-stream/)
    await sseRes.body?.cancel()

    const terminalRes = await fetchStep('terminal', `http://127.0.0.1:${proxyPort}/sandboxes/v1/boxes/box-1/terminal`)
    assert.equal(terminalRes.status, 200)
    const terminalBody = await terminalRes.json() as { boxId: string }
    assert.equal(terminalBody.boxId, 'box-1')

    const sandboxListReq = findCaptured(captured, 'GET', '/api/sandboxes/v1/boxes?')
    assert.ok(sandboxListReq)
    assert.equal(String(sandboxListReq?.headers['x-actor-type'] || ''), 'system')
    assert.equal(String(sandboxListReq?.headers['x-actor-id'] || ''), 'agent:agent-proxy-test')

    const patchReq = findCaptured(captured, 'PATCH', '/api/sandboxes/v1/boxes/box-1')
    assert.ok(patchReq)
    assert.equal(String(patchReq?.headers['content-type'] || ''), 'application/json')

    const uploadReq = findCaptured(captured, 'POST', '/api/sandboxes/v1/boxes/box-1/files')
    assert.ok(uploadReq)
    assert.equal(String(uploadReq?.headers['content-type'] || ''), 'application/octet-stream')
    assert.equal(uploadReq?.body.toString('utf-8'), 'raw-upload-content')
    assert.equal(String(uploadReq?.headers['x-actor-type'] || ''), 'system')
    assert.equal(String(uploadReq?.headers['x-actor-id'] || ''), 'agent:agent-proxy-test')

    const hostExecReq = findCaptured(captured, 'POST', '/api/agents/agent-proxy-test/host-operator')
    assert.ok(hostExecReq)
    assert.equal(String(hostExecReq?.headers['x-actor-type'] || ''), 'system')
    assert.equal(String(hostExecReq?.headers['x-actor-id'] || ''), 'agent:agent-proxy-test')
    assert.equal(JSON.parse(hostExecReq?.body.toString('utf-8') || '{}').kind, 'overview')

    const channelsReq = findCaptured(captured, 'GET', '/api/channels')
    assert.ok(channelsReq)
    assert.equal(channelsReq?.headers['x-actor-type'], undefined)
    assert.equal(channelsReq?.headers['x-actor-id'], undefined)

    const agentsReq = findCaptured(captured, 'GET', '/api/agents')
    assert.ok(agentsReq)

    const mailboxReq = findCaptured(captured, 'GET', '/api/agents/agent-proxy-test/mailbox')
    assert.ok(mailboxReq)

    const mailboxFetchReq = findCaptured(captured, 'POST', '/api/agents/agent-proxy-test/mailbox/fetch')
    assert.ok(mailboxFetchReq)

    const mailboxAckReq = findCaptured(captured, 'POST', '/api/agents/agent-proxy-test/mailbox/ack')
    assert.ok(mailboxAckReq)
    assert.deepEqual(JSON.parse(mailboxAckReq?.body.toString('utf-8') || '{}'), { batchId: 'batch-1' })

    const historyReq = findCaptured(captured, 'GET', '/api/channels/chan-1/messages?limit=2&before=123')
    assert.ok(historyReq)
  } finally {
    proxy.kill('SIGTERM')
    await Promise.race([
      once(proxy, 'exit'),
      delay(1_500),
    ])
    if (proxy.exitCode === null && proxy.signalCode === null) {
      proxy.kill('SIGKILL')
      await Promise.race([
        once(proxy, 'exit'),
        delay(1_500),
      ])
    }

    backend.close()
    backend.closeAllConnections?.()
    backend.closeIdleConnections?.()
    await Promise.race([
      once(backend, 'close'),
      delay(1_500),
    ])
  }
})

test('dune proxy fails over to the next backend endpoint after a transport error', async () => {
  let goodBackendHits = 0

  const badBackend = createServer((req) => {
    req.socket.destroy()
  })
  badBackend.listen(0)
  await once(badBackend, 'listening')
  const badPort = (badBackend.address() as { port: number }).port

  const goodBackend = createServer((req, res) => {
    const path = req.url || '/'
    if (req.method === 'GET' && path === '/api/agents') {
      goodBackendHits += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify([{ id: 'agent-proxy-failover', name: 'Proxy Failover' }]))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found', path }))
  })
  goodBackend.listen(0)
  await once(goodBackend, 'listening')
  const goodPort = (goodBackend.address() as { port: number }).port

  const tempDir = mkdtempSync(join(tmpdir(), 'dune-proxy-endpoints-'))
  const endpointsPath = join(tempDir, 'backend-endpoints.json')
  writeFileSync(endpointsPath, `${JSON.stringify({
    preferredUrl: `http://127.0.0.1:${badPort}`,
    urls: [
      `http://127.0.0.1:${badPort}`,
      `http://127.0.0.1:${goodPort}`,
    ],
    updatedAt: Date.now(),
  }, null, 2)}\n`, 'utf-8')

  const proxyPort = await findAvailablePort()
  const proxyPath = resolve('src/agent-mcp/dune_proxy.py')
  const proxy = spawn('python3', [proxyPath], {
    env: {
      ...process.env,
      DUNE_API_URL: `http://127.0.0.1:${badPort}`,
      DUNE_API_ENDPOINTS_FILE: endpointsPath,
      DUNE_AGENT_ID: 'agent-proxy-failover',
      DUNE_AGENT_NAME: 'Proxy Failover',
      DUNE_PROXY_PORT: String(proxyPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const deadline = Date.now() + 8_000
    let ready = false
    while (Date.now() < deadline) {
      try {
        const response = await fetchWithTimeout(`http://127.0.0.1:${proxyPort}/api/agents`)
        if (response.status === 200) {
          ready = true
          break
        }
      } catch {
        // keep polling
      }
      await delay(100)
    }

    assert.equal(ready, true, 'proxy did not fail over to the reachable backend in time')
    assert.ok(goodBackendHits > 0)
  } finally {
    proxy.kill('SIGTERM')
    await Promise.race([
      once(proxy, 'exit'),
      delay(1_500),
    ])
    if (proxy.exitCode === null && proxy.signalCode === null) {
      proxy.kill('SIGKILL')
      await Promise.race([
        once(proxy, 'exit'),
        delay(1_500),
      ])
    }

    goodBackend.close()
    goodBackend.closeAllConnections?.()
    goodBackend.closeIdleConnections?.()
    await Promise.race([
      once(goodBackend, 'close'),
      delay(1_500),
    ])

    badBackend.close()
    badBackend.closeAllConnections?.()
    badBackend.closeIdleConnections?.()
    await Promise.race([
      once(badBackend, 'close'),
      delay(1_500),
    ])

    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('mailbox daemon fails over to the next backend endpoint after a transport error', async () => {
  let goodMailboxHits = 0

  const badBackend = createServer((req) => {
    req.socket.destroy()
  })
  badBackend.listen(0)
  await once(badBackend, 'listening')
  const badPort = (badBackend.address() as { port: number }).port

  const goodBackend = createServer((req, res) => {
    const path = req.url || '/'
    if (req.method === 'GET' && path === '/api/agents/agent-mailbox-failover/mailbox') {
      goodMailboxHits += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ unreadCount: 0, activeLease: null }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found', path }))
  })
  goodBackend.listen(0)
  await once(goodBackend, 'listening')
  const goodPort = (goodBackend.address() as { port: number }).port

  const tempDir = mkdtempSync(join(tmpdir(), 'dune-mailbox-endpoints-'))
  const endpointsPath = join(tempDir, 'backend-endpoints.json')
  writeFileSync(endpointsPath, `${JSON.stringify({
    preferredUrl: `http://127.0.0.1:${badPort}`,
    urls: [
      `http://127.0.0.1:${badPort}`,
      `http://127.0.0.1:${goodPort}`,
    ],
    updatedAt: Date.now(),
  }, null, 2)}\n`, 'utf-8')

  const daemonPath = resolve('src/agent-mcp/mailbox_daemon.py')
  const daemon = spawn('python3', [daemonPath], {
    env: {
      ...process.env,
      DUNE_API_URL: `http://127.0.0.1:${badPort}`,
      DUNE_API_ENDPOINTS_FILE: endpointsPath,
      DUNE_AGENT_ID: 'agent-mailbox-failover',
      DUNE_MAILBOX_POLL_INTERVAL: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline && goodMailboxHits === 0) {
      await delay(100)
    }

    assert.ok(goodMailboxHits > 0, 'mailbox daemon did not fail over to the reachable backend in time')
  } finally {
    daemon.kill('SIGTERM')
    await Promise.race([
      once(daemon, 'exit'),
      delay(1_500),
    ])
    if (daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill('SIGKILL')
      await Promise.race([
        once(daemon, 'exit'),
        delay(1_500),
      ])
    }

    goodBackend.close()
    goodBackend.closeAllConnections?.()
    goodBackend.closeIdleConnections?.()
    await Promise.race([
      once(goodBackend, 'close'),
      delay(1_500),
    ])

    badBackend.close()
    badBackend.closeAllConnections?.()
    badBackend.closeIdleConnections?.()
    await Promise.race([
      once(badBackend, 'close'),
      delay(1_500),
    ])

    rmSync(tempDir, { recursive: true, force: true })
  }
})
