import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

process.env.DATA_DIR = join(tmpdir(), `dune-host-commands-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const { app, adminApp } = await import('../src/server.js')

const db = getDb()

function resetState() {
  db.exec(`
    DELETE FROM host_command_requests;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function createAgent() {
  return agentStore.createAgent({
    name: 'Host Command Agent',
    personality: 'Host command testing',
  })
}

function systemHeaders(agentId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Actor-Type': 'system',
    'X-Actor-Id': `agent:${agentId}`,
  }
}

test.beforeEach(() => {
  resetState()
})

test('agents default host exec approval mode to approval-required', () => {
  const agent = createAgent()
  assert.equal(agent.hostExecApprovalMode, 'approval-required')

  const stored = agentStore.getAgent(agent.id)
  assert.equal(stored?.hostExecApprovalMode, 'approval-required')
})

test('host command creation enforces system actor identity and workspace boundaries', async () => {
  const agent = createAgent()

  const humanRes = await app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Actor-Type': 'human',
      'X-Actor-Id': 'admin',
    },
    body: JSON.stringify({ command: 'pwd', args: [] }),
  })
  assert.equal(humanRes.status, 403)

  const wrongSystemRes = await app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Actor-Type': 'system',
      'X-Actor-Id': 'agent:someone-else',
    },
    body: JSON.stringify({ command: 'pwd', args: [] }),
  })
  assert.equal(wrongSystemRes.status, 403)

  const outOfWorkspaceRes = await app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'pwd',
      args: [],
      scope: 'workspace',
      cwd: '/tmp',
    }),
  })
  assert.equal(outOfWorkspaceRes.status, 400)
})

test('host command request can be rejected without execution', async () => {
  const agent = createAgent()

  const requestPromise = app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("should-not-run")'],
      scope: 'workspace',
      cwd: process.cwd(),
    }),
  })

  await delay(50)

  const pendingRes = await adminApp.request('/api/admin/host-commands/pending')
  assert.equal(pendingRes.status, 200)
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string; status: string }> }
  assert.equal(pendingBody.requests.length, 1)

  const requestId = pendingBody.requests[0].requestId
  const rejectRes = await adminApp.request(`/api/admin/host-commands/${requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  })
  assert.equal(rejectRes.status, 200)

  const finalRes = await requestPromise
  assert.equal(finalRes.status, 200)
  const finalBody = await finalRes.json() as {
    status: string
    startedAt: number | null
    exitCode: number | null
    errorMessage: string | null
  }
  assert.equal(finalBody.status, 'rejected')
  assert.equal(finalBody.startedAt, null)
  assert.equal(finalBody.exitCode, null)
  assert.equal(finalBody.errorMessage, 'rejected_by_admin')
})

test('full-host approvals require elevated confirmation and successful approval executes command', async () => {
  const agent = createAgent()

  const requestPromise = app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("approved")'],
      scope: 'full-host',
      cwd: process.cwd(),
    }),
  })

  await delay(50)

  const pendingRes = await adminApp.request('/api/admin/host-commands/pending')
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string }> }
  assert.equal(pendingBody.requests.length, 1)
  const requestId = pendingBody.requests[0].requestId

  const approveWithoutElevated = await adminApp.request(`/api/admin/host-commands/${requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  })
  assert.equal(approveWithoutElevated.status, 400)

  const stillPendingRes = await adminApp.request('/api/admin/host-commands/pending')
  const stillPendingBody = await stillPendingRes.json() as { requests: Array<{ requestId: string }> }
  assert.equal(stillPendingBody.requests.some((item) => item.requestId === requestId), true)

  const approveWithElevated = await adminApp.request(`/api/admin/host-commands/${requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve', elevatedConfirmed: true }),
  })
  assert.equal(approveWithElevated.status, 200)

  const finalRes = await requestPromise
  assert.equal(finalRes.status, 200)
  const finalBody = await finalRes.json() as {
    status: string
    decision: string | null
    elevatedConfirmed: boolean
    exitCode: number | null
    stdout: string
  }
  assert.equal(finalBody.status, 'completed')
  assert.equal(finalBody.decision, 'approve')
  assert.equal(finalBody.elevatedConfirmed, true)
  assert.equal(finalBody.exitCode, 0)
  assert.match(finalBody.stdout, /approved/)
})

test('dangerously-skip mode auto-approves workspace host commands', async () => {
  const agent = createAgent()
  const updated = await app.request(`/api/agents/${agent.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostExecApprovalMode: 'dangerously-skip' }),
  })
  assert.equal(updated.status, 200)

  const requestPromise = app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("auto-workspace")'],
      scope: 'workspace',
      cwd: process.cwd(),
    }),
  })

  await delay(50)

  const pendingRes = await adminApp.request('/api/admin/host-commands/pending')
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(pendingBody.requests.some((item) => item.agentId === agent.id), false)

  const finalRes = await requestPromise
  assert.equal(finalRes.status, 200)
  const finalBody = await finalRes.json() as {
    status: string
    decision: string | null
    approverId: string | null
    elevatedConfirmed: boolean
    stdout: string
  }
  assert.equal(finalBody.status, 'completed')
  assert.equal(finalBody.decision, 'approve')
  assert.equal(finalBody.approverId, 'policy:auto')
  assert.equal(finalBody.elevatedConfirmed, false)
  assert.match(finalBody.stdout, /auto-workspace/)
})

