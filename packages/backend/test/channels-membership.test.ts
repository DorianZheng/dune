import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

process.env.DATA_DIR = join(tmpdir(), `dune-channels-membership-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')

const db = getDb()

function resetState(): void {
  db.exec(`
    DELETE FROM messages;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM channels;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function insertChannel(id: string, name = 'general'): void {
  db.prepare('INSERT INTO channels (id, name, description, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, '', Date.now())
}

function insertAgent(id: string, name: string, status = 'stopped'): void {
  db.prepare('INSERT INTO agents (id, name, personality, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, `${name} personality`, status, '#3366ff', Date.now())
}

function subscribe(agentId: string, channelId: string): void {
  db.prepare('INSERT INTO subscriptions (agent_id, channel_id) VALUES (?, ?)').run(agentId, channelId)
}

async function waitFor(check: () => boolean, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await delay(25)
  }
  throw new Error('Timed out waiting for async condition')
}

test.beforeEach(() => {
  resetState()
})

test('POST /api/channels/:id/messages blocks unsubscribed agent author with 403 and does not persist', async () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-1', 'Writer', 'idle')

  const res = await app.request('/api/channels/chan-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'agent-1', content: 'Hello team' }),
  })

  assert.equal(res.status, 403)
  const body = await res.json() as { error?: string }
  assert.match(body.error || '', /not in this channel/i)

  const count = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
  assert.equal(count.count, 0)
})

test('POST /api/channels/:id/messages allows subscribed agent author', async () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-1', 'Writer', 'idle')
  subscribe('agent-1', 'chan-1')

  const res = await app.request('/api/channels/chan-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'agent-1', content: 'Hello team' }),
  })

  assert.equal(res.status, 201)
  const body = await res.json() as { channelId: string; authorId: string; content: string }
  assert.equal(body.channelId, 'chan-1')
  assert.equal(body.authorId, 'agent-1')
  assert.equal(body.content, 'Hello team')

  const count = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
  assert.equal(count.count, 1)
})

test('POST /api/channels/:id/messages allows non-agent author IDs', async () => {
  insertChannel('chan-1', 'general')

  const res = await app.request('/api/channels/chan-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'admin', content: 'Human message' }),
  })

  assert.equal(res.status, 201)
  const body = await res.json() as { authorId: string; content: string }
  assert.equal(body.authorId, 'admin')
  assert.equal(body.content, 'Human message')
})

test('POST /api/channels/:id/messages posts system feedback when mention target is not in channel (even if stopped)', async () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-offline', 'Beta', 'stopped')

  const res = await app.request('/api/channels/chan-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'admin', content: 'Hey @Beta can you check this?' }),
  })

  assert.equal(res.status, 201)

  await waitFor(() => {
    const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE channel_id = ?').get('chan-1') as { count: number }
    return count.count >= 2
  })

  const rows = db.prepare('SELECT author_id as authorId, content FROM messages WHERE channel_id = ? ORDER BY timestamp ASC')
    .all('chan-1') as Array<{ authorId: string; content: string }>

  const systemRows = rows.filter(r => r.authorId === 'system')
  assert.ok(systemRows.length >= 1, 'expected at least one system message')
  assert.ok(systemRows.some(r => /not in this channel/i.test(r.content)), 'expected not-in-channel system message')
  assert.equal(systemRows.some(r => /is stopped/i.test(r.content)), false, 'did not expect stopped message when unsubscribed')
})
