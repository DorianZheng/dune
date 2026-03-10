import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-runtime-mounts-api')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const runtimeStore = await import('../src/storage/agent-runtime-store.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')
const agentManager = await import('../src/agents/agent-manager.js')
const agentsApi = await import('../src/api/agents.js')
const { HostDirectoryPickerError } = await import('../src/utils/host-directory-picker.js')
const { app } = await import('../src/server.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM sandbox_exec_events;
    DELETE FROM sandbox_execs;
    DELETE FROM sandbox_acl;
    DELETE FROM sandbox_file_ops;
    DELETE FROM sandboxes;
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

test('agent runtime mount CRUD works with readOnly default true', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Mount CRUD Agent',
    personality: 'mount CRUD',
  })
  const hostDir = createHostDir('dune-mount-crud-')

  try {
    const createRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDir,
        guestPath: '/workspace/project',
      }),
    })
    assert.equal(createRes.status, 201)
    const created = await createRes.json() as {
      id: string
      readOnly: boolean
      hostPath: string
      guestPath: string
    }
    assert.ok(created.id)
    assert.equal(created.readOnly, true)
    assert.equal(created.hostPath, hostDir)
    assert.equal(created.guestPath, '/workspace/project')

    const listRes = await app.request(`/api/agents/${agent.id}/mounts`)
    assert.equal(listRes.status, 200)
    const listed = await listRes.json() as Array<{ id: string }>
    assert.equal(listed.length, 1)

    const patchRes = await app.request(`/api/agents/${agent.id}/mounts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestPath: '/workspace/project-renamed',
        readOnly: false,
      }),
    })
    assert.equal(patchRes.status, 200)
    const patched = await patchRes.json() as { guestPath: string; readOnly: boolean }
    assert.equal(patched.guestPath, '/workspace/project-renamed')
    assert.equal(patched.readOnly, false)

    const deleteRes = await app.request(`/api/agents/${agent.id}/mounts/${created.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleteRes.status, 204)

    const emptyListRes = await app.request(`/api/agents/${agent.id}/mounts`)
    assert.equal(emptyListRes.status, 200)
    const emptyListed = await emptyListRes.json() as Array<{ id: string }>
    assert.equal(emptyListed.length, 0)
  } finally {
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('mount mutations are blocked while agent is running', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Running Mount Guard',
    personality: 'running mount guard',
  })
  const hostDir = createHostDir('dune-mount-running-')

  try {
    const createdRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDir,
        guestPath: '/workspace/running',
      }),
    })
    assert.equal(createdRes.status, 201)
    const created = await createdRes.json() as { id: string }

    agentManager.__setRunningAgentForTests(agent.id, {
      box: {} as any,
      agent,
      sandboxId: `runtime-${agent.id}`,
      guiHttpPort: 41001,
      guiHttpsPort: 41002,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    const createWhileRunning = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDir,
        guestPath: '/workspace/running-new',
      }),
    })
    assert.equal(createWhileRunning.status, 409)
    assert.equal((await createWhileRunning.json() as { error: string }).error, 'agent_running_stop_required')

    const patchWhileRunning = await app.request(`/api/agents/${agent.id}/mounts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readOnly: false }),
    })
    assert.equal(patchWhileRunning.status, 409)
    assert.equal((await patchWhileRunning.json() as { error: string }).error, 'agent_running_stop_required')

    const deleteWhileRunning = await app.request(`/api/agents/${agent.id}/mounts/${created.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleteWhileRunning.status, 409)
    assert.equal((await deleteWhileRunning.json() as { error: string }).error, 'agent_running_stop_required')
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('mount folder picker endpoint returns selected/cancelled and stable errors', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Mount Picker Agent',
    personality: 'mount picker',
  })
  try {
    const missingAgentRes = await app.request('/api/agents/does-not-exist/mounts/select-host-directory', {
      method: 'POST',
    })
    assert.equal(missingAgentRes.status, 404)

    agentsApi.__setPickHostDirectoryForTests(async () => ({
      status: 'selected',
      hostPath: '/tmp/picked-folder',
    }))
    const selectedRes = await app.request(`/api/agents/${agent.id}/mounts/select-host-directory`, {
      method: 'POST',
    })
    assert.equal(selectedRes.status, 200)
    assert.deepEqual(await selectedRes.json(), {
      status: 'selected',
      hostPath: '/tmp/picked-folder',
    })

    agentsApi.__setPickHostDirectoryForTests(async () => ({ status: 'cancelled' }))
    const cancelledRes = await app.request(`/api/agents/${agent.id}/mounts/select-host-directory`, {
      method: 'POST',
    })
    assert.equal(cancelledRes.status, 200)
    assert.deepEqual(await cancelledRes.json(), { status: 'cancelled' })

    agentsApi.__setPickHostDirectoryForTests(async () => {
      throw new HostDirectoryPickerError('picker_unavailable', 'no picker command')
    })
    const unavailableRes = await app.request(`/api/agents/${agent.id}/mounts/select-host-directory`, {
      method: 'POST',
    })
    assert.equal(unavailableRes.status, 503)
    assert.equal((await unavailableRes.json() as { error: string }).error, 'folder_picker_unavailable')

    agentsApi.__setPickHostDirectoryForTests(async () => {
      throw new HostDirectoryPickerError('picker_failed', 'picker crashed')
    })
    const failedRes = await app.request(`/api/agents/${agent.id}/mounts/select-host-directory`, {
      method: 'POST',
    })
    assert.equal(failedRes.status, 500)
    assert.equal((await failedRes.json() as { error: string }).error, 'folder_picker_failed')
  } finally {
    agentsApi.__setPickHostDirectoryForTests(null)
  }
})

