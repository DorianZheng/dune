import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-runtime-mounts-volume-wiring')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const mountStore = await import('../src/storage/agent-runtime-mount-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM agent_runtime_mounts;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function createHostDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

test('runtime volume wiring includes configured agent mounts with readOnly mapping', () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Runtime Volume Mapping Agent',
    personality: 'runtime volume mapping',
  })
  const hostDirA = createHostDir('dune-runtime-volume-a-')
  const hostDirB = createHostDir('dune-runtime-volume-b-')

  try {
    mountStore.createAgentRuntimeMount(agent.id, {
      hostPath: hostDirA,
      guestPath: '/workspace/project-a',
      readOnly: true,
    })
    mountStore.createAgentRuntimeMount(agent.id, {
      hostPath: hostDirB,
      guestPath: '/workspace/project-b',
      readOnly: false,
    })

    const base = [{ hostPath: '/host/base', guestPath: '/config/memory' }]
    const merged = agentManager.__buildAgentRuntimeVolumesForTests(agent.id, base)

    assert.equal(merged.length, 3)
    assert.deepEqual(merged[0], { hostPath: '/host/base', guestPath: '/config/memory' })
    assert.ok(merged.some((item) => item.hostPath === hostDirA && item.guestPath === '/workspace/project-a' && item.readOnly === true))
    assert.ok(merged.some((item) => item.hostPath === hostDirB && item.guestPath === '/workspace/project-b' && item.readOnly === false))
  } finally {
    rmSync(hostDirA, { recursive: true, force: true })
    rmSync(hostDirB, { recursive: true, force: true })
  }
})

test('runtime volume wiring fails fast when configured host path no longer exists', () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Runtime Missing Host Agent',
    personality: 'runtime missing host path',
  })
  const hostDir = createHostDir('dune-runtime-volume-missing-')

  mountStore.createAgentRuntimeMount(agent.id, {
    hostPath: hostDir,
    guestPath: '/workspace/missing-host',
    readOnly: true,
  })

  rmSync(hostDir, { recursive: true, force: true })

  assert.throws(
    () => agentManager.__buildAgentRuntimeVolumesForTests(agent.id, []),
    /invalid_runtime_mount:.*:host_path_not_found/,
  )
})
