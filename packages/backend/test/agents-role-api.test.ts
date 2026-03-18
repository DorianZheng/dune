import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agents-role-api-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')
const agentStore = await import('../src/storage/agent-store.js')

const db = getDb()

function resetState() {
  db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

test.beforeEach(() => {
  resetState()
})

test('agents default to follower and leader defaults plan-first plus opus override', async () => {
  const defaultAgent = agentStore.createAgent({
    name: 'Default Role Agent',
    personality: 'defaults to follower',
  })
  assert.equal(defaultAgent.role, 'follower')
  assert.equal(defaultAgent.workMode, 'normal')
  assert.equal(defaultAgent.modelIdOverride, null)

  const createRes = await app.request('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Role Lead',
      personality: 'Plans next steps',
      role: 'leader',
    }),
  })

  assert.equal(createRes.status, 201)
  const created = await createRes.json() as {
    id: string
    role: string
    workMode: string
    modelIdOverride: string | null
  }
  assert.equal(created.role, 'leader')
  assert.equal(created.workMode, 'plan-first')
  assert.equal(created.modelIdOverride, 'opus')

  const updateRes = await app.request(`/api/agents/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'follower',
      workMode: 'normal',
      modelIdOverride: 'sonnet',
    }),
  })

  assert.equal(updateRes.status, 200)
  const updated = await updateRes.json() as { role: string; workMode: string; modelIdOverride: string | null }
  assert.equal(updated.role, 'follower')
  assert.equal(updated.workMode, 'normal')
  assert.equal(updated.modelIdOverride, 'sonnet')
  assert.equal(agentStore.getAgent(created.id)?.role, 'follower')
  assert.equal(agentStore.getAgent(created.id)?.workMode, 'normal')
  assert.equal(agentStore.getAgent(created.id)?.modelIdOverride, 'sonnet')
})

test('multiple leaders are allowed', async () => {
  for (const name of ['Leader One', 'Leader Two']) {
    const res = await app.request('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        personality: `${name} personality`,
        role: 'leader',
      }),
    })
    assert.equal(res.status, 201)
  }

  const agents = agentStore.listAgents()
  assert.equal(agents.filter((agent) => agent.role === 'leader').length, 2)
})

test('skills endpoint exposes dune-leader only to leaders', async () => {
  const leader = agentStore.createAgent({
    name: 'Leader Skills Agent',
    personality: 'gets leader skill',
    role: 'leader',
  })
  const follower = agentStore.createAgent({
    name: 'Follower Skills Agent',
    personality: 'stays on base skills',
    role: 'follower',
  })

  const leaderRes = await app.request(`/api/agents/${leader.id}/skills`)
  assert.equal(leaderRes.status, 200)
  const leaderSkills = await leaderRes.json() as Array<{ name: string }>
  assert.equal(leaderSkills.some((skill) => skill.name === 'dune-leader'), true)
  // Leaders share coordination skills (including host-operator) but NOT follower-only skills
  assert.equal(leaderSkills.some((skill) => skill.name === 'dune-host-operator'), true)
  assert.equal(leaderSkills.some((skill) => skill.name === 'dune-sandbox-operator'), false)
  assert.equal(leaderSkills.some((skill) => skill.name === 'dune-miniapp-builder'), false)

  const followerRes = await app.request(`/api/agents/${follower.id}/skills`)
  assert.equal(followerRes.status, 200)
  const followerSkills = await followerRes.json() as Array<{ name: string }>
  assert.equal(followerSkills.some((skill) => skill.name === 'dune-leader'), false)
})
