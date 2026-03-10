import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-managed-runtime-system-access')

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
    DELETE FROM agent_runtime_state;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agents;
  `)
}

test('system actor can fully operate managed runtime sandboxes while non-system remains blocked', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Managed Runtime',
    personality: 'managed runtime access',
  })

  const sandboxId = `runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 47001,
    guiHttpsPort: 47002,
  })

  sandboxStore.upsertManagedRuntimeSandbox({
    sandboxId,
    agentId: agent.id,
    name: `${agent.name} runtime`,
    status: 'stopped',
    startedAt: null,
    stoppedAt: Date.now(),
    boxliteBoxId: sandboxId,
  })

  let stopCalls = 0
  const removed: string[] = []

  const fakeBox = {
    getId: async () => sandboxId,
    stop: async () => {
      stopCalls += 1
    },
    exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  }

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId,
      guiHttpPort: 47001,
      guiHttpsPort: 47002,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    agentManager.__setRuntimeForTests({
      remove: async (id: string) => {
        removed.push(id)
      },
    })

    const system = { actorType: 'system' as const, actorId: 'agent:operator' }
    const human = { actorType: 'human' as const, actorId: 'human-user' }

    const listed = await sandboxManager.listBoxes(system)
    const managed = listed.boxes.find((box) => box.boxId === sandboxId)
    assert.ok(managed)
    assert.equal(managed?._dune.managedByAgent, true)

    const patched = await sandboxManager.patchBox(system, sandboxId, { name: 'Runtime Renamed' })
    assert.equal(patched?.name, 'Runtime Renamed')

    await assert.rejects(
      () => sandboxManager.patchBox(human, sandboxId, { name: 'blocked' }),
      /managed_by_agent_lifecycle/,
    )

    const started = await sandboxManager.startBox(system, sandboxId)
    assert.equal(started?.status, 'running')

    const runningStatus = await sandboxManager.getBoxStatus(system, sandboxId)
    assert.equal(runningStatus?.status, 'running')

    const stopped = await sandboxManager.stopBox(system, sandboxId)
    assert.equal(stopped.removed, false)
    assert.equal(stopCalls, 1)

    const stoppedStatus = await sandboxManager.getBoxStatus(system, sandboxId)
    assert.equal(stoppedStatus?.status, 'stopped')

    const deleted = await sandboxManager.deleteBox(system, sandboxId)
    assert.equal(deleted, true)
    assert.deepEqual(removed, [sandboxId])
    assert.equal(runtimeStore.getAgentRuntimeState(agent.id), null)
    assert.equal(sandboxStore.getSandbox(sandboxId), null)
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
    agentManager.__setRuntimeForTests(null)
  }
})
