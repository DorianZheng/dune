import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

test('sandbox-api skill script is portable on host bash without bad substitution', () => {
  const scriptPath = resolve('src/agent-skills/dune-sandbox-operator/scripts/sandbox-api.sh')
  const result = spawnSync('bash', [scriptPath, 'GET', '/sandboxes/v1/boxes', '--max-time', '0.1'], {
    env: {
      ...process.env,
      SANDBOX_PROXY_URL: 'http://127.0.0.1:1',
    },
    encoding: 'utf-8',
  })

  const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`
  assert.doesNotMatch(combinedOutput, /bad substitution/i)
})
