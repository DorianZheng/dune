import { SimpleBox } from '@boxlite-ai/boxlite'
import { createServer } from 'node:net'
import * as agentStore from '../storage/agent-store.js'
import * as agentLogStore from '../storage/agent-log-store.js'
import * as agentRuntimeStore from '../storage/agent-runtime-store.js'
import * as agentRuntimeMountStore from '../storage/agent-runtime-mount-store.js'
import * as sandboxStore from '../storage/sandbox-store.js'
import { sendToAll as broadcastAll } from '../gateway/broadcast.js'
import { clearGrantsForAgent } from '../host-operator/host-operator-service.js'
import { config } from '../config.js'
import { createBoxliteRuntime } from '../boxlite/runtime.js'
import { resolve, dirname, join } from 'node:path'
import { readFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, cpSync, writeFileSync, renameSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { newEventId } from '../utils/ids.js'
import * as todoStore from '../storage/todo-store.js'
import { isValidDueAtMs } from '../todos/due-at.js'
import { getEffectiveClaudeSettings, getStoredClaudeSettings } from '../storage/claude-settings-store.js'
import type { Agent, AgentLogEntry, AgentStatusType, Todo } from '@dune/shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND_RUNTIME_ROOT = resolve(__dirname, '..')

function resolveBundledAssetDir(relativeDir: string, runtimeRoot = BACKEND_RUNTIME_ROOT): string {
  // Check config-provided paths first (used by Electron packaged mode)
  const configPaths: Record<string, string | undefined> = {
    'agent-skills': config.agentSkillsPath,
    'agent-mcp': config.agentMcpPath,
    'agent-prompts': config.agentPromptsPath,
  }
  const configPath = configPaths[relativeDir]
  if (configPath && existsSync(configPath)) return configPath

  const runtimePath = join(runtimeRoot, relativeDir)
  if (existsSync(runtimePath)) return runtimePath

  const sourcePath = join(resolve(runtimeRoot, '../src'), relativeDir)
  if (existsSync(sourcePath)) return sourcePath

  return configPath || runtimePath
}

// ── Constants (mirrors Python SkillBox) ─────────────────────────────────
const SKILLBOX_IMAGE = 'ghcr.io/boxlite-ai/boxlite-skillbox:0.1.0'
const SKILLBOX_MEMORY_MIB = 2048
const SKILLBOX_DISK_SIZE_GB = 10
const DISPLAY_WIDTH = 1024
const DISPLAY_HEIGHT = 768
const DESKTOP_PROCESS_MARKERS = ['xfdesktop', 'xfdesktop4', 'xfce4-panel', 'xfce4-session'] as const
const STARTUP_WATCHDOG_GRACE_MS = 2_000
const RUNTIME_SANDBOX_NAME_PREFIX = 'agent-runtime-'
const RUNTIME_SANDBOX_PENDING_PREFIX = 'pending:'

/** Full PATH inside SkillBox (includes /lsiopy/bin for system Python packages like typing_extensions). */
const SKILLBOX_PATH = '/config/.local/bin:/lsiopy/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/** MCP server config — written to /config/mcp-servers.json at startup.
 *  Must be a SEPARATE file because the CLI overwrites $HOME/.claude.json with its own state. */
const MCP_CONFIG_PATH = '/config/mcp-servers.json'
const AGENT_DUNE_VOLUME_PATH = '/config/.dune'
const AGENT_DUNE_MEMORY_PATH = `${AGENT_DUNE_VOLUME_PATH}/memory`
const AGENT_DUNE_MINIAPPS_PATH = `${AGENT_DUNE_VOLUME_PATH}/miniapps`
const AGENT_DUNE_CLAUDE_PATH = `${AGENT_DUNE_VOLUME_PATH}/.claude`
const AGENT_DUNE_CLAUDE_STATE_PATH = `${AGENT_DUNE_VOLUME_PATH}/.claude.json`
const AGENT_DUNE_SYSTEM_PATH = `${AGENT_DUNE_VOLUME_PATH}/system`
const AGENT_DUNE_COMMUNICATION_PATH = `${AGENT_DUNE_SYSTEM_PATH}/communication`
const RPC_GUEST_PATH = `${AGENT_DUNE_VOLUME_PATH}/rpc.py`
const LISTENER_GUEST_PATH = `${AGENT_DUNE_VOLUME_PATH}/listener.py`
const AGENT_MEMORY_VOLUME_PATH = '/config/memory'
const AGENT_MINIAPP_VOLUME_PATH = '/config/miniapps'
const AGENT_CLAUDE_VOLUME_PATH = '/config/.claude'
const CLAUDE_STATE_PATH = '/config/.claude.json'
const STOP_AGENT_SHUTDOWN_PROMPT = 'You are being shut down. Save any important information from this session to your memory files in /config/memory/ now. Be concise — you have limited time.'
const TODO_HANDOFF_MEMORY_PATH = `${AGENT_MEMORY_VOLUME_PATH}/todo-handoff.md`
const LEADER_THESIS_MEMORY_PATH = `${AGENT_MEMORY_VOLUME_PATH}/leader-thesis.md`
const TODO_HEARTBEAT_DELAY_MINUTES = 30
const LISTENER_PROCESS_PATTERN = '[l]istener.py'
const COMMUNICATION_DAEMON_REFRESH_INTERVAL_MS = 60_000
const MCP_CONFIG = JSON.stringify({
  mcpServers: {
    computer: {
      command: 'python3',
      args: ['/config/.local/bin/local_computer_mcp.py'],
    },
  },
})

/** System prompt file path inside the container (per-agent, written before each CLI call). */
const SYSTEM_PROMPT_DIR = '/tmp'
const AGENT_PROMPTS_SOURCE_DIR = resolveBundledAssetDir('agent-prompts')
const SYSTEM_PROMPT_TEMPLATE_PATH = join(AGENT_PROMPTS_SOURCE_DIR, 'system.md')
const NGINX_CONFIG_CANDIDATES = [
  '/etc/nginx/sites-available/default',
  '/etc/nginx/http.d/default.conf',
]
const NGINX_WEBSOCKET_ANCHOR = '  location /websocket'
const AGENT_SKILLS_SOURCE_DIR = resolveBundledAssetDir('agent-skills')
const AGENT_SKILLS_VOLUME_PATH = `${AGENT_CLAUDE_VOLUME_PATH}/skills`
const CLAUDE_SETTINGS_PATH = `${AGENT_CLAUDE_VOLUME_PATH}/settings.json`
const COORDINATION_AGENT_SKILLS = [
  'dune-communication',
  'dune-team-manager',
  'dune-todo',
  'dune-host-operator',
  'dune-slack',
] as const
const FOLLOWER_AGENT_SKILLS = [
  ...COORDINATION_AGENT_SKILLS,
  'dune-miniapp-builder',
  'dune-sandbox-operator',
] as const
const LEADER_AGENT_SKILLS = [
  ...COORDINATION_AGENT_SKILLS,
  'dune-leader',
] as const
const AGENT_SKILLS = [
  ...FOLLOWER_AGENT_SKILLS,
  ...LEADER_AGENT_SKILLS,
] as const
export const BUILTIN_AGENT_SKILLS = AGENT_SKILLS

export function __resolveBundledAssetDirForTests(relativeDir: string, runtimeRoot?: string): string {
  return resolveBundledAssetDir(relativeDir, runtimeRoot)
}

export type SkillInfo = {
  name: string
  description: string
  preview: string
  scripts: string[]
  markdown: string
}

type BuiltinSkillName = typeof AGENT_SKILLS[number]

type ClaudeSettingsEnvValues = {
  ANTHROPIC_AUTH_TOKEN?: string
  ANTHROPIC_BASE_URL?: string
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?: string
}

type ClaudeCliAuthEnvValues = {
  ANTHROPIC_API_KEY?: string
  CLAUDE_CODE_OAUTH_TOKEN?: string
}

export type ClaudeSettingsSyncAgentResult = {
  agentId: string
  name: string
  wasRunning: boolean
  startedForSync: boolean
  updated: boolean
  stoppedAfterSync: boolean
  error?: string
  stopError?: string
}

export type ClaudeSettingsSyncSummary = {
  total: number
  updated: number
  failed: number
  restoredStopped: number
  results: ClaudeSettingsSyncAgentResult[]
}

/** Parse YAML frontmatter from a SKILL.md file (simple key: value extraction). */
function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return { name: '', description: '' }
  const lines = match[1].split('\n')
  let name = ''
  let description = ''
  for (const line of lines) {
    const [key, ...rest] = line.split(':')
    const value = rest.join(':').trim()
    if (key.trim() === 'name') name = value
    if (key.trim() === 'description') description = value
  }
  return { name, description }
}

function getBuiltinAgentSkillNames(agent?: Pick<Agent, 'role'> | null): BuiltinSkillName[] {
  if (!agent) return [...AGENT_SKILLS]
  return agent.role === 'leader'
    ? [...LEADER_AGENT_SKILLS]
    : [...FOLLOWER_AGENT_SKILLS]
}

/** List all skills with their metadata for an agent. */
export function listSkills(agent?: Pick<Agent, 'role'> | null): SkillInfo[] {
  const skills: SkillInfo[] = []
  for (const skillName of getBuiltinAgentSkillNames(agent)) {
    const skillDir = join(AGENT_SKILLS_SOURCE_DIR, skillName)
    if (!existsSync(skillDir)) continue

    const skillMdPath = join(skillDir, 'SKILL.md')
    let name: string = skillName
    let description = ''
    let preview = ''
    let markdown = ''
    if (existsSync(skillMdPath)) {
      const content = readFileSync(skillMdPath, 'utf-8')
      markdown = content
      const fm = parseSkillFrontmatter(content)
      if (fm.name) name = fm.name
      if (fm.description) description = fm.description
      preview = fm.description || ''
    }

    const scriptsDir = join(skillDir, 'scripts')
    let scripts: string[] = []
    if (existsSync(scriptsDir) && statSync(scriptsDir).isDirectory()) {
      scripts = readdirSync(scriptsDir).filter(f => f.endsWith('.sh')).sort()
    }

    skills.push({ name, description, preview, scripts, markdown })
  }
  return skills
}

/** Assemble the full system prompt an agent receives (for viewing). */
export function assembleSystemPrompt(agentId: string): string {
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error(`Agent ${agentId} not found`)
  return buildSystemPrompt(agent)
}
const AGENT_SKILL_FINGERPRINT_FILE = '.dune-source-fingerprint'
const MINIAPP_LOCATION_BLOCK = [
  '  location /miniapps/ {',
  '    alias                   /config/miniapps/;',
  '    autoindex               off;',
  '    add_header              Cache-Control "no-store";',
  '    try_files               $uri $uri/ =404;',
  '  }',
].join('\n')
const WEBRTC_LOCATION_BLOCK = [
  '  location /webrtc {',
  '    proxy_set_header        Upgrade $http_upgrade;',
  '    proxy_set_header        Connection "upgrade";',
  '    proxy_set_header        Host $host;',
  '    proxy_http_version      1.1;',
  '    proxy_read_timeout      3600s;',
  '    proxy_send_timeout      3600s;',
  '    proxy_connect_timeout   3600s;',
  '    proxy_buffering         off;',
  '    proxy_pass              http://127.0.0.1:8082;',
  '  }',
].join('\n')

type MiniappNginxPatchResult = {
  text: string
  changed: boolean
}

type RuntimeVolumeSpec = {
  hostPath: string
  guestPath: string
  readOnly?: boolean
}

type AgentRuntimeHostPaths = {
  duneRootHostPath: string
  memoryHostPath: string
  miniappHostPath: string
  claudeHostPath: string
  claudeStateHostPath: string
  communicationHostPath: string
}

function buildAgentRuntimeVolumes(agentId: string, baseVolumes: RuntimeVolumeSpec[]): RuntimeVolumeSpec[] {
  const configuredMounts = agentRuntimeMountStore.resolveAgentRuntimeVolumeMounts(agentId)
  return [
    ...baseVolumes,
    ...configuredMounts.map((mount) => ({
      hostPath: mount.hostPath,
      guestPath: mount.guestPath,
      readOnly: mount.readOnly,
    })),
  ]
}

export function __buildAgentRuntimeVolumesForTests(
  agentId: string,
  baseVolumes: RuntimeVolumeSpec[],
): RuntimeVolumeSpec[] {
  return buildAgentRuntimeVolumes(agentId, baseVolumes)
}

function buildAgentRuntimeBaseVolumes(hostPaths: AgentRuntimeHostPaths): RuntimeVolumeSpec[] {
  return [
    { hostPath: hostPaths.duneRootHostPath, guestPath: AGENT_DUNE_VOLUME_PATH },
  ]
}

export function __buildAgentRuntimeBaseVolumesForTests(agentId: string): RuntimeVolumeSpec[] {
  return buildAgentRuntimeBaseVolumes(ensureAgentRuntimeHostPaths(agentId))
}

export function __ensureAgentRuntimeHostPathsForTests(agentId: string): AgentRuntimeHostPaths {
  return ensureAgentRuntimeHostPaths(agentId)
}

