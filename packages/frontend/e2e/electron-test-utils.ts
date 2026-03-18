import { _electron as electron, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const repoRoot = resolve(__dirname, '../../..')
const electronWorkspaceRoot = resolve(repoRoot, 'packages/electron')
const electronMainPath = resolve(electronWorkspaceRoot, 'dist/main.js')
const electronRequire = createRequire(resolve(electronWorkspaceRoot, 'package.json'))
const electronPackageDir = dirname(electronRequire.resolve('electron/package.json'))
const electronExecutablePath = resolveElectronExecutablePath()
const electronRunsRoot = resolve(repoRoot, 'test-results/electron-e2e')
const execFileAsync = promisify(execFile)

export type ElectronApp = Awaited<ReturnType<typeof electron.launch>>
export type LaunchSession = {
  electronApp: ElectronApp
  page: Page | null
  runRoot: string
}

export type LaunchOptions = {
  devMode?: boolean
  bypassSingleInstance?: boolean
  tolerateExistingLockHolder?: boolean
  waitForWindow?: boolean
}

export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

let sessions: LaunchSession[] = []

function resolveElectronExecutablePath(): string {
  if (process.platform === 'darwin') {
    return resolve(electronPackageDir, 'dist/Electron.app/Contents/MacOS/Electron')
  }
  if (process.platform === 'win32') {
    return resolve(electronPackageDir, 'dist/electron.exe')
  }
  return resolve(electronPackageDir, 'dist/electron')
}

async function createIsolatedRunRoot(): Promise<{
  runRoot: string
  dataDir: string
  homeDir: string
}> {
  await fs.mkdir(electronRunsRoot, { recursive: true })
  const runRoot = await fs.mkdtemp(join(electronRunsRoot, 'run-'))
  const dataDir = join(runRoot, 'data')
  const homeDir = join(runRoot, 'home')
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true }),
    fs.mkdir(homeDir, { recursive: true }),
    fs.mkdir(join(runRoot, 'xdg-config'), { recursive: true }),
    fs.mkdir(join(runRoot, 'xdg-state'), { recursive: true }),
    fs.mkdir(join(runRoot, 'xdg-cache'), { recursive: true }),
  ])
  return { runRoot, dataDir, homeDir }
}

function buildLaunchEnv(
  runRoot: string,
  dataDir: string,
  homeDir: string,
  bypassSingleInstance: boolean,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATA_DIR: dataDir,
    DUNE_E2E: bypassSingleInstance ? '1' : '0',
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: join(runRoot, 'xdg-config'),
    XDG_STATE_HOME: join(runRoot, 'xdg-state'),
    XDG_CACHE_HOME: join(runRoot, 'xdg-cache'),
  }
}

function isSingleInstanceLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Dune single-instance lock denied')
}

export async function launchDuneApp(options: LaunchOptions = {}): Promise<LaunchSession | null> {
  const { runRoot, dataDir, homeDir } = await createIsolatedRunRoot()
  try {
    const electronApp = await electron.launch({
      executablePath: electronExecutablePath,
      args: [electronMainPath, ...(options.devMode ? ['--dev'] : [])],
      cwd: repoRoot,
      env: buildLaunchEnv(runRoot, dataDir, homeDir, options.bypassSingleInstance ?? false),
    })

    let page: Page | null = null
    if (options.waitForWindow !== false) {
      page = await electronApp.firstWindow()
      await page.waitForLoadState('domcontentloaded')
    }

    const session: LaunchSession = {
      electronApp,
      page,
      runRoot,
    }
    sessions.push(session)
    return session
  } catch (error) {
    await fs.rm(runRoot, { recursive: true, force: true }).catch(() => {})
    if (options.tolerateExistingLockHolder && isSingleInstanceLockError(error)) {
      return null
    }
    throw error
  }
}

export async function cleanupLaunchSessions(): Promise<void> {
  const currentSessions = sessions.reverse()
  sessions = []

  for (const session of currentSessions) {
    if (session.electronApp) {
      await session.electronApp.close().catch(() => {})
    }
    await fs.rm(session.runRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function parseWindowId(mediaSourceId: string | null): string | null {
  if (!mediaSourceId) return null
  const match = mediaSourceId.match(/^window:(\d+):/)
  return match?.[1] ?? null
}

async function getWindowCaptureTarget(
  session: LaunchSession,
  bounds?: WindowBounds,
): Promise<{ bounds: WindowBounds; mediaSourceId: string | null }> {
  return session.electronApp.evaluate(async ({ BrowserWindow }, requestedBounds) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) {
      throw new Error('No Electron BrowserWindow available for capture')
    }

    if (requestedBounds) {
      if (win.isMaximized()) {
        win.unmaximize()
      }
      win.setBounds(requestedBounds, false)
    }

    win.show()
    win.focus()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 180))

    return {
      bounds: win.getBounds(),
      mediaSourceId: typeof win.getMediaSourceId === 'function' ? win.getMediaSourceId() : null,
    }
  }, bounds)
}

export async function captureDesktopWindowScreenshot(
  session: LaunchSession,
  screenshotPath: string,
  bounds?: WindowBounds,
): Promise<WindowBounds> {
  await fs.mkdir(dirname(screenshotPath), { recursive: true })
  const target = await getWindowCaptureTarget(session, bounds)

  if (process.platform === 'darwin') {
    const windowId = parseWindowId(target.mediaSourceId)
    if (windowId) {
      await execFileAsync('screencapture', ['-x', '-o', '-l', windowId, screenshotPath])
    } else {
      const { x, y, width, height } = target.bounds
      await execFileAsync('screencapture', ['-x', '-o', '-R', `${x},${y},${width},${height}`, screenshotPath])
    }
  } else {
    if (!session.page) {
      throw new Error('Expected a page-backed session for non-macOS screenshots')
    }
    await session.page.screenshot({
      path: screenshotPath,
      animations: 'disabled',
      caret: 'hide',
    })
  }

  await fs.stat(screenshotPath)
  return target.bounds
}
