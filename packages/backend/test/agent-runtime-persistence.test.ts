import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-runtime-persistence')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const runtimeStore = await import('../src/storage/agent-runtime-store.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM sandbox_exec_events;
    DELETE FROM sandbox_execs;
    DELETE FROM sandbox_acl;
    DELETE FROM sandbox_file_ops;
    DELETE FROM sandboxes;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

test('runtime state persists sandbox identity and ports across stop/start and restart-like flows', () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Runtime Persist Agent',
    personality: 'Keeps sandbox state',
  })

  const sandboxName = `agent-runtime-${agent.id}`
  const created = runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: `pending:${agent.id}`,
    guiHttpPort: 41001,
    guiHttpsPort: 41002,
  })
  assert.equal(created.guiHttpPort, 41001)
  assert.equal(created.guiHttpsPort, 41002)

  const firstSandboxId = `box-${agent.id}-stable`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: firstSandboxId,
    guiHttpPort: created.guiHttpPort,
    guiHttpsPort: created.guiHttpsPort,
  })

  const stoppedAt = Date.now()
  runtimeStore.touchAgentRuntimeStopped(agent.id, stoppedAt)

  // Simulate restart reuse: next start reads persisted state and keeps same sandbox id + ports.
  const persisted = runtimeStore.getAgentRuntimeState(agent.id)
  assert.ok(persisted)
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: persisted!.sandboxId,
    guiHttpPort: persisted!.guiHttpPort,
    guiHttpsPort: persisted!.guiHttpsPort,
  })
  const startedAt = Date.now() + 1
  runtimeStore.touchAgentRuntimeStarted(agent.id, startedAt)

  const finalState = runtimeStore.getAgentRuntimeState(agent.id)
  assert.ok(finalState)
  assert.equal(finalState?.sandboxId, firstSandboxId)
  assert.equal(finalState?.guiHttpPort, 41001)
  assert.equal(finalState?.guiHttpsPort, 41002)
  assert.equal(finalState?.lastStoppedAt, stoppedAt)
  assert.equal(finalState?.lastStartedAt, startedAt)
})

test('running sandbox overlay prefers persisted sandbox id', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Overlay Persist Agent',
    personality: 'Overlay identity test',
  })

  const persistedSandboxId = `box-${agent.id}-persisted`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId: persistedSandboxId,
    guiHttpPort: 42001,
    guiHttpsPort: 42002,
  })

  const fakeBox = {
    getId: async () => `box-${agent.id}-ephemeral`,
  }

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId: 'box-from-running-map',
      guiHttpPort: 42001,
      guiHttpsPort: 42002,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    const running = await agentManager.listRunningAgentSandboxes()
    const listed = running.find((item) => item.agentId === agent.id)
    assert.ok(listed)
    assert.equal(listed?.sandboxId, persistedSandboxId)
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
  }
})

test('persisted agent runtime sandbox remains visible as stopped after agent stop', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Stopped Visible Agent',
    personality: 'Stopped runtime visibility test',
  })

  const persistedSandboxId = `box-${agent.id}-stopped`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId: persistedSandboxId,
    guiHttpPort: 45001,
    guiHttpsPort: 45002,
    lastStartedAt: Date.now() - 1000,
    lastStoppedAt: Date.now(),
  })

  const listed = await agentManager.listRunningAgentSandboxes()
  const found = listed.find((item) => item.agentId === agent.id)
  assert.ok(found)
  assert.equal(found?.sandboxId, persistedSandboxId)
  assert.equal(found?.status, 'stopped')
})

test('resolved runtime sandbox id remains reusable after failed-start style stop state', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Failed Start Persist Agent',
    personality: 'Failed start persistence test',
  })

  const sandboxName = `agent-runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: `pending:${agent.id}`,
    guiHttpPort: 46001,
    guiHttpsPort: 46002,
  })

  const resolvedSandboxId = `box-${agent.id}-resolved`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: resolvedSandboxId,
    guiHttpPort: 46001,
    guiHttpsPort: 46002,
  })
  runtimeStore.touchAgentRuntimeStopped(agent.id, Date.now())

  await sandboxManager.reconcileSandboxesOnStartup()

  const managedShadow = sandboxStore.getSandbox(resolvedSandboxId)
  assert.ok(managedShadow)
  assert.equal(managedShadow?.managedByAgent, true)
  assert.equal(managedShadow?.status, 'stopped')

  const persisted = runtimeStore.getAgentRuntimeState(agent.id)
  assert.ok(persisted)
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName,
    sandboxId: persisted!.sandboxId,
    guiHttpPort: persisted!.guiHttpPort,
    guiHttpsPort: persisted!.guiHttpsPort,
    lastStartedAt: persisted!.lastStartedAt,
    lastStoppedAt: persisted!.lastStoppedAt,
  })

  const finalState = runtimeStore.getAgentRuntimeState(agent.id)
  assert.equal(finalState?.sandboxId, resolvedSandboxId)
})
