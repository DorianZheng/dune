import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-log-retention-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentLogStore = await import('../src/storage/agent-log-store.js')

const db = getDb()
const { RETENTION_MAX_ROWS_PER_AGENT, RETENTION_MAX_AGE_MS } = agentLogStore.__retentionConstantsForTests

function clearTables() {
  db.exec(`
    DELETE FROM agent_logs;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function createAgent(nameSuffix: string) {
  return agentStore.createAgent({
    name: `Retention Agent ${nameSuffix} ${Date.now()}`,
    personality: 'retention test',
  })
}

function buildEntries(
  agentId: string,
  options: {
    prefix: string
    count: number
    startAt?: number
    timestampStart: number
    timestampStep?: number
    type?: 'system'
  },
) {
  const startAt = options.startAt ?? 1
  const timestampStep = options.timestampStep ?? 1
  return Array.from({ length: options.count }, (_, index) => {
    const number = startAt + index
    return {
      id: `${options.prefix}-${number}`,
      agentId,
      timestamp: options.timestampStart + index * timestampStep,
      type: options.type ?? ('system' as const),
      data: { message: `${options.prefix} ${number}` },
    }
  })
}

function insertRawLogRows(agentId: string, rows: Array<{ id: string; timestamp: number }>) {
  const stmt = db.prepare(
    'INSERT INTO agent_logs (agent_id, id, timestamp, type, data_json) VALUES (?, ?, ?, ?, ?)'
  )
  const tx = db.transaction(() => {
    for (const row of rows) {
      stmt.run(agentId, row.id, row.timestamp, 'system', JSON.stringify({ message: row.id }))
    }
  })
  tx()
}

test.beforeEach(() => {
  clearTables()
})

test('addAgentLogs enforces per-agent max-row retention and keeps newest rows', () => {
  const agent = createAgent('count')
  const total = RETENTION_MAX_ROWS_PER_AGENT + 25
  const base = Date.now()
  const entries = buildEntries(agent.id, {
    prefix: 'count',
    count: total,
    timestampStart: base,
  })

  agentLogStore.addAgentLogs(agent.id, entries)

  const countRow = db
    .prepare('SELECT COUNT(*) as count FROM agent_logs WHERE agent_id = ?')
    .get(agent.id) as { count: number }
  assert.equal(countRow.count, RETENTION_MAX_ROWS_PER_AGENT)

  const oldestKept = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq ASC LIMIT 1')
    .get(agent.id) as { id: string }
  const newestKept = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq DESC LIMIT 1')
    .get(agent.id) as { id: string }

  assert.equal(oldestKept.id, `count-26`)
  assert.equal(newestKept.id, `count-${total}`)
})

test('addAgentLogs prunes entries older than TTL', () => {
  const agent = createAgent('ttl')
  const now = Date.now()
  const cutoff = now - RETENTION_MAX_AGE_MS
  const entries = [
    {
      id: 'ttl-old',
      agentId: agent.id,
      timestamp: cutoff - 10_000,
      type: 'system' as const,
      data: { message: 'old' },
    },
    {
      id: 'ttl-new',
      agentId: agent.id,
      timestamp: cutoff + 10_000,
      type: 'system' as const,
      data: { message: 'new' },
    },
  ]

  agentLogStore.addAgentLogs(agent.id, entries)

  const rows = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq ASC')
    .all(agent.id) as Array<{ id: string }>
  assert.deepEqual(rows.map((row) => row.id), ['ttl-new'])
})

test('addAgentLogs applies TTL and count retention together', () => {
  const agent = createAgent('combined')
  const now = Date.now()
  const cutoff = now - RETENTION_MAX_AGE_MS
  const oldEntries = buildEntries(agent.id, {
    prefix: 'old',
    count: 30,
    timestampStart: cutoff - 1_000_000,
  })
  const freshCount = RETENTION_MAX_ROWS_PER_AGENT + 30
  const freshEntries = buildEntries(agent.id, {
    prefix: 'fresh',
    count: freshCount,
    timestampStart: now - 60_000,
  })

  agentLogStore.addAgentLogs(agent.id, [...oldEntries, ...freshEntries])

  const countRow = db
    .prepare('SELECT COUNT(*) as count FROM agent_logs WHERE agent_id = ?')
    .get(agent.id) as { count: number }
  assert.equal(countRow.count, RETENTION_MAX_ROWS_PER_AGENT)

  const oldestTs = db
    .prepare('SELECT MIN(timestamp) as timestamp FROM agent_logs WHERE agent_id = ?')
    .get(agent.id) as { timestamp: number }
  assert.ok(oldestTs.timestamp >= cutoff)

  const oldestKept = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq ASC LIMIT 1')
    .get(agent.id) as { id: string }
  const newestKept = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq DESC LIMIT 1')
    .get(agent.id) as { id: string }

  assert.equal(oldestKept.id, 'fresh-31')
  assert.equal(newestKept.id, `fresh-${freshCount}`)
})

test('global retention sweep prunes idle-agent TTL rows and count overflow', () => {
  const agent = createAgent('sweep')
  const now = Date.now()
  const cutoff = now - RETENTION_MAX_AGE_MS

  const oldRows = buildEntries(agent.id, {
    prefix: 'idle-old',
    count: 3,
    timestampStart: cutoff - 100_000,
  }).map((entry) => ({ id: entry.id, timestamp: entry.timestamp }))

  const freshOverflow = RETENTION_MAX_ROWS_PER_AGENT + 5
  const freshRows = buildEntries(agent.id, {
    prefix: 'idle-fresh',
    count: freshOverflow,
    timestampStart: now - 5_000,
  }).map((entry) => ({ id: entry.id, timestamp: entry.timestamp }))

  insertRawLogRows(agent.id, [...oldRows, ...freshRows])
  agentLogStore.runAgentLogRetentionSweep(now)

  const countRow = db
    .prepare('SELECT COUNT(*) as count FROM agent_logs WHERE agent_id = ?')
    .get(agent.id) as { count: number }
  assert.equal(countRow.count, RETENTION_MAX_ROWS_PER_AGENT)

  const oldestTs = db
    .prepare('SELECT MIN(timestamp) as timestamp FROM agent_logs WHERE agent_id = ?')
    .get(agent.id) as { timestamp: number }
  assert.ok(oldestTs.timestamp >= cutoff)

  const oldestKept = db
    .prepare('SELECT id FROM agent_logs WHERE agent_id = ? ORDER BY seq ASC LIMIT 1')
    .get(agent.id) as { id: string }
  assert.equal(oldestKept.id, 'idle-fresh-6')
})

test('pagination remains ordered and duplicate-free after retention pruning', () => {
  const agent = createAgent('pagination-after-prune')
  const total = RETENTION_MAX_ROWS_PER_AGENT + 12
  const entries = buildEntries(agent.id, {
    prefix: 'pg',
    count: total,
    timestampStart: Date.now(),
  })

  agentLogStore.addAgentLogs(agent.id, entries)

  let beforeSeq: number | undefined
  const seen = new Set<string>()
  let totalFetched = 0

  while (true) {
    const page = agentLogStore.getAgentLogs(agent.id, { limit: 333, beforeSeq })
    for (let i = 1; i < page.entries.length; i += 1) {
      assert.ok(page.entries[i - 1].timestamp <= page.entries[i].timestamp)
    }
    for (const entry of page.entries) {
      assert.equal(seen.has(entry.id), false)
      seen.add(entry.id)
    }
    totalFetched += page.entries.length
    if (page.nextBeforeSeq == null) break
    beforeSeq = page.nextBeforeSeq
  }

  assert.equal(totalFetched, RETENTION_MAX_ROWS_PER_AGENT)
  assert.equal(seen.size, RETENTION_MAX_ROWS_PER_AGENT)
  assert.equal(seen.has('pg-1'), false)
  assert.equal(seen.has('pg-12'), false)
  assert.equal(seen.has('pg-13'), true)
  assert.equal(seen.has(`pg-${total}`), true)
})