export function patchMiniappNginxRouting(configText: string): MiniappNginxPatchResult {
  const websocketCount = (configText.match(/location \/websocket/g) || []).length
  if (websocketCount === 0) {
    throw new Error('location /websocket anchor not found in nginx config')
  }

  const miniappsCount = (configText.match(/location \/miniapps\//g) || []).length
  const webrtcCount = (configText.match(/location \/webrtc/g) || []).length
  if (miniappsCount >= websocketCount && webrtcCount >= websocketCount) {
    return { text: configText, changed: false }
  }

  if (!configText.includes(NGINX_WEBSOCKET_ANCHOR)) {
    throw new Error('location /websocket anchor not found in nginx config')
  }

  const insertionParts: string[] = []
  if (miniappsCount < websocketCount) insertionParts.push(MINIAPP_LOCATION_BLOCK)
  if (webrtcCount < websocketCount) insertionParts.push(WEBRTC_LOCATION_BLOCK)
  const insertion = `${insertionParts.join('\n\n')}\n\n`
  const text = configText.replaceAll(NGINX_WEBSOCKET_ANCHOR, `${insertion}${NGINX_WEBSOCKET_ANCHOR}`)
  return { text, changed: true }
}

function getSystemPromptTemplate(): string {
  const prompt = readFileSync(SYSTEM_PROMPT_TEMPLATE_PATH, 'utf-8').trim()
  if (!prompt) {
    throw new Error(`System prompt template is empty: ${SYSTEM_PROMPT_TEMPLATE_PATH}`)
  }
  return prompt
}

function buildSystemPrompt(agent: Pick<Agent, 'name' | 'personality' | 'role' | 'workMode'>): string {
  const roleGuidance = agent.role === 'leader'
    ? `You are the leader. You assign work, follow up, review outcomes, and remain accountable for the result. Do not implement directly yourself. Remove obstacles aggressively and do not wait passively—exhaust obstacle-removal methods (re-scope, reassign, recruit, gather context, reroute, escalate sideways) before escalating to a human. When work goes idle or the mission is unclear, use dune-leader to reassess the mission, update ${LEADER_THESIS_MEMORY_PATH} only when the mission materially changes, run one delegation-and-review PDCA cycle, and end with the required Leader PDCA footer. Use nextPlan and ${TODO_HANDOFF_MEMORY_PATH} only as optional operational notes after the cycle.`
    : 'You are a follower. Preserve the original todo request, keep progress in working fields or memory, and do not rewrite the original request snapshot.'
  const workModeGuidance = agent.workMode === 'plan-first'
    ? 'Work mode: plan-first. Before editing files, using tools, or taking multi-step action, inspect the current state and form a concrete plan for yourself first. Then execute against that plan.'
    : 'Work mode: normal. Once you have enough context, act directly and avoid unnecessary planning overhead.'

  return [
    getSystemPromptTemplate(),
    '',
    '<agent>',
    `Name: ${agent.name}`,
    `Role: ${agent.role}`,
    `Work mode: ${agent.workMode}`,
    `Personality: ${agent.personality}`,
    roleGuidance,
    workModeGuidance,
    '</agent>',
  ].join('\n')
}

function resolveClaudeModelId(agent: Pick<Agent, 'modelIdOverride'>): string | null {
  const override = agent.modelIdOverride?.trim()
  if (override) return override
  return getStoredClaudeSettings().defaultModelId
}


interface RunningAgent {
  box: SimpleBox
  agent: Agent
  sandboxId: string
  guiHttpPort: number
  guiHttpsPort: number
  backendUrl: string
  agentHttpUrl: string
  daemonAssetHash?: string
  cliInstalled: boolean
  hasSession: boolean
  startedAt: number
  thinkingSince: number  // timestamp when agent entered thinking state, 0 if not thinking
  currentExecution: { kill: () => Promise<void> } | null
  interruptRequested: boolean
  interruptAbort: { promise: Promise<void>; resolve: () => void } | null
}

const runningAgents = new Map<string, RunningAgent>()

export function __setRunningAgentForTests(agentId: string, running: RunningAgent | null): void {
  if (running) {
    runningAgents.set(agentId, running)
  } else {
    runningAgents.delete(agentId)
  }
}

/** Max time an agent can stay in "thinking" before watchdog resets it. */
const THINKING_WATCHDOG_MS = 330_000  // 5.5 min (300s CLI timeout + 30s buffer)

/** Watchdog: recovers agents stuck in "thinking" state beyond timeout. */
const thinkingWatchdogTimer = setInterval(() => {
  const now = Date.now()
  for (const [agentId, running] of runningAgents) {
    if (running.thinkingSince > 0 && (now - running.thinkingSince) > THINKING_WATCHDOG_MS) {
      console.warn(`[watchdog] Agent ${agentId} stuck in thinking for ${Math.round((now - running.thinkingSince) / 1000)}s — resetting to error`)
      running.thinkingSince = 0
      setAgentStatus(agentId, 'error', { source: 'thinking-watchdog', reason: 'thinking timeout exceeded' })
      // Try to clean up busy flag
      timedExec(running.box, 'rm', ['-f', '/tmp/agent-busy'], { DISPLAY: ':1' }, 10_000).catch(() => {})
    }
  }
}, 30_000)  // check every 30s
thinkingWatchdogTimer.unref()

// ── BoxLite runtime ─────────────────────────────────────────────────────
let runtime: any = null

function getRuntime() {
  if (!runtime) {
    runtime = createBoxliteRuntime()
  }
  return runtime
}

function getRuntimeSandboxName(agentId: string): string {
  return `${RUNTIME_SANDBOX_NAME_PREFIX}${agentId}`
}

function getPendingSandboxId(agentId: string): string {
  return `${RUNTIME_SANDBOX_PENDING_PREFIX}${agentId}`
}

function isPendingSandboxId(sandboxId: string): boolean {
  return sandboxId.startsWith(RUNTIME_SANDBOX_PENDING_PREFIX)
}

function canResumePersistedSession(runtimeState: agentRuntimeStore.AgentRuntimeState, sandboxId: string): boolean {
  return runtimeState.hasSession && !isPendingSandboxId(runtimeState.sandboxId) && runtimeState.sandboxId === sandboxId
}

function isSandboxNotFoundError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '').toLowerCase()
  return (
    message.includes('not found')
    || message.includes('no such')
    || message.includes('does not exist')
    || message.includes('unknown sandbox')
  )
}

function upsertManagedRuntimeShadow(agentId: string, sandboxId: string, patch: Partial<{
  status: 'running' | 'stopped'
  startedAt: number | null
  stoppedAt: number | null
}> = {}): void {
  if (!sandboxId || isPendingSandboxId(sandboxId)) return

  const agent = agentStore.getAgent(agentId)
  if (!agent) return
  sandboxStore.upsertManagedRuntimeSandbox({
    sandboxId,
    agentId,
    name: `${agent.name} runtime`,
    status: patch.status ?? 'stopped',
    startedAt: patch.startedAt ?? null,
    stoppedAt: patch.stoppedAt ?? null,
    boxliteBoxId: sandboxId,
  })
}

export function closeRuntime() {
  if (runtime) {
    runtime.close()
    runtime = null
  }
}

export function __setRuntimeForTests(nextRuntime: any | null): void {
  runtime = nextRuntime
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Find a random available TCP port. */
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const port = (srv.address() as any).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function allocateGuiPorts(): Promise<{ guiHttpPort: number; guiHttpsPort: number }> {
  const guiHttpPort = await findAvailablePort()
  let guiHttpsPort = await findAvailablePort()
  while (guiHttpsPort === guiHttpPort) {
    guiHttpsPort = await findAvailablePort()
  }
  return { guiHttpPort, guiHttpsPort }
}

type DesktopReadinessDiagnostics = {
  probeCount: number
  lastExitCode: number | null
  lastStdout: string
  lastStderr: string
  lastError: string | null
  lastTimeout: boolean
  lastMatchedMarker: string | null
}

type DesktopReadinessResult = {
  probeCount: number
  matchedMarker: string
}

function truncateDiagnosticText(value: string, maxLen = 220): string {
  if (!value) return ''
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= maxLen ? compact : `${compact.slice(0, maxLen)}...`
}

function formatDesktopReadinessSummary(expected: string, diagnostics: DesktopReadinessDiagnostics): string {
  const parts = [
    `probes=${diagnostics.probeCount}`,
    `expected_size=${expected}`,
    `marker=${diagnostics.lastMatchedMarker ?? 'none'}`,
    `last_exit=${diagnostics.lastExitCode ?? 'n/a'}`,
    `last_timeout=${diagnostics.lastTimeout}`,
  ]

  if (diagnostics.lastError) parts.push(`last_error="${diagnostics.lastError}"`)
  if (diagnostics.lastStdout) parts.push(`stdout="${diagnostics.lastStdout}"`)
  if (diagnostics.lastStderr) parts.push(`stderr="${diagnostics.lastStderr}"`)

  return parts.join(' ')
}

function detectDesktopMarker(stdout: string): string | null {
  for (const marker of DESKTOP_PROCESS_MARKERS) {
    const pattern = new RegExp(`\\b${marker}\\b`)
    if (pattern.test(stdout)) return marker
  }
  return null
}

/** Poll xwininfo until the XFCE desktop is ready at the expected resolution. */
async function waitUntilDesktopReady(box: SimpleBox, signal?: AbortSignal): Promise<DesktopReadinessResult> {
  const timeoutMs = Math.max(1_000, config.agentStartupTimeoutMs)
  const pollMs = Math.max(100, config.agentDesktopPollMs)
  const deadline = Date.now() + timeoutMs
  const expected = `${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}`


  const diagnostics: DesktopReadinessDiagnostics = {
    probeCount: 0,
    lastExitCode: null,
    lastStdout: '',
    lastStderr: '',
    lastError: null,
    lastTimeout: false,
    lastMatchedMarker: null,
  }

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error('desktop_not_ready: startup_aborted')
    }

    diagnostics.probeCount += 1
    try {
      const probeTimeoutMs = Math.max(1_500, Math.min(2_500, deadline - Date.now()))
      // Check X server is up via xwininfo (exit 0 = X running)
      const result = await retriedExec(box, 'xwininfo', ['-tree', '-root'], { DISPLAY: ':1' }, probeTimeoutMs, 1)
      diagnostics.lastExitCode = result.exitCode
      diagnostics.lastStdout = truncateDiagnosticText(result.stdout, 260)
      diagnostics.lastStderr = truncateDiagnosticText(result.stderr, 200)
      diagnostics.lastError = null
      diagnostics.lastTimeout = false

      const xIsUp = result.exitCode === 0

      if (xIsUp) {
        // X server is up — now check if a desktop process is running via pgrep
        let pgrepStdout = ''
        try {
          const pgrepResult = await retriedExec(box, 'pgrep', ['-x', DESKTOP_PROCESS_MARKERS.join('|')], {}, probeTimeoutMs, 1)
          pgrepStdout = pgrepResult.stdout
        } catch (_) { /* pgrep not found or no matches */ }

        // Also check xwininfo output for markers (legacy path for images that do work)
        const markerInXwininfo = detectDesktopMarker(result.stdout)
        const pgrepHasPids = /^\d+$/m.test(pgrepStdout.trim())
        const markerInPgrep = detectDesktopMarker(pgrepStdout) ?? (pgrepHasPids ? 'xfce4-session' : null)
        diagnostics.lastMatchedMarker = markerInXwininfo ?? markerInPgrep

        const hasDesktop = diagnostics.lastMatchedMarker !== null
        // Accept: marker found in xwininfo + 1024x768 window (original check)
        // OR: marker found via pgrep + X server is up (new fallback)
        const hasSize = result.stdout.includes(expected)
        const readyViaXwininfo = hasDesktop && hasSize && markerInXwininfo !== null
        const readyViaPgrep = hasDesktop && markerInPgrep !== null

        if (readyViaXwininfo || readyViaPgrep) {
          return { probeCount: diagnostics.probeCount, matchedMarker: diagnostics.lastMatchedMarker! }
        }
      }
    } catch (err: any) {
      const message = truncateDiagnosticText(err?.message || String(err), 260)
      diagnostics.lastError = message
      diagnostics.lastTimeout = message.includes('timed out')
      diagnostics.lastStdout = ''
      diagnostics.lastStderr = ''
      diagnostics.lastExitCode = null
      diagnostics.lastMatchedMarker = null
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs))
  }

  throw new Error(`desktop_not_ready: timeout_ms=${timeoutMs} ${formatDesktopReadinessSummary(expected, diagnostics)}`)
}

export async function __waitUntilDesktopReadyForTests(box: SimpleBox, signal?: AbortSignal): Promise<DesktopReadinessResult> {
  return waitUntilDesktopReady(box, signal)
}

/** Verify Claude CLI is available (pre-installed in SkillBox image). */
async function ensureCliInstalled(box: SimpleBox): Promise<void> {
  const check = await retriedExec(box, 'claude', ['--version'], { DISPLAY: ':1' })
  console.log('Claude CLI:', check.stdout.trim())
}

/** Read the current backend port from the .port file.
 *  server.ts writes it to join(__dirname, '../.port') from src/,
 *  which is packages/backend/.port. From src/agents/, that's ../../.port. */
function getBackendPort(): number {
  try {
    const portFile = join(__dirname, '../../.port')
    const raw = readFileSync(portFile, 'utf-8').trim()
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw)
      return parsed.agentPort || 0
    }
    return parseInt(raw, 10)
  } catch {
    return 0
  }
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/** Detect the host's IPv4 addresses from the host side. */
function getHostLanIps(): string[] {
  const addresses: string[] = []
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (!iface.internal && iface.family === 'IPv4') addresses.push(iface.address)
    }
  }
  return dedupeStrings(addresses)
}

/** Read a Python file from the agent-mcp directory. */
function readAgentMcpFile(filename: string): string {
  return readFileSync(join(resolveBundledAssetDir('agent-mcp'), filename), 'utf-8')
}

function buildClaudeSettingsEnvValues(): ClaudeSettingsEnvValues {
  const effective = getEffectiveClaudeSettings()
  const values: ClaudeSettingsEnvValues = {}
  if (effective.anthropicAuthToken) values.ANTHROPIC_AUTH_TOKEN = effective.anthropicAuthToken
  if (effective.anthropicBaseUrl) values.ANTHROPIC_BASE_URL = effective.anthropicBaseUrl
  if (effective.claudeCodeDisableNonessentialTraffic) {
    values.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = effective.claudeCodeDisableNonessentialTraffic
  }
  return values
}

function buildClaudeCliAuthEnvValues(): ClaudeCliAuthEnvValues {
  const effective = getEffectiveClaudeSettings()
  const values: ClaudeCliAuthEnvValues = {}
  if (effective.anthropicApiKey) values.ANTHROPIC_API_KEY = effective.anthropicApiKey
  if (effective.claudeCodeOAuthToken) values.CLAUDE_CODE_OAUTH_TOKEN = effective.claudeCodeOAuthToken
  return values
}

function mergeClaudeSettingsContent(
  existingContent: string | null | undefined,
  envValues: ClaudeSettingsEnvValues,
): string {
  let root: Record<string, unknown> = {}
  const trimmed = existingContent?.trim()
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        root = { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      root = {}
    }
  }

  const existingEnv = root.env
  const mergedEnv: Record<string, unknown> =
    existingEnv && typeof existingEnv === 'object' && !Array.isArray(existingEnv)
      ? { ...(existingEnv as Record<string, unknown>) }
      : {}

  for (const [key, value] of Object.entries(envValues)) {
    if (value != null && value !== '') {
      mergedEnv[key] = value
    }
  }
  root.env = mergedEnv

  return `${JSON.stringify(root, null, 2)}\n`
}

export function __mergeClaudeSettingsContentForTests(
  existingContent: string | null | undefined,
  envValues: ClaudeSettingsEnvValues,
): string {
  return mergeClaudeSettingsContent(existingContent, envValues)
}

export function __buildClaudeSettingsEnvValuesForTests(): ClaudeSettingsEnvValues {
  return buildClaudeSettingsEnvValues()
}

export function __buildClaudeCliAuthEnvValuesForTests(): ClaudeCliAuthEnvValues {
  return buildClaudeCliAuthEnvValues()
}

async function upsertClaudeSettingsInBox(box: SimpleBox, agentId: string): Promise<void> {
  const envValues = buildClaudeSettingsEnvValues()
  await retriedExec(
    box,
    'bash',
    ['-c', `mkdir -p ${AGENT_DUNE_CLAUDE_PATH} && chown -R abc:abc ${AGENT_DUNE_CLAUDE_PATH}`],
    { DISPLAY: ':1' },
  )

  let existingContent = ''
  const readResult = await retriedExec(
    box,
    'bash',
    ['-lc', `[ -f "${CLAUDE_SETTINGS_PATH}" ] && cat "${CLAUDE_SETTINGS_PATH}" || true`],
    { DISPLAY: ':1' },
  )
  if (readResult.exitCode === 0) {
    existingContent = readResult.stdout
  }

  const nextContent = mergeClaudeSettingsContent(existingContent, envValues)
  await deployFile(box, nextContent, CLAUDE_SETTINGS_PATH)
  console.log(`Updated Claude settings for agent ${agentId}: ${Object.keys(envValues).join(', ') || 'no env overrides'}`)
}

function getAgentSkillsHostPath(agentId: string): string {
  return join(getAgentClaudeHostPath(agentId), 'skills')
}

function getAgentDuneHostPath(agentId: string): string {
  return join(config.agentsRoot, agentId, '.dune')
}

function getAgentClaudeHostPath(agentId: string): string {
  return join(getAgentDuneHostPath(agentId), '.claude')
}

function getAgentClaudeStateHostPath(agentId: string): string {
  return join(getAgentDuneHostPath(agentId), '.claude.json')
}

function getAgentCommunicationHostPath(agentId: string): string {
  return join(getAgentDuneHostPath(agentId), 'system', 'communication')
}

