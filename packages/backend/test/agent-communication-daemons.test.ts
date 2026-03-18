import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.DATA_DIR = join(tmpdir(), `dune-agent-communication-daemons-${Date.now()}`)

const { getDb } = await import('../src/storage/database.js')
const agentStore = await import('../src/storage/agent-store.js')
const agentManager = await import('../src/agents/agent-manager.js')
const { app } = await import('../src/server.js')

const db = getDb()

const DUNE_PROXY_GUEST_PATH = '/config/.dune/system/communication/dune_proxy.py'
const MAILBOX_DAEMON_GUEST_PATH = '/config/.dune/system/communication/mailbox_daemon.py'
const BACKEND_URL_RESOLVER_GUEST_PATH = '/config/.dune/system/communication/backend_url_resolver.py'

function clearTables() {
  db.exec(`
    DELETE FROM subscriptions;
    DELETE FROM agent_read_cursors;
    DELETE FROM agent_runtime_state;
    DELETE FROM agents;
  `)
}

function resetAgentData() {
  rmSync(join(process.env.DATA_DIR!, 'agents'), { recursive: true, force: true })
}

class FakeDaemonBox {
  proxyRunning = false
  mailboxRunning = false
  readonly reachableBackendUrls = new Set<string>()
  readonly commands: string[] = []

