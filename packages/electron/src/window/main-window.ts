import { BrowserWindow, nativeTheme } from 'electron'
import { getPreloadPath } from '../util/paths'
import { restoreWindowState, trackWindowState } from './window-state'

export function createMainWindow(backendPort: number, devMode: boolean): BrowserWindow {
  const savedState = restoreWindowState()

  const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1d1e21' : '#faf9f6'

  const win = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 800,
    minHeight: 600,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          frame: false,
        }),
    backgroundColor,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  trackWindowState(win)

  if (savedState.isMaximized) {
    win.maximize()
  }

  if (devMode) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadURL(`http://127.0.0.1:${backendPort}`)
  }

  win.once('ready-to-show', () => {
    win.show()
  })

  return win
}
