import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-runtime-host-layout-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM agent_logs;
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function resetAgentData() {
  rmSync(join(process.env.DATA_DIR!, 'agents'), { recursive: true, force: true })
}

function getAgentRoot(agentId: string): string {
  return join(process.env.DATA_DIR!, 'agents', agentId)
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

class FakeConfigFacadeBox {
  private readonly files = new Map<string, string>()
  private readonly directories = new Set<string>(['/', '/config'])
  private readonly symlinks = new Map<string, string>()

  async exec(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (cmd === 'python3' && args[0] === '-c' && args[1]?.includes('os.symlink')) {
      const duneRoot = this.normalize(args[2] || '/config/.dune')
      const duneMemory = this.normalize(args[3] || '/config/.dune/memory')
      const duneMiniapps = this.normalize(args[4] || '/config/.dune/miniapps')
      const duneClaude = this.normalize(args[5] || '/config/.dune/.claude')
      const duneState = this.normalize(args[6] || '/config/.dune/.claude.json')
      const memoryLink = this.normalize(args[7] || '/config/memory')
      const miniappsLink = this.normalize(args[8] || '/config/miniapps')
      const claudeLink = this.normalize(args[9] || '/config/.claude')
      const stateLink = this.normalize(args[10] || '/config/.claude.json')

      for (const path of [duneRoot, duneMemory, duneMiniapps, duneClaude, `${duneClaude}/skills`]) {
        this.ensureDirectory(path)
      }
      if (!this.files.has(duneState)) {
        this.files.set(duneState, '{}\n')
      }
      for (const [linkPath, targetPath] of [
        [memoryLink, duneMemory],
        [miniappsLink, duneMiniapps],
        [claudeLink, duneClaude],
        [stateLink, duneState],
      ]) {
        this.removePath(linkPath)
        this.symlinks.set(linkPath, targetPath)
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    if (cmd === 'python3' && args[0] === '-c' && args[1] === 'import sys; open(sys.argv[1],"w").write(sys.argv[2])') {
      const path = this.resolvePath(args[2] || '')
      this.ensureDirectory(dirname(path))
      this.files.set(path, args[3] || '')
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    if (cmd === 'python3' && args[0] === '-c' && args[1]?.includes('print(open(sys.argv[1]).read(), end="")')) {
      const path = this.resolvePath(args[2] || '')
      const content = this.files.get(path)
      if (content === undefined) {
        return { exitCode: 1, stdout: '', stderr: 'not found' }
      }
      return { exitCode: 0, stdout: content, stderr: '' }
    }

    if (cmd === 'bash' && args[0] === '-c') {
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }

  symlinkTarget(path: string): string | undefined {
    return this.symlinks.get(this.normalize(path))
  }

  readFile(path: string): string | undefined {
    return this.files.get(this.resolvePath(path))
  }

  private ensureDirectory(path: string): void {
    const normalized = this.normalize(path)
    if (normalized === '/') {
      this.directories.add('/')
      return
    }
    const parts = normalized.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      this.directories.add(current)
    }
  }

  private removePath(path: string): void {
    const normalized = this.normalize(path)
    this.symlinks.delete(normalized)
    this.files.delete(normalized)
    for (const entry of Array.from(this.directories)) {
      if (entry === normalized || entry.startsWith(`${normalized}/`)) {
        this.directories.delete(entry)
      }
    }
  }

  private resolvePath(path: string): string {
    let current = this.normalize(path)
    for (let depth = 0; depth < 10; depth += 1) {
      let next = current
      let replaced = false
      const symlinkPaths = Array.from(this.symlinks.keys()).sort((a, b) => b.length - a.length)
      for (const linkPath of symlinkPaths) {
        if (current === linkPath || current.startsWith(`${linkPath}/`)) {
          const targetPath = this.symlinks.get(linkPath)!
          next = this.normalize(`${targetPath}${current.slice(linkPath.length)}`)
          replaced = true
          break
        }
      }
      current = next
      if (!replaced) break
    }
    return current
  }

  private normalize(path: string): string {
    let normalized = path.replace(/\/+/g, '/')
    if (!normalized.startsWith('/')) normalized = `/${normalized}`
    if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  }
}

test.beforeEach(() => {
  clearTables()
  resetAgentData()
})

test('legacy-only host data is migrated into the .dune root', () => {
  const agent = agentStore.createAgent({
    name: 'Host Migration Agent',
    personality: 'host migration',
  })
  const agentRoot = getAgentRoot(agent.id)

  writeText(join(agentRoot, 'memory', 'notes.md'), 'legacy-memory')
  writeText(join(agentRoot, 'miniapps', 'demo', 'app.json'), '{"name":"demo"}\n')
  writeText(join(agentRoot, '.claude', 'settings.json'), '{"env":{"A":"1"}}\n')
  writeText(join(agentRoot, '.claude.json'), '{"session":"legacy"}\n')

  const hostPaths = agentManager.__ensureAgentRuntimeHostPathsForTests(agent.id)

  assert.equal(hostPaths.duneRootHostPath, join(agentRoot, '.dune'))
  assert.equal(readFileSync(join(agentRoot, '.dune', 'memory', 'notes.md'), 'utf-8'), 'legacy-memory')
  assert.equal(readFileSync(join(agentRoot, '.dune', 'miniapps', 'demo', 'app.json'), 'utf-8'), '{"name":"demo"}\n')
  assert.equal(readFileSync(join(agentRoot, '.dune', '.claude', 'settings.json'), 'utf-8'), '{"env":{"A":"1"}}\n')
  assert.equal(readFileSync(join(agentRoot, '.dune', '.claude.json'), 'utf-8'), '{"session":"legacy"}\n')
  assert.equal(existsSync(join(agentRoot, 'memory')), false)
  assert.equal(existsSync(join(agentRoot, 'miniapps')), false)
  assert.equal(existsSync(join(agentRoot, '.claude')), false)
  assert.equal(existsSync(join(agentRoot, '.claude.json')), false)
})

test('existing .dune data wins and legacy entries are left untouched', () => {
  const agent = agentStore.createAgent({
    name: 'Host Migration Existing Destination',
    personality: 'host migration destination wins',
  })
  const agentRoot = getAgentRoot(agent.id)

  writeText(join(agentRoot, 'memory', 'notes.md'), 'legacy-memory')
  writeText(join(agentRoot, '.claude.json'), '{"session":"legacy"}\n')
  writeText(join(agentRoot, '.dune', 'memory', 'notes.md'), 'dune-memory')
  writeText(join(agentRoot, '.dune', '.claude.json'), '{"session":"dune"}\n')

  agentManager.__ensureAgentRuntimeHostPathsForTests(agent.id)

  assert.equal(readFileSync(join(agentRoot, '.dune', 'memory', 'notes.md'), 'utf-8'), 'dune-memory')
  assert.equal(readFileSync(join(agentRoot, '.dune', '.claude.json'), 'utf-8'), '{"session":"dune"}\n')
  assert.equal(readFileSync(join(agentRoot, 'memory', 'notes.md'), 'utf-8'), 'legacy-memory')
  assert.equal(readFileSync(join(agentRoot, '.claude.json'), 'utf-8'), '{"session":"legacy"}\n')
})

test('partial migration moves only missing destinations', () => {
  const agent = agentStore.createAgent({
    name: 'Host Migration Partial',
    personality: 'host migration partial',
  })
  const agentRoot = getAgentRoot(agent.id)

  writeText(join(agentRoot, 'miniapps', 'legacy', 'app.json'), '{"name":"legacy"}\n')
  writeText(join(agentRoot, '.claude', 'legacy.txt'), 'legacy-claude')
  writeText(join(agentRoot, '.dune', '.claude', 'marker.txt'), 'existing-dune-claude')

  agentManager.__ensureAgentRuntimeHostPathsForTests(agent.id)

  assert.equal(readFileSync(join(agentRoot, '.dune', 'miniapps', 'legacy', 'app.json'), 'utf-8'), '{"name":"legacy"}\n')
  assert.equal(existsSync(join(agentRoot, 'miniapps')), false)
  assert.equal(readFileSync(join(agentRoot, '.dune', '.claude', 'marker.txt'), 'utf-8'), 'existing-dune-claude')
  assert.equal(readFileSync(join(agentRoot, '.claude', 'legacy.txt'), 'utf-8'), 'legacy-claude')
})

test('config facade creates compatibility symlinks backed by /config/.dune', async () => {
  const box = new FakeConfigFacadeBox()

  await agentManager.__prepareAgentConfigFacadeInBoxForTests(box as any)

  assert.equal(box.symlinkTarget('/config/memory'), '/config/.dune/memory')
  assert.equal(box.symlinkTarget('/config/miniapps'), '/config/.dune/miniapps')
  assert.equal(box.symlinkTarget('/config/.claude'), '/config/.dune/.claude')
  assert.equal(box.symlinkTarget('/config/.claude.json'), '/config/.dune/.claude.json')
  assert.equal(box.readFile('/config/.dune/.claude.json'), '{}\n')
})

test('writes through compatibility paths land in the mounted .dune tree', async () => {
  const box = new FakeConfigFacadeBox()

  await agentManager.__prepareAgentConfigFacadeInBoxForTests(box as any)
  await box.exec('python3', ['-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])', '/config/.claude.json', '{"state":1}\n'])
  await box.exec('python3', ['-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])', '/config/.claude/settings.json', '{"env":{"B":"2"}}\n'])

  assert.equal(box.readFile('/config/.dune/.claude.json'), '{"state":1}\n')
  assert.equal(box.readFile('/config/.dune/.claude/settings.json'), '{"env":{"B":"2"}}\n')
})
