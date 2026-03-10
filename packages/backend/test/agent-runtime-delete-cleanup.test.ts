import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-runtime-delete')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const runtimeStore = await import('../src/storage/agent-runtime-store.js')
const agentManager = await import('../src/agents/agent-manager.js')
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

test('DELETE /api/agents/:id removes persistent runtime sandbox and state', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Delete Cleanup Agent',
    personality: 'Delete cleanup test',
  })
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId: `box-${agent.id}`,
    guiHttpPort: 43001,
    guiHttpsPort: 43002,
  })

  const removed: string[] = []
  try {
    agentManager.__setRuntimeForTests({
      remove: async (sandboxId: string) => {
        removed.push(sandboxId)
      },
    })

    const res = await app.request(`/api/agents/${agent.id}`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    assert.deepEqual(removed, [`box-${agent.id}`])
    assert.equal(agentStore.getAgent(agent.id), undefined)
    assert.equal(runtimeStore.getAgentRuntimeState(agent.id), null)
  } finally {
    agentManager.__setRuntimeForTests(null)
  }
})

test('DELETE /api/agents/:id fails if runtime sandbox cleanup fails', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Delete Failure Agent',
    personality: 'Delete failure test',
  })
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId: `box-${agent.id}-fail`,
    guiHttpPort: 44001,
    guiHttpsPort: 44002,
  })

  try {
    agentManager.__setRuntimeForTests({
      remove: async () => {
        throw new Error('simulated remove failure')
      },
    })

    const originalConsoleError = console.error
    console.error = () => {}
    let res: Response
    try {
      res = await app.request(`/api/agents/${agent.id}`, { method: 'DELETE' })
    } finally {
      console.error = originalConsoleError
    }

    assert.equal(res.status, 500)
    const body = await res.json() as { error: string }
    assert.match(body.error, /Failed to remove runtime sandbox/)

    // Cleanup failure blocks agent delete and preserves runtime state.
    assert.ok(agentStore.getAgent(agent.id))
    assert.ok(runtimeStore.getAgentRuntimeState(agent.id))
  } finally {
    agentManager.__setRuntimeForTests(null)
  }
})
