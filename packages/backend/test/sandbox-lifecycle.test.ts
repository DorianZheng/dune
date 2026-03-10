import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-lifecycle')

const { getDb } = await import('../src/storage/database.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')

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

test('ephemeral stop removes sandbox while persistent stop preserves it', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'lifecycle-user' }

  const ephemeral = await sandboxManager.createBox(identity, {
    name: 'Ephemeral Box',
    durability: 'ephemeral',
    autoRemove: true,
  })

  const stoppedEphemeral = await sandboxManager.stopBox(identity, ephemeral.boxId)
  assert.equal(stoppedEphemeral.removed, true)
  assert.equal(stoppedEphemeral.box, null)
  assert.equal(sandboxStore.getSandbox(ephemeral.boxId), null)

  const persistent = await sandboxManager.createBox(identity, {
    name: 'Persistent Box',
    durability: 'persistent',
    autoRemove: false,
  })

  const stoppedPersistent = await sandboxManager.stopBox(identity, persistent.boxId)
  assert.equal(stoppedPersistent.removed, false)
  assert.equal(stoppedPersistent.box?.status, 'stopped')
  assert.ok(sandboxStore.getSandbox(persistent.boxId))
})

test('autoRemove defaults follow durability when omitted', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'lifecycle-default-user' }

  const persistent = await sandboxManager.createBox(identity, {
    name: 'Persistent Default Box',
    durability: 'persistent',
  })
  const storedPersistent = sandboxStore.getSandbox(persistent.boxId)
  assert.ok(storedPersistent)
  assert.equal(storedPersistent?.autoRemove, false)

  const stoppedPersistent = await sandboxManager.stopBox(identity, persistent.boxId)
  assert.equal(stoppedPersistent.removed, false)
  assert.ok(sandboxStore.getSandbox(persistent.boxId))

  const ephemeral = await sandboxManager.createBox(identity, {
    name: 'Ephemeral Default Box',
    durability: 'ephemeral',
  })
  const storedEphemeral = sandboxStore.getSandbox(ephemeral.boxId)
  assert.ok(storedEphemeral)
  assert.equal(storedEphemeral?.autoRemove, true)

  const stoppedEphemeral = await sandboxManager.stopBox(identity, ephemeral.boxId)
  assert.equal(stoppedEphemeral.removed, true)
  assert.equal(sandboxStore.getSandbox(ephemeral.boxId), null)
})

test('startup reconciliation marks non-terminal persistent runs stopped and drops ephemeral', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'reconcile-user' }

  const persistent = await sandboxManager.createBox(identity, {
    name: 'Persistent Running',
    durability: 'persistent',
    autoRemove: false,
  })
  sandboxStore.updateSandbox(persistent.boxId, { status: 'running' })

  const ephemeral = await sandboxManager.createBox(identity, {
    name: 'Ephemeral Running',
    durability: 'ephemeral',
    autoRemove: true,
  })
  sandboxStore.updateSandbox(ephemeral.boxId, { status: 'running' })

  await sandboxManager.reconcileSandboxesOnStartup()

  const persistentAfter = sandboxStore.getSandbox(persistent.boxId)
  assert.ok(persistentAfter)
  assert.equal(persistentAfter?.status, 'stopped')

  const ephemeralAfter = sandboxStore.getSandbox(ephemeral.boxId)
  assert.equal(ephemeralAfter, null)
})

test('host port is not persisted for configured boxes before runtime start', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'port-user' }

  const created = await sandboxManager.createBox(identity, {
    name: 'Port Sandbox',
    durability: 'persistent',
    autoRemove: false,
    ports: [{ guestPort: 3000, protocol: 'tcp' }],
  })

  const stored = sandboxStore.getSandbox(created.boxId)
  assert.ok(stored)
  assert.equal(stored?.ports.length, 1)
  assert.equal(stored?.ports[0].guestPort, 3000)
  assert.equal(stored?.ports[0].hostPort, undefined)
})

test('exec on user-managed stopped box requires running state', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'exec-user' }

  const created = await sandboxManager.createBox(identity, {
    name: 'Exec Requires Running',
    durability: 'persistent',
    autoRemove: false,
  })

  await assert.rejects(
    () => sandboxManager.createExec(identity, created.boxId, {
      command: 'echo',
      args: ['should-not-run'],
      env: {},
    }),
    /box_not_running/,
  )
})
