import { BrowserWindow, screen, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 800, isMaximized: false }

function getStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadState(): WindowState {
  try {
    const raw = readFileSync(getStatePath(), 'utf8')
    return { ...DEFAULT_STATE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function saveState(state: WindowState): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(getStatePath(), JSON.stringify(state))
  } catch {
    // ignore write errors
  }
}

export function restoreWindowState(): WindowState {
  const saved = loadState()

  // Validate that the saved position is on a visible display
  if (saved.x != null && saved.y != null) {
    const displays = screen.getAllDisplays()
    const visible = displays.some((display) => {
      const { x, y, width, height } = display.bounds
      return (
        saved.x! >= x &&
        saved.x! < x + width &&
        saved.y! >= y &&
        saved.y! < y + height
      )
    })
    if (!visible) {
      return { width: saved.width, height: saved.height, isMaximized: saved.isMaximized }
    }
  }

  return saved
}

export function trackWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return

      if (win.isMaximized()) {
        const current = loadState()
        saveState({ ...current, isMaximized: true })
      } else if (!win.isMinimized()) {
        const bounds = win.getBounds()
        saveState({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized: false,
        })
      }
    }, 300)
  }

  win.on('resize', debouncedSave)
  win.on('move', debouncedSave)
  win.on('maximize', debouncedSave)
  win.on('unmaximize', debouncedSave)
}