function moveAgentPersistencePathIfNeeded(legacyPath: string, nextPath: string): void {
  if (!existsSync(legacyPath) || existsSync(nextPath)) return

  mkdirSync(dirname(nextPath), { recursive: true })

  try {
    renameSync(legacyPath, nextPath)
    return
  } catch (err: any) {
    if (err?.code !== 'EXDEV') throw err
  }

  const legacyStat = statSync(legacyPath)
  cpSync(legacyPath, nextPath, { recursive: legacyStat.isDirectory() })
  rmSync(legacyPath, { recursive: legacyStat.isDirectory(), force: true })
}

function migrateLegacyAgentPersistence(agentId: string, duneRootHostPath: string): void {
  const legacyRoot = join(config.agentsRoot, agentId)
  mkdirSync(duneRootHostPath, { recursive: true })

  moveAgentPersistencePathIfNeeded(join(legacyRoot, 'memory'), join(duneRootHostPath, 'memory'))
  moveAgentPersistencePathIfNeeded(join(legacyRoot, 'miniapps'), join(duneRootHostPath, 'miniapps'))
  moveAgentPersistencePathIfNeeded(join(legacyRoot, '.claude'), join(duneRootHostPath, '.claude'))
  moveAgentPersistencePathIfNeeded(join(legacyRoot, '.claude.json'), join(duneRootHostPath, '.claude.json'))
}

function ensureAgentRuntimeHostPaths(agentId: string): AgentRuntimeHostPaths {
  const duneRootHostPath = getAgentDuneHostPath(agentId)
  migrateLegacyAgentPersistence(agentId, duneRootHostPath)

  const memoryHostPath = join(duneRootHostPath, 'memory')
  const miniappHostPath = join(duneRootHostPath, 'miniapps')
  const claudeHostPath = getAgentClaudeHostPath(agentId)
  const claudeStateHostPath = getAgentClaudeStateHostPath(agentId)
  const communicationHostPath = getAgentCommunicationHostPath(agentId)

  mkdirSync(duneRootHostPath, { recursive: true })
  mkdirSync(memoryHostPath, { recursive: true })
  mkdirSync(miniappHostPath, { recursive: true })
  mkdirSync(claudeHostPath, { recursive: true })
  mkdirSync(communicationHostPath, { recursive: true })
  if (!existsSync(claudeStateHostPath)) {
    writeFileSync(claudeStateHostPath, '{}\n', 'utf-8')
  }

  return {
    duneRootHostPath,
    memoryHostPath,
    miniappHostPath,
    claudeHostPath,
    claudeStateHostPath,
    communicationHostPath,
  }
}

type CommunicationDaemonAssetSyncResult = {
  rootHostPath: string
  assetHash: string
  changed: boolean
}

function syncCommunicationDaemonAssets(agentId: string): CommunicationDaemonAssetSyncResult {
  const runtimeHostPaths = ensureAgentRuntimeHostPaths(agentId)
  const rootHostPath = runtimeHostPaths.duneRootHostPath
  const rpcCode = readAgentMcpFile('rpc.py')
  const listenerCode = readAgentMcpFile('listener.py')
  const assets = [
    { hostPath: join(rootHostPath, 'rpc.py'), content: rpcCode },
    { hostPath: join(rootHostPath, 'listener.py'), content: listenerCode },
  ]

  mkdirSync(rootHostPath, { recursive: true })

  // Clean up legacy daemon files from old path (system/communication/)
  const legacyCommunicationPath = join(rootHostPath, 'system', 'communication')
  if (existsSync(legacyCommunicationPath)) {
    rmSync(legacyCommunicationPath, { recursive: true, force: true })
  }

  let changed = false
  for (const asset of assets) {
    const existing = existsSync(asset.hostPath) ? readFileSync(asset.hostPath, 'utf-8') : null
    if (existing === asset.content) continue
    writeFileSync(asset.hostPath, asset.content, 'utf-8')
    changed = true
  }

  const assetHash = createHash('sha256').update(rpcCode).update('\0').update(listenerCode).digest('hex')
  return { rootHostPath, assetHash, changed }
}

export function __syncCommunicationDaemonAssetsForTests(agentId: string): CommunicationDaemonAssetSyncResult {
  return syncCommunicationDaemonAssets(agentId)
}

function collectFilesRecursive(rootDir: string, prefix = ''): string[] {
  const dirPath = prefix ? join(rootDir, prefix) : rootDir
  const files: string[] = []
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursive(rootDir, relPath))
    } else if (entry.isFile()) {
      files.push(relPath)
    }
  }
  return files
}

function fingerprintDirectory(rootDir: string): string {
  const hash = createHash('sha256')
  const files = collectFilesRecursive(rootDir).sort()
  for (const relPath of files) {
    const absolutePath = join(rootDir, relPath)
    hash.update(relPath)
    hash.update('\0')
    hash.update(readFileSync(absolutePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function syncSkillDirectory(sourceDir: string, targetDir: string): boolean {
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    throw new Error(`Missing bundled skill source directory: ${sourceDir}`)
  }

  const sourceFingerprint = fingerprintDirectory(sourceDir)
  const markerPath = join(targetDir, AGENT_SKILL_FINGERPRINT_FILE)
  const currentFingerprint = existsSync(markerPath)
    ? readFileSync(markerPath, 'utf-8').trim()
    : ''

  if (existsSync(targetDir) && currentFingerprint === sourceFingerprint) {
    return false
  }

  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(sourceDir, targetDir, { recursive: true })
  writeFileSync(markerPath, `${sourceFingerprint}\n`, 'utf-8')
  return true
}

function syncAgentSkills(agentId: string): void {
  const hostSkillsRoot = getAgentSkillsHostPath(agentId)
  mkdirSync(hostSkillsRoot, { recursive: true })

  const agent = agentStore.getAgent(agentId)
  const enabledSkills = getBuiltinAgentSkillNames(agent)

  for (const skillName of enabledSkills) {
    const sourceDir = join(AGENT_SKILLS_SOURCE_DIR, skillName)
    const targetDir = join(hostSkillsRoot, skillName)
    const changed = syncSkillDirectory(sourceDir, targetDir)
    console.log(`${changed ? 'Synced' : 'Verified'} agent skill "${skillName}" for agent ${agentId}`)
  }

  for (const skillName of AGENT_SKILLS) {
    if (enabledSkills.includes(skillName)) continue
    rmSync(join(hostSkillsRoot, skillName), { recursive: true, force: true })
  }
}

/** Run box.exec with a timeout. BoxLite exec can hang if the container socket dies. */
async function timedExec(
  box: SimpleBox, cmd: string, args: string[], env: Record<string, string>, timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const execPromise = box.exec(cmd, args, env)
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`box.exec timed out after ${timeoutMs}ms: ${cmd} ${args[0] ?? ''}`)), timeoutMs)
  )
  return Promise.race([execPromise, timeoutPromise])
}

/** Run box.exec with timeout + retry. For startup paths where transient gRPC hangs are common. */
async function retriedExec(
  box: SimpleBox, cmd: string, args: string[], env: Record<string, string>,
  timeoutMs = 30_000, maxRetries = 3,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await timedExec(box, cmd, args, env, timeoutMs)
    } catch (err: any) {
      const msg = err.message || ''
      const isTransient = msg.includes('transport error')
        || msg.includes('spawn_failed')
        || msg.includes('timed out')
        || msg.includes('notify socket')
        || msg.includes('Libcontainer')
      if (!isTransient || attempt === maxRetries) throw err
      console.warn(`[retry ${attempt}/${maxRetries}] ${cmd} ${args[0]?.slice(0, 30)}... failed: ${msg.slice(0, 100)}`)
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  throw new Error('unreachable')
}

function summarizeExecOutput(output: string, max = 240): string {
  if (!output) return ''
  const compact = output.replace(/\s+/g, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, max)}...`
}

async function execChecked(
  box: SimpleBox,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 30_000,
  maxRetries = 3,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await retriedExec(box, cmd, args, env, timeoutMs, maxRetries)
  if (result.exitCode !== 0) {
    const stdout = summarizeExecOutput(result.stdout)
    const stderr = summarizeExecOutput(result.stderr)
    throw new Error(
      `Command failed: ${cmd} ${args.join(' ')} (exit ${result.exitCode})`
      + `${stdout ? ` stdout="${stdout}"` : ''}`
      + `${stderr ? ` stderr="${stderr}"` : ''}`,
    )
  }
  return result
}

async function resolveNginxConfigPath(box: SimpleBox): Promise<string> {
  for (const path of NGINX_CONFIG_CANDIDATES) {
    const probe = await retriedExec(box, 'bash', ['-lc', `[ -f "${path}" ] && echo "${path}"`], { DISPLAY: ':1' }, 10_000, 2)
    if (probe.exitCode === 0 && probe.stdout.trim() === path) {
      return path
    }
  }
  throw new Error(`No nginx default config found in known paths: ${NGINX_CONFIG_CANDIDATES.join(', ')}`)
}

async function readContainerTextFile(box: SimpleBox, path: string): Promise<string> {
  const result = await execChecked(
    box,
    'python3',
    ['-c', 'import sys; print(open(sys.argv[1]).read(), end="")', path],
    { DISPLAY: ':1' },
    20_000,
    2,
  )
  return result.stdout
}

async function writeContainerTextFile(box: SimpleBox, path: string, content: string): Promise<void> {
  await execChecked(
    box,
    'python3',
    ['-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])', path, content],
    { DISPLAY: ':1' },
    20_000,
    2,
  )
}

async function ensureMiniappNginxConfiguredInBox(box: SimpleBox, agentId: string): Promise<void> {
  const configPath = await resolveNginxConfigPath(box)
  const currentConfig = await readContainerTextFile(box, configPath)
  const patched = patchMiniappNginxRouting(currentConfig)
  if (patched.changed) {
    await writeContainerTextFile(box, configPath, patched.text)
  }

  await execChecked(box, 'bash', ['-lc', 'nginx -t'], { DISPLAY: ':1' }, 20_000, 2)
  await execChecked(box, 'bash', ['-lc', 'nginx -s reload'], { DISPLAY: ':1' }, 20_000, 2)
  console.log(`${patched.changed ? 'Patched' : 'Verified'} nginx miniapp routes for agent ${agentId}`)
}

/** Run a command with real-time stdout streaming via BoxLite's low-level exec API.
 *  Each stdout line triggers the onStdoutLine callback immediately — no buffering. */
const ABORTED_SENTINEL = Symbol('aborted')

async function streamingExec(
  box: SimpleBox,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  onStdoutLine: (line: string) => void,
  timeoutMs = 300_000,
  onExecutionStart?: (execution: { kill: () => Promise<void> } | null) => void,
  abortSignal?: Promise<void>,
): Promise<{ exitCode: number; stdout: string; stderr: string; aborted?: boolean }> {
  // Access the low-level JsBox for streaming (SimpleBox._ensureBox is protected)
  const rawBox = await (box as any)._ensureBox()
  const envArray = Object.entries(env).map(([k, v]) => [k, v])
  const execution = await rawBox.exec(cmd, args, envArray, false)
  onExecutionStart?.(execution)

  const stdoutLines: string[] = []
  const stderrLines: string[] = []

  let timedOut = false
  let aborted = false
  const abortPromise = abortSignal?.then(() => ABORTED_SENTINEL)
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null
  const resetTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      timedOut = true
      execution.kill().catch(() => {})
    }, timeoutMs)
  }
  resetTimer()

  try {
    const stdoutStream = await execution.stdout().catch((err: any) => {
      console.error(`[streamingExec] stdout() failed: ${err?.message}`)
      return null
    })
    const stderrStream = await execution.stderr().catch((err: any) => {
      console.error(`[streamingExec] stderr() failed: ${err?.message}`)
      return null
    })

    if (!stdoutStream) console.warn(`[streamingExec] stdoutStream is NULL for: ${cmd} ${args[0]?.slice(0, 50)}`)

    const readStdout = async () => {
      if (!stdoutStream) return
      let buffer = ''
      let lineCount = 0
      while (true) {
        const next = stdoutStream.next()
        const chunk = abortPromise ? await Promise.race([next, abortPromise]) : await next
        if (chunk === ABORTED_SENTINEL || chunk === null) {
          if (chunk === ABORTED_SENTINEL) aborted = true
          if (buffer) {
            lineCount++
            stdoutLines.push(buffer)
            onStdoutLine(buffer)
          }
          break
        }
        buffer += chunk
        // Split by newlines — emit complete lines, keep partial remainder in buffer
        const parts = buffer.split('\n')
        buffer = parts.pop()!  // last element is either '' (if chunk ended with \n) or partial
        for (const line of parts) {
          if (!line) continue  // skip empty lines from consecutive \n
          lineCount++
          if (lineCount <= 3) console.log(`[streamingExec] stdout line ${lineCount}: ${line.slice(0, 120)}`)
          stdoutLines.push(line)
          onStdoutLine(line)
          resetTimer()
        }
      }
      console.log(`[streamingExec] stdout total lines: ${lineCount}${aborted ? ' (aborted)' : ''}`)
    }

    const readStderr = async () => {
      if (!stderrStream) return
      while (true) {
        const next = stderrStream.next()
        const line = abortPromise ? await Promise.race([next, abortPromise]) : await next
        if (line === ABORTED_SENTINEL || line === null) break
        stderrLines.push(line as string)
      }
    }

    await Promise.all([readStdout(), readStderr()])

    if (aborted) {
      // Kill the execution and wait briefly so it doesn't linger in the container
      // and conflict with the next CLI invocation (e.g. --continue session lock)
      await execution.kill().catch(() => {})
      return {
        exitCode: 130,
        stdout: stdoutLines.join(''),
        stderr: stderrLines.join(''),
        aborted: true,
      }
    }

    const result = await execution.wait()

    if (timedOut) {
      throw new Error(`streamingExec timed out after ${timeoutMs}ms: ${cmd}`)
    }

    return {
      exitCode: result.exitCode,
      stdout: stdoutLines.join(''),
      stderr: stderrLines.join(''),
    }
  } finally {
    onExecutionStart?.(null)
    if (inactivityTimer) clearTimeout(inactivityTimer)
  }
}

/** Parse a single stream-json line from Claude CLI into log entries. */
function parseStreamJsonLine(parsed: any, agentId: string): AgentLogEntry[] {
  const entries: AgentLogEntry[] = []

  if (parsed.type === 'assistant') {
    const content = parsed.message?.content || []
    for (const block of content) {
      if (block.type === 'text') {
        entries.push({ id: newEventId(), agentId, timestamp: Date.now(),
          type: 'text', data: { text: block.text } })
      } else if (block.type === 'tool_use') {
        entries.push({ id: newEventId(), agentId, timestamp: Date.now(),
          type: 'tool_use', data: { toolName: block.name, toolId: block.id, input: block.input } })
      } else if (block.type === 'tool_result') {
        entries.push({ id: newEventId(), agentId, timestamp: Date.now(),
          type: 'tool_result', data: {
            toolId: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            isError: !!block.is_error,
          } })
      }
    }
  } else if (parsed.type === 'user') {
    // User messages contain tool_result blocks in the CLI stream-json format
    const content = parsed.message?.content || []
    for (const block of content) {
      if (block.type === 'tool_result') {
        const blockContent = block.content
        const contentStr = typeof blockContent === 'string' ? blockContent
          : Array.isArray(blockContent) ? blockContent.map((c: any) => typeof c === 'string' ? c : c.text || JSON.stringify(c)).join('')
          : JSON.stringify(blockContent)
        entries.push({ id: newEventId(), agentId, timestamp: Date.now(),
          type: 'tool_result', data: {
            toolId: block.tool_use_id || '',
            content: contentStr?.slice(0, 5000) || '',
            isError: !!block.is_error,
          } })
      }
    }
  } else if (parsed.type === 'result') {
    entries.push({ id: newEventId(), agentId, timestamp: Date.now(),
      type: 'result', data: {
        durationMs: parsed.duration_ms,
        numTurns: parsed.num_turns,
        totalCostUsd: parsed.total_cost_usd,
      } })
  }

  return entries
}

type RuntimeLogChannel = 'stdout' | 'stderr' | 'lifecycle' | 'status'

function emitAgentLogEntries(agentId: string, entries: AgentLogEntry[]): void {
  if (entries.length === 0) return
  agentLogStore.addAgentLogs(agentId, entries)
  broadcastAll({ type: 'agent:log', payload: { agentId, entries } })
}

function emitRuntimeLog(
  agentId: string,
  channel: RuntimeLogChannel,
  message: string,
  metadata: Record<string, unknown> = {},
): void {
  const entry: AgentLogEntry = {
    id: newEventId(),
    agentId,
    timestamp: Date.now(),
    type: 'runtime',
    data: {
      channel,
      message,
      ...metadata,
    },
  }
  emitAgentLogEntries(agentId, [entry])
}

function setAgentStatus(
  agentId: string,
  status: AgentStatusType,
  options: {
    broadcast?: boolean
    reason?: string
    source?: string
    logRuntime?: boolean
  } = {},
): void {
  const shouldBroadcast = options.broadcast ?? true
  const shouldLogRuntime = options.logRuntime ?? true
  agentStore.updateAgentStatus(agentId, status)
  if (shouldBroadcast) {
    broadcastAll({ type: 'agent:status', payload: { agentId, status } })
  }
  if (shouldLogRuntime) {
    const message = options.reason ? `${status} (${options.reason})` : status
    emitRuntimeLog(agentId, 'status', message, {
      status,
      reason: options.reason ?? null,
      source: options.source ?? 'agent-manager',
    })
  }
}

/** Deploy a file into the container via BoxLite's native copyIn.
 *  Writes content to a host temp file, copies it in, then chowns to abc. */
async function deployFile(box: SimpleBox, content: string, destPath: string): Promise<void> {
  // Base64 encode to avoid shell escaping issues and large argument limits.
  // base64 output is alphanumeric+/= — safe inside single quotes.
  const b64 = Buffer.from(content).toString('base64')
  await execChecked(box, 'bash', ['-c',
    `printf '%s' '${b64}' | base64 -d > ${destPath} && chown abc:abc ${destPath}`
  ], { DISPLAY: ':1' })
}

async function prepareAgentConfigFacadeInBox(box: SimpleBox): Promise<void> {
  await execChecked(
    box,
    'python3',
    [
      '-c',
      `import os, pathlib, shutil, sys
