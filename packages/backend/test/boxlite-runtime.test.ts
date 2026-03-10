import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

const runtimeInit = await import('../src/boxlite/runtime.js')

test('boxlite init keeps absolute runtime home as-is', () => {
  const runtimeHome = '/tmp/dune-boxlite'
  assert.equal(
    runtimeInit.__resolveBoxliteHomeForInitForTests(runtimeHome),
    runtimeHome,
  )
})

test('boxlite init temporarily overrides BOXLITE_HOME without changing cwd', () => {
  const previousHome = process.env.BOXLITE_HOME
  const previousCwd = process.cwd()
  let seenCwd = ''
  let seenHome = ''

  try {
    process.env.BOXLITE_HOME = 'outer-home'
    const runtimeHome = join(process.cwd(), 'data', 'b')

    runtimeInit.__withBoxliteInitContextForTests(() => {
      seenCwd = process.cwd()
      seenHome = process.env.BOXLITE_HOME || ''
    }, runtimeHome)

    assert.equal(seenCwd, previousCwd)
    assert.equal(seenHome, runtimeHome)
    assert.equal(process.cwd(), previousCwd)
    assert.equal(process.env.BOXLITE_HOME, 'outer-home')
  } finally {
    if (previousHome === undefined) {
      delete process.env.BOXLITE_HOME
    } else {
      process.env.BOXLITE_HOME = previousHome
    }
  }
})
