import type { Message } from '@dune/shared'
import * as agentStore from '../storage/agent-store.js'
import { getDb } from '../storage/database.js'
import { newId } from '../utils/ids.js'

type MailboxLeaseStatus = 'leased' | 'acked' | 'expired'
type MailboxLeaseSource = 'mailbox' | 'mention'

type LeaseSummaryRow = {
  batchId: string
  source: MailboxLeaseSource
  leasedAt: number
  expiresAt: number
  messageCount: number
}

type LeaseMessageRow = {
  batchId: string
  source: MailboxLeaseSource
  leasedAt: number
  expiresAt: number
  channelId: string | null
  channelName: string | null
  messageId: string | null
  authorId: string | null
  content: string | null
  timestamp: number | null
  mentionedAgentIds: string | null
}

type SubscriptionRow = {
  channelId: string
  channelName: string
  cursorTs: number
}

type MessageRow = {
  id: string
  channelId: string
  authorId: string
  content: string
  timestamp: number
  mentionedAgentIds: string
}

export const MAILBOX_LEASE_TTL_MS = 330_000

export interface MailboxChannelMessages {
  channelId: string
  channelName: string
  messages: Message[]
}

export interface MailboxLeaseSummary {
  batchId: string
  expiresAt: number
  messageCount: number
}

export interface MailboxSummary {
  unreadCount: number
  activeLease: MailboxLeaseSummary | null
}

export interface MailboxLease extends MailboxLeaseSummary {
  source: MailboxLeaseSource
  leasedAt: number
  channels: MailboxChannelMessages[]
}

export interface MailboxFetchResult {
  batchId: string | null
  unreadCount: number
  expiresAt: number | null
  channels: MailboxChannelMessages[]
}

export interface AckMailboxBatchResult {
  found: boolean
  ok: boolean
}

function parseMentionedAgentIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []
  } catch {
    return []
  }
}

function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    content: row.content,
    timestamp: row.timestamp,
    mentionedAgentIds: parseMentionedAgentIds(row.mentionedAgentIds),
  }
}

function sumMessageCount(channels: MailboxChannelMessages[]): number {
  return channels.reduce((total, channel) => total + channel.messages.length, 0)
}

