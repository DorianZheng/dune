import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listMiniApps, normalizeMiniAppManifest } from '../src/storage/miniapp-store.js'

test('normalizeMiniAppManifest rejects unsafe entry paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'miniapp-store-'))
  mkdirSync(join(root, 'unsafe'), { recursive: true })
  writeFileSync(join(root, 'unsafe', 'app.json'), '{}', 'utf-8')

  const normalized = normalizeMiniAppManifest('agent-1', root, 'unsafe', {
    slug: 'unsafe',
    entry: '../etc/passwd',
  })

  assert.equal(normalized, null)
})

test('listMiniApps normalizes defaults and marks missing entry as error', () => {
  const root = mkdtempSync(join(tmpdir(), 'miniapp-store-'))

  mkdirSync(join(root, 'valid-app'), { recursive: true })
  writeFileSync(join(root, 'valid-app', 'app.json'), JSON.stringify({
    slug: 'valid-app',
    name: 'Valid App',
    collection: 'Published',
    status: 'published',
    entry: 'index.html',
    order: 5,
    tags: ['ops', 'ops', ' triage '],
  }), 'utf-8')
  writeFileSync(join(root, 'valid-app', 'index.html'), '<h1>ok</h1>', 'utf-8')

  mkdirSync(join(root, 'missing-entry'), { recursive: true })
  writeFileSync(join(root, 'missing-entry', 'app.json'), JSON.stringify({
    slug: 'missing-entry',
    name: 'Missing Entry',
    collection: 'Published',
    status: 'published',
    entry: 'index.html',
    order: 10,
  }), 'utf-8')

  const apps = listMiniApps('agent-1', { rootPath: root })
  assert.equal(apps.length, 2)

  const valid = apps.find(app => app.slug === 'valid-app')
  assert.ok(valid)
  assert.equal(valid!.openable, true)
  assert.deepEqual(valid!.tags, ['ops', 'triage'])

  const missing = apps.find(app => app.slug === 'missing-entry')
  assert.ok(missing)
  assert.equal(missing!.status, 'error')
  assert.equal(missing!.openable, false)
  assert.match(missing!.error || '', /Entry file not found/)
})

test('listMiniApps hides invalid manifests and sorts by collection/order/updatedAt', () => {
  const root = mkdtempSync(join(tmpdir(), 'miniapp-store-'))

  mkdirSync(join(root, 'a-app'), { recursive: true })
  writeFileSync(join(root, 'a-app', 'app.json'), JSON.stringify({
    slug: 'a-app',
    name: 'A',
    collection: 'A',
    entry: 'index.html',
    order: 2,
  }), 'utf-8')
  writeFileSync(join(root, 'a-app', 'index.html'), '<h1>A</h1>', 'utf-8')

  mkdirSync(join(root, 'a-app-2'), { recursive: true })
  writeFileSync(join(root, 'a-app-2', 'app.json'), JSON.stringify({
    slug: 'a-app-2',
    name: 'A2',
    collection: 'A',
    entry: 'index.html',
    order: 1,
  }), 'utf-8')
  writeFileSync(join(root, 'a-app-2', 'index.html'), '<h1>A2</h1>', 'utf-8')

  mkdirSync(join(root, 'invalid-manifest'), { recursive: true })
  writeFileSync(join(root, 'invalid-manifest', 'app.json'), '{not-json}', 'utf-8')

  const apps = listMiniApps('agent-1', { rootPath: root })
  assert.equal(apps.length, 2)
  assert.deepEqual(apps.map(app => app.slug), ['a-app-2', 'a-app'])
})
