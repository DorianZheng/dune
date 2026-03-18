import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-interrupt-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

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

function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createInterruptibleStreamingBox() {
  let killed = false
  let releaseExecution: (() => void) | null = null
  const executionDone = new Promise<void>((resolve) => {
    releaseExecution = resolve
  })

  return {
    wasKilled: () => killed,
    box: {
      async exec() {
        return { exitCode: 0, stdout: '', stderr: '' }
      },
      async _ensureBox() {
        return {
          async exec() {
            return {
              async stdout() {
                return {
                  async next() {
                    await executionDone
                    return null
                  },
                }
              },
              async stderr() {
                return {
                  async next() {
                    await executionDone
                    return null
                  },
                }
              },
              async wait() {
                await executionDone
                return { exitCode: killed ? 130 : 0 }
              },
              async kill() {
                killed = true
                releaseExecution?.()
              },
            }
          },
        }
      },
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

test('interruptAgentWorkflow cancels the active turn without stopping the agent', async () => {
  const agent = agentStore.createAgent({
    name: 'Interruptible Agent',
    personality: 'Interrupt workflow test',
  })

  const streaming = createInterruptibleStreamingBox()
  const running = {
    box: streaming.box,
    agent: { ...agent, status: 'idle' },
    sandboxId: `box-${agent.id}`,
    guiHttpPort: 3900,
    guiHttpsPort: 3901,
    backendUrl: 'http://localhost:3000',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
    currentExecution: null,
    interruptRequested: false,
  } as any

  agentManager.__setRunningAgentForTests(agent.id, running)

  const sendPromise = agentManager.sendMessage(
    agent.id,
    [{ authorName: 'User', content: 'Start a long task' }],
    { source: 'dm', content: 'Start a long task' },
  )

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (running.currentExecution) break
    await delay(5)
  }

  assert.ok(running.currentExecution, 'expected a live execution before interrupting')

  const interrupted = await agentManager.interruptAgentWorkflow(agent.id)
  const result = await sendPromise

  assert.equal(interrupted, true)
  assert.equal(streaming.wasKilled(), true)
  assert.equal(result, '[INTERRUPTED]')
  assert.equal(agentManager.isAgentRunning(agent.id), true)
  assert.equal(agentStore.getAgent(agent.id)?.status, 'idle')
  assert.equal(running.currentExecution, null)
})
