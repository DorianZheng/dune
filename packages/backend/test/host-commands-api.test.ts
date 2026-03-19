import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

process.env.DATA_DIR = join(tmpdir(), `dune-host-operator-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const hostOperatorService = await import('../src/host-operator/host-operator-service.js')
const { app, adminApp } = await import('../src/server.js')

const db = getDb()

function resetState() {
  db.exec(`
    DELETE FROM host_operator_requests;
    DELETE FROM host_command_requests;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function createAgent(data: Partial<{
  hostOperatorApprovalMode: 'approval-required' | 'dangerously-skip'
  hostOperatorApps: string[]
  hostOperatorPaths: string[]
}> = {}) {
  const agent = agentStore.createAgent({
    name: 'Host Operator Agent',
    personality: 'Host operator testing',
  })
  return agentStore.updateAgent(agent.id, data) || agent
}

function systemHeaders(agentId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Actor-Type': 'system',
    'X-Actor-Id': `agent:${agentId}`,
  }
}

const mockProvider = {
  name: 'test-provider',
  platform: process.platform,
  async listApps() {
    return [
      { bundleId: 'com.apple.Safari', appName: 'Safari', pid: 101, active: true },
      { bundleId: 'com.apple.TextEdit', appName: 'TextEdit', pid: 102, active: false },
    ]
  },
  async overview(input: { bundleId?: string }) {
    return {
      resultJson: {
        windows: [
          { bundleId: input.bundleId || 'com.apple.Safari', title: 'Overview Window', windowId: 1 },
          { bundleId: 'com.apple.Music', title: 'Blocked Window', windowId: 2 },
        ],
      },
    }
  },
  async perceive(input: { bundleId: string; mode: string }) {
    return {
      resultJson: {
        bundleId: input.bundleId,
        mode: input.mode,
      },
      artifacts: input.mode === 'composite'
        ? [{ name: 'capture.png', contentBase64: Buffer.from('artifact').toString('base64') }]
        : [],
    }
  },
  async act(input: { action: string; bundleId?: string }) {
    return {
      resultJson: {
        ok: true,
        action: input.action,
        bundleId: input.bundleId ?? null,
      },
    }
  },
  async status() {
    return {
      resultJson: {
        available: true,
        provider: 'test-provider',
      },
    }
  },
  async filesystem(input: { op: string; path?: string }) {
    return {
      resultJson: {
        ok: true,
        op: input.op,
        path: input.path ?? null,
      },
    }
  },
}

test.beforeEach(() => {
  resetState()
  hostOperatorService.__setHostOperatorProviderForTests(mockProvider as any)
})

test.after(() => {
  hostOperatorService.__setHostOperatorProviderForTests(null)
})

test('agents default host operator config to approval-required with empty allowlists', () => {
  const agent = createAgent()
  assert.equal(agent.hostOperatorApprovalMode, 'approval-required')
  assert.deepEqual(agent.hostOperatorApps, [])
  assert.deepEqual(agent.hostOperatorPaths, [])

  const stored = agentStore.getAgent(agent.id)
  assert.equal(stored?.hostOperatorApprovalMode, 'approval-required')
  assert.deepEqual(stored?.hostOperatorApps, [])
  assert.deepEqual(stored?.hostOperatorPaths, [])
})

test('legacy host exec endpoints return 410', async () => {
  const agent = createAgent()

  const mainPlane = await app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({ command: 'pwd' }),
  })
  assert.equal(mainPlane.status, 410)
})

test('host operator creation enforces system actor identity and bundle allowlists', async () => {
  const agent = createAgent({
    hostOperatorApps: ['com.apple.Safari'],
  })

  const humanRes = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Actor-Type': 'human',
      'X-Actor-Id': 'admin',
    },
    body: JSON.stringify({ kind: 'overview', bundleId: 'com.apple.Safari' }),
  })
  assert.equal(humanRes.status, 403)

  const wrongSystemRes = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Actor-Type': 'system',
      'X-Actor-Id': 'agent:someone-else',
    },
    body: JSON.stringify({ kind: 'overview', bundleId: 'com.apple.Safari' }),
  })
  assert.equal(wrongSystemRes.status, 403)

  const disallowedRes = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({ kind: 'perceive', mode: 'accessibility', bundleId: 'com.apple.TextEdit' }),
  })
  assert.equal(disallowedRes.status, 403)
})

