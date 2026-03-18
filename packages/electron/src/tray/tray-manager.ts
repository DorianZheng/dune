import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { getAssetPath } from '../util/paths'

let tray: Tray | null = null

export function setupTray(mainWindow: BrowserWindow): Tray {
  const iconName =
    process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png'

  const iconPath = getAssetPath(iconName)

  // Create a small fallback icon if the file doesn't exist
  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = createFallbackIcon()
    }
  } catch {
    icon = createFallbackIcon()
  }

  tray = new Tray(icon)
  tray.setToolTip('Dune')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Dune',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  return tray
}

function createFallbackIcon(): Electron.NativeImage {
  // 16x16 minimal PNG (transparent with a small dot)
  return nativeImage.createEmpty()
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
