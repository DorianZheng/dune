import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-logs-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentLogStore = await import('../src/storage/agent-log-store.js')

const db = getDb()

type TestAgentLogEntry = {
  id: string
  agentId: string
  timestamp: number
  type: 'system' | 'runtime'
  data: Record<string, unknown>
}

function clearTables() {
  db.exec(`
    DELETE FROM agent_logs;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function seedAgentWithLogs(total: number): { agentId: string; entryIds: string[] } {
  const agent = agentStore.createAgent({
    name: `Log Agent ${Date.now()}`,
    personality: 'logs test',
  })

  const entryIds: string[] = []
  const entries: TestAgentLogEntry[] = []
  const baseTimestamp = Date.now() - total
  for (let i = 1; i <= total; i += 1) {
    const id = `log-${i}`
    entryIds.push(id)
    entries.push({
      id,
      agentId: agent.id,
      timestamp: baseTimestamp + i,
      type: 'system',
      data: { message: `entry ${i}` },
    })
  }

  agentLogStore.addAgentLogs(agent.id, entries)
  return { agentId: agent.id, entryIds }
}

test.beforeEach(() => {
  clearTables()
})

test('GET /api/agents/:id/logs returns newest page in chronological order', async () => {
  const { agentId, entryIds } = seedAgentWithLogs(5)

  const res = await app.request(`/api/agents/${agentId}/logs?limit=2`)
  assert.equal(res.status, 200)

  const body = await res.json() as {
    entries: Array<{ id: string }>
    nextBeforeSeq: number | null
  }

  assert.deepEqual(body.entries.map((entry) => entry.id), [entryIds[3], entryIds[4]])
  assert.equal(typeof body.nextBeforeSeq, 'number')
})

test('GET /api/agents/:id/logs paginates older history without duplicates', async () => {
  const { agentId, entryIds } = seedAgentWithLogs(5)

  const firstRes = await app.request(`/api/agents/${agentId}/logs?limit=2`)
  assert.equal(firstRes.status, 200)
  const firstPage = await firstRes.json() as {
    entries: Array<{ id: string }>
    nextBeforeSeq: number | null
  }

  assert.deepEqual(firstPage.entries.map((entry) => entry.id), [entryIds[3], entryIds[4]])
  assert.notEqual(firstPage.nextBeforeSeq, null)

  const secondRes = await app.request(
    `/api/agents/${agentId}/logs?limit=2&beforeSeq=${firstPage.nextBeforeSeq}`
  )
  assert.equal(secondRes.status, 200)
  const secondPage = await secondRes.json() as {
    entries: Array<{ id: string }>
    nextBeforeSeq: number | null
  }

  assert.deepEqual(secondPage.entries.map((entry) => entry.id), [entryIds[1], entryIds[2]])
  assert.notEqual(secondPage.nextBeforeSeq, null)

  const thirdRes = await app.request(
    `/api/agents/${agentId}/logs?limit=2&beforeSeq=${secondPage.nextBeforeSeq}`
  )
  assert.equal(thirdRes.status, 200)
  const thirdPage = await thirdRes.json() as {
    entries: Array<{ id: string }>
    nextBeforeSeq: number | null
  }

  assert.deepEqual(thirdPage.entries.map((entry) => entry.id), [entryIds[0]])
  assert.equal(thirdPage.nextBeforeSeq, null)

  const allIds = [
    ...firstPage.entries.map((entry) => entry.id),
    ...secondPage.entries.map((entry) => entry.id),
    ...thirdPage.entries.map((entry) => entry.id),
  ]
  assert.equal(new Set(allIds).size, allIds.length)
})

test('deleting an agent cascades and removes persisted logs', () => {
  const { agentId } = seedAgentWithLogs(3)

  const before = db.prepare('SELECT COUNT(*) as count FROM agent_logs WHERE agent_id = ?').get(agentId) as { count: number }
  assert.equal(before.count, 3)

  const deleted = agentStore.deleteAgent(agentId)
  assert.equal(deleted, true)

  const after = db.prepare('SELECT COUNT(*) as count FROM agent_logs WHERE agent_id = ?').get(agentId) as { count: number }
  assert.equal(after.count, 0)
})

test('GET /api/agents/:id/logs keeps runtime payloads and mixed ordering', async () => {
  const agent = agentStore.createAgent({
    name: `Mixed Log Agent ${Date.now()}`,
    personality: 'mixed logs test',
  })

  const baseTimestamp = Date.now() - 10
  const entries: TestAgentLogEntry[] = [
    {
      id: 'sys-1',
      agentId: agent.id,
      timestamp: baseTimestamp + 1,
      type: 'system',
      data: { message: 'startup step' },
    },
    {
      id: 'rt-1',
      agentId: agent.id,
      timestamp: baseTimestamp + 2,
      type: 'runtime',
      data: { channel: 'stdout', message: 'non-json line', source: 'claude-stream' },
    },
    {
      id: 'rt-2',
      agentId: agent.id,
      timestamp: baseTimestamp + 3,
      type: 'runtime',
      data: { channel: 'stderr', message: 'error line', source: 'claude-stream' },
    },
  ]
  agentLogStore.addAgentLogs(agent.id, entries)

  const res = await app.request(`/api/agents/${agent.id}/logs?limit=10`)
  assert.equal(res.status, 200)
  const body = await res.json() as {
    entries: Array<{ id: string; type: string; data: Record<string, unknown> }>
    nextBeforeSeq: number | null
  }

  assert.deepEqual(body.entries.map((entry) => entry.id), ['sys-1', 'rt-1', 'rt-2'])
  assert.equal(body.entries[1].type, 'runtime')
  assert.equal(body.entries[1].data.channel, 'stdout')
  assert.equal(body.entries[1].data.message, 'non-json line')
  assert.equal(body.entries[2].data.channel, 'stderr')
  assert.equal(body.nextBeforeSeq, null)
})

test('GET /api/agents/:id/logs paginates mixed runtime/system entries without duplicates', async () => {
  const agent = agentStore.createAgent({
    name: `Mixed Pagination Agent ${Date.now()}`,
    personality: 'mixed pagination test',
  })

  const baseTimestamp = Date.now() - 20
  const entries: TestAgentLogEntry[] = [
    { id: 'm-1', agentId: agent.id, timestamp: baseTimestamp + 1, type: 'system', data: { message: 'one' } },
    { id: 'm-2', agentId: agent.id, timestamp: baseTimestamp + 2, type: 'runtime', data: { channel: 'stdout', message: 'two' } },
    { id: 'm-3', agentId: agent.id, timestamp: baseTimestamp + 3, type: 'system', data: { message: 'three' } },
    { id: 'm-4', agentId: agent.id, timestamp: baseTimestamp + 4, type: 'runtime', data: { channel: 'status', message: 'idle' } },
    { id: 'm-5', agentId: agent.id, timestamp: baseTimestamp + 5, type: 'runtime', data: { channel: 'lifecycle', message: 'done' } },
  ]
  agentLogStore.addAgentLogs(agent.id, entries)

  const first = await app.request(`/api/agents/${agent.id}/logs?limit=2`)
  assert.equal(first.status, 200)
  const firstPage = await first.json() as { entries: Array<{ id: string }>; nextBeforeSeq: number | null }
  assert.deepEqual(firstPage.entries.map((entry) => entry.id), ['m-4', 'm-5'])
  assert.notEqual(firstPage.nextBeforeSeq, null)

  const second = await app.request(`/api/agents/${agent.id}/logs?limit=2&beforeSeq=${firstPage.nextBeforeSeq}`)
  assert.equal(second.status, 200)
  const secondPage = await second.json() as { entries: Array<{ id: string }>; nextBeforeSeq: number | null }
  assert.deepEqual(secondPage.entries.map((entry) => entry.id), ['m-2', 'm-3'])
  assert.notEqual(secondPage.nextBeforeSeq, null)

  const third = await app.request(`/api/agents/${agent.id}/logs?limit=2&beforeSeq=${secondPage.nextBeforeSeq}`)
  assert.equal(third.status, 200)
  const thirdPage = await third.json() as { entries: Array<{ id: string }>; nextBeforeSeq: number | null }
  assert.deepEqual(thirdPage.entries.map((entry) => entry.id), ['m-1'])
  assert.equal(thirdPage.nextBeforeSeq, null)

  const allIds = [
    ...firstPage.entries.map((entry) => entry.id),
    ...secondPage.entries.map((entry) => entry.id),
    ...thirdPage.entries.map((entry) => entry.id),
  ]
  assert.equal(new Set(allIds).size, allIds.length)
})