function expireLeases(agentId: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE agent_mailbox_batches
       SET status = 'expired'
       WHERE agent_id = ?
         AND status = 'leased'
         AND expires_at <= ?`
    )
    .run(agentId, now)
}

function listActiveLeaseSummaries(
  agentId: string,
  now: number,
  source?: MailboxLeaseSource,
): LeaseSummaryRow[] {
  const db = getDb()
  const sourceClause = source ? 'AND b.source = ?' : ''
  const values = source ? [agentId, now, source] : [agentId, now]
  return db.prepare(
    `SELECT b.id as batchId,
            b.source as source,
            b.leased_at as leasedAt,
            b.expires_at as expiresAt,
            COUNT(bm.message_id) as messageCount
     FROM agent_mailbox_batches b
     LEFT JOIN agent_mailbox_batch_messages bm ON bm.batch_id = b.id
     WHERE b.agent_id = ?
       AND b.status = 'leased'
       AND b.expires_at > ?
       ${sourceClause}
     GROUP BY b.id, b.source, b.leased_at, b.expires_at
     ORDER BY b.leased_at ASC`
  ).all(...values) as LeaseSummaryRow[]
}

function listActiveLeasedChannelIds(agentId: string, now: number): Set<string> {
  const rows = getDb().prepare(
    `SELECT DISTINCT bm.channel_id as channelId
     FROM agent_mailbox_batch_messages bm
     JOIN agent_mailbox_batches b ON b.id = bm.batch_id
     WHERE b.agent_id = ?
       AND b.status = 'leased'
       AND b.expires_at > ?`
  ).all(agentId, now) as Array<{ channelId: string }>
  return new Set(rows.map((row) => row.channelId))
}

function listSubscribedChannels(agentId: string, channelId?: string): SubscriptionRow[] {
  const db = getDb()
  const values: Array<string> = [agentId]
  const channelClause = channelId ? 'AND s.channel_id = ?' : ''
  if (channelId) values.push(channelId)
  return db.prepare(
    `SELECT s.channel_id as channelId,
            c.name as channelName,
            COALESCE(cur.last_read_timestamp, 0) as cursorTs
     FROM subscriptions s
     JOIN channels c ON c.id = s.channel_id
     LEFT JOIN agent_read_cursors cur
       ON cur.agent_id = s.agent_id AND cur.channel_id = s.channel_id
     WHERE s.agent_id = ?
       ${channelClause}
     ORDER BY c.name ASC`
  ).all(...values) as SubscriptionRow[]
}

function listUnreadMessagesForChannel(
  agentId: string,
  channelId: string,
  cursorTs: number,
  now: number,
): Message[] {
  const rows = getDb().prepare(
    `SELECT m.id,
            m.channel_id as channelId,
            m.author_id as authorId,
            m.content,
            m.timestamp,
            m.mentioned_agent_ids as mentionedAgentIds
     FROM messages m
     WHERE m.channel_id = ?
       AND m.timestamp > ?
       AND m.author_id != ?
       AND NOT EXISTS (
         SELECT 1
         FROM agent_mailbox_batch_messages bm
         JOIN agent_mailbox_batches b ON b.id = bm.batch_id
         WHERE bm.message_id = m.id
           AND b.agent_id = ?
           AND b.status = 'leased'
           AND b.expires_at > ?
       )
     ORDER BY m.timestamp ASC`
  ).all(channelId, cursorTs, agentId, agentId, now) as MessageRow[]

  return rows.map(mapMessageRow)
}

function hasActionableMessages(messages: Message[], agentId: string, allAgentIds: Set<string>): boolean {
  const hasHumanMessage = messages.some((message) => !allAgentIds.has(message.authorId) && message.authorId !== 'system')
  const mentionsMe = messages.some((message) => message.mentionedAgentIds.includes(agentId))
  return hasHumanMessage || mentionsMe
}

function collectCandidateChannels(agentId: string, now: number, options: { channelId?: string } = {}): MailboxChannelMessages[] {
  const allAgentIds = new Set(agentStore.listAgents().map((agent) => agent.id))
  const activeLeasedChannelIds = listActiveLeasedChannelIds(agentId, now)
  const subscriptions = listSubscribedChannels(agentId, options.channelId)
  const actionable: MailboxChannelMessages[] = []

  for (const subscription of subscriptions) {
    const messages = listUnreadMessagesForChannel(agentId, subscription.channelId, subscription.cursorTs, now)
    if (messages.length === 0) continue

    if (hasActionableMessages(messages, agentId, allAgentIds)) {
      actionable.push({
        channelId: subscription.channelId,
        channelName: subscription.channelName,
        messages,
      })
      continue
    }

    if (!activeLeasedChannelIds.has(subscription.channelId)) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage) {
        agentStore.setReadCursor(agentId, subscription.channelId, lastMessage.timestamp)
      }
    }
  }

  return actionable
}

function hydrateLease(batchId: string): MailboxLease | null {
  const rows = getDb().prepare(
    `SELECT b.id as batchId,
            b.source as source,
            b.leased_at as leasedAt,
            b.expires_at as expiresAt,
            c.id as channelId,
            c.name as channelName,
            m.id as messageId,
            m.author_id as authorId,
            m.content,
            m.timestamp,
            m.mentioned_agent_ids as mentionedAgentIds
     FROM agent_mailbox_batches b
     LEFT JOIN agent_mailbox_batch_messages bm ON bm.batch_id = b.id
     LEFT JOIN messages m ON m.id = bm.message_id
     LEFT JOIN channels c ON c.id = bm.channel_id
     WHERE b.id = ?
     ORDER BY c.name ASC, bm.message_timestamp ASC`
  ).all(batchId) as LeaseMessageRow[]

  if (rows.length === 0) return null

  const { source, leasedAt, expiresAt } = rows[0]
  const channelMap = new Map<string, MailboxChannelMessages>()

  for (const row of rows) {
    if (!row.channelId || !row.channelName || !row.messageId || row.authorId == null || row.content == null || row.timestamp == null) {
      continue
    }
    const existing = channelMap.get(row.channelId) || {
      channelId: row.channelId,
      channelName: row.channelName,
      messages: [],
    }
    existing.messages.push({
      id: row.messageId,
      channelId: row.channelId,
      authorId: row.authorId,
      content: row.content,
      timestamp: row.timestamp,
      mentionedAgentIds: parseMentionedAgentIds(row.mentionedAgentIds),
    })
    channelMap.set(row.channelId, existing)
  }

  const channels = Array.from(channelMap.values())
  return {
    batchId,
    source,
    leasedAt,
    expiresAt,
    messageCount: sumMessageCount(channels),
    channels,
  }
}

function createLease(
  agentId: string,
  source: MailboxLeaseSource,
  channels: MailboxChannelMessages[],
  now: number,
): MailboxLease {
  const batchId = newId()
  const expiresAt = now + MAILBOX_LEASE_TTL_MS
  const db = getDb()
  const insertBatch = db.prepare(
    `INSERT INTO agent_mailbox_batches (id, agent_id, status, source, leased_at, expires_at)
     VALUES (?, ?, 'leased', ?, ?, ?)`
  )
  const insertMessage = db.prepare(
    `INSERT INTO agent_mailbox_batch_messages (batch_id, message_id, channel_id, message_timestamp)
     VALUES (?, ?, ?, ?)`
  )

  db.transaction(() => {
    insertBatch.run(batchId, agentId, source, now, expiresAt)
    for (const channel of channels) {
      for (const message of channel.messages) {
        insertMessage.run(batchId, message.id, channel.channelId, message.timestamp)
      }
    }
  })()

  return {
    batchId,
    source,
    leasedAt: now,
    expiresAt,
    messageCount: sumMessageCount(channels),
    channels,
  }
}

function updateBatchStatus(agentId: string, batchId: string, status: MailboxLeaseStatus, now: number): boolean {
  const result = getDb().prepare(
    `UPDATE agent_mailbox_batches
     SET status = ?,
         acked_at = CASE WHEN ? = 'acked' THEN ? ELSE acked_at END
     WHERE id = ?
       AND agent_id = ?
       AND status = 'leased'`
  ).run(status, status, now, batchId, agentId)
  return result.changes > 0
}

export function getMailboxSummary(agentId: string, now = Date.now()): MailboxSummary {
  expireLeases(agentId, now)
  const activeLease = listActiveLeaseSummaries(agentId, now)[0] || null
  const channels = collectCandidateChannels(agentId, now)
  return {
    unreadCount: sumMessageCount(channels),
    activeLease: activeLease
      ? {
          batchId: activeLease.batchId,
          expiresAt: activeLease.expiresAt,
          messageCount: activeLease.messageCount,
        }
      : null,
  }
}

export function listLegacyUnreadChannels(agentId: string, now = Date.now()): MailboxChannelMessages[] {
  expireLeases(agentId, now)
  return collectCandidateChannels(agentId, now)
}

export function ensureMailboxLease(agentId: string, now = Date.now()): MailboxLease | null {
  expireLeases(agentId, now)
  const existing = listActiveLeaseSummaries(agentId, now, 'mailbox')[0]
  if (existing) return hydrateLease(existing.batchId)

  const channels = collectCandidateChannels(agentId, now)
  if (channels.length === 0) return null
  return createLease(agentId, 'mailbox', channels, now)
}

export function fetchMailbox(agentId: string, now = Date.now()): MailboxFetchResult {
  const lease = ensureMailboxLease(agentId, now)
  if (!lease) {
    return {
      batchId: null,
      unreadCount: 0,
      expiresAt: null,
      channels: [],
    }
  }
  return {
    batchId: lease.batchId,
    unreadCount: lease.messageCount,
    expiresAt: lease.expiresAt,
    channels: lease.channels,
  }
}

export function createMentionLease(agentId: string, channelId: string, now = Date.now()): MailboxLease | null {
  expireLeases(agentId, now)
  const channels = collectCandidateChannels(agentId, now, { channelId })
  if (channels.length === 0) return null
  return createLease(agentId, 'mention', channels, now)
}

export function ackMailboxBatch(agentId: string, batchId: string, now = Date.now()): AckMailboxBatchResult {
  expireLeases(agentId, now)
  const db = getDb()
  const batch = db.prepare(
    `SELECT status
     FROM agent_mailbox_batches
     WHERE id = ? AND agent_id = ?`
  ).get(batchId, agentId) as { status: MailboxLeaseStatus } | undefined

  if (!batch) return { found: false, ok: false }
  if (batch.status !== 'leased') return { found: true, ok: true }

  const cursorRows = db.prepare(
    `SELECT channel_id as channelId, MAX(message_timestamp) as maxTimestamp
     FROM agent_mailbox_batch_messages
     WHERE batch_id = ?
     GROUP BY channel_id`
  ).all(batchId) as Array<{ channelId: string; maxTimestamp: number }>

  db.transaction(() => {
    if (!updateBatchStatus(agentId, batchId, 'acked', now)) return
    const upsertCursor = db.prepare(
      `INSERT INTO agent_read_cursors (agent_id, channel_id, last_read_timestamp)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, channel_id)
       DO UPDATE SET last_read_timestamp = MAX(agent_read_cursors.last_read_timestamp, excluded.last_read_timestamp)`
    )
    for (const row of cursorRows) {
      upsertCursor.run(agentId, row.channelId, row.maxTimestamp)
    }
  })()

  return { found: true, ok: true }
}

export function expireMailboxBatch(agentId: string, batchId: string, now = Date.now()): AckMailboxBatchResult {
  expireLeases(agentId, now)
  const batch = getDb().prepare(
    `SELECT status
     FROM agent_mailbox_batches
     WHERE id = ? AND agent_id = ?`
  ).get(batchId, agentId) as { status: MailboxLeaseStatus } | undefined

  if (!batch) return { found: false, ok: false }
  if (batch.status !== 'leased') return { found: true, ok: true }
  updateBatchStatus(agentId, batchId, 'expired', now)
  return { found: true, ok: true }
}
