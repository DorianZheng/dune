import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-manager-todo-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const todoStore = await import('../src/storage/todo-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM todos;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agents;
  `)
}

test.beforeEach(() => {
  clearTables()
  agentManager.__resetTodoReminderStateForTests()
})

test.afterEach(() => {
  agentManager.__setTodoReminderEnqueueForTests(null)
  agentManager.__resetTodoReminderStateForTests()
})

test('CLI command injects agent ID env vars and preserves session/auth flags', () => {
  const cmd = agentManager.__buildClaudeCliCommandForTests({
    agentId: 'agent-123',
    promptFile: '/tmp/prompt.txt',
    systemPromptFile: '/tmp/system.txt',
    hasSession: true,
    oauthToken: 'oauth-secret',
  })

  assert.match(cmd, /AGENT_ID=agent-123/)
  assert.match(cmd, /DUNE_AGENT_ID=agent-123/)
  assert.match(cmd, /CLAUDE_CODE_OAUTH_TOKEN=oauth-secret/)
  assert.match(cmd, /--continue/)
})

test('todo reminder check enforces cooldown boundaries for no-pending nudges', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Reminder Agent',
    personality: 'checks cooldown behavior',
  })

  const firstAt = 1_000_000
  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'no-pending')

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt + 299_999), false)
  assert.equal(sent.length, 1)

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, firstAt + 300_001), true)
  assert.equal(sent.length, 2)
  assert.equal(sent[1]?.kind, 'no-pending')
})

test('todo reminder check prioritizes overdue reminders over no-pending nudges', () => {
  const sent: Array<{ agentId: string; content: string; kind: string }> = []
  agentManager.__setTodoReminderEnqueueForTests((agentId, content, kind) => {
    sent.push({ agentId, content, kind })
  })

  const agent = agentStore.createAgent({
    name: 'Overdue Agent',
    personality: 'checks overdue behavior',
  })

  const now = Date.now()
  const overdue = todoStore.createTodo({
    agentId: agent.id,
    title: 'Past due task',
    dueAt: now - 5_000,
  })

  assert.equal(agentManager.__runTodoReminderCheckForTests(agent.id, now), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.kind, 'overdue')
  assert.match(sent[0]?.content || '', /overdue todo\(s\)/)
  assert.match(sent[0]?.content || '', new RegExp(overdue.id))
})