  async exec(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const rendered = `${cmd} ${args.join(' ')}`
    this.commands.push(rendered)

    const script = args[1] || ''
    if (script.includes("ip route | awk '/default/ {print $3}'")) {
      return { exitCode: 0, stdout: '172.17.0.1\n', stderr: '' }
    }

    if (script.includes("curl -s --max-time 3 -o /dev/null -w '%{http_code}'")) {
      const match = script.match(/(http:\/\/[^\s'"]+)\/api\/agents/)
      const backendUrl = match?.[1] || ''
      return {
        exitCode: 0,
        stdout: `${this.reachableBackendUrls.has(backendUrl) ? '200' : '000'}\n`,
        stderr: '',
      }
    }

    if (script.includes('pgrep -f')) {
      return {
        exitCode: 0,
        stdout: `proxy=${this.proxyRunning ? 1 : 0}\nmailbox=${this.mailboxRunning ? 1 : 0}\n`,
        stderr: '',
      }
    }

    if (script.includes('pkill -f')) {
      this.proxyRunning = false
      this.mailboxRunning = false
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    if (script.includes(`python3 ${DUNE_PROXY_GUEST_PATH}`)) {
      this.proxyRunning = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    if (script.includes(`python3 ${MAILBOX_DAEMON_GUEST_PATH}`)) {
      this.mailboxRunning = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

async function withBackendPort<T>(port: string, run: () => Promise<T>): Promise<T> {
  const portFile = join(process.cwd(), '.port')
  const hadPortFile = existsSync(portFile)
  const previousPortValue = hadPortFile ? readFileSync(portFile, 'utf-8') : ''
  mkdirSync(process.cwd(), { recursive: true })
  writeFileSync(portFile, `${port}\n`, 'utf-8')

  try {
    return await run()
  } finally {
    if (hadPortFile) {
      writeFileSync(portFile, previousPortValue, 'utf-8')
    } else {
      rmSync(portFile, { force: true })
    }
  }
}

test.beforeEach(() => {
  clearTables()
  resetAgentData()
})

test.after(() => {
  resetAgentData()
})

test('daemon assets are written under .dune and unchanged sync does not rewrite them', async () => {
  const agent = agentStore.createAgent({
    name: 'Daemon Assets Agent',
    personality: 'daemon assets',
  })

  const first = agentManager.__syncCommunicationDaemonAssetsForTests(agent.id)
  assert.equal(first.changed, true)
  assert.equal(first.rootHostPath, join(process.env.DATA_DIR!, 'agents', agent.id, '.dune', 'system', 'communication'))
  assert.equal(existsSync(first.proxyHostPath), true)
  assert.equal(existsSync(first.mailboxDaemonHostPath), true)
  assert.equal(existsSync(first.backendUrlResolverHostPath), true)
  assert.match(readFileSync(first.proxyHostPath, 'utf-8'), /Dune Proxy/)
  assert.match(readFileSync(first.mailboxDaemonHostPath, 'utf-8'), /Mailbox Daemon/)
  assert.match(readFileSync(first.backendUrlResolverHostPath, 'utf-8'), /Shared backend URL resolver/)

  const firstProxyMtime = statSync(first.proxyHostPath).mtimeMs
  const firstMailboxMtime = statSync(first.mailboxDaemonHostPath).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 20))

  const second = agentManager.__syncCommunicationDaemonAssetsForTests(agent.id)
  assert.equal(second.changed, false)
  assert.equal(second.assetHash, first.assetHash)
  assert.equal(statSync(first.proxyHostPath).mtimeMs, firstProxyMtime)
  assert.equal(statSync(first.mailboxDaemonHostPath).mtimeMs, firstMailboxMtime)
})

test('backend URL candidates are ordered and deduped with previous URL first', () => {
  assert.deepEqual(
    agentManager.__buildBackendUrlCandidatesForTests(31337, {
      previousUrl: 'http://10.0.0.5:31337',
      defaultGateway: '172.17.0.1',
      hostIps: ['192.168.1.20', '192.168.1.20', '10.0.0.5'],
    }),
    [
      'http://10.0.0.5:31337',
      'http://host.docker.internal:31337',
      'http://172.17.0.1:31337',
      'http://192.168.1.20:31337',
    ],
  )
})

test('conditional daemon reconcile skips restart when endpoint config changes but daemons are healthy', async () => {
  const agent = agentStore.createAgent({
    name: 'Conditional Skip Agent',
    personality: 'conditional skip',
  })
  const box = new FakeDaemonBox()
  box.proxyRunning = true
  box.mailboxRunning = true
  const daemonAssets = agentManager.__syncCommunicationDaemonAssetsForTests(agent.id)

  const running = {
    box,
    agent,
    sandboxId: `runtime-${agent.id}`,
    guiHttpPort: 49001,
    guiHttpsPort: 49002,
    backendUrl: 'http://host.docker.internal:31337',
    backendCandidates: ['http://host.docker.internal:31337'],
    daemonAssetHash: daemonAssets.assetHash,
    daemonConfigHash: 'config-a',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any

  const restarted = await agentManager.__reconcileCommunicationDaemonsForTests(running, {
    endpointConfig: {
      preferredUrl: 'http://172.17.0.1:31337',
      urls: ['http://172.17.0.1:31337', 'http://host.docker.internal:31337'],
      updatedAt: Date.now(),
    },
    daemonAssetHash: daemonAssets.assetHash,
    force: false,
  })

  assert.equal(restarted, false)
  assert.equal(box.commands.some((entry) => entry.includes('pkill -f')), false)
  assert.equal(box.commands.some((entry) => entry.includes(`python3 ${DUNE_PROXY_GUEST_PATH}`)), false)
  assert.equal(box.commands.some((entry) => entry.includes(`python3 ${MAILBOX_DAEMON_GUEST_PATH}`)), false)
  assert.equal(running.backendUrl, 'http://172.17.0.1:31337')
  assert.deepEqual(running.backendCandidates, ['http://172.17.0.1:31337', 'http://host.docker.internal:31337'])
  assert.equal(existsSync(daemonAssets.endpointConfigHostPath), true)
  assert.match(readFileSync(daemonAssets.endpointConfigHostPath, 'utf-8'), /172\.17\.0\.1:31337/)
})

test('conditional daemon reconcile restarts when asset hash changes or a daemon is missing', async () => {
  const agent = agentStore.createAgent({
    name: 'Conditional Restart Inputs Agent',
    personality: 'conditional restart inputs',
  })

  const changedBox = new FakeDaemonBox()
  changedBox.proxyRunning = true
  changedBox.mailboxRunning = true

  const restartedForHash = await agentManager.__reconcileCommunicationDaemonsForTests({
    box: changedBox,
    agent,
    sandboxId: `runtime-${agent.id}-hash`,
    guiHttpPort: 49001,
    guiHttpsPort: 49002,
    backendUrl: 'http://host.docker.internal:31337',
    backendCandidates: ['http://host.docker.internal:31337'],
    daemonAssetHash: 'hash-a',
    daemonConfigHash: 'config-a',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any, {
    endpointConfig: {
      preferredUrl: 'http://host.docker.internal:31337',
      urls: ['http://host.docker.internal:31337'],
      updatedAt: Date.now(),
    },
    daemonAssetHash: 'hash-b',
    force: false,
  })

  assert.equal(restartedForHash, true)

  const missingProcessBox = new FakeDaemonBox()
  missingProcessBox.proxyRunning = false
  missingProcessBox.mailboxRunning = true

  const restartedForMissingProcess = await agentManager.__reconcileCommunicationDaemonsForTests({
    box: missingProcessBox,
    agent,
    sandboxId: `runtime-${agent.id}-missing`,
    guiHttpPort: 49001,
    guiHttpsPort: 49002,
    backendUrl: 'http://host.docker.internal:31337',
    backendCandidates: ['http://host.docker.internal:31337'],
    daemonAssetHash: 'hash-a',
    daemonConfigHash: 'config-a',
    cliInstalled: true,
    hasSession: false,
    startedAt: Date.now(),
    thinkingSince: 0,
  } as any, {
    endpointConfig: {
      preferredUrl: 'http://host.docker.internal:31337',
      urls: ['http://host.docker.internal:31337'],
      updatedAt: Date.now(),
    },
    daemonAssetHash: 'hash-a',
    force: false,
  })

  assert.equal(restartedForMissingProcess, true)
})

test('force redeploy route restarts daemons even when backend URL and assets are unchanged', async () => {
  const agent = agentStore.createAgent({
    name: 'Force Redeploy Agent',
    personality: 'force redeploy',
  })
  const box = new FakeDaemonBox()
  box.proxyRunning = true
  box.mailboxRunning = true
  const daemonAssets = agentManager.__syncCommunicationDaemonAssetsForTests(agent.id)

  await withBackendPort('31337', async () => {
    try {
      agentManager.__setRunningAgentForTests(agent.id, {
        box,
        agent,
        sandboxId: `runtime-${agent.id}`,
        guiHttpPort: 49001,
        guiHttpsPort: 49002,
        backendUrl: 'http://host.docker.internal:31337',
        backendCandidates: ['http://host.docker.internal:31337'],
        daemonAssetHash: daemonAssets.assetHash,
        daemonConfigHash: 'config-a',
        cliInstalled: true,
        hasSession: false,
        startedAt: Date.now(),
        thinkingSince: 0,
      } as any)
      box.reachableBackendUrls.add('http://172.17.0.1:31337')

      const res = await app.request('/api/agents/redeploy-daemons', { method: 'POST' })
      assert.equal(res.status, 200)

      assert.equal(box.commands.some((entry) => entry.includes('pkill -f')), true)
      assert.equal(box.commands.some((entry) => entry.includes(`python3 ${DUNE_PROXY_GUEST_PATH}`)), true)
      assert.equal(box.commands.some((entry) => entry.includes(`python3 ${MAILBOX_DAEMON_GUEST_PATH}`)), true)
      assert.equal(box.commands.some((entry) => entry.includes(BACKEND_URL_RESOLVER_GUEST_PATH)), false)
    } finally {
      agentManager.__setRunningAgentForTests(agent.id, null)
    }
  })
})
