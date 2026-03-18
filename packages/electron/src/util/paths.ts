import { app } from 'electron'
import { isAbsolute, join, resolve } from 'path'

export function isPackaged(): boolean {
  return app.isPackaged
}

export function isDev(): boolean {
  // Unpackaged launches are also used for production-like smoke tests,
  // so dev mode must be opted into explicitly.
  return process.argv.includes('--dev')
}

export function getRepoRoot(): string {
  return resolve(__dirname, '..', '..', '..', '..')
}

function resolveFromRepoRoot(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(getRepoRoot(), pathValue)
}

export function getDataDir(): string {
  if (isPackaged()) {
    return join(app.getPath('home'), '.dune')
  }
  const override = process.env.DATA_DIR?.trim()
  if (override) {
    return resolveFromRepoRoot(override)
  }
  return resolveFromRepoRoot('./data')
}

export function getBackendEntryPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'backend', 'dist', 'index.js')
  }
  return resolve(getRepoRoot(), 'packages', 'backend', 'dist', 'index.js')
}

export function getFrontendDistPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'frontend', 'dist')
  }
  return resolve(getRepoRoot(), 'packages', 'frontend', 'dist')
}

export function getAgentSkillsPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'backend', 'agent-skills')
  }
  return resolve(getRepoRoot(), 'packages', 'backend', 'src', 'agent-skills')
}

export function getAgentMcpPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'backend', 'agent-mcp')
  }
  return resolve(getRepoRoot(), 'packages', 'backend', 'src', 'agent-mcp')
}

export function getAgentPromptsPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'backend', 'agent-prompts')
  }
  return resolve(getRepoRoot(), 'packages', 'backend', 'src', 'agent-prompts')
}

export function getHostOperatorHelperPath(): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, 'backend', 'bin', 'dune-host-operator-helper')
  }
  return resolve(getRepoRoot(), 'packages', 'backend', 'bin', 'dune-host-operator-helper')
}

export function getPreloadPath(): string {
  return join(__dirname, '..', 'preload.js')
}

export function getAssetPath(...paths: string[]): string {
  if (isPackaged()) {
    return join(process.resourcesPath!, ...paths)
  }
  return resolve(getRepoRoot(), 'packages', 'electron', 'assets', ...paths)
}
