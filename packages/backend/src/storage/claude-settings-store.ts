import { getDb } from './database.js'
import type { ClaudeSettings, ClaudeSettingsUpdate, SelectedModelProvider } from '@dune/shared'

const CLAUDE_SETTINGS_ROW_ID = 1
const SELECTED_MODEL_PROVIDER_CLAUDE = 'claude'

export type StoredClaudeSettings = {
  selectedModelProvider: SelectedModelProvider
  anthropicApiKey: string | null
  claudeCodeOAuthToken: string | null
  anthropicAuthToken: string | null
  anthropicBaseUrl: string | null
  claudeCodeDisableNonessentialTraffic: string | null
  updatedAt: number | null
}

export type EffectiveClaudeSettings = {
  anthropicApiKey: string
  claudeCodeOAuthToken: string
  anthropicAuthToken: string
  anthropicBaseUrl: string
  claudeCodeDisableNonessentialTraffic: string
}

function normalizeStoredValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeSelectedModelProvider(value: unknown): SelectedModelProvider {
  return value === SELECTED_MODEL_PROVIDER_CLAUDE ? SELECTED_MODEL_PROVIDER_CLAUDE : null
}

function normalizePatchValue(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeSelectedModelProviderPatchValue(
  value: SelectedModelProvider | null | undefined,
): SelectedModelProvider | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === SELECTED_MODEL_PROVIDER_CLAUDE ? SELECTED_MODEL_PROVIDER_CLAUDE : null
}

function resolveEffectiveValue(storedValue: string | null): string {
  const normalizedStored = normalizeStoredValue(storedValue)
  if (normalizedStored != null) return normalizedStored
  return ''
}

function readStoredClaudeSettingsRow(): StoredClaudeSettings | null {
  const row = getDb().prepare(`
    SELECT
      selected_model_provider AS selectedModelProvider,
      anthropic_api_key AS anthropicApiKey,
      claude_code_oauth_token AS claudeCodeOAuthToken,
      anthropic_auth_token AS anthropicAuthToken,
      anthropic_base_url AS anthropicBaseUrl,
      claude_code_disable_nonessential_traffic AS claudeCodeDisableNonessentialTraffic,
      updated_at AS updatedAt
    FROM claude_settings
    WHERE id = ?
  `).get(CLAUDE_SETTINGS_ROW_ID) as Partial<StoredClaudeSettings> | undefined

  if (!row) return null

  return {
    selectedModelProvider: normalizeSelectedModelProvider(row.selectedModelProvider),
    anthropicApiKey: normalizeStoredValue(row.anthropicApiKey),
    claudeCodeOAuthToken: normalizeStoredValue(row.claudeCodeOAuthToken),
    anthropicAuthToken: normalizeStoredValue(row.anthropicAuthToken),
    anthropicBaseUrl: normalizeStoredValue(row.anthropicBaseUrl),
    claudeCodeDisableNonessentialTraffic: normalizeStoredValue(row.claudeCodeDisableNonessentialTraffic),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : null,
  }
}

function writeStoredClaudeSettingsRow(next: StoredClaudeSettings): void {
  if (next.updatedAt == null) return
  getDb().prepare(`
    INSERT INTO claude_settings (
      id,
      selected_model_provider,
      anthropic_api_key,
      claude_code_oauth_token,
      anthropic_auth_token,
      anthropic_base_url,
      claude_code_disable_nonessential_traffic,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      selected_model_provider = excluded.selected_model_provider,
      anthropic_api_key = excluded.anthropic_api_key,
      claude_code_oauth_token = excluded.claude_code_oauth_token,
      anthropic_auth_token = excluded.anthropic_auth_token,
      anthropic_base_url = excluded.anthropic_base_url,
      claude_code_disable_nonessential_traffic = excluded.claude_code_disable_nonessential_traffic,
      updated_at = excluded.updated_at
  `).run(
    CLAUDE_SETTINGS_ROW_ID,
    next.selectedModelProvider,
    next.anthropicApiKey,
    next.claudeCodeOAuthToken,
    next.anthropicAuthToken,
    next.anthropicBaseUrl,
    next.claudeCodeDisableNonessentialTraffic,
    next.updatedAt,
  )
}

