import { Hono } from 'hono'
import type { ClaudeSettingsUpdate, SelectedModelProvider } from '@dune/shared'
import * as claudeSettingsStore from '../storage/claude-settings-store.js'
import * as agentManager from '../agents/agent-manager.js'
import { config } from '../config.js'

export const settingsApi = new Hono()
const SELECTED_MODEL_PROVIDERS = new Set<SelectedModelProvider>(['claude', null])
const CLAUDE_MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

const CLAUDE_SETTINGS_KEYS = new Set([
  'selectedModelProvider',
  'defaultModelId',
  'anthropicApiKey',
  'claudeCodeOAuthToken',
  'anthropicAuthToken',
  'anthropicBaseUrl',
  'claudeCodeDisableNonessentialTraffic',
])

type SyncClaudeSettingsForRunningAgentsFn = typeof agentManager.syncClaudeSettingsForRunningAgents
let syncClaudeSettingsForRunningAgentsImpl: SyncClaudeSettingsForRunningAgentsFn = () =>
  agentManager.syncClaudeSettingsForRunningAgents()

export function __setSyncClaudeSettingsForRunningAgentsForTests(
  fn: SyncClaudeSettingsForRunningAgentsFn | null,
): void {
  syncClaudeSettingsForRunningAgentsImpl = fn ?? (() => agentManager.syncClaudeSettingsForRunningAgents())
}

function parseClaudeSettingsUpdate(body: unknown): { value: ClaudeSettingsUpdate | null; error: string | null } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, error: 'Invalid JSON body' }
  }

  const patch: ClaudeSettingsUpdate = {}
  for (const [key, rawValue] of Object.entries(body as Record<string, unknown>)) {
    if (!CLAUDE_SETTINGS_KEYS.has(key)) {
      return { value: null, error: `Unknown field: ${key}` }
    }
    if (rawValue !== null && typeof rawValue !== 'string') {
      return { value: null, error: `Field ${key} must be a string or null` }
    }
    if (key === 'selectedModelProvider') {
      const normalized = rawValue == null ? null : rawValue.trim() || null
      if (!SELECTED_MODEL_PROVIDERS.has(normalized as SelectedModelProvider)) {
        return { value: null, error: `Field ${key} must be one of: claude` }
      }
      ;(patch as Record<string, string | null>)[key] = normalized
      continue
    }
    if (key === 'defaultModelId') {
      const normalized = rawValue == null ? null : rawValue.trim() || null
      if (normalized && !CLAUDE_MODEL_ID_PATTERN.test(normalized)) {
        return { value: null, error: `Field ${key} must be a valid Claude model alias or id` }
      }
      ;(patch as Record<string, string | null>)[key] = normalized
      continue
    }
    ;(patch as Record<string, string | null>)[key] = rawValue as string | null
  }

  return { value: patch, error: null }
}

settingsApi.get('/claude', (c) => {
  return c.json(claudeSettingsStore.getClaudeSettingsSummary())
})

settingsApi.get('/admin-plane', (c) => {
  return c.json({
    hostCommandAdminBaseUrl: `http://127.0.0.1:${config.adminPort}`,
    hostOperatorAdminBaseUrl: `http://127.0.0.1:${config.adminPort}`,
  })
})

settingsApi.put('/claude', async (c) => {
  const body = await c.req.json()
  const parsed = parseClaudeSettingsUpdate(body)
  if (!parsed.value) return c.json({ error: parsed.error || 'Invalid JSON body' }, 400)

  const summary = claudeSettingsStore.patchClaudeSettings(parsed.value)
  await syncClaudeSettingsForRunningAgentsImpl()
  return c.json(summary)
})