dune_root, dune_memory, dune_miniapps, dune_claude, dune_state, memory_link, miniapps_link, claude_link, state_link = sys.argv[1:]
for path in (dune_root, dune_memory, dune_miniapps, dune_claude, os.path.join(dune_claude, 'skills')):
    os.makedirs(path, exist_ok=True)
if not os.path.exists(dune_state):
    pathlib.Path(dune_state).write_text('{}\\n')
for link_path, target_path in (
    (memory_link, dune_memory),
    (miniapps_link, dune_miniapps),
    (claude_link, dune_claude),
    (state_link, dune_state),
):
    if os.path.lexists(link_path):
        if os.path.islink(link_path) or os.path.isfile(link_path):
            os.unlink(link_path)
        else:
            shutil.rmtree(link_path)
    os.symlink(target_path, link_path)
`,
      AGENT_DUNE_VOLUME_PATH,
      AGENT_DUNE_MEMORY_PATH,
      AGENT_DUNE_MINIAPPS_PATH,
      AGENT_DUNE_CLAUDE_PATH,
      AGENT_DUNE_CLAUDE_STATE_PATH,
      AGENT_MEMORY_VOLUME_PATH,
      AGENT_MINIAPP_VOLUME_PATH,
      AGENT_CLAUDE_VOLUME_PATH,
      CLAUDE_STATE_PATH,
    ],
    { DISPLAY: ':1' },
    20_000,
    2,
  )

  await retriedExec(
    box,
    'bash',
    ['-c', `chown -R abc:abc ${AGENT_DUNE_VOLUME_PATH} 2>/dev/null; true`],
    { DISPLAY: ':1' },
    20_000,
    2,
  )
}

export async function __prepareAgentConfigFacadeInBoxForTests(box: SimpleBox): Promise<void> {
  await prepareAgentConfigFacadeInBox(box)
}

function escapeShellSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''")
}

function buildEnvAssignments(values: Record<string, string | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}='${escapeShellSingleQuotes(value || '')}'`)
    .join(' ')
}

async function startCommunicationDaemons(
  box: SimpleBox,
  agentId: string,
  wsUrl: string,
): Promise<void> {
  const listenerEnv = buildEnvAssignments({
    DUNE_WS_URL: wsUrl,
    AGENT_ID: agentId,
    DUNE_RPC_SCRIPT: RPC_GUEST_PATH,
  })
  await retriedExec(
    box,
    'bash',
    ['-c', `nohup runuser -u abc -- env ${listenerEnv} python3 ${LISTENER_GUEST_PATH} > /tmp/listener.log 2>&1 &`],
    { DISPLAY: ':1' },
  )
  console.log(`Listener started for agent ${agentId}`)
}

async function stopCommunicationDaemons(box: SimpleBox): Promise<void> {
  await timedExec(
    box,
    'bash',
    ['-c', `pkill -f "${LISTENER_PROCESS_PATTERN}" 2>/dev/null; true`],
    { DISPLAY: ':1' },
    10_000,
  )
}

type CommunicationDaemonProcessStatus = {
  listenerRunning: boolean
}

async function getCommunicationDaemonProcessStatus(box: SimpleBox): Promise<CommunicationDaemonProcessStatus> {
  const result = await retriedExec(
    box,
    'bash',
    ['-lc', `listener=0; pgrep -f "${LISTENER_PROCESS_PATTERN}" >/dev/null && listener=1; printf 'listener=%s\\n' "$listener"`],
    { DISPLAY: ':1' },
  )
  return { listenerRunning: /listener=1/.test(result.stdout) }
}

type ReconcileCommunicationDaemonsOptions = {
  wsUrl: string
  daemonAssetHash: string
  force?: boolean
}

async function reconcileCommunicationDaemons(
  running: RunningAgent,
  options: ReconcileCommunicationDaemonsOptions,
): Promise<boolean> {
  const { wsUrl, daemonAssetHash, force = false } = options
  let shouldRestart = force

  if (!shouldRestart) {
    shouldRestart = daemonAssetHash !== (running.daemonAssetHash || '')
  }

  if (!shouldRestart) {
    const processStatus = await getCommunicationDaemonProcessStatus(running.box)
    shouldRestart = !processStatus.listenerRunning
  }

  running.backendUrl = wsUrl
  running.daemonAssetHash = daemonAssetHash

  if (!shouldRestart) {
    return false
  }

  await stopCommunicationDaemons(running.box)
  await startCommunicationDaemons(running.box, running.agent.id, wsUrl)
  return true
}

export async function __reconcileCommunicationDaemonsForTests(
  running: RunningAgent,
  options: ReconcileCommunicationDaemonsOptions,
): Promise<boolean> {
  return reconcileCommunicationDaemons(running, options)
}

export async function __getCommunicationDaemonProcessStatusForTests(
  box: SimpleBox,
): Promise<CommunicationDaemonProcessStatus> {
  return getCommunicationDaemonProcessStatus(box)
}

// ── Startup helpers ─────────────────────────────────────────────────────

/** Emit a system log entry during startup (shows in DM chat view). */
function emitStartupLog(agentId: string, message: string) {
  const entry: AgentLogEntry = {
    id: newEventId(),
    agentId,
    timestamp: Date.now(),
    type: 'system',
    data: { message },
  }
  emitAgentLogEntries(agentId, [entry])
}

/** Abort controllers for in-progress startups, keyed by agentId. */
const startupAbortControllers = new Map<string, AbortController>()
const startupAbortReasons = new Map<string, 'cancel' | 'watchdog'>()
const startupWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Deduplicates concurrent startup attempts. */
const startupPromises = new Map<string, Promise<void>>()

function clearStartupWatchdog(agentId: string): void {
  const timer = startupWatchdogTimers.get(agentId)
  if (timer) {
    clearTimeout(timer)
    startupWatchdogTimers.delete(agentId)
  }
}

function armStartupWatchdog(agentId: string, timeoutMs: number): void {
  clearStartupWatchdog(agentId)
  const effectiveTimeoutMs = Math.max(1_000, timeoutMs) + STARTUP_WATCHDOG_GRACE_MS
  const timer = setTimeout(() => {
    const controller = startupAbortControllers.get(agentId)
    if (!controller || controller.signal.aborted) return

    startupAbortReasons.set(agentId, 'watchdog')
    controller.abort()
    setAgentStatus(agentId, 'error', { source: 'startup-watchdog', reason: `startup timeout after ${effectiveTimeoutMs}ms` })
    emitStartupLog(agentId, `Startup watchdog timeout after ${effectiveTimeoutMs}ms`)
  }, effectiveTimeoutMs)
  timer.unref()
  startupWatchdogTimers.set(agentId, timer)
}

