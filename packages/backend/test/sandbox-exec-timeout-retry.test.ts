import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-exec-timeout-retry')
process.env.SANDBOX_EXEC_TIMEOUT_MS = '80'
process.env.SANDBOX_EXEC_MAX_RETRIES = '1'

const { getDb } = await import('../src/storage/database.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')
const runtimeStore = await import('../src/storage/agent-runtime-store.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')
const { app } = await import('../src/server.js')

const db = getDb()
const hostFixtureRoot = join(process.env.DATA_DIR!, 'sandbox-exec-timeout-tests')
const systemIdentity = { actorType: 'system' as const, actorId: 'agent:timeout-tests' }

let nextPort = 49000

function allocatePorts(): { guiHttpPort: number; guiHttpsPort: number } {
  nextPort += 2
  return {
    guiHttpPort: nextPort,
    guiHttpsPort: nextPort + 1,
  }
}

function clearTables() {
  db.exec(`
    DELETE FROM sandbox_exec_events;
    DELETE FROM sandbox_execs;
    DELETE FROM sandbox_acl;
    DELETE FROM sandbox_file_ops;
    DELETE FROM sandboxes;
    DELETE FROM agent_runtime_state;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agents;
  `)
}

function createHostFixture(fileName: string, content: string): string {
  mkdirSync(hostFixtureRoot, { recursive: true })
  const path = join(hostFixtureRoot, fileName)
  writeFileSync(path, content, 'utf-8')
  return path
}

class ControlledRuntimeBox {
  private readonly files = new Map<string, Buffer>()
  private readonly directories = new Set<string>(['/', '/workspace', '/tmp'])
  private hangWrites = false
  private transientWriteFailuresRemaining = 0

  constructor(private readonly sandboxId: string) {}

  setHangWrites(value: boolean): void {
    this.hangWrites = value
  }

  setTransientWriteFailures(value: number): void {
    this.transientWriteFailuresRemaining = Math.max(0, Math.floor(value))
  }

  async getId(): Promise<string> {
    return this.sandboxId
  }

  async stop(): Promise<void> {
    // no-op for tests
  }

