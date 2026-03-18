import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'

process.env.DATA_DIR = join(tmpdir(), 'dune-agent-sandbox-skill-sync')

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')

const db = getDb()

function clearTables() {
  db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

test('follower execution skills are bundled and synced for running agents', async () => {
  clearTables()

  assert.ok(agentManager.BUILTIN_AGENT_SKILLS.includes('dune-sandbox-operator'))
  assert.ok(agentManager.BUILTIN_AGENT_SKILLS.includes('dune-host-operator'))
  assert.ok(agentManager.BUILTIN_AGENT_SKILLS.includes('dune-leader'))

  const sourceSkillRoot = join(
    process.cwd(),
    'src',
    'agent-skills',
    'dune-sandbox-operator',
  )
  assert.equal(statSync(sourceSkillRoot).isDirectory(), true)
  assert.equal(statSync(join(sourceSkillRoot, 'SKILL.md')).isFile(), true)
  assert.equal(statSync(join(sourceSkillRoot, 'scripts', 'sandbox-api.sh')).isFile(), true)

  const agent = agentStore.createAgent({
    name: 'Skill Sync Agent',
    personality: 'skill sync test',
  })

  const fakeBox = {
    exec: async (_cmd: string, args: string[]) => {
      const script = args[1] || ''
      if (script.includes('ip route | awk')) {
        return { exitCode: 0, stdout: '172.17.0.1\n', stderr: '' }
      }
      if (script.includes('curl -s --max-time 3')) {
        return { exitCode: 0, stdout: '200\n', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }

  const portFile = join(process.cwd(), '.port')
  const hadPortFile = existsSync(portFile)
  const previousPortValue = hadPortFile ? readFileSync(portFile, 'utf-8') : ''
  mkdirSync(process.cwd(), { recursive: true })
  writeFileSync(portFile, '31337\n', 'utf-8')

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId: `runtime-${agent.id}`,
      guiHttpPort: 49001,
      guiHttpsPort: 49002,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    await agentManager.redeployAllDaemons()

    const syncedSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-sandbox-operator')
    assert.equal(statSync(syncedSkillRoot).isDirectory(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'SKILL.md')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'agents', 'openai.yaml')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'references', 'api-matrix.md')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'references', 'workflows.md')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'scripts', 'sandbox-box.sh')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'scripts', 'sandbox-exec.sh')).isFile(), true)
    assert.equal(statSync(join(syncedSkillRoot, 'scripts', 'sandbox-files.sh')).isFile(), true)

    const syncedHostSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-host-operator')
    assert.equal(statSync(syncedHostSkillRoot).isDirectory(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'SKILL.md')).isFile(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'scripts', 'host-overview.sh')).isFile(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'scripts', 'host-perceive.sh')).isFile(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'scripts', 'host-act.sh')).isFile(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'scripts', 'host-status.sh')).isFile(), true)
    assert.equal(statSync(join(syncedHostSkillRoot, 'scripts', 'host-fs.sh')).isFile(), true)

    const syncedLeaderSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-leader')
    assert.equal(existsSync(syncedLeaderSkillRoot), false)
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)

    if (hadPortFile) {
      writeFileSync(portFile, previousPortValue, 'utf-8')
    } else {
      rmSync(portFile, { force: true })
    }

    rmSync(join(process.env.DATA_DIR!, 'agents', agent.id), { recursive: true, force: true })
  }
})

test('leader agents receive dune-leader during skill sync', async () => {
  clearTables()

  const agent = agentStore.createAgent({
    name: 'Leader Skill Sync Agent',
    personality: 'leader sync test',
    role: 'leader',
  })

  const fakeBox = {
    exec: async (_cmd: string, args: string[]) => {
      const script = args[1] || ''
      if (script.includes('ip route | awk')) {
        return { exitCode: 0, stdout: '172.17.0.1\n', stderr: '' }
      }
      if (script.includes('curl -s --max-time 3')) {
        return { exitCode: 0, stdout: '200\n', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }

  const portFile = join(process.cwd(), '.port')
  const hadPortFile = existsSync(portFile)
  const previousPortValue = hadPortFile ? readFileSync(portFile, 'utf-8') : ''
  mkdirSync(process.cwd(), { recursive: true })
  writeFileSync(portFile, '31337\n', 'utf-8')

  try {
    agentManager.__setRunningAgentForTests(agent.id, {
      box: fakeBox as any,
      agent,
      sandboxId: `runtime-${agent.id}`,
      guiHttpPort: 49011,
      guiHttpsPort: 49012,
      backendUrl: '',
      cliInstalled: true,
      hasSession: false,
      startedAt: Date.now(),
      thinkingSince: 0,
    } as any)

    await agentManager.redeployAllDaemons()

    const syncedLeaderSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-leader')
    assert.equal(statSync(syncedLeaderSkillRoot).isDirectory(), true)
    assert.equal(statSync(join(syncedLeaderSkillRoot, 'SKILL.md')).isFile(), true)

    // Leader should NOT have follower-only skills
    const syncedSandboxSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-sandbox-operator')
    const syncedMiniappSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-miniapp-builder')
    assert.equal(existsSync(syncedSandboxSkillRoot), false)
    assert.equal(existsSync(syncedMiniappSkillRoot), false)
    // Leader DOES have coordination skills (including host-operator)
    const syncedHostSkillRoot = join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', '.claude', 'skills', 'dune-host-operator')
    assert.equal(existsSync(syncedHostSkillRoot), true)
  } finally {
    agentManager.__setRunningAgentForTests(agent.id, null)

    if (hadPortFile) {
      writeFileSync(portFile, previousPortValue, 'utf-8')
    } else {
      rmSync(portFile, { force: true })
    }

    rmSync(join(process.env.DATA_DIR!, 'agents', agent.id), { recursive: true, force: true })
  }
})
