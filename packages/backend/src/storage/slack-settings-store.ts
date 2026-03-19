import { getDb } from './database.js'
import type { SlackSettings } from '@dune/shared'

const ROW_ID = 1

type StoredRow = {
  botToken: string | null
  appToken: string | null
  teamId: string | null
  teamName: string | null
  botUserId: string | null
  installedAt: number | null
  updatedAt: number
}

function readRow(): StoredRow | null {
  const row = getDb().prepare(`
    SELECT
      bot_token AS botToken,
      app_token AS appToken,
      team_id AS teamId,
      team_name AS teamName,
      bot_user_id AS botUserId,
      installed_at AS installedAt,
      updated_at AS updatedAt
    FROM slack_settings WHERE id = ?
  `).get(ROW_ID) as StoredRow | undefined
  return row ?? null
}

export function getSlackSettingsSummary(): SlackSettings {
  const row = readRow()
  if (!row) {
    return { isConnected: false, teamId: null, teamName: null, botUserId: null, installedAt: null, hasBotToken: false, hasAppToken: false }
  }
  return {
    isConnected: !!row.botToken,
    teamId: row.teamId,
    teamName: row.teamName,
    botUserId: row.botUserId,
    installedAt: row.installedAt,
    hasBotToken: !!row.botToken,
    hasAppToken: !!row.appToken,
  }
}

export function getSlackBotToken(): string | null {
  return readRow()?.botToken ?? null
}

export function getSlackAppToken(): string | null {
  return readRow()?.appToken ?? null
}

export function updateSlackCredentials(data: { botToken?: string; appToken?: string }): void {
  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (data.botToken !== undefined) {
    sets.push('bot_token = ?')
    values.push(data.botToken.trim() || null)
    // Set installed_at on first bot token save
    sets.push('installed_at = COALESCE(installed_at, ?)')
    values.push(now)
  }
  if (data.appToken !== undefined) {
    sets.push('app_token = ?')
    values.push(data.appToken.trim() || null)
  }

  // Upsert: insert minimal row if not exists, then update
  getDb().prepare(`INSERT INTO slack_settings (id, updated_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`).run(ROW_ID, now)
  getDb().prepare(`UPDATE slack_settings SET ${sets.join(', ')} WHERE id = ?`).run(...values, ROW_ID)
}

export function clearSlackInstallation(): void {
  getDb().prepare('DELETE FROM slack_settings WHERE id = ?').run(ROW_ID)
}