  async exec(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (cmd === 'echo') {
      return { exitCode: 0, stdout: `${args.join(' ')}\n`, stderr: '' }
    }

    const isShellCommand =
      (cmd === 'bash' && args[0] === '-lc')
      || (cmd === '/bin/sh' && args[0] === '-c')
      || (cmd === 'sh' && args[0] === '-c')

    if (!isShellCommand) {
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const script = args[1] || ''
    const writesFile = script.includes('base64 -d >')
    if (writesFile && this.hangWrites) {
      return await new Promise(() => {})
    }
    if (writesFile && this.transientWriteFailuresRemaining > 0) {
      this.transientWriteFailuresRemaining -= 1
      throw new Error('transport error: notify socket unavailable')
    }

    const uploadMatch = script.match(/printf '%s' '([^']*)' \| base64 -d > '([^']+)'/)
    if (uploadMatch) {
      const content = Buffer.from(uploadMatch[1], 'base64')
      const path = this.normalize(uploadMatch[2])
      const parent = this.parent(path)
      if (parent) this.directories.add(parent)
      this.files.set(path, content)
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const downloadMatch = script.match(/\[ -f '([^']+)' \] && base64 < '([^']+)'/)
    if (downloadMatch) {
      const path = this.normalize(downloadMatch[2])
      const content = this.files.get(path)
      if (!content) return { exitCode: 1, stdout: '', stderr: 'not found' }
      return { exitCode: 0, stdout: content.toString('base64'), stderr: '' }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }

  private normalize(path: string): string {
    let output = path.replace(/\/+/g, '/')
    if (!output.startsWith('/')) output = `/${output}`
    if (output.length > 1 && output.endsWith('/')) output = output.slice(0, -1)
    return output
  }

  private parent(path: string): string | null {
    const normalized = this.normalize(path)
    if (normalized === '/') return null
    const idx = normalized.lastIndexOf('/')
    if (idx <= 0) return '/'
    return normalized.slice(0, idx)
  }
}

function registerManagedRuntime(box: ControlledRuntimeBox): { agentId: string; sandboxId: string; teardown: () => void } {
  const agent = agentStore.createAgent({
    name: `Sandbox timeout test ${Date.now()}`,
    personality: 'sandbox timeout test',
  })
  const sandboxId = `runtime-${agent.id}`
  const { guiHttpPort, guiHttpsPort } = allocatePorts()

  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort,
    guiHttpsPort,
  })

  sandboxStore.upsertManagedRuntimeSandbox({
    sandboxId,
    agentId: agent.id,
    name: `${agent.name} runtime`,
    status: 'running',
    startedAt: Date.now(),
    stoppedAt: null,
    boxliteBoxId: sandboxId,
  })

  agentManager.__setRunningAgentForTests(agent.id, {
    box: box as any,
    agent,
    sandboxId,
    guiHttpPort,
    guiHttpsPort,
    backendUrl: '',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any)

  return {
    agentId: agent.id,
    sandboxId,
    teardown: () => {
      agentManager.__setRunningAgentForTests(agent.id, null)
    },
  }
}

test('importHostPath fails with box_exec_timeout and lock is released for next file op', async () => {
  clearTables()
  const box = new ControlledRuntimeBox('runtime-timeout-lock')
  const { sandboxId, teardown } = registerManagedRuntime(box)
  const hostPath = createHostFixture('timeout-lock-host.txt', 'host-file-content')

  try {
    box.setHangWrites(true)
    const startedAt = Date.now()
    await assert.rejects(
      () => sandboxManager.importHostPath(systemIdentity, sandboxId, {
        hostPath,
        destPath: '/workspace/imported-timeout.txt',
      }),
      /box_exec_timeout/,
    )
    assert.ok(Date.now() - startedAt < 2_000)

    box.setHangWrites(false)
    await sandboxManager.uploadFileContent(
      systemIdentity,
      sandboxId,
      '/workspace/recovered-after-timeout.txt',
      Buffer.from('recovered', 'utf-8').toString('base64'),
      true,
    )

    const downloaded = await sandboxManager.downloadFileContent(
      systemIdentity,
      sandboxId,
      '/workspace/recovered-after-timeout.txt',
    )
    assert.ok(downloaded)
    assert.equal(Buffer.from(downloaded!.contentBase64, 'base64').toString('utf-8'), 'recovered')
  } finally {
    teardown()
    rmSync(hostPath, { force: true })
  }
})

test('uploadFileContent retries transient exec errors and eventually succeeds', async () => {
  clearTables()
  const box = new ControlledRuntimeBox('runtime-retry-success')
  const { sandboxId, teardown } = registerManagedRuntime(box)

  try {
    box.setTransientWriteFailures(1)
    await sandboxManager.uploadFileContent(
      systemIdentity,
      sandboxId,
      '/workspace/retry-success.txt',
      Buffer.from('retry-ok', 'utf-8').toString('base64'),
      true,
    )

    const downloaded = await sandboxManager.downloadFileContent(
      systemIdentity,
      sandboxId,
      '/workspace/retry-success.txt',
    )
    assert.ok(downloaded)
    assert.equal(Buffer.from(downloaded!.contentBase64, 'base64').toString('utf-8'), 'retry-ok')
  } finally {
    teardown()
  }
})

test('POST /api/sandboxes/v1/boxes/:boxId/import-host-path returns 504 for box_exec_timeout', async () => {
  clearTables()
  const box = new ControlledRuntimeBox('runtime-api-timeout')
  const { sandboxId, teardown } = registerManagedRuntime(box)
  const hostPath = createHostFixture('api-timeout-host.txt', 'host-file-content')

  try {
    box.setHangWrites(true)

    const res = await app.request(`/api/sandboxes/v1/boxes/${sandboxId}/import-host-path`, {
      method: 'POST',
      headers: {
        'X-Actor-Type': 'system',
        'X-Actor-Id': 'agent:api-timeout-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostPath,
        destPath: '/workspace/imported-via-api.txt',
      }),
    })

    assert.equal(res.status, 504)
    const body = await res.json() as { error: string }
    assert.equal(body.error, 'box_exec_timeout')
  } finally {
    teardown()
    rmSync(hostPath, { force: true })
  }
})