test('mount mutation resets stopped runtime sandbox so next start recreates with new volumes', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Mount Runtime Reset Agent',
    personality: 'mount reset',
  })
  const hostDir = createHostDir('dune-mount-reset-')
  const sandboxId = `runtime-${agent.id}`

  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 40101,
    guiHttpsPort: 40102,
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

  const removed: string[] = []
  try {
    agentManager.__setRuntimeForTests({
      remove: async (id: string) => {
        removed.push(id)
      },
    })

    const createRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDir,
        guestPath: '/workspace/reset-check',
      }),
    })
    assert.equal(createRes.status, 201)
    assert.deepEqual(removed, [sandboxId])

    const runtimeState = runtimeStore.getAgentRuntimeState(agent.id)
    assert.ok(runtimeState)
    assert.match(runtimeState!.sandboxId, /^pending:/)
  } finally {
    agentManager.__setRuntimeForTests(null)
    rmSync(hostDir, { recursive: true, force: true })
  }
})

test('mount validation rejects invalid host/guest paths and overlap conflicts', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Mount Validation Agent',
    personality: 'mount validation',
  })
  const hostDirA = createHostDir('dune-mount-validate-a-')
  const hostDirB = createHostDir('dune-mount-validate-b-')

  try {
    const relativeHostRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: 'relative/path',
        guestPath: '/workspace/relative',
      }),
    })
    assert.equal(relativeHostRes.status, 400)
    assert.equal((await relativeHostRes.json() as { error: string }).error, 'invalid_host_path')

    const missingHostRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: `${hostDirA}-missing`,
        guestPath: '/workspace/missing',
      }),
    })
    assert.equal(missingHostRes.status, 400)
    assert.equal((await missingHostRes.json() as { error: string }).error, 'host_path_not_found')

    const invalidGuestRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDirA,
        guestPath: 'workspace/not-absolute',
      }),
    })
    assert.equal(invalidGuestRes.status, 400)
    assert.equal((await invalidGuestRes.json() as { error: string }).error, 'invalid_guest_path')

    const outsideWorkspaceRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDirA,
        guestPath: '/tmp/outside',
      }),
    })
    assert.equal(outsideWorkspaceRes.status, 400)
    assert.equal((await outsideWorkspaceRes.json() as { error: string }).error, 'guest_path_outside_workspace')

    const firstMountRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDirA,
        guestPath: '/workspace/project',
      }),
    })
    assert.equal(firstMountRes.status, 201)

    const duplicatePathRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDirB,
        guestPath: '/workspace/project',
      }),
    })
    assert.equal(duplicatePathRes.status, 409)
    assert.equal((await duplicatePathRes.json() as { error: string }).error, 'guest_path_conflict')

    const nestedPathRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDirB,
        guestPath: '/workspace/project/nested',
      }),
    })
    assert.equal(nestedPathRes.status, 409)
    assert.equal((await nestedPathRes.json() as { error: string }).error, 'guest_path_conflict')
  } finally {
    rmSync(hostDirA, { recursive: true, force: true })
    rmSync(hostDirB, { recursive: true, force: true })
  }
})

test('deleting agent cascades runtime mounts', async () => {
  clearTables()
  const agent = agentStore.createAgent({
    name: 'Mount Cascade Agent',
    personality: 'mount cascade',
  })
  const hostDir = createHostDir('dune-mount-cascade-')

  try {
    const createRes = await app.request(`/api/agents/${agent.id}/mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostPath: hostDir,
        guestPath: '/workspace/cascade',
      }),
    })
    assert.equal(createRes.status, 201)

    const deleteAgentRes = await app.request(`/api/agents/${agent.id}`, {
      method: 'DELETE',
    })
    assert.equal(deleteAgentRes.status, 200)

    const remaining = db.prepare('SELECT COUNT(*) as count FROM agent_runtime_mounts WHERE agent_id = ?').get(agent.id) as { count: number }
    assert.equal(remaining.count, 0)
  } finally {
    rmSync(hostDir, { recursive: true, force: true })
  }
})
