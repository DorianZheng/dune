import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureBoxliteHome } from '../src/boxlite/home.js'

function makeDataRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dune-boxlite-home-'))
}

test('ensureBoxliteHome migrates legacy data/b into data/boxlite', () => {
  const dataRoot = makeDataRoot()

  try {
    const legacyHome = join(dataRoot, 'b')
    mkdirSync(legacyHome, { recursive: true })
    writeFileSync(join(legacyHome, 'state.json'), '{"ok":true}', 'utf-8')
    symlinkSync('b', join(dataRoot, 'boxlite'), 'dir')

    const boxliteHome = ensureBoxliteHome(dataRoot)

    // The returned path may be a short symlink if the real path is long
    const realHome = realpathSync(boxliteHome)
    assert.equal(realHome, realpathSync(join(dataRoot, 'boxlite')))
    assert.equal(existsSync(boxliteHome), true)
    assert.equal(readFileSync(join(boxliteHome, 'state.json'), 'utf-8'), '{"ok":true}')
    assert.equal(existsSync(legacyHome), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})

test('ensureBoxliteHome merges legacy data/b into an existing data/boxlite directory', () => {
  const dataRoot = makeDataRoot()

  try {
    const boxliteHome = join(dataRoot, 'boxlite')
    const legacyHome = join(dataRoot, 'b')
    mkdirSync(boxliteHome, { recursive: true })
    mkdirSync(legacyHome, { recursive: true })
    writeFileSync(join(boxliteHome, 'current.txt'), 'current', 'utf-8')
    writeFileSync(join(legacyHome, 'legacy.txt'), 'legacy', 'utf-8')

    const resolvedHome = ensureBoxliteHome(dataRoot)

    // The returned path may be a short symlink if the real path is long
    assert.equal(realpathSync(resolvedHome), realpathSync(boxliteHome))
    assert.equal(readFileSync(join(resolvedHome, 'current.txt'), 'utf-8'), 'current')
    assert.equal(readFileSync(join(resolvedHome, 'legacy.txt'), 'utf-8'), 'legacy')
    assert.equal(existsSync(legacyHome), false)
  } finally {
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
