import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), 'dune-sandbox-fs-browser')

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

type FakeNode = {
  type: 'file' | 'directory' | 'symlink'
  content: Buffer
  modifiedAt: number
}

class FakeRuntimeBox {
  private readonly nodes = new Map<string, FakeNode>()

  constructor(
    private readonly sandboxId: string,
    private readonly bashAvailable = true,
    private readonly shAvailable = true,
  ) {
    this.setDir('/')
    this.setDir('/workspace')
  }

  async getId(): Promise<string> {
    return this.sandboxId
  }

  async stop(): Promise<void> {
    // no-op for tests
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

  private setDir(path: string): void {
    const normalized = this.normalize(path)
    const now = Date.now()
    this.nodes.set(normalized, {
      type: 'directory',
      content: Buffer.alloc(0),
      modifiedAt: now,
    })
    const parent = this.parent(normalized)
    if (parent && this.nodes.has(parent)) {
      const parentNode = this.nodes.get(parent)!
      parentNode.modifiedAt = now
    }
  }

  private setFile(path: string, content: Buffer): void {
    const normalized = this.normalize(path)
    const parent = this.parent(normalized)
    if (!parent || !this.nodes.has(parent) || this.nodes.get(parent)?.type !== 'directory') {
      throw new Error('No such file or directory')
    }
    const now = Date.now()
    this.nodes.set(normalized, {
      type: 'file',
      content,
      modifiedAt: now,
    })
    const parentNode = this.nodes.get(parent)!
    parentNode.modifiedAt = now
  }

  private ensureDir(path: string, recursive: boolean): void {
    const normalized = this.normalize(path)
    if (this.nodes.has(normalized)) return

    const parent = this.parent(normalized)
    if (!parent) return

    if (!recursive) {
      if (!this.nodes.has(parent) || this.nodes.get(parent)?.type !== 'directory') {
        throw new Error('No such file or directory')
      }
      this.setDir(normalized)
      return
    }

    const parts = normalized.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      if (!this.nodes.has(current)) this.setDir(current)
    }
  }

  private removePath(path: string): void {
    const normalized = this.normalize(path)
    for (const key of Array.from(this.nodes.keys())) {
      if (key === normalized || key.startsWith(`${normalized}/`)) {
        this.nodes.delete(key)
      }
    }
  }

  private listChildren(path: string): Array<{ path: string; name: string; node: FakeNode }> {
    const normalized = this.normalize(path)
    const children: Array<{ path: string; name: string; node: FakeNode }> = []
    for (const [childPath, node] of this.nodes.entries()) {
      if (childPath === normalized) continue
      if (this.parent(childPath) !== normalized) continue
      children.push({ path: childPath, name: childPath.split('/').pop() || childPath, node })
    }
    children.sort((a, b) => a.name.localeCompare(b.name))
    return children
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
      try {
        return this.execScript(script)
      } catch (err: any) {
        if (typeof err?.exitCode === 'number') {
          return { exitCode: err.exitCode, stdout: '', stderr: err.message || '' }
        }
        throw err
      }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }

  private fail(exitCode: number, message: string): never {
    const err = new Error(message) as Error & { exitCode: number }
    err.exitCode = exitCode
    throw err
  }