test('host operator request can be rejected without execution', async () => {
  const agent = createAgent({
    hostOperatorApps: ['com.apple.Safari'],
  })

  const requestPromise = app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      kind: 'act',
      action: 'focus',
      bundleId: 'com.apple.Safari',
    }),
  })

  await delay(50)

  const pendingRes = await adminApp.request('/api/admin/host-operator/pending')
  assert.equal(pendingRes.status, 200)
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string; status: string }> }
  assert.equal(pendingBody.requests.length, 1)

  const requestId = pendingBody.requests[0].requestId
  const rejectRes = await adminApp.request(`/api/admin/host-operator/${requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  })
  assert.equal(rejectRes.status, 200)

  const finalRes = await requestPromise
  assert.equal(finalRes.status, 200)
  const finalBody = await finalRes.json() as { status: string; errorMessage: string | null; startedAt: number | null }
  assert.equal(finalBody.status, 'rejected')
  assert.equal(finalBody.startedAt, null)
  assert.equal(finalBody.errorMessage, 'rejected_by_admin')
})

test('dangerously-skip host operator requests auto-approve and persist artifacts', async () => {
  const agent = createAgent({
    hostOperatorApprovalMode: 'dangerously-skip',
    hostOperatorApps: ['com.apple.Safari'],
  })

  const res = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      kind: 'perceive',
      mode: 'composite',
      bundleId: 'com.apple.Safari',
    }),
  })
  assert.equal(res.status, 200)
  const body = await res.json() as {
    status: string
    approverId: string | null
    artifactPaths: string[]
  }
  assert.equal(body.status, 'completed')
  assert.equal(body.approverId, 'policy:auto')
  assert.equal(body.artifactPaths.length, 1)

  const artifactHostPath = body.artifactPaths[0]
    .replace('/config/.dune/system/host-operator', join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', 'system', 'host-operator'))
  assert.equal(existsSync(artifactHostPath), true)
  assert.equal(readFileSync(artifactHostPath, 'utf-8'), 'artifact')
})

test('status requests complete immediately without entering the admin queue', async () => {
  const agent = createAgent()

  const res = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({ kind: 'status' }),
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { status: string; approverId: string | null }
  assert.equal(body.status, 'completed')
  assert.equal(body.approverId, 'policy:status')

  const pendingRes = await adminApp.request('/api/admin/host-operator/pending')
  const pendingBody = await pendingRes.json() as { requests: unknown[] }
  assert.equal(pendingBody.requests.length, 0)
})

test('switching an agent to dangerously-skip auto-approves only that agents pending requests', async () => {
  const targetAgent = createAgent({
    hostOperatorApps: ['com.apple.Safari'],
  })
  const otherAgent = createAgent({
    hostOperatorApps: ['com.apple.Safari'],
  })

  const targetRequestPromise = app.request(`/api/agents/${targetAgent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(targetAgent.id),
    body: JSON.stringify({
      kind: 'act',
      action: 'focus',
      bundleId: 'com.apple.Safari',
    }),
  })

  const otherRequestPromise = app.request(`/api/agents/${otherAgent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(otherAgent.id),
    body: JSON.stringify({
      kind: 'act',
      action: 'focus',
      bundleId: 'com.apple.Safari',
    }),
  })

  await delay(50)

  const beforeRes = await adminApp.request('/api/admin/host-operator/pending')
  const beforeBody = await beforeRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(beforeBody.requests.length, 2)

  const switchRes = await app.request(`/api/agents/${targetAgent.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostOperatorApprovalMode: 'dangerously-skip' }),
  })
  assert.equal(switchRes.status, 200)

  const targetFinalRes = await targetRequestPromise
  const targetFinalBody = await targetFinalRes.json() as { status: string; approverId: string | null }
  assert.equal(targetFinalBody.status, 'completed')
  assert.equal(targetFinalBody.approverId, 'policy:auto')

  const afterRes = await adminApp.request('/api/admin/host-operator/pending')
  const afterBody = await afterRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(afterBody.requests.length, 1)
  assert.equal(afterBody.requests[0].agentId, otherAgent.id)

  const rejectOtherRes = await adminApp.request(`/api/admin/host-operator/${afterBody.requests[0].requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  })
  assert.equal(rejectOtherRes.status, 200)

  const otherFinalRes = await otherRequestPromise
  const otherFinalBody = await otherFinalRes.json() as { status: string }
  assert.equal(otherFinalBody.status, 'rejected')
})

test('filesystem requests reject paths outside allowed roots', async () => {
  const allowedRoot = join(process.env.DATA_DIR!, 'allowed-root')
  const outsidePath = join(process.env.DATA_DIR!, 'outside.txt')
  mkdirSync(allowedRoot, { recursive: true })
  writeFileSync(outsidePath, 'outside', 'utf-8')
  const agent = createAgent({
    hostOperatorPaths: [allowedRoot],
  })

  const res = await app.request(`/api/agents/${agent.id}/host-operator`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      kind: 'filesystem',
      op: 'read',
      path: outsidePath,
    }),
  })
  assert.equal(res.status, 403)
})

test('admin host operator app discovery returns provider apps', async () => {
  const res = await adminApp.request('/api/admin/host-operator/apps')
  assert.equal(res.status, 200)
  const body = await res.json() as { apps: Array<{ bundleId: string }> }
  assert.equal(body.apps.length, 2)
  assert.equal(body.apps[0].bundleId, 'com.apple.Safari')
})
