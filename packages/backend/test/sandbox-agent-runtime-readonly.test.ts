import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-readonly')

const { getDb } = await import('../src/storage/database.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')
const { app } = await import('../src/server.js')

const db = getDb()

function clearSandboxTables() {
  db.exec(`
    DELETE FROM sandbox_exec_events;
    DELETE FROM sandbox_execs;
    DELETE FROM sandbox_acl;
    DELETE FROM sandbox_file_ops;
    DELETE FROM sandboxes;
  `)
}

test('read-only sandbox blocks mutating operations and returns managed lifecycle reason', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'readonly-user' }
  const created = await sandboxManager.createBox(identity, {
    name: 'Readonly Simulation',
    durability: 'persistent',
    autoRemove: false,
  })

  sandboxStore.updateSandbox(created.boxId, {
    readOnly: true,
    readOnlyReason: 'managed_by_agent_lifecycle',
  })

  const readonlyBox = await sandboxManager.getBox(identity, created.boxId)
  assert.ok(readonlyBox)
  assert.equal(readonlyBox?._dune.readOnly, true)
  assert.equal(readonlyBox?._dune.readOnlyReason, 'managed_by_agent_lifecycle')

  await assert.rejects(
    () => sandboxManager.patchBox(identity, created.boxId, { name: 'Should fail' }),
    /managed_by_agent_lifecycle/,
  )

  const stopRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/stop`, {
    method: 'POST',
    headers: {
      'X-Actor-Type': 'human',
      'X-Actor-Id': identity.actorId,
    },
  })

  assert.equal(stopRes.status, 403)
  const body = await stopRes.json() as { error: string; reason?: string }
  assert.equal(body.error, 'managed_by_agent_lifecycle')
  assert.equal(body.reason, 'managed_by_agent_lifecycle')
})