export function getStoredClaudeSettings(): StoredClaudeSettings {
  const row = readStoredClaudeSettingsRow()
  if (row) return row
  return {
    selectedModelProvider: null,
    anthropicApiKey: null,
    claudeCodeOAuthToken: null,
    anthropicAuthToken: null,
    anthropicBaseUrl: null,
    claudeCodeDisableNonessentialTraffic: null,
    updatedAt: null,
  }
}

export function getEffectiveClaudeSettings(): EffectiveClaudeSettings {
  const stored = getStoredClaudeSettings()
  return {
    anthropicApiKey: resolveEffectiveValue(stored.anthropicApiKey),
    claudeCodeOAuthToken: resolveEffectiveValue(stored.claudeCodeOAuthToken),
    anthropicAuthToken: resolveEffectiveValue(stored.anthropicAuthToken),
    anthropicBaseUrl: resolveEffectiveValue(stored.anthropicBaseUrl),
    claudeCodeDisableNonessentialTraffic: resolveEffectiveValue(stored.claudeCodeDisableNonessentialTraffic),
  }
}

export function getClaudeSettingsSummary(): ClaudeSettings {
  const effective = getEffectiveClaudeSettings()
  const stored = getStoredClaudeSettings()
  return {
    selectedModelProvider: stored.selectedModelProvider,
    anthropicBaseUrl: effective.anthropicBaseUrl || null,
    claudeCodeDisableNonessentialTraffic: effective.claudeCodeDisableNonessentialTraffic || null,
    hasAnthropicApiKey: !!effective.anthropicApiKey,
    hasClaudeCodeOAuthToken: !!effective.claudeCodeOAuthToken,
    hasAnthropicAuthToken: !!effective.anthropicAuthToken,
    updatedAt: stored.updatedAt,
  }
}

export function patchClaudeSettings(update: ClaudeSettingsUpdate): ClaudeSettings {
  const current = getStoredClaudeSettings()
  const next: StoredClaudeSettings = { ...current }
  let changed = false

  const applySelectedModelProvider = (value: SelectedModelProvider | null | undefined) => {
    const normalized = normalizeSelectedModelProviderPatchValue(value)
    if (normalized === undefined) return
    if (next.selectedModelProvider === normalized) return
    next.selectedModelProvider = normalized
    changed = true
  }

  const applyValue = (
    key: Exclude<keyof StoredClaudeSettings, 'updatedAt' | 'selectedModelProvider'>,
    value: string | null | undefined,
  ) => {
    const normalized = normalizePatchValue(value)
    if (normalized === undefined) return
    if (next[key] === normalized) return
    next[key] = normalized
    changed = true
  }

  if (Object.prototype.hasOwnProperty.call(update, 'selectedModelProvider')) {
    applySelectedModelProvider(update.selectedModelProvider)
  }
  if (Object.prototype.hasOwnProperty.call(update, 'anthropicApiKey')) {
    applyValue('anthropicApiKey', update.anthropicApiKey)
  }
  if (Object.prototype.hasOwnProperty.call(update, 'claudeCodeOAuthToken')) {
    applyValue('claudeCodeOAuthToken', update.claudeCodeOAuthToken)
  }
  if (Object.prototype.hasOwnProperty.call(update, 'anthropicAuthToken')) {
    applyValue('anthropicAuthToken', update.anthropicAuthToken)
  }
  if (Object.prototype.hasOwnProperty.call(update, 'anthropicBaseUrl')) {
    applyValue('anthropicBaseUrl', update.anthropicBaseUrl)
  }
  if (Object.prototype.hasOwnProperty.call(update, 'claudeCodeDisableNonessentialTraffic')) {
    applyValue('claudeCodeDisableNonessentialTraffic', update.claudeCodeDisableNonessentialTraffic)
  }

  if (changed) {
    next.updatedAt = Date.now()
    writeStoredClaudeSettingsRow(next)
  }

  return getClaudeSettingsSummary()
}