test('dangerously-skip mode auto-approves full-host host commands with elevated confirmation', async () => {
  const agent = createAgent()
  const updated = await app.request(`/api/agents/${agent.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostExecApprovalMode: 'dangerously-skip' }),
  })
  assert.equal(updated.status, 200)

  const requestPromise = app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("auto-full-host")'],
      scope: 'full-host',
      cwd: process.cwd(),
    }),
  })

  await delay(50)

  const pendingRes = await adminApp.request('/api/admin/host-commands/pending')
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(pendingBody.requests.some((item) => item.agentId === agent.id), false)

  const finalRes = await requestPromise
  assert.equal(finalRes.status, 200)
  const finalBody = await finalRes.json() as {
    status: string
    decision: string | null
    approverId: string | null
    elevatedConfirmed: boolean
    stdout: string
  }
  assert.equal(finalBody.status, 'completed')
  assert.equal(finalBody.decision, 'approve')
  assert.equal(finalBody.approverId, 'policy:auto')
  assert.equal(finalBody.elevatedConfirmed, true)
  assert.match(finalBody.stdout, /auto-full-host/)
})

test('switching an agent to dangerously-skip auto-approves only that agents pending requests', async () => {
  const targetAgent = createAgent()
  const otherAgent = agentStore.createAgent({
    name: 'Other Host Command Agent',
    personality: 'Host command testing',
  })

  const targetRequestPromise = app.request(`/api/agents/${targetAgent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(targetAgent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("target-approved")'],
      scope: 'workspace',
      cwd: process.cwd(),
    }),
  })

  const otherRequestPromise = app.request(`/api/agents/${otherAgent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(otherAgent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("other-pending")'],
      scope: 'workspace',
      cwd: process.cwd(),
    }),
  })

  await delay(50)

  const beforeRes = await adminApp.request('/api/admin/host-commands/pending')
  const beforeBody = await beforeRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(beforeBody.requests.length, 2)

  const switchRes = await app.request(`/api/agents/${targetAgent.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostExecApprovalMode: 'dangerously-skip' }),
  })
  assert.equal(switchRes.status, 200)

  const targetFinalRes = await targetRequestPromise
  assert.equal(targetFinalRes.status, 200)
  const targetFinalBody = await targetFinalRes.json() as {
    status: string
    decision: string | null
    approverId: string | null
    stdout: string
  }
  assert.equal(targetFinalBody.status, 'completed')
  assert.equal(targetFinalBody.decision, 'approve')
  assert.equal(targetFinalBody.approverId, 'policy:auto')
  assert.match(targetFinalBody.stdout, /target-approved/)

  const afterRes = await adminApp.request('/api/admin/host-commands/pending')
  const afterBody = await afterRes.json() as { requests: Array<{ requestId: string; agentId: string }> }
  assert.equal(afterBody.requests.length, 1)
  assert.equal(afterBody.requests[0].agentId, otherAgent.id)

  const otherRequestId = afterBody.requests[0].requestId
  const rejectOtherRes = await adminApp.request(`/api/admin/host-commands/${otherRequestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  })
  assert.equal(rejectOtherRes.status, 200)

  const otherFinalRes = await otherRequestPromise
  assert.equal(otherFinalRes.status, 200)
  const otherFinalBody = await otherFinalRes.json() as { status: string }
  assert.equal(otherFinalBody.status, 'rejected')
})

test('pending requests persist without auto-timeout and main app does not expose admin endpoints', async () => {
  const agent = createAgent()

  const requestPromise = app.request(`/api/agents/${agent.id}/host-commands`, {
    method: 'POST',
    headers: systemHeaders(agent.id),
    body: JSON.stringify({
      command: 'node',
      args: ['-e', 'process.stdout.write("wait")'],
      scope: 'workspace',
      cwd: process.cwd(),
    }),
  })

  await delay(250)

  const pendingRes = await adminApp.request('/api/admin/host-commands/pending')
  assert.equal(pendingRes.status, 200)
  const pendingBody = await pendingRes.json() as { requests: Array<{ requestId: string; status: string }> }
  assert.equal(pendingBody.requests.length, 1)
  assert.equal(pendingBody.requests[0].status, 'pending')

  const mainPlanePending = await app.request('/api/admin/host-commands/pending')
  assert.equal(mainPlanePending.status, 404)

  const requestId = pendingBody.requests[0].requestId
  const rejectRes = await adminApp.request(`/api/admin/host-commands/${requestId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'reject' }),
  })
  assert.equal(rejectRes.status, 200)

  const finalRes = await requestPromise
  const finalBody = await finalRes.json() as { status: string }
  assert.equal(finalBody.status, 'rejected')
})
