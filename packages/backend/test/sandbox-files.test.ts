import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-files')

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

test('host import rejects host path outside allowed root', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'files-user' }
  const created = await sandboxManager.createBox(identity, {
    name: 'File Import Box',
    durability: 'persistent',
    autoRemove: false,
  })

  await assert.rejects(
    () => sandboxManager.importHostPath(identity, created.boxId, {
      hostPath: '/tmp',
      destPath: '/workspace',
    }),
    /within/,
  )
})

test('host import rejects container path traversal in destination', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'files-user-2' }
  const created = await sandboxManager.createBox(identity, {
    name: 'Traversal Box',
    durability: 'persistent',
    autoRemove: false,
  })

  const hostPath = resolve(process.cwd(), 'package.json')

  await assert.rejects(
    () => sandboxManager.importHostPath(identity, created.boxId, {
      hostPath,
      destPath: '/workspace/../unsafe',
    }),
    /path traversal is not allowed/,
  )
})

test('file operations on user-managed sandboxes require running state', async () => {
  clearSandboxTables()

  const identity = { actorType: 'human' as const, actorId: 'files-user-3' }
  const created = await sandboxManager.createBox(identity, {
    name: 'Not Running Box',
    durability: 'persistent',
    autoRemove: false,
  })

  await assert.rejects(
    () => sandboxManager.uploadFileContent(
      identity,
      created.boxId,
      '/workspace/not-running.txt',
      Buffer.from('x', 'utf-8').toString('base64'),
      true,
    ),
    /box_not_running/,
  )

  await assert.rejects(
    () => sandboxManager.downloadFileContent(identity, created.boxId, '/workspace/not-running.txt'),
    /box_not_running/,
  )

  const hostPath = resolve(process.cwd(), 'package.json')
  await assert.rejects(
    () => sandboxManager.importHostPath(identity, created.boxId, {
      hostPath,
      destPath: '/workspace/not-running-import.txt',
    }),
    /box_not_running/,
  )
})
