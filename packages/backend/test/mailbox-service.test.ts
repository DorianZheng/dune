import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-mailbox-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')
const mailboxService = await import('../src/mailbox/mailbox-service.js')

const db = getDb()

function resetState(): void {
  db.exec(`
    DELETE FROM agent_mailbox_batch_messages;
    DELETE FROM agent_mailbox_batches;
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

function insertAgent(id: string, name: string): void {
  db.prepare('INSERT INTO agents (id, name, personality, status, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, `${name} personality`, 'idle', '#3366ff', Date.now())
}

function subscribe(agentId: string, channelId: string): void {
  db.prepare('INSERT INTO subscriptions (agent_id, channel_id) VALUES (?, ?)').run(agentId, channelId)
  db.prepare('INSERT OR REPLACE INTO agent_read_cursors (agent_id, channel_id, last_read_timestamp) VALUES (?, ?, ?)')
    .run(agentId, channelId, 0)
}

function insertMessage(
  id: string,
  channelId: string,
  authorId: string,
  content: string,
  timestamp: number,
  mentionedAgentIds: string[] = [],
): void {
  db.prepare(
    'INSERT INTO messages (id, channel_id, author_id, content, timestamp, mentioned_agent_ids) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, channelId, authorId, content, timestamp, JSON.stringify(mentionedAgentIds))
}

test.beforeEach(() => {
  resetState()
})

test('mailbox fetch leases unread, suppresses duplicate fetch, and ack leaves newer mail unread', async () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-1', 'Alpha')
  subscribe('agent-1', 'chan-1')

  insertMessage('msg-1', 'chan-1', 'admin', 'First', 10)
  insertMessage('msg-2', 'chan-1', 'admin', 'Second', 20)

  const summaryRes = await app.request('/api/agents/agent-1/mailbox')
  assert.equal(summaryRes.status, 200)
  const summary = await summaryRes.json() as { unreadCount: number; activeLease: { batchId: string } | null }
  assert.equal(summary.unreadCount, 2)
  assert.equal(summary.activeLease, null)

  const fetchRes = await app.request('/api/agents/agent-1/mailbox/fetch', { method: 'POST' })
  assert.equal(fetchRes.status, 200)
  const firstFetch = await fetchRes.json() as {
    batchId: string
    unreadCount: number
    expiresAt: number
    channels: Array<{ channelId: string; messages: Array<{ id: string }> }>
  }
  assert.equal(firstFetch.unreadCount, 2)
  assert.equal(firstFetch.channels.length, 1)
  assert.deepEqual(firstFetch.channels[0]?.messages.map((message) => message.id), ['msg-1', 'msg-2'])

  const repeatFetchRes = await app.request('/api/agents/agent-1/mailbox/fetch', { method: 'POST' })
  const repeatFetch = await repeatFetchRes.json() as typeof firstFetch
  assert.equal(repeatFetch.batchId, firstFetch.batchId)

  insertMessage('msg-3', 'chan-1', 'admin', 'Third', 30)

  const whileLeasedRes = await app.request('/api/agents/agent-1/mailbox')
  const whileLeased = await whileLeasedRes.json() as { unreadCount: number; activeLease: { batchId: string } | null }
  assert.equal(whileLeased.unreadCount, 1)
  assert.equal(whileLeased.activeLease?.batchId, firstFetch.batchId)

  const ackRes = await app.request('/api/agents/agent-1/mailbox/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: firstFetch.batchId }),
  })
  assert.equal(ackRes.status, 200)

  const cursor = db.prepare(
    'SELECT last_read_timestamp as lastReadTimestamp FROM agent_read_cursors WHERE agent_id = ? AND channel_id = ?',
  ).get('agent-1', 'chan-1') as { lastReadTimestamp: number }
  assert.equal(cursor.lastReadTimestamp, 20)

  const postAckSummaryRes = await app.request('/api/agents/agent-1/mailbox')
  const postAckSummary = await postAckSummaryRes.json() as { unreadCount: number; activeLease: { batchId: string } | null }
  assert.equal(postAckSummary.unreadCount, 1)
  assert.equal(postAckSummary.activeLease, null)

  const secondFetchRes = await app.request('/api/agents/agent-1/mailbox/fetch', { method: 'POST' })
  const secondFetch = await secondFetchRes.json() as typeof firstFetch
  assert.notEqual(secondFetch.batchId, firstFetch.batchId)
  assert.deepEqual(secondFetch.channels[0]?.messages.map((message) => message.id), ['msg-3'])
})

test('agent chatter auto-advances, mention leases stay out of mailbox fetch, and history still reads canonical messages', async () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-1', 'Alpha')
  insertAgent('agent-2', 'Beta')
  subscribe('agent-1', 'chan-1')

  insertMessage('msg-agent', 'chan-1', 'agent-2', 'FYI from another agent', 10)

  const chatterSummary = mailboxService.getMailboxSummary('agent-1', 15)
  assert.equal(chatterSummary.unreadCount, 0)

  const cursor = db.prepare(
    'SELECT last_read_timestamp as lastReadTimestamp FROM agent_read_cursors WHERE agent_id = ? AND channel_id = ?',
  ).get('agent-1', 'chan-1') as { lastReadTimestamp: number }
  assert.equal(cursor.lastReadTimestamp, 10)

  insertMessage('msg-human', 'chan-1', 'admin', 'Can you review this?', 20, ['agent-1'])

  const mentionLease = mailboxService.createMentionLease('agent-1', 'chan-1', 25)
  assert.ok(mentionLease)
  assert.deepEqual(mentionLease?.channels[0]?.messages.map((message) => message.id), ['msg-human'])

  const summaryWithMentionLease = mailboxService.getMailboxSummary('agent-1', 25)
  assert.equal(summaryWithMentionLease.unreadCount, 0)
  assert.equal(summaryWithMentionLease.activeLease?.batchId, mentionLease?.batchId)

  const ackResult = mailboxService.ackMailboxBatch('agent-1', mentionLease!.batchId, 30)
  assert.equal(ackResult.ok, true)

  const mailboxFetch = mailboxService.fetchMailbox('agent-1', 35)
  assert.equal(mailboxFetch.batchId, null)
  assert.equal(mailboxFetch.unreadCount, 0)

  const historyRes = await app.request('/api/channels/chan-1/messages?limit=10&before=999')
  assert.equal(historyRes.status, 200)
  const history = await historyRes.json() as Array<{ id: string }>
  assert.deepEqual(history.map((message) => message.id), ['msg-agent', 'msg-human'])
})

test('expired leases become fetchable again', () => {
  insertChannel('chan-1', 'general')
  insertAgent('agent-1', 'Alpha')
  subscribe('agent-1', 'chan-1')
  insertMessage('msg-1', 'chan-1', 'admin', 'First', 10)

  const start = 100
  const firstFetch = mailboxService.fetchMailbox('agent-1', start)
  assert.ok(firstFetch.batchId)

  const beforeExpiry = mailboxService.fetchMailbox('agent-1', start + 1)
  assert.equal(beforeExpiry.batchId, firstFetch.batchId)

  const expiredSummary = mailboxService.getMailboxSummary('agent-1', start + mailboxService.MAILBOX_LEASE_TTL_MS + 1)
  assert.equal(expiredSummary.activeLease, null)
  assert.equal(expiredSummary.unreadCount, 1)

  const secondFetch = mailboxService.fetchMailbox('agent-1', start + mailboxService.MAILBOX_LEASE_TTL_MS + 2)
  assert.ok(secondFetch.batchId)
  assert.notEqual(secondFetch.batchId, firstFetch.batchId)
})
