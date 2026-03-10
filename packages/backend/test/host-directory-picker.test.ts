import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HostDirectoryPickerError,
  pickHostDirectory,
  type HostDirectoryPickerCommandResult,
  type HostDirectoryPickerRunner,
} from '../src/utils/host-directory-picker.js'

function makeRunner(
  handler: (command: string, args: string[]) => HostDirectoryPickerCommandResult | Promise<HostDirectoryPickerCommandResult>,
): HostDirectoryPickerRunner {
  return async (command, args) => handler(command, args)
}

test('pickHostDirectory uses osascript and returns selected path on macOS', async () => {
  const calls: Array<{ command: string; args: string[] }> = []
  const runner = makeRunner((command, args) => {
    calls.push({ command, args })
    return {
      exitCode: 0,
      stdout: '/Users/dev/Projects/demo/\n',
      stderr: '',
      spawnError: null,
    }
  })
  const result = await pickHostDirectory({ platform: 'darwin', runCommand: runner })
  assert.deepEqual(result, { status: 'selected', hostPath: '/Users/dev/Projects/demo' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.command, 'osascript')
})

test('pickHostDirectory returns cancelled when picker exits with cancel status', async () => {
  const result = await pickHostDirectory({
    platform: 'darwin',
    runCommand: makeRunner(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'User canceled.',
      spawnError: null,
    })),
  })
  assert.deepEqual(result, { status: 'cancelled' })
})

test('pickHostDirectory falls back from zenity to kdialog on Linux', async () => {
  const calls: string[] = []
  const result = await pickHostDirectory({
    platform: 'linux',
    runCommand: makeRunner((command) => {
      calls.push(command)
      if (command === 'zenity') {
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          spawnError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
        }
      }
      return {
        exitCode: 0,
        stdout: '/home/dev/work\n',
        stderr: '',
        spawnError: null,
      }
    }),
  })
  assert.deepEqual(result, { status: 'selected', hostPath: '/home/dev/work' })
  assert.deepEqual(calls, ['zenity', 'kdialog'])
})

test('pickHostDirectory returns unavailable when all Linux pickers are missing', async () => {
  await assert.rejects(
    () => pickHostDirectory({
      platform: 'linux',
      runCommand: makeRunner(() => ({
        exitCode: null,
        stdout: '',
        stderr: '',
        spawnError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
      })),
    }),
    (error: unknown) => error instanceof HostDirectoryPickerError && error.code === 'picker_unavailable',
  )
})

test('pickHostDirectory supports Windows cancel flow', async () => {
  const result = await pickHostDirectory({
    platform: 'win32',
    runCommand: makeRunner((command) => {
      if (command === 'powershell') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '',
          spawnError: null,
        }
      }
      return {
        exitCode: 0,
        stdout: 'C:\\fallback\n',
        stderr: '',
        spawnError: null,
      }
    }),
  })
  assert.deepEqual(result, { status: 'cancelled' })
})

test('pickHostDirectory returns failed when picker returns non-absolute output', async () => {
  await assert.rejects(
    () => pickHostDirectory({
      platform: 'darwin',
      runCommand: makeRunner(() => ({
        exitCode: 0,
        stdout: 'relative/path\n',
        stderr: '',
        spawnError: null,
      })),
    }),
    (error: unknown) => error instanceof HostDirectoryPickerError && error.code === 'picker_failed',
  )
})

test('pickHostDirectory returns unavailable on unsupported platform', async () => {
  await assert.rejects(
    () => pickHostDirectory({
      platform: 'freebsd',
      runCommand: makeRunner(() => ({
        exitCode: 0,
        stdout: '/tmp/ok\n',
        stderr: '',
        spawnError: null,
      })),
    }),
    (error: unknown) => error instanceof HostDirectoryPickerError && error.code === 'picker_unavailable',
  )
})