  private execScript(script: string): { exitCode: number; stdout: string; stderr: string } {
    const uploadMatch = script.match(/printf '%s' '([^']*)' \| base64 -d > '([^']+)'/)
    if (uploadMatch) {
      const mkdirMatch = script.match(/mkdir -p '([^']+)'/)
      if (mkdirMatch) this.ensureDir(mkdirMatch[1], true)
      const targetPath = this.normalize(uploadMatch[2])
      const existsCheck = script.match(/if \[ -e '([^']+)'\ ]; then exit 17; fi/)
      if (existsCheck && this.nodes.has(this.normalize(existsCheck[1]))) {
        return { exitCode: 17, stdout: '', stderr: 'exists' }
      }
      this.setFile(targetPath, Buffer.from(uploadMatch[1], 'base64'))
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const downloadMatch = script.match(/\[ -f '([^']+)' \] && base64 < '([^']+)'/)
    if (downloadMatch) {
      const path = this.normalize(downloadMatch[2])
      const node = this.nodes.get(path)
      if (!node || node.type !== 'file') {
        return { exitCode: 1, stdout: '', stderr: 'not found' }
      }
      return { exitCode: 0, stdout: node.content.toString('base64'), stderr: '' }
    }

    if (script.includes("__TRUNCATED__")) {
      if (/for\s+entry\s+in\s+[^\n]*;\s*do;/.test(script)) {
        return { exitCode: 2, stdout: '', stderr: "syntax error near unexpected token `;'" }
      }
      const pathMatch = script.match(/for entry in '([^']+)'\/\*/)
      const includeHiddenMatch = script.match(/if \[ "([01])" != "1" \]/)
      const limitMatch = script.match(/-ge "(\d+)"/)
      const dirPath = this.normalize(pathMatch?.[1] || '/')
      const includeHidden = (includeHiddenMatch?.[1] || '0') === '1'
      const limit = Number(limitMatch?.[1] || '1000')
      const dirNode = this.nodes.get(dirPath)
      if (!dirNode) return { exitCode: 44, stdout: '', stderr: 'not found' }
      if (dirNode.type !== 'directory') return { exitCode: 45, stdout: '', stderr: 'not directory' }

      const rows = this.listChildren(dirPath)
        .filter((row) => includeHidden || !row.name.startsWith('.'))

      const truncated = rows.length > limit
      const selected = rows.slice(0, limit)
      const lines = selected.map((row) => {
        const type = row.node.type
        const size = type === 'file' ? String(row.node.content.length) : ''
        const modified = String(Math.floor(row.node.modifiedAt / 1000))
        return `${row.name}\t${type}\t${size}\t${modified}`
      })
      lines.push(`__TRUNCATED__\t${truncated ? 1 : 0}`)
      return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
    }

    if (script.includes("__SIZE__")) {
      const pathMatch = script.match(/if \[ ! -e '([^']+)'\ ]/)
      const maxBytesMatch = script.match(/head -c (\d+) /)
      const filePath = this.normalize(pathMatch?.[1] || '/')
      const maxBytes = Number(maxBytesMatch?.[1] || '1048576')
      const node = this.nodes.get(filePath)
      if (!node) return { exitCode: 44, stdout: '', stderr: 'not found' }
      if (node.type === 'directory') return { exitCode: 45, stdout: '', stderr: 'not file' }
      if (node.type !== 'file') return { exitCode: 46, stdout: '', stderr: 'not file' }
      const chunk = node.content.subarray(0, maxBytes).toString('base64')
      return {
        exitCode: 0,
        stdout: `__SIZE__\t${node.content.length}\n${chunk}\n`,
        stderr: '',
      }
    }

    const mkdirMatch = script.match(/mkdir( -p)? '([^']+)'/)
    if (mkdirMatch && script.includes("if [ -e")) {
      const checkMatch = script.match(/if \[ -e '([^']+)'\ ]/)
      const path = this.normalize(checkMatch?.[1] || mkdirMatch[2])
      if (this.nodes.has(path)) return { exitCode: 17, stdout: '', stderr: 'exists' }
      const recursive = !!mkdirMatch[1]
      try {
        this.ensureDir(path, recursive)
      } catch (err: any) {
        this.fail(1, err?.message || 'mkdir failed')
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const moveMatch = script.match(/mv '([^']+)' '([^']+)'/)
    if (moveMatch) {
      const fromPath = this.normalize(moveMatch[1])
      const toPath = this.normalize(moveMatch[2])
      const fromNode = this.nodes.get(fromPath)
      if (!fromNode) return { exitCode: 44, stdout: '', stderr: 'not found' }
      const parentCheck = script.match(/if \[ ! -d '([^']+)'\ ]; then exit 47; fi/)
      if (parentCheck) {
        const parentPath = this.normalize(parentCheck[1])
        const parentNode = this.nodes.get(parentPath)
        if (!parentNode || parentNode.type !== 'directory') return { exitCode: 47, stdout: '', stderr: 'invalid path' }
      }

      if (script.includes(`if [ -e '${toPath}' ]; then exit 17; fi`) && this.nodes.has(toPath)) {
        return { exitCode: 17, stdout: '', stderr: 'exists' }
      }
      const overwriteMatch = script.match(/rm -rf '([^']+)';/)
      if (overwriteMatch) this.removePath(overwriteMatch[1])

      const moves = Array.from(this.nodes.entries())
        .filter(([key]) => key === fromPath || key.startsWith(`${fromPath}/`))
        .sort(([a], [b]) => a.length - b.length)

      for (const [oldPath, node] of moves) {
        const suffix = oldPath.slice(fromPath.length)
        const newPath = this.normalize(`${toPath}${suffix}`)
        this.nodes.delete(oldPath)
        this.nodes.set(newPath, {
          ...node,
          modifiedAt: Date.now(),
        })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    if (script.includes('rmdir ') || script.includes('rm -rf ') || script.includes('rm -f ')) {
      const pathCheck = script.match(/if \[ ! -e '([^']+)'\ ]/)
      const targetPath = this.normalize(pathCheck?.[1] || '/')
      const node = this.nodes.get(targetPath)
      if (!node) return { exitCode: 44, stdout: '', stderr: 'not found' }

      if (script.includes(`rm -rf '${targetPath}'`)) {
        this.removePath(targetPath)
        return { exitCode: 0, stdout: '', stderr: '' }
      }

      if (node.type === 'directory') {
        const children = this.listChildren(targetPath)
        if (children.length > 0) return { exitCode: 1, stdout: '', stderr: 'Directory not empty' }
        this.nodes.delete(targetPath)
      } else {
        this.nodes.delete(targetPath)
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function setupManagedRuntime(fakeBox: FakeRuntimeBox) {
  const agent = agentStore.createAgent({
    name: 'FS Browser Runtime',
    personality: 'managed runtime for fs browser tests',
  })

  const sandboxId = `runtime-${agent.id}`
  runtimeStore.upsertAgentRuntimeState({
    agentId: agent.id,
    sandboxName: `agent-runtime-${agent.id}`,
    sandboxId,
    guiHttpPort: 48501,
    guiHttpsPort: 48502,
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
    box: fakeBox as any,
    agent,
    sandboxId,
    guiHttpPort: 48501,
    guiHttpsPort: 48502,
    backendUrl: '',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any)

  return { agent, sandboxId }
}

test('sandbox fs browser supports list/read/mkdir/move/delete flow', async () => {
  clearTables()

  const fakeBox = new FakeRuntimeBox('runtime-seed')
  const { agent, sandboxId } = setupManagedRuntime(fakeBox)
  const system = { actorType: 'system' as const, actorId: 'agent:operator' }

  try {
    await sandboxManager.uploadFileContent(
      system,
      sandboxId,
      '/workspace/readme.txt',
      Buffer.from('hello world', 'utf-8').toString('base64'),
      true,
    )
    await sandboxManager.uploadFileContent(
      system,
      sandboxId,
      '/workspace/.env',
      Buffer.from('SECRET=1', 'utf-8').toString('base64'),
      true,
    )
    await sandboxManager.mkdirFsPath(system, sandboxId, { path: '/workspace/folder', recursive: true })

    const visibleOnly = await sandboxManager.listFsEntries(system, sandboxId, '/workspace', {
      includeHidden: false,
      limit: 100,
    })
    assert.ok(visibleOnly)
    assert.ok((visibleOnly?.entries || []).some((entry) => entry.name === 'folder' && entry.type === 'directory'))
    assert.ok(!(visibleOnly?.entries || []).some((entry) => entry.name === '.env'))

    const withHidden = await sandboxManager.listFsEntries(system, sandboxId, '/workspace', {
      includeHidden: true,
      limit: 100,
    })
    assert.ok(withHidden?.entries.some((entry) => entry.name === '.env' && entry.hidden))

    const limited = await sandboxManager.listFsEntries(system, sandboxId, '/workspace', {
      includeHidden: true,
      limit: 1,
    })
    assert.equal(limited?.truncated, true)

    const preview = await sandboxManager.readFsFileContent(system, sandboxId, '/workspace/readme.txt', 5)
    assert.ok(preview)
    assert.equal(preview?.size, 11)
    assert.equal(preview?.truncated, true)
    assert.equal(Buffer.from(preview?.contentBase64 || '', 'base64').toString('utf-8'), 'hello')
    assert.equal(preview?.mimeType, 'text/plain')

    await sandboxManager.moveFsPath(system, sandboxId, {
      fromPath: '/workspace/readme.txt',
      toPath: '/workspace/folder/readme.txt',
      overwrite: false,
    })

    await assert.rejects(
      () => sandboxManager.deleteFsPath(system, sandboxId, '/workspace/folder', false),
      /dir_not_empty/,
    )

    await sandboxManager.deleteFsPath(system, sandboxId, '/workspace/folder/readme.txt', false)
    await sandboxManager.deleteFsPath(system, sandboxId, '/workspace/folder', false)

    const postDelete = await sandboxManager.listFsEntries(system, sandboxId, '/workspace', {
      includeHidden: true,
      limit: 100,
    })
    assert.ok(!postDelete?.entries.some((entry) => entry.name === 'folder'))
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
  }
})

test('sandbox fs browser enforces readonly/forbidden/not-running constraints', async () => {
  clearTables()

  const owner = { actorType: 'human' as const, actorId: 'owner-fs-user' }
  const other = { actorType: 'agent' as const, actorId: 'other-fs-agent' }

  const readonlyBox = await sandboxManager.createBox(owner, {
    name: 'readonly-fs-box',
    durability: 'persistent',
    autoRemove: false,
  })
  sandboxStore.updateSandbox(readonlyBox.boxId, {
    readOnly: true,
    readOnlyReason: 'managed_by_agent_lifecycle',
  })

  await assert.rejects(
    () => sandboxManager.mkdirFsPath(owner, readonlyBox.boxId, { path: '/workspace/new-dir', recursive: true }),
    /managed_by_agent_lifecycle/,
  )

  const ownerBox = await sandboxManager.createBox(owner, {
    name: 'owner-box',
    durability: 'persistent',
    autoRemove: false,
  })

  await assert.rejects(
    () => sandboxManager.mkdirFsPath(other, ownerBox.boxId, { path: '/workspace/new-dir', recursive: true }),
    /forbidden/,
  )

  await assert.rejects(
    () => sandboxManager.listFsEntries(owner, ownerBox.boxId, '/workspace'),
    /box_not_running/,
  )
})

test('sandbox fs browser returns deterministic no_compatible_shell error when shells are unavailable', async () => {
  clearTables()

  const fakeBox = new FakeRuntimeBox('runtime-no-shell', false, false)
  const { agent, sandboxId } = setupManagedRuntime(fakeBox)
  const system = { actorType: 'system' as const, actorId: 'agent:operator' }

  try {
    await assert.rejects(
      () => sandboxManager.listFsEntries(system, sandboxId, '/workspace'),
      /no_compatible_shell/,
    )
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)
  }
})
