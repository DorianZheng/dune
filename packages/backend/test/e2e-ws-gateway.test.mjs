/**
 * End-to-end tests for the WS gateway.
 * Requires a running backend (reads .port file for ports).
 */
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const portConfig = JSON.parse(readFileSync('./packages/backend/.port', 'utf-8'))
const CLIENT_WS = `ws://127.0.0.1:${portConfig.clientPort}/ws/client`
const AGENT_WS = `ws://127.0.0.1:${portConfig.agentPort}/ws/agent?agentId=e2e-test`

let passed = 0
let failed = 0

function assert(condition, msg) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`)
    failed++
  } else {
    console.log(`  PASS: ${msg}`)
    passed++
  }
}

function rpcCall(wsUrl, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = String(Math.random())
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`Timeout: ${method}`))
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      // Skip push events, wait for the RPC response with matching id
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.close()
      resolve(msg)
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function connectAndCall(wsUrl, method, params = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`Timeout: ${method}`))
    }, timeoutMs)

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: '1', method, params }))
    })
    ws.on('message', (data) => {
      clearTimeout(timer)
      const msg = JSON.parse(data.toString())
      ws.close()
      resolve(msg)
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function run() {
  console.log(`\nE2E WS Gateway Tests`)
  console.log(`Client WS: ${CLIENT_WS}`)
  console.log(`Agent WS:  ${AGENT_WS}\n`)

  // ── Test 1: Client can list channels ──
  console.log('Test 1: Client can list channels')
  try {
    const res = await rpcCall(CLIENT_WS, 'channels.list')
    assert(typeof res.id === 'string', 'response has an id')
    assert(Array.isArray(res.result), 'result is an array')
    assert(!res.error, 'no error')
  } catch (err) {
    assert(false, `channels.list failed: ${err.message}`)
  }

  // ── Test 2: Client can list agents ──
  console.log('Test 2: Client can list agents')
  try {
    const res = await rpcCall(CLIENT_WS, 'agents.list')
    assert(Array.isArray(res.result), 'result is an array')
  } catch (err) {
    assert(false, `agents.list failed: ${err.message}`)
  }

  // ── Test 3: Client can get claude settings ──
  console.log('Test 3: Client can get claude settings')
  try {
    const res = await rpcCall(CLIENT_WS, 'settings.getClaude')
    assert(res.result !== null && typeof res.result === 'object', 'result is an object')
    assert(!res.error, 'no error')
  } catch (err) {
    assert(false, `settings.getClaude failed: ${err.message}`)
  }

  // ── Test 4: Client can get admin plane info ──
  console.log('Test 4: Client can get admin plane info')
  try {
    const res = await rpcCall(CLIENT_WS, 'settings.getAdminPlane')
    assert(typeof res.result?.hostOperatorAdminBaseUrl === 'string', 'has admin URL')
  } catch (err) {
    assert(false, `settings.getAdminPlane failed: ${err.message}`)
  }

  // ── Test 5: Unknown method returns error ──
  console.log('Test 5: Unknown method returns error')
  try {
    const res = await rpcCall(CLIENT_WS, 'nonexistent.method')
    assert(res.error, 'has error')
    assert(res.error.code === -32601, 'error code is METHOD_NOT_FOUND')
  } catch (err) {
    assert(false, `nonexistent.method failed: ${err.message}`)
  }

  // ── Test 6: Agent gateway allows channels.list ──
  console.log('Test 6: Agent gateway allows channels.list')
  try {
    const res = await rpcCall(AGENT_WS, 'channels.list')
    assert(Array.isArray(res.result), 'result is an array')
  } catch (err) {
    assert(false, `agent channels.list failed: ${err.message}`)
  }

  // ── Test 7: Agent gateway blocks agents.update (not in allowed set) ──
  console.log('Test 7: Agent gateway blocks agents.update')
  try {
    const res = await rpcCall(AGENT_WS, 'agents.update', { id: 'test', name: 'hacked' })
    assert(res.error, 'has error')
    assert(res.error.code === -32601, 'error code is METHOD_NOT_FOUND')
  } catch (err) {
    assert(false, `agent agents.update failed: ${err.message}`)
  }

  // ── Test 8: Agent gateway blocks agents.delete ──
  console.log('Test 8: Agent gateway blocks agents.delete')
  try {
    const res = await rpcCall(AGENT_WS, 'agents.delete', { id: 'test' })
    assert(res.error, 'has error')
    assert(res.error.code === -32601, 'error code is METHOD_NOT_FOUND')
  } catch (err) {
    assert(false, `agent agents.delete failed: ${err.message}`)
  }

  // ── Test 9: Agent gateway blocks settings.updateClaude ──
  console.log('Test 9: Agent gateway blocks settings.updateClaude')
  try {
    const res = await rpcCall(AGENT_WS, 'settings.updateClaude', { defaultModelId: 'hacked' })
    assert(res.error, 'has error')
    assert(res.error.code === -32601, 'error code is METHOD_NOT_FOUND')
  } catch (err) {
    assert(false, `agent settings.updateClaude failed: ${err.message}`)
  }

  // ── Test 10: Client gateway rejects /ws/agent path ──
  console.log('Test 10: Client gateway rejects /ws/agent path')
  try {
    const res = await rpcCall(`ws://127.0.0.1:${portConfig.clientPort}/ws/agent?agentId=test`, 'channels.list')
    assert(false, 'should have been rejected')
  } catch (err) {
    assert(true, `correctly rejected: ${err.message}`)
  }

  // ── Test 11: Agent gateway rejects /ws/client path ──
  console.log('Test 11: Agent gateway rejects /ws/client path')
  try {
    const res = await rpcCall(`ws://127.0.0.1:${portConfig.agentPort}/ws/client`, 'channels.list')
    assert(false, 'should have been rejected')
  } catch (err) {
    assert(true, `correctly rejected: ${err.message}`)
  }

  // ── Test 12: Create and delete a channel via RPC ──
  console.log('Test 12: Create and delete a channel via RPC')
  try {
    const createRes = await rpcCall(CLIENT_WS, 'channels.create', { name: `e2e-test-${Date.now()}` })
    assert(createRes.result?.id, 'channel created with id')
    const channelId = createRes.result.id

    const deleteRes = await rpcCall(CLIENT_WS, 'channels.delete', { id: channelId })
    assert(deleteRes.result?.ok === true, 'channel deleted')
  } catch (err) {
    assert(false, `channel create/delete failed: ${err.message}`)
  }

  // ── Test 13: Invalid JSON returns parse error ──
  console.log('Test 13: Invalid JSON returns parse error')
  try {
    const result = await new Promise((resolve, reject) => {
      const ws = new WebSocket(CLIENT_WS)
      const timer = setTimeout(() => { ws.close(); reject(new Error('Timeout')) }, 5000)
      ws.on('open', () => { ws.send('not json at all') })
      ws.on('message', (data) => {
        clearTimeout(timer)
        ws.close()
        resolve(JSON.parse(data.toString()))
      })
      ws.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
    assert(result.error?.code === -32700, 'parse error code')
  } catch (err) {
    assert(false, `parse error test failed: ${err.message}`)
  }

  // ── Test 14: Health endpoint on both ports ──
  console.log('Test 14: Health endpoint on both ports')
  try {
    const agentHealth = await fetch(`http://127.0.0.1:${portConfig.agentPort}/health`).then(r => r.json())
    assert(agentHealth.status === 'ok', 'agent health ok')
    const clientHealth = await fetch(`http://127.0.0.1:${portConfig.clientPort}/health`).then(r => r.json())
    assert(clientHealth.status === 'ok', 'client health ok')
  } catch (err) {
    assert(false, `health check failed: ${err.message}`)
  }

  // ── Summary ──
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed > 0 ? 1 : 0)
}

run().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
