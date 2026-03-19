import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureBoxliteHome } from './boxlite/home.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendPackageRoot = resolve(__dirname, '..')
const repoRoot = resolve(backendPackageRoot, '..', '..')

function resolveFromRepoRoot(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(repoRoot, pathValue)
}

const port = parseInt(process.env.PORT || '0', 10)
const clientPort = parseInt(process.env.CLIENT_PORT || '0', 10)
const adminPort = parseInt(process.env.ADMIN_PORT || '0', 10)
const dataRoot = resolveFromRepoRoot(process.env.DATA_DIR || './data')
const boxliteDataPath = join(dataRoot, 'boxlite')

export const config = {
  repoRoot,
  port,
  clientPort,
  adminPort,
  dataRoot,
  agentsRoot: join(dataRoot, 'agents'),
  databasePath: join(dataRoot, 'db', 'dune.db'),
  frontendDistPath: resolveFromRepoRoot(process.env.FRONTEND_DIST_PATH || './packages/frontend/dist'),
  hostOperatorHelperPath: resolveFromRepoRoot(process.env.HOST_OPERATOR_HELPER_PATH || './packages/backend/bin/dune-host-operator-helper'),
  agentSkillsPath: process.env.AGENT_SKILLS_PATH || join(backendPackageRoot, 'src', 'agent-skills'),
  agentMcpPath: process.env.AGENT_MCP_PATH || join(backendPackageRoot, 'src', 'agents', 'mcp'),
  agentPromptsPath: process.env.AGENT_PROMPTS_PATH || join(backendPackageRoot, 'src', 'agent-prompts'),
  boxliteDataPath,
  boxliteHome: ensureBoxliteHome(dataRoot),
  agentStartupTimeoutMs: parseInt(process.env.AGENT_STARTUP_TIMEOUT_MS || '300000', 10),
  agentDesktopPollMs: parseInt(process.env.AGENT_DESKTOP_POLL_MS || '500', 10),
  sandboxExecTimeoutMs: parseInt(process.env.SANDBOX_EXEC_TIMEOUT_MS || '30000', 10),
  sandboxExecMaxRetries: parseInt(process.env.SANDBOX_EXEC_MAX_RETRIES || '2', 10),
}