/** Check if startup was cancelled; throw if so. */
function checkAborted(signal: AbortSignal, agentId: string) {
  if (signal.aborted) {
    if (startupAbortReasons.get(agentId) === 'watchdog') {
      throw new Error(`desktop_not_ready: startup_timeout_exceeded timeout_ms=${Math.max(1_000, config.agentStartupTimeoutMs)}`)
    }
    throw new Error(`Startup cancelled for agent ${agentId}`)
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export function cancelStartup(agentId: string): boolean {
  const controller = startupAbortControllers.get(agentId)
  if (!controller) return false
  startupAbortReasons.set(agentId, 'cancel')
  controller.abort()
  return true
}

export async function ensureAgentRunning(agentId: string): Promise<{
  guiHttpPort: number
  guiHttpsPort: number
  width: number
  height: number
}> {
  const running = runningAgents.get(agentId)
  if (running) {
    return {
      guiHttpPort: running.guiHttpPort,
      guiHttpsPort: running.guiHttpsPort,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
    }
  }

  let startup = startupPromises.get(agentId)
  if (!startup) {
    startup = startAgent(agentId)
    startupPromises.set(agentId, startup)
    startup.finally(() => {
      if (startupPromises.get(agentId) === startup) {
        startupPromises.delete(agentId)
      }
    }).catch(() => {})
  }

  await startup
  const screen = getAgentScreen(agentId)
  if (!screen) {
    throw new Error(`Agent ${agentId} did not expose a screen after startup`)
  }
  return screen
}

export async function startAgent(agentId: string): Promise<void> {
  const agent = agentStore.getAgent(agentId)
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  if (runningAgents.has(agentId)) {
    throw new Error(`Agent ${agentId} is already running`)
  }

  // Set up cancellation
  const abortController = new AbortController()
  startupAbortControllers.set(agentId, abortController)
  startupAbortReasons.delete(agentId)
  armStartupWatchdog(agentId, config.agentStartupTimeoutMs)
  const signal = abortController.signal

  // Broadcast 'starting' status
  setAgentStatus(agentId, 'starting', { source: 'start-agent' })

  emitStartupLog(agentId, 'Creating container...')

  const sandboxName = getRuntimeSandboxName(agentId)
  let runtimeState = agentRuntimeStore.getAgentRuntimeState(agentId)
  if (!runtimeState) {
    const ports = await allocateGuiPorts()
    runtimeState = agentRuntimeStore.upsertAgentRuntimeState({
      agentId,
      sandboxName,
      sandboxId: getPendingSandboxId(agentId),
      guiHttpPort: ports.guiHttpPort,
      guiHttpsPort: ports.guiHttpsPort,
    })
  } else if (runtimeState.sandboxName !== sandboxName) {
    runtimeState = agentRuntimeStore.upsertAgentRuntimeState({
      agentId,
      sandboxName,
      sandboxId: runtimeState.sandboxId,
      guiHttpPort: runtimeState.guiHttpPort,
      guiHttpsPort: runtimeState.guiHttpsPort,
      lastStartedAt: runtimeState.lastStartedAt,
      lastStoppedAt: runtimeState.lastStoppedAt,
    })
  }

  const guiHttpPort = runtimeState.guiHttpPort
  const guiHttpsPort = runtimeState.guiHttpsPort

  // Constructor env — DO NOT set HOME/PATH here, it breaks s6-overlay init.
  // Those are set per-exec call via runuser + env instead.
  const env: Record<string, string> = {
    DISPLAY: ':1',
    DISPLAY_SIZEW: String(DISPLAY_WIDTH),
    DISPLAY_SIZEH: String(DISPLAY_HEIGHT),
    SELKIES_MANUAL_WIDTH: String(DISPLAY_WIDTH),
    SELKIES_MANUAL_HEIGHT: String(DISPLAY_HEIGHT),
    SELKIES_UI_SHOW_SIDEBAR: 'false',
    SELKIES_SCALING_DPI: '96',
    GDK_SCALE: '1',
    GDK_DPI_SCALE: '1',
  }
  Object.assign(env, buildClaudeCliAuthEnvValues())

  let backendUrl = ''
  let agentHttpUrl = ''
  let sandboxId = runtimeState.sandboxId
  let box: SimpleBox | null = null
  try {
    // Ensure host storage exists and legacy agent data is migrated into the .dune root.
    const runtimeHostPaths = ensureAgentRuntimeHostPaths(agentId)
    const daemonAssets = syncCommunicationDaemonAssets(agentId)
    syncAgentSkills(agentId)
    // Persist all agent state through the single mounted .dune root.
    const baseVolumes = buildAgentRuntimeBaseVolumes(runtimeHostPaths)
    const runtimeVolumes = buildAgentRuntimeVolumes(agentId, baseVolumes)
    const hasConfiguredMounts = runtimeVolumes.length > baseVolumes.length
    if (hasConfiguredMounts && !isPendingSandboxId(runtimeState.sandboxId)) {
      await resetStoppedAgentRuntimeSandbox(agentId)
      const refreshed = agentRuntimeStore.getAgentRuntimeState(agentId)
      if (refreshed) {
        runtimeState = refreshed
        sandboxId = refreshed.sandboxId
      }
    }

    box = new SimpleBox({
      name: sandboxName,
      reuseExisting: true,
      autoRemove: false,
      detach: false,
      image: SKILLBOX_IMAGE,
      env,
      runtime: getRuntime(),
      memoryMib: SKILLBOX_MEMORY_MIB,
      diskSizeGb: SKILLBOX_DISK_SIZE_GB,
      ports: [
        { hostPort: guiHttpPort, guestPort: 3000 },   // noVNC HTTP
        { hostPort: guiHttpsPort, guestPort: 3001 },   // noVNC HTTPS
      ],
      volumes: runtimeVolumes,
    })

    sandboxId = await box.getId()
    const canResumeInitialSession = canResumePersistedSession(runtimeState, sandboxId)
    if (
      sandboxId !== runtimeState.sandboxId
      || isPendingSandboxId(runtimeState.sandboxId)
      || runtimeState.hasSession !== canResumeInitialSession
    ) {
      runtimeState = agentRuntimeStore.upsertAgentRuntimeState({
        agentId,
        sandboxName,
        sandboxId,
        guiHttpPort,
        guiHttpsPort,
        hasSession: canResumeInitialSession,
        lastStartedAt: runtimeState.lastStartedAt,
        lastStoppedAt: runtimeState.lastStoppedAt,
      })
    }
    upsertManagedRuntimeShadow(agentId, sandboxId, {
      status: 'stopped',
      startedAt: runtimeState.lastStartedAt,
      stoppedAt: runtimeState.lastStoppedAt,
    })

    checkAborted(signal, agentId)

    emitStartupLog(
      agentId,
      `Waiting for desktop environment (timeout=${Math.max(1_000, config.agentStartupTimeoutMs)}ms poll=${Math.max(100, config.agentDesktopPollMs)}ms)...`,
    )

    // Wait for desktop environment to be ready
    console.log(`Waiting for desktop ready (agent ${agentId})...`)
    const desktopReady = await waitUntilDesktopReady(box, signal)
    emitStartupLog(agentId, `Desktop ready after ${desktopReady.probeCount} probes (${desktopReady.matchedMarker})`)
    console.log(`Desktop ready (agent ${agentId})`)
    sandboxId = await box.getId()
    const canResumeDesktopSession = canResumePersistedSession(runtimeState, sandboxId)
    if (
      sandboxId !== runtimeState.sandboxId
      || isPendingSandboxId(runtimeState.sandboxId)
      || runtimeState.hasSession !== canResumeDesktopSession
    ) {
      runtimeState = agentRuntimeStore.upsertAgentRuntimeState({
        agentId,
        sandboxName,
        sandboxId,
        guiHttpPort,
        guiHttpsPort,
        hasSession: canResumeDesktopSession,
        lastStartedAt: runtimeState.lastStartedAt,
        lastStoppedAt: runtimeState.lastStoppedAt,
      })
    }

    checkAborted(signal, agentId)
    emitStartupLog(agentId, 'Configuring browser and services...')

    // Chromium compact UI: even at correct 96 DPI (set via SELKIES_SCALING_DPI env),
    // Chrome's UI is proportionally large at 1024x768. Scale 0.8 makes it compact.
    // /usr/bin/chromium-browser sources /etc/chromium.d/* into CHROMIUM_FLAGS before exec.
    await retriedExec(box, 'bash', ['-c', 'echo \'CHROMIUM_FLAGS="$CHROMIUM_FLAGS --force-device-scale-factor=0.8"\' > /etc/chromium.d/scale-factor'], { DISPLAY: ':1' })

    // Verify Claude CLI is available (pre-installed in SkillBox image)
    await ensureCliInstalled(box)

    emitStartupLog(agentId, 'Preparing persistent config...')
    await prepareAgentConfigFacadeInBox(box)
    emitStartupLog(agentId, 'Persistent config ready.')

    emitStartupLog(agentId, 'Ensuring miniapp nginx routes...')
    await ensureMiniappNginxConfiguredInBox(box, agentId)
    emitStartupLog(agentId, 'Miniapp nginx route ensured.')

    // Write MCP config for the computer tool (separate file — CLI overwrites $HOME/.claude.json)
    await retriedExec(box, 'bash', ['-c', `echo '${MCP_CONFIG}' > ${MCP_CONFIG_PATH} && chown abc:abc ${MCP_CONFIG_PATH}`], { DISPLAY: ':1' })

    emitStartupLog(agentId, 'Updating Claude settings...')
    await upsertClaudeSettingsInBox(box, agentId)
    emitStartupLog(agentId, 'Claude settings ready.')

    // Ensure writable mounted directories for the agent (abc user)
    await retriedExec(
      box,
      'bash',
      ['-c', `mkdir -p ${AGENT_DUNE_MEMORY_PATH} ${AGENT_DUNE_MINIAPPS_PATH} ${AGENT_DUNE_CLAUDE_PATH}/skills && chown -R abc:abc ${AGENT_DUNE_VOLUME_PATH}`],
      { DISPLAY: ':1' },
    )

    checkAborted(signal, agentId)
    emitStartupLog(agentId, 'Deploying communication listener...')

    // ── Start listener daemon via WS ──────
    const backendPort = getBackendPort()
    if (backendPort > 0) {
      // Resolve host IP reachable from inside container
      const hostIps = getHostLanIps()
      const hostAddr = hostIps[0] || '127.0.0.1'
      agentHttpUrl = `http://${hostAddr}:${backendPort}`
      const wsUrl = `ws://${hostAddr}:${backendPort}/ws/agent?agentId=${agentId}`
      backendUrl = wsUrl
      console.log(`Backend host for agent ${agentId}: ${hostAddr} (candidates: ${hostIps.join(', ')})`)
      try {
        await startCommunicationDaemons(box, agentId, wsUrl)
        console.log(`Listener started for agent ${agentId}: ${wsUrl}`)
      } catch (err: any) {
        console.warn(`Failed to start listener for agent ${agentId}: ${err.message}`)
      }
    } else {
      console.warn(`Backend port not detected — listener not deployed for agent ${agentId}`)
    }

    if (isPendingSandboxId(sandboxId)) {
      sandboxId = await box.getId()
    }
    runtimeState = agentRuntimeStore.upsertAgentRuntimeState({
      agentId,
      sandboxName,
      sandboxId,
      guiHttpPort,
      guiHttpsPort,
      hasSession: runtimeState.hasSession,
      lastStartedAt: runtimeState.lastStartedAt,
      lastStoppedAt: runtimeState.lastStoppedAt,
    })
    const startedAt = Date.now()
    agentRuntimeStore.touchAgentRuntimeStarted(agentId, startedAt)
    upsertManagedRuntimeShadow(agentId, runtimeState.sandboxId, {
      status: 'running',
      startedAt,
      stoppedAt: null,
    })

    runningAgents.set(agentId, {
      box,
      agent,
      sandboxId: runtimeState.sandboxId,
      guiHttpPort,
      guiHttpsPort,
      backendUrl,
      agentHttpUrl,
      daemonAssetHash: daemonAssets.assetHash,
      cliInstalled: true,
      hasSession: runtimeState.hasSession,
      startedAt,
      thinkingSince: 0,
      currentExecution: null,
      interruptRequested: false,
      interruptAbort: null,
    })

    setAgentStatus(agentId, 'idle', { source: 'start-agent', broadcast: false })
    emitStartupLog(agentId, 'Agent ready')

    // Broadcast screen info so frontend can show noVNC iframe
    broadcastAll({
      type: 'agent:screen',
      payload: { agentId, guiHttpPort, guiHttpsPort, width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
    })
  } catch (err) {
    // Clean up the box if any setup step fails (including cancellation)
    if (box) {
      try {
        await Promise.race([box.stop(), new Promise<never>((_, r) => setTimeout(() => r(new Error('cleanup timeout')), 15_000))])
      } catch {}
    }
    if (!isPendingSandboxId(sandboxId)) {
      const failedAt = Date.now()
      agentRuntimeStore.touchAgentRuntimeStopped(agentId, failedAt)
      const latestState = agentRuntimeStore.getAgentRuntimeState(agentId)
      if (latestState) runtimeState = latestState
      upsertManagedRuntimeShadow(agentId, sandboxId, {
        status: 'stopped',
        startedAt: runtimeState.lastStartedAt,
        stoppedAt: failedAt,
      })
    }
    const abortReason = startupAbortReasons.get(agentId)
    if (signal.aborted && abortReason === 'cancel') {
      setAgentStatus(agentId, 'stopped', { source: 'start-agent', reason: 'startup cancelled' })
      emitStartupLog(agentId, 'Startup cancelled')
    } else {
      // Non-cancellation failure: reset status so agent doesn't stay stuck on 'starting'
      const errorMessage = (err as Error).message?.slice(0, 900) || 'unknown error'
      setAgentStatus(agentId, 'error', { source: 'start-agent', reason: errorMessage })
      emitStartupLog(agentId, `Startup failed: ${errorMessage}`)
    }
    throw err
  } finally {
    clearStartupWatchdog(agentId)
    startupAbortControllers.delete(agentId)
    startupAbortReasons.delete(agentId)
  }
}

export async function stopAgent(agentId: string): Promise<void> {
  const running = runningAgents.get(agentId)
  if (running) {
    // Ask the agent to save memories before shutdown (only if it had a session)
    if (running.hasSession) {
      try {
        setAgentStatus(agentId, 'stopping', { source: 'stop-agent' })

        await Promise.race([
          _sendMessageInner(agentId, running, [{
            authorName: 'System',
            content: STOP_AGENT_SHUTDOWN_PROMPT,
          }]),
          new Promise<string>((resolve) => setTimeout(() => resolve('[TIMEOUT]'), 30_000)),
        ])
      } catch {
        // Memory dump failure must never block shutdown
      }
    }

    try {
      // Timeout box.stop() to prevent hanging if container is stuck
      await Promise.race([
        running.box.stop(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('box.stop() timed out')), 30_000)),
      ])
    } catch (err: any) {
      console.error(`Failed to stop box for agent ${agentId}:`, err.message)
    }
    runningAgents.delete(agentId)
    clearGrantsForAgent(agentId)
  }
  const stoppedAt = Date.now()
  agentRuntimeStore.touchAgentRuntimeStopped(agentId, stoppedAt)
  const runtimeState = agentRuntimeStore.getAgentRuntimeState(agentId)
  if (runtimeState) {
    upsertManagedRuntimeShadow(agentId, runtimeState.sandboxId, {
      status: 'stopped',
      startedAt: runtimeState.lastStartedAt,
      stoppedAt,
    })
  }
  setAgentStatus(agentId, 'stopped', { source: 'stop-agent', broadcast: false })
}

export async function interruptAgentWorkflow(agentId: string): Promise<boolean> {
  const running = runningAgents.get(agentId)
  if (!running) return false
  const hasActiveTurn = Boolean(running.currentExecution) || running.thinkingSince > 0 || agentLocks.has(agentId)
  if (!hasActiveTurn) return false

  running.interruptRequested = true
  triggerInterruptSignals(agentId, running)

  // Safety net: if the abort signal + kill didn't finalize within 3s, force-reset
  setTimeout(() => {
    const current = runningAgents.get(agentId)
    if (!current || !current.interruptRequested) return
    const agent = agentStore.getAgent(agentId)
    if (!agent || (agent.status !== 'thinking' && agent.status !== 'responding')) return
    console.warn(`[${agentId}] Interrupt safety timeout — force-resetting to idle`)
    current.thinkingSince = 0
    current.currentExecution = null
    current.interruptRequested = false
    current.interruptAbort = null
    // Release the agent lock so new messages can be sent
    agentLocks.delete(agentId)
    setAgentStatus(agentId, 'idle', { source: 'interrupt-timeout', reason: 'interrupt did not finalize within 3s' })
    emitAgentLogEntries(agentId, [{
      id: newEventId(),
      agentId,
      timestamp: Date.now(),
      type: 'system',
      data: { message: 'Workflow interrupted (forced timeout).' },
    }])
  }, 3_000)

  return true
}

function triggerInterruptSignals(agentId: string, running: RunningAgent): void {
  if (running.currentExecution) {
    running.currentExecution.kill().then(() => {
      console.log(`[${agentId}] execution.kill() succeeded`)
    }).catch((err: any) => {
      console.warn(`[${agentId}] execution.kill() failed: ${err?.message || err}`)
    })
  } else {
    console.warn(`[${agentId}] interrupt: no currentExecution to kill`)
  }

  const interruptPattern = `/tmp/system-prompt-${agentId}.txt`
  const interruptScript = [
    `self="$$"`,
    `targets="$(ps -eo pid=,args= | awk -v self="$self" 'index($0, "${interruptPattern}") && $1 != self { print $1 }')"`,
    `if [ -n "$targets" ]; then`,
    `  kill -KILL $targets 2>/dev/null || true`,
    `fi`,
  ].join('; ')
  void running.box.exec('bash', ['-lc', interruptScript], { DISPLAY: ':1' }).catch((err: any) => {
    console.warn(`[${agentId}] Failed to interrupt current workflow via process kill fallback: ${err?.message || err}`)
  })

  // Resolve the abort signal so streamingExec unblocks immediately
  if (running.interruptAbort) {
    running.interruptAbort.resolve()
    running.interruptAbort = null
  }
}

// Per-agent cooldown for idle todo reminders (prevents infinite DM loops)
const todoReminderCooldowns = new Map<string, number>()
const TODO_REMINDER_COOLDOWN_MS = 5 * 60_000 // 5 minutes
const TODO_REMINDER_SWEEP_INTERVAL_MS = 60_000 // 60 seconds

// Per-agent lock to prevent concurrent sendMessage calls (orchestrator push + daemon poll overlap)
const agentLocks = new Map<string, Promise<string>>()

type TodoReminderKind = 'idle' | 'overdue' | 'no-pending'
type TodoReminderPayload = { kind: TodoReminderKind; content: string }
type TodoReminderEnqueue = (agentId: string, payload: TodoReminderPayload, remindedAt: number) => void
type TodoReminderMetadata = { kind: TodoReminderKind; remindedAt: number }
type LeaderPdca = {
  thesis: 'unchanged' | 'revised'
  plan: {
    owner: string
    deliverable: string
    due: string
    success: string
  }
  do: string
  check: string
  act: string
  obstacle: 'cleared' | 'rerouted' | 'escalated' | 'exhausted'
  outcome: 'advanced' | 'blocked'
}
type LeaderToolUse = {
  toolName: string
  input: unknown
}
type LeaderPolicyViolation = {
  toolName: string
  reason: string
}
type TodoReminderTurnResolution = {
  consumeCooldown: boolean
  allowImmediateRequeue: boolean
  pdca: LeaderPdca | null
  policyViolation: LeaderPolicyViolation | null
}

const LEADER_PDCA_TEMPLATE_LINES = [
  'Leader PDCA',
  'Thesis: unchanged|revised',
  'Plan: owner=<agent|human>; deliverable=<one sentence>; due=<time|none>; success=<one sentence>',
  'Do: <delegation/reassignment/escalation action taken this turn>',
  'Check: <current evidence or status against success criteria>',
  'Act: <next concrete control action>',
  'Obstacle: cleared|rerouted|escalated|exhausted',
  'Outcome: advanced|blocked',
] as const

const LEADER_ALLOWED_READ_ONLY_TOOL_NAMES = new Set([
  'Bash',
  'Read',
  'Glob',
  'Grep',
  'LS',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'KillBash',
])

const LEADER_MUTATING_TOOL_NAMES = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Task',
  'computer',
])

function formatTodoForReminder(todo: Todo): string {
  const lines = [
    `- "${todo.title}" (id: ${todo.id}, due ${new Date(todo.dueAt).toLocaleString()})`,
    `  originalTitle: ${JSON.stringify(todo.originalTitle)}`,
  ]
  if (todo.originalDescription) lines.push(`  originalDescription: ${JSON.stringify(todo.originalDescription)}`)
  if (todo.description && todo.description !== todo.originalDescription) {
    lines.push(`  currentDescription: ${JSON.stringify(todo.description)}`)
  }
  if (todo.nextPlan) lines.push(`  nextPlan: ${JSON.stringify(todo.nextPlan)}`)
  return lines.join('\n')
}

function getLeaderPdcaFooterInstructions(): string[] {
  return [
    '- End your reply with this exact footer:',
    ...LEADER_PDCA_TEMPLATE_LINES,
  ]
}

