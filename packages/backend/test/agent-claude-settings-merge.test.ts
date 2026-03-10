import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-claude-settings-merge')

const agentManager = await import('../src/agents/agent-manager.js')

test('merge keeps existing root keys and unrelated env keys', () => {
  const existing = JSON.stringify({
    theme: 'dark',
    toolPreferences: { compact: true },
    env: {
      KEEP_ME: 'yes',
      ANTHROPIC_AUTH_TOKEN: 'old-token',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0',
    },
  })

  const mergedText = agentManager.__mergeClaudeSettingsContentForTests(existing, {
    ANTHROPIC_AUTH_TOKEN: 'new-token',
    ANTHROPIC_BASE_URL: 'https://right.codes/o2a',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  })
  const merged = JSON.parse(mergedText)

  assert.equal(merged.theme, 'dark')
  assert.deepEqual(merged.toolPreferences, { compact: true })
  assert.equal(merged.env.KEEP_ME, 'yes')
  assert.equal(merged.env.ANTHROPIC_AUTH_TOKEN, 'new-token')
  assert.equal(merged.env.ANTHROPIC_BASE_URL, 'https://right.codes/o2a')
  assert.equal(merged.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
})

test('merge creates valid settings when content is missing', () => {
  const mergedText = agentManager.__mergeClaudeSettingsContentForTests(null, {
    ANTHROPIC_AUTH_TOKEN: 'token-1',
    ANTHROPIC_BASE_URL: 'https://right.codes/o2a',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  })
  const merged = JSON.parse(mergedText)

  assert.equal(typeof merged, 'object')
  assert.equal(merged.env.ANTHROPIC_AUTH_TOKEN, 'token-1')
  assert.equal(merged.env.ANTHROPIC_BASE_URL, 'https://right.codes/o2a')
  assert.equal(merged.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
})

test('merge falls back safely when existing content is malformed', () => {
  const mergedText = agentManager.__mergeClaudeSettingsContentForTests('{"env": {"KEEP_ME": "value"', {
    ANTHROPIC_AUTH_TOKEN: 'token-2',
  })
  const merged = JSON.parse(mergedText)

  assert.equal(merged.env.ANTHROPIC_AUTH_TOKEN, 'token-2')
  assert.equal(Object.keys(merged.env).length, 1)
})
