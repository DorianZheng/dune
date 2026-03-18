import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('duneElectron', {
  platform: process.platform,
  isElectron: true,

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Theme
  onNativeThemeChange: (callback: (isDark: boolean) => void) => {
    ipcRenderer.on('native-theme-changed', (_e, isDark) => callback(isDark))
  },

  // App info
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // File dialogs
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-directory'),
})

// Mark DOM for Electron-specific styling
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.electron = 'true'
  document.documentElement.dataset.platform = process.platform
})
