import { app, BrowserWindow, dialog } from 'electron'
import { SidecarManager } from './sidecar/sidecar-manager'
import { createMainWindow } from './window/main-window'
import { setupTray, destroyTray } from './tray/tray-manager'
import { setupAppMenu } from './menu/app-menu'
import { registerIpcHandlers } from './ipc/ipc-handlers'
import { isDev } from './util/paths'

const sidecar = new SidecarManager()
let mainWindow: BrowserWindow | null = null
let isQuitting = false
const isE2E = process.env.DUNE_E2E === '1'

if (!isE2E) {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    console.error('Dune single-instance lock denied; exiting second instance.')
    app.quit()
    process.exit(0)
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(async () => {
  const devMode = isDev()

  setupAppMenu()
  registerIpcHandlers()

  if (devMode) {
    // In dev mode, don't spawn sidecar — developer runs backend + frontend separately
    console.log('Dev mode: loading http://localhost:5173 (run backend + frontend dev servers separately)')
    mainWindow = createMainWindow(0, true)
  } else {
    try {
      console.log('Starting backend sidecar...')
      const port = await sidecar.start()
      mainWindow = createMainWindow(port, false)
    } catch (err) {
      console.error('Failed to start backend:', err)
      dialog.showErrorBox(
        'Dune failed to start',
        `Could not start the backend server.\n\n${err instanceof Error ? err.message : String(err)}`
      )
      app.quit()
      return
    }
  }

  setupTray(mainWindow)

  sidecar.on('crashed', ({ code }: { code: number | null; signal: string | null }) => {
    if (isQuitting) return
    dialog
      .showMessageBox({
        type: 'error',
        title: 'Backend crashed',
        message: `The Dune backend exited unexpectedly (code=${code}).`,
        buttons: ['Restart', 'Quit'],
      })
      .then(async ({ response }) => {
        if (response === 0) {
          try {
            const port = await sidecar.start()
            mainWindow?.loadURL(`http://127.0.0.1:${port}`)
          } catch (restartErr) {
            dialog.showErrorBox(
              'Restart failed',
              `Could not restart backend.\n\n${restartErr instanceof Error ? restartErr.message : String(restartErr)}`
            )
            app.quit()
          }
        } else {
          app.quit()
        }
      })
  })

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async (e) => {
  if (isQuitting) return
  isQuitting = true

  e.preventDefault()
  destroyTray()

  try {
    await sidecar.stop()
  } catch (err) {
    console.error('Error stopping sidecar:', err)
  }

  app.exit(0)
})
