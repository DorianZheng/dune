import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const backendPackageRoot = resolve(__dirname, '..')
const repoRoot = resolve(backendPackageRoot, '..', '..')

function resolveFromRepoRoot(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(repoRoot, pathValue)
}

const port = parseInt(process.env.PORT || '3100', 10)
const adminPort = parseInt(process.env.ADMIN_PORT || String(port + 1), 10)
const dataRoot = resolveFromRepoRoot(process.env.DATA_DIR || './data')
const boxliteDataPath = join(dataRoot, 'boxlite')
const boxliteRuntimePath = join(dataRoot, 'b')

function ensureBoxliteRuntimeHome(): string {
  mkdirSync(dataRoot, { recursive: true })

  try {
    // Migrate the initial inverted layout (`b -> boxlite`) because BoxLite
    // canonicalizes the symlink target, which defeats the shorter socket path.
    if (existsSync(boxliteRuntimePath) && lstatSync(boxliteRuntimePath).isSymbolicLink()) {
      const target = readlinkSync(boxliteRuntimePath)
      if (target === 'boxlite' && existsSync(boxliteDataPath) && !lstatSync(boxliteDataPath).isSymbolicLink()) {
        rmSync(boxliteRuntimePath, { force: true })
        renameSync(boxliteDataPath, boxliteRuntimePath)
      } else {
        rmSync(boxliteRuntimePath, { force: true })
      }
    }

    if (!existsSync(boxliteRuntimePath)) {
      if (existsSync(boxliteDataPath) && !lstatSync(boxliteDataPath).isSymbolicLink()) {
        renameSync(boxliteDataPath, boxliteRuntimePath)
      } else {
        mkdirSync(boxliteRuntimePath, { recursive: true })
      }
    }

    if (existsSync(boxliteDataPath)) {
      const stat = lstatSync(boxliteDataPath)
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(boxliteDataPath)
        if (target !== 'b') {
          rmSync(boxliteDataPath, { force: true })
          symlinkSync('b', boxliteDataPath, 'dir')
        }
      }
    } else {
      symlinkSync('b', boxliteDataPath, 'dir')
    }

    return boxliteRuntimePath
  } catch {
    mkdirSync(boxliteDataPath, { recursive: true })
    return boxliteDataPath
  }
}

export const config = {
  repoRoot,
  port,
  adminPort,
  dataRoot,
  agentsRoot: join(dataRoot, 'agents'),
  databasePath: join(dataRoot, 'db', 'dune.db'),
  frontendDistPath: resolveFromRepoRoot(process.env.FRONTEND_DIST_PATH || './packages/frontend/dist'),
  // Keep a stable human-facing path at data/boxlite, but store runtime state
  // in the shorter data/b directory to stay under Unix socket path limits.
  boxliteDataPath,
  boxliteHome: ensureBoxliteRuntimeHome(),
  agentStartupTimeoutMs: parseInt(process.env.AGENT_STARTUP_TIMEOUT_MS || '300000', 10),
  agentDesktopPollMs: parseInt(process.env.AGENT_DESKTOP_POLL_MS || '500', 10),
  sandboxExecTimeoutMs: parseInt(process.env.SANDBOX_EXEC_TIMEOUT_MS || '30000', 10),
  sandboxExecMaxRetries: parseInt(process.env.SANDBOX_EXEC_MAX_RETRIES || '2', 10),
}