function buildLeaderIdleTodoReminder(agent: Agent, pending: Todo[]): TodoReminderPayload {
  const activeTodo = pending[0]
  const activeTodoSummary = activeTodo
    ? [
        `Active todo: "${activeTodo.title}" (id: ${activeTodo.id})`,
        `Original request: ${JSON.stringify(activeTodo.originalTitle)}`,
        activeTodo.originalDescription ? `Original details: ${JSON.stringify(activeTodo.originalDescription)}` : null,
        activeTodo.nextPlan ? `Current nextPlan: ${JSON.stringify(activeTodo.nextPlan)}` : 'Current nextPlan: (empty)',
      ].filter(Boolean).join('\n')
    : 'Active todo: none'

  return {
    kind: 'idle',
    content: [
      `You are idle as the ${agent.role}. Use dune-leader now.`,
      '',
      'Pending coordination todos:',
      pending.map(formatTodoForReminder).join('\n'),
      '',
      activeTodoSummary,
      '',
      'Run one leader-only PDCA cycle:',
      '- Reassess the mission from available evidence.',
      `- Revise ${LEADER_THESIS_MEMORY_PATH} only if the mission materially changed.`,
      '- Select one objective and define the owner, deliverable, due time, and success criteria.',
      '- Delegate or reassign the work through a follower-owned todo plus a concise instruction message.',
      '- Review follower replies, todo state, or delivered artifacts against the stated success criteria.',
      '- Accept, redirect, escalate, or reassign based on that review.',
      '- Do not implement directly yourself. If no suitable follower exists, create or recruit one before delegating.',
      `- Use nextPlan and ${TODO_HANDOFF_MEMORY_PATH} only as optional operational notes after the cycle.`,
      '- Before claiming Outcome: blocked, exhaust obstacle-removal in order: re-scope, reassign, recruit, gather context, reroute, escalate sideways, then escalate to human as last resort.',
      '- If you escalate to a human, also assign any parallelizable work and set a concrete follow-up action.',
      '- Do not passively wait after escalation.',
      ...getLeaderPdcaFooterInstructions(),
      'Use your dune-leader skill plus dune-communication, dune-team-manager, dune-todo, or the local Dune API as needed.',
    ].join('\n'),
  }
}

function buildFollowerIdleTodoReminder(agent: Agent, pending: Todo[]): TodoReminderPayload {
  return {
    kind: 'idle',
    content: [
      `You are idle as the ${agent.role}. Preserve the original todo request before you pause.`,
      '',
      'Pending todos:',
      pending.map(formatTodoForReminder).join('\n'),
      '',
      'Before you drift:',
      '- Preserve originalTitle and originalDescription exactly. They are the immutable original request snapshot.',
      '- Put progress in title, description, nextPlan, or memory instead of overwriting the original request snapshot.',
      `- Refresh ${TODO_HANDOFF_MEMORY_PATH} with an "Original Request Snapshot" that lists each pending todo ID, the original request, and any current working notes.`,
      `- If you no longer have a pending heartbeat, create one due about ${TODO_HEARTBEAT_DELAY_MINUTES} minutes from now.`,
      'Use your dune-todo skill and the local Dune API.',
    ].join('\n'),
  }
}

function buildOverdueTodoReminder(agent: Agent, overdue: Todo[]): TodoReminderPayload {
  const roleSpecificTail = agent.role === 'leader'
    ? [
        '- Use dune-leader to run one follow-up PDCA cycle after triage.',
        `- Revise ${LEADER_THESIS_MEMORY_PATH} only if the mission materially changed.`,
        '- Treat overdue leader todos as coordination follow-ups, not implementation work.',
        '- Follow up with the owner, reassign, escalate, or recruit a follower if none is suitable.',
        '- Do not implement directly yourself.',
        `- Use nextPlan and ${TODO_HANDOFF_MEMORY_PATH} only as optional operational notes after the cycle.`,
        '- Before claiming Outcome: blocked, exhaust obstacle-removal in order: re-scope, reassign, recruit, gather context, reroute, escalate sideways, then escalate to human as last resort.',
        '- If you escalate to a human, also assign any parallelizable work and set a concrete follow-up action.',
        '- Do not passively wait after escalation.',
        ...getLeaderPdcaFooterInstructions(),
      ]
    : [
        '- After you triage the overdue todo(s), preserve originalTitle and originalDescription for any remaining pending work.',
        `- Refresh ${TODO_HANDOFF_MEMORY_PATH} with the original request snapshot for the pending work that remains.`,
      ]

  return {
    kind: 'overdue',
    content: [
      `You are idle as the ${agent.role} and you have ${overdue.length} overdue todo(s):`,
      overdue.map(formatTodoForReminder).join('\n'),
      '',
      'Triage them now:',
      '- Mark completed work done or reschedule it with a new dueAt.',
      ...roleSpecificTail,
      `Use your ${agent.role === 'leader' ? 'dune-leader skill plus dune-communication, dune-team-manager, dune-todo, or the local Dune API' : 'dune-todo skill and the local Dune API'}.`,
    ].join('\n'),
  }
}

function buildNoPendingTodoReminder(agent: Agent): TodoReminderPayload {
  const roleSpecificTail = agent.role === 'leader'
    ? [
        '- Use dune-leader to reassess the mission and pick one delegable objective now.',
        `- Revise ${LEADER_THESIS_MEMORY_PATH} only if the mission materially changed.`,
        '- Define the owner, deliverable, due time, and success criteria for that objective.',
        '- If no suitable follower exists, create or recruit one before delegating.',
        '- Assign the work through a follower-owned todo plus a concise instruction message.',
        '- Do not implement directly yourself.',
        `- Use nextPlan and ${TODO_HANDOFF_MEMORY_PATH} only as optional operational notes after the cycle.`,
        '- Before claiming Outcome: blocked, exhaust obstacle-removal in order: re-scope, reassign, recruit, gather context, reroute, escalate sideways, then escalate to human as last resort.',
        '- If you escalate to a human, also assign any parallelizable work and set a concrete follow-up action.',
        '- Do not passively wait after escalation.',
        ...getLeaderPdcaFooterInstructions(),
      ]
    : [
        '- Treat the title and description you create as the original request snapshot for the new heartbeat todo.',
        `- Refresh ${TODO_HANDOFF_MEMORY_PATH} with the original request snapshot for the new todo.`,
      ]

  return {
    kind: 'no-pending',
    content: [
      `You are idle as the ${agent.role} and you have no pending todos.`,
      ...(agent.role === 'leader'
        ? roleSpecificTail
        : [
            `Create a new pending heartbeat todo due about ${TODO_HEARTBEAT_DELAY_MINUTES} minutes from now.`,
            '- The todo title and description become the immutable original request snapshot automatically.',
            ...roleSpecificTail,
          ]),
      `Use your ${agent.role === 'leader' ? 'dune-leader skill plus dune-communication, dune-team-manager, dune-todo, or the local Dune API' : 'dune-todo skill and the local Dune API'}.`,
    ].join('\n'),
  }
}

const PASSIVE_WAIT_PATTERN = /\b(wait\s+for|waiting\s+for|await\s+user|now\s+waiting|idle\s+until|just\s+wait)\b/i

function parseLeaderPdca(response: string): LeaderPdca | null {
  const lines = response
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length < 8) return null

  const footer = lines.slice(-8)
  if (!/^Leader PDCA$/i.test(footer[0] || '')) return null

  const thesisMatch = (footer[1] || '').match(/^Thesis:\s*(unchanged|revised)$/i)
  const planMatch = (footer[2] || '').match(/^Plan:\s*owner=(.+?);\s*deliverable=(.+?);\s*due=(.+?);\s*success=(.+)$/i)
  const doMatch = (footer[3] || '').match(/^Do:\s*(.+)$/i)
  const checkMatch = (footer[4] || '').match(/^Check:\s*(.+)$/i)
  const actMatch = (footer[5] || '').match(/^Act:\s*(.+)$/i)
  const obstacleMatch = (footer[6] || '').match(/^Obstacle:\s*(cleared|rerouted|escalated|exhausted)$/i)
  const outcomeMatch = (footer[7] || '').match(/^Outcome:\s*(advanced|blocked)$/i)

  if (!thesisMatch || !planMatch || !doMatch || !checkMatch || !actMatch || !obstacleMatch || !outcomeMatch) return null

  const owner = planMatch[1]?.trim() || ''
  const deliverable = planMatch[2]?.trim() || ''
  const due = planMatch[3]?.trim() || ''
  const success = planMatch[4]?.trim() || ''
  const doStep = doMatch[1]?.trim() || ''
  const check = checkMatch[1]?.trim() || ''
  const act = actMatch[1]?.trim() || ''
  const obstacle = obstacleMatch[1].toLowerCase() as LeaderPdca['obstacle']
  const outcome = outcomeMatch[1].toLowerCase() as LeaderPdca['outcome']

  if (!owner || !deliverable || !due || !success || !doStep || !check || !act) return null

  // Outcome: blocked is valid only with Obstacle: exhausted
  if (outcome === 'blocked' && obstacle !== 'exhausted') return null

  // Passive wait wording in Do or Act is invalid
  if (PASSIVE_WAIT_PATTERN.test(doStep) || PASSIVE_WAIT_PATTERN.test(act)) return null

  return {
    thesis: thesisMatch[1].toLowerCase() as LeaderPdca['thesis'],
    plan: {
      owner,
      deliverable,
      due,
      success,
    },
    do: doStep,
    check,
    act,
    obstacle,
    outcome,
  }
}

function extractLeaderBashCommand(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    for (const key of ['command', 'cmd', 'script', 'text', 'input']) {
      const value = (input as Record<string, unknown>)[key]
      if (typeof value === 'string') return value
    }
  }
  return JSON.stringify(input ?? '')
}

function isLeaderMemoryOnlyCommand(command: string): boolean {
  const normalized = command.toLowerCase()
  if (!/(\/config\/memory\/leader-thesis\.md|\/config\/memory\/todo-handoff\.md)/.test(normalized)) {
    return false
  }
  return !/(\/workspace|packages\/|src\/|dist\/|\/config\/miniapps)/.test(normalized)
}

function isLeaderCoordinationShellCommand(command: string): boolean {
  const normalized = command.toLowerCase()
  if (/\/skills\/dune-(communication|team-manager|todo)\//.test(normalized)) return true
  if (/(localhost|127\.0\.0\.1):3200/.test(normalized)) {
    return !/(\/host\/v1\/exec|\/sandboxes\/v1|\/miniapps\/)/.test(normalized)
  }
  return isLeaderMemoryOnlyCommand(command)
}

function isLeaderReadOnlyShellCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim()
  const readOnlyPrefixes = [
    'ls', 'pwd', 'cat', 'rg', 'grep', 'find', 'sed -n', 'head', 'tail', 'wc',
    'stat', 'date', 'printenv', 'env', 'ps', 'jq', 'curl ', 'python3 -c "import json',
  ]
  if (!readOnlyPrefixes.some(prefix => normalized.startsWith(prefix))) return false
  return !detectLeaderShellMutation(command)
}

