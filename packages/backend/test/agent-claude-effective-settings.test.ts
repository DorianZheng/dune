import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-claude-effective-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const settingsStore = await import('../src/storage/claude-settings-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function resetClaudeSettingsTable() {
  db.exec('DELETE FROM claude_settings')
}

test.beforeEach(() => {
  resetClaudeSettingsTable()
})

test('Claude settings env values helper uses effective DB-backed auth/base/traffic values', () => {
  settingsStore.patchClaudeSettings({
    anthropicAuthToken: 'db-auth-token',
    anthropicBaseUrl: 'https://db.example/o2a',
    claudeCodeDisableNonessentialTraffic: '1',
  })

  const envValues = agentManager.__buildClaudeSettingsEnvValuesForTests()
  assert.deepEqual(envValues, {
    ANTHROPIC_AUTH_TOKEN: 'db-auth-token',
    ANTHROPIC_BASE_URL: 'https://db.example/o2a',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  })
})

test('Claude CLI auth env helper uses effective DB-backed API key and OAuth token', () => {
  settingsStore.patchClaudeSettings({
    anthropicApiKey: 'db-api-key',
    claudeCodeOAuthToken: 'db-oauth-token',
  })

  const cliEnv = agentManager.__buildClaudeCliAuthEnvValuesForTests()
  assert.deepEqual(cliEnv, {
    ANTHROPIC_API_KEY: 'db-api-key',
    CLAUDE_CODE_OAUTH_TOKEN: 'db-oauth-token',
  })
})

test('Claude helpers return empty values after DB secrets are cleared', () => {
  settingsStore.patchClaudeSettings({
    anthropicApiKey: 'db-api-key',
    claudeCodeOAuthToken: 'db-oauth-token',
    anthropicAuthToken: 'db-auth-token',
  })
  settingsStore.patchClaudeSettings({
    anthropicApiKey: null,
    claudeCodeOAuthToken: null,
    anthropicAuthToken: null,
  })

  const settingsEnv = agentManager.__buildClaudeSettingsEnvValuesForTests()
  const cliEnv = agentManager.__buildClaudeCliAuthEnvValuesForTests()

  assert.deepEqual(settingsEnv, {})
  assert.deepEqual(cliEnv, {})
})
