import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

process.env.DATA_DIR = join(tmpdir(), `dune-todo-timer-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const todoStore = await import('../src/storage/todo-store.js')
const { armTimer, clearTimer, reloadTimers, setNotifier, _reset } = await import('../src/todos/todo-timer.js')
const { MAX_SINGLE_TIMER_MS } = await import('../src/todos/due-at.js')

const db = getDb()

// Insert a dummy agent so FK constraints pass
db.prepare('INSERT OR IGNORE INTO agents (id, name, personality, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
  'agent-1', 'TestAgent', 'test', 'stopped', '#000', Date.now()
)

const calls: Array<{ agentId: string; content: string }> = []
const spyNotifier = async (agentId: string, content: string) => {
  calls.push({ agentId, content })
}

test.beforeEach(() => {
  _reset()
  calls.length = 0
  setNotifier(spyNotifier)
  db.exec(`DELETE FROM todos`)
})

test.afterEach(() => {
  _reset()
})

test('timer fires and notifies agent when dueAt arrives', async () => {
  const todo = todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Buy milk',
    dueAt: Date.now() + 200,
  })
  armTimer(todo.id, todo.dueAt!)

  await sleep(500)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].agentId, 'agent-1')
  assert.ok(calls[0].content.includes('Buy milk'))
  assert.ok(calls[0].content.includes(`id: ${todo.id}`), 'notification should include todo ID')
})

test('timer does NOT fire for completed todos', async () => {
  const todo = todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Done task',
    dueAt: Date.now() + 200,
  })
  todoStore.updateTodo(todo.id, { status: 'done' })
  armTimer(todo.id, todo.dueAt!)

  await sleep(500)

  assert.equal(calls.length, 0)
})

test('clearTimer prevents notification', async () => {
  const todo = todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Cancelled task',
    dueAt: Date.now() + 200,
  })
  armTimer(todo.id, todo.dueAt!)
  clearTimer(todo.id)

  await sleep(500)

  assert.equal(calls.length, 0)
})

test('reloadTimers re-arms all pending todos from DB', async () => {
  todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Task A',
    dueAt: Date.now() + 200,
  })
  todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Task B',
    dueAt: Date.now() + 200,
  })

  reloadTimers()

  await sleep(500)

  assert.equal(calls.length, 2)
})

test('timer does not auto-fire immediately for dueAt beyond setTimeout max', async () => {
  const todo = todoStore.createTodo({
    agentId: 'agent-1',
    title: 'Far future task',
    dueAt: Date.now() + MAX_SINGLE_TIMER_MS + 1,
  })
  armTimer(todo.id, todo.dueAt!)

  await sleep(100)

  assert.equal(calls.length, 0)
  assert.equal(todoStore.getTodo(todo.id)?.status, 'pending')
})
