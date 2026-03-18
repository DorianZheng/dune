import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-settings-api-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const settingsStore = await import('../src/storage/claude-settings-store.js')
const { __setSyncClaudeSettingsForRunningAgentsForTests } = await import('../src/api/settings.js')
const { app } = await import('../src/server.js')

const db = getDb()

function resetState() {
  db.exec('DELETE FROM claude_settings')
}

test.beforeEach(() => {
  resetState()
  __setSyncClaudeSettingsForRunningAgentsForTests(null)
})

test.afterEach(() => {
  __setSyncClaudeSettingsForRunningAgentsForTests(null)
})

test('GET /api/settings/claude returns masked shape and never exposes raw secret values', async () => {
  const res = await app.request('/api/settings/claude')
  assert.equal(res.status, 200)

  const body = await res.json() as Record<string, unknown>
  assert.equal(body.selectedModelProvider, null)
  assert.equal(body.defaultModelId, null)
  assert.equal(body.hasAnthropicApiKey, false)
  assert.equal(body.hasClaudeCodeOAuthToken, false)
  assert.equal(body.hasAnthropicAuthToken, false)
  assert.equal(body.anthropicBaseUrl, null)
  assert.equal(body.claudeCodeDisableNonessentialTraffic, null)
  assert.equal(body.updatedAt, null)
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'anthropicApiKey'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'claudeCodeOAuthToken'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'anthropicAuthToken'), false)
})

test('PUT /api/settings/claude preserves unspecified fields and clears with null/empty string', async () => {
  const firstRes = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedModelProvider: 'claude',
      defaultModelId: 'sonnet',
      anthropicApiKey: 'db-api-key',
      claudeCodeOAuthToken: 'db-oauth-token',
      anthropicAuthToken: 'db-auth-token',
      anthropicBaseUrl: 'https://db.example/o2a',
      claudeCodeDisableNonessentialTraffic: '0',
    }),
  })
  assert.equal(firstRes.status, 200)

  const secondRes = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anthropicBaseUrl: 'https://db2.example/o2a',
      anthropiCUnknown: null,
    }),
  })
  assert.equal(secondRes.status, 400)

  const thirdRes = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anthropicBaseUrl: 'https://db2.example/o2a',
    }),
  })
  assert.equal(thirdRes.status, 200)

  const storedAfterPartial = settingsStore.getStoredClaudeSettings()
  assert.equal(storedAfterPartial.selectedModelProvider, 'claude')
  assert.equal(storedAfterPartial.defaultModelId, 'sonnet')
  assert.equal(storedAfterPartial.anthropicApiKey, 'db-api-key')
  assert.equal(storedAfterPartial.claudeCodeOAuthToken, 'db-oauth-token')
  assert.equal(storedAfterPartial.anthropicAuthToken, 'db-auth-token')
  assert.equal(storedAfterPartial.anthropicBaseUrl, 'https://db2.example/o2a')
  assert.equal(storedAfterPartial.claudeCodeDisableNonessentialTraffic, '0')

  const clearRes = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedModelProvider: '',
      defaultModelId: '',
      anthropicApiKey: null,
      anthropicBaseUrl: '',
    }),
  })
  assert.equal(clearRes.status, 200)

  const storedAfterClear = settingsStore.getStoredClaudeSettings()
  assert.equal(storedAfterClear.selectedModelProvider, null)
  assert.equal(storedAfterClear.defaultModelId, null)
  assert.equal(storedAfterClear.anthropicApiKey, null)
  assert.equal(storedAfterClear.anthropicBaseUrl, null)
  assert.equal(storedAfterClear.claudeCodeOAuthToken, 'db-oauth-token')
  assert.equal(storedAfterClear.anthropicAuthToken, 'db-auth-token')
})

test('PUT /api/settings/claude rejects invalid selectedModelProvider values', async () => {
  const res = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selectedModelProvider: 'gpt-4.1',
    }),
  })

  assert.equal(res.status, 400)
  const body = await res.json() as { error?: string }
  assert.match(body.error || '', /selectedModelProvider/i)
})

test('PUT /api/settings/claude rejects invalid defaultModelId values', async () => {
  const res = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      defaultModelId: 'opus; rm -rf /',
    }),
  })

  assert.equal(res.status, 400)
  const body = await res.json() as { error?: string }
  assert.match(body.error || '', /defaultModelId/i)
})

test('PUT /api/settings/claude triggers running-agents sync', async () => {
  let syncCallCount = 0
  __setSyncClaudeSettingsForRunningAgentsForTests(async () => {
    syncCallCount += 1
    return {
      total: 0,
      updated: 0,
      failed: 0,
      restoredStopped: 0,
      results: [],
    }
  })

  const res = await app.request('/api/settings/claude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anthropicAuthToken: 'db-auth-token',
    }),
  })

  assert.equal(res.status, 200)
  assert.equal(syncCallCount, 1)
})
