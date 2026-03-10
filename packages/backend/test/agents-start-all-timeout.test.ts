import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agents-start-all-timeout')
process.env.AGENT_STARTUP_TIMEOUT_MS = '250'

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const { __setEnsureAgentRunningForTests } = await import('../src/api/agents.js')
const { app } = await import('../src/server.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('POST /api/agents/start-all starts stopped agents with bounded concurrency', async () => {
  clearTables()
  const agents = [
    agentStore.createAgent({ name: 'StartAll A', personality: 'A' }),
    agentStore.createAgent({ name: 'StartAll B', personality: 'B' }),
    agentStore.createAgent({ name: 'StartAll C', personality: 'C' }),
  ]
  for (const agent of agents) {
    agentStore.updateAgent(agent.id, { status: 'stopped' })
  }

  try {
    __setEnsureAgentRunningForTests(async () => {
      await delay(250)
      return { guiHttpPort: 3900, guiHttpsPort: 3901, width: 1024, height: 768 }
    })

    const startedAt = Date.now()
    const res = await app.request('/api/agents/start-all', { method: 'POST' })
    const elapsedMs = Date.now() - startedAt

    assert.equal(res.status, 200)
    const body = await res.json() as Array<{ id: string; status: string }>
    assert.equal(body.length, 3)
    assert.ok(body.every((item) => item.status === 'idle'))
    // Sequential would be around 750ms. Bounded concurrency should keep this much lower.
    assert.ok(elapsedMs < 520, `expected bounded concurrency, got ${elapsedMs}ms`)
  } finally {
    __setEnsureAgentRunningForTests(null)
  }
})

test('POST /api/agents/start-all returns per-agent timeout error instead of hanging', async () => {
  clearTables()
  const fast = agentStore.createAgent({ name: 'StartAll Fast', personality: 'fast' })
  const stuck = agentStore.createAgent({ name: 'StartAll Stuck', personality: 'stuck' })
  agentStore.updateAgent(fast.id, { status: 'stopped' })
  agentStore.updateAgent(stuck.id, { status: 'stopped' })

  try {
    __setEnsureAgentRunningForTests(async (agentId: string) => {
      if (agentId === stuck.id) {
        await new Promise(() => {})
      }
      await delay(80)
      return { guiHttpPort: 4900, guiHttpsPort: 4901, width: 1024, height: 768 }
    })

    const startedAt = Date.now()
    const res = await app.request('/api/agents/start-all', { method: 'POST' })
    const elapsedMs = Date.now() - startedAt

    assert.equal(res.status, 200)
    const body = await res.json() as Array<{ id: string; status: string; error?: string }>
    const fastResult = body.find((item) => item.id === fast.id)
    const stuckResult = body.find((item) => item.id === stuck.id)
    assert.ok(fastResult)
    assert.ok(stuckResult)
    assert.equal(fastResult?.status, 'idle')
    assert.equal(stuckResult?.status, 'error')
    assert.match(stuckResult?.error || '', /^startup_timeout:/)
    // Should return promptly after per-agent timeout, not block indefinitely.
    assert.ok(elapsedMs < 4_000, `start-all took too long: ${elapsedMs}ms`)
  } finally {
    __setEnsureAgentRunningForTests(null)
  }
})
