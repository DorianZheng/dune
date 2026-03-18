import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-dm-client-request-id-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')
const { app } = await import('../src/server.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM agent_logs;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function createFakeStreamingBox() {
  return {
    async exec() {
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    async _ensureBox() {
      return {
        async exec() {
          let stdoutDone = false
          return {
            async stdout() {
              return {
                async next() {
                  if (stdoutDone) return null
                  stdoutDone = true
                  return `${JSON.stringify({
                    type: 'result',
                    result: 'ok',
                    duration_ms: 1,
                    num_turns: 1,
                    total_cost_usd: 0,
                  })}\n`
                },
              }
            },
            async stderr() {
              return {
                async next() {
                  return null
                },
              }
            },
            async wait() {
              return { exitCode: 0 }
            },
            async kill() {},
          }
        },
      }
    },
  }
}

test.beforeEach(() => {
  clearTables()
})

test.afterEach(() => {
  const agents = agentStore.listAgents()
  for (const agent of agents) {
    agentManager.__setRunningAgentForTests(agent.id, null)
  }
})

test('POST /api/agents/:id/dm persists clientRequestId on the emitted user_message log entry', async () => {
  const agent = agentStore.createAgent({
    name: 'DM Log Agent',
    personality: 'DM log test',
  })

  agentManager.__setRunningAgentForTests(agent.id, {
    box: createFakeStreamingBox(),
    agent: { ...agent, status: 'idle' },
    sandboxId: `box-${agent.id}`,
    guiHttpPort: 3900,
    guiHttpsPort: 3901,
    backendUrl: 'http://localhost:3000',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any)

  const clientRequestId = 'stash-req-123'
  const res = await app.request(`/api/agents/${agent.id}/dm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: 'Queued from stash',
      clientRequestId,
    }),
  })

  assert.equal(res.status, 200)

  const logsRes = await app.request(`/api/agents/${agent.id}/logs?limit=20`)
  assert.equal(logsRes.status, 200)
  const logsBody = await logsRes.json() as {
    entries: Array<{ type: string; data: Record<string, unknown> }>
  }

  const userEntry = logsBody.entries.find((entry) => entry.type === 'user_message')
  assert.ok(userEntry)
  assert.equal(userEntry?.data.content, 'Queued from stash')
  assert.equal(userEntry?.data.clientRequestId, clientRequestId)
})
