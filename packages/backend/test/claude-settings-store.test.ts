import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-claude-settings-store-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const settingsStore = await import('../src/storage/claude-settings-store.js')

const db = getDb()

function resetClaudeSettingsTable() {
  db.exec('DELETE FROM claude_settings')
}

test.beforeEach(() => {
  resetClaudeSettingsTable()
})

test('effective settings do not use environment fallback when DB is empty', () => {
  const stored = settingsStore.getStoredClaudeSettings()
  const effective = settingsStore.getEffectiveClaudeSettings()

  assert.equal(stored.selectedModelProvider, null)
  assert.equal(stored.defaultModelId, null)
  assert.equal(effective.anthropicApiKey, '')
  assert.equal(effective.claudeCodeOAuthToken, '')
  assert.equal(effective.anthropicAuthToken, '')
  assert.equal(effective.anthropicBaseUrl, '')
  assert.equal(effective.claudeCodeDisableNonessentialTraffic, '')
})

test('DB values are returned as effective runtime values', () => {
  settingsStore.patchClaudeSettings({
    selectedModelProvider: 'claude',
    defaultModelId: 'opus',
    anthropicApiKey: 'db-api-key',
    claudeCodeOAuthToken: 'db-oauth-token',
    anthropicAuthToken: 'db-auth-token',
    anthropicBaseUrl: 'https://db.example/o2a',
    claudeCodeDisableNonessentialTraffic: '0',
  })

  const stored = settingsStore.getStoredClaudeSettings()
  const effective = settingsStore.getEffectiveClaudeSettings()
  assert.equal(stored.selectedModelProvider, 'claude')
  assert.equal(stored.defaultModelId, 'opus')
  assert.equal(effective.anthropicApiKey, 'db-api-key')
  assert.equal(effective.claudeCodeOAuthToken, 'db-oauth-token')
  assert.equal(effective.anthropicAuthToken, 'db-auth-token')
  assert.equal(effective.anthropicBaseUrl, 'https://db.example/o2a')
  assert.equal(effective.claudeCodeDisableNonessentialTraffic, '0')
})

test('clearing DB fields resets effective values to empty strings', () => {
  settingsStore.patchClaudeSettings({
    selectedModelProvider: 'claude',
    defaultModelId: 'sonnet',
    anthropicApiKey: 'db-api-key',
    anthropicBaseUrl: 'https://db.example/o2a',
  })

  settingsStore.patchClaudeSettings({
    selectedModelProvider: null,
    defaultModelId: null,
    anthropicApiKey: null,
    anthropicBaseUrl: '',
  })

  const stored = settingsStore.getStoredClaudeSettings()
  assert.equal(stored.selectedModelProvider, null)
  assert.equal(stored.defaultModelId, null)
  assert.equal(stored.anthropicApiKey, null)
  assert.equal(stored.anthropicBaseUrl, null)

  const effective = settingsStore.getEffectiveClaudeSettings()
  assert.equal(effective.anthropicApiKey, '')
  assert.equal(effective.anthropicBaseUrl, '')
})