function detectLeaderShellMutation(command: string): string | null {
  const normalized = command.toLowerCase()
  if (/\b(rm|mv|cp|mkdir|touch|chmod|chown|patch|make|pnpm|npm|yarn)\b/.test(normalized)) {
    return 'mutating shell command'
  }
  if (/git\s+(apply|commit|checkout|merge|rebase)\b/.test(normalized)) {
    return 'git mutation command'
  }
  if (/sed\s+-i\b|perl\s+-pi\b|write_text\(|write_bytes\(|open\([^)]*,\s*['"][wa]/.test(normalized)) {
    return 'file mutation command'
  }
  const redirectMatch = command.match(/(^|[^0-9])>>?\s*([^\s]+)/)
  if (redirectMatch) {
    const target = redirectMatch[2]?.trim() || ''
    if (!/^\/config\/memory\/(leader-thesis|todo-handoff)\.md$/.test(target)) {
      return `redirected write to ${target}`
    }
  }
  return null
}

function detectLeaderPolicyViolation(toolUses: LeaderToolUse[]): LeaderPolicyViolation | null {
  for (const toolUse of toolUses) {
    const toolName = (toolUse.toolName || '').trim()
    if (!toolName) continue

    if (toolName === 'Bash') {
      const command = extractLeaderBashCommand(toolUse.input)
      if (isLeaderCoordinationShellCommand(command) || isLeaderReadOnlyShellCommand(command)) {
        continue
      }
      const mutationReason = detectLeaderShellMutation(command)
      return {
        toolName,
        reason: mutationReason
          ? `Direct implementation shell work is not allowed for leaders: ${mutationReason}.`
          : 'Leaders may only use Bash for read-only inspection, coordination commands, or leader memory updates.',
      }
    }

    if (LEADER_ALLOWED_READ_ONLY_TOOL_NAMES.has(toolName)) continue

    if (LEADER_MUTATING_TOOL_NAMES.has(toolName)) {
      return {
        toolName,
        reason: `Direct implementation tool use is not allowed for leaders: ${toolName}.`,
      }
    }

    return {
      toolName,
      reason: `Leaders may only use coordination or read-only tools, but used ${toolName}.`,
    }
  }

  return null
}

function finalizeTodoReminderTurn(
  agentId: string,
  agent: Pick<Agent, 'role'>,
  reminder: TodoReminderMetadata | undefined,
  response: string,
  policyViolation: LeaderPolicyViolation | null = null,
): TodoReminderTurnResolution {
  if (!reminder) {
    return { consumeCooldown: false, allowImmediateRequeue: true, pdca: null, policyViolation }
  }

  if (agent.role !== 'leader') {
    return { consumeCooldown: false, allowImmediateRequeue: true, pdca: null, policyViolation }
  }

  const pdca = parseLeaderPdca(response)
  const consumeCooldown = !policyViolation && pdca?.outcome === 'advanced'
  if (consumeCooldown) {
    todoReminderCooldowns.set(agentId, reminder.remindedAt)
  }

  return {
    consumeCooldown,
    allowImmediateRequeue: false,
    pdca,
    policyViolation,
  }
}

function buildTodoReminderPayload(agentId: string, now: number): TodoReminderPayload | null {
  const lastReminder = todoReminderCooldowns.get(agentId) || 0
  if (now - lastReminder <= TODO_REMINDER_COOLDOWN_MS) return null

  const agent = agentStore.getAgent(agentId)
  if (!agent) return null

  const pending = todoStore.getPendingTodosByAgent(agentId)
  const overdue = pending.filter(t => t.dueAt !== undefined && isValidDueAtMs(t.dueAt) && t.dueAt <= now)
  if (overdue.length > 0) {
    return buildOverdueTodoReminder(agent, overdue)
  }

  if (pending.length === 0) {
    return buildNoPendingTodoReminder(agent)
  }

  return agent.role === 'leader'
    ? buildLeaderIdleTodoReminder(agent, pending)
    : buildFollowerIdleTodoReminder(agent, pending)
}

const defaultTodoReminderEnqueue: TodoReminderEnqueue = (agentId, payload, remindedAt) => {
  sendMessage(agentId, [{ authorName: 'System', content: payload.content }], {
    todoReminder: { kind: payload.kind, remindedAt },
  }).catch(err => {
    const action = payload.kind === 'overdue' ? 'remind' : 'nudge'
    console.warn(`[todo-idle] Failed to ${action} agent ${agentId}:`, err.message)
  })
}

let enqueueTodoReminder: TodoReminderEnqueue = defaultTodoReminderEnqueue

function queueTodoReminderIfNeeded(
  agentId: string,
  options: { now?: number; requireUnlocked?: boolean } = {},
): boolean {
  if (options.requireUnlocked && agentLocks.has(agentId)) return false
  const agentStatus = agentStore.getAgent(agentId)?.status
  if (agentStatus === 'stopping' || agentStatus === 'stopped') return false
  const now = options.now ?? Date.now()
  const payload = buildTodoReminderPayload(agentId, now)
  if (!payload) return false
  if (agentStore.getAgent(agentId)?.role !== 'leader') {
    todoReminderCooldowns.set(agentId, now)
  }
  enqueueTodoReminder(agentId, payload, now)
  return true
}

const todoReminderSweepTimer = setInterval(() => {
  for (const [agentId, running] of runningAgents) {
    if (!running.hasSession) continue
    queueTodoReminderIfNeeded(agentId, { requireUnlocked: true })
  }
}, TODO_REMINDER_SWEEP_INTERVAL_MS)
todoReminderSweepTimer.unref()

let communicationDaemonRefreshInFlight = false
const communicationDaemonRefreshTimer = setInterval(() => {
  if (communicationDaemonRefreshInFlight) return
  communicationDaemonRefreshInFlight = true
  reconcileAllRunningCommunicationDaemons()
    .catch((err: any) => {
      console.warn('[communication-daemons] Periodic refresh failed:', err?.message || err)
    })
    .finally(() => {
      communicationDaemonRefreshInFlight = false
    })
}, COMMUNICATION_DAEMON_REFRESH_INTERVAL_MS)
communicationDaemonRefreshTimer.unref()

type BuildClaudeCliCommandInput = {
  agentId: string
  promptFile: string
  systemPromptFile: string
  hasSession: boolean
  oauthToken: string
  modelId: string | null
  agentHttpUrl: string
  wsUrl: string
}

function buildClaudeCliCommand(input: BuildClaudeCliCommandInput): string {
  const oauthToken = input.oauthToken.trim()
  const modelId = input.modelId?.trim() || ''
  return [
    `cat ${input.promptFile} |`,
    `runuser -u abc -- env`,
    `HOME=/config`,
    `PATH=${SKILLBOX_PATH}`,
    `DISPLAY=:1`,
    `SHELL=/bin/bash`,
    `IS_SANDBOX=1`,
    `AGENT_ID=${input.agentId}`,
    `DUNE_AGENT_ID=${input.agentId}`,
    ...(input.agentHttpUrl ? [`DUNE_AGENT_URL=${input.agentHttpUrl}`] : []),
    ...(input.wsUrl ? [`DUNE_WS_URL=${input.wsUrl}`] : []),
    `DUNE_RPC_SCRIPT=${RPC_GUEST_PATH}`,
    ...(oauthToken ? [`CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`] : []),
    `claude --print`,
    ...(modelId ? [`--model ${modelId}`] : []),
    `--dangerously-skip-permissions`,
    `--output-format stream-json`,
    `--verbose`,
    `--mcp-config ${MCP_CONFIG_PATH}`,
    `--append-system-prompt-file ${input.systemPromptFile}`,
    `--max-turns 30`,
    ...(input.hasSession ? ['--continue'] : []),
  ].join(' ')
}

export function __buildClaudeCliCommandForTests(input: BuildClaudeCliCommandInput): string {
  return buildClaudeCliCommand(input)
}

export function __getStopAgentShutdownPromptForTests(): string {
  return STOP_AGENT_SHUTDOWN_PROMPT
}

export function __setTodoReminderEnqueueForTests(
  fn: ((agentId: string, content: string, kind: TodoReminderKind) => void) | null,
): void {
  enqueueTodoReminder = fn
    ? (agentId, payload) => fn(agentId, payload.content, payload.kind)
    : defaultTodoReminderEnqueue
}

export function __runTodoReminderCheckForTests(
  agentId: string,
  now: number,
  requireUnlocked = false,
): boolean {
  return queueTodoReminderIfNeeded(agentId, { now, requireUnlocked })
}

export function __resetTodoReminderStateForTests(): void {
  todoReminderCooldowns.clear()
  agentLocks.clear()
  enqueueTodoReminder = defaultTodoReminderEnqueue
}

export function __parseLeaderPdcaForTests(response: string): LeaderPdca | null {
  return parseLeaderPdca(response)
}

export function __detectLeaderPolicyViolationForTests(toolUses: LeaderToolUse[]): LeaderPolicyViolation | null {
  return detectLeaderPolicyViolation(toolUses)
}

export function __finalizeTodoReminderTurnForTests(
  agentId: string,
  role: Agent['role'],
  reminder: TodoReminderMetadata | undefined,
  response: string,
  policyViolation: LeaderPolicyViolation | null = null,
): TodoReminderTurnResolution {
  return finalizeTodoReminderTurn(agentId, { role }, reminder, response, policyViolation)
}

export function __getTodoReminderCooldownForTests(agentId: string): number | undefined {
  return todoReminderCooldowns.get(agentId)
}

export function __setAgentLockForTests(agentId: string, locked: boolean): void {
  if (locked) {
    agentLocks.set(agentId, Promise.resolve('[test-lock]'))
    return
  }
  agentLocks.delete(agentId)
}

export interface InputMetadata {
  source?: 'dm' | 'channel' | 'mailbox' | 'app_action'
  /** For channel input: structured data about which channels and messages the agent received */
  channels?: Array<{ name: string; messages: Array<{ author: string; content: string }> }>
  /** For DM: the user's message content */
  content?: string
  /** For DM correlation between the frontend stash queue and the emitted user_message log entry. */
  clientRequestId?: string
  /** For mailbox notifications: summary of the leased unread batch. */
  mailbox?: {
    unreadCount: number
    batchId?: string
    expiresAt?: number
  }
  /** For miniapp action requests from the popup host. */
  appAction?: {
    slug: string
    action: string
    payload?: unknown
    requestId?: string
  }
  /** Internal metadata for idle reminder turns. */
  todoReminder?: TodoReminderMetadata
}

export async function sendMessage(agentId: string, messages: Array<{ authorName: string; content: string }>, metadata?: InputMetadata): Promise<string> {
  const running = runningAgents.get(agentId)
  if (!running) throw new Error(`Agent ${agentId} is not running`)

  // Wait for any in-flight sendMessage to finish before starting a new one
  const existing = agentLocks.get(agentId)
  if (existing) {
    try { await existing } catch { /* ignore — we'll run our own call */ }
  }

  const promise = _sendMessageInner(agentId, running, messages, metadata)
  agentLocks.set(agentId, promise)
  try {
    return await promise
  } finally {
    if (agentLocks.get(agentId) === promise) agentLocks.delete(agentId)
  }
}

function finalizeInterruptedRun(agentId: string, running: RunningAgent, metadata: Record<string, unknown> = {}): string {
  running.hasSession = true
  agentRuntimeStore.setAgentRuntimeHasSession(agentId, true)
  running.thinkingSince = 0
  emitRuntimeLog(agentId, 'lifecycle', 'claude_cli_interrupted', metadata)
  emitAgentLogEntries(agentId, [{
    id: newEventId(),
    agentId,
    timestamp: Date.now(),
    type: 'system',
    data: {
      message: 'Workflow interrupted.',
    },
  }])
  setAgentStatus(agentId, 'idle', { source: 'interrupt-agent', reason: 'workflow interrupted' })
  return '[INTERRUPTED]'
}

async function _sendMessageInner(
  agentId: string,
  running: RunningAgent,
  messages: Array<{ authorName: string; content: string }>,
  metadata?: InputMetadata,
): Promise<string> {
  running.interruptRequested = false
  // Create a fresh abort signal for this turn — resolved by triggerInterruptSignals
  let abortResolve: () => void
  const abortPromise = new Promise<void>((resolve) => { abortResolve = resolve })
  running.interruptAbort = { promise: abortPromise, resolve: abortResolve! }
  setAgentStatus(agentId, 'thinking', { source: 'send-message' })
  running.thinkingSince = Date.now()

  // Set busy flag so mailbox daemon skips polling during CLI execution
  await retriedExec(running.box, 'touch', ['/tmp/agent-busy'], { DISPLAY: ':1' }, 10_000).catch(() => {})

  try {
    const conversationPrompt = messages.map(m => `${m.authorName}: ${m.content}`).join('\n')
    const fullPrompt = conversationPrompt

    // Log input with type-specific entry for rich frontend rendering
    const inputLogEntry = metadata?.source === 'dm'
      ? {
          id: newEventId(),
          agentId,
          timestamp: Date.now(),
          type: 'user_message' as const,
          data: {
            content: metadata.content || fullPrompt,
            clientRequestId: metadata.clientRequestId || null,
          },
        }
      : metadata?.source === 'mailbox'
        ? {
            id: newEventId(),
            agentId,
            timestamp: Date.now(),
            type: 'mailbox_notice' as const,
            data: {
              unreadCount: metadata.mailbox?.unreadCount ?? 0,
              batchId: metadata.mailbox?.batchId || null,
              expiresAt: metadata.mailbox?.expiresAt || null,
            },
          }
      : metadata?.source === 'channel'
        ? {
            id: newEventId(),
            agentId,
            timestamp: Date.now(),
            type: 'channel_input' as const,
            data: { channels: metadata.channels || [] },
          }
        : metadata?.source === 'app_action'
          ? {
              id: newEventId(),
              agentId,
              timestamp: Date.now(),
              type: 'system' as const,
              data: {
                message: `Miniapp action: ${metadata.appAction?.slug || 'unknown'} :: ${metadata.appAction?.action || 'unknown'}`,
              },
            }
        : {
            id: newEventId(),
            agentId,
            timestamp: Date.now(),
            type: 'system' as const,
            data: { message: `Received: "${fullPrompt.length > 200 ? fullPrompt.slice(0, 200) + '...' : fullPrompt}"` },
          }
    emitAgentLogEntries(agentId, [inputLogEntry])

    // Broadcast a "thinking" entry so the frontend shows animated dots immediately
    const thinkingEntry = { id: newEventId(), agentId, timestamp: Date.now(), type: 'thinking' as const, data: {} }
    emitAgentLogEntries(agentId, [thinkingEntry])

    // Write user prompt and system prompt to temp files (via Python for safe escaping)
    const promptFile = `/tmp/prompt-${agentId}.txt`
    const systemPromptFile = `${SYSTEM_PROMPT_DIR}/system-prompt-${agentId}.txt`
    const currentAgent = agentStore.getAgent(agentId) || running.agent
    const systemPrompt = buildSystemPrompt(currentAgent)

    await Promise.all([
      retriedExec(running.box, 'python3', [
        '-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])',
        promptFile, fullPrompt,
      ], { DISPLAY: ':1' }),
      retriedExec(running.box, 'python3', [
        '-c', 'import sys; open(sys.argv[1],"w").write(sys.argv[2])',
        systemPromptFile, systemPrompt,
      ], { DISPLAY: ':1' }),
    ])

    // Build the CLI command. Key requirements:
    // 1. Run as abc user (not root) — --dangerously-skip-permissions is rejected as root
    // 2. Pipe prompt via stdin (cat file |) — avoids shell escaping issues AND
    //    provides proper EOF so the CLI doesn't hang (box.exec leaves stdin open)
    // 3. Include /lsiopy/bin in PATH — Python packages like typing_extensions live there
    // 4. Use separate MCP config — CLI overwrites $HOME/.claude.json with its own state
    const oauthToken = buildClaudeCliAuthEnvValues().CLAUDE_CODE_OAUTH_TOKEN || ''
    const modelId = resolveClaudeModelId(currentAgent)
    const cliCmd = buildClaudeCliCommand({
      agentId,
      promptFile,
      systemPromptFile,
      hasSession: running.hasSession,
      oauthToken,
      modelId,
      agentHttpUrl: running.agentHttpUrl,
      wsUrl: running.backendUrl,
    })

    console.log(`[${agentId}] Starting claude -p (prompt length: ${fullPrompt.length})...`)
    emitRuntimeLog(agentId, 'lifecycle', 'claude_cli_start', {
      promptLength: fullPrompt.length,
      hasSession: running.hasSession,
    })

    // Stream stdout line-by-line — each JSON line is parsed and broadcast in real-time
    let fullResponse = ''
    let firstOutputSent = false
    const leaderToolUses: LeaderToolUse[] = []
    const result = await streamingExec(
      running.box, 'bash', ['-c', cliCmd], { DISPLAY: ':1' },
      (line) => {
        try {
          const parsed = JSON.parse(line)
          const entries = parseStreamJsonLine(parsed, agentId)
          if (entries.length > 0) {
            emitAgentLogEntries(agentId, entries)
            if (currentAgent.role === 'leader') {
              for (const entry of entries) {
                if (entry.type !== 'tool_use') continue
                leaderToolUses.push({
                  toolName: String(entry.data.toolName || ''),
                  input: entry.data.input,
                })
              }
            }
            // Switch status from 'thinking' to 'responding' on first real output
            if (!firstOutputSent) {
              firstOutputSent = true
              setAgentStatus(agentId, 'responding', { source: 'send-message', reason: 'first streamed output' })
            }
          }
          if (parsed.type === 'result') {
            fullResponse = parsed.result || ''
          }
        } catch {
          console.warn(`[${agentId}] non-JSON stdout line: ${line.slice(0, 200)}`)
          emitRuntimeLog(agentId, 'stdout', line, { source: 'claude-stream', parse: 'non-json' })
        }
      },
      300_000,
      (execution) => {
        running.currentExecution = execution
        if (execution && running.interruptRequested) {
          triggerInterruptSignals(agentId, running)
        }
      },
      running.interruptAbort?.promise,
    )

    if (running.interruptRequested || result.aborted) {
      return finalizeInterruptedRun(agentId, running, {
        exitCode: result.exitCode,
        stdoutBytes: result.stdout.length,
        stderrBytes: result.stderr.length,
      })
    }

    console.log(`[${agentId}] streamingExec done: exit=${result.exitCode} stdout=${result.stdout.length}b stderr=${result.stderr.length}b firstOutput=${firstOutputSent} response=${fullResponse.length}b`)
    emitRuntimeLog(agentId, 'lifecycle', 'claude_cli_complete', {
      exitCode: result.exitCode,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
      firstOutputSent,
      responseBytes: fullResponse.length,
    })

    if (result.stderr) {
      console.error(`Agent ${agentId} stderr:`, result.stderr)
      const stderrLines = result.stderr.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0)
      for (const stderrLine of stderrLines) {
        emitRuntimeLog(agentId, 'stderr', stderrLine, { source: 'claude-stream' })
      }
    }

    running.hasSession = true
    agentRuntimeStore.setAgentRuntimeHasSession(agentId, true)
    running.thinkingSince = 0
    setAgentStatus(agentId, 'idle', { source: 'send-message' })

    const leaderPolicyViolation = currentAgent.role === 'leader'
      ? detectLeaderPolicyViolation(leaderToolUses)
      : null
    if (leaderPolicyViolation) {
      emitAgentLogEntries(agentId, [{
        id: newEventId(),
        agentId,
        timestamp: Date.now(),
        type: 'system',
        data: {
          message: `Leader policy violation: ${leaderPolicyViolation.reason}`,
          toolName: leaderPolicyViolation.toolName,
        },
      }])
      emitRuntimeLog(agentId, 'lifecycle', 'leader_policy_violation', leaderPolicyViolation)
    }

    const reminderTurn = finalizeTodoReminderTurn(
      agentId,
      currentAgent,
      metadata?.todoReminder,
      fullResponse,
      leaderPolicyViolation,
    )

    // Check idle todo state after each completed exchange (non-blocking).
    if (reminderTurn.allowImmediateRequeue) {
      queueTodoReminderIfNeeded(agentId)
    }

    return fullResponse || '[NO_RESPONSE]'
  } catch (err: any) {
    if (running.interruptRequested) {
      return finalizeInterruptedRun(agentId, running, {
        error: err?.message?.slice(0, 200) || 'unknown interrupt error',
      })
    }
    console.error(`[${agentId}] sendMessage error:`, err.message?.slice(0, 200))
    running.thinkingSince = 0
    const errorMessage = err.message?.slice(0, 200) || 'unknown sendMessage error'
    emitRuntimeLog(agentId, 'lifecycle', 'claude_cli_failed', { error: errorMessage })
    setAgentStatus(agentId, 'error', { source: 'send-message', reason: errorMessage })
    // Auto-recover after 30s so transient container errors don't permanently brick the agent
    setTimeout(() => {
      if (runningAgents.has(agentId) && agentStore.getAgent(agentId)?.status === 'error') {
        setAgentStatus(agentId, 'idle', { source: 'send-message', reason: 'auto-recover from transient error' })
        console.log(`[${agentId}] Auto-recovered from error → idle`)
      }
    }, 30_000)
    throw err
  } finally {
    running.currentExecution = null
    running.interruptRequested = false
    running.interruptAbort = null
    // Clear busy flag so mailbox daemon resumes polling
    await retriedExec(running.box, 'rm', ['-f', '/tmp/agent-busy'], { DISPLAY: ':1' }, 10_000).catch(() => {})
  }
}

/** Take a screenshot of the agent's desktop via PIL. */
export async function takeScreenshot(agentId: string): Promise<{ data: string; width: number; height: number; format: string }> {
  const running = runningAgents.get(agentId)
  if (!running) throw new Error(`Agent ${agentId} is not running`)

  const pythonCode = `
from PIL import ImageGrab
import io, base64
img = ImageGrab.grab()
buf = io.BytesIO()
img.save(buf, format="PNG")
print(base64.b64encode(buf.getvalue()).decode("utf-8"))
`
  const result = await running.box.exec('python3', ['-c', pythonCode], { DISPLAY: ':1' })
  if (result.exitCode !== 0) {
    throw new Error(`Screenshot failed: ${result.stderr}`)
  }
  return { data: result.stdout.trim(), width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT, format: 'png' }
}

/** Get screen info (ports, dimensions) for a running agent. */
export function getAgentScreen(agentId: string): { guiHttpPort: number; guiHttpsPort: number; width: number; height: number } | null {
  const running = runningAgents.get(agentId)
  if (!running) return null
  return {
    guiHttpPort: running.guiHttpPort,
    guiHttpsPort: running.guiHttpsPort,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
  }
}

export function getAgentHttpBaseUrl(agentId: string): string | null {
  const running = runningAgents.get(agentId)
  if (!running) return null
  return `http://localhost:${running.guiHttpPort}`
}

export async function ensureMiniappNginxConfigured(agentId: string): Promise<void> {
  const running = runningAgents.get(agentId)
  if (!running) throw new Error(`Agent ${agentId} is not running`)
  await ensureMiniappNginxConfiguredInBox(running.box, agentId)
}

/** Debug: exec a command in the agent's box and return the result. */
export async function debugExec(agentId: string, cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const running = runningAgents.get(agentId)
  if (!running) throw new Error(`Agent ${agentId} is not running`)
  const result = await running.box.exec(cmd, args, { DISPLAY: ':1', SHELL: '/bin/bash' })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

export function isAgentRunning(agentId: string): boolean {
  return runningAgents.has(agentId)
}

export async function stopAllAgents(): Promise<void> {
  for (const [id] of runningAgents) {
    await stopAgent(id)
  }
}

export async function syncClaudeSettingsForAllAgents(): Promise<ClaudeSettingsSyncSummary> {
  const agents = agentStore.listAgents()
  const initialStatusByAgent = new Map(agents.map(agent => [agent.id, agent.status]))
  const results: ClaudeSettingsSyncAgentResult[] = []

  for (const agent of agents) {
    const initialStatus = initialStatusByAgent.get(agent.id) || 'stopped'
    const wasRunning = initialStatus !== 'stopped'
    let startedForSync = false

    try {
      let running = runningAgents.get(agent.id)
      if (!running) {
        await ensureAgentRunning(agent.id)
        running = runningAgents.get(agent.id)
        startedForSync = true
      }
      if (!running) {
        throw new Error(`Agent ${agent.id} failed to start for settings sync`)
      }

      await upsertClaudeSettingsInBox(running.box, agent.id)
      results.push({
        agentId: agent.id,
        name: agent.name,
        wasRunning,
        startedForSync,
        updated: true,
        stoppedAfterSync: false,
      })
    } catch (err: any) {
      results.push({
        agentId: agent.id,
        name: agent.name,
        wasRunning,
        startedForSync,
        updated: false,
        stoppedAfterSync: false,
        error: err?.message || 'unknown error',
      })
    }
  }

  for (const result of results) {
    const initialStatus = initialStatusByAgent.get(result.agentId) || 'stopped'
    if (initialStatus !== 'stopped') continue
    if (!runningAgents.has(result.agentId)) continue

    try {
      await stopAgent(result.agentId)
      result.stoppedAfterSync = true
    } catch (err: any) {
      result.stopError = err?.message || 'unknown stop error'
    }
  }

  const updated = results.filter(result => result.updated).length
  const failed = results.length - updated
  const restoredStopped = results.filter(result => result.stoppedAfterSync).length

  return {
    total: results.length,
    updated,
    failed,
    restoredStopped,
    results,
  }
}

export async function syncClaudeSettingsForRunningAgents(): Promise<ClaudeSettingsSyncSummary> {
  const results: ClaudeSettingsSyncAgentResult[] = []

  for (const [agentId, running] of runningAgents) {
    try {
      await upsertClaudeSettingsInBox(running.box, agentId)
      results.push({
        agentId,
        name: running.agent.name,
        wasRunning: true,
        startedForSync: false,
        updated: true,
        stoppedAfterSync: false,
      })
    } catch (err: any) {
      results.push({
        agentId,
        name: running.agent.name,
        wasRunning: true,
        startedForSync: false,
        updated: false,
        stoppedAfterSync: false,
        error: err?.message || 'unknown error',
      })
    }
  }

  const updated = results.filter(result => result.updated).length
  const failed = results.length - updated

  return {
    total: results.length,
    updated,
    failed,
    restoredStopped: 0,
    results,
  }
}

export async function resolveAgentIdByRuntimeSandboxId(sandboxId: string): Promise<string | null> {
  if (!sandboxId) return null
  const runtimeStates = agentRuntimeStore.listAgentRuntimeStates(10_000)
  for (const runtimeState of runtimeStates) {
    if (runtimeState.sandboxId === sandboxId) return runtimeState.agentId
  }
  for (const [agentId, running] of runningAgents.entries()) {
    if (running.sandboxId === sandboxId) return agentId
  }
  return null
}

export async function ensureRuntimeSandboxRunning(sandboxId: string): Promise<{ agentId: string; box: SimpleBox }> {
  const agentId = await resolveAgentIdByRuntimeSandboxId(sandboxId)
  if (!agentId) throw new Error('not_found')

  let running = runningAgents.get(agentId)
  if (!running) {
    await ensureAgentRunning(agentId)
    running = runningAgents.get(agentId)
  }
  if (!running) throw new Error('failed_to_start')

  if (!running.sandboxId || isPendingSandboxId(running.sandboxId)) {
    try {
      running.sandboxId = await running.box.getId()
    } catch {
      running.sandboxId = sandboxId
    }
  }

  upsertManagedRuntimeShadow(agentId, running.sandboxId, {
    status: 'running',
    startedAt: running.startedAt || Date.now(),
    stoppedAt: null,
  })

  return { agentId, box: running.box }
}

export async function stopRuntimeSandbox(sandboxId: string): Promise<void> {
  const agentId = await resolveAgentIdByRuntimeSandboxId(sandboxId)
  if (!agentId) throw new Error('not_found')
  await stopAgent(agentId)
}

export async function destroyRuntimeSandbox(sandboxId: string): Promise<void> {
  const agentId = await resolveAgentIdByRuntimeSandboxId(sandboxId)
  if (!agentId) throw new Error('not_found')
  await destroyAgentRuntimeSandbox(agentId)
}

export async function execInRuntimeSandbox(
  sandboxId: string,
  cmd: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { box } = await ensureRuntimeSandboxRunning(sandboxId)
  return box.exec(cmd, args, env)
}

export async function withRuntimeSandboxBox<T>(
  sandboxId: string,
  work: (box: SimpleBox, agentId: string) => Promise<T>,
): Promise<T> {
  const { agentId, box } = await ensureRuntimeSandboxRunning(sandboxId)
  return work(box, agentId)
}

export async function destroyAgentRuntimeSandbox(agentId: string): Promise<void> {
  if (isAgentRunning(agentId)) {
    await stopAgent(agentId)
  }

  const runtimeState = agentRuntimeStore.getAgentRuntimeState(agentId)
  if (!runtimeState) return

  if (!isPendingSandboxId(runtimeState.sandboxId)) {
    try {
      await getRuntime().remove(runtimeState.sandboxId)
    } catch (err: any) {
      throw new Error(
        `Failed to remove runtime sandbox ${runtimeState.sandboxId} for agent ${agentId}: ${err?.message || 'unknown error'}`,
      )
    }
  }

  if (!isPendingSandboxId(runtimeState.sandboxId)) {
    sandboxStore.deleteManagedRuntimeSandbox(runtimeState.sandboxId)
  } else {
    const managed = sandboxStore.getManagedRuntimeSandboxByAgentId(agentId)
    if (managed) sandboxStore.deleteManagedRuntimeSandbox(managed.id)
  }
  agentRuntimeStore.deleteAgentRuntimeState(agentId)
}

/** Reset a stopped agent runtime so next start always creates a fresh container with latest volume config. */
export async function resetStoppedAgentRuntimeSandbox(agentId: string): Promise<void> {
  if (isAgentRunning(agentId)) {
    throw new Error('agent_running_stop_required')
  }

  const runtimeState = agentRuntimeStore.getAgentRuntimeState(agentId)
  if (!runtimeState) return

  if (!isPendingSandboxId(runtimeState.sandboxId)) {
    try {
      await getRuntime().remove(runtimeState.sandboxId)
    } catch (err: any) {
      if (!isSandboxNotFoundError(err)) {
        throw new Error(
          `Failed to reset runtime sandbox ${runtimeState.sandboxId} for agent ${agentId}: ${err?.message || 'unknown error'}`,
        )
      }
    }
    sandboxStore.deleteManagedRuntimeSandbox(runtimeState.sandboxId)
  }

  agentRuntimeStore.upsertAgentRuntimeState({
    agentId,
    sandboxName: runtimeState.sandboxName,
    sandboxId: getPendingSandboxId(agentId),
    guiHttpPort: runtimeState.guiHttpPort,
    guiHttpsPort: runtimeState.guiHttpsPort,
    hasSession: false,
    lastStartedAt: runtimeState.lastStartedAt,
    lastStoppedAt: runtimeState.lastStoppedAt,
  })
}

/** Re-detect host URL for all running agents and restart daemons only when needed.
 *  BoxLite can break guest→host networking when new containers start. */
export async function reconcileAllRunningCommunicationDaemons(): Promise<void> {
  const backendPort = getBackendPort()
  if (backendPort <= 0) return

  for (const [agentId, running] of runningAgents) {
    try {
      const daemonAssets = syncCommunicationDaemonAssets(agentId)
      const hostAddr = getHostLanIps()[0] || '127.0.0.1'
      const wsUrl = `ws://${hostAddr}:${backendPort}/ws/agent?agentId=${agentId}`
      const restarted = await reconcileCommunicationDaemons(running, {
        wsUrl,
        daemonAssetHash: daemonAssets.assetHash,
        force: false,
      })
      console.log(`${restarted ? 'Reconciled' : 'Skipped'} listener for ${running.agent.name}`)
    } catch (err: any) {
      console.error(`Failed to reconcile listener for agent ${agentId}:`, err.message)
    }
  }
}

export async function redeployAllDaemons(): Promise<void> {
  const backendPort = getBackendPort()
  if (backendPort <= 0) return

  for (const [agentId, running] of runningAgents) {
    try {
      syncAgentSkills(agentId)
      await prepareAgentConfigFacadeInBox(running.box)
      await retriedExec(running.box, 'bash', ['-c',
        `mkdir -p ${AGENT_DUNE_CLAUDE_PATH}/skills && chown -R abc:abc ${AGENT_DUNE_VOLUME_PATH}`
      ], { DISPLAY: ':1' })
      await upsertClaudeSettingsInBox(running.box, agentId)

      const daemonAssets = syncCommunicationDaemonAssets(agentId)
      const hostAddr = getHostLanIps()[0] || '127.0.0.1'
      const wsUrl = `ws://${hostAddr}:${backendPort}/ws/agent?agentId=${agentId}`
      await reconcileCommunicationDaemons(running, {
        wsUrl,
        daemonAssetHash: daemonAssets.assetHash,
        force: true,
      })
      console.log(`Redeployed listener for ${running.agent.name}`)
    } catch (err: any) {
      console.error(`Failed to redeploy listener for agent ${agentId}:`, err.message)
    }
  }
}

export async function listRunningAgentSandboxes(): Promise<Array<{
  sandboxId: string
  agentId: string
  status: 'running' | 'stopped'
  startedAt: number
  name: string
}>> {
  const out: Array<{
    sandboxId: string
    agentId: string
    status: 'running' | 'stopped'
    startedAt: number
    name: string
  }> = []
  const runtimeStates = agentRuntimeStore.listAgentRuntimeStates()
  const includedAgentIds = new Set<string>()

  for (const runtimeState of runtimeStates) {
    const running = runningAgents.get(runtimeState.agentId)
    const agent = running?.agent || agentStore.getAgent(runtimeState.agentId)
    if (!agent) continue

    let sandboxId = runtimeState.sandboxId
    if (!sandboxId || isPendingSandboxId(sandboxId)) {
      if (running?.sandboxId && !isPendingSandboxId(running.sandboxId)) {
        sandboxId = running.sandboxId
      } else if (running) {
        try {
          sandboxId = await running.box.getId()
        } catch {
          sandboxId = getRuntimeSandboxName(runtimeState.agentId)
        }
      } else {
        sandboxId = getRuntimeSandboxName(runtimeState.agentId)
      }
    }

    out.push({
      sandboxId,
      agentId: runtimeState.agentId,
      status: running ? 'running' : 'stopped',
      startedAt: running?.startedAt || runtimeState.lastStartedAt || runtimeState.createdAt,
      name: `${agent.name} runtime`,
    })
    includedAgentIds.add(runtimeState.agentId)
  }

  // Fallback safety: include any running agent that does not yet have runtime state.
  for (const [agentId, running] of runningAgents.entries()) {
    if (includedAgentIds.has(agentId)) continue

    let sandboxId = running.sandboxId
    if (!sandboxId || isPendingSandboxId(sandboxId)) {
      try {
        sandboxId = await running.box.getId()
      } catch {
        sandboxId = getRuntimeSandboxName(agentId)
      }
    }

    out.push({
      sandboxId,
      agentId,
      status: 'running',
      startedAt: running.startedAt || Date.now(),
      name: `${running.agent.name} runtime`,
    })
  }

  return out
}
