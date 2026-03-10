import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-acl')

const { getDb } = await import('../src/storage/database.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')

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

test('ACL defaults to creator and supports explicit agent sharing', async () => {
  clearSandboxTables()

  const owner = { actorType: 'human' as const, actorId: 'human-owner' }
  const sharedAgent = { actorType: 'agent' as const, actorId: 'agent-shared' }
  const blockedAgent = { actorType: 'agent' as const, actorId: 'agent-blocked' }

  const created = await sandboxManager.createBox(owner, {
    name: 'ACL Sandbox',
    image: 'alpine:latest',
    durability: 'persistent',
    autoRemove: false,
  })

  const ownerView = await sandboxManager.listBoxes(owner)
  assert.ok(ownerView.boxes.some((box) => box.boxId === created.boxId))

  const blockedBefore = await sandboxManager.listBoxes(blockedAgent)
  assert.ok(!blockedBefore.boxes.some((box) => box.boxId === created.boxId))

  await sandboxManager.patchBox(owner, created.boxId, {
    acl: [
      { principalType: 'agent', principalId: sharedAgent.actorId, permission: 'read' },
      { principalType: 'agent', principalId: sharedAgent.actorId, permission: 'operate' },
    ],
  })

  const sharedView = await sandboxManager.listBoxes(sharedAgent)
  assert.ok(sharedView.boxes.some((box) => box.boxId === created.boxId))

  const patchedByShared = await sandboxManager.patchBox(sharedAgent, created.boxId, {
    name: 'Patched by shared agent',
  })
  assert.equal(patchedByShared?.name, 'Patched by shared agent')

  await assert.rejects(
    () => sandboxManager.patchBox(blockedAgent, created.boxId, { name: 'Should fail' }),
    /forbidden/,
  )
})
