import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-managed-runtime-exec-files')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const runtimeStore = await import('../src/storage/agent-runtime-store.js')
const sandboxStore = await import('../src/storage/sandbox-store.js')
const sandboxManager = await import('../src/sandboxes/sandbox-manager.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

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

class FakeRuntimeBox {
  private readonly files = new Map<string, Buffer>()
  private readonly directories = new Set<string>(['/', '/workspace'])

  constructor(
    private readonly sandboxId: string,
    private readonly bashAvailable = true,
    private readonly shAvailable = true,
  ) {}

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

    if (cmd === 'bash' && !this.bashAvailable) {
      throw new Error("spawn_failed: executable 'bash' not found in $PATH")
    }
    if ((cmd === '/bin/sh' || cmd === 'sh') && !this.shAvailable) {
      throw new Error(`spawn_failed: executable '${cmd}' not found in $PATH`)
    }

    if (
      (cmd === 'bash' && args[0] === '-lc')
      || (cmd === '/bin/sh' && args[0] === '-c')
      || (cmd === 'sh' && args[0] === '-c')
    ) {
      const script = args[1] || ''

      const uploadMatch = script.match(/printf '%s' '([^']*)' \| base64 -d > '([^']+)'/)
      if (uploadMatch) {
        const content = Buffer.from(uploadMatch[1], 'base64')
        const path = this.normalize(uploadMatch[2])
        const dir = this.parent(path)
        if (dir) this.directories.add(dir)
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

      if (script.includes('__TRUNCATED__')) {
        const dirPathMatch = script.match(/for entry in '([^']+)'\/\*/)
        const includeHiddenMatch = script.match(/if \[ "([01])" != "1" \]/)
        const limitMatch = script.match(/-ge "(\d+)"/)
        const dirPath = this.normalize(dirPathMatch?.[1] || '/')
        const includeHidden = (includeHiddenMatch?.[1] || '0') === '1'
        const limit = Number(limitMatch?.[1] || '1000')

        if (!this.directories.has(dirPath)) {
          return { exitCode: 44, stdout: '', stderr: 'not found' }
        }

        const rows: Array<{ name: string; type: 'file' | 'directory'; size: string; modified: string }> = []
        const childDirs = Array.from(this.directories.values())
          .filter((entry) => this.parent(entry) === dirPath)
          .map((entry) => entry.split('/').pop() || entry)
        for (const name of childDirs) {
          rows.push({ name, type: 'directory', size: '', modified: String(Math.floor(Date.now() / 1000)) })
        }
        const childFiles = Array.from(this.files.entries())
          .filter(([entry]) => this.parent(entry) === dirPath)
          .map(([entry, content]) => ({ name: entry.split('/').pop() || entry, size: String(content.length) }))
        for (const file of childFiles) {
          rows.push({ name: file.name, type: 'file', size: file.size, modified: String(Math.floor(Date.now() / 1000)) })
        }

        rows.sort((a, b) => a.name.localeCompare(b.name))
        const visible = rows.filter((row) => includeHidden || !row.name.startsWith('.'))
        const truncated = visible.length > limit
        const output = visible.slice(0, limit).map((row) => `${row.name}\t${row.type}\t${row.size}\t${row.modified}`)
        output.push(`__TRUNCATED__\t${truncated ? 1 : 0}`)
        return { exitCode: 0, stdout: `${output.join('\n')}\n`, stderr: '' }
      }

      if (script.includes('__SIZE__')) {
        const pathMatch = script.match(/if \[ ! -e '([^']+)' \]/)
        const maxBytesMatch = script.match(/head -c (\d+) /)
        const path = this.normalize(pathMatch?.[1] || '/')
        const maxBytes = Number(maxBytesMatch?.[1] || '1048576')
        if (!this.files.has(path)) {
          if (this.directories.has(path)) return { exitCode: 45, stdout: '', stderr: 'not file' }
          return { exitCode: 44, stdout: '', stderr: 'not found' }
        }
        const content = this.files.get(path)!
        return {
          exitCode: 0,
          stdout: `__SIZE__\t${content.length}\n${content.subarray(0, maxBytes).toString('base64')}\n`,
          stderr: '',
        }
      }

      return { exitCode: 0, stdout: '', stderr: '' }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }

  private normalize(path: string): string {
    let out = path.replace(/\/+/g, '/')
    if (!out.startsWith('/')) out = `/${out}`
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
    return out
  }

  private parent(path: string): string | null {
    const normalized = this.normalize(path)
    if (normalized === '/') return null
    const idx = normalized.lastIndexOf('/')
    if (idx <= 0) return '/'
    return normalized.slice(0, idx)
  }
}

test('system actor can run exec/events/files/import on managed runtime sandboxes', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Managed Runtime IO',
    personality: 'runtime io access',
  })

  const sandboxId = `runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 48001,
    guiHttpsPort: 48002,
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

  const fakeBox = new FakeRuntimeBox(sandboxId)
  const system = { actorType: 'system' as const, actorId: 'agent:operator' }
  const hostImportDir = join(process.env.DATA_DIR!, 'sandbox-test-host-import')
  const hostImportPath = join(hostImportDir, 'sample.txt')

  mkdirSync(hostImportDir, { recursive: true })
  writeFileSync(hostImportPath, 'from-host-import', 'utf-8')

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId,
      guiHttpPort: 48001,
      guiHttpsPort: 48002,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    const created = await sandboxManager.createExec(system, sandboxId, {
      command: 'echo',
      args: ['hello-runtime'],
      env: {},
    })
    assert.ok(created)

    let resolvedExec = await sandboxManager.getExec(system, sandboxId, created!.executionId)
    const deadline = Date.now() + 2_000
    while (resolvedExec?.status === 'running' && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))
      resolvedExec = await sandboxManager.getExec(system, sandboxId, created!.executionId)
    }

    assert.ok(resolvedExec)
    assert.equal(resolvedExec?.status, 'completed')
    assert.match(resolvedExec?.stdout || '', /hello-runtime/)

    const list = await sandboxManager.listExecs(system, sandboxId)
    assert.ok(list)
    assert.ok((list?.execs || []).some((item) => item.executionId === created?.executionId))

    const events = await sandboxManager.getExecEvents(system, sandboxId, created!.executionId, 0, 50)
    assert.ok(events)
    assert.ok((events || []).some((event) => event.eventType === 'stdout'))
    assert.ok((events || []).some((event) => event.eventType === 'exit'))

    await sandboxManager.uploadFileContent(
      system,
      sandboxId,
      '/workspace/note.txt',
      Buffer.from('runtime-file-content', 'utf-8').toString('base64'),
      true,
    )

    const downloaded = await sandboxManager.downloadFileContent(system, sandboxId, '/workspace/note.txt')
    assert.ok(downloaded)
    assert.equal(Buffer.from(downloaded!.contentBase64, 'base64').toString('utf-8'), 'runtime-file-content')

    await sandboxManager.importHostPath(system, sandboxId, {
      hostPath: hostImportPath,
      destPath: '/workspace/imported.txt',
    })

    const imported = await sandboxManager.downloadFileContent(system, sandboxId, '/workspace/imported.txt')
    assert.ok(imported)
    assert.equal(Buffer.from(imported!.contentBase64, 'base64').toString('utf-8'), 'from-host-import')

    const fsList = await sandboxManager.listFsEntries(system, sandboxId, '/workspace', {
      includeHidden: false,
      limit: 200,
    })
    assert.ok(fsList)
    assert.ok(fsList?.entries.some((entry) => entry.path === '/workspace/note.txt'))
    assert.ok(fsList?.entries.some((entry) => entry.path === '/workspace/imported.txt'))

    const fsPreview = await sandboxManager.readFsFileContent(system, sandboxId, '/workspace/note.txt', 8)
    assert.ok(fsPreview)
    assert.equal(fsPreview?.truncated, true)
    assert.equal(Buffer.from(fsPreview?.contentBase64 || '', 'base64').toString('utf-8'), 'runtime-')
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
    rmSync(hostImportDir, { recursive: true, force: true })
  }
})

test('file operations fall back to /bin/sh when bash is unavailable', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Managed Runtime Shell Fallback',
    personality: 'runtime shell fallback access',
  })

  const sandboxId = `runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 48101,
    guiHttpsPort: 48102,
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

  const fakeBox = new FakeRuntimeBox(sandboxId, false)
  const system = { actorType: 'system' as const, actorId: 'agent:operator' }
  const hostImportDir = join(process.env.DATA_DIR!, 'sandbox-shell-fallback-host-import')
  const hostImportPath = join(hostImportDir, 'sample.txt')

  mkdirSync(hostImportDir, { recursive: true })
  writeFileSync(hostImportPath, 'fallback-host-import', 'utf-8')

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId,
      guiHttpPort: 48101,
      guiHttpsPort: 48102,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    await sandboxManager.uploadFileContent(
      system,
      sandboxId,
      '/workspace/fallback-note.txt',
      Buffer.from('fallback-content', 'utf-8').toString('base64'),
      true,
    )

    const downloaded = await sandboxManager.downloadFileContent(system, sandboxId, '/workspace/fallback-note.txt')
    assert.ok(downloaded)
    assert.equal(Buffer.from(downloaded!.contentBase64, 'base64').toString('utf-8'), 'fallback-content')

    await sandboxManager.importHostPath(system, sandboxId, {
      hostPath: hostImportPath,
      destPath: '/workspace/fallback-imported.txt',
    })

    const imported = await sandboxManager.downloadFileContent(system, sandboxId, '/workspace/fallback-imported.txt')
    assert.ok(imported)
    assert.equal(Buffer.from(imported!.contentBase64, 'base64').toString('utf-8'), 'fallback-host-import')
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
    rmSync(hostImportDir, { recursive: true, force: true })
  }
})

test('file operations return deterministic error when no shell is available', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Managed Runtime No Shell',
    personality: 'runtime no shell access',
  })

  const sandboxId = `runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 48201,
    guiHttpsPort: 48202,
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

  const fakeBox = new FakeRuntimeBox(sandboxId, false, false)
  const system = { actorType: 'system' as const, actorId: 'agent:operator' }

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId,
      guiHttpPort: 48201,
      guiHttpsPort: 48202,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    await assert.rejects(
      () => sandboxManager.uploadFileContent(
        system,
        sandboxId,
        '/workspace/no-shell.txt',
        Buffer.from('x', 'utf-8').toString('base64'),
        true,
      ),
      /no_compatible_shell/,
    )
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
  }
})
