import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

process.env.DATA_DIR = join(tmpdir(), `dune-todos-api-validation-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')
const { _reset: resetTodoTimers } = await import('../src/todos/todo-timer.js')

const db = getDb()

function ensureAgent() {
  db.prepare('INSERT OR IGNORE INTO agents (id, name, personality, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('agent-1', 'TodoValidationAgent', 'test', 'stopped', '#000', Date.now())
}

test.beforeEach(() => {
  resetTodoTimers()
  db.exec('DELETE FROM todos')
  ensureAgent()
})

test.afterEach(() => {
  resetTodoTimers()
})

test('POST /api/todos rejects seconds dueAt values', async () => {
  const res = await app.request('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-1',
      title: 'Bad seconds dueAt',
      dueAt: 1_772_513_005,
    }),
  })

  assert.equal(res.status, 400)
  const body = await res.json() as { error?: string }
  assert.match(body.error || '', /milliseconds|seconds/i)
  const count = db.prepare('SELECT COUNT(*) as count FROM todos').get() as { count: number }
  assert.equal(count.count, 0)
})

test('PUT /api/todos/:id rejects invalid dueAt updates', async () => {
  const validDueAt = Date.now() + 30 * 60_000
  const createRes = await app.request('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-1',
      title: 'Valid todo',
      dueAt: validDueAt,
    }),
  })
  assert.equal(createRes.status, 201)
  const created = await createRes.json() as { id: string; dueAt: number; status: string }

  const updateRes = await app.request(`/api/todos/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dueAt: 1_772_513_005 }),
  })

  assert.equal(updateRes.status, 400)
  const body = await updateRes.json() as { error?: string }
  assert.match(body.error || '', /milliseconds|seconds/i)

  const row = db.prepare('SELECT due_at as dueAt, status FROM todos WHERE id = ?').get(created.id) as { dueAt: number; status: string }
  assert.equal(row.dueAt, created.dueAt)
  assert.equal(row.status, 'pending')
})

test('POST /api/todos accepts boundary ms dueAt and remains pending immediately after create', async () => {
  const dueAt = Date.now() + 30 * 60_000
  const createRes = await app.request('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-1',
      title: 'Boundary todo',
      dueAt,
    }),
  })

  assert.equal(createRes.status, 201)
  const created = await createRes.json() as { id: string; dueAt: number; status: string }
  assert.equal(created.dueAt, dueAt)
  assert.equal(created.status, 'pending')

  await sleep(100)

  const row = db.prepare('SELECT status FROM todos WHERE id = ?').get(created.id) as { status: string }
  assert.equal(row.status, 'pending')
})

test('POST /api/todos snapshots the original request fields', async () => {
  const dueAt = Date.now() + 30 * 60_000
  const createRes = await app.request('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-1',
      title: 'Snapshot title',
      description: 'Snapshot description',
      dueAt,
    }),
  })

  assert.equal(createRes.status, 201)
  const created = await createRes.json() as {
    id: string
    originalTitle: string
    originalDescription?: string
    nextPlan?: string
  }
  assert.equal(created.originalTitle, 'Snapshot title')
  assert.equal(created.originalDescription, 'Snapshot description')
  assert.equal(created.nextPlan, undefined)

  const row = db.prepare(
    'SELECT original_title as originalTitle, original_description as originalDescription FROM todos WHERE id = ?'
  ).get(created.id) as { originalTitle: string; originalDescription: string | null }
  assert.equal(row.originalTitle, 'Snapshot title')
  assert.equal(row.originalDescription, 'Snapshot description')
})

test('PUT /api/todos/:id updates nextPlan while preserving the original request snapshot', async () => {
  const dueAt = Date.now() + 30 * 60_000
  const createRes = await app.request('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'agent-1',
      title: 'Immutable request',
      description: 'Keep this intact',
      dueAt,
    }),
  })
  assert.equal(createRes.status, 201)
  const created = await createRes.json() as { id: string }

  const updateRes = await app.request(`/api/todos/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Working title',
      nextPlan: 'Run the migration and verify logs',
      originalTitle: 'Mutated title',
      originalDescription: 'Mutated description',
    }),
  })

  assert.equal(updateRes.status, 200)
  const updated = await updateRes.json() as {
    title: string
    originalTitle: string
    originalDescription?: string
    nextPlan?: string
  }
  assert.equal(updated.title, 'Working title')
  assert.equal(updated.originalTitle, 'Immutable request')
  assert.equal(updated.originalDescription, 'Keep this intact')
  assert.equal(updated.nextPlan, 'Run the migration and verify logs')

  const row = db.prepare(
    'SELECT title, original_title as originalTitle, original_description as originalDescription, next_plan as nextPlan FROM todos WHERE id = ?'
  ).get(created.id) as { title: string; originalTitle: string; originalDescription: string | null; nextPlan: string | null }
  assert.equal(row.title, 'Working title')
  assert.equal(row.originalTitle, 'Immutable request')
  assert.equal(row.originalDescription, 'Keep this intact')
  assert.equal(row.nextPlan, 'Run the migration and verify logs')
})
