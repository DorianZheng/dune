import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-contract')

const { getDb } = await import('../src/storage/database.js')
const { app } = await import('../src/server.js')

const db = getDb()

const actorHeaders = {
  'X-Actor-Type': 'human',
  'X-Actor-Id': 'contract-user',
}

function clearSandboxTables() {
  db.exec(`
    DELETE FROM sandbox_exec_events;
    DELETE FROM sandbox_execs;
    DELETE FROM sandbox_acl;
    DELETE FROM sandbox_file_ops;
    DELETE FROM sandboxes;
  `)
}

test('GET /api/sandboxes/v1/boxes requires actor headers', async () => {
  clearSandboxTables()

  const res = await app.request('/api/sandboxes/v1/boxes')
  assert.equal(res.status, 401)

  const body = await res.json() as { error: string }
  assert.equal(body.error, 'missing_actor_identity')
})

test('sandbox fs endpoints require actor headers', async () => {
  clearSandboxTables()

  const res = await app.request('/api/sandboxes/v1/boxes/box-missing/fs/list?path=%2Fworkspace')
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.equal(body.error, 'missing_actor_identity')
})

test('sandbox REST contract for core box endpoints', async () => {
  clearSandboxTables()

  const listRes = await app.request('/api/sandboxes/v1/boxes', { headers: actorHeaders })
  assert.equal(listRes.status, 200)
  const listBody = await listRes.json() as { boxes: unknown[]; nextPageToken: string | null }
  assert.ok(Array.isArray(listBody.boxes))
  assert.equal(listBody.nextPageToken, null)

  const createRes = await app.request('/api/sandboxes/v1/boxes', {
    method: 'POST',
    headers: {
      ...actorHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Contract Sandbox',
      image: 'alpine:latest',
      durability: 'persistent',
      autoRemove: false,
      ports: [{ guestPort: 3000, protocol: 'tcp' }],
    }),
  })

  assert.equal(createRes.status, 201)
  const created = await createRes.json() as {
    boxId: string
    name: string | null
    status: string
    _dune: { readOnly: boolean }
  }
  assert.ok(created.boxId)
  assert.equal(created.name, 'Contract Sandbox')
  assert.equal(created.status, 'configured')
  assert.equal(created._dune.readOnly, false)

  const getRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}`, {
    headers: actorHeaders,
  })
  assert.equal(getRes.status, 200)
  const fetched = await getRes.json() as { boxId: string }
  assert.equal(fetched.boxId, created.boxId)

  const statusRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/status`, {
    headers: actorHeaders,
  })
  assert.equal(statusRes.status, 200)
  const statusBody = await statusRes.json() as { boxId: string; status: string }
  assert.equal(statusBody.boxId, created.boxId)
  assert.equal(statusBody.status, 'configured')

  const execListRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/execs`, {
    headers: actorHeaders,
  })
  assert.equal(execListRes.status, 200)
  const execListBody = await execListRes.json() as { execs: unknown[] }
  assert.ok(Array.isArray(execListBody.execs))

  const patchRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}`, {
    method: 'PATCH',
    headers: {
      ...actorHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Contract Sandbox Updated' }),
  })
  assert.equal(patchRes.status, 200)
  const patched = await patchRes.json() as { name: string | null }
  assert.equal(patched.name, 'Contract Sandbox Updated')

  const filesRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/files`, {
    headers: actorHeaders,
  })
  assert.equal(filesRes.status, 400)

  const fsListRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/fs/list?path=${encodeURIComponent('/workspace')}`, {
    headers: actorHeaders,
  })
  assert.equal(fsListRes.status, 409)
  const fsListBody = await fsListRes.json() as { error: string }
  assert.equal(fsListBody.error, 'box_not_running')

  const fsReadRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/fs/read?path=${encodeURIComponent('/workspace/file.txt')}`, {
    headers: actorHeaders,
  })
  assert.equal(fsReadRes.status, 409)
  const fsReadBody = await fsReadRes.json() as { error: string }
  assert.equal(fsReadBody.error, 'box_not_running')

  const fsMkdirInvalidPathRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/fs/mkdir`, {
    method: 'POST',
    headers: {
      ...actorHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: 'workspace/not-absolute', recursive: true }),
  })
  assert.equal(fsMkdirInvalidPathRes.status, 400)
  const fsMkdirInvalidPathBody = await fsMkdirInvalidPathRes.json() as { error: string }
  assert.equal(fsMkdirInvalidPathBody.error, 'invalid_path')

  const fsDeleteRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}/fs?path=${encodeURIComponent('/workspace/ghost.txt')}&recursive=false`, {
    method: 'DELETE',
    headers: actorHeaders,
  })
  assert.equal(fsDeleteRes.status, 409)
  const fsDeleteBody = await fsDeleteRes.json() as { error: string }
  assert.equal(fsDeleteBody.error, 'box_not_running')

  const deleteRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}`, {
    method: 'DELETE',
    headers: actorHeaders,
  })
  assert.equal(deleteRes.status, 204)

  const afterDeleteRes = await app.request(`/api/sandboxes/v1/boxes/${created.boxId}`, {
    headers: actorHeaders,
  })
  assert.equal(afterDeleteRes.status, 404)
})
