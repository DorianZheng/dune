import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-exec-events')

const { getDb } = await import('../src/storage/database.js')
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

test('exec records and ordered event stream persist correctly', () => {
  clearSandboxTables()

  const sandbox = sandboxStore.createSandbox(
    {
      name: 'Exec Sandbox',
      image: 'alpine:latest',
      durability: 'persistent',
      autoRemove: false,
    },
    'human',
    'exec-user',
  )

  const exec = sandboxStore.createExec(sandbox.id, {
    command: 'echo',
    args: ['hello'],
  })

  const evt1 = sandboxStore.appendExecEvent(sandbox.id, exec.executionId, 'stdout', 'hello')
  const evt2 = sandboxStore.appendExecEvent(sandbox.id, exec.executionId, 'stderr', 'warning')
  const evt3 = sandboxStore.appendExecEvent(sandbox.id, exec.executionId, 'exit', '{"exitCode":0}')

  assert.equal(evt1.seq, 1)
  assert.equal(evt2.seq, 2)
  assert.equal(evt3.seq, 3)

  const allEvents = sandboxStore.listExecEvents(exec.executionId, 0, 50)
  assert.equal(allEvents.length, 3)
  assert.deepEqual(allEvents.map((event) => event.seq), [1, 2, 3])

  const afterFirst = sandboxStore.listExecEvents(exec.executionId, 1, 50)
  assert.equal(afterFirst.length, 2)
  assert.deepEqual(afterFirst.map((event) => event.seq), [2, 3])

  const updated = sandboxStore.updateExec(sandbox.id, exec.executionId, {
    status: 'completed',
    exitCode: 0,
    completedAt: Date.now(),
    durationMs: 123,
    stdout: 'hello\n',
    stderr: '',
    errorMessage: null,
  })

  assert.equal(updated?.status, 'completed')
  assert.equal(updated?.exitCode, 0)

  const listed = sandboxStore.listExecs(sandbox.id)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].executionId, exec.executionId)
})
