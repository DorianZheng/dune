import { getDb } from './database.js'
import { newEventId } from '../utils/ids.js'
import type { SlackChannelLink } from '@dune/shared'

type LinkDirection = 'bidirectional' | 'inbound' | 'outbound'

function mapRow(row: any): SlackChannelLink {
  return {
    id: row.id,
    duneChannelId: row.duneChannelId,
    slackChannelId: row.slackChannelId,
    slackChannelName: row.slackChannelName,
    direction: row.direction,
    createdAt: row.createdAt,
  }
}

export function createLink(
  duneChannelId: string,
  slackChannelId: string,
  slackChannelName: string,
  direction: LinkDirection = 'bidirectional',
): SlackChannelLink {
  const link: SlackChannelLink = {
    id: newEventId(),
    duneChannelId,
    slackChannelId,
    slackChannelName,
    direction,
    createdAt: Date.now(),
  }
  getDb().prepare(`
    INSERT INTO slack_channel_links (id, dune_channel_id, slack_channel_id, slack_channel_name, direction, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(link.id, link.duneChannelId, link.slackChannelId, link.slackChannelName, link.direction, link.createdAt)
  return link
}

export function deleteLink(id: string): boolean {
  const result = getDb().prepare('DELETE FROM slack_channel_links WHERE id = ?').run(id)
  return result.changes > 0
}

export function getLinkByDuneChannel(duneChannelId: string): SlackChannelLink | null {
  const row = getDb().prepare(`
    SELECT id, dune_channel_id AS duneChannelId, slack_channel_id AS slackChannelId,
           slack_channel_name AS slackChannelName, direction, created_at AS createdAt
    FROM slack_channel_links WHERE dune_channel_id = ?
  `).get(duneChannelId) as any
  return row ? mapRow(row) : null
}

export function getLinkBySlackChannel(slackChannelId: string): SlackChannelLink | null {
  const row = getDb().prepare(`
    SELECT id, dune_channel_id AS duneChannelId, slack_channel_id AS slackChannelId,
           slack_channel_name AS slackChannelName, direction, created_at AS createdAt
    FROM slack_channel_links WHERE slack_channel_id = ?
  `).get(slackChannelId) as any
  return row ? mapRow(row) : null
}

export function listLinks(): SlackChannelLink[] {
  const rows = getDb().prepare(`
    SELECT id, dune_channel_id AS duneChannelId, slack_channel_id AS slackChannelId,
           slack_channel_name AS slackChannelName, direction, created_at AS createdAt
    FROM slack_channel_links ORDER BY created_at ASC
  `).all() as any[]
  return rows.map(mapRow)
}
