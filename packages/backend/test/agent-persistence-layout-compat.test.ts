import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-persistence-layout-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const miniappStore = await import('../src/storage/miniapp-store.js')
const { app } = await import('../src/server.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agents;
  `)
}

function resetAgentData() {
  rmSync(join(process.env.DATA_DIR!, 'agents'), { recursive: true, force: true })
}

test.beforeEach(() => {
  clearTables()
  resetAgentData()
})

test.after(() => {
  resetAgentData()
})

test('memory API reads markdown files from the .dune host layout', async () => {
  const agent = agentStore.createAgent({
    name: 'Memory Layout Agent',
    personality: 'memory layout',
  })

  const memoryFile = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', 'memory', 'notes.md')
  mkdirSync(join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', 'memory'), { recursive: true })
  writeFileSync(memoryFile, '# Durable note\n', 'utf-8')

  const res = await app.request(`/api/agents/${agent.id}/memory`)
  assert.equal(res.status, 200)
  const files = await res.json() as Array<{ path: string }>
  assert.deepEqual(files.map((file) => file.path), ['notes.md'])
})

test('miniapp store reads manifests from the .dune host layout by default', () => {
  const agent = agentStore.createAgent({
    name: 'Miniapp Layout Agent',
    personality: 'miniapp layout',
  })

  const appRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', 'miniapps', 'demo-app')
  mkdirSync(appRoot, { recursive: true })
  writeFileSync(join(appRoot, 'app.json'), JSON.stringify({
    slug: 'demo-app',
    name: 'Demo App',
    entry: 'index.html',
    collection: 'Published',
    status: 'published',
  }), 'utf-8')
  writeFileSync(join(appRoot, 'index.html'), '<h1>demo</h1>', 'utf-8')

  const apps = miniappStore.listMiniApps(agent.id)
  assert.equal(apps.length, 1)
  assert.equal(apps[0]?.slug, 'demo-app')
  assert.equal(apps[0]?.openable, true)
})
